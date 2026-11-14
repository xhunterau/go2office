-- Index the platform order number so /orders can search by it.
--
-- order_transactions.sales_record_number holds the number the customer and the
-- platform know the order by: the Shopify order name (#G2B24769, written by
-- import_shopify_order and by Laravel before it) or the eBay sales record number
-- (324563). It is per line, not per order -- an order merged from two Shopify
-- orders carries both -- so the search resolves it here and filters orders by
-- the resulting ids (src/lib/queries/orders.ts, the "order_no" dimension).
--
-- Exact match only, so a btree is enough; ~250k rows, built in a second or two.
-- Not CONCURRENTLY: that cannot run inside the transaction every migration
-- here is wrapped in.

BEGIN;

CREATE INDEX order_transactions_sales_record_number_idx
  ON public.order_transactions USING btree (sales_record_number);

COMMIT;
