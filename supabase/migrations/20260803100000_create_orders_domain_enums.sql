BEGIN;

-- Orders domain enums. See docs/orders-domain-migration.md for the survey of the
-- legacy data and the decisions this implements.
--
-- Source tables: public.go2_buyers  -> public.customers
--                public.go2_orders  -> public.orders
--                public.go2_transactions -> public.order_transactions
--                public.go2_transactions_products -> public.order_items

-- Legacy go2_orders.order_status holds exactly four values with no surprises
-- (COMPLETED 202778, CANCELLED 527, PROCESSING 9, ISSUED 1), which is what makes
-- an enum safe here. Ordered by lifecycle so ORDER BY status reads sensibly.
CREATE TYPE public.order_status AS ENUM (
  'processing',
  'issued',
  'completed',
  'cancelled'
);

-- Same story: go2_orders.platform is a closed set of four
-- (EBAY 178244, SHOPIFY 20624, BACKORDER 3878, STORE 569).
CREATE TYPE public.sales_platform AS ENUM (
  'ebay',
  'shopify',
  'backorder',
  'store'
);

-- The shipping methods the business uses going forward. Unlike the two enums
-- above this is NOT derived from the legacy values -- it is a new, cleaner set
-- supplied by the business, and only 16 of the 25 legacy values map into it.
--
-- The labels keep the PascalCase_Snake spelling they were given, which differs
-- from the lowercase style of the two enums above and of stock_movement_kind.
-- That inconsistency is known and accepted (see docs/orders-domain-migration.md
-- section 4.1); it is not worth a rename that would have to rewrite the column.
--
-- 'Letter' is the one addition to the supplied list: it covers 134391 legacy
-- orders (66% of all of them) and the business still uses it.
--
-- The seven legacy carriers that are NOT here (Zone6 Regular/Express, Sendle,
-- Sendle 250g, Winit, Fast Track, Toll B2C -- 29143 orders) are retired. Their
-- historical values live on in orders.legacy_shipping_method instead.
--
-- Adding a value later means ALTER TYPE ... ADD VALUE in a new migration, and
-- the new label cannot be used in the same transaction that adds it. Removing or
-- renaming one is effectively impossible without rebuilding the type.
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
  'Eparcel_Intl_Express',
  -- MyPost, unsized
  'Mypost_Regular',
  'Mypost_Express',
  -- MyPost boxes, regular
  'Mypost_Reg_Xs_Box',
  'Mypost_Reg_S_Box',
  'Mypost_Reg_M_Box',
  'Mypost_Reg_L_Box',
  'Mypost_Reg_XL_Box',
  -- MyPost boxes, express
  'Mypost_Exp_Xs_Box',
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

COMMIT;
