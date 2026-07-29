-- One-time data migration: go2_products domain (Laravel legacy tables -> Supabase tables).
-- See docs/products-domain-migration.md for full context and decisions.
--
-- This script is idempotent by design: every INSERT upserts on the primary key
-- (which is the legacy Laravel id, reused verbatim), so it can be re-run safely,
-- including the final run after the last Laravel backup is restored into the
-- go2_* tables. Per CLAUDE.md rule 15, if any column referenced below is
-- renamed/dropped/retyped on the target tables, this script must be updated
-- in the same change.
--
-- Migration order follows FK dependencies: origins -> brands -> suppliers -> products.

BEGIN;

-- 1. origins (source: go2_origins)
INSERT INTO public.origins (id, name, abbr)
SELECT id, origin, abbr
FROM public.go2_origins
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  abbr = EXCLUDED.abbr;

-- 2. brands (source: go2brands)
INSERT INTO public.brands (id, name, abbr)
SELECT id, name, abbr
FROM public.go2brands
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  abbr = EXCLUDED.abbr;

-- 3. suppliers (source: go2_suppliers)
INSERT INTO public.suppliers (id, company_name, contact_person, email, phone, comments)
SELECT id, company_name, contact_person, email, phone, comments
FROM public.go2_suppliers
ON CONFLICT (id) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  contact_person = EXCLUDED.contact_person,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  comments = EXCLUDED.comments;

-- 4. products (source: go2_products)
-- Only rows that were never soft-deleted in Laravel are migrated (deleted_at IS NULL);
-- soft-deleted rows are intentionally out of scope for this migration.
-- created_at/updated_at are naive timestamps recorded in Australia/Sydney local time;
-- `AT TIME ZONE 'Australia/Sydney'` reinterprets them as that zone and converts to timestamptz.
INSERT INTO public.products (
  id, sku, model, upc, brand_id, name, image_url, origin_id, supplier_id,
  currency, purchase_price, is_gst, weight, length, width, height,
  retail_price, is_active, comment, is_kit, ebay_title, description,
  created_at, updated_at
)
SELECT
  id,
  sku,
  model,
  upc,
  brand_id,
  name,
  image_url,
  origin_id,
  supplier_id,
  currency::public.currency_code,
  purchase_price,
  (is_gst = 1),
  weight::numeric(10, 3),
  length::numeric(10, 2),
  width::numeric(10, 2),
  height::numeric(10, 2),
  retail_price,
  (status = 1),
  comment,
  (is_kit = 1),
  ebay_title,
  description,
  (created_at AT TIME ZONE 'Australia/Sydney'),
  (updated_at AT TIME ZONE 'Australia/Sydney')
FROM public.go2_products
WHERE deleted_at IS NULL
ON CONFLICT (id) DO UPDATE SET
  sku = EXCLUDED.sku,
  model = EXCLUDED.model,
  upc = EXCLUDED.upc,
  brand_id = EXCLUDED.brand_id,
  name = EXCLUDED.name,
  image_url = EXCLUDED.image_url,
  origin_id = EXCLUDED.origin_id,
  supplier_id = EXCLUDED.supplier_id,
  currency = EXCLUDED.currency,
  purchase_price = EXCLUDED.purchase_price,
  is_gst = EXCLUDED.is_gst,
  weight = EXCLUDED.weight,
  length = EXCLUDED.length,
  width = EXCLUDED.width,
  height = EXCLUDED.height,
  retail_price = EXCLUDED.retail_price,
  is_active = EXCLUDED.is_active,
  comment = EXCLUDED.comment,
  is_kit = EXCLUDED.is_kit,
  ebay_title = EXCLUDED.ebay_title,
  description = EXCLUDED.description,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

-- Reset identity sequences past the highest migrated id so future app-created
-- rows (new products/brands/suppliers/origins) never collide with migrated ids.
SELECT setval(pg_get_serial_sequence('public.origins', 'id'), COALESCE((SELECT MAX(id) FROM public.origins), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.brands', 'id'), COALESCE((SELECT MAX(id) FROM public.brands), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.suppliers', 'id'), COALESCE((SELECT MAX(id) FROM public.suppliers), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.products', 'id'), COALESCE((SELECT MAX(id) FROM public.products), 0) + 1, false);

COMMIT;
