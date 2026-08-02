BEGIN;

-- Let the ledger be trimmed, through one controlled door.
--
-- Migrations 20260801110000 and 20260801140000 made inventory_movements
-- append-only on purpose: the Laravel system adjusted quantities without
-- recording why, and 488 rows had drifted negative by the time it was retired
-- with nothing left to explain how. That decision is being narrowed, not
-- reversed: fast-moving lines accumulate history nobody will ever read, and the
-- operator wants to clear it per product.
--
-- Two things make this safe enough to do:
--
--   1. Balances are not derived from the ledger. inventory_levels.qty is the
--      source of truth and qty_after is only a snapshot, so deleting movements
--      cannot make a quantity wrong. What is lost is the explanation, not the
--      number.
--   2. Nothing here grants DELETE on the table. authenticated still cannot
--      touch a ledger row directly; it may only call the function below, which
--      deletes one product's rows in one shape and records that it did.
--
-- Because the act of erasing history is itself the thing an audit would want to
-- see, every prune leaves a summary row behind in inventory_movement_prunes.

-- ---------------------------------------------------------------------------
-- Audit trail for the prunes themselves.
-- ---------------------------------------------------------------------------

CREATE TABLE public.inventory_movement_prunes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  -- How many of the newest movements were spared. 0 means the history was
  -- cleared outright.
  kept integer NOT NULL,
  deleted_count integer NOT NULL,
  -- What the deleted rows added up to, so the discarded period still has a
  -- one-line account of itself. Transfers are counted on both sides (a move
  -- shows up in each), and a stocktake lands in whichever direction it went.
  qty_in integer NOT NULL,
  qty_out integer NOT NULL,
  -- The period the deleted rows spanned, oldest to newest.
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  -- ON DELETE SET NULL: losing the operator account must not take the record
  -- of what they did with it.
  pruned_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  pruned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movement_prunes_kept_non_negative CHECK (kept >= 0),
  CONSTRAINT inventory_movement_prunes_deleted_positive CHECK (deleted_count > 0),
  CONSTRAINT inventory_movement_prunes_qty_non_negative CHECK (
    qty_in >= 0 AND qty_out >= 0
  ),
  CONSTRAINT inventory_movement_prunes_period CHECK (first_at <= last_at)
);

CREATE INDEX inventory_movement_prunes_product_idx
  ON public.inventory_movement_prunes (product_id, pruned_at DESC);

ALTER TABLE public.inventory_movement_prunes ENABLE ROW LEVEL SECURITY;

-- Read-only to the application. The rows are written by the SECURITY DEFINER
-- function below, which runs as the owner and so is not subject to RLS -- there
-- is deliberately no INSERT policy, because a client that could write these
-- freely could also fake them.
CREATE POLICY "authenticated_read" ON public.inventory_movement_prunes
  FOR SELECT
  TO authenticated
  USING (true);

-- Supabase's default privileges on the public schema hand anon and
-- authenticated ALL PRIVILEGES on every new table, and a GRANT adds to those
-- rather than replacing them (see migration 20260801140000). Revoke first, then
-- grant back only what is wanted.
REVOKE ALL ON public.inventory_movement_prunes FROM anon, authenticated;
GRANT SELECT ON public.inventory_movement_prunes TO authenticated;

-- ---------------------------------------------------------------------------
-- The only supported way to delete ledger rows.
-- ---------------------------------------------------------------------------

-- Drop every movement for one product except the p_keep most recent, and return
-- a summary of what went.
--
-- SECURITY DEFINER because authenticated holds no DELETE on the ledger and is
-- not getting any: the privilege lives with this function, whose shape is fixed
-- (one product, newest-first, audited) rather than with the caller.
CREATE FUNCTION public.prune_product_movements(
  p_product_id bigint,
  p_keep integer DEFAULT 0
) RETURNS TABLE (
  deleted_count integer,
  qty_in integer,
  qty_out integer,
  first_at timestamptz,
  last_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_count integer;
  v_qty_in integer;
  v_qty_out integer;
  v_first timestamptz;
  v_last timestamptz;
BEGIN
  -- SECURITY DEFINER runs as the owner, so the caller's identity has to be
  -- checked here rather than left to RLS.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_keep < 0 THEN
    RAISE EXCEPTION 'Keep count must not be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The delete and its summary are one statement: aggregating over RETURNING
  -- means the figures describe exactly the rows that went, with no second pass
  -- that a concurrent insert could shift.
  WITH doomed AS (
    SELECT m.id
    FROM public.inventory_movements m
    WHERE m.product_id = p_product_id
    ORDER BY m.created_at DESC, m.id DESC
    OFFSET p_keep
  ), removed AS (
    DELETE FROM public.inventory_movements m
    USING doomed d
    WHERE m.id = d.id
    RETURNING m.qty_delta, m.created_at
  )
  SELECT
    count(*)::integer,
    COALESCE(sum(r.qty_delta) FILTER (WHERE r.qty_delta > 0), 0)::integer,
    COALESCE(-sum(r.qty_delta) FILTER (WHERE r.qty_delta < 0), 0)::integer,
    min(r.created_at),
    max(r.created_at)
  INTO v_deleted_count, v_qty_in, v_qty_out, v_first, v_last
  FROM removed r;

  -- Nothing matched: no audit row (there is nothing to account for) and a zero
  -- summary rather than an error, so "prune an already-short history" is a
  -- no-op instead of a failure.
  IF v_deleted_count = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.inventory_movement_prunes (
    product_id, kept, deleted_count, qty_in, qty_out, first_at, last_at,
    pruned_by
  )
  VALUES (
    p_product_id, p_keep, v_deleted_count, v_qty_in, v_qty_out, v_first,
    v_last, auth.uid()
  );

  RETURN QUERY SELECT v_deleted_count, v_qty_in, v_qty_out, v_first, v_last;
END;
$$;

-- EXECUTE on a new function is granted to PUBLIC by default, which would put
-- this in reach of anon. It matters far more here than on the SECURITY INVOKER
-- functions in migration 20260801110000, where RLS still stood behind the call.
REVOKE ALL ON FUNCTION public.prune_product_movements(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_product_movements(bigint, integer) TO authenticated;

COMMENT ON TABLE public.inventory_movement_prunes IS
  'One row per history prune: what was deleted, how much it netted, and who did it.';

-- The old comment claimed rows are never deleted. They now can be, by exactly
-- one route.
COMMENT ON TABLE public.inventory_movements IS
  'Append-only stock ledger. Rows are never updated, and are deleted only via prune_product_movements (audited in inventory_movement_prunes); write via record_stock_movement / set_stock_level / move_stock.';

COMMIT;
