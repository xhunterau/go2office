BEGIN;

SET LOCAL statement_timeout = 0;

-- Fixes a porting mistake in 20260808210000.
--
-- WHAT WAS WRONG
--
-- The original version required a GS1-128 envelope -- the AI(01) + GTIN-14 +
-- AI(91) preamble -- to be present before it would look at the article prefix
-- at all:
--
--   v_rest := substring(v_raw from '01[0-9]{14}91(.*)$');
--   IF v_rest IS NULL THEN RETURN v_raw; END IF;   -- gave up here
--   ... only now check for 33GLH / TMP / ...
--
-- The xpros original this was ported from imposes no such precondition. It
-- locates the article prefix itself with STRPOS, anywhere in the string, and
-- cuts from that position:
--
--   WHEN STRPOS(tracking_number, '33RCA') > 0
--        THEN SUBSTRING(tracking_number FROM STRPOS(tracking_number, '33RCA') FOR 12)
--
-- The envelope requirement was an invention of the port, and it silently
-- skipped every scan that captured only the data after AI(91) -- a string like
-- '33GLH003571701000930809' has the live charge-account prefix sitting at
-- position 1 and was still returned untouched. 190 rows were affected,
-- including ones the envelope form could never have reached:
--
--   'Clements  33HKT0001001'            -> a name glued in front
--   '260313CCRPP4463700510020894214606' -> an invoice ref glued in front
--   '33GLH0017903  PARCEL POST +'       -> trailing label text (31 rows)
--   E'\t33GLH0000860\t'                 -> tab-wrapped
--
-- WHY 99 STILL NEEDS THE ENVELOPE
--
-- MyPost articles begin '99', which is two digits, not a distinctive token.
-- STRPOS(x, '99') would fire on any tracking number that merely contains '99'
-- somewhere and cut from that offset, destroying it. So this family keeps the
-- envelope test, plus a start-anchored fallback for the envelope-less form.
-- That asymmetry is the whole reason the branches below are ordered the way
-- they are: the unambiguous alphabetic prefixes are resolved first, and '99' is
-- only ever considered once they have all missed.

CREATE OR REPLACE FUNCTION public.normalize_tracking_number(p_tracking text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_raw  text;
  v_pos  int;
  v_rest text;
BEGIN
  -- An all-whitespace tracking number is the same absence of information as
  -- NULL; collapsing the two keeps `tracking_number IS NULL` a reliable test.
  v_raw := nullif(btrim(coalesce(p_tracking, '')), '');
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- eParcel consignment, 12 chars. 33GLH is the live charge account; 33HKT is a
  -- retired one, kept only because ~6,000 historical rows still carry it.
  -- Searching anywhere rather than anchoring is what recovers the double-scan
  -- rows and the ones with a name or invoice ref glued on the front.
  v_pos := strpos(v_raw, '33GLH');
  IF v_pos = 0 THEN
    v_pos := strpos(v_raw, '33HKT');
  END IF;
  IF v_pos > 0 THEN
    RETURN substring(v_raw from v_pos for 12);
  END IF;

  -- Registered post articles, 25 chars.
  v_pos := strpos(v_raw, 'TMP');
  IF v_pos = 0 THEN
    v_pos := strpos(v_raw, 'RPP');
  END IF;
  IF v_pos > 0 THEN
    RETURN substring(v_raw from v_pos for 25);
  END IF;

  -- MyPost, 23 chars. Everything after the AI(91) marker.
  v_rest := substring(v_raw from '01[0-9]{14}91(.*)$');
  IF v_rest IS NOT NULL THEN
    IF v_rest LIKE '99%' THEN
      RETURN left(v_rest, 23);
    END IF;
    -- An envelope whose article family we have no cut for. Returning the
    -- original is the only safe answer: a wrong cut destroys the number, an
    -- uncut one is at least still complete data. 320 of these are Parcel_Post
    -- barcodes beginning '030', whose article format has never been
    -- established. See docs/order-tracking-number.md section 4.
    RETURN v_raw;
  END IF;

  -- Envelope-less MyPost. Anchored at the start on purpose -- see the note above
  -- on why STRPOS cannot be used for this family.
  IF v_raw LIKE '99%' AND length(v_raw) > 23 THEN
    RETURN left(v_raw, 23);
  END IF;

  RETURN v_raw;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- As in 20260808140000 and 20260808210000: a normalisation pass is not a
-- business edit and must not stamp today's date on the rows it touches.
ALTER TABLE public.orders DISABLE TRIGGER orders_set_updated_at;

-- 190 rows as measured against the live table. oms_orders_update stays enabled:
-- it is statement-level and trg_oms_orders() only recomputes when postage,
-- discount or postage_paid changed, so this costs one join and recomputes
-- nothing.
UPDATE public.orders
SET tracking_number = public.normalize_tracking_number(tracking_number)
WHERE tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number);

ALTER TABLE public.orders ENABLE TRIGGER orders_set_updated_at;

COMMIT;
