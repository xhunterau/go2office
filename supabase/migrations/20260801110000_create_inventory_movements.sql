BEGIN;

-- Append-only stock ledger plus the only supported way to change a stock level.
-- See docs/inventory-ui.md for the design decisions this implements.
--
-- Background: the Laravel system adjusted quantities without recording why, and
-- by the time it was retired 488 rows had drifted negative (-85843 units in
-- total, see docs/inventory-migration.md section 2.4). Nothing survived that
-- could explain how. This table exists so that never happens again: every change
-- to inventory_levels.qty from here on leaves a row behind.

CREATE TYPE public.stock_movement_kind AS ENUM (
  'receive',   -- goods arriving from a supplier
  'dispatch',  -- goods leaving on an order
  'adjust',    -- stocktake correction, may be positive or negative
  'move_in',   -- destination side of a transfer between locations
  'move_out'   -- source side of a transfer between locations
);

CREATE TABLE public.inventory_movements (
  -- GENERATED ALWAYS (not BY DEFAULT like the migrated tables): there are no
  -- legacy ids to preserve here, so hand-picked ids are simply disallowed.
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  location_id bigint NOT NULL REFERENCES public.locations (id) ON DELETE RESTRICT,
  kind public.stock_movement_kind NOT NULL,
  -- Signed delta: positive adds, negative removes. Netting any period down to a
  -- single number is then just a SUM.
  qty_delta integer NOT NULL,
  -- Balance snapshot after this movement was applied. Redundant against a replay
  -- of the whole history, which is exactly why it is worth storing: an auditor
  -- can check one row without trusting every row before it.
  qty_after integer NOT NULL,
  note text,
  -- The other end of a transfer, pairing a move_out with its move_in.
  counterpart_location_id bigint REFERENCES public.locations (id),
  -- Nullable and ON DELETE SET NULL: losing the operator account must never take
  -- the ledger row with it.
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Deliberately no updated_at and no moddatetime trigger: ledger rows are
  -- immutable, so there is nothing for a modification timestamp to record.
  CONSTRAINT inventory_movements_delta_not_zero CHECK (qty_delta <> 0),
  CONSTRAINT inventory_movements_qty_after_non_negative CHECK (qty_after >= 0),
  -- Receipts add, dispatches remove; only a stocktake may go either way.
  CONSTRAINT inventory_movements_kind_direction CHECK (
    (kind IN ('receive', 'move_in') AND qty_delta > 0)
    OR (kind IN ('dispatch', 'move_out') AND qty_delta < 0)
    OR kind = 'adjust'
  ),
  -- A counterpart location is required for transfers and meaningless otherwise.
  CONSTRAINT inventory_movements_counterpart CHECK (
    (kind IN ('move_in', 'move_out')) = (counterpart_location_id IS NOT NULL)
  )
);

-- Backs the per-product timeline on the detail page (newest first).
CREATE INDEX inventory_movements_product_created_idx
  ON public.inventory_movements (product_id, created_at DESC);

-- Backs "what moved through this location".
CREATE INDEX inventory_movements_location_idx
  ON public.inventory_movements (location_id);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- Unlike every other table in this schema, the ledger does NOT get a FOR ALL
-- policy. Read and append only -- being unable to rewrite history is the entire
-- reason the table exists.
CREATE POLICY "authenticated_read" ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_append" ON public.inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;

-- ---------------------------------------------------------------------------
-- Write API. Application code calls these and never UPDATEs inventory_levels
-- directly, so that a ledger row and a balance change can never come apart.
-- ---------------------------------------------------------------------------

-- Apply a signed delta to one product/location and record it.
--
-- The balance update is written as `qty = qty + delta` rather than read-then-
-- write, so concurrent callers serialise on the row lock instead of overwriting
-- each other. The ON CONFLICT arm also means the first receipt into a location
-- creates the stock row on its own.
--
-- Over-dispatch needs no pre-check: subtracting past zero trips the
-- inventory_levels_qty_non_negative CHECK and the whole call rolls back. A
-- pre-check would be a race (the balance can change between check and write).
CREATE FUNCTION public.record_stock_movement(
  p_product_id bigint,
  p_location_id bigint,
  p_kind public.stock_movement_kind,
  p_qty_delta integer,
  p_note text DEFAULT NULL,
  p_counterpart_location_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
-- SECURITY INVOKER (the default): the caller's own RLS applies, no privilege
-- escalation. Spelled out because the opposite is a common default elsewhere.
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

  -- Aliased so the conflicting row can be referenced unambiguously in the
  -- DO UPDATE arm (`il.qty`, i.e. the value already on file).
  INSERT INTO public.inventory_levels AS il (product_id, location_id, qty)
  VALUES (p_product_id, p_location_id, p_qty_delta)
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET qty = il.qty + p_qty_delta
  RETURNING il.qty INTO v_qty_after;

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

-- Set a stock level to an absolute figure (a stocktake) and record the
-- difference as an 'adjust' movement.
--
-- Absolute rather than letting the client compute a delta: if the UI reads 10,
-- the user counts 8 and someone dispatches 3 in between, applying "-2" lands on
-- the wrong number. Resolving "set it to 8" inside one transaction cannot.
--
-- Counting the same figure that is already on file is a no-op that returns NULL,
-- so a stocktake confirming 2098 unchanged rows does not fabricate 2098 ledger
-- entries.
CREATE FUNCTION public.set_stock_level(
  p_product_id bigint,
  p_location_id bigint,
  p_new_qty integer,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current integer;
  v_delta integer;
  v_movement_id bigint;
BEGIN
  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'Stock level must not be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE so a concurrent movement cannot slip between the read and the
  -- delta calculation below.
  SELECT qty INTO v_current
  FROM public.inventory_levels
  WHERE product_id = p_product_id AND location_id = p_location_id
  FOR UPDATE;

  v_delta := p_new_qty - COALESCE(v_current, 0);

  IF v_delta = 0 THEN
    RETURN NULL;
  END IF;

  RETURN public.record_stock_movement(
    p_product_id, p_location_id, 'adjust', v_delta, p_note, NULL
  );
END;
$$;

-- Move stock between two locations as one atomic pair of ledger rows.
--
-- The source side runs first so that moving more than is on hand fails on the
-- non-negative CHECK and rolls back both rows -- stock is never duplicated into
-- the destination.
CREATE FUNCTION public.move_stock(
  p_product_id bigint,
  p_from_location_id bigint,
  p_to_location_id bigint,
  p_qty integer,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Move quantity must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations must differ'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.record_stock_movement(
    p_product_id, p_from_location_id, 'move_out', -p_qty, p_note, p_to_location_id
  );

  PERFORM public.record_stock_movement(
    p_product_id, p_to_location_id, 'move_in', p_qty, p_note, p_from_location_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_movement(
  bigint, bigint, public.stock_movement_kind, integer, text, bigint
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_stock_level(bigint, bigint, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_stock(bigint, bigint, bigint, integer, text) TO authenticated;

COMMENT ON TABLE public.inventory_movements IS
  'Append-only stock ledger. Rows are never updated or deleted; write via record_stock_movement / set_stock_level / move_stock.';

COMMIT;
