BEGIN;

-- Remove three values from public.shipping_method, leaving 31.
--
--   Mypost_Reg_Xs_Box / Mypost_Exp_Xs_Box -- Australia Post sells no XS box.
--     The enum carried them because migration 20260803100000 took the value set
--     as supplied; flat_rate_package_specs has only S/M/L/XL, so 20260810120000
--     deliberately left them out of carrier_dispatch_options and mypost-csv.ts
--     left them out of its packaging-code map. There is nothing to configure
--     them with -- the size does not exist.
--
--   Eparcel_Intl_Express -- go2office has no international eParcel contract, so
--     no charge code and no customs classification. It was excluded from
--     EPARCEL_METHODS for that reason and produced no label channel at all.
--
-- Note the XS *satchel* values stay: AP_SATCHEL_XS is a real product and both
-- Mypost_Reg_Xs_Satchel and Mypost_Exp_Xs_Satchel are configured end to end.
--
-- Safe to drop, checked against the remote on 2026-08-23:
--   * 0 rows in all three columns typed shipping_method -- orders (203315
--     rows), carrier_dispatch_options (25) and order_shipping_quotes (30);
--   * no view, materialized view, function or RLS policy references the type or
--     any of those columns. The only index is
--     carrier_dispatch_options_method_unique, rebuilt by the recast below;
--   * scripts/migration/004_orders_data.sql maps legacy carriers through a CASE
--     table (CLAUDE.md rule 15) that never produces any of these three labels,
--     so the final Laravel sync is unaffected. Unlike the order_status drops in
--     20260808120000 / 20260808130000 there is no straight cast to worry about
--     here either: an unmapped legacy value lands in legacy_shipping_method.
--
-- Postgres has no DROP VALUE, so the type is rebuilt and all three columns are
-- recast. That rewrites all 203315 rows of orders under an ACCESS EXCLUSIVE
-- lock, which is why this must not run while orders are being written.
SET LOCAL statement_timeout = 0;

ALTER TYPE public.shipping_method RENAME TO shipping_method_old;

-- Declaration order is unchanged from 20260803100000: letters, parcels,
-- eParcel, MyPost boxes, MyPost satchels, other carriers. It is the enum's sort
-- order and the order the dropdown renders in.
CREATE TYPE public.shipping_method AS ENUM (
  -- Letter services
  'Letter',
  'Register_Letter',
  -- Parcel services
  'Parcel_Post',
  'Express_Post',
  -- eParcel
  'Eparcel_Regular',
  'Eparcel_Express',
  -- MyPost, unsized
  'Mypost_Regular',
  'Mypost_Express',
  -- MyPost boxes, regular
  'Mypost_Reg_S_Box',
  'Mypost_Reg_M_Box',
  'Mypost_Reg_L_Box',
  'Mypost_Reg_XL_Box',
  -- MyPost boxes, express
  'Mypost_Exp_S_Box',
  'Mypost_Exp_M_Box',
  'Mypost_Exp_L_Box',
  'Mypost_Exp_XL_Box',
  -- MyPost satchels, regular
  'Mypost_Reg_Xs_Satchel',
  'Mypost_Reg_S_Satchel',
  'Mypost_Reg_M_Satchel',
  'Mypost_Reg_L_Satchel',
  'Mypost_Reg_XL_Satchel',
  -- MyPost satchels, express
  'Mypost_Exp_Xs_Satchel',
  'Mypost_Exp_S_Satchel',
  'Mypost_Exp_M_Satchel',
  'Mypost_Exp_L_Satchel',
  'Mypost_Exp_XL_Satchel',
  -- Other carriers and collection
  'Store_Delivery',
  'Direct_Freight',
  'Click_and_Collect',
  'Aramex_Parcel',
  'Aramex_Satchel'
);

-- Via text: there is no cast between two enum types. A row still holding one of
-- the three dropped values would fail here rather than being silently coerced
-- into a neighbouring carrier -- which is the behaviour to want, though the
-- count is currently zero on all three tables.
ALTER TABLE public.orders
  ALTER COLUMN shipping_method TYPE public.shipping_method
  USING shipping_method::text::public.shipping_method;

ALTER TABLE public.carrier_dispatch_options
  ALTER COLUMN shipping_method TYPE public.shipping_method
  USING shipping_method::text::public.shipping_method;

ALTER TABLE public.order_shipping_quotes
  ALTER COLUMN shipping_method TYPE public.shipping_method
  USING shipping_method::text::public.shipping_method;

DROP TYPE public.shipping_method_old;

-- The orders rewrite invalidates the statistics 20260808100000 was careful to
-- refresh; stale ones cost the SKU lookup a factor of 390 (docs/orders-ui.md
-- section 3.4). The other two tables are 25 and 30 rows.
ANALYZE public.orders;

COMMIT;
