BEGIN;

-- Automatic maintenance of order_items.
-- See docs/orders-domain-migration.md section 5 for the evidence behind this.
--
-- Replaying the expansion rule below against all 250687 legacy rows reproduces
-- 247556 of them exactly (98.75%). Of the 3125 it cannot reproduce, 3026 are
-- transactions whose custom_label matches no SKU at all -- i.e. source data with
-- nothing to resolve, not a flaw in the rule. Only 99 rows are genuine BOM
-- drift. That is what justifies generating these rows rather than typing them.

-- Rebuild every order_items row belonging to one transaction. Returns the number
-- of rows written.
--
-- Expansion rule (see section 5.2 of the doc):
--   custom_label matches a non-kit product -> one row, qty = transaction qty
--   custom_label matches a kit             -> one row per product_kit_items
--                                             entry, qty = transaction qty x BOM qty
--   kit with no BOM, or no match at all    -> one placeholder row with
--                                             product_id NULL
--
-- The placeholder is deliberate. A transaction that sold something the system
-- cannot resolve to a SKU is a situation a human has to fix; emitting zero rows
-- would make it disappear instead. Querying product_id IS NULL is the work queue.
CREATE FUNCTION public.rebuild_order_items(p_transaction_id bigint)
RETURNS integer
LANGUAGE plpgsql
-- SECURITY INVOKER (the default): the caller's own RLS applies, no privilege
-- escalation. Spelled out because the opposite is a common default elsewhere.
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
    -- products.sku is unique across all 3122 rows, so this yields at most one.
    SELECT id, sku, is_kit
    FROM public.products
    WHERE sku = v_label
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

-- Rebuild every transaction on an order. This is the entry point for a
-- "recalculate items" action in the UI, and the only supported way to pull a
-- historical order up to the current BOM.
CREATE FUNCTION public.rebuild_order_items_for_order(p_order_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_transaction_id bigint;
  v_total integer := 0;
BEGIN
  FOR v_transaction_id IN
    SELECT id FROM public.order_transactions WHERE order_id = p_order_id
  LOOP
    v_total := v_total + public.rebuild_order_items(v_transaction_id);
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE FUNCTION public.trg_rebuild_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.rebuild_order_items(NEW.id);
  -- AFTER trigger: the return value is ignored.
  RETURN NULL;
END;
$$;

-- Insert and update are separate triggers on purpose. A WHEN clause cannot
-- reference TG_OP, and OLD does not exist for INSERT, so a combined
-- `AFTER INSERT OR UPDATE ... WHEN (TG_OP = 'INSERT' OR OLD.x IS DISTINCT ...)`
-- does not compile. Splitting is what lets the update side carry a WHEN clause
-- at all.
--
-- Both are named with the same prefix so that
-- `ALTER TABLE ... DISABLE TRIGGER <name>` in the data migration has an obvious
-- pair to disable (see scripts/migration/004_orders_data.sql).
--
-- DELETE needs no trigger: order_items.transaction_id is ON DELETE CASCADE.
--
-- Changes to product_kit_items deliberately do NOT trigger anything. Order items
-- record what was actually shipped; rewriting a 2019 dispatch with today's BOM
-- would be falsifying history. Use rebuild_order_items_for_order() when a
-- rebuild is genuinely wanted.
CREATE TRIGGER order_transactions_rebuild_items_insert
  AFTER INSERT ON public.order_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_rebuild_order_items();

-- Two layers of narrowing, both load-bearing:
--
--   UPDATE OF custom_label, quantity -- editing a tracking number or a comment
--     must not touch the picked items.
--
--   WHEN (... IS DISTINCT FROM ...) -- a UI that submits every field on save
--     would otherwise fire this on every edit, and each firing discards manual
--     adjustments. Without this clause, correcting a typo in the order comments
--     silently rewrites the pick list.
CREATE TRIGGER order_transactions_rebuild_items_update
  AFTER UPDATE OF custom_label, quantity ON public.order_transactions
  FOR EACH ROW
  WHEN (
    OLD.custom_label IS DISTINCT FROM NEW.custom_label
    OR OLD.quantity  IS DISTINCT FROM NEW.quantity
  )
  EXECUTE FUNCTION public.trg_rebuild_order_items();

GRANT EXECUTE ON FUNCTION public.rebuild_order_items(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_order_items_for_order(bigint) TO authenticated;

COMMIT;
