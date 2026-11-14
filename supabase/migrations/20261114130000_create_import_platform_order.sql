-- eBay order import (docs/ebay-order-import.md), sharing the per-order write
-- path with the Shopify import.
--
-- import_shopify_order (20261111100000) already does everything an imported
-- order needs: duplicate check, customer match or create, merge into the
-- customer's pending order, invoice number, lines and log, in one transaction.
-- Its body moves into import_platform_order, parameterised by platform, and
-- import_shopify_order becomes a thin wrapper that renames its payload keys --
-- so the Shopify task, its payload and its behaviour are unchanged, and eBay
-- gets the same rules from the same code rather than a copy that drifts.
--
-- What differs by platform is only data:
--   * duplicate check and merge target are both restricted to orders of the
--     same platform. order_id_ebay holds the Shopify order id on Shopify lines
--     and the eBay order id on eBay lines, and an eBay order is never merged
--     into a Shopify one (user decision, 2026-11-14) -- a Shopify line inside
--     an eBay order would also be invisible to the Shopify duplicate check and
--     be imported again on the next run;
--   * web_order_id: the Shopify order id for Shopify, NULL for eBay (all
--     178k legacy eBay orders have it NULL);
--   * item_number: the eBay listing id, absent for Shopify.
--
-- Also here:
--   * the ebay_import_test_order debug switch (src/lib/debug/settings.ts);
--   * ebay_authorization_status(), so /orders can warn before the seller's
--     refresh token runs out without being able to read the token itself.

BEGIN;

-- ---------------------------------------------------------------------------
-- import_platform_order
-- ---------------------------------------------------------------------------
--
-- p_order:
--   {
--     "platform_order_id": "17-15414-28640" | "7930453721225",
--     "order_ref":   "326100" | "#G2B24707",  -- sales_record_number
--     "web_order_id": null | "7930453721225",
--     "created_at": "...", "paid_at": "..." | null,
--     "note": "..." | null,
--     "postage": 10.98, "discount": 0,
--     "customer": { full_name, email, phone, company_name, address_line1,
--                   address_line2, city, state, postcode, country },
--     "lines": [{ line_id, item_number, sku, title, quantity, unit_price,
--                 postage_service }]
--   }
--
-- Returns { "result": "imported" | "merged" | "skipped", "order_id",
--           "invoice_number" }.
CREATE OR REPLACE FUNCTION public.import_platform_order(
  p_platform public.sales_platform,
  p_order jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_label       text := CASE p_platform
                          WHEN 'shopify' THEN 'Shopify'
                          WHEN 'ebay' THEN 'eBay'
                        END;
  v_platform_id text := btrim(p_order->>'platform_order_id');
  v_ref         text := btrim(p_order->>'order_ref');
  v_web_id      text := nullif(btrim(p_order->>'web_order_id'), '');
  v_cust        jsonb := p_order->'customer';
  v_full_name   text := nullif(btrim(v_cust->>'full_name'), '');
  v_line1       text := nullif(btrim(v_cust->>'address_line1'), '');
  v_postcode    text := nullif(btrim(v_cust->>'postcode'), '');
  v_postage     numeric := coalesce((p_order->>'postage')::numeric, 0);
  v_discount    numeric := coalesce((p_order->>'discount')::numeric, 0);
  v_note        text := nullif(btrim(p_order->>'note'), '');
  v_created     timestamptz := (p_order->>'created_at')::timestamptz;
  v_paid        timestamptz := coalesce((p_order->>'paid_at')::timestamptz, (p_order->>'created_at')::timestamptz);
  v_customer_id bigint;
  v_order_id    bigint;
  v_invoice     text;
  v_result      text;
BEGIN
  -- Only the two platforms with an import. backorder / store orders are made
  -- in go2office and have no platform id to deduplicate on.
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'No import for platform %', p_platform;
  END IF;
  IF v_platform_id IS NULL OR v_platform_id = '' THEN
    RAISE EXCEPTION '% order has no id', v_label;
  END IF;
  IF jsonb_array_length(coalesce(p_order->'lines', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION '% order % has no lines', v_label, v_ref;
  END IF;

  -- Two runs cannot both pass the duplicate check for the same order. The task
  -- is concurrency-limited to 1 as well, but that is a property of how it is
  -- deployed, and this is a property of the data. The key is the one
  -- import_shopify_order has always used ('shopify-order:<id>').
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_platform::text || '-order:' || v_platform_id, 0)
  );

  -- Already here, whether imported by this function or by Laravel before the
  -- cutover. Restricted to the platform because order_id_ebay holds a
  -- different platform's id on the other orders.
  IF EXISTS (
    SELECT 1
      FROM public.order_transactions t
      JOIN public.orders o ON o.id = t.order_id
     WHERE t.order_id_ebay = v_platform_id
       AND o.platform = p_platform
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
  -- 0800 must match a zip of 800 and the other way round.
  --
  -- Customers are shared across platforms: an eBay buyer who also orders on
  -- Shopify is one customer row with orders on both.
  IF v_full_name IS NOT NULL AND v_line1 IS NOT NULL AND v_postcode IS NOT NULL THEN
    SELECT c.id INTO v_customer_id
      FROM public.customers c
     WHERE lower(btrim(c.full_name)) = lower(v_full_name)
       AND lower(btrim(c.address_line1)) = lower(v_line1)
       AND lpad(btrim(c.postcode), 4, '0') = lpad(v_postcode, 4, '0')
     ORDER BY c.id DESC
     LIMIT 1;
  END IF;

  -- Merge target: that customer's open order on the same platform still in
  -- allocation. Not processing or labelled -- those have been approved against
  -- a quote for the box as it was, and changing the contents now would ship
  -- the wrong postage. Not another platform's order (header comment).
  IF v_customer_id IS NOT NULL THEN
    SELECT o.id, o.invoice_number INTO v_order_id, v_invoice
      FROM public.orders o
     WHERE o.customer_id = v_customer_id
       AND o.status = 'pending'
       AND o.platform = p_platform
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
      v_order_id, v_customer_id, v_invoice, 'pending', p_platform,
      v_postage, v_discount, v_web_id, v_note
    );

    v_result := 'imported';
  END IF;

  -- One statement for every line. order_transactions_rebuild_items_insert is a
  -- row trigger and resolves each line's SKU to picked items as it lands.
  INSERT INTO public.order_transactions (
    order_id, item_title, item_number, custom_label, quantity, sale_price,
    sale_date, paid_on_date, postage_service,
    sales_record_number, order_id_ebay, transaction_id_ebay
  )
  SELECT
    v_order_id,
    l.title,
    nullif(btrim(l.item_number), ''),
    nullif(btrim(l.sku), ''),
    l.quantity,
    l.unit_price,
    v_created,
    v_paid,
    l.postage_service,
    v_ref,
    v_platform_id,
    l.line_id
  FROM jsonb_to_recordset(p_order->'lines') AS l(
    line_id text, item_number text, sku text, title text, quantity integer,
    unit_price numeric, postage_service text
  );

  INSERT INTO public.order_logs (order_id, action, user_id)
  VALUES (
    v_order_id,
    CASE v_result
      WHEN 'merged' THEN
        'Merged ' || v_label || ' order ' || v_ref || ' (' || v_platform_id || '). Address check and postage quotes were reset.'
      ELSE
        'Imported from ' || v_label || ' order ' || v_ref || ' (' || v_platform_id || ').'
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

COMMENT ON FUNCTION public.import_platform_order(public.sales_platform, jsonb, uuid) IS
  'Imports one Shopify or eBay order atomically: duplicate check, customer match or create, merge into the customer''s pending order on the same platform or create a new one, lines and log. Called by the import-shopify-orders (via import_shopify_order) and import-ebay-orders Trigger.dev tasks with the service role.';

-- Same reasoning as import_shopify_order: only the background tasks call this,
-- with the service role. Revoked from the client roles directly, because
-- Supabase's default ACL grants them EXECUTE and REVOKE ... FROM PUBLIC does
-- not touch that (docs/order-metrics.md section 8).
REVOKE EXECUTE ON FUNCTION public.import_platform_order(public.sales_platform, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- import_shopify_order: now a wrapper
-- ---------------------------------------------------------------------------
--
-- Same signature and payload as before (ShopifyImportPayload in
-- src/lib/shopify/order-mapper.ts). The Shopify order id is both the platform
-- id and web_order_id; the order name is the reference; processed_at is the
-- paid date.
CREATE OR REPLACE FUNCTION public.import_shopify_order(
  p_order jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.import_platform_order(
    'shopify',
    (p_order - 'shopify_order_id' - 'name' - 'processed_at')
      || jsonb_build_object(
           'platform_order_id', p_order->'shopify_order_id',
           'order_ref',         p_order->'name',
           'web_order_id',      p_order->'shopify_order_id',
           'paid_at',           p_order->'processed_at',
           'lines', (
             SELECT coalesce(jsonb_agg(l || jsonb_build_object('item_number', NULL)), '[]'::jsonb)
               FROM jsonb_array_elements(coalesce(p_order->'lines', '[]'::jsonb)) AS l
           )
         ),
    p_user_id
  );
$$;

COMMENT ON FUNCTION public.import_shopify_order(jsonb, uuid) IS
  'Imports one Shopify order. Wrapper over import_platform_order(''shopify'', ...), kept so the Shopify payload is unchanged. Called by the import-shopify-orders Trigger.dev task with the service role.';

-- CREATE OR REPLACE keeps the existing ACL, but say it again: a wrapper that
-- the client roles could call would reach the import through it.
REVOKE EXECUTE ON FUNCTION public.import_shopify_order(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ebay_authorization_status
-- ---------------------------------------------------------------------------
--
-- ebay_accounts has RLS with no policies (20261114120000): the refresh token is
-- a credential and nothing on a page may read it. The /orders page still needs
-- to warn when that token is about to run out, so this hands out exactly the
-- two harmless columns. SECURITY DEFINER is what lets it past RLS; the column
-- list is the whole of what it exposes.
CREATE OR REPLACE FUNCTION public.ebay_authorization_status()
RETURNS TABLE (username text, refresh_token_expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.username, a.refresh_token_expires_at
    FROM public.ebay_accounts a
   ORDER BY a.refresh_token_expires_at;
$$;

COMMENT ON FUNCTION public.ebay_authorization_status() IS
  'Username and refresh-token expiry of each authorised eBay seller account, without the token. For the expiry warning beside Import from eBay.';

REVOKE EXECUTE ON FUNCTION public.ebay_authorization_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ebay_authorization_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- Debug switch
-- ---------------------------------------------------------------------------

INSERT INTO public.debug_settings (key, value, enabled, description)
VALUES (
  'ebay_import_test_order',
  '',
  false,
  'Import from eBay pulls only this order instead of every unshipped one. Takes the eBay order number (17-15414-28640). Shipped orders can be fetched this way; orders with a cancellation are still skipped, and an order already in go2office is still skipped as a duplicate.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
