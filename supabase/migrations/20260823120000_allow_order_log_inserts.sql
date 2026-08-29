BEGIN;

-- order_logs has been unwritable from the application since it was created.
--
-- Migration 20260810140000 enabled RLS and gave `authenticated` a SELECT policy
-- only, on the reasoning that the quote engine writes its rows under the
-- service role. That reasoning held then and no longer does: the label exports
-- (src/lib/actions/fulfillment.ts) and the follow-up order action both log as
-- the signed-in user, and every one of those inserts is refused with
-- `new row violates row-level security policy`.
--
-- The export path swallows it as a warning, so the visible symptom was only
-- ever "the orders were marked Labelled, but the order log was not written" --
-- on every single export. CLAUDE.md rule 22 in miniature: `authenticated` has
-- held the table-level INSERT privilege the whole time (Supabase's default
-- ACL), and the GRANT SELECT in the original migration was decoration. The
-- gate was, and is, the policy.
--
-- What is deliberately NOT added: UPDATE and DELETE policies. The original
-- intent -- an audit trail the application cannot edit is the only kind worth
-- having -- is unchanged. Rows can be appended, never rewritten or removed.
CREATE POLICY "authenticated_insert" ON public.order_logs
  FOR INSERT
  TO authenticated
  -- Pinned to the writer rather than left open: an audit row that names someone
  -- else as the actor is worse than no audit row. Background tasks run under
  -- the service role, bypass RLS entirely, and keep writing user_id NULL.
  WITH CHECK (user_id = auth.uid());

COMMIT;
