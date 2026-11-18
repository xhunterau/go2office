-- Dashboard aggregates (phase 2: KPIs, sales trend, stock cover).
--
-- PostgREST top-level aggregates are disabled on this project (PGRST123), and
-- pulling 20k order rows into Next.js to sum them is what CLAUDE.md rule 4's
-- "protect the main thread" is about. So the sums happen here, in two
-- read-only functions.
--
--   * dashboard_sales_series(): orders, sales and shipments per day or month,
--     bucketed in Sydney time. Gross profit is deliberately absent: every order
--     has postage_paid = 0 (legacy data never recorded it), so it would read
--     ~75% and mislead (user decision 2026-11-18).
--   * dashboard_low_stock(): products sold recently whose stock will not last
--     p_cover_days at the recent sales rate. Velocity-based rather than a fixed
--     threshold: 830 active products sit at 0 and have not sold in years, and a
--     threshold list would be nothing but those (user decision 2026-11-18).
--
-- Both are SECURITY INVOKER and STABLE: they read through the caller's RLS. No
-- GRANT -- Supabase's default ACL already gives `authenticated` EXECUTE, and a
-- GRANT here would only restate it (CLAUDE.md rule 22).

BEGIN;

-- ---------------------------------------------------------------------------
-- dashboard_sales_series
-- ---------------------------------------------------------------------------
--
-- One row per (bucket, platform) with any orders or shipments. Cancelled
-- orders are excluded from both counts.
--
-- Orders are bucketed by created_at, shipments by posted_on_date (set to now()
-- by dispatch_order). Migrated orders carry a date-only created_at stored as
-- Sydney midnight, so converting to Sydney time puts them on the right day.
--
-- sales = order_metrics_summary.order_total (goods + postage charged -
-- discount). An order with no summary row counts as an order with $0 sales
-- rather than disappearing from the count.
CREATE OR REPLACE FUNCTION public.dashboard_sales_series(p_grain text, p_from date)
RETURNS TABLE (
  bucket date,
  platform public.sales_platform,
  order_count bigint,
  sales numeric,
  shipped_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
BEGIN
  IF p_grain NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'dashboard_sales_series: grain must be day or month, got %', p_grain;
  END IF;

  v_from := p_from::timestamp AT TIME ZONE 'Australia/Sydney';

  RETURN QUERY
  WITH created AS (
    SELECT
      date_trunc(p_grain, o.created_at AT TIME ZONE 'Australia/Sydney')::date AS bucket,
      o.platform,
      count(*)::bigint AS order_count,
      COALESCE(sum(s.order_total), 0)::numeric AS sales
    FROM public.orders o
    LEFT JOIN public.order_metrics_summary s ON s.order_id = o.id
    WHERE o.created_at >= v_from
      AND o.status <> 'cancelled'
    GROUP BY 1, 2
  ),
  shipped AS (
    SELECT
      date_trunc(p_grain, o.posted_on_date AT TIME ZONE 'Australia/Sydney')::date AS bucket,
      o.platform,
      count(*)::bigint AS shipped_count
    FROM public.orders o
    WHERE o.posted_on_date >= v_from
      AND o.status <> 'cancelled'
    GROUP BY 1, 2
  )
  SELECT
    COALESCE(c.bucket, sh.bucket),
    COALESCE(c.platform, sh.platform),
    COALESCE(c.order_count, 0)::bigint,
    COALESCE(c.sales, 0)::numeric,
    COALESCE(sh.shipped_count, 0)::bigint
  FROM created c
  FULL JOIN shipped sh ON sh.bucket = c.bucket AND sh.platform = c.platform
  ORDER BY 1, 2;
END;
$$;

COMMENT ON FUNCTION public.dashboard_sales_series(text, date) IS
  'Dashboard: orders, sales (order_total) and shipments per Sydney day or month and platform since p_from. Excludes cancelled orders. No gross profit: postage_paid is not recorded yet.';

-- ---------------------------------------------------------------------------
-- dashboard_low_stock
-- ---------------------------------------------------------------------------
--
-- Units sold come from order_items, which already holds kit components rather
-- than kits (rebuild_order_items expands them), so a kit sale draws down its
-- parts here exactly as it does in inventory. Kits themselves hold no stock and
-- are skipped.
--
-- days_of_cover = on_hand / (units sold in the window / window days). A
-- product at 0 on hand has 0 days and sorts first.
--
-- total_count repeats on every row: how many products qualify before the
-- limit, so the card can say "showing 10 of 37".
CREATE OR REPLACE FUNCTION public.dashboard_low_stock(
  p_window_days integer DEFAULT 30,
  p_cover_days integer DEFAULT 14,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  product_id bigint,
  sku text,
  name text,
  on_hand bigint,
  sold_qty bigint,
  days_of_cover numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH sold AS (
    SELECT oi.product_id, sum(oi.quantity)::bigint AS qty
    FROM public.orders o
    JOIN public.order_transactions t ON t.order_id = o.id
    JOIN public.order_items oi ON oi.transaction_id = t.id
    WHERE o.created_at >= now() - make_interval(days => p_window_days)
      AND o.status <> 'cancelled'
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
    HAVING sum(oi.quantity) > 0
  ),
  stock AS (
    SELECT il.product_id, sum(il.qty)::bigint AS on_hand
    FROM public.inventory_levels il
    JOIN sold ON sold.product_id = il.product_id
    GROUP BY il.product_id
  ),
  candidates AS (
    SELECT
      p.id AS product_id,
      p.sku,
      p.name,
      COALESCE(st.on_hand, 0) AS on_hand,
      sold.qty AS sold_qty,
      round(COALESCE(st.on_hand, 0) / (sold.qty::numeric / p_window_days), 1) AS days_of_cover
    FROM sold
    JOIN public.products p ON p.id = sold.product_id
    LEFT JOIN stock st ON st.product_id = sold.product_id
    WHERE p.is_active
      AND NOT p.is_kit
  )
  SELECT
    product_id,
    sku,
    name,
    on_hand,
    sold_qty,
    days_of_cover,
    count(*) OVER ()::bigint AS total_count
  FROM candidates
  WHERE days_of_cover < p_cover_days
  ORDER BY days_of_cover ASC, sold_qty DESC, product_id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.dashboard_low_stock(integer, integer, integer) IS
  'Dashboard: active non-kit products sold in the last p_window_days whose on-hand stock covers fewer than p_cover_days at that sales rate. Most urgent first; total_count is the pre-limit total.';

COMMIT;
