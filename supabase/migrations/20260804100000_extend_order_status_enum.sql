BEGIN;

-- Extend public.order_status from the four values the legacy DATA happened to
-- contain to the ten the legacy SYSTEM actually offered.
--
-- Migration 20260803100000 derived this enum from the values present in
-- go2_orders (COMPLETED 202778, CANCELLED 527, PROCESSING 9, ISSUED 1) and
-- called that "a closed set with no surprises". It was a closed set of what had
-- been *recorded*, not of what could be *chosen*: the Laravel status dropdown
-- offers ten options, and the six missing ones are simply states no order
-- happened to be sitting in when the final backup was taken.
--
-- Adding them now rather than on first use, because the alternative is
-- discovering it during the final production sync -- where an unmapped value
-- aborts the whole 004 transaction (that cast is deliberately unforgiving; see
-- scripts/migration/004_orders_data.sql section 2).
--
-- ---------------------------------------------------------------------------
-- Spelling is load-bearing
-- ---------------------------------------------------------------------------
-- 004 maps the legacy column with `lower(o.order_status)::public.order_status`
-- -- a straight cast, not a CASE table like shipping_method uses. So every
-- label here must be the exact lowercase of its Laravel counterpart.
--
-- In particular 'labelled' is the British double-L spelling, because Laravel's
-- value is LABELLED. Writing 'labeled' here would leave the cast with nothing
-- to resolve and abort the final sync -- an error that surfaces only during the
-- one run that matters.
--
-- ---------------------------------------------------------------------------
-- Order
-- ---------------------------------------------------------------------------
-- Enum sort order drives ORDER BY status and every comparison, and changing it
-- later means rebuilding the type and rewriting all 203315 rows. It is set here
-- to the business lifecycle rather than to the order of the Laravel dropdown
-- (which has LABELLED dangling after CANCELLED -- the shape of a value appended
-- years later, not of one that belongs at the end):
--
--   new -> pending -> unpaid -> backorder -> processing -> picked
--       -> labelled -> issued -> completed -> cancelled
--
-- The two blocked states (unpaid, backorder) sit before processing because that
-- is where an order stalls; labelled sits between picked and issued because a
-- parcel is labelled after it is picked and before it goes out.
--
-- Each ADD VALUE is positioned explicitly. Repeating BEFORE 'processing' is
-- correct and not a copy-paste slip: each new label lands immediately before
-- 'processing', i.e. after the ones already inserted there.
--
-- ---------------------------------------------------------------------------
-- Why this file only adds values
-- ---------------------------------------------------------------------------
-- Postgres 12+ allows ALTER TYPE ... ADD VALUE inside a transaction block (this
-- server is 17.6), but a value added in a transaction cannot be USED until that
-- transaction commits. So nothing here may reference the new labels -- no
-- UPDATE, no CHECK, no DEFAULT. Anything needing them goes in a later
-- migration.
--
-- Note also that adding an enum value is effectively permanent: there is no
-- DROP VALUE, and removing one means rebuilding the type.

ALTER TYPE public.order_status ADD VALUE 'new'       BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'pending'   BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'unpaid'    BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'backorder' BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'picked'    AFTER  'processing';
ALTER TYPE public.order_status ADD VALUE 'labelled'  AFTER  'picked';

-- No DEFAULT is added to orders.status. An order synced from eBay may arrive
-- already dispatched, so defaulting it to 'new' would be wrong more often than
-- it would be convenient; NOT NULL with no default forces the caller to state
-- which of the ten it is.
--
-- 'backorder' now exists in two enums: here it means "waiting on stock", while
-- sales_platform.backorder is a sales channel carried by 3878 historical
-- orders. Postgres keeps them apart; the UI has to as well (see
-- docs/orders-ui.md section 4.2).

COMMIT;
