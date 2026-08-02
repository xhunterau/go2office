BEGIN;

-- Reshape the orders domain after review (2026-08-02).
-- See docs/orders-domain-migration.md section 13.
--
-- Five changes, all requested after inspecting the migrated schema:
--   1. the delivery address moves from orders to customers;
--   2. orders.transit_cover and orders.parcel_zone are dropped;
--   3. postage moves from the transaction line up to the order, and
--      order_transactions loses paypal_transaction_id_number and
--      notes_to_yourself;
--   4. order_totals loses postage_total;
--   5. (consequence of 3) order_total is now goods + the order's postage.
--
-- Order of operations matters: the postage total has to be rolled up into
-- orders BEFORE the source column is dropped, and the view has to go before the
-- column it reads.

-- ---------------------------------------------------------------------------
-- 1. The view depends on order_transactions.postage_and_handling; drop it first
--    and rebuild it at the end.
-- ---------------------------------------------------------------------------
DROP VIEW public.order_totals;

-- ---------------------------------------------------------------------------
-- 2. Postage moves up to the order.
--
-- Legacy postage is recorded per transaction line, so rolling it up is a SUM:
-- an order with three lines paid postage on each. Orders with no transactions
-- (25 of them) land on 0 via COALESCE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN postage_and_handling numeric(12, 2) NOT NULL DEFAULT 0;

UPDATE public.orders o
SET postage_and_handling = COALESCE(s.total, 0)
FROM (
  SELECT order_id, sum(postage_and_handling) AS total
  FROM public.order_transactions
  GROUP BY order_id
) AS s
WHERE s.order_id = o.id;

-- ---------------------------------------------------------------------------
-- 3. The delivery address moves to customers.
--
-- Backfilled from each customer's most recent order rather than from
-- go2_buyers, so this migration stays replayable once the legacy temp tables
-- are dropped.
--
-- Note what this gives up: 8150 orders (4%, across 5483 customers) were shipped
-- to an address different from that customer's latest one. Once the ship_to_*
-- columns are dropped below, those older addresses are gone -- an order from
-- 2019 will render with wherever the customer lives now. This was an explicit
-- decision; see section 13 of the doc.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN company_name text,
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN address_line3 text,
  ADD COLUMN address_line4 text,
  ADD COLUMN city text,
  ADD COLUMN state text,
  ADD COLUMN postcode text,
  ADD COLUMN country text;

UPDATE public.customers c
SET company_name  = latest.ship_to_company,
    address_line1 = latest.ship_to_line1,
    address_line2 = latest.ship_to_line2,
    address_line3 = latest.ship_to_line3,
    address_line4 = latest.ship_to_line4,
    city          = latest.ship_to_city,
    state         = latest.ship_to_state,
    postcode      = latest.ship_to_postcode,
    country       = latest.ship_to_country
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id, ship_to_company, ship_to_line1, ship_to_line2, ship_to_line3,
    ship_to_line4, ship_to_city, ship_to_state, ship_to_postcode, ship_to_country
  FROM public.orders
  ORDER BY customer_id, created_at DESC, id DESC
) AS latest
WHERE latest.customer_id = c.id;

-- ---------------------------------------------------------------------------
-- 4. Drop what is no longer wanted.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  DROP COLUMN ship_to_name,
  DROP COLUMN ship_to_company,
  DROP COLUMN ship_to_phone,
  DROP COLUMN ship_to_line1,
  DROP COLUMN ship_to_line2,
  DROP COLUMN ship_to_line3,
  DROP COLUMN ship_to_line4,
  DROP COLUMN ship_to_city,
  DROP COLUMN ship_to_state,
  DROP COLUMN ship_to_postcode,
  DROP COLUMN ship_to_country,
  DROP COLUMN transit_cover,
  DROP COLUMN parcel_zone;

ALTER TABLE public.order_transactions
  DROP COLUMN postage_and_handling,
  DROP COLUMN paypal_transaction_id_number,
  DROP COLUMN notes_to_yourself;

-- ---------------------------------------------------------------------------
-- 5. Rebuild the view.
--
-- postage_total is gone: postage now lives on orders as a plain column, so a
-- view aggregating it would just be reading one row back. order_total keeps its
-- meaning (what the customer paid in total) by adding that column to the goods.
-- ---------------------------------------------------------------------------
CREATE VIEW public.order_totals AS
SELECT
  o.id AS order_id,
  COALESCE(sum(t.sale_price * t.quantity), 0)::numeric(12, 2) AS goods_total,
  (COALESCE(sum(t.sale_price * t.quantity), 0) + o.postage_and_handling)::numeric(12, 2)
    AS order_total,
  count(t.id) AS transaction_count
FROM public.orders o
LEFT JOIN public.order_transactions t ON t.order_id = o.id
GROUP BY o.id, o.postage_and_handling;

ALTER VIEW public.order_totals SET (security_invoker = on);

GRANT SELECT ON public.order_totals TO authenticated;

COMMIT;
