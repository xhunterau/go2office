BEGIN;

-- Remove `new` from public.order_status, leaving nine values.
--
-- Migration 20260804100000 added it along with the rest of the Laravel dropdown
-- (docs/orders-domain-migration.md section 15). It turned out not to be part of
-- this business's lifecycle: an order arrives already paid or unpaid, never in a
-- state called "new".
--
-- Safe to drop, checked against the remote on 2026-08-08:
--   * 0 orders carry it;
--   * the final Laravel backup only ever produces COMPLETED, CANCELLED,
--     PROCESSING and ISSUED, so scripts/migration/004_orders_data.sql -- which
--     converts with `lower(source)::order_status` and has no CASE map to update
--     (CLAUDE.md rule 15) -- is unaffected;
--   * the only objects typed order_status are orders.status and the
--     order_status_counts view. No defaults, no functions, no policy predicate
--     mentions the column.
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
  'picked',
  'labelled',
  'issued',
  'completed',
  'cancelled'
);

-- Via text: there is no cast between two enum types. Any row still holding
-- `new` would fail here rather than being silently coerced -- which is the
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
