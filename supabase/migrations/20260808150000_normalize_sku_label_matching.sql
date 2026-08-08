BEGIN;

-- public.rebuild_order_items resolves order_transactions.custom_label to a
-- product with a case-sensitive exact match (`WHERE sku = v_label`). Migration
-- 20260808140000 now upper-cases products.sku on write, which breaks that match
-- for any label typed in another case.
--
-- The blast radius today is one row -- product 396, whose SKU was 'a' and is now
-- 'A' -- but the failure mode is what matters: rebuild_order_items does not
-- raise on a miss, it emits a placeholder row with product_id NULL. The order
-- would quietly lose its resolved line and turn up in the unresolved work queue
-- instead, with nothing pointing at the cause.
--
-- Measured before and after (3240 distinct labels): matching both sides
-- normalised resolves the same 2757 labels as the original exact match, and no
-- two labels collide once normalised. So this is a pure fix, not a widening --
-- it neither gains nor loses a match today, it just stops the SKU casing rule
-- from mattering.

CREATE OR REPLACE FUNCTION public.rebuild_order_items(p_transaction_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_label text;
  v_quantity integer;
  -- product_id -> location_id carried over from the rows about to be deleted.
  v_locations jsonb;
  v_inserted integer;
BEGIN
  SELECT custom_label, quantity
  INTO v_label, v_quantity
  FROM public.order_transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Pick locations are recorded by hand and cannot be re-derived, so they are
  -- carried across the rebuild by product. A product still in the expansion
  -- keeps its location; one that dropped out loses it, which is correct -- that
  -- item is no longer being picked.
  SELECT jsonb_object_agg(product_id::text, location_id)
  INTO v_locations
  FROM public.order_items
  WHERE transaction_id = p_transaction_id
    AND product_id IS NOT NULL
    AND location_id IS NOT NULL;

  DELETE FROM public.order_items WHERE transaction_id = p_transaction_id;

  WITH matched AS (
    -- products.sku is unique, so this yields at most one row.
    --
    -- Only the LABEL is normalised in the comparison, not the column: the
    -- products_normalize_fields trigger guarantees every stored sku is already
    -- upper(trim(...)), so this stays a plain equality on products_sku_key
    -- rather than a sequential scan behind upper(). That trigger is therefore
    -- load-bearing for this lookup's performance, not just its correctness.
    SELECT id, sku, is_kit
    FROM public.products
    WHERE sku = upper(trim(v_label))
  ),
  expansion AS (
    -- Plain product: sold as-is.
    SELECT m.id AS product_id, m.sku AS sku, v_quantity AS qty
    FROM matched m
    WHERE NOT m.is_kit

    UNION ALL

    -- Kit: one row per component. Only one level is expanded, which covers the
    -- data as it stands (no component is itself a kit). Should nested kits ever
    -- appear, the inner kit would land here as a component rather than being
    -- expanded further -- a visible wrong row, not silent corruption.
    SELECT c.id, c.sku, v_quantity * ki.qty
    FROM matched m
    JOIN public.product_kit_items ki ON ki.kit_product_id = m.id
    JOIN public.products c ON c.id = ki.component_product_id
    WHERE m.is_kit

    UNION ALL

    -- Nothing to expand: unknown label, or a kit with an empty BOM (24 such kits
    -- exist, 40 transactions have sold them). Keep the sold quantity and the
    -- label so the row can be resolved by hand.
    SELECT NULL::bigint, v_label, v_quantity
    WHERE NOT EXISTS (SELECT 1 FROM matched)
       OR EXISTS (
            SELECT 1 FROM matched m
            WHERE m.is_kit
              AND NOT EXISTS (
                SELECT 1 FROM public.product_kit_items ki
                WHERE ki.kit_product_id = m.id
              )
          )
  )
  INSERT INTO public.order_items (
    transaction_id, product_id, sku_snapshot, quantity, location_id,
    is_auto_generated
  )
  SELECT
    p_transaction_id,
    e.product_id,
    -- Note this is the RAW label for an unresolved row, not the normalised one:
    -- sku_snapshot records what was actually sold, and for a placeholder that is
    -- the only evidence left of what the operator typed.
    e.sku,
    e.qty,
    (v_locations ->> e.product_id::text)::bigint,
    true
  FROM expansion e
  -- A BOM quantity of 0 would violate order_items_quantity_positive and abort
  -- the caller's transaction. Skipping such a line keeps a bad BOM from making
  -- the order un-editable.
  WHERE e.qty > 0;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMIT;
