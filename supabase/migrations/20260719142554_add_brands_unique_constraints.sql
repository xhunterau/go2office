-- Enforce uniqueness of brand name and abbreviation (case-sensitive).
-- abbr is optional; Postgres UNIQUE treats multiple NULLs as distinct, so
-- brands without an abbreviation are unaffected.
BEGIN;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_name_key UNIQUE (name);

ALTER TABLE public.brands
  ADD CONSTRAINT brands_abbr_key UNIQUE (abbr);

COMMIT;
