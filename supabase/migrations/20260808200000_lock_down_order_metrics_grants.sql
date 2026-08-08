BEGIN;

-- Corrects the access control migration 20260808170000 claimed but did not
-- achieve. That file said of order_metrics_summary: "there is no
-- INSERT/UPDATE/DELETE policy and no write grant". The first half was true, the
-- second was not.
--
-- The cause: Supabase ships ALTER DEFAULT PRIVILEGES for the public schema that
-- grant every table privilege to anon/authenticated/service_role and EXECUTE on
-- every function to the same three. Those are DIRECT grants, so the
-- `REVOKE ... FROM PUBLIC` in 20260808170000 did not touch them, and the
-- `GRANT SELECT ... TO authenticated` added nothing that was not already there.
-- Verified on the remote after pushing: anon and authenticated held
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on the table and
-- EXECUTE on all three functions.
--
-- Two of those actually matter:
--
--   1. recompute_order_metrics(NULL) refreshes all 203315 rows and raises its
--      own statement_timeout to 10 minutes. Exposed through PostgREST to anon,
--      it is a denial-of-service primitive that needs no credentials.
--
--   2. TRUNCATE is not subject to row-level security. RLS correctly blocks
--      INSERT/UPDATE/DELETE on this table (no policy grants them), but it has
--      nothing to say about TRUNCATE.
--
-- The same blanket grants sit on orders, pricing_settings and the rest of the
-- schema, where RLS is what holds the line. This migration does not attempt to
-- fix the schema-wide default -- that is a separate decision with a much wider
-- blast radius. It fixes the objects this round introduced, following the
-- precedent set by 20260801140000 (inventory_movements) and 20260802110000
-- (prune_product_movements).

-- ---------------------------------------------------------------------------
-- 1. Table: read-only for authenticated, invisible to anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.order_metrics_summary FROM anon;
REVOKE ALL ON public.order_metrics_summary FROM authenticated;

GRANT SELECT ON public.order_metrics_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Functions.
-- ---------------------------------------------------------------------------
-- The workhorse and the cron job's entry point: owner and service_role only.
-- service_role keeps EXECUTE because that key already has unrestricted access to
-- the database -- revoking it here would be theatre, not a boundary.
REVOKE ALL ON FUNCTION public.recompute_order_metrics(bigint[]) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_order_metrics(bigint[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.refresh_stale_order_metrics(interval) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_stale_order_metrics(interval) FROM authenticated;

-- The single-order wrapper stays available to signed-in users -- it is the UI's
-- "recalculate this order" action, and it cannot be handed a NULL. anon has no
-- business calling it.
REVOKE ALL ON FUNCTION public.rebuild_order_metrics(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.rebuild_order_metrics(bigint) TO authenticated;

COMMIT;
