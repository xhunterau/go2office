BEGIN;

-- product_cost_kit synthesises `purchase_price` (a kit has none of its own) from
-- the component roll-up, which is a full-precision numeric: GB02503SF came out
-- as 2.27963636363636363636. Every other money column is rounded by
-- product_pricing at the outermost level, but `purchase_price` passes straight
-- through there — it is the price as entered, and rounding a real entered price
-- would be wrong.
--
-- So round it here instead, in the one branch where the value is manufactured
-- rather than entered. This is not an exception to "round only at the outermost
-- level": the column feeds no calculation (unit_cost_aud is derived from
-- r.unit_cost_aud directly), it is display only.
--
-- Only this one expression changes; the rest is identical to
-- 20260730100000_create_product_kit_pricing_views.sql.
CREATE OR REPLACE VIEW public.product_cost_kit
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
  round(r.unit_cost_aud, 2) AS purchase_price,
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

COMMIT;
