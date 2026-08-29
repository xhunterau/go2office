BEGIN;

-- Order Allocation, stage 1 of 2: has this order's delivery address been
-- confirmed good enough to quote against?
--
-- xpros tracks the whole allocation walk in a `pending_status` enum
-- (Backorder / Backorder_Pass / Address / Address_Pass / Postage / Unapprove).
-- go2office does not do the backorder stage (user decision), which leaves two
-- stages and therefore one bit of state. A timestamp carries that bit and says
-- when, and the enum's other five values would all be dead labels.
--
--   Address queue  = status 'pending' AND address_verified_at IS NULL
--   Postage queue  = status 'pending' AND address_verified_at IS NOT NULL
--   Approve        = status -> 'processing' (the /fulfillment/export-labels queue)
--
-- Nullable with no default: every existing order is unverified, which is the
-- honest reading. The 203k historical orders are all completed or cancelled and
-- never enter the queue, which filters on `pending`.
ALTER TABLE public.orders
  ADD COLUMN address_verified_at timestamptz,
  -- ON DELETE SET NULL rather than RESTRICT: losing who confirmed it must not
  -- make the order unfixable, and the order_logs row keeps the audit trail.
  ADD COLUMN address_verified_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.address_verified_at IS
  'Order Allocation stage marker. NULL on a pending order means it is waiting in the Address queue; set means it has moved to the Postage queue. Written by verify_pending_order_addresses() in bulk, or by the operator passing a card by hand.';

-- No index. `pending` is a single-digit slice of a 203k-row table and
-- orders_status_idx already carries it; a second index on a column that is NULL
-- for 99.9% of rows would be read once a day at most.

-- ---------------------------------------------------------------------------
-- Batch address check
-- ---------------------------------------------------------------------------
--
-- xpros runs this as a Trigger.dev task looping order by order, because it
-- queries the postcode reference once per order. That per-row shape is the same
-- mistake CLAUDE.md rule 21 documents for the 004 import: the work is a join,
-- so it belongs in one statement. This is that statement.
--
-- SECURITY INVOKER on purpose: it must run as the signed-in user so RLS still
-- applies and auth.uid() names a real actor for both the column and the
-- order_logs row (whose INSERT policy requires user_id = auth.uid()).
CREATE OR REPLACE FUNCTION public.verify_pending_order_addresses()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ids   bigint[];
BEGIN
  WITH updated AS (
    UPDATE public.orders o
       SET address_verified_at = now(),
           address_verified_by = v_actor
     WHERE o.status = 'pending'
       AND o.address_verified_at IS NULL
       AND EXISTS (
         SELECT 1
           FROM public.customers c
           JOIN public.postcodes p
             -- These two comparisons must stay character-for-character the same
             -- as standardize_customer_address (migration 20260809130000,
             -- CLAUDE.md rule 21) and as resolveZone in
             -- src/lib/shipping/adapters/zone-resolver.ts. All three ask the
             -- same question -- does this (postcode, suburb) pair exist -- and
             -- an order that answers yes here but no in the zone resolver is
             -- exactly the failure the Address stage exists to prevent.
             --
             -- NOT LTRIM(postcode, '0'), which is what xpros does. Its own
             -- reference table lost the leading zeros (DARWIN stored as '800');
             -- ours has a CHECK forcing four digits, so stripping them would
             -- leave every 08xx NT address permanently unmatched -- silently,
             -- and only for the Northern Territory.
             --
             -- Equality, not ILIKE: xpros compares `locality ILIKE city`, where
             -- the right-hand side is a pattern, so a `%` in a suburb name
             -- matches somebody else's suburb. Equality is also the only form
             -- that uses the index.
             ON p.postcode = lpad(btrim(c.postcode), 4, '0')
            AND p.locality = upper(btrim(c.city))
          WHERE c.id = o.customer_id
            -- Non-AU orders are out of scope for allocation entirely (user
            -- decision): the postcode reference is Australian, and the enum
            -- value xpros routes them to (Eparcel_Intl_Express) was dropped in
            -- migration 20260823110000 because there is no international
            -- contract. 17 customers in the whole database.
            AND c.country = 'AU'
       )
    RETURNING o.id
  )
  SELECT array_agg(id) INTO v_ids FROM updated;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.order_logs (order_id, action, user_id)
  SELECT id,
         'Allocation: address verified against the postcode reference.',
         v_actor
    FROM unnest(v_ids) AS id;

  RETURN array_length(v_ids, 1);
END;
$$;

COMMENT ON FUNCTION public.verify_pending_order_addresses() IS
  'Marks every pending AU order whose (postcode, suburb) resolves in public.postcodes as address-verified, in one statement, and logs each one. Returns the number of orders moved.';

-- No GRANT. Supabase's default ACL already gives `authenticated` EXECUTE on
-- new functions in public, and per CLAUDE.md rule 22 a GRANT here would restate
-- a fact rather than establish one. The gate is the RLS on orders and
-- order_logs, which SECURITY INVOKER leaves in force.

COMMIT;
