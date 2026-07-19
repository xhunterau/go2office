BEGIN;

-- Automate created_at / updated_at on public.products so no application code has
-- to set them. Only products carries these columns (brands/suppliers/origins do
-- not), so the trigger lives on products alone.
--
-- Previously both columns were plain nullable timestamptz with no default and no
-- trigger, so inserts left them NULL and updates never refreshed updated_at.

-- moddatetime provides the standard BEFORE UPDATE helper that stamps a column
-- with now(). Supabase ships it in the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- Backfill existing NULLs (legacy/early rows) before enforcing NOT NULL.
UPDATE public.products SET created_at = now() WHERE created_at IS NULL;
UPDATE public.products
  SET updated_at = COALESCE(created_at, now())
  WHERE updated_at IS NULL;

-- Defaults + NOT NULL so every insert path is stamped automatically.
ALTER TABLE public.products
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

-- Refresh updated_at on every UPDATE.
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

COMMIT;
