BEGIN;

-- The backfill below rewrites 27,686 rows in one statement. The remote
-- statement_timeout is 2 minutes (CLAUDE.md rule 15).
SET LOCAL statement_timeout = 0;

-- Tracking-number normalisation on public.orders, ported in mechanism -- but not
-- in rules -- from the xpros trigger `fn_sales_order_preprocessing` (its
-- module 2, itself a merge of an older `fn_clean_tracking_number`).
--
-- WHAT THE PROBLEM IS
--
-- The warehouse scans the carrier label with a barcode gun. On an Australia Post
-- label the scannable symbol is a GS1-128 barcode carrying the whole data
-- string, not just the article ID a human would read off the label:
--
--   01 99312650999998 91 33GLH0018038 010009308 08
--   ^^ ^^^^^^^^^^^^^^ ^^ ^^^^^^^^^^^^
--   |  |              |  the article ID -- the only part anyone wants
--   |  |              AI(91), company internal
--   |  our GTIN-14
--   AI(01)
--
-- So the column ends up holding a 41-, 56-, 64- or 74-character string that no
-- carrier tracking page accepts and that no human recognises. 27,709 of 198,391
-- non-empty tracking numbers (14%) were in this state when this was written.
-- Some rows are worse: 479 were scanned twice, so a clean article ID has a full
-- barcode string glued onto the end of it.
--
-- HOW THIS DIFFERS FROM THE XPROS VERSION
--
-- xpros matches hard-coded substrings ('S8P', '33RCA', '34HA9', '34HAA') and
-- branches on shipping_method. Neither travels:
--
--   * 33RCA / 34HA9 / 34HAA are the xpros eParcel charge-account prefixes.
--     They match ZERO rows here. This project's prefix is 33GLH.
--   * S8P matches 1,084 rows here, all of which are already the clean 10-char
--     value -- the rule would be a no-op.
--   * Branching on shipping_method is unreliable. xpros extracts MyPost numbers
--     via `shipping_method LIKE '%Mypost%'`, which would catch 2,245 rows here
--     while the barcode content itself identifies 2,920. The 675-row gap is
--     orders shipped on MyPost but recorded under another method.
--
-- This version keys off the barcode structure instead: find the AI(01)+AI(91)
-- envelope anywhere in the string, then cut the article ID by its own prefix.
-- One rule covers all 27,709 rows regardless of what shipping_method says.

CREATE FUNCTION public.normalize_tracking_number(p_tracking text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
-- Pure: it reads no tables, so there is nothing to escalate. IMMUTABLE is
-- accurate (same input, same output, no catalogue lookups) and lets the planner
-- fold it in the backfill's WHERE clause.
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_raw  text;
  v_rest text;
BEGIN
  -- An all-whitespace tracking number is the same absence of information as
  -- NULL; collapsing the two keeps `tracking_number IS NULL` a reliable test.
  -- 79 rows held the empty string.
  v_raw := nullif(btrim(coalesce(p_tracking, '')), '');
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Everything after the AI(91) marker. Matching anywhere in the string rather
  -- than anchoring at the start is what fixes the double-scan rows, where the
  -- envelope starts partway in. Returns NULL when there is no barcode envelope
  -- at all, which is the common case -- most rows are already clean.
  v_rest := substring(v_raw from '01[0-9]{14}91(.*)$');
  IF v_rest IS NULL THEN
    RETURN v_raw;
  END IF;

  -- The article ID's length is a property of the carrier product, not of the
  -- barcode, so each family needs its own cut. Lengths below are the observed
  -- clean values for this account, each holding for >99% of the rows already
  -- stored in short form.
  RETURN CASE
    -- eParcel consignment, 12 chars. 33GLH is the live charge account.
    WHEN v_rest LIKE '33GLH%' THEN left(v_rest, 12)
    -- 33HKT is a retired account -- no new orders will carry it. Kept only
    -- because 3,026 historical rows are still stored as full barcode strings
    -- and would otherwise stay unreadable forever. Safe to drop once those are
    -- no longer of interest.
    WHEN v_rest LIKE '33HKT%' THEN left(v_rest, 12)
    -- Registered post articles, 25 chars.
    WHEN v_rest LIKE 'TMP%'   THEN left(v_rest, 25)
    WHEN v_rest LIKE 'RPP%'   THEN left(v_rest, 25)
    -- MyPost article, 23 chars.
    WHEN v_rest LIKE '99%'    THEN left(v_rest, 23)
    -- An envelope we do not have a cut for. Returning the original is the only
    -- safe answer: a wrong cut destroys the number, while an uncut one is at
    -- least still the complete data. 591 rows land here, 362 of them
    -- Parcel_Post barcodes beginning '030' whose article format has not been
    -- established, and 132 Letter rows that are a 13-char number scanned twice
    -- with no envelope at all. See docs/order-tracking-number.md section 4.
    ELSE v_raw
  END;
END;
$$;

-- Note this is IMMUTABLE and used in an index-free context only. If it is ever
-- put in an index expression, changing any rule above silently corrupts that
-- index until it is REINDEXed.

CREATE FUNCTION public.trg_normalize_order_tracking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.tracking_number := public.normalize_tracking_number(NEW.tracking_number);
  RETURN NEW;
END;
$$;

-- Two triggers rather than one BEFORE INSERT OR UPDATE. A WHEN clause cannot
-- reference TG_OP, and OLD does not exist during an INSERT, so the single-
-- trigger form has no way to express "guard on change, but only for updates".
CREATE TRIGGER orders_normalize_tracking_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_normalize_order_tracking();

-- The UPDATE OF clause plus the WHEN guard keep this off the hot path: an edit
-- to comments, status or postage does not re-run it. Normalising is idempotent
-- so re-running would be harmless -- the guard is about not doing the work.
CREATE TRIGGER orders_normalize_tracking_update
  BEFORE UPDATE OF tracking_number ON public.orders
  FOR EACH ROW
  WHEN (NEW.tracking_number IS DISTINCT FROM OLD.tracking_number)
  EXECUTE FUNCTION public.trg_normalize_order_tracking();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- As in migration 20260808140000: a normalisation pass is not a business edit
-- and must not stamp today's date on 27,686 orders.
ALTER TABLE public.orders DISABLE TRIGGER orders_set_updated_at;

-- oms_orders_update stays enabled on purpose. It is statement-level and fires on
-- any column, but trg_oms_orders() only recomputes when postage_and_handling,
-- discount or postage_paid changed -- so this pass costs one join over the
-- transition table and recomputes nothing.
UPDATE public.orders
SET tracking_number = public.normalize_tracking_number(tracking_number)
WHERE tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number);

ALTER TABLE public.orders ENABLE TRIGGER orders_set_updated_at;

COMMIT;
