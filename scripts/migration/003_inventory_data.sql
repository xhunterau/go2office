-- One-time data migration: inventory domain (Laravel legacy tables -> Supabase tables).
-- See docs/inventory-migration.md for full context and decisions.
--
-- This script is idempotent by design: every INSERT upserts on the primary key
-- (which is the legacy Laravel id, reused verbatim), so it can be re-run safely,
-- including the final run after the last Laravel backup is restored into the
-- go2_* tables. Per CLAUDE.md rule 15, if any column referenced below is
-- renamed/dropped/retyped on the target tables, this script must be updated
-- in the same change.
--
-- Migration order follows FK dependencies: locations -> inventory_levels.
--
-- Prerequisite: scripts/migration/001_products_domain_data.sql has been run, so
-- public.products already holds every product that is allowed to carry stock.
--
-- !! DANGER -- READ BEFORE RE-RUNNING !!
-- The qty mapping below is GREATEST(source, 0), so every run overwrites
-- inventory_levels.qty with the Laravel number. Once the new system starts
-- recording real receipts and dispatches, running this script silently discards
-- those movements and rolls stock back to the legacy values -- no error, just
-- wrong numbers. Suspend inventory writes before running it (see the cutover
-- runbook in docs/inventory-migration.md section 8.2) and retire the script
-- once the new system goes live.
--
-- Note: neither source table has created_at/updated_at columns, so unlike the
-- 001/002 scripts there is no `AT TIME ZONE 'Australia/Sydney'` conversion here.
-- Both timestamps are left to the column defaults and therefore record when the
-- row was migrated, not when it was originally created.

BEGIN;

-- 1. locations (source: go2_locations)
--
-- Dropped columns: `is_flow` is 1 on every row (a dead flag with no signal) and
-- `warehouse_id` is 1 on every row (go2_warehouses is not migrated at all).
--
-- The name guard skips locations that could not satisfy locations_name_not_blank.
-- As of 2026-08-01 this filters out 0 of the 24 source rows; the guard exists so
-- that the final sync run degrades to "skip the offending location" instead of
-- aborting the whole transaction on a CHECK violation.
INSERT INTO public.locations (id, name, comments)
SELECT
  l.id,
  l.name,
  l.comments
FROM public.go2_locations AS l
WHERE l.name IS NOT NULL
  AND btrim(l.name) <> ''
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  comments = EXCLUDED.comments;

-- 2. inventory_levels (source: go2_locations_products)
--
-- Dropped column: `logs` is a free-text movement journal inherited from the
-- pre-Laravel XOFFICE system. It stops at 2020-03-26 (before go2 went live) and
-- only 134 of 1446 rows reconcile against the current qty, so it is neither the
-- system of record nor an explanation of the current numbers. Deliberately not
-- migrated -- see docs/inventory-migration.md section 2.5.
--
-- qty is mapped through GREATEST(..., 0): 488 source rows are negative (down to
-- -8390) because Laravel deducted stock on sale without recording the matching
-- receipts. Zeroing them is what lets inventory_levels_qty_non_negative hold.
-- This loses information -- the diagnostics at the end of this file list every
-- row it touches, and go2_locations_products keeps the original values until the
-- temp tables are dropped.
--
-- Both EXISTS guards skip rows whose product or location is missing from the
-- target tables. As of 2026-08-01 this filters out 14 of the 2112 source rows:
-- 12 point at products Laravel had soft-deleted (public.products intentionally
-- excludes those, and two of the twelve carry non-zero stock), and 2 belong to
-- kits. The guards also mean the final sync run degrades to "skip the offending
-- row" instead of aborting the whole transaction on a foreign key violation.
--
-- The `NOT p.is_kit` term is not an optimisation -- it is load-bearing. Kits are
-- assembled from components at pick time, so stock recorded against the kit
-- itself double counts goods that are already counted as components. Migration
-- 20260801130000 deletes the two offending rows and adds a trigger rejecting
-- new ones; without this term the next run of this script would reinsert them
-- from go2_locations_products and now fail on that trigger.
INSERT INTO public.inventory_levels (id, product_id, location_id, qty)
SELECT
  lp.id,
  lp.product_id,
  lp.location_id,
  GREATEST(lp.qty, 0)
FROM public.go2_locations_products AS lp
WHERE EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = lp.product_id AND NOT p.is_kit
  )
  AND EXISTS (SELECT 1 FROM public.locations l WHERE l.id = lp.location_id)
ON CONFLICT (id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  location_id = EXCLUDED.location_id,
  qty = EXCLUDED.qty;

-- Reset identity sequences past the highest migrated id so future app-created
-- rows (new locations / stock rows) never collide with migrated ids.
SELECT setval(pg_get_serial_sequence('public.locations', 'id'), COALESCE((SELECT MAX(id) FROM public.locations), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.inventory_levels', 'id'), COALESCE((SELECT MAX(id) FROM public.inventory_levels), 0) + 1, false);

COMMIT;

-- ---------------------------------------------------------------------------
-- Diagnostics -- run manually after the script to confirm the outcome.
-- Do not skip these on the final sync run: every one of them is a case that
-- fails silently (rows vanish or numbers change) rather than raising an error.
-- ---------------------------------------------------------------------------
--
-- 1. Locations skipped for a blank name (expected: 0 rows):
--
-- SELECT id, name FROM public.go2_locations
-- WHERE name IS NULL OR btrim(name) = ''
-- ORDER BY id;
--
-- 2. Stock rows skipped, and why (expected as of 2026-08-01: 14 rows -- 12
--    soft-deleted products, of which lp 2178 and 2217 carry qty 3, so decide per
--    row whether that stock is really being written off; plus lp 1573 and 1576,
--    the two kits, which are correct to drop):
--
-- SELECT lp.id, lp.product_id, lp.location_id, lp.qty,
--        NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = lp.product_id) AS product_missing,
--        EXISTS (SELECT 1 FROM public.products p WHERE p.id = lp.product_id AND p.is_kit) AS is_kit,
--        NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.id = lp.location_id) AS location_missing
-- FROM public.go2_locations_products AS lp
-- WHERE NOT EXISTS (
--         SELECT 1 FROM public.products p
--         WHERE p.id = lp.product_id AND NOT p.is_kit
--       )
--    OR NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.id = lp.location_id)
-- ORDER BY lp.id;
--
-- 3. Rows zeroed by GREATEST (expected as of 2026-08-01: 484 rows, summing to
--    -85843 units written off). A materially larger number on the final run
--    means more phantom deductions accumulated before Laravel was frozen, and
--    the business should decide whether to stocktake first:
--
-- SELECT count(*) AS zeroed_rows, sum(lp.qty) AS units_written_off
-- FROM public.go2_locations_products AS lp
-- WHERE lp.qty < 0
--   AND EXISTS (
--         SELECT 1 FROM public.products p
--         WHERE p.id = lp.product_id AND NOT p.is_kit
--       )
--   AND EXISTS (SELECT 1 FROM public.locations l WHERE l.id = lp.location_id);
--
-- 4. Row counts and totals (expected as of 2026-08-01: 24 locations; 2098 stock
--    rows across 2098 products and 22 locations; 696 zero / 1402 positive;
--    sum(qty) = 51347):
--
-- SELECT (SELECT count(*) FROM public.locations) AS locations,
--        count(*) AS stock_rows,
--        count(DISTINCT product_id) AS products,
--        count(DISTINCT location_id) AS locations_used,
--        count(*) FILTER (WHERE qty = 0) AS zero_qty,
--        count(*) FILTER (WHERE qty > 0) AS positive_qty,
--        sum(qty) AS total_units
-- FROM public.inventory_levels;
--
-- 5. Field-by-field check against the source (expected: 0 rows):
--
-- SELECT lp.id, lp.product_id, il.product_id, lp.location_id, il.location_id,
--        lp.qty, il.qty
-- FROM public.go2_locations_products AS lp
-- JOIN public.inventory_levels AS il ON il.id = lp.id
-- WHERE il.product_id <> lp.product_id
--    OR il.location_id <> lp.location_id
--    OR il.qty <> GREATEST(lp.qty, 0);
--
-- 6. Source rows that would violate the new constraints if they ever appear
--    (expected: 0 rows):
--
-- SELECT 'duplicate_product_location' AS issue, min(id) AS sample_id
-- FROM public.go2_locations_products GROUP BY product_id, location_id HAVING count(*) > 1
-- UNION ALL
-- SELECT 'duplicate_location_name', min(id) FROM public.go2_locations GROUP BY name HAVING count(*) > 1;
