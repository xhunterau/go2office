-- Runtime debug overrides, maintained at /settings/debug. Ported from xpros'
-- debug_settings table and /admin/debug-console.
--
-- One row per switch, keyed by a name the code reads (src/lib/debug/settings.ts
-- holds the matching registry). Rows are added by migration, never from the UI:
-- a key the code does not read is a switch that does nothing, and the page would
-- happily show it as "active".
--
-- First key: shopify_import_test_order. While it is enabled, Import from Shopify
-- pulls only that one order -- by name or by numeric id -- instead of every
-- unshipped order. See docs/shopify-order-import.md §7.
--
-- go2office has no admin role, so every signed-in user may flip these. What the
-- policies do restrict (CLAUDE.md rule 22 -- RLS is the gate):
--   * no INSERT / DELETE policy: keys come from migrations only;
--   * UPDATE narrowed to (value, enabled, updated_by) by REVOKE-then-GRANT, so
--     neither the key the code reads nor the description can be edited away;
--   * WITH CHECK (updated_by = auth.uid()): the "last changed by" line cannot
--     name someone else.

BEGIN;

CREATE TABLE public.debug_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debug_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

CREATE TRIGGER debug_settings_set_updated_at
  BEFORE UPDATE ON public.debug_settings
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

ALTER TABLE public.debug_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON public.debug_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_update" ON public.debug_settings
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (updated_by = auth.uid());

REVOKE UPDATE ON public.debug_settings FROM authenticated;
GRANT UPDATE (value, enabled, updated_by) ON public.debug_settings TO authenticated;

INSERT INTO public.debug_settings (key, value, enabled, description)
VALUES (
  'shopify_import_test_order',
  '',
  false,
  'Import from Shopify pulls only this order instead of every unshipped one. Accepts the order name (#G2B24707) or its numeric id (7930453721225). Shipped orders can be fetched this way; cancelled and test orders are still ignored, and an order already in go2office is still skipped as a duplicate.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
