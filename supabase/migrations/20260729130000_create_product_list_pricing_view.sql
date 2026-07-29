BEGIN;

-- The products list page's data source: every product, with its brand name and
-- its cost figures attached.
--
-- Why a second view rather than reading product_pricing directly: that view
-- excludes kits, and the list must keep showing them (it has an "is kit" filter
-- that depends on their being there). LEFT JOIN gives kits a row with NULL cost
-- columns, which the table renders as a dash.
--
-- Why not embed the join in the query layer instead: filtering by margin has to
-- happen in the same query as pagination, otherwise the page count is wrong. And
-- PostgREST cannot embed a view into a table without a foreign key to follow, so
-- brand_name has to come from SQL as well.
--
-- security_invoker = true for the same reason as product_pricing: without it the
-- view runs as its owner and bypasses RLS on every table below.
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
  -- NULL for kits (no row in product_pricing) and for products missing a
  -- currency or purchase price.
  pp.unit_cost_aud,
  pp.retail_margin_pct
FROM public.products p
LEFT JOIN public.brands b ON b.id = p.brand_id
LEFT JOIN public.product_pricing pp ON pp.id = p.id;

COMMENT ON VIEW public.product_list_pricing IS
  'Products list source: all products (kits included, with NULL cost) plus brand name and headline cost figures.';

GRANT SELECT ON public.product_list_pricing TO authenticated;

COMMIT;
