BEGIN;

-- Field normalisation on public.products, ported from the xpros trigger
-- `format_product_fields_logic` (its modules 1 and 3).
-- See docs/order-metrics.md section 2 for the porting decisions.
--
-- Two unrelated things are normalised here, for two different reasons:
--
--   Dimensions -> sorted so that length >= width >= height.
--     This is a PREREQUISITE for public.order_metrics_summary, not cosmetics.
--     The packing estimate stacks units along HEIGHT -- max(L), max(W), sum(H)
--     across the order -- which silently assumes height is the shortest edge. A
--     product entered as 10 x 10 x 500 stacks 500mm per unit and inflates the
--     chargeable weight of every order containing it. 476 of 3123 products (15%)
--     were unsorted when this migration was written.
--
--   Text -> SKU upper-cased and trimmed, name/ebay_title initcap'd.
--     Keeps hand-typed values consistent across the catalogue.
--
-- Deliberately NOT ported: the xpros module 2, which rounds retail_price on
-- write (`CEIL(x + 0.01) - 0.05`). This project already rounds with a DIFFERENT
-- rule -- floor(x) + 0.95 -- in two places kept in sync per CLAUDE.md rule 17
-- (public.charm_price and src/lib/pricing.ts). A third implementation that also
-- fired on write would silently overwrite a price the user had just typed.

CREATE FUNCTION public.normalize_product_fields()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (the default): this function only rewrites NEW, it reads no
-- tables, so there is nothing to escalate. Spelled out because the xpros
-- original was SECURITY DEFINER for no reason that survives the port.
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_max numeric;
  v_min numeric;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. SKU: the business key. Normalised unconditionally.
  -- --------------------------------------------------------------------------
  -- Unconditional rather than guarded on change, because a SKU that reaches the
  -- table in the wrong case breaks the exact-match lookup in
  -- public.rebuild_order_items (see migration 20260808150000). One row (id 396,
  -- sku 'a') was affected when this was written; the backfill below fixes it.
  NEW.sku := upper(trim(NEW.sku));

  -- --------------------------------------------------------------------------
  -- 2. Display text: only when the column itself is being written.
  -- --------------------------------------------------------------------------
  -- The guard is load-bearing, and is the whole reason existing rows are not
  -- backfilled below. initcap() lowercases every non-initial letter of a word,
  -- so it improves some values and damages others:
  --
  --   '2Pcs 40Mm Padlock'          -> '2pcs 40mm Padlock'          (better)
  --   'Philips 23A 12V Battery'    -> 'Philips 23a 12v Battery'    (WORSE)
  --   'Sony Murata 362 Sr721Sw'    -> 'Sony Murata 362 Sr721sw'    (worse)
  --
  -- 1464 of 3123 product names (47%) would change, a mix of both. The decision
  -- was to apply the rule going forward and leave history alone. Without this
  -- guard that decision would not survive contact with the UI: the product form
  -- submits every field on save, so editing a price would rewrite the name too,
  -- backfilling those 1464 rows silently over a few weeks of ordinary edits.
  IF NEW.name IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
    NEW.name := initcap(trim(NEW.name));
  END IF;

  IF NEW.ebay_title IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.ebay_title IS DISTINCT FROM OLD.ebay_title) THEN
    NEW.ebay_title := initcap(trim(NEW.ebay_title));
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Dimensions: length >= width >= height, unconditionally.
  -- --------------------------------------------------------------------------
  -- All three columns are NOT NULL, so no COALESCE is needed (the xpros original
  -- had nullable dimensions and guarded accordingly). Re-sorting an already
  -- sorted triple is a no-op, so this runs on every write rather than being
  -- guarded on change -- that way the invariant holds even for a row written by
  -- a path that skipped an earlier version of this trigger.
  v_max := greatest(NEW.length, NEW.width, NEW.height);
  v_min := least(NEW.length, NEW.width, NEW.height);

  NEW.length := v_max;
  -- The middle value, without a third comparison. Correct with duplicates too:
  -- (5,5,2) gives 5 + 5 + 2 - 5 - 2 = 5.
  NEW.width  := NEW.length + NEW.width + NEW.height - v_max - v_min;
  NEW.height := v_min;

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_normalize_fields
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_product_fields();

-- ---------------------------------------------------------------------------
-- Backfill: dimensions and SKU only. Names and eBay titles are left alone, per
-- the decision recorded above.
-- ---------------------------------------------------------------------------
-- products_set_updated_at (migration 20260719150000) would stamp today's date on
-- every touched row. Product timestamps are load-bearing history -- CLAUDE.md
-- rule 15 goes to some length to preserve them through the Laravel import -- and
-- a normalisation pass is not a business edit, so it should not show up as one.
ALTER TABLE public.products DISABLE TRIGGER products_set_updated_at;

-- Every SET expression reads the OLD row, so the three assignments cannot
-- cascade into each other.
UPDATE public.products
SET length = greatest(length, width, height),
    width  = length + width + height
             - greatest(length, width, height)
             - least(length, width, height),
    height = least(length, width, height)
WHERE NOT (length >= width AND width >= height);

UPDATE public.products
SET sku = upper(trim(sku))
WHERE sku <> upper(trim(sku));

ALTER TABLE public.products ENABLE TRIGGER products_set_updated_at;

COMMIT;
