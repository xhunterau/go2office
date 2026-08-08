BEGIN;

-- public.order_totals is retired: public.order_metrics_summary (migration
-- 20260808170000) computes the same three numbers and more, from the same
-- sources, and can be joined in a paginated query.
--
-- Dropped rather than rewritten as a thin view over the summary table. Keeping
-- both would leave two names for one set of numbers, which is the same shape of
-- problem CLAUDE.md rule 17 exists to manage for charm_price -- except here
-- there is no reason to accept it, since nothing outside this repo reads the
-- view.
--
-- Column mapping for anything that still refers to the old names:
--
--   order_totals.order_id          -> order_metrics_summary.order_id
--   order_totals.goods_total       -> order_metrics_summary.goods_total
--   order_totals.order_total       -> order_metrics_summary.order_total
--   order_totals.transaction_count -> order_metrics_summary.transaction_count
--
-- One deliberate behaviour change: order_total now subtracts orders.discount
-- (migration 20260808160000), where the view was goods + postage only. Every
-- migrated order has discount 0, so no existing value moves; only orders
-- entered from now on can differ.
--
-- The warning at the foot of migration 20260803160000 -- "do not join this view
-- in a paginated list query", because it aggregated all 250413 transaction rows
-- on every reference -- no longer applies to the replacement. That is the whole
-- point of materialising it, and it is what lets the list screen sort by amount.

DROP VIEW public.order_totals;

COMMIT;
