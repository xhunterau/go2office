BEGIN;

-- "This product's weight or size looks wrong -- measure it next time you are in
-- the warehouse."
--
-- The size problem is usually spotted in the Postage dialog, away from the
-- warehouse, where nothing can be measured. The flag records that, so it can be
-- listed on the dashboard and worked through on the next visit. It does not
-- hold up any order (user decision, 2026-11-18): an inaccurate size makes a
-- quote wrong, not a parcel undeliverable.

ALTER TABLE public.products
  ADD COLUMN remeasure_requested_at timestamptz,
  ADD COLUMN remeasure_note text
    CHECK (remeasure_note IS NULL OR length(remeasure_note) <= 500),
  ADD COLUMN remeasure_requested_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- A note or an author without the flag would be a half-cleared flag.
  ADD CONSTRAINT products_remeasure_consistent CHECK (
    remeasure_requested_at IS NOT NULL
    OR (remeasure_note IS NULL AND remeasure_requested_by IS NULL)
  );

-- The dashboard count and the /products?remeasure=1 filter. Partial: almost
-- every product is unflagged at any given time.
CREATE INDEX products_remeasure_requested_idx
  ON public.products (remeasure_requested_at)
  WHERE remeasure_requested_at IS NOT NULL;

-- Measuring it is what clears it: any change to weight, length, width or
-- height (user decision, 2026-11-18). Done here rather than in the actions
-- because three screens write these columns, and a flag that only one of them
-- clears would sit on the dashboard after the product was fixed.
--
-- Compared value to value, not "was the column in the UPDATE": the Postage
-- dialog and the product form submit all four fields on every save, so the
-- UPDATE OF list alone would clear the flag on a price edit's no-op rewrite.
--
-- Fires after products_normalize_fields (BEFORE triggers run in name order, and
-- 'products_r...' sorts after 'products_n...'), so it compares the re-sorted
-- L >= W >= H edges (CLAUDE.md rule 19). Typing the same three numbers in a
-- different order is therefore not a change, and leaves the flag set.
CREATE FUNCTION public.products_clear_remeasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.remeasure_requested_at IS NOT NULL
     AND (NEW.weight, NEW.length, NEW.width, NEW.height)
         IS DISTINCT FROM (OLD.weight, OLD.length, OLD.width, OLD.height) THEN
    NEW.remeasure_requested_at := NULL;
    NEW.remeasure_note := NULL;
    NEW.remeasure_requested_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_remeasure_clear
  BEFORE UPDATE OF weight, length, width, height ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_clear_remeasure();

COMMIT;
