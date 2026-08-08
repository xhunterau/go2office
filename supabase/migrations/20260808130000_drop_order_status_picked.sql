BEGIN;

-- Remove `picked` from public.order_status, leaving eight values.
--
-- Same story as `new` in 20260808120000: migration 20260804100000 imported the
-- whole Laravel dropdown (docs/orders-domain-migration.md section 15), and this
-- one turned out not to be a state this business parks orders in -- an order
-- goes from processing straight to labelled. The picking itself is recorded on
-- order_items (pick locations), not on the order's status.
--
-- Safe to drop, checked against the remote on 2026-08-08:
--   * 0 orders carry it (processing 9, issued 1, completed 202778,
--     cancelled 527 -- nothing else);
--   * go2_orders.order_status only ever holds COMPLETED, CANCELLED, PROCESSING
--     and ISSUED, so scripts/migration/004_orders_data.sql -- which converts
--     with `lower(source)::order_status` and has no CASE map to update
--     (CLAUDE.md rule 15) -- is unaffected;
--   * the only objects typed order_status are orders.status, orders_status_idx
--     and the order_status_counts view. No defaults, no functions, no policy
--     predicate mentions the column.
--
-- Postgres has no DROP VALUE, so the type is rebuilt and the column recast. That
-- rewrites all 203315 rows under an ACCESS EXCLUSIVE lock, which is why this
-- must not run while orders are being written.
SET LOCAL statement_timeout = 0;

-- The view reads orders.status, and a column cannot be retyped while a view
-- depends on it. Dropped and rebuilt verbatim below.
DROP VIEW public.order_status_counts;

ALTER TYPE public.order_status RENAME TO order_status_old;

-- Declaration order is the business lifecycle and the enum's sort order; the
-- status dropdown renders by iterating it (docs/orders-ui.md 4.2).
CREATE TYPE public.order_status AS ENUM (
  'pending',
  'unpaid',
  'backorder',
  'processing',
  'labelled',
  'issued',
  'completed',
  'cancelled'
);

-- Via text: there is no cast between two enum types. Any row still holding
-- `picked` would fail here rather than being silently coerced -- which is the
-- behaviour to want, though the count is currently zero.
ALTER TABLE public.orders
  ALTER COLUMN status TYPE public.order_status
  USING status::text::public.order_status;

DROP TYPE public.order_status_old;

-- Recreated exactly as in 20260808100000. orders_status_idx was rebuilt by the
-- column rewrite above, so this is still a single index-only scan.
CREATE VIEW public.order_status_counts AS
SELECT
  status,
  count(*)::bigint AS order_count
FROM public.orders
GROUP BY status;

-- Without security_invoker the view runs as its owner and bypasses the RLS on
-- orders. Same reasoning as order_totals.
ALTER VIEW public.order_status_counts SET (security_invoker = on);

GRANT SELECT ON public.order_status_counts TO authenticated;

-- The rewrite invalidates the statistics that 20260808100000 was careful to
-- refresh; stale ones cost the SKU lookup a factor of 390 (docs/orders-ui.md
-- 3.4).
ANALYZE public.orders;

COMMIT;
