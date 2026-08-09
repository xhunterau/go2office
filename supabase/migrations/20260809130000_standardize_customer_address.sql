BEGIN;

-- Address standardisation on public.customers, ported from xpros's
-- fn_standardize_customer_address() / trg_customer_standardization.
--
-- Two rules, both driven by the reference tables added in migrations
-- 20260809110000 (postcodes) and 20260809120000 (countries):
--
--   A. country name  -> ISO code       ('Australia' -> 'AU')
--   B. postcode+city -> state          ('2000' + 'SYDNEY' -> 'NSW')
--
-- Both are conservative in the same way: when the reference tables have no
-- answer, the value is left exactly as the user typed it. That is what keeps
-- the function safe on this data, where customers.country also contains phone
-- numbers, postcodes and delivery instructions ('OK to leave at the front
-- porch...') -- none of which match a country name, so none of which are
-- touched.
--
-- THREE DELIBERATE DIFFERENCES FROM THE XPROS ORIGINAL
--
-- 1. Equality instead of ILIKE. xpros matches `locality ILIKE TRIM(NEW.city)`
--    and `country_name ILIKE TRIM(NEW.country)`. The right-hand side of ILIKE
--    is a PATTERN, so a customer whose city contains % or _ would silently
--    perform a wildcard match and could be assigned another suburb's state.
--    No row in this database contains those characters today, which is exactly
--    why the bug would go unnoticed until it did. Equality against a folded
--    column is also the only form that can use an index -- ILIKE cannot, and
--    the backfill below would otherwise scan all 16712 postcodes once per
--    customer.
--
-- 2. Leading-zero-safe postcode matching. public.postcodes stores four digits
--    always (see its migration); the lookup pads the customer's value the same
--    way, so a customer in Darwin matches whether their postcode arrived as
--    '0800' or '800'.
--
-- 3. Written as a normalisation, not a fill-in-the-blank. Rule B overwrites a
--    state that is already present, as it does in xpros. That is the point of
--    it -- the legacy data mixes 'NSW' with 'New South Wales' and carries
--    outright wrong states -- but it has a consequence worth stating plainly:
--    the customer edit form submits every field, so a state a human typed by
--    hand WILL be replaced by the reference answer on save whenever the
--    postcode and suburb resolve. The postcode/locality pair is unique in the
--    reference table, so the answer it gives is deterministic, never a guess
--    between candidates. If a genuine address ever needs a state that
--    contradicts Australia Post, the fix is a row in public.postcodes, not a
--    manual edit that the next save undoes.

CREATE OR REPLACE FUNCTION public.standardize_customer_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_country_code text;
  v_state text;
BEGIN
  -- Rule A: country name -> ISO code. Unrecognised values (including the junk
  -- this column has accumulated) fall through untouched.
  IF NULLIF(btrim(NEW.country), '') IS NOT NULL THEN
    SELECT c.country_code INTO v_country_code
    FROM public.countries AS c
    WHERE lower(c.country_name) = lower(btrim(NEW.country))
    LIMIT 1;

    IF v_country_code IS NOT NULL THEN
      NEW.country := v_country_code;
    END IF;
  END IF;

  -- Rule B: postcode + city -> state. Matches customers.city against
  -- postcodes.locality; both sides are folded to the form the reference table
  -- is stored in.
  IF NULLIF(btrim(NEW.postcode), '') IS NOT NULL
     AND NULLIF(btrim(NEW.city), '') IS NOT NULL THEN
    SELECT p.state INTO v_state
    FROM public.postcodes AS p
    WHERE p.postcode = lpad(btrim(NEW.postcode), 4, '0')
      AND p.locality = upper(btrim(NEW.city))
    LIMIT 1;

    -- NULL means either "no such postcode/suburb pair" or "an alias locality
    -- Australia Post lists without a state". Both leave the existing value
    -- alone; neither is a reason to blank it.
    IF v_state IS NOT NULL THEN
      NEW.state := v_state;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_standardize_address
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.standardize_customer_address();

-- ---------------------------------------------------------------------------
-- Backfill the 178024 rows that predate the trigger
-- ---------------------------------------------------------------------------
--
-- Done as two set-based UPDATEs rather than a no-op `UPDATE customers SET id =
-- id` that fires the trigger per row: the trigger form is 178024 separate pairs
-- of index lookups, the set-based form is two hash joins.

SET LOCAL statement_timeout = 0;

-- updated_at is suppressed for the backfill. This is a systematic correction of
-- data that was already in the table, not a business event on 178024 customer
-- records, and letting moddatetime stamp all of them today would destroy the
-- column's meaning for anyone asking "which customers changed recently?".
ALTER TABLE public.customers DISABLE TRIGGER customers_set_updated_at;

UPDATE public.customers AS c
SET country = ct.country_code
FROM public.countries AS ct
WHERE lower(btrim(c.country)) = lower(ct.country_name)
  AND c.country IS DISTINCT FROM ct.country_code;

UPDATE public.customers AS c
SET state = p.state
FROM public.postcodes AS p
WHERE p.postcode = lpad(btrim(c.postcode), 4, '0')
  AND p.locality = upper(btrim(c.city))
  AND p.state IS NOT NULL
  AND c.state IS DISTINCT FROM p.state;

ALTER TABLE public.customers ENABLE TRIGGER customers_set_updated_at;

COMMIT;
