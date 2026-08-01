BEGIN;

-- Fix: record_stock_movement could not apply a negative delta to an existing
-- stock row, so every dispatch failed.
--
-- The original body leaned on a single INSERT ... ON CONFLICT DO UPDATE to be
-- both "create the row" and "add to it atomically". That does not work here:
-- PostgreSQL validates CHECK constraints against the proposed insert tuple
-- BEFORE it detects the unique-index conflict, so a dispatch of -1 tripped
-- inventory_levels_qty_non_negative on the literal -1 in VALUES and never
-- reached the DO UPDATE arm. Receipts worked (positive values pass the CHECK),
-- which is why the bug survived until the first dispatch was attempted.
--
-- The fix updates first and only falls back to INSERT when no row exists. The
-- UPDATE keeps the atomic-increment property that matters for concurrency:
-- `qty = qty + delta` is re-evaluated against the latest committed row after
-- the row lock is taken, so simultaneous callers queue instead of clobbering
-- each other. Subtracting past zero still trips the CHECK on the updated row,
-- which is the intended over-dispatch guard.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_product_id bigint,
  p_location_id bigint,
  p_kind public.stock_movement_kind,
  p_qty_delta integer,
  p_note text DEFAULT NULL,
  p_counterpart_location_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_qty_after integer;
  v_movement_id bigint;
BEGIN
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'Movement quantity must not be zero'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Common path: the stock row already exists. Row-level lock makes this the
  -- serialisation point for concurrent movements on the same product/location.
  UPDATE public.inventory_levels
  SET qty = qty + p_qty_delta
  WHERE product_id = p_product_id AND location_id = p_location_id
  RETURNING qty INTO v_qty_after;

  IF NOT FOUND THEN
    -- Nothing on file for this product/location yet. Removing stock that was
    -- never there is a user error, and saying so beats letting the CHECK
    -- constraint produce a message about a constraint name.
    IF p_qty_delta < 0 THEN
      RAISE EXCEPTION 'No stock recorded at this location'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Positive delta, so the proposed row satisfies the CHECK. ON CONFLICT
    -- still covers the case where another session created the row between the
    -- UPDATE above and this INSERT.
    INSERT INTO public.inventory_levels AS il (product_id, location_id, qty)
    VALUES (p_product_id, p_location_id, p_qty_delta)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET qty = il.qty + p_qty_delta
    RETURNING il.qty INTO v_qty_after;
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, location_id, kind, qty_delta, qty_after, note,
    counterpart_location_id, created_by
  )
  VALUES (
    p_product_id, p_location_id, p_kind, p_qty_delta, v_qty_after, p_note,
    p_counterpart_location_id, auth.uid()
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

COMMIT;
