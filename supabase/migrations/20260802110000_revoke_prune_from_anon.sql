BEGIN;

-- Take EXECUTE on prune_product_movements away from anon.
--
-- Migration 20260802100000 revoked it FROM PUBLIC on the assumption that this
-- covered the unauthenticated role. It did not, for the same reason migration
-- 20260801140000 documents for tables: Supabase carries default privileges on
-- the public schema that grant anon and authenticated their own EXECUTE on
-- every new function. Revoking PUBLIC leaves those individual grants standing,
-- and `\df+` confirmed anon still held X after the push.
--
-- The function does check auth.uid() and would refuse an anon caller at
-- runtime, but a SECURITY DEFINER function that deletes ledger rows should not
-- be reachable at all by a role that holds the browser-side key.

REVOKE ALL ON FUNCTION public.prune_product_movements(bigint, integer) FROM anon;

COMMIT;
