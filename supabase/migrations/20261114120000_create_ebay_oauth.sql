-- eBay Sell API plumbing: the seller's OAuth grant, and the Marketplace Account
-- Deletion notifications eBay requires every production keyset to receive.
-- See docs/ebay-integration.md.
--
-- Both tables hold things no signed-in user should read from the browser -- a
-- refresh token that acts as the seller for 18 months, and other people's eBay
-- identities -- so RLS is on with NO policies at all. Only the service role
-- (scripts/ebay/authorize.mjs, the Trigger.dev tasks, the Edge Function) gets
-- through. CLAUDE.md rule 22: this is the gate, not GRANT; authenticated still
-- holds the default table privileges and is stopped here.

BEGIN;

-- One row per authorised eBay seller account. Keyed by eBay's immutable userId
-- (Identity API), not the username, which the seller can change.
CREATE TABLE public.ebay_accounts (
  ebay_user_id text PRIMARY KEY,
  username text NOT NULL,
  refresh_token text NOT NULL,
  -- 18 months from consent. Past this, every import fails until someone signs
  -- in again via scripts/ebay/authorize.mjs; kept so it can be warned about.
  refresh_token_expires_at timestamptz NOT NULL,
  -- What the seller consented to. A refresh request asking for more fails.
  scopes text[] NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ebay_accounts_set_updated_at
  BEFORE UPDATE ON public.ebay_accounts
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

ALTER TABLE public.ebay_accounts ENABLE ROW LEVEL SECURITY;

-- Written by the ebay-account-deletion Edge Function, one row per notification.
-- eBay redelivers until it gets a 2xx, so notification_id is the key and a
-- repeat is ignored. Acting on them (anonymising that buyer's customers rows) is
-- a later step; processed_at records when that was done.
CREATE TABLE public.ebay_account_deletions (
  notification_id text PRIMARY KEY,
  ebay_user_id text,
  username text,
  eias_token text,
  event_date timestamptz,
  publish_date timestamptz,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.ebay_account_deletions ENABLE ROW LEVEL SECURITY;

COMMIT;
