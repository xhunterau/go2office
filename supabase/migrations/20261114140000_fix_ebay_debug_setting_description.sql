-- The ebay_import_test_order description (20261114130000) said a shipped order
-- could be fetched this way. It can be fetched, but the mapper drops every line
-- already marked shipped on eBay, so such an order is counted as ignored and
-- nothing is imported (checked 2026-11-14 with 02-15438-01972). Unlike the
-- Shopify switch, this one only works for orders still waiting to ship.

BEGIN;

UPDATE public.debug_settings
   SET description = 'Import from eBay pulls only this order instead of every unshipped one. Takes the eBay order number (17-15414-28640), not the sales record number. Only works for an order still waiting to ship: lines already marked shipped on eBay are left out, so a shipped order is counted as ignored. Orders with a cancellation are skipped, and an order already in go2office is skipped as a duplicate.'
 WHERE key = 'ebay_import_test_order';

COMMIT;
