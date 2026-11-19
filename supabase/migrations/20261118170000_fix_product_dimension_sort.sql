BEGIN;

SET LOCAL statement_timeout = 0;

-- Fixes the dimension sort in normalize_product_fields() (20260808140000).
--
-- WHAT WAS WRONG
--
--   NEW.length := v_max;
--   NEW.width  := NEW.length + NEW.width + NEW.height - v_max - v_min;
--
-- The middle edge was computed from NEW.length AFTER it had been overwritten
-- with the maximum, so it came out as width + height - min. That is right only
-- when the length typed in was already the longest edge; otherwise the width is
-- inflated. 10 x 135 x 85 was stored as 135 x 210 x 10.
--
-- The 20260808140000 backfill itself was unaffected -- its SET expressions
-- sorted the triple before the trigger saw it, and a pre-sorted input is the
-- one case the formula gets right. The damage came from later writes: on
-- 2026-11-18 at 04:42:40 UTC a bulk re-write of products (the 001 re-run)
-- pushed the Laravel values through the trigger and corrupted 452 widths.
--
-- WHY THE FIX ASSERTS ITSELF
--
-- The bug sat in the function for three months because a sorted input hides
-- it. The check below runs all six orderings of one triple through the real
-- trigger function and aborts the migration unless every one comes out sorted
-- and complete.

CREATE OR REPLACE FUNCTION public.normalize_product_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_max numeric;
  v_mid numeric;
  v_min numeric;
BEGIN
  -- 1. SKU: the business key. Normalised unconditionally (see 20260808140000).
  NEW.sku := upper(trim(NEW.sku));

  -- 2. Display text: only when the column itself is being written. The guard
  -- is load-bearing -- see 20260808140000 and CLAUDE.md rule 19.
  IF NEW.name IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
    NEW.name := initcap(trim(NEW.name));
  END IF;

  IF NEW.ebay_title IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.ebay_title IS DISTINCT FROM OLD.ebay_title) THEN
    NEW.ebay_title := initcap(trim(NEW.ebay_title));
  END IF;

  -- 3. Dimensions: length >= width >= height, unconditionally.
  -- All three are read BEFORE any is assigned. The middle value is the sum
  -- minus the extremes, which is also right with duplicates: (5,5,2) -> 5.
  v_max := greatest(NEW.length, NEW.width, NEW.height);
  v_min := least(NEW.length, NEW.width, NEW.height);
  v_mid := NEW.length + NEW.width + NEW.height - v_max - v_min;

  NEW.length := v_max;
  NEW.width  := v_mid;
  NEW.height := v_min;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-check: every ordering of (135, 85, 10) must store as 135 x 85 x 10.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _dim_sort_check (
  sku text, name text, ebay_title text,
  length numeric, width numeric, height numeric
) ON COMMIT DROP;

CREATE TRIGGER _dim_sort_check_normalize
  BEFORE INSERT ON _dim_sort_check
  FOR EACH ROW EXECUTE FUNCTION public.normalize_product_fields();

INSERT INTO _dim_sort_check (sku, length, width, height) VALUES
  ('a', 135, 85, 10), ('b', 135, 10, 85), ('c', 85, 135, 10),
  ('d', 85, 10, 135), ('e', 10, 135, 85), ('f', 10, 85, 135);

DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM _dim_sort_check
  WHERE (length, width, height) IS DISTINCT FROM (135::numeric, 85::numeric, 10::numeric);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'normalize_product_fields still mis-sorts % of 6 orderings', v_bad;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Repair the corrupted widths from the Laravel source, where it still exists.
-- ---------------------------------------------------------------------------
-- Only rows in exactly the shape the bug produces: length and height equal the
-- correctly sorted source, and width equals the buggy w0 + h0 - min. Anything
-- else that disagrees with the source (11 rows when this was written) was
-- edited for some other reason and is left alone. SKUs that occur more than
-- once in the source are skipped -- there is no single right answer for them.
--
-- Guarded on the staging table: it is dropped once the Laravel cut-over is
-- finished (CLAUDE.md rule 15), and a fresh environment never had it.
--
-- updated_at is not touched: restoring a value is not a business edit.
ALTER TABLE public.products DISABLE TRIGGER products_set_updated_at;

CREATE TEMP TABLE _dim_repaired (product_id bigint) ON COMMIT DROP;

DO $$
BEGIN
  IF to_regclass('public.go2_products') IS NULL THEN
    RAISE NOTICE 'go2_products not present; no widths repaired';
    RETURN;
  END IF;

  EXECUTE $sql$
    WITH g AS (
      SELECT upper(trim(sku)) AS sku,
             length::numeric AS l0, width::numeric AS w0, height::numeric AS h0,
             count(*) OVER (PARTITION BY upper(trim(sku))) AS n
      FROM public.go2_products
    ),
    s AS (
      SELECT sku,
             greatest(l0, w0, h0) AS l,
             l0 + w0 + h0 - greatest(l0, w0, h0) - least(l0, w0, h0) AS w,
             least(l0, w0, h0) AS h,
             w0 + h0 - least(l0, w0, h0) AS w_bug
      FROM g
      WHERE n = 1
    ),
    fixed AS (
      UPDATE public.products p
      SET width = s.w
      FROM s
      WHERE p.sku = s.sku
        AND p.length = s.l
        AND p.height = s.h
        AND p.width = s.w_bug
        AND p.width <> s.w
      RETURNING p.id
    )
    INSERT INTO _dim_repaired SELECT id FROM fixed
  $sql$;

  RAISE NOTICE 'repaired % product widths', (SELECT count(*) FROM _dim_repaired);
END;
$$;

ALTER TABLE public.products ENABLE TRIGGER products_set_updated_at;

-- ---------------------------------------------------------------------------
-- Bring open orders' packed figures back in line.
-- ---------------------------------------------------------------------------
-- order_metrics_summary has no trigger on products, so the inflated widths are
-- baked into every summary row that picks one of these products. Completed and
-- cancelled orders are history and are left as they are; quotes are never
-- re-run here (CLAUDE.md rule 23).
SELECT public.recompute_order_metrics(
  ARRAY(
    SELECT DISTINCT t.order_id
    FROM public.order_items i
    JOIN public.order_transactions t ON t.id = i.transaction_id
    JOIN public.orders o ON o.id = t.order_id
    WHERE i.product_id IN (SELECT product_id FROM _dim_repaired)
      AND o.status NOT IN ('completed', 'cancelled')
  )
);

COMMIT;
