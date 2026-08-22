-- Make the column-level UPDATE grant from 20260811100000 actually bite.
--
-- That migration granted UPDATE (is_selected) intending to keep the rest of the
-- row -- the price a carrier quoted on a date -- out of the UI's reach. It had
-- no effect, and the reason is worth writing down because it applies to every
-- GRANT line in this repo:
--
--   Supabase ships an ALTER DEFAULT PRIVILEGES that grants ALL on every new
--   table in `public` to anon, authenticated and service_role. `pg_default_acl`
--   shows `arwdDxtm` for all three. So a table is fully granted the moment it
--   is created, and the explicit GRANT lines in our migrations only restate
--   what is already true.
--
--   What has actually been gating access all along is RLS. A table with row
--   level security on and only a SELECT policy is read-only regardless of its
--   grants -- which is why the six shipping tables really are read-only, even
--   though `authenticated` holds INSERT, UPDATE and DELETE on all of them.
--
--   Column grants are additive, never restrictive: GRANT UPDATE (is_selected)
--   adds nothing when UPDATE on the whole table is already held. The privilege
--   has to be taken away at table level first.
--
-- REVOKE on a table also drops the column-level entries, so the order below
-- matters: revoke, then re-grant the one column.
--
-- Only `authenticated` is touched. `anon` holds the same broad grants but has
-- no policy on this table at all, so RLS refuses it outright.

BEGIN;

REVOKE UPDATE ON public.order_shipping_quotes FROM authenticated;
GRANT UPDATE (is_selected) ON public.order_shipping_quotes TO authenticated;

COMMIT;
