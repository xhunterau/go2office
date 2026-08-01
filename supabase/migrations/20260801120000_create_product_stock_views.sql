BEGIN;

-- Per-product stock rollup: the data source for the /inventory list and the
-- On Hand column on the products list.
--
-- LEFT JOIN, not INNER: 1022 of the 3122 products have no stock row at all, and
-- they must still appear (with on_hand 0) or the inventory list silently hides
-- everything that has never been received.
--
-- Kits always roll up to 0 because they are barred from holding stock
-- (migration 20260801130000). Their sellable quantity is a separate question,
-- to be derived from component availability in a later view.
--
-- security_invoker = true for the same reason as product_pricing: without it the
-- view runs as its owner and bypasses RLS on every table below.
CREATE VIEW public.product_stock
WITH (security_invoker = true) AS
SELECT
  p.id AS product_id,
  COALESCE(SUM(il.qty), 0)::integer AS on_hand,
  -- Only locations actually holding units. A row sitting at 0 records where the
  -- product belongs, not where it can be picked from.
  (COUNT(il.id) FILTER (WHERE il.qty > 0))::integer AS location_count,
  -- Pre-joined for the list so rendering the locations column costs no extra
  -- round trip per row.
  string_agg(l.name, ', ' ORDER BY l.name) FILTER (WHERE il.qty > 0) AS location_names
FROM public.products p
LEFT JOIN public.inventory_levels il ON il.product_id = p.id
LEFT JOIN public.locations l ON l.id = il.location_id
GROUP BY p.id;

COMMENT ON VIEW public.product_stock IS
  'Per-product stock rollup: total on hand plus which locations hold it. Products with no stock appear with on_hand 0.';

GRANT SELECT ON public.product_stock TO authenticated;

-- Add on_hand to the products list source. CREATE OR REPLACE keeps the existing
-- columns in place and appends the new one, so nothing that selects the current
-- column set breaks.
CREATE OR REPLACE VIEW public.product_list_pricing
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
  -- NULL for kits (no row in product_pricing) and for products missing a
  -- currency or purchase price.
  pp.unit_cost_aud,
  pp.retail_margin_pct,
  -- Never NULL: product_stock has a row per product thanks to its LEFT JOIN.
  ps.on_hand
FROM public.products p
LEFT JOIN public.brands b ON b.id = p.brand_id
LEFT JOIN public.product_pricing pp ON pp.id = p.id
LEFT JOIN public.product_stock ps ON ps.product_id = p.id;

COMMENT ON VIEW public.product_list_pricing IS
  'Products list source: all products (kits included, with NULL cost) plus brand name, headline cost figures and stock on hand.';

COMMIT;
