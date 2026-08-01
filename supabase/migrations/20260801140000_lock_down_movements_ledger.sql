BEGIN;

-- Make the ledger genuinely append-only.
--
-- Migration 20260801110000 granted SELECT and INSERT on inventory_movements and
-- gave it only SELECT and INSERT policies, on the assumption that this was the
-- whole story. It was not: Supabase carries default privileges on the public
-- schema that hand `anon` and `authenticated` ALL PRIVILEGES on every new table,
-- and a GRANT adds to those rather than replacing them. The table came out with
-- DELETE, UPDATE and TRUNCATE still attached.
--
-- Row-level security does cover the first two -- with no UPDATE or DELETE policy
-- those statements match no rows. TRUNCATE is the hole: it is a table-level
-- privilege that RLS never sees, so any authenticated session could have emptied
-- the entire audit trail in one statement.
--
-- Revoking is therefore not defence in depth here; for TRUNCATE it is the only
-- defence.

REVOKE UPDATE, DELETE, TRUNCATE ON public.inventory_movements FROM authenticated;
REVOKE ALL ON public.inventory_movements FROM anon;

-- service_role keeps full access on purpose: it is the break-glass path for
-- corrections that genuinely have to happen, and it is never exposed to the
-- browser.

COMMIT;
