-- Index for the Shipping method filter on /orders.
--
-- orders.status and orders.platform are indexed (20260803120000) but
-- shipping_method was not. With ~203k rows, filtering on a rarely used method
-- (Direct_Freight has 0 orders) made both the page query and its count scan the
-- whole table before giving up. Plain CREATE INDEX rather than CONCURRENTLY:
-- the latter cannot run inside the transaction rule 14 requires, and at this
-- size the lock is held for well under a second.

BEGIN;

CREATE INDEX IF NOT EXISTS orders_shipping_method_idx
  ON public.orders (shipping_method);

COMMIT;
