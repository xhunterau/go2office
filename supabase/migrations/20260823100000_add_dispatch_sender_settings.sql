-- Give shipping_settings the sender block and the contact fallbacks that label
-- production needs.
--
-- Why here rather than hard-coded: xpros writes its sender into three separate
-- files (the MyPost CSV builder, the A6 label PDF, and the eParcel consignee
-- email fallback), all as string literals. Moving warehouse or changing the
-- Parcel Locker number there means a deploy, and missing one of the three
-- produces labels that disagree with each other without anything failing.
--
-- Only Australia Post needs a sender from us:
--
--   * MyPost Business CSV has seven "Send From" columns.
--   * The self-printed A6 label has a FROM block.
--   * eParcel's 25-column template has NO sender columns at all -- the charge
--     code identifies the account, and the account carries the address.
--   * Aramex's consignment payload has no From field either; its pickup address
--     lives on the account (135 Woodlands Drive), so it is deliberately absent
--     from this table.
--
-- shipping_settings is a single row (CHECK (id = 1)) with a table-level UPDATE
-- policy from 20260812100000, and no column-level REVOKE has ever been applied
-- to it, so these columns are writable from /settings/shipping/constants the
-- moment they exist. No GRANT is needed -- and per CLAUDE.md rule 22, adding
-- one would not have gated anything anyway.

BEGIN;

ALTER TABLE public.shipping_settings
  ADD COLUMN sender_name text NOT NULL DEFAULT 'Go2buy Australia',
  ADD COLUMN sender_address_line1 text NOT NULL DEFAULT 'Parcel Locker 10147 39821',
  ADD COLUMN sender_address_line2 text NOT NULL DEFAULT '1-7 Venture Way',
  ADD COLUMN sender_suburb text NOT NULL DEFAULT 'Braeside',
  ADD COLUMN sender_state text NOT NULL DEFAULT 'VIC',
  ADD COLUMN sender_postcode text NOT NULL DEFAULT '3195',
  -- Used when a customer has no email or no usable phone number. Australia Post
  -- treats both as mandatory on most consignment types, so a blank one means
  -- the row is rejected at upload time rather than at export time.
  --
  -- Deliberately DEFAULT '' rather than an invented address: an export that
  -- silently posts our own contact details onto a customer's parcel is worse
  -- than one that refuses to run. The export actions check for a blank and stop
  -- with a message pointing back at this page. xpros hard-codes
  -- admin@xhunter.com.au and +61431950696 here, which is the xhunter contract's
  -- values, not go2office's.
  ADD COLUMN fallback_email text NOT NULL DEFAULT '',
  ADD COLUMN fallback_phone text NOT NULL DEFAULT '';

-- The sender block is what goes on the parcel. A blank line1 or suburb produces
-- a label that Australia Post cannot return to anyone, so those are constrained
-- rather than left to the form. The fallbacks are NOT constrained: blank is a
-- valid state meaning "we have not set one yet", and the export path handles it.
ALTER TABLE public.shipping_settings
  ADD CONSTRAINT shipping_settings_sender_present CHECK (
    btrim(sender_name) <> ''
    AND btrim(sender_address_line1) <> ''
    AND btrim(sender_suburb) <> ''
    AND btrim(sender_state) <> ''
    AND btrim(sender_postcode) <> ''
  );

COMMENT ON COLUMN public.shipping_settings.sender_name IS
  'Sender block for Australia Post labels: the MyPost CSV Send From columns and the self-printed A6 label FROM block. eParcel and Aramex take the sender from the account instead.';
COMMENT ON COLUMN public.shipping_settings.fallback_email IS
  'Used when a customer row has no email. Blank means unset, and the export actions refuse to run rather than substituting anything.';

COMMIT;
