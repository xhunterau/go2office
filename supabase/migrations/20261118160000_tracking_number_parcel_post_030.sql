BEGIN;

SET LOCAL statement_timeout = 0;

-- Adds the Parcel Post '030' article family to normalize_tracking_number().
--
-- WHAT WAS MISSING
--
-- Prepaid Parcel Post / Express Post labels scan as a GS1-128 string such as
--
--   01 99312650999998 91 0301009140791006320990 8008 230201015941
--   AI GTIN-14        AI article ID (22)        AI production date-time
--
-- 20260808210000 left these uncut because the article format "had never been
-- established", so every Parcel Post dispatched through /fulfillment/dispatch
-- was stored as the full 56-character scan -- and order 26033158 pushed that
-- string to Shopify as its tracking number (rule 27).
--
-- WHY 22 IS NOT A GUESS
--
-- xpros cuts these at 22 (SUBSTRING FROM 19 FOR 22), and the data confirms the
-- boundary independently: of the 367 enveloped rows whose AI(91) field starts
-- '030', 366 are exactly '030' + 19 digits followed by AI(8008) and its 12
-- digits, and all 171 '030' rows already stored clean are 22 characters long.
--
-- WHY THE PATTERN IS STRICT
--
-- The branch fires only when the 22 characters are followed by AI(8008) or by
-- the end of the string. That is a structural match, not a prefix cut: the two
-- 2024 rows that do not have this shape are returned unchanged, because a
-- wrong cut destroys the number while an uncut one is still complete data.
-- '030' is matched only after the AI(91) marker, never with STRPOS -- like
-- '99', three digits are not a distinctive token.

CREATE OR REPLACE FUNCTION public.normalize_tracking_number(p_tracking text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_raw     text;
  v_pos     int;
  v_rest    text;
  v_article text;
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

  -- Everything after the AI(91) marker.
  v_rest := substring(v_raw from '01[0-9]{14}91(.*)$');
  IF v_rest IS NOT NULL THEN
    -- MyPost, 23 chars.
    IF v_rest LIKE '99%' THEN
      RETURN left(v_rest, 23);
    END IF;

    -- Prepaid Parcel Post / Express Post, 22 chars, bounded by AI(8008) or the
    -- end of the scan. See the header for why both conditions are required.
    v_article := substring(v_rest from '^(030[0-9]{19})(?:8008[0-9]{12}|$)');
    IF v_article IS NOT NULL THEN
      RETURN v_article;
    END IF;

    -- An envelope whose article family we have no cut for. Returning the
    -- original is the only safe answer. See docs/order-tracking-number.md §4.
    RETURN v_raw;
  END IF;

  -- Envelope-less MyPost. Anchored at the start on purpose -- see the note in
  -- 20260809100000 on why STRPOS cannot be used for this family.
  IF v_raw LIKE '99%' AND length(v_raw) > 23 THEN
    RETURN left(v_raw, 23);
  END IF;

  RETURN v_raw;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- A normalisation pass is not a business edit and must not stamp today's date
-- on the rows it touches (same as 20260809100000). The tracking triggers would
-- produce the same value, so leaving them on is harmless.
ALTER TABLE public.orders DISABLE TRIGGER orders_set_updated_at;

UPDATE public.orders
SET tracking_number = public.normalize_tracking_number(tracking_number)
WHERE tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number);

ALTER TABLE public.orders ENABLE TRIGGER orders_set_updated_at;

COMMIT;
