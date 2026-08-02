BEGIN;

-- Order money, computed rather than stored.
-- See docs/orders-domain-migration.md sections 2.5 and 4.6.
--
-- The legacy go2_orders.total_sale column was dropped rather than migrated: 61329
-- of its 203315 rows were 0 because the 2020 import from the previous XOFFICE
-- system never carried the totals across, while the underlying transaction lines
-- were imported correctly. Reconciling the two found only 5 orders where the
-- stored total and the computed one genuinely disagree -- the other 61275 were
-- simply blank. A column that is wrong on 30% of rows and derivable on 100% of
-- them is better computed.

CREATE VIEW public.order_totals AS
SELECT
  o.id AS order_id,
  COALESCE(sum(t.sale_price * t.quantity), 0)::numeric(12, 2) AS goods_total,
  COALESCE(sum(t.postage_and_handling), 0)::numeric(12, 2) AS postage_total,
  COALESCE(sum(t.sale_price * t.quantity + t.postage_and_handling), 0)::numeric(12, 2)
    AS order_total,
  count(t.id) AS transaction_count
FROM public.orders o
-- LEFT JOIN, not INNER: 25 orders have no transaction lines at all and must
-- still appear, at zero.
LEFT JOIN public.order_transactions t ON t.order_id = o.id
GROUP BY o.id;

-- Views run with the privileges of the querying role by default in PG 15+
-- (security_invoker), so the RLS on orders and order_transactions still applies.
ALTER VIEW public.order_totals SET (security_invoker = on);

GRANT SELECT ON public.order_totals TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Note for whoever builds the order list screen
-- ---------------------------------------------------------------------------
-- Do NOT join this view directly in a paginated list query. It aggregates all
-- 250413 transaction rows every time it is referenced, so
--
--   SELECT ... FROM orders o JOIN order_totals ot ON ot.order_id = o.id
--   ORDER BY o.created_at DESC LIMIT 50
--
-- computes 203315 totals to display 50 of them. Page first, then total the ids
-- on that page:
--
--   SELECT ... FROM order_totals WHERE order_id = ANY($1)
--
-- If the list ever needs to sort or filter BY amount, this view is the wrong
-- tool -- that needs either a materialised view or a stored total maintained by
-- trigger. Decide it then; do not pre-build it now.
