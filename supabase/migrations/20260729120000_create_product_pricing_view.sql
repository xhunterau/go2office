BEGIN;

-- Charm pricing: keep the dollar amount, force the cents to .95.
--
-- IMPORTANT: this function is mirrored in TypeScript as `charmPrice()` in
-- src/lib/pricing.ts (the form snaps manually typed retail prices with it).
-- Changing one side without the other makes the form and the suggested price
-- disagree. See CLAUDE.md rule 17.
--
-- The rule is neither "round up" nor "round to nearest": 24.10 -> 24.95 moves up
-- 0.85 while 19.99 -> 19.95 moves down 0.04. Only the cents change; the dollar
-- amount never crosses into the next band. Idempotent, so it is safe to re-apply
-- on every blur: floor(19.95) + 0.95 = 19.95.
--
-- Non-positive and NULL inputs are returned untouched — floor(-0.30) = -1 would
-- otherwise produce a meaningless -0.05.
CREATE OR REPLACE FUNCTION public.charm_price(value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN value IS NULL OR value <= 0 THEN value
    ELSE floor(value) + 0.95
  END;
$$;

COMMENT ON FUNCTION public.charm_price(numeric) IS
  'Snap a price to .95 cents keeping the dollar amount. Mirrored by charmPrice() in src/lib/pricing.ts — keep both in sync (CLAUDE.md rule 17).';

-- Landed cost, freight and margin for every non-kit product.
--
-- A view, not stored columns: exchange rates and freight rates change, and
-- writing them into 3000+ rows would both require a full rewrite per change and
-- leave historical values that no longer mean anything. See
-- docs/product-pricing-view.md for the full derivation of each expression.
--
-- security_invoker = true is REQUIRED. Views execute as their owner by default,
-- which bypasses RLS on products / origins / pricing_settings and would turn
-- this view into an unauthenticated read channel.
CREATE VIEW public.product_pricing
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
  -- Kit cost is a roll-up of its components, a different formula entirely.
  -- Kept as a single top-level predicate so a kit branch can later be added as
  -- a UNION ALL without touching any expression above.
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
),
priced AS (
  SELECT
    c.*,
    -- Landed cost, excluding GST. Import GST is recoverable as an input tax
    -- credit in Australia, so it is not part of cost.
    c.purchase_price_aud + c.freight_cost_aud AS unit_cost_aud
  FROM costed c
),
suggested AS (
  SELECT
    p.*,
    tier.multiplier AS markup_multiplier,
    public.charm_price(p.unit_cost_aud * tier.multiplier * (1 + p.gst_rate))
      AS suggested_retail_price
  FROM priced p
  -- LEFT JOIN so a product with no cost (missing price/currency) still appears,
  -- just without a suggestion.
  LEFT JOIN LATERAL (
    SELECT t.multiplier
    FROM public.pricing_markup_tiers t
    WHERE p.unit_cost_aud >= t.min_cost
      AND (t.max_cost IS NULL OR p.unit_cost_aud < t.max_cost)
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
  -- SKUs. 6 decimals on cbm resolves down to 1 cm3.
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
    AS suggested_retail_margin_pct
FROM margins m;

COMMENT ON VIEW public.product_pricing IS
  'Landed cost, freight and margin per non-kit product. Kits are excluded — their cost is a component roll-up (next phase).';

GRANT SELECT ON public.product_pricing TO authenticated;

COMMIT;
