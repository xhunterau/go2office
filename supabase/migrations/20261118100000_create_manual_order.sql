-- Manual order creation (docs/manual-order-create.md).
--
-- go2buy has no shop counter or phone orders, but some orders still start
-- outside Shopify and eBay. This adds the one write that path needs; every step
-- after it (lines, Allocation, labels, dispatch) is the existing code.
--
--   * format_invoice_number(): the Laravel invoice rule, moved out of
--     import_platform_order so a manual order and an imported one cannot be
--     numbered by two copies of the formula that drift apart.
--   * import_platform_order(): recreated from its live definition with that one
--     assignment replaced by a call. Nothing else in it changes. CREATE OR
--     REPLACE keeps its grants (EXECUTE revoked from the client roles).
--   * create_manual_order(): a pending `store` order and its log line in one
--     transaction. `store` is what every historical hand-made order and every
--     follow-up order carries (570 rows), so no enum change.

BEGIN;

-- ---------------------------------------------------------------------------
-- format_invoice_number
-- ---------------------------------------------------------------------------
--
-- Two-digit year (Sydney time, at the moment of numbering) + the order id as
-- six upper-case hex digits: 205969 -> 26032491. This is the Laravel rule,
-- checked against ids from 2018 to 2026. NOT xpros' generateInvoiceNumber,
-- which writes the id in decimal.
--
-- STABLE, not IMMUTABLE: it reads now().
CREATE OR REPLACE FUNCTION public.format_invoice_number(p_order_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(now() AT TIME ZONE 'Australia/Sydney', 'YY')
      || lpad(upper(to_hex(p_order_id)), 6, '0');
$$;

COMMENT ON FUNCTION public.format_invoice_number(bigint) IS
  'Laravel invoice number for an order id: YY (Sydney) + id as 6 upper-case hex digits. Used by import_platform_order and create_manual_order.';

REVOKE EXECUTE ON FUNCTION public.format_invoice_number(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.format_invoice_number(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_platform_order: now calls format_invoice_number
-- ---------------------------------------------------------------------------
--
-- Body taken from pg_get_functiondef on the remote database (2026-11-18), i.e.
-- what 20261114130000 created, with only the invoice assignment changed.
CREATE OR REPLACE FUNCTION public.import_platform_order(p_platform sales_platform, p_order jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

    -- The Laravel rule, shared with create_manual_order: format_invoice_number.
    v_invoice := public.format_invoice_number(v_order_id);

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
$function$;

-- ---------------------------------------------------------------------------
-- create_manual_order
-- ---------------------------------------------------------------------------
--
-- Creates an empty pending `store` order for an existing customer and logs
-- who made it. Lines are added afterwards on the order page with the existing
-- Add line dialog; Allocation refuses to approve an order that still has none
-- (src/lib/actions/allocation.ts), so an abandoned empty order cannot reach a
-- label.
--
-- SECURITY INVOKER: the caller's RLS applies, and auth.uid() is what satisfies
-- order_logs' WITH CHECK (user_id = auth.uid()) -- as DEFINER the log line
-- would lose its author (CLAUDE.md rule 25, same reasoning).
--
-- The id is drawn first because the invoice number is derived from it and the
-- column is NOT NULL: no placeholder insert-then-update (xpros' way).
--
-- Raises:
--   GO003  the customer does not exist.
--   22023  negative postage.
CREATE OR REPLACE FUNCTION public.create_manual_order(
  p_customer_id bigint,
  p_postage numeric DEFAULT 0,
  p_discount numeric DEFAULT 0,
  p_comments text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_id bigint;
  v_invoice  text;
BEGIN
  -- discount has a CHECK (orders_discount_non_negative); postage_and_handling
  -- has none, and the 20k migrated rows were never audited for one. The Server
  -- Action validates both with zod; this keeps a direct RPC call honest too.
  IF coalesce(p_postage, 0) < 0 THEN
    RAISE EXCEPTION 'Postage cannot be negative' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Customer % was not found', p_customer_id
      USING ERRCODE = 'GO003';
  END IF;

  v_order_id := nextval(pg_get_serial_sequence('public.orders', 'id'));
  v_invoice := public.format_invoice_number(v_order_id);

  INSERT INTO public.orders (
    id, customer_id, invoice_number, status, platform,
    postage_and_handling, discount, comments
  )
  VALUES (
    v_order_id, p_customer_id, v_invoice, 'pending', 'store',
    coalesce(p_postage, 0), coalesce(p_discount, 0),
    nullif(btrim(p_comments), '')
  );

  INSERT INTO public.order_logs (order_id, action, user_id)
  VALUES (v_order_id, 'Created manually', auth.uid());

  RETURN jsonb_build_object('order_id', v_order_id, 'invoice_number', v_invoice);
END;
$$;

COMMENT ON FUNCTION public.create_manual_order(bigint, numeric, numeric, text) IS
  'Creates an empty pending store order for a customer, with its log line, in one transaction. Called by the createManualOrder Server Action (docs/manual-order-create.md).';

REVOKE EXECUTE ON FUNCTION public.create_manual_order(bigint, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_order(bigint, numeric, numeric, text) TO authenticated;

COMMIT;
