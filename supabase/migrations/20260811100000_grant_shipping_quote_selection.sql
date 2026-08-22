-- Let the order detail panel act on a quote batch.
--
-- 20260810110000 created order_shipping_quotes read-only for `authenticated`:
-- the engine writes it under the service role, and at the time nothing in the
-- app touched it. The Re-Quote Shipping panel changes that -- an operator can
-- override which quote is selected, and can clear a batch outright.
--
-- Two things stay out of reach on purpose:
--
--   * UPDATE is granted on `is_selected` ALONE. Every other column is the
--     engine's output -- the price a carrier gave us on a date. A blanket
--     UPDATE would let the UI (or a bug in it) rewrite a quoted rate, and the
--     row would still look like a carrier's answer.
--   * No INSERT. A quote row that no engine run produced is not a quote.
--
-- order_shipping_quotes_one_selected_idx still applies: a caller setting
-- is_selected has to clear the order's current selection first, in that order.
-- The engine does this (src/lib/shipping/quote-engine.ts) and so does
-- selectShippingQuote (src/lib/actions/shipping-quote.ts).

BEGIN;

CREATE POLICY "authenticated_update_selection" ON public.order_shipping_quotes
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_delete" ON public.order_shipping_quotes
  FOR DELETE
  TO authenticated
  USING (true);

GRANT UPDATE (is_selected) ON public.order_shipping_quotes TO authenticated;
GRANT DELETE ON public.order_shipping_quotes TO authenticated;

COMMIT;
