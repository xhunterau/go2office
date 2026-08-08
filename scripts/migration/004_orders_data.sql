-- One-time data migration: orders domain (Laravel legacy tables -> Supabase tables).
-- See docs/orders-domain-migration.md for full context and decisions.
--
-- This script is idempotent by design: every INSERT upserts on the primary key,
-- so it can be re-run safely, including the final run after the last Laravel
-- backup is restored into the go2_* tables. Per CLAUDE.md rule 15, if any column
-- referenced below is renamed/dropped/retyped on the target tables, this script
-- must be updated in the same change.
--
-- Migration order follows FK dependencies:
--   customers -> orders -> order_transactions -> order_items
--
-- Prerequisites:
--   * scripts/migration/001_products_domain_data.sql has been re-run, so
--     public.products is current (order_items resolves product_id against it);
--   * scripts/migration/003_inventory_data.sql has been re-run, so
--     public.locations is current (order_items resolves pick_location by name).
--
-- !! DANGER -- READ BEFORE RUNNING !!
-- Section 3 disables the two order_items rebuild triggers and re-enables them at
-- the end of the same transaction. Do not run the sections separately and do not
-- stop in between. With the triggers live, inserting into order_transactions
-- regenerates every order_items row from today's BOM -- which silently
-- overwrites the 250687 migrated rows, discards the 3026 lines that cannot be
-- reproduced at all, and wipes all 28893 recorded pick locations. It does not
-- raise an error; the numbers just quietly become wrong. Diagnostic 6 at the end
-- of this file is the check for exactly this.
--
-- Sections 2 and 3 additionally disable the eight order_metrics_summary triggers
-- (migration 20260808170000), and section 5 rebuilds that table from scratch
-- afterwards. Skipping section 5 does not raise either: the order screens simply
-- keep reporting pre-import totals, weights and sizes. Diagnostic 8a checks it.
--
-- Section 2 also disables the two orders_normalize_tracking_* triggers
-- (migration 20260808210000) and calls the same function inline. Both halves of
-- that swap are load-bearing: dropping the DISABLE makes the trigger fire once
-- per row over 203315 rows, and dropping the inline call imports raw scanner
-- output -- 27709 orders whose tracking number is a full GS1-128 barcode string
-- that no carrier site accepts. Diagnostic 9 checks it.
--
-- This script is deliberately split into five transactions rather than one.
-- ~900k rows in a single transaction on the pooler connection risks a timeout
-- that rolls back an hour of work. The cost of splitting is that an interruption
-- leaves a partially-populated schema: re-run from the top, the upserts make
-- that safe.
--
-- Timestamps: every legacy timestamp column is a naive `timestamp` recorded in
-- Australia/Sydney local time. `AT TIME ZONE 'Australia/Sydney'` reinterprets
-- them in that zone and converts to timestamptz, matching the 001 and 002
-- scripts.

-- ===========================================================================
-- 1. customers (source: go2_buyers)
-- ===========================================================================
--
-- go2_buyers is a per-order address snapshot, not a customer master: 185241 of
-- its 196085 rows serve exactly one order. Grouping by eBay username (falling
-- back to email, then to the row itself) collapses it to 178024 customers.
--
-- The group's id is min(go2_buyers.id). That choice is what makes this step
-- idempotent: a later Laravel backup only appends higher ids, so a group's
-- minimum never moves and a re-run cannot split one customer into two.
--
-- Name/email/phone come from the group's HIGHEST id, i.e. the most recent time
-- the customer ordered -- so a customer who changed their surname is stored
-- under the new one.
--
-- The address comes from the same "highest id" row. It is the customer's
-- current address, not a per-order one -- orders no longer keep a copy.

BEGIN;

-- The remote server enforces statement_timeout = 2min. The first import
-- finishes well inside that, but the final sync re-runs this script against
-- populated tables, where every INSERT takes the ON CONFLICT DO UPDATE path
-- and gets materially slower -- measured 132s before being cancelled on
-- 2026-08-02. SET LOCAL lifts the cap for this transaction only, and is
-- reverted automatically at COMMIT.
SET LOCAL statement_timeout = 0;

WITH keyed AS (
  SELECT
    b.id,
    b.buyer_userid,
    b.buyer_fullname,
    b.buyer_email,
    b.buyer_phone_number,
    b.company_name,
    b.buyer_address_1,
    b.buyer_address_2,
    b.buyer_address_3,
    b.buyer_address_4,
    b.buyer_city,
    b.buyer_state,
    b.buyer_postcode,
    b.buyer_country,
    COALESCE(
      NULLIF(lower(btrim(b.buyer_userid)), ''),
      'email:' || NULLIF(lower(btrim(b.buyer_email)), ''),
      'buyer:' || b.id::text
    ) AS dedup_key
  FROM public.go2_buyers AS b
),
grouped AS (
  SELECT dedup_key, min(id) AS customer_id
  FROM keyed
  GROUP BY dedup_key
),
latest AS (
  SELECT DISTINCT ON (dedup_key)
    dedup_key,
    buyer_userid,
    buyer_fullname,
    buyer_email,
    buyer_phone_number,
    company_name,
    buyer_address_1,
    buyer_address_2,
    buyer_address_3,
    buyer_address_4,
    buyer_city,
    buyer_state,
    buyer_postcode,
    buyer_country
  FROM keyed
  ORDER BY dedup_key, id DESC
)
INSERT INTO public.customers (
  id, platform_user_id, full_name, email, phone, is_anonymised_email,
  company_name, address_line1, address_line2, address_line3, address_line4,
  city, state, postcode, country
)
SELECT
  g.customer_id,
  NULLIF(btrim(l.buyer_userid), ''),
  NULLIF(btrim(l.buyer_fullname), ''),
  NULLIF(btrim(l.buyer_email), ''),
  NULLIF(btrim(l.buyer_phone_number), ''),
  -- 89287 rows carry an @members.ebay.com relay address. Flagged rather than
  -- discarded: it is still the only contact route eBay gives for that order.
  COALESCE(btrim(l.buyer_email) ILIKE '%@members.ebay.com', false),
  -- The address is the customer's CURRENT one -- taken from the group's highest
  -- id, i.e. the most recent time they ordered. Orders do not keep their own
  -- copy (migration 20260803170000 dropped ship_to_*), so an order placed
  -- before the customer moved will render against the new address. 8150 orders
  -- across 5483 customers are in that position. Accepted by decision; see
  -- docs/orders-domain-migration.md section 13.
  --
  -- Migrated verbatim, with no normalisation: the legacy data mixes NSW with
  -- New South Wales and AU with Australia. buyer_address_3 holds an eBay
  -- reference code (`ebay:xxxx`) on 129276 rows rather than an address line,
  -- and is kept as-is by explicit decision.
  l.company_name,
  l.buyer_address_1,
  l.buyer_address_2,
  l.buyer_address_3,
  l.buyer_address_4,
  l.buyer_city,
  l.buyer_state,
  l.buyer_postcode,
  l.buyer_country
FROM grouped AS g
JOIN latest AS l USING (dedup_key)
ON CONFLICT (id) DO UPDATE SET
  platform_user_id = EXCLUDED.platform_user_id,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  is_anonymised_email = EXCLUDED.is_anonymised_email,
  company_name = EXCLUDED.company_name,
  address_line1 = EXCLUDED.address_line1,
  address_line2 = EXCLUDED.address_line2,
  address_line3 = EXCLUDED.address_line3,
  address_line4 = EXCLUDED.address_line4,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  postcode = EXCLUDED.postcode,
  country = EXCLUDED.country;

COMMIT;

-- ===========================================================================
-- 2. orders (source: go2_orders)
-- ===========================================================================
--
-- Dropped columns:
--   payment_method -- 88100 blanks, `PayPal`/`paypal` both present, and ~15 rows
--                     holding a shipping charge ("AU $8.95"). Retired by decision.
--   total_sale     -- 0 on 61329 rows because the 2020 XOFFICE import never
--                     brought totals across. Now
--                     public.order_metrics_summary.goods_total.
--   is_atl         -- 0 on all 203315 rows.
--   est_profit     -- 0 on all 203315 rows.
--   logs           -- 1826492 lines of audit text. Retired by decision.
--   ebay_user_id   -- only ever NULL or 2, with no table to join to.
--   updated_at     -- left to the DB; it records when the row was migrated.
--
-- status and platform are cast straight into their enums with no fallback --
-- `lower(o.order_status)::public.order_status`, not a CASE table like
-- shipping_method uses. If the final backup introduces a value the enum does not
-- carry, the cast raises and this transaction rolls back -- which is the point.
-- A COALESCE to some default would file the unknown status under a wrong one and
-- nobody would find out.
--
-- public.order_status carries EIGHT values: migration 20260804100000 added the
-- whole Laravel dropdown (new, pending, unpaid, backorder, picked, labelled) on
-- top of the four this backup contains, then 20260808120000 dropped `new` and
-- 20260808130000 dropped `picked` -- both unused by this business, both zero
-- rows, and neither appears in go2_orders.order_status (COMPLETED, CANCELLED,
-- PROCESSING, ISSUED only). So the cast still resolves everything the final
-- sync brings across; a backup that suddenly produced NEW or PICKED would abort
-- this transaction, which is the intended behaviour.
--
-- Because the cast is `lower(...)` with no mapping, every enum label must be the
-- exact lowercase of its Laravel spelling. 'labelled' is British double-L,
-- matching Laravel's LABELLED; an American 'labeled' in the enum would leave the
-- cast unresolvable and abort this whole transaction -- during the final sync,
-- which is the one run where that is expensive. Same rule for any value added
-- later (CLAUDE.md rule 15).
--
-- The delivery address is NOT here -- it lives on customers (section 1). Also
-- dropped by the 20260803170000 reshape: transit_cover and parcel_zone.

BEGIN;

-- The remote server enforces statement_timeout = 2min. The first import
-- finishes well inside that, but the final sync re-runs this script against
-- populated tables, where every INSERT takes the ON CONFLICT DO UPDATE path
-- and gets materially slower -- measured 132s before being cancelled on
-- 2026-08-02. SET LOCAL lifts the cap for this transaction only, and is
-- reverted automatically at COMMIT.
SET LOCAL statement_timeout = 0;

-- The order_metrics_summary triggers (migration 20260808170000) must be off for
-- the same reason as the rebuild triggers in section 3. They are statement
-- level, so leaving them on is not 203315 firings -- it is one firing holding a
-- transition table of 203315 rows, handed to recompute_order_metrics as a single
-- bigint[]. Section 5 rebuilds the whole summary table afterwards, which is both
-- correct and far cheaper.
ALTER TABLE public.orders DISABLE TRIGGER oms_orders_insert;
ALTER TABLE public.orders DISABLE TRIGGER oms_orders_update;

-- The orders_normalize_tracking_* triggers (migration 20260808210000) are row
-- level, so unlike the summary triggers above they really would fire 203315
-- times. The SELECT below calls public.normalize_tracking_number() directly
-- instead, which produces the identical value in one pass -- so there is no
-- separate backfill to remember, and the ON CONFLICT branch carries the
-- normalised value through EXCLUDED too.
ALTER TABLE public.orders DISABLE TRIGGER orders_normalize_tracking_insert;
ALTER TABLE public.orders DISABLE TRIGGER orders_normalize_tracking_update;

WITH keyed AS (
  SELECT
    b.id,
    COALESCE(
      NULLIF(lower(btrim(b.buyer_userid)), ''),
      'email:' || NULLIF(lower(btrim(b.buyer_email)), ''),
      'buyer:' || b.id::text
    ) AS dedup_key
  FROM public.go2_buyers AS b
),
grouped AS (
  SELECT dedup_key, min(id) AS customer_id
  FROM keyed
  GROUP BY dedup_key
)
INSERT INTO public.orders (
  id, customer_id, invoice_number, status, platform,
  shipping_method, legacy_shipping_method, postage_and_handling,
  tracking_number, web_order_id, comments, posted_on_date,
  created_at
)
SELECT
  o.id,
  g.customer_id,
  o.invoice_number,
  lower(o.order_status)::public.order_status,
  lower(o.platform)::public.sales_platform,
  map.sm::public.shipping_method,
  -- Only the retired carriers land here; anything the CASE resolved is already
  -- represented by the enum column.
  CASE WHEN map.sm IS NULL THEN NULLIF(btrim(o.shipping_method), '') END,
  -- Postage is recorded per transaction line upstream and belongs to the order
  -- here, so it is summed. Read from go2_transactions rather than the migrated
  -- order_transactions because this INSERT runs before that table is populated.
  -- The 25 orders with no transaction lines land on 0.
  (
    SELECT COALESCE(sum(t.postage_and_handling), 0)
    FROM public.go2_transactions AS t
    WHERE t.order_id = o.id
  ),
  -- Raw Laravel values are whatever the barcode gun produced. Normalising here
  -- rather than letting the trigger do it is the whole point of the DISABLE
  -- above; see migration 20260808210000 for what the function strips.
  public.normalize_tracking_number(o.tracking_number),
  o.web_order_id,
  o.comments,
  (o.posted_on_date AT TIME ZONE 'Australia/Sydney'),
  -- created_at is NULL on 61285 rows (the 2020 XOFFICE import). Falling back
  -- through dispatch date, then the earliest sale on the order, keeps those
  -- orders in roughly the right place on a timeline instead of collapsing them
  -- all onto the migration date.
  --
  -- The final literal is reached by exactly one row (measured 2026-08-02): order
  -- 18639, invoice 180048CF -- a CANCELLED eBay order with no dispatch date and
  -- no transaction lines, so nothing anywhere dates it. 2018-01-01 is a guess
  -- consistent with its invoice number; it is not a real timestamp.
  COALESCE(
    (o.created_at AT TIME ZONE 'Australia/Sydney'),
    (o.posted_on_date AT TIME ZONE 'Australia/Sydney'),
    (
      SELECT min(t.sale_date) AT TIME ZONE 'Australia/Sydney'
      FROM public.go2_transactions AS t
      WHERE t.order_id = o.id
    ),
    TIMESTAMPTZ '2018-01-01 00:00:00+11'
  )
FROM public.go2_orders AS o
JOIN keyed AS k ON k.id = o.buyer_id
JOIN grouped AS g ON g.dedup_key = k.dedup_key
CROSS JOIN LATERAL (
  -- The 16 legacy values that have a home in the new enum (173797 orders).
  -- The nine that do not -- Letter aside, all retired carriers -- fall through
  -- to NULL and are picked up by legacy_shipping_method above.
  SELECT CASE o.shipping_method
    WHEN 'Letter'            THEN 'Letter'
    WHEN 'Registered Letter' THEN 'Register_Letter'
    WHEN 'Register Letter'   THEN 'Register_Letter'   -- legacy typo, 2 rows
    WHEN 'Parcel Post'       THEN 'Parcel_Post'
    WHEN 'Express Post'      THEN 'Express_Post'
    WHEN 'eParcel Regular'   THEN 'Eparcel_Regular'
    WHEN 'eParcel 500g'      THEN 'Eparcel_Regular'   -- no weight tier in the new enum
    WHEN 'eParcel Express'   THEN 'Eparcel_Express'
    WHEN 'Mypost Express'    THEN 'Mypost_Express'
    WHEN 'Mypost S-Box'      THEN 'Mypost_Reg_S_Box'  -- no tier recorded, Regular assumed
    WHEN 'Mypost M-Box'      THEN 'Mypost_Reg_M_Box'
    WHEN 'Mypost L-Box'      THEN 'Mypost_Reg_L_Box'
    WHEN 'MyExpress S-Box'   THEN 'Mypost_Exp_S_Box'
    WHEN 'MyExpress M-Box'   THEN 'Mypost_Exp_M_Box'
    WHEN 'Click&Send'        THEN 'Click_and_Collect'
    WHEN 'Store Delivery'    THEN 'Store_Delivery'
  END AS sm
) AS map
ON CONFLICT (id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  invoice_number = EXCLUDED.invoice_number,
  status = EXCLUDED.status,
  platform = EXCLUDED.platform,
  shipping_method = EXCLUDED.shipping_method,
  legacy_shipping_method = EXCLUDED.legacy_shipping_method,
  postage_and_handling = EXCLUDED.postage_and_handling,
  tracking_number = EXCLUDED.tracking_number,
  web_order_id = EXCLUDED.web_order_id,
  comments = EXCLUDED.comments,
  posted_on_date = EXCLUDED.posted_on_date,
  created_at = EXCLUDED.created_at;

ALTER TABLE public.orders ENABLE TRIGGER oms_orders_insert;
ALTER TABLE public.orders ENABLE TRIGGER oms_orders_update;
ALTER TABLE public.orders ENABLE TRIGGER orders_normalize_tracking_insert;
ALTER TABLE public.orders ENABLE TRIGGER orders_normalize_tracking_update;

COMMIT;

-- ===========================================================================
-- 3. order_transactions + order_items, WITH THE REBUILD TRIGGERS DISABLED
-- ===========================================================================
--
-- See the DANGER block at the top of this file. Both triggers must be off for
-- the whole of this transaction; DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock
-- and is rolled back with everything else if this transaction fails, so the
-- pairing is safe -- but only because it is all one transaction.

BEGIN;

-- The remote server enforces statement_timeout = 2min. The first import
-- finishes well inside that, but the final sync re-runs this script against
-- populated tables, where every INSERT takes the ON CONFLICT DO UPDATE path
-- and gets materially slower -- measured 132s before being cancelled on
-- 2026-08-02. SET LOCAL lifts the cap for this transaction only, and is
-- reverted automatically at COMMIT.
SET LOCAL statement_timeout = 0;

ALTER TABLE public.order_transactions
  DISABLE TRIGGER order_transactions_rebuild_items_insert;
ALTER TABLE public.order_transactions
  DISABLE TRIGGER order_transactions_rebuild_items_update;

-- The six order_metrics_summary triggers on these two tables, off for the same
-- reason (see section 2's note). Section 5 rebuilds the summary afterwards.
ALTER TABLE public.order_transactions DISABLE TRIGGER oms_transactions_insert;
ALTER TABLE public.order_transactions DISABLE TRIGGER oms_transactions_update;
ALTER TABLE public.order_transactions DISABLE TRIGGER oms_transactions_delete;
ALTER TABLE public.order_items        DISABLE TRIGGER oms_items_insert;
ALTER TABLE public.order_items        DISABLE TRIGGER oms_items_update;
ALTER TABLE public.order_items        DISABLE TRIGGER oms_items_delete;

-- 3a. order_transactions (source: go2_transactions)
--
-- Dropped columns: ebay_user_id (only 0 or 2, no table to join to), plus three
-- removed by the 20260803170000 reshape -- postage_and_handling (summed onto
-- the order in section 2), paypal_transaction_id_number and notes_to_yourself.
--
-- The EXISTS guard skips lines whose order is missing from public.orders. As of
-- 2026-08-02 this filters out 0 of 250413 rows; the guard exists so the final
-- sync degrades to "skip the offending line" instead of aborting on a foreign
-- key violation.
INSERT INTO public.order_transactions (
  id, order_id, item_title, item_number, custom_label, quantity,
  sale_price, sale_date, paid_on_date, postage_service,
  sales_record_number, order_id_ebay, transaction_id_ebay,
  click_and_collect_reference, private_field
)
SELECT
  t.id,
  t.order_id,
  t.item_title,
  t.item_number,
  t.custom_label,
  t.quantity,
  COALESCE(t.sale_price, 0),
  (t.sale_date AT TIME ZONE 'Australia/Sydney'),
  (t.paid_on_date AT TIME ZONE 'Australia/Sydney'),
  t.postage_service,
  t.sales_record_number,
  t.order_id_ebay,
  t.transaction_id_ebay,
  t.click_and_collect_reference,
  t.private_field
FROM public.go2_transactions AS t
WHERE EXISTS (SELECT 1 FROM public.orders AS o WHERE o.id = t.order_id)
ON CONFLICT (id) DO UPDATE SET
  order_id = EXCLUDED.order_id,
  item_title = EXCLUDED.item_title,
  item_number = EXCLUDED.item_number,
  custom_label = EXCLUDED.custom_label,
  quantity = EXCLUDED.quantity,
  sale_price = EXCLUDED.sale_price,
  sale_date = EXCLUDED.sale_date,
  paid_on_date = EXCLUDED.paid_on_date,
  postage_service = EXCLUDED.postage_service,
  sales_record_number = EXCLUDED.sales_record_number,
  order_id_ebay = EXCLUDED.order_id_ebay,
  transaction_id_ebay = EXCLUDED.transaction_id_ebay,
  click_and_collect_reference = EXCLUDED.click_and_collect_reference,
  private_field = EXCLUDED.private_field;

-- 3b. order_items (source: go2_transactions_products)
--
-- Dropped columns:
--   order_id    -- fully redundant; it disagrees with the parent transaction's
--                  order_id on 0 of 250687 rows.
--   pack_status -- NULL on every row.
--
-- product_id is resolved by LEFT JOIN, not by a filter: 334 rows point at 15
-- products Laravel soft-deleted, and those rows are sales history that must not
-- disappear. They land with product_id NULL and their SKU in sku_snapshot.
--
-- sku_snapshot comes from go2_products (which still holds the soft-deleted rows)
-- rather than public.products, so those 334 rows keep an identifiable SKU.
--
-- pick_location is free text upstream; all 28893 non-null values match a
-- locations.name exactly, so the LEFT JOIN resolves them to real ids.
--
-- is_auto_generated is false: these rows are Laravel's record of what shipped,
-- not something this system computed. Diagnostic 6 relies on that.
INSERT INTO public.order_items (
  id, transaction_id, product_id, sku_snapshot, quantity, location_id,
  is_auto_generated
)
SELECT
  tp.id,
  tp.transaction_id,
  p.id,
  gp.sku,
  tp.quantity,
  l.id,
  false
FROM public.go2_transactions_products AS tp
LEFT JOIN public.products AS p ON p.id = tp.product_id
LEFT JOIN public.go2_products AS gp ON gp.id = tp.product_id
LEFT JOIN public.locations AS l ON l.name = tp.pick_location
WHERE EXISTS (
  SELECT 1 FROM public.order_transactions AS ot WHERE ot.id = tp.transaction_id
)
ON CONFLICT (id) DO UPDATE SET
  transaction_id = EXCLUDED.transaction_id,
  product_id = EXCLUDED.product_id,
  sku_snapshot = EXCLUDED.sku_snapshot,
  quantity = EXCLUDED.quantity,
  location_id = EXCLUDED.location_id,
  is_auto_generated = EXCLUDED.is_auto_generated;

ALTER TABLE public.order_transactions
  ENABLE TRIGGER order_transactions_rebuild_items_insert;
ALTER TABLE public.order_transactions
  ENABLE TRIGGER order_transactions_rebuild_items_update;

ALTER TABLE public.order_transactions ENABLE TRIGGER oms_transactions_insert;
ALTER TABLE public.order_transactions ENABLE TRIGGER oms_transactions_update;
ALTER TABLE public.order_transactions ENABLE TRIGGER oms_transactions_delete;
ALTER TABLE public.order_items        ENABLE TRIGGER oms_items_insert;
ALTER TABLE public.order_items        ENABLE TRIGGER oms_items_update;
ALTER TABLE public.order_items        ENABLE TRIGGER oms_items_delete;

COMMIT;

-- ===========================================================================
-- 4. Sequences
-- ===========================================================================
-- Reset identity sequences past the highest migrated id so future app-created
-- rows never collide with migrated ids.

BEGIN;

-- The remote server enforces statement_timeout = 2min. The first import
-- finishes well inside that, but the final sync re-runs this script against
-- populated tables, where every INSERT takes the ON CONFLICT DO UPDATE path
-- and gets materially slower -- measured 132s before being cancelled on
-- 2026-08-02. SET LOCAL lifts the cap for this transaction only, and is
-- reverted automatically at COMMIT.
SET LOCAL statement_timeout = 0;

SELECT setval(pg_get_serial_sequence('public.customers', 'id'),          COALESCE((SELECT MAX(id) FROM public.customers), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.orders', 'id'),             COALESCE((SELECT MAX(id) FROM public.orders), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.order_transactions', 'id'), COALESCE((SELECT MAX(id) FROM public.order_transactions), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.order_items', 'id'),        COALESCE((SELECT MAX(id) FROM public.order_items), 0) + 1, false);

COMMIT;

-- ===========================================================================
-- 5. Rebuild order_metrics_summary
-- ===========================================================================
-- Sections 2 and 3 ran with the summary triggers disabled, so every metric in
-- public.order_metrics_summary is now stale or missing. This is not optional
-- cleanup: skipping it leaves the order screens reporting the totals, weights
-- and sizes from before the import, with nothing to indicate they are stale.
--
-- A full pass rather than a targeted one -- the import touches every order, and
-- recompute_order_metrics(NULL) also lifts its own statement_timeout. Measured
-- at 31s over 203315 orders on 2026-08-08.

BEGIN;

SET LOCAL statement_timeout = 0;

SELECT public.recompute_order_metrics(NULL);

COMMIT;

-- ---------------------------------------------------------------------------
-- Diagnostics -- run manually after the script to confirm the outcome.
-- Do not skip these on the final sync run: every one of them is a case that
-- fails silently (rows vanish or numbers change) rather than raising an error.
-- ---------------------------------------------------------------------------
--
-- 1. Rows skipped by the EXISTS guards (expected: 0 and 0):
--
-- SELECT
--   (SELECT count(*) FROM public.go2_transactions t
--     WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = t.order_id)) AS transactions_skipped,
--   (SELECT count(*) FROM public.go2_transactions_products tp
--     WHERE NOT EXISTS (SELECT 1 FROM public.order_transactions ot WHERE ot.id = tp.transaction_id)) AS items_skipped;
--
-- 2. order_items that could not resolve a product (measured 2026-08-02 after
--    re-running 001: 313 rows across 14 SKUs, 331 units, all soft-deleted in
--    Laravel). Note this is 21 rows fewer than the 334 surveyed before 001 was
--    re-run: product 3 (GB00002AF) had been restored in Laravel, so re-running
--    001 carried it across and those 21 lines now resolve. A materially larger
--    number means more in-use products were soft-deleted before the freeze --
--    decide per SKU whether to un-delete it so 001 carries it across:
--
-- SELECT sku_snapshot, count(*) AS lines, sum(quantity) AS units
-- FROM public.order_items
-- WHERE product_id IS NULL
-- GROUP BY sku_snapshot
-- ORDER BY lines DESC;
--
-- 3. Pick locations that failed to resolve (expected: 0). A non-zero count means
--    a location was renamed or dropped between 003 and here, and those rows lost
--    their pick location silently:
--
-- SELECT tp.pick_location, count(*)
-- FROM public.go2_transactions_products tp
-- JOIN public.order_items oi ON oi.id = tp.id
-- WHERE tp.pick_location IS NOT NULL
--   AND btrim(tp.pick_location) <> ''
--   AND oi.location_id IS NULL
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- 4. Customer dedup ratio (expected as of 2026-08-02: 196085 -> 178024). A ratio
--    far from 0.908 means buyer_userid/email quality changed and the grouping is
--    no longer behaving as designed:
--
-- SELECT (SELECT count(*) FROM public.go2_buyers) AS source_rows,
--        (SELECT count(*) FROM public.customers) AS customers,
--        round((SELECT count(*) FROM public.customers)::numeric
--              / NULLIF((SELECT count(*) FROM public.go2_buyers), 0), 4) AS ratio;
--
-- 5. Orders whose shipping method fell through to the legacy column
--    (expected: 29143 rows, and ONLY these seven values -- Zone6 Regular,
--    Sendle, Winit, Fast Track, Zone6 Express, Toll B2C, Sendle 250g).
--    An eighth value means the final backup introduced a shipping method nobody
--    has decided about yet:
--
-- SELECT legacy_shipping_method, count(*)
-- FROM public.orders
-- WHERE legacy_shipping_method IS NOT NULL
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- 6. !! The trigger check !! Rows the rebuild triggers generated during the
--    migration (expected: 0). Anything above zero means section 3 ran with the
--    triggers live: the migrated history has been overwritten from today's BOM
--    and the pick locations are gone. Restore and re-run -- this is not
--    repairable in place:
--
-- SELECT count(*) AS trigger_generated_rows
-- FROM public.order_items
-- WHERE is_auto_generated;
--
-- 7. Field-by-field check against the source.
--
--    Expected: 0 for every text/integer/enum column, but NOT necessarily zero
--    for the money columns. sale_price and the summed postage are numeric(12,2)
--    here against numeric(19,4) upstream, so values carrying a third or fourth
--    decimal are rounded to the cent. Measured 2026-08-02 (before the reshape,
--    when transit_cover still existed): 3502 transit_cover rows and 1 sale_price
--    row differed, totalling 8.90 across 3.2M in sales -- half a cent overall.
--    Those sub-cent digits are Laravel's intermediate postage arithmetic, not
--    money anyone was charged. If a future run reports a materially larger
--    drift, the source has started carrying real precision below the cent and
--    the column types need revisiting.
--
--    Note tracking_number is NOT compared raw: section 2 normalises it, so 27686
--    rows legitimately differ from the source. The function has to be applied to
--    the source side for the comparison to mean anything. Comparing raw here
--    would report a five-figure mismatch count on a correct import.
--
-- SELECT count(*) AS order_mismatches
-- FROM public.go2_orders o
-- JOIN public.orders n ON n.id = o.id
-- WHERE n.invoice_number IS DISTINCT FROM o.invoice_number
--    OR n.status::text IS DISTINCT FROM lower(o.order_status)
--    OR n.platform::text IS DISTINCT FROM lower(o.platform)
--    OR n.tracking_number IS DISTINCT FROM public.normalize_tracking_number(o.tracking_number)
--    OR n.web_order_id IS DISTINCT FROM o.web_order_id
--    OR n.postage_and_handling IS DISTINCT FROM
--       (SELECT COALESCE(sum(t.postage_and_handling), 0) FROM public.go2_transactions t WHERE t.order_id = o.id);
--
--    Customer address check (expected: 0). Each customer must carry the address
--    from the highest-id go2_buyers row in their dedup group:
--
-- WITH keyed AS (
--   SELECT b.*, COALESCE(NULLIF(lower(btrim(b.buyer_userid)),''),
--                        'email:'||NULLIF(lower(btrim(b.buyer_email)),''),
--                        'buyer:'||b.id::text) AS dk
--   FROM public.go2_buyers b
-- ), latest AS (SELECT DISTINCT ON (dk) * FROM keyed ORDER BY dk, id DESC),
--    grouped AS (SELECT dk, min(id) AS cid FROM keyed GROUP BY dk)
-- SELECT count(*) AS customer_address_mismatches
-- FROM grouped g JOIN latest l USING (dk) JOIN public.customers c ON c.id = g.cid
-- WHERE c.address_line1 IS DISTINCT FROM l.buyer_address_1
--    OR c.city IS DISTINCT FROM l.buyer_city
--    OR c.state IS DISTINCT FROM l.buyer_state
--    OR c.postcode IS DISTINCT FROM l.buyer_postcode
--    OR c.country IS DISTINCT FROM l.buyer_country;
--
-- SELECT count(*) AS transaction_mismatches
-- FROM public.go2_transactions t JOIN public.order_transactions n ON n.id = t.id
-- WHERE n.order_id IS DISTINCT FROM t.order_id
--    OR n.quantity IS DISTINCT FROM t.quantity
--    OR n.custom_label IS DISTINCT FROM t.custom_label
--    OR n.sale_price IS DISTINCT FROM COALESCE(t.sale_price, 0);
--
-- SELECT count(*) AS item_mismatches
-- FROM public.go2_transactions_products tp JOIN public.order_items n ON n.id = tp.id
-- WHERE n.transaction_id IS DISTINCT FROM tp.transaction_id
--    OR n.quantity IS DISTINCT FROM tp.quantity;
--
-- 8. Headline totals (expected as of 2026-08-02: 178024 customers;
--    203315 orders; 250413 transactions; 250687 items):
--
-- SELECT (SELECT count(*) FROM public.customers) AS customers,
--        (SELECT count(*) FROM public.orders) AS orders,
--        (SELECT count(*) FROM public.order_transactions) AS transactions,
--        (SELECT count(*) FROM public.order_items) AS items,
--        (SELECT sum(order_total) FROM public.order_metrics_summary) AS gross_sales;
--
-- 8a. !! The summary check !! Section 5 must have rebuilt every row (expected:
--     one summary row per order, and no row computed before the import ran).
--     A shortfall or an old computed_at means section 5 was skipped: the order
--     screens are showing pre-import numbers and nothing on them says so.
--
-- SELECT (SELECT count(*) FROM public.orders) AS orders,
--        (SELECT count(*) FROM public.order_metrics_summary) AS summary_rows,
--        (SELECT min(computed_at) FROM public.order_metrics_summary) AS oldest_computed_at;
--
-- 9. Status distribution. As of 2026-08-02 the backup carries only four of the
--    eight values (completed 202778, cancelled 527, processing 9, issued 1); the
--    other four exist because the Laravel dropdown offers them, not because any
--    order was sitting in one. A final sync that brings across pending, unpaid,
--    backorder or labelled is expected and fine -- this query just makes it
--    visible rather than surprising:
--
-- SELECT status, count(*) FROM public.orders GROUP BY 1 ORDER BY 2 DESC;
--
-- 10. !! The tracking check !! Every tracking number must already be at the
--     function's fixed point (expected: 0). Anything above zero means section 2
--     ran without the inline normalize_tracking_number() call -- the triggers
--     were disabled, so nothing put it back. The import does not fail; the
--     tracking column just fills up with 41-to-74 character scanner output that
--     no carrier site accepts and no one can read off the order screen.
--
--     Note this asks for idempotency, NOT "no barcode envelopes remain". 353
--     rows keep their envelope legitimately -- the function has no cut for their
--     article format and returns them unchanged rather than guessing -- so they
--     are at their fixed point and pass. A `~ '01[0-9]{14}91'` test would flag
--     those 353 forever and train everyone to ignore the check.
--
-- SELECT count(*) AS unnormalised
-- FROM public.orders
-- WHERE tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number);
--
--     The uncut rows themselves (measured 2026-08-08: 591 longer than 25 chars,
--     of which 362 are Parcel_Post barcodes with an unestablished article format
--     and 132 are Letter numbers scanned twice). Known and accepted, not a
--     failure -- see docs/order-tracking-number.md section 4. A jump here means
--     a new label format appeared and the function needs a branch for it:
--
-- SELECT coalesce(shipping_method::text, legacy_shipping_method, '(none)') AS method,
--        count(*) AS uncut_rows
-- FROM public.orders
-- WHERE length(tracking_number) > 25
-- GROUP BY 1 ORDER BY 2 DESC;
