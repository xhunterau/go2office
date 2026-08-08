BEGIN;

-- Search indexes and the status-tab counter for the Orders / Customers UI.
-- See docs/orders-ui.md sections 3.4, 4.3 and 8.1 for the measurements behind
-- every choice made here.
--
-- Seven GIN indexes over 178024 + 203315 rows will not finish inside the remote
-- default statement_timeout. Same reason scripts/migration/004_orders_data.sql
-- does this (CLAUDE.md rule 15).
SET LOCAL statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. Trigram indexes for the search box
-- ---------------------------------------------------------------------------
-- Every searchable column currently carries a plain btree, which under a non-C
-- collation cannot serve `ILIKE '%x%'` -- not even the `LIKE 'x%'` prefix case.
-- Measured before this migration: customers.full_name ILIKE '%smith%' is a Seq
-- Scan, 96 ms warm. That is per keystroke, across two tables of 200k rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Search dimensions 1 and 2: invoice number and tracking number.
CREATE INDEX orders_invoice_number_trgm_idx
  ON public.orders USING gin (invoice_number extensions.gin_trgm_ops);
CREATE INDEX orders_tracking_number_trgm_idx
  ON public.orders USING gin (tracking_number extensions.gin_trgm_ops);

-- Dimension 3: customer name, email, eBay username.
-- customers.platform_user_id already has a UNIQUE btree, but that only serves
-- equality. The two indexes do different jobs and do not conflict.
CREATE INDEX customers_full_name_trgm_idx
  ON public.customers USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX customers_email_trgm_idx
  ON public.customers USING gin (email extensions.gin_trgm_ops);
CREATE INDEX customers_platform_user_id_trgm_idx
  ON public.customers USING gin (platform_user_id extensions.gin_trgm_ops);

-- Dimension 4: suburb and postcode.
-- "Suburb" is the customers.city column -- the fourth review round moved the
-- address off orders using generic naming, so the Australian suburb lives in
-- `city`. The UI says Suburb, the query reads city. See docs/orders-ui.md 4.1.
-- These values were migrated verbatim and are not normalised (mixed case and
-- spelling variants), so suburb matching must stay case-insensitive and fuzzy.
CREATE INDEX customers_city_trgm_idx
  ON public.customers USING gin (city extensions.gin_trgm_ops);

-- Postcode is four digits; prefix matching is enough. text_pattern_ops is what
-- lets `LIKE 'x%'` use a btree under a non-C collation.
CREATE INDEX customers_postcode_idx
  ON public.customers (postcode text_pattern_ops);

-- Dimension 5 (SKU) deliberately gets no index: it resolves through the
-- existing unique index on products.sku, then order_items_product_id_idx.
-- Measured at 19 ms for the hottest SKU (7100 orders). See section 5.3.

-- ---------------------------------------------------------------------------
-- 2. Status counts for the list-page tabs
-- ---------------------------------------------------------------------------
-- The tab row needs one count per order_status. The obvious way to get it --
-- PostgREST's `select=status,count()` -- is not available here: this project
-- runs with db-aggregates-enabled off, and asking for a top-level aggregate
-- returns `PGRST123: Use of aggregate functions is not allowed`. Turning that
-- switch on would open aggregates across every table for the sake of one
-- counter, so the count is exposed as a view instead.
--
-- Note this is the opposite advice to order_totals, which must never be queried
-- directly from the list. The difference is that this one is a single Index
-- Only Scan on orders_status_idx (65 ms, Heap Fetches: 0) issued once for the
-- whole page, not an aggregate joined per row.
CREATE VIEW public.order_status_counts AS
SELECT
  status,
  count(*)::bigint AS order_count
FROM public.orders
GROUP BY status;

-- Without security_invoker the view would run as its owner and bypass the RLS
-- on orders. Same reasoning as order_totals.
ALTER VIEW public.order_status_counts SET (security_invoker = on);

GRANT SELECT ON public.order_status_counts TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Refresh planner statistics
-- ---------------------------------------------------------------------------
-- Not housekeeping -- load-bearing. Stats left over from the data migration had
-- pg_class.reltuples on orders at 246475 against a real 203315 (21% high), which
-- is the number `count=estimated` reports to the user, and they made the planner
-- underestimate order_items_product_id_idx by 50x, so the SKU lookup picked a
-- nested loop driven from the wrong side. Measured before and after:
--
--   SKU reverse lookup, hottest SKU   7385 ms  ->  19 ms
--   /orders page 5000 (OFFSET 100000) 3220 ms  ->  60 ms
--   reltuples on orders                246475  ->  203315 (exact)
--
-- The 8 s statement_timeout on the `authenticated` role is the budget those
-- queries run against, so the first of them was close to failing outright.
ANALYZE public.orders;
ANALYZE public.customers;
ANALYZE public.order_transactions;
ANALYZE public.order_items;

COMMIT;
