BEGIN;

-- Kit cost roll-up. See docs/product-kit-pricing.md for the full derivation.
--
-- Structure: the pricing engine is split into three views instead of one.
--
--   product_cost_base  non-kit products, cost only, UNROUNDED
--   product_cost_kit   kits, rolled up from product_cost_base, UNROUNDED
--   product_pricing    base UNION ALL kit, then markup tier + suggested price
--                      + margins, rounded once at the very end
--
-- Why the split rather than adding a UNION ALL branch to product_pricing: the
-- kit branch has to read the non-kit branch's result, and a view referencing
-- itself is not allowed. The split also means the tier lookup, charm_price and
-- the margin formulas exist once and serve both branches, instead of being
-- copied into a kit branch that would then have to be kept in sync by hand.
--
-- Rounding stays in the outermost view only: summing already-rounded component
-- costs across up to 9 components x 616 kits would accumulate the error that
-- docs/product-pricing-view.md section 3.7 deliberately avoids.

-- product_pricing has to be rebuilt from a different shape (new columns in the
-- middle of the list would break CREATE OR REPLACE, which can only append), so
-- it and its dependant are dropped and recreated inside this transaction.
DROP VIEW public.product_list_pricing;
DROP VIEW public.product_pricing;

-- 1. Non-kit branch: everything the old product_pricing computed up to unit
-- cost, minus the rounding, plus the columns the union needs.
CREATE VIEW public.product_cost_base
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    p.id,
    p.sku,
    p.name,
    p.brand_id,
    p.supplier_id,
    p.image_url,
    p.is_active,
    p.currency,
    p.purchase_price,
    p.retail_price,
    p.weight,
    p.length AS length_mm,
    p.width AS width_mm,
    p.height AS height_mm,
    -- origins rows ARE the freight modes (Sea Freight / Air Freight / Local
    -- Purchase); there is no separate freight_mode column to fall out of sync.
    upper(trim(o.abbr)) AS origin_abbr,
    o.name AS origin_name,
    s.gst_rate,
    s.air_freight_aud_per_kg,
    s.sea_freight_aud_per_cbm,
    s.air_volumetric_kg_per_cbm,
    s.sea_volumetric_kg_per_cbm,
    -- The two exchange rates run in opposite directions (see pricing_settings).
    -- is_gst only means "tax-inclusive" for AUD purchases; CNY/USD ignore it.
    CASE p.currency
      WHEN 'AUD' THEN p.purchase_price / (CASE WHEN p.is_gst THEN 1 + s.gst_rate ELSE 1 END)
      WHEN 'CNY' THEN p.purchase_price / s.aud_to_cny
      WHEN 'USD' THEN p.purchase_price * s.usd_to_aud
    END AS purchase_price_aud,
    -- Dimensions are stored in mm; 1 m3 = 1e9 mm3.
    p.length * p.width * p.height / 1000000000 AS volume_cbm
  FROM public.products p
  JOIN public.origins o ON o.id = p.origin_id
  CROSS JOIN public.pricing_settings s
  WHERE p.is_kit = false
),
chargeable AS (
  SELECT
    b.*,
    -- Forwarders bill on whichever is greater, volume or actual weight. Sea
    -- quotes per cbm, air per kg, so each mode has its own chargeable quantity.
    GREATEST(b.volume_cbm, b.weight / b.sea_volumetric_kg_per_cbm) AS chargeable_cbm,
    GREATEST(b.weight, b.volume_cbm * b.air_volumetric_kg_per_cbm) AS chargeable_kg
  FROM base b
),
costed AS (
  SELECT
    c.*,
    CASE c.origin_abbr
      WHEN 'AF' THEN c.chargeable_kg * c.air_freight_aud_per_kg
      WHEN 'LP' THEN 0
      -- 'SF' and anything unrecognised bill as sea. Falling back to NULL would
      -- wipe out unit cost and every margin below it.
      ELSE c.chargeable_cbm * c.sea_freight_aud_per_cbm
    END AS freight_cost_aud,
    -- Which side won, so the UI can explain the number rather than just show it.
    CASE c.origin_abbr
      WHEN 'LP' THEN 'none'
      WHEN 'AF' THEN
        CASE WHEN c.weight >= c.volume_cbm * c.air_volumetric_kg_per_cbm
          THEN 'weight' ELSE 'volume' END
      ELSE
        CASE WHEN c.volume_cbm >= c.weight / c.sea_volumetric_kg_per_cbm
          THEN 'volume' ELSE 'weight' END
    END AS chargeable_basis
  FROM chargeable c
)
SELECT
  c.id,
  c.sku,
  c.name,
  c.brand_id,
  c.supplier_id,
  c.image_url,
  c.is_active,
  false AS is_kit,
  c.currency,
  c.purchase_price,
  c.retail_price,
  c.origin_abbr,
  c.origin_name,
  c.weight,
  c.length_mm,
  c.width_mm,
  c.height_mm,
  c.volume_cbm,
  c.chargeable_cbm,
  c.chargeable_kg,
  c.chargeable_basis,
  c.purchase_price_aud,
  c.freight_cost_aud,
  -- Landed cost, excluding GST. Import GST is recoverable as an input tax
  -- credit in Australia, so it is not part of cost.
  c.purchase_price_aud + c.freight_cost_aud AS unit_cost_aud,
  NULL::integer AS component_count,
  c.gst_rate
FROM costed c;

COMMENT ON VIEW public.product_cost_base IS
  'Non-kit landed cost, unrounded. Internal input to product_pricing and to product_cost_kit — read product_pricing instead.';

GRANT SELECT ON public.product_cost_base TO authenticated;

-- 2. Kit branch: every attribute is derived from the components.
--
-- A kit is assembled locally out of stock that already carries its own import
-- freight, so it is treated as a Local Purchase: no international freight, and
-- its cost is stated directly in AUD excluding GST. That also means the derived
-- weight and dimensions below do NOT affect the kit's cost at all; they exist
-- for display and for outbound shipping later.
CREATE VIEW public.product_cost_kit
WITH (security_invoker = true) AS
WITH component AS (
  SELECT
    ki.kit_product_id,
    ki.qty,
    c.weight,
    c.length * c.width * c.height / 1000000000 AS volume_cbm,
    -- Each component's own three sides, sorted longest to shortest. Taking the
    -- kit's length from max(d1) and its width from max(d2) yields the smallest
    -- footprint every component still lies flat in. Pooling all 3N edges and
    -- taking the top two instead would oversize it whenever the two longest
    -- edges belong to the same slim component (26 kits today, 1.49x the area).
    GREATEST(c.length, c.width, c.height) AS d1,
    c.length + c.width + c.height
      - GREATEST(c.length, c.width, c.height)
      - LEAST(c.length, c.width, c.height) AS d2,
    bp.unit_cost_aud
  FROM public.product_kit_items ki
  JOIN public.products c ON c.id = ki.component_product_id
  -- LEFT JOIN, and product_cost_base holds non-kits only: a component that is
  -- itself a kit produces no row here and is caught by the guard below. Kits
  -- are not expanded recursively.
  LEFT JOIN public.product_cost_base bp ON bp.id = ki.component_product_id
),
rolled AS (
  SELECT
    k.kit_product_id,
    count(*)::integer AS component_count,
    -- sum() SKIPS nulls, which would quietly return an understated total that
    -- looks perfectly normal. If any component has no cost (missing purchase
    -- price, or the component is itself a kit), the whole kit reports none.
    CASE WHEN count(*) = count(k.unit_cost_aud)
      THEN sum(k.qty * k.unit_cost_aud)
    END AS unit_cost_aud,
    -- Quantities matter: 599 of 699 component rows have qty > 1. Cost, weight
    -- and volume scale with qty; the dimensions below do not — putting five of
    -- something in a kit does not make that item longer.
    sum(k.qty * k.weight) AS weight,
    sum(k.qty * k.volume_cbm) AS volume_cbm,
    max(k.d1) AS length_mm,
    max(k.d2) AS width_mm
  FROM component k
  GROUP BY k.kit_product_id
)
SELECT
  p.id,
  p.sku,
  p.name,
  p.brand_id,
  p.supplier_id,
  p.image_url,
  p.is_active,
  true AS is_kit,
  -- Synthesised, not read from the row: a kit's stored currency / purchase
  -- price / origin are legacy values that are never used (575 of them are zero
  -- placeholders, 61 hold a roll-up the old system froze at some past exchange
  -- rate). See docs/product-kit-pricing.md section 3.2.
  'AUD'::public.currency_code AS currency,
  r.unit_cost_aud AS purchase_price,
  p.retail_price,
  'LP'::text AS origin_abbr,
  'Local Purchase'::text AS origin_name,
  r.weight,
  r.length_mm,
  r.width_mm,
  -- Equivalent height at zero void: the height a box of this footprint needs to
  -- hold exactly the components' combined volume. NULL when the footprint is
  -- zero, which happens when every component has a zero dimension (26 kits) —
  -- their combined volume is necessarily zero too, so this is 0/0, not a real
  -- height. It costs nothing to lose: local purchases pay no freight.
  CASE WHEN r.length_mm * r.width_mm > 0
    THEN r.volume_cbm * 1000000000 / (r.length_mm * r.width_mm)
  END AS height_mm,
  r.volume_cbm,
  -- No freight is charged, but keep the chargeable columns on the same footing
  -- as the base branch so the union stays uniform.
  GREATEST(r.volume_cbm, r.weight / s.sea_volumetric_kg_per_cbm) AS chargeable_cbm,
  GREATEST(r.weight, r.volume_cbm * s.air_volumetric_kg_per_cbm) AS chargeable_kg,
  'none'::text AS chargeable_basis,
  r.unit_cost_aud AS purchase_price_aud,
  0::numeric AS freight_cost_aud,
  r.unit_cost_aud,
  -- 0 for a kit that has been flagged but never given components (24 today).
  -- Everything else about it stays NULL: an empty kit has no cost, and coalescing
  -- it to 0 would land it in the lowest markup tier and produce a $0.95
  -- suggested price that looks entirely plausible.
  coalesce(r.component_count, 0) AS component_count,
  s.gst_rate
FROM public.products p
CROSS JOIN public.pricing_settings s
LEFT JOIN rolled r ON r.kit_product_id = p.id
WHERE p.is_kit = true;

COMMENT ON VIEW public.product_cost_kit IS
  'Kit cost and physical attributes rolled up from product_kit_items, unrounded. Internal input to product_pricing — read that instead.';

GRANT SELECT ON public.product_cost_kit TO authenticated;

-- 3. The public contract: both branches, priced and rounded identically.
CREATE VIEW public.product_pricing
WITH (security_invoker = true) AS
WITH all_costs AS (
  SELECT
    id, sku, name, brand_id, supplier_id, image_url, is_active, is_kit,
    currency, purchase_price, retail_price, origin_abbr, origin_name,
    weight, length_mm, width_mm, height_mm, volume_cbm,
    chargeable_cbm, chargeable_kg, chargeable_basis,
    purchase_price_aud, freight_cost_aud, unit_cost_aud, component_count, gst_rate
  FROM public.product_cost_base
  UNION ALL
  SELECT
    id, sku, name, brand_id, supplier_id, image_url, is_active, is_kit,
    currency, purchase_price, retail_price, origin_abbr, origin_name,
    weight, length_mm, width_mm, height_mm, volume_cbm,
    chargeable_cbm, chargeable_kg, chargeable_basis,
    purchase_price_aud, freight_cost_aud, unit_cost_aud, component_count, gst_rate
  FROM public.product_cost_kit
),
suggested AS (
  SELECT
    c.*,
    tier.multiplier AS markup_multiplier,
    public.charm_price(c.unit_cost_aud * tier.multiplier * (1 + c.gst_rate))
      AS suggested_retail_price
  FROM all_costs c
  -- LEFT JOIN so a product with no cost (missing price/currency, or a kit with
  -- no components) still appears, just without a suggestion.
  LEFT JOIN LATERAL (
    SELECT t.multiplier
    FROM public.pricing_markup_tiers t
    WHERE c.unit_cost_aud >= t.min_cost
      AND (t.max_cost IS NULL OR c.unit_cost_aud < t.max_cost)
    ORDER BY t.min_cost DESC
    LIMIT 1
  ) tier ON true
),
margins AS (
  SELECT
    s.*,
    -- Retail prices are GST-inclusive shelf prices; strip GST before comparing
    -- against the GST-exclusive unit cost.
    s.retail_price / (1 + s.gst_rate) AS retail_ex_gst,
    s.suggested_retail_price / (1 + s.gst_rate) AS suggested_ex_gst
  FROM suggested s
)
SELECT
  m.id,
  m.sku,
  m.name,
  m.brand_id,
  m.supplier_id,
  m.image_url,
  m.is_active,
  m.currency,
  m.purchase_price,
  m.retail_price,
  m.origin_abbr,
  m.origin_name,
  m.weight,
  -- Rounding happens only here, at the outermost level: rounding intermediate
  -- values would turn a $0.096 freight charge into $0.10 on every one of 3000+
  -- SKUs, and would compound again through the kit roll-up. 6 decimals on cbm
  -- resolves down to 1 cm3.
  round(m.volume_cbm, 6) AS volume_cbm,
  round(m.chargeable_cbm, 6) AS chargeable_cbm,
  round(m.chargeable_kg, 3) AS chargeable_kg,
  m.chargeable_basis,
  round(m.purchase_price_aud, 2) AS purchase_price_aud,
  round(m.freight_cost_aud, 2) AS freight_cost_aud,
  round(m.unit_cost_aud, 2) AS unit_cost_aud,
  m.markup_multiplier,
  m.suggested_retail_price,
  round(m.retail_ex_gst - m.unit_cost_aud, 2) AS retail_profit,
  -- NULLIF guards a zero retail price, which would otherwise divide by zero.
  round((m.retail_ex_gst - m.unit_cost_aud) / NULLIF(m.retail_ex_gst, 0) * 100, 2)
    AS retail_margin_pct,
  round(m.suggested_ex_gst - m.unit_cost_aud, 2) AS suggested_retail_profit,
  round((m.suggested_ex_gst - m.unit_cost_aud) / NULLIF(m.suggested_ex_gst, 0) * 100, 2)
    AS suggested_retail_margin_pct,
  m.is_kit,
  round(m.length_mm, 2) AS length_mm,
  round(m.width_mm, 2) AS width_mm,
  round(m.height_mm, 2) AS height_mm,
  m.component_count
FROM margins m;

COMMENT ON VIEW public.product_pricing IS
  'Landed cost, freight and margin for every product. Kits are included: their cost, weight and dimensions are rolled up from product_kit_items and billed as a local purchase (no international freight).';

GRANT SELECT ON public.product_pricing TO authenticated;

-- 4. Unchanged definition, recreated because it depended on product_pricing.
-- Its cost columns are no longer null for kits.
CREATE VIEW public.product_list_pricing
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.sku,
  p.name,
  p.model,
  p.upc,
  p.brand_id,
  p.supplier_id,
  p.image_url,
  p.retail_price,
  p.is_active,
  p.is_kit,
  p.created_at,
  b.name AS brand_name,
  -- Null for products missing a currency or purchase price, and for kits with
  -- no components or with a component that has no cost of its own.
  pp.unit_cost_aud,
  pp.retail_margin_pct
FROM public.products p
LEFT JOIN public.brands b ON b.id = p.brand_id
LEFT JOIN public.product_pricing pp ON pp.id = p.id;

COMMENT ON VIEW public.product_list_pricing IS
  'Products list source: all products (kits included) plus brand name and headline cost figures.';

GRANT SELECT ON public.product_list_pricing TO authenticated;

COMMIT;
