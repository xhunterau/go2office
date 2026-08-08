BEGIN;

-- Scheduled backstop for public.order_metrics_summary.
--
-- The triggers in migration 20260808170000 cover every change to an order, its
-- transactions and its items. They deliberately do not cover the other input:
-- a PRODUCT's weight, dimensions or purchase price. Editing one product can move
-- the metrics of thousands of orders, and doing that synchronously would put an
-- unbounded write inside the request that saves the product form.
--
-- xpros solved this with a Trigger.dev job running a full refresh three times a
-- day. That is not ported: this project has no Trigger.dev setup at all (no
-- src/trigger, no trigger.config.ts), and the work is a single SQL statement
-- that never touches the Next.js request thread, so CLAUDE.md rule 4 does not
-- apply. pg_cron keeps it where the data is.
--
-- Two jobs rather than one, because a full refresh upserts all 203315 rows and
-- is too blunt to run often:
--
--   hourly -- recompute only the orders containing a recently edited product.
--             This is the case that actually happens, and it is cheap.
--   daily  -- full refresh, off-peak. Catches everything the targeted pass can
--             miss: pricing_settings changes (which move every cost at once), a
--             product deleted rather than edited, and any trigger that failed to
--             fire for a reason nobody has thought of yet.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- The hourly job filters products by updated_at; without this it is a seq scan
-- over the catalogue every hour.
CREATE INDEX products_updated_at_idx ON public.products (updated_at DESC);

-- Recompute the orders touched by products edited within p_since. Returns the
-- number of summary rows written, so the pg_cron run history shows whether a
-- pass did anything.
CREATE FUNCTION public.refresh_stale_order_metrics(p_since interval DEFAULT interval '2 hours')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  -- The window is deliberately wider than the schedule interval. An hourly job
  -- with a one-hour window loses any edit made while the previous run was in
  -- flight; overlapping the passes costs a little duplicated work and removes
  -- the gap entirely.
  SELECT array_agg(DISTINCT t.order_id) INTO v_ids
  FROM public.products p
    JOIN public.order_items i        ON i.product_id = p.id
    JOIN public.order_transactions t ON t.id = i.transaction_id
  WHERE p.updated_at >= now() - p_since;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.recompute_order_metrics(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_stale_order_metrics(interval) FROM PUBLIC;

-- Both schedules are UTC. The business runs on Australian eastern time (UTC+10),
-- so 17:00 UTC is 03:00 the next morning locally -- the quietest hour there is.
SELECT cron.schedule(
  'order-metrics-refresh-stale',
  '7 * * * *',
  $$SELECT public.refresh_stale_order_metrics(interval '2 hours')$$
);

SELECT cron.schedule(
  'order-metrics-refresh-full',
  '0 17 * * *',
  $$SELECT public.recompute_order_metrics(NULL)$$
);

COMMIT;
