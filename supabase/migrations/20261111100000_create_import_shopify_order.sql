BEGIN;

-- Shopify order import (docs/shopify-order-import.md).
--
-- Ported from xpros' import-shopify-orders task, with the per-order work moved
-- into one SQL function. xpros does it as a chain of independent requests --
-- insert the order, set its invoice number, insert each line, write each log --
-- so a failure halfway leaves an order with no lines. Its duplicate check looks
-- at the lines, so the next run does not see that order and creates a second
-- one. Here an order either lands whole or not at all.

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The duplicate check. order_id_ebay holds the Shopify numeric order id on
-- every Shopify line (the legacy data and this import agree), and it had no
-- index: each imported order would have been a seq scan over 250k lines.
CREATE INDEX order_transactions_order_id_ebay_idx
  ON public.order_transactions (order_id_ebay);

-- The customer match compares names case- and space-insensitively, which the
-- existing customers_full_name_idx (on the raw column) cannot serve.
CREATE INDEX customers_full_name_lower_idx
  ON public.customers (lower(btrim(full_name)));

-- ---------------------------------------------------------------------------
-- import_shopify_order
-- ---------------------------------------------------------------------------
--
-- p_order is built by src/lib/shopify/order-mapper.ts:
--   {
--     "shopify_order_id": "7930453721225",   -- legacyResourceId
--     "name": "#G2B24707",
--     "created_at": "...", "processed_at": "...",
--     "note": "..." | null,
--     "postage": 10.98, "discount": 0,
--     "customer": { full_name, email, phone, company_name, address_line1,
--                   address_line2, city, state, postcode, country },
--     "lines": [{ line_id, sku, title, quantity, unit_price, postage_service }]
--   }
--
-- Returns { "result": "imported" | "merged" | "skipped", "order_id",
--           "invoice_number" }.
CREATE OR REPLACE FUNCTION public.import_shopify_order(
  p_order jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shopify_id  text := btrim(p_order->>'shopify_order_id');
  v_name        text := btrim(p_order->>'name');
  v_cust        jsonb := p_order->'customer';
  v_full_name   text := nullif(btrim(v_cust->>'full_name'), '');
  v_line1       text := nullif(btrim(v_cust->>'address_line1'), '');
  v_postcode    text := nullif(btrim(v_cust->>'postcode'), '');
  v_postage     numeric := coalesce((p_order->>'postage')::numeric, 0);
  v_discount    numeric := coalesce((p_order->>'discount')::numeric, 0);
  v_note        text := nullif(btrim(p_order->>'note'), '');
  v_customer_id bigint;
  v_order_id    bigint;
  v_invoice     text;
  v_result      text;
BEGIN
  IF v_shopify_id IS NULL OR v_shopify_id = '' THEN
    RAISE EXCEPTION 'Shopify order has no id';
  END IF;
  IF jsonb_array_length(coalesce(p_order->'lines', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Shopify order % has no lines', v_name;
  END IF;

  -- Two runs cannot both pass the duplicate check for the same order. The task
  -- is concurrency-limited to 1 as well, but that is a property of how it is
  -- deployed, and this is a property of the data.
  PERFORM pg_advisory_xact_lock(hashtextextended('shopify-order:' || v_shopify_id, 0));

  -- Already here, whether imported by this function or by Laravel before the
  -- cutover. Restricted to Shopify orders because order_id_ebay is also the
  -- eBay order id on the other 182k orders.
  IF EXISTS (
    SELECT 1
      FROM public.order_transactions t
      JOIN public.orders o ON o.id = t.order_id
     WHERE t.order_id_ebay = v_shopify_id
       AND o.platform = 'shopify'
  ) THEN
    RETURN jsonb_build_object('result', 'skipped');
  END IF;

  -- Same customer = same name, same first address line, same postcode. A
  -- customer row holds one address (their current one), so matching on it is
  -- also what "same shipping address" means. Blank name or street never
  -- matches: two anonymous orders are not evidence of one person.
  --
  -- The postcode comparison pads to four digits on both sides, the same rule as
  -- standardize_customer_address (CLAUDE.md rule 21) -- a customer stored as
  -- 0800 must match a Shopify zip of 800 and the other way round.
  IF v_full_name IS NOT NULL AND v_line1 IS NOT NULL AND v_postcode IS NOT NULL THEN
    SELECT c.id INTO v_customer_id
      FROM public.customers c
     WHERE lower(btrim(c.full_name)) = lower(v_full_name)
       AND lower(btrim(c.address_line1)) = lower(v_line1)
       AND lpad(btrim(c.postcode), 4, '0') = lpad(v_postcode, 4, '0')
     ORDER BY c.id DESC
     LIMIT 1;
  END IF;

  -- Merge target: that customer's open Shopify order still in allocation. Not
  -- processing or labelled -- those have been approved against a quote for the
  -- box as it was, and changing the contents now would ship the wrong postage.
  IF v_customer_id IS NOT NULL THEN
    SELECT o.id, o.invoice_number INTO v_order_id, v_invoice
      FROM public.orders o
     WHERE o.customer_id = v_customer_id
       AND o.status = 'pending'
       AND o.platform = 'shopify'
     ORDER BY o.id DESC
     LIMIT 1
     FOR UPDATE;
  END IF;

  IF v_customer_id IS NULL THEN
    -- state and country are rewritten by customers_standardize_address on the
    -- way in; what is passed here is only the fallback for an unresolvable
    -- address.
    INSERT INTO public.customers (
      full_name, email, phone, company_name,
      address_line1, address_line2, city, state, postcode, country
    )
    VALUES (
      v_full_name,
      nullif(btrim(v_cust->>'email'), ''),
      nullif(btrim(v_cust->>'phone'), ''),
      nullif(btrim(v_cust->>'company_name'), ''),
      v_line1,
      nullif(btrim(v_cust->>'address_line2'), ''),
      nullif(btrim(v_cust->>'city'), ''),
      nullif(btrim(v_cust->>'state'), ''),
      v_postcode,
      nullif(btrim(v_cust->>'country'), '')
    )
    RETURNING id INTO v_customer_id;
  END IF;

  IF v_order_id IS NOT NULL THEN
    -- Merged. The box has changed, so whatever allocation decided about it no
    -- longer holds: back to the start of the Address queue, and the quotes for
    -- the old contents go (user decision, 2026-11-11). order_metrics_summary
    -- follows on its own through the oms_* triggers.
    UPDATE public.orders
       SET postage_and_handling = postage_and_handling + v_postage,
           discount             = discount + v_discount,
           address_verified_at  = NULL,
           address_verified_by  = NULL,
           comments = CASE
             WHEN v_note IS NULL THEN comments
             WHEN comments IS NULL OR comments = '' THEN v_note
             ELSE comments || E'\n' || v_note
           END
     WHERE id = v_order_id;

    DELETE FROM public.order_shipping_quotes WHERE order_id = v_order_id;

    v_result := 'merged';
  ELSE
    -- The id is drawn first because the invoice number is derived from it, and
    -- the column is NOT NULL: no placeholder insert-then-update.
    v_order_id := nextval(pg_get_serial_sequence('public.orders', 'id'));

    -- Two-digit year + the id as six upper-case hex digits: 205969 -> 26032491.
    -- This is the Laravel rule, checked against ids from 2018 to 2026. NOT
    -- xpros' generateInvoiceNumber, which writes the id in decimal.
    v_invoice := to_char(now() AT TIME ZONE 'Australia/Sydney', 'YY')
              || lpad(upper(to_hex(v_order_id)), 6, '0');

    INSERT INTO public.orders (
      id, customer_id, invoice_number, status, platform,
      postage_and_handling, discount, web_order_id, comments
    )
    VALUES (
      v_order_id, v_customer_id, v_invoice, 'pending', 'shopify',
      v_postage, v_discount, v_shopify_id, v_note
    );

    v_result := 'imported';
  END IF;

  -- One statement for every line. order_transactions_rebuild_items_insert is a
  -- row trigger and resolves each line's SKU to picked items as it lands.
  INSERT INTO public.order_transactions (
    order_id, item_title, custom_label, quantity, sale_price,
    sale_date, paid_on_date, postage_service,
    sales_record_number, order_id_ebay, transaction_id_ebay
  )
  SELECT
    v_order_id,
    l.title,
    nullif(btrim(l.sku), ''),
    l.quantity,
    l.unit_price,
    (p_order->>'created_at')::timestamptz,
    coalesce((p_order->>'processed_at')::timestamptz, (p_order->>'created_at')::timestamptz),
    l.postage_service,
    v_name,
    v_shopify_id,
    l.line_id
  FROM jsonb_to_recordset(p_order->'lines') AS l(
    line_id text, sku text, title text, quantity integer,
    unit_price numeric, postage_service text
  );

  INSERT INTO public.order_logs (order_id, action, user_id)
  VALUES (
    v_order_id,
    CASE v_result
      WHEN 'merged' THEN
        'Merged Shopify order ' || v_name || ' (' || v_shopify_id || '). Address check and postage quotes were reset.'
      ELSE
        'Imported from Shopify order ' || v_name || ' (' || v_shopify_id || ').'
    END,
    p_user_id
  );

  RETURN jsonb_build_object(
    'result', v_result,
    'order_id', v_order_id,
    'invoice_number', v_invoice
  );
END;
$$;

COMMENT ON FUNCTION public.import_shopify_order(jsonb, uuid) IS
  'Imports one Shopify order atomically: duplicate check, customer match or create, merge into the customer''s pending Shopify order or create a new one, lines and log. Called by the import-shopify-orders Trigger.dev task with the service role.';

-- Only the background task calls this, with the service role. Revoked from the
-- two client roles directly: Supabase grants EXECUTE to anon and authenticated
-- by default ACL, which REVOKE ... FROM PUBLIC does not touch
-- (docs/order-metrics.md section 8). SECURITY INVOKER keeps RLS in force for
-- anyone who still reaches it.
REVOKE EXECUTE ON FUNCTION public.import_shopify_order(jsonb, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
