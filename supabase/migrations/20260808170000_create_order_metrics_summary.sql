BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.order_metrics_summary -- one row per order carrying the aggregates the
-- order screens need: item count, weight, chargeable weight, packed size, money
-- and profit.
--
-- Ported from the xpros table of the same name. See docs/order-metrics.md.
--
-- A TABLE maintained by trigger, not a view. That is the one design decision
-- worth defending, and it is not a guess: xpros shipped this as a view first and
-- had to migrate away from it. Every CTE below aggregates across orders, and an
-- order_id predicate cannot be pushed into them, so a view computes the whole
-- table to answer a question about twenty rows -- 7.3s and a statement timeout
-- in production there. This schema is the same shape and the same size (203315
-- orders / 250413 transactions / 250687 items), and migration 20260803160000
-- already carries the same warning about public.order_totals. Building the view
-- first would be knowingly building the thing that has to be replaced.
--
-- Freshness comes from two places:
--   1. Statement-level triggers on orders / order_transactions / order_items
--      recompute just the affected orders, synchronously.
--   2. A scheduled full refresh (migration 20260808190000) as a backstop for
--      drift the triggers cannot see -- chiefly a product's weight, dimensions
--      or purchase price changing, which moves the metrics of every order that
--      ever contained it. Fanning that out synchronously would make editing one
--      product rewrite thousands of orders inside the user's request.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.order_metrics_summary (
  -- A real foreign key, where xpros used a bare bigint plus a DELETE trigger and
  -- an orphan-pruning function. The constraint does both jobs for free, so
  -- neither is ported.
  order_id bigint PRIMARY KEY REFERENCES public.orders (id) ON DELETE CASCADE,

  -- ---- counts ----
  total_items       bigint NOT NULL DEFAULT 0,
  transaction_count bigint NOT NULL DEFAULT 0,

  -- ---- data-quality flags, so the numbers above can be trusted or not ----
  -- Items that resolved to no product (order_items.product_id IS NULL). They
  -- carry a quantity but contribute no weight, size or cost, so an order with a
  -- non-zero count here is understated on every physical metric. 313 such rows
  -- exist today; the final Laravel import brings ~3026 (docs/orders-domain-
  -- migration.md section 5).
  unresolved_item_count bigint NOT NULL DEFAULT 0,
  -- Items whose product has no derivable cost, so total_cost and gross_profit
  -- are understated. Zero across the whole table today -- it exists to stay
  -- zero, and to say so out loud when it stops being.
  uncosted_item_count bigint NOT NULL DEFAULT 0,
  -- True when any line's product has a zero length, width or height and fell
  -- back to the 10mm default below. 864 of 3123 products (28%) are in that
  -- state, so this flag is not an edge case: the packed size of such an order is
  -- a guess and the UI should say so rather than print it like a measurement.
  has_estimated_dimensions boolean NOT NULL DEFAULT false,

  -- ---- weight (kg) ----
  total_weight_kg      numeric(12, 3) NOT NULL DEFAULT 0,
  -- What a carrier actually bills: the greater of real weight and volumetric
  -- weight derived from the packed size.
  chargeable_weight_kg numeric(12, 3) NOT NULL DEFAULT 0,

  -- ---- money (AUD) ----
  -- Names match public.order_totals, which migration 20260808180000 rewires to
  -- read from this table. xpros called these total_sale / total_amount.
  goods_total numeric(12, 2) NOT NULL DEFAULT 0,
  order_total numeric(12, 2) NOT NULL DEFAULT 0,
  total_cost  numeric(12, 2) NOT NULL DEFAULT 0,
  -- xpros called this website_profit.
  gross_profit numeric(12, 2) NOT NULL DEFAULT 0,

  -- ---- size (mm) ----
  -- Whole-order packing estimate: units stacked along height, so
  -- max(L) x max(W) x sum(H) across the lines.
  packed_length_mm numeric(10, 2),
  packed_width_mm  numeric(10, 2),
  packed_height_mm numeric(10, 2),
  max_dimension_mm numeric(10, 2),
  -- Single-unit dimensions of the heaviest-by-chargeable-weight product in the
  -- order. The packed estimate above is deliberately pessimistic (it never lets
  -- a small item ride inside a big item's box); these are what to quote a
  -- carrier with when everything plausibly fits in the dominant item's carton.
  dominant_length_mm numeric(10, 2),
  dominant_width_mm  numeric(10, 2),
  dominant_height_mm numeric(10, 2),

  computed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_metrics_summary_counts_non_negative CHECK (
    total_items >= 0 AND transaction_count >= 0
    AND unresolved_item_count >= 0 AND uncosted_item_count >= 0
  )
);

-- The point of materialising is that the list screen can now sort and filter on
-- these, which public.order_totals explicitly could not.
CREATE INDEX order_metrics_summary_order_total_idx  ON public.order_metrics_summary (order_total DESC);
CREATE INDEX order_metrics_summary_gross_profit_idx ON public.order_metrics_summary (gross_profit DESC);
-- Partial: the work queues are small and this keeps the indexes that way.
CREATE INDEX order_metrics_summary_unresolved_idx
  ON public.order_metrics_summary (order_id)
  WHERE unresolved_item_count > 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- Recompute
-- ═══════════════════════════════════════════════════════════════════════════
-- Built as dynamic SQL for one reason: the order_id predicate has to appear
-- inside every CTE, at the base-table scan, or the whole point is lost. A static
-- query with `WHERE order_id = ANY($1) OR $1 IS NULL` in the outer select would
-- still aggregate all 250687 item rows first.
--
-- p_order_ids NULL means "everything", and is reserved for the migration
-- backfill and the scheduled refresh. It is not reachable from application code:
-- see the grants at the bottom.
CREATE FUNCTION public.recompute_order_metrics(p_order_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
-- SECURITY DEFINER: the triggers below must be able to write this table on
-- behalf of a user who has no write privilege on it at all.
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- Applied inside each CTE, against the transaction's order_id.
  f_cte text := CASE WHEN p_order_ids IS NULL THEN '' ELSE ' WHERE t.order_id = ANY($1) ' END;
  -- Applied to the driving scan of public.orders.
  f_out text := CASE WHEN p_order_ids IS NULL THEN '' ELSE ' WHERE o.id = ANY($1) ' END;
  v_sql text;
  v_rows integer;
BEGIN
  IF p_order_ids IS NOT NULL AND cardinality(p_order_ids) = 0 THEN
    RETURN 0;
  END IF;

  v_sql := format($q$
    WITH settings AS (
      SELECT parcel_volumetric_kg_per_cbm AS volumetric_factor, gst_rate
      FROM public.pricing_settings
      WHERE id = 1
    ),
    -- ---- per-order rollup of the item lines ----
    item_metrics AS (
      SELECT t.order_id,
        sum(i.quantity)                                          AS total_items,
        sum(i.quantity * COALESCE(p.weight, 0))                  AS total_weight,
        sum(i.quantity * COALESCE(c.unit_cost_aud, 0))           AS total_cost,
        count(*) FILTER (WHERE i.product_id IS NULL)             AS unresolved_items,
        count(*) FILTER (WHERE i.product_id IS NOT NULL
                           AND c.unit_cost_aud IS NULL)          AS uncosted_items,
        COALESCE(bool_or(p.length = 0 OR p.width = 0 OR p.height = 0), false)
                                                                 AS estimated_dims
      FROM public.order_items i
        JOIN public.order_transactions t ON t.id = i.transaction_id
        -- LEFT, not INNER as in xpros. order_items.product_id is nullable here
        -- and 313 rows are null; an inner join would drop those lines from
        -- total_items as well, so an order would report fewer items than it
        -- sold with nothing to indicate why.
        LEFT JOIN public.products p ON p.id = i.product_id
        -- product_cost_base rather than product_pricing: order_items are already
        -- expanded to components, so no kit ever appears here and the kit
        -- roll-up branch of product_pricing would be dead weight over 250k rows.
        LEFT JOIN public.product_cost_base c ON c.id = i.product_id
      %1$s
      GROUP BY t.order_id
    ),
    -- ---- per-order rollup of the transaction lines ----
    transaction_metrics AS (
      SELECT t.order_id,
        sum(t.sale_price * t.quantity) AS goods_total,
        count(*)                       AS transaction_count
      FROM public.order_transactions t
      %1$s
      GROUP BY t.order_id
    ),
    -- ---- packing estimate ----
    -- Effective dimensions with a 10mm fallback for an unrecorded edge, matching
    -- DEFAULT_DIMENSION in src/lib/validations/product.ts. (xpros used 12; the
    -- number is arbitrary either way, so it follows the local convention.)
    -- a x b is the near-square footprint qty units would occupy in one layer.
    item_dims AS (
      SELECT t.order_id,
        i.quantity::numeric AS qty,
        COALESCE(NULLIF(p.length, 0), 10) AS eff_l,
        COALESCE(NULLIF(p.width,  0), 10) AS eff_w,
        COALESCE(NULLIF(p.height, 0), 10) AS eff_h,
        greatest(1, round(sqrt(i.quantity::numeric))) AS a,
        greatest(1, ceil(i.quantity::numeric
                         / greatest(1, round(sqrt(i.quantity::numeric))))) AS b
      FROM public.order_items i
        JOIN public.order_transactions t ON t.id = i.transaction_id
        JOIN public.products p ON p.id = i.product_id
      %1$s
    ),
    -- Three ways to arrange qty units of one product. Ported verbatim from
    -- xpros, only refactored so each candidate triple is written once instead of
    -- the source's nine repetitions of the same GREATEST expressions.
    candidates AS (
      SELECT d.order_id,
        -- A: single layer, a x b footprint
        d.eff_l AS a_l, d.a * d.eff_w AS a_w, d.b * d.eff_h AS a_h,
        -- B: single column, stacked on height
        d.eff_l AS b_l, d.eff_w AS b_w, d.qty * d.eff_h AS b_h,
        -- C: a x b footprint, stacked
        d.a * d.eff_l AS c_l, d.b * d.eff_w AS c_w,
        ceil(d.qty / (d.a * d.b)) * d.eff_h AS c_h
      FROM item_dims d
    ),
    -- Pick the arrangement with the shortest longest-edge. Ties go A, then B,
    -- then C -- the same precedence the source CASE expressions encoded.
    chosen AS (
      SELECT s.order_id,
        CASE WHEN s.ga <= s.gb AND s.ga <= s.gc THEN s.a_l
             WHEN s.gb <= s.gc                  THEN s.b_l
             ELSE s.c_l END AS span_l,
        CASE WHEN s.ga <= s.gb AND s.ga <= s.gc THEN s.a_w
             WHEN s.gb <= s.gc                  THEN s.b_w
             ELSE s.c_w END AS span_w,
        CASE WHEN s.ga <= s.gb AND s.ga <= s.gc THEN s.a_h
             WHEN s.gb <= s.gc                  THEN s.b_h
             ELSE s.c_h END AS span_h
      FROM (
        SELECT c.*,
          greatest(c.a_l, c.a_w, c.a_h) AS ga,
          greatest(c.b_l, c.b_w, c.b_h) AS gb,
          greatest(c.c_l, c.c_w, c.c_h) AS gc
        FROM candidates c
      ) s
    ),
    packed AS (
      SELECT chosen.order_id,
        max(chosen.span_l)          AS packed_l,
        max(chosen.span_w)          AS packed_w,
        round(sum(chosen.span_h), 1) AS packed_h
      FROM chosen
      GROUP BY chosen.order_id
    ),
    -- ---- dominant product ----
    -- The heaviest single unit by chargeable weight, tie-broken on longest edge
    -- then id so the result is deterministic.
    dominant AS (
      SELECT r.order_id, r.dominant_l, r.dominant_w, r.dominant_h
      FROM (
        SELECT t.order_id,
          NULLIF(p.length, 0) AS dominant_l,
          NULLIF(p.width,  0) AS dominant_w,
          NULLIF(p.height, 0) AS dominant_h,
          row_number() OVER (
            PARTITION BY t.order_id
            ORDER BY
              greatest(
                COALESCE(p.weight, 0),
                COALESCE(p.length, 0) * COALESCE(p.width, 0) * COALESCE(p.height, 0)
                  / 1000000000.0 * st.volumetric_factor
              ) DESC,
              greatest(COALESCE(p.length, 0), COALESCE(p.width, 0), COALESCE(p.height, 0)) DESC,
              p.id
          ) AS rn
        FROM public.order_items i
          JOIN public.order_transactions t ON t.id = i.transaction_id
          JOIN public.products p ON p.id = i.product_id
          CROSS JOIN settings st
        %1$s
      ) r
      WHERE r.rn = 1
    )
    INSERT INTO public.order_metrics_summary AS m (
      order_id, total_items, transaction_count,
      unresolved_item_count, uncosted_item_count, has_estimated_dimensions,
      total_weight_kg, chargeable_weight_kg,
      goods_total, order_total, total_cost, gross_profit,
      packed_length_mm, packed_width_mm, packed_height_mm, max_dimension_mm,
      dominant_length_mm, dominant_width_mm, dominant_height_mm,
      computed_at
    )
    SELECT o.id,
      COALESCE(im.total_items, 0),
      COALESCE(tm.transaction_count, 0),
      COALESCE(im.unresolved_items, 0),
      COALESCE(im.uncosted_items, 0),
      COALESCE(im.estimated_dims, false),
      COALESCE(im.total_weight, 0),
      -- Chargeable weight: real weight vs the packed box's volumetric weight.
      -- Dimensions are mm, so volume/1e9 is cbm.
      greatest(
        COALESCE(im.total_weight, 0),
        COALESCE(pk.packed_l * pk.packed_w * pk.packed_h / 1000000000.0, 0) * st.volumetric_factor
      ),
      COALESCE(tm.goods_total, 0),
      COALESCE(tm.goods_total, 0) + o.postage_and_handling - o.discount,
      COALESCE(im.total_cost, 0),
      -- Revenue is GST-inclusive, so cost is grossed up to match before being
      -- subtracted. xpros hardcoded the 1.1; here it follows pricing_settings so
      -- a GST change lands in one place.
      (COALESCE(tm.goods_total, 0) + o.postage_and_handling - o.discount)
        - o.postage_paid
        - COALESCE(im.total_cost, 0) * (1 + st.gst_rate),
      pk.packed_l, pk.packed_w, pk.packed_h,
      greatest(pk.packed_l, pk.packed_w, pk.packed_h),
      d.dominant_l, d.dominant_w, d.dominant_h,
      now()
    -- Driving the whole statement off public.orders is what makes deletion safe:
    -- when this runs from a trigger during a cascading delete the order row is
    -- already gone, so this scan returns nothing and no row is re-inserted under
    -- a foreign key that no longer has a parent.
    FROM public.orders o
      CROSS JOIN settings st
      LEFT JOIN item_metrics        im ON im.order_id = o.id
      LEFT JOIN transaction_metrics tm ON tm.order_id = o.id
      LEFT JOIN packed              pk ON pk.order_id = o.id
      LEFT JOIN dominant            d  ON d.order_id  = o.id
    %2$s
    ON CONFLICT (order_id) DO UPDATE SET
      total_items              = EXCLUDED.total_items,
      transaction_count        = EXCLUDED.transaction_count,
      unresolved_item_count    = EXCLUDED.unresolved_item_count,
      uncosted_item_count      = EXCLUDED.uncosted_item_count,
      has_estimated_dimensions = EXCLUDED.has_estimated_dimensions,
      total_weight_kg          = EXCLUDED.total_weight_kg,
      chargeable_weight_kg     = EXCLUDED.chargeable_weight_kg,
      goods_total              = EXCLUDED.goods_total,
      order_total              = EXCLUDED.order_total,
      total_cost               = EXCLUDED.total_cost,
      gross_profit             = EXCLUDED.gross_profit,
      packed_length_mm         = EXCLUDED.packed_length_mm,
      packed_width_mm          = EXCLUDED.packed_width_mm,
      packed_height_mm         = EXCLUDED.packed_height_mm,
      max_dimension_mm         = EXCLUDED.max_dimension_mm,
      dominant_length_mm       = EXCLUDED.dominant_length_mm,
      dominant_width_mm        = EXCLUDED.dominant_width_mm,
      dominant_height_mm       = EXCLUDED.dominant_height_mm,
      computed_at              = EXCLUDED.computed_at
  $q$, f_cte, f_out);

  IF p_order_ids IS NULL THEN
    -- A full pass reads every order and item row. The remote statement_timeout
    -- is 2 minutes (CLAUDE.md rule 15) and this does not fit in it.
    PERFORM set_config('statement_timeout', '600000', true);
    EXECUTE v_sql;
  ELSE
    EXECUTE v_sql USING p_order_ids;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

-- The entry point for a "recalculate" action in the UI. Deliberately the only
-- one exposed: it cannot be handed a NULL and turned into a full-table refresh.
CREATE FUNCTION public.rebuild_order_metrics(p_order_id bigint)
RETURNS integer
LANGUAGE sql
-- SECURITY DEFINER because recompute_order_metrics is revoked from PUBLIC below;
-- an invoker-rights wrapper would fail for every caller that is not the owner.
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.recompute_order_metrics(ARRAY[p_order_id]);
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════
-- All statement-level with transition tables, where xpros used row-level
-- triggers. The reason is public.rebuild_order_items: it deletes and re-inserts
-- every item row of a transaction, so a five-component kit would fire ten
-- row-level triggers and recompute the same order ten times. Statement level
-- collapses that to one recompute per statement, and makes bulk writes behave.
--
-- No DELETE trigger on orders: the foreign key cascades.
--
-- Recomputing twice for one logical change is still possible -- inserting a
-- transaction fires the rebuild trigger (which writes items, firing the item
-- trigger) and then this one. That is wasted work, never a wrong answer, and
-- removing it would mean coupling these triggers to the rebuild ones.

CREATE FUNCTION public.trg_oms_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(n.id) INTO v_ids FROM new_rows n;
  ELSE
    -- Only the three money columns that feed a metric. Editing a tracking
    -- number, a status or the comments must not recompute anything.
    SELECT array_agg(n.id) INTO v_ids
    FROM new_rows n
      JOIN old_rows o ON o.id = n.id
    WHERE n.postage_and_handling IS DISTINCT FROM o.postage_and_handling
       OR n.discount             IS DISTINCT FROM o.discount
       OR n.postage_paid         IS DISTINCT FROM o.postage_paid;
  END IF;

  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_order_metrics(v_ids);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.trg_oms_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.order_id) INTO v_ids FROM new_rows n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.order_id) INTO v_ids FROM old_rows o;
  ELSE
    -- Both sides: moving a transaction between orders changes the metrics of the
    -- order it left as well as the one it joined.
    SELECT array_agg(DISTINCT x.order_id) INTO v_ids
    FROM (
      SELECT n.order_id FROM new_rows n
        JOIN old_rows o ON o.id = n.id
       WHERE n.sale_price IS DISTINCT FROM o.sale_price
          OR n.quantity   IS DISTINCT FROM o.quantity
          OR n.order_id   IS DISTINCT FROM o.order_id
      UNION
      SELECT o.order_id FROM old_rows o
        JOIN new_rows n ON n.id = o.id
       WHERE n.sale_price IS DISTINCT FROM o.sale_price
          OR n.quantity   IS DISTINCT FROM o.quantity
          OR n.order_id   IS DISTINCT FROM o.order_id
    ) x;
  END IF;

  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_order_metrics(v_ids);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.trg_oms_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  -- The join to order_transactions is why this can come up empty: when a
  -- transaction is deleted its items cascade, and by the time this fires the
  -- parent transaction may already be gone. That is harmless -- the DELETE
  -- trigger on order_transactions recomputes the same order from OLD.order_id.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT t.order_id) INTO v_ids
    FROM new_rows n JOIN public.order_transactions t ON t.id = n.transaction_id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT t.order_id) INTO v_ids
    FROM old_rows o JOIN public.order_transactions t ON t.id = o.transaction_id;
  ELSE
    -- Only the three columns that feed a metric. Everything else on this table
    -- -- location_id above all, which is edited by hand while picking -- must
    -- not trigger anything.
    SELECT array_agg(DISTINCT t.order_id) INTO v_ids
    FROM (
      SELECT n.transaction_id FROM new_rows n
        JOIN old_rows o ON o.id = n.id
       WHERE n.quantity       IS DISTINCT FROM o.quantity
          OR n.product_id     IS DISTINCT FROM o.product_id
          OR n.transaction_id IS DISTINCT FROM o.transaction_id
      UNION
      SELECT o.transaction_id FROM old_rows o
        JOIN new_rows n ON n.id = o.id
       WHERE n.quantity       IS DISTINCT FROM o.quantity
          OR n.product_id     IS DISTINCT FROM o.product_id
          OR n.transaction_id IS DISTINCT FROM o.transaction_id
    ) x
      JOIN public.order_transactions t ON t.id = x.transaction_id;
  END IF;

  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_order_metrics(v_ids);
  END IF;
  RETURN NULL;
END;
$$;

-- All eight are named with the same `oms_` prefix so that the DISABLE TRIGGER
-- block in scripts/migration/004_orders_data.sql has an obvious set to turn off.
-- Leaving them on during that import would call recompute_order_metrics once per
-- inserted statement over 250413 transactions.
CREATE TRIGGER oms_orders_insert
  AFTER INSERT ON public.orders
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_orders();

-- The three UPDATE triggers below fire on any column, not just the ones that
-- feed a metric: Postgres rejects `UPDATE OF <cols>` combined with transition
-- tables ("transition tables cannot be specified for triggers with column
-- lists"). The narrowing therefore lives inside the trigger functions, as an
-- IS DISTINCT FROM filter over the transition tables. Being statement-level,
-- the cost of the extra firings is one small join per statement, not per row.
CREATE TRIGGER oms_orders_update
  AFTER UPDATE ON public.orders
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_orders();

CREATE TRIGGER oms_transactions_insert
  AFTER INSERT ON public.order_transactions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_transactions();

CREATE TRIGGER oms_transactions_update
  AFTER UPDATE ON public.order_transactions
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_transactions();

CREATE TRIGGER oms_transactions_delete
  AFTER DELETE ON public.order_transactions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_transactions();

CREATE TRIGGER oms_items_insert
  AFTER INSERT ON public.order_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_order_items();

CREATE TRIGGER oms_items_update
  AFTER UPDATE ON public.order_items
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_order_items();

CREATE TRIGGER oms_items_delete
  AFTER DELETE ON public.order_items
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_oms_order_items();

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.recompute_order_metrics(NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- Access
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.order_metrics_summary ENABLE ROW LEVEL SECURITY;

-- Read only. There is no INSERT/UPDATE/DELETE policy and no write grant: the
-- only way into this table is the SECURITY DEFINER function above, which means
-- a stale or hand-edited row cannot exist.
CREATE POLICY "authenticated_read" ON public.order_metrics_summary
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.order_metrics_summary TO authenticated;

-- Functions are EXECUTE-to-PUBLIC by default, and this one is SECURITY DEFINER
-- with a full-table refresh reachable by passing NULL. Lock it to the owner and
-- expose the single-order wrapper instead.
REVOKE ALL ON FUNCTION public.recompute_order_metrics(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rebuild_order_metrics(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_order_metrics(bigint) TO authenticated;

COMMIT;
