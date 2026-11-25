BEGIN;

-- UBI: a new carrier channel. Orders are approved onto it from the Postage
-- dialog's "Without a rate" cards (fixed $0.00 postage, like Parcel Post) and
-- exported at /fulfillment/export-labels as UBI's 80-column bulk-order CSV.
-- There is no rate table and no carrier_services row: the quote engine never
-- prices it.
--
-- Appended rather than placed with `BEFORE`: enum order drives ORDER BY, and no
-- existing row carries this value, so the end is as good as anywhere.
--
-- Not a legacy value. 004's shipping_method CASE table maps Laravel spellings
-- only and needs no entry for it (CLAUDE.md rule 15).
--
-- ADD VALUE inside a transaction is allowed (PG 12+) as long as the new value
-- is not used in the same transaction, which it is not.
ALTER TYPE public.shipping_method ADD VALUE IF NOT EXISTS 'Ubi';

COMMIT;
