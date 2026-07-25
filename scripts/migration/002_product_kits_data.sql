-- One-time data migration: go2_kits (Laravel legacy kit composition) -> public.product_kit_items.
-- See docs/product-kits-migration.md for full context and decisions.
--
-- This script is idempotent by design: the INSERT upserts on the primary key
-- (which is the legacy Laravel go2_kits.id, reused verbatim), so it can be re-run
-- safely, including the final run after the last Laravel backup is restored into
-- the go2_* tables. Per CLAUDE.md rule 16, if any column referenced below is
-- renamed/dropped/retyped on public.product_kit_items, this script must be
-- updated in the same change.
--
-- Prerequisite: scripts/migration/001_products_domain_data.sql has been run, so
-- public.products already holds every referenced product.

BEGIN;

-- Kit composition lines (source: go2_kits).
-- Column mapping: kit_id -> kit_product_id, product_id -> component_product_id.
--
-- Both EXISTS guards skip lines whose kit or component product is not present in
-- public.products. As of 2026-07-25 this filters out 0 of the 699 source rows;
-- the guards exist so that the final sync run degrades to "skip the offending
-- line" instead of aborting the whole transaction on a foreign key violation
-- (public.products intentionally excludes Laravel soft-deleted products).
--
-- created_at/updated_at are naive timestamps recorded in Australia/Sydney local
-- time; `AT TIME ZONE 'Australia/Sydney'` reinterprets them as that zone and
-- converts to timestamptz. Note that public.product_kit_items carries a
-- moddatetime trigger on updated_at, so on the DO UPDATE path updated_at is
-- stamped with now() rather than the legacy value -- only freshly inserted rows
-- keep the legacy updated_at.
INSERT INTO public.product_kit_items (
  id, kit_product_id, component_product_id, qty, created_at, updated_at
)
SELECT
  k.id,
  k.kit_id,
  k.product_id,
  k.qty,
  (k.created_at AT TIME ZONE 'Australia/Sydney'),
  (k.updated_at AT TIME ZONE 'Australia/Sydney')
FROM public.go2_kits AS k
WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = k.kit_id)
  AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = k.product_id)
ON CONFLICT (id) DO UPDATE SET
  kit_product_id = EXCLUDED.kit_product_id,
  component_product_id = EXCLUDED.component_product_id,
  qty = EXCLUDED.qty,
  created_at = EXCLUDED.created_at;

-- Reset the identity sequence past the highest migrated id so future
-- app-created rows never collide with migrated ids.
SELECT setval(
  pg_get_serial_sequence('public.product_kit_items', 'id'),
  COALESCE((SELECT MAX(id) FROM public.product_kit_items), 0) + 1,
  false
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Diagnostics -- run manually after the script to confirm the outcome.
-- ---------------------------------------------------------------------------
--
-- Rows skipped because a referenced product is missing from public.products
-- (expected: 0 rows):
--
-- SELECT k.id, k.kit_id, k.product_id
-- FROM public.go2_kits AS k
-- WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = k.kit_id)
--    OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = k.product_id)
-- ORDER BY k.id;
--
-- Row counts (expected 699 lines across 616 kits as of 2026-07-25):
--
-- SELECT count(*) AS lines, count(DISTINCT kit_product_id) AS kits
-- FROM public.product_kit_items;
--
-- Source rows that would violate the new constraints if they ever appear
-- (expected: 0 rows each):
--
-- SELECT 'non_positive_qty' AS issue, id FROM public.go2_kits WHERE qty <= 0
-- UNION ALL
-- SELECT 'self_reference', id FROM public.go2_kits WHERE kit_id = product_id
-- UNION ALL
-- SELECT 'duplicate_component', min(id) FROM public.go2_kits
--   GROUP BY kit_id, product_id HAVING count(*) > 1;
