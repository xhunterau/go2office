BEGIN;

-- Dispatch: the one warehouse step after the label is printed.
--
-- xpros splits this across two screens and two writes -- confirm_order_picking
-- deducts stock and moves the order to `Pick`, then completePackingAction sets
-- `Dispatch` and the tracking number in separate statements, so an order could
-- end up dispatched with no log line, or picked with no tracking number. Here it
-- is one function and one transaction: stock out, pick locations recorded,
-- tracking number, status and audit line all land together or not at all.
-- See docs/order-dispatch.md.
--
-- p_picks says where each order_items row is taken from:
--   [{"order_item_id": 123, "location_id": 4}, ...]
-- It must name every item of the order exactly once. order_items rows are
-- recreated by rebuild_order_items when a line's SKU or quantity is edited, so a
-- list that no longer matches means the page is stale -- refused, not guessed.
--
-- SECURITY INVOKER, like the stock functions it calls: the caller's own RLS
-- applies, and auth.uid() is what satisfies order_logs' WITH CHECK
-- (CLAUDE.md rule 22).
--
-- Error codes the Server Action tells apart:
--   GO001  the tracking number is already on another order. Not always a
--          mistake -- one parcel can carry a Shopify and an eBay order for the
--          same buyer, which the import deliberately keeps apart -- so the page
--          asks and retries with p_allow_shared_tracking.
--   GO002  not enough stock; the message lists every short line.
--   P0001  anything else, with a message fit to show as it is.

CREATE FUNCTION public.dispatch_order(
  p_order_id bigint,
  p_tracking_number text,
  p_picks jsonb,
  p_allow_shared_tracking boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice  text;
  v_status   public.order_status;
  v_tracking text;
  v_other    text;
  v_problem  text;
  v_stock    text;
  v_lines    jsonb;
  v_needs    jsonb;
  rec        record;
BEGIN
  -- Locked first: two people dispatching the same order must not both pass the
  -- status check below and deduct its stock twice.
  SELECT invoice_number, status INTO v_invoice, v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_status <> 'labelled' THEN
    RAISE EXCEPTION 'Order % is no longer waiting for dispatch (it is %).', v_invoice, v_status;
  END IF;

  -- Normalised here, not only by the orders trigger, so the duplicate check
  -- compares like with like: a raw GS1-128 scan never equals a stored article
  -- id (CLAUDE.md rule 20).
  v_tracking := public.normalize_tracking_number(nullif(btrim(p_tracking_number), ''));
  IF v_tracking IS NULL THEN
    RAISE EXCEPTION 'Enter a tracking number.';
  END IF;

  IF NOT p_allow_shared_tracking THEN
    SELECT string_agg(invoice_number, ', ' ORDER BY invoice_number) INTO v_other
    FROM public.orders
    WHERE tracking_number = v_tracking
      AND id <> p_order_id;

    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'Tracking number % is already on order %.', v_tracking, v_other
        USING ERRCODE = 'GO001', HINT = v_other;
    END IF;
  END IF;

  -- The order's items against the pick list, read once into a variable: every
  -- check below and the deduction work from the same rows. A variable rather
  -- than a temp table, which would collide on a second call in one transaction.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'order_item_id', i.id,
           'product_id',    i.product_id,
           'sku_snapshot',  i.sku_snapshot,
           'quantity',      i.quantity,
           'location_id',   p.location_id,
           'pick_count',    coalesce(p.pick_count, 0)
         )), '[]'::jsonb)
  INTO v_lines
  FROM public.order_items i
  JOIN public.order_transactions t ON t.id = i.transaction_id
  LEFT JOIN (
    SELECT
      (e->>'order_item_id')::bigint    AS order_item_id,
      min((e->>'location_id')::bigint) AS location_id,
      count(*)                         AS pick_count
    FROM jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) AS e
    GROUP BY 1
  ) p ON p.order_item_id = i.id
  WHERE t.order_id = p_order_id;

  -- An item with no product cannot come off any shelf. The fix is on the order
  -- page (or a SKU on the platform listing), not here.
  SELECT string_agg(coalesce(l.sku_snapshot, '(no SKU)'), ', ' ORDER BY l.sku_snapshot)
  INTO v_problem
  FROM jsonb_to_recordset(v_lines) AS l(sku_snapshot text, product_id bigint)
  WHERE l.product_id IS NULL;

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Unresolved SKU on this order: %. Fix it on the order page first.', v_problem;
  END IF;

  IF EXISTS (
       SELECT 1
       FROM jsonb_to_recordset(v_lines) AS l(location_id bigint, pick_count integer)
       WHERE l.location_id IS NULL OR l.pick_count <> 1
     )
     OR (
       SELECT count(DISTINCT (e->>'order_item_id')::bigint)
       FROM jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) AS e
     ) <> jsonb_array_length(v_lines)
  THEN
    RAISE EXCEPTION 'The items on this order changed since the page was loaded. Reload and try again.';
  END IF;

  -- What leaves each shelf, one row per product and location: two lines of the
  -- same product from the same place are one deduction.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'location_id', location_id, 'qty', qty
         )), '[]'::jsonb)
  INTO v_needs
  FROM (
    SELECT l.product_id, l.location_id, sum(l.quantity)::integer AS qty
    FROM jsonb_to_recordset(v_lines) AS l(product_id bigint, location_id bigint, quantity integer)
    GROUP BY l.product_id, l.location_id
  ) s;

  -- Lock the stock rows in a fixed order before reading them. The check and the
  -- deduction then see the same balances, and two dispatches touching the same
  -- products cannot deadlock by locking them in opposite orders.
  PERFORM 1
  FROM public.inventory_levels il
  JOIN jsonb_to_recordset(v_needs) AS s(product_id bigint, location_id bigint, qty integer)
    ON s.product_id = il.product_id AND s.location_id = il.location_id
  ORDER BY il.id
  FOR UPDATE OF il;

  -- Every shortage at once, so one fix-up covers them all. Without this the
  -- first one would surface as a bare CHECK violation from
  -- record_stock_movement.
  SELECT string_agg(
           format('%s at %s needs %s, has %s',
                  pr.sku, coalesce(lo.name, '#' || s.location_id), s.qty, coalesce(il.qty, 0)),
           '; ' ORDER BY pr.sku)
  INTO v_problem
  FROM jsonb_to_recordset(v_needs) AS s(product_id bigint, location_id bigint, qty integer)
  JOIN public.products pr ON pr.id = s.product_id
  LEFT JOIN public.locations lo ON lo.id = s.location_id
  LEFT JOIN public.inventory_levels il
    ON il.product_id = s.product_id AND il.location_id = s.location_id
  WHERE coalesce(il.qty, 0) < s.qty;

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Not enough stock: %.', v_problem
      USING ERRCODE = 'GO002';
  END IF;

  FOR rec IN
    SELECT s.product_id, s.location_id, s.qty, pr.sku, lo.name AS location_name
    FROM jsonb_to_recordset(v_needs) AS s(product_id bigint, location_id bigint, qty integer)
    JOIN public.products pr ON pr.id = s.product_id
    JOIN public.locations lo ON lo.id = s.location_id
    ORDER BY pr.sku
  LOOP
    PERFORM public.record_stock_movement(
      rec.product_id, rec.location_id, 'dispatch', -rec.qty,
      'Order ' || v_invoice, NULL
    );
    v_stock := concat_ws(', ', v_stock,
                         format('%s x%s from %s', rec.sku, rec.qty, rec.location_name));
  END LOOP;

  -- Where each line was picked from, as the 28,893 migrated rows record it.
  UPDATE public.order_items i
  SET location_id = d.location_id
  FROM jsonb_to_recordset(v_lines) AS d(order_item_id bigint, location_id bigint)
  WHERE i.id = d.order_item_id
    AND i.location_id IS DISTINCT FROM d.location_id;

  -- `completed` is what every dispatched Laravel order holds, with
  -- posted_on_date as the day it went out.
  UPDATE public.orders
  SET status = 'completed',
      tracking_number = v_tracking,
      posted_on_date = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_logs (order_id, action, user_id)
  VALUES (
    p_order_id,
    format('Dispatched with tracking number %s. %s',
           v_tracking,
           CASE WHEN v_stock IS NULL
                THEN 'No stock deducted (the order has no items).'
                ELSE 'Stock out: ' || v_stock || '.'
           END),
    auth.uid()
  );

  RETURN v_tracking;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_order(bigint, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_order(bigint, text, jsonb, boolean) TO authenticated;

COMMIT;
