BEGIN;

-- Tracking number write-back to Shopify and eBay: the to-do table, and
-- dispatch_order() writing to it. See docs/order-dispatch.md section 5.
--
-- One row per go2office order x platform order. dispatch_order() inserts it in
-- the same transaction as the dispatch (CLAUDE.md rule 26); the Trigger.dev
-- task push-platform-fulfillment does the push under the service role and
-- records the outcome here.

CREATE TYPE public.platform_sync_status AS ENUM ('pending', 'succeeded', 'failed', 'skipped');

CREATE TABLE public.platform_fulfillment_syncs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  -- Only the two platforms there is anything to write back to.
  platform public.sales_platform NOT NULL CHECK (platform IN ('shopify', 'ebay')),
  -- order_transactions.order_id_ebay: the eBay order number, or Shopify's
  -- legacyResourceId.
  platform_order_id text NOT NULL CHECK (platform_order_id = btrim(platform_order_id) AND platform_order_id <> ''),
  status public.platform_sync_status NOT NULL DEFAULT 'pending',
  -- The number the platform now holds, set on success. NULL with status
  -- succeeded means "marked shipped with no tracking number" (a letter).
  tracking_number text,
  carrier text,
  platform_fulfillment_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, platform_order_id)
);

-- The sweep's and the dispatch page's question: what still needs pushing.
CREATE INDEX platform_fulfillment_syncs_open_idx
  ON public.platform_fulfillment_syncs (status, updated_at)
  WHERE status IN ('pending', 'failed');

CREATE TRIGGER platform_fulfillment_syncs_set_updated_at
  BEFORE UPDATE ON public.platform_fulfillment_syncs
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

ALTER TABLE public.platform_fulfillment_syncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON public.platform_fulfillment_syncs
  FOR SELECT
  TO authenticated
  USING (true);

-- dispatch_order() is SECURITY INVOKER, so its INSERT runs as the signed-in
-- user and needs a policy (CLAUDE.md rule 22 -- order_logs went two weeks
-- unwritable for want of one). Only a fresh to-do can be written this way; the
-- outcome columns belong to the task, which runs under the service role. No
-- UPDATE or DELETE policy: Retry triggers the task rather than editing rows.
CREATE POLICY "authenticated_insert_pending" ON public.platform_fulfillment_syncs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND attempts = 0
    AND tracking_number IS NULL
    AND platform_fulfillment_id IS NULL
    AND synced_at IS NULL
  );

CREATE OR REPLACE FUNCTION public.dispatch_order(
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
  v_platform public.sales_platform;
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
  SELECT invoice_number, status, platform INTO v_invoice, v_status, v_platform
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

  -- One write-back to-do per platform order behind this go2office order (a
  -- merged order carries several). Written here, in the dispatch transaction,
  -- so a dispatched order can never be missing its to-do; the push itself runs
  -- later in push-platform-fulfillment, so a slow or failing platform never
  -- holds up or rolls back the dispatch. store and backorder orders have no
  -- platform order to write to (user decision, 2026-11-16).
  -- DO NOTHING: an order sent back to labelled and dispatched again keeps its
  -- row; a changed number is pushed by the Retry on the order page.
  IF v_platform IN ('shopify', 'ebay') THEN
    INSERT INTO public.platform_fulfillment_syncs (order_id, platform, platform_order_id)
    SELECT DISTINCT p_order_id, v_platform, btrim(t.order_id_ebay)
    FROM public.order_transactions t
    WHERE t.order_id = p_order_id
      AND nullif(btrim(t.order_id_ebay), '') IS NOT NULL
    ON CONFLICT (order_id, platform_order_id) DO NOTHING;
  END IF;

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

COMMIT;
