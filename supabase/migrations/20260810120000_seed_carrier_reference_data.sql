BEGIN;

-- Carrier reference data, lifted from the xpros production database on
-- 2026-08-16. See docs/shipping-quote-engine.md sections 2.2 - 2.8.
--
-- These are negotiated contract rates, not published retail prices. They come
-- across verbatim; the only editorial changes are the three from section 1 --
-- Direct Freight and the retired eParcel Z6 account are dropped, and the
-- surviving Z9 account is simply called `eparcel` because go2office has no
-- second one to distinguish it from.
--
-- Nothing here is keyed by xpros' ids. Every insert resolves its parent by
-- code, so our identity columns number themselves.

-- ── carriers (4) ────────────────────────────────────────────────────────────

INSERT INTO public.carriers (code, name) VALUES
  ('mypost',     'Australia Post MyPost Business'),
  ('eparcel',    'Australia Post eParcel'),
  ('aramex',     'Aramex'),
  ('reg_letter', 'Australia Post Registered Post Prepaid Labels');

-- ── carrier_services (22) ───────────────────────────────────────────────────
--
-- Both carriers break at the same weights (250g / 500g / 1kg / 3kg / 5kg); only
-- the tier names differ, and those names are contract vocabulary, so they stay
-- as each carrier writes them.
--
-- MyPost has no per_kg overflow tier. That is not an omission: MyPost Business
-- stops at 5kg, and anything heavier is eParcel's job.
--
-- aramex and reg_letter have no rows here at all -- one quotes over an API, the
-- other is a fixed price. Neither reads the rate card.

INSERT INTO public.carrier_services (carrier_id, service_type, size_label, max_weight, sort_order)
SELECT c.id, v.service_type, v.size_label, v.max_weight, v.sort_order
FROM (VALUES
  ('mypost',  'standard', 'extra_small', 0.25, 1),
  ('mypost',  'standard', 'small',       0.50, 2),
  ('mypost',  'standard', 'medium',      1.00, 3),
  ('mypost',  'standard', 'large',       3.00, 4),
  ('mypost',  'standard', 'extra_large', 5.00, 5),
  ('mypost',  'express',  'extra_small', 0.25, 1),
  ('mypost',  'express',  'small',       0.50, 2),
  ('mypost',  'express',  'medium',      1.00, 3),
  ('mypost',  'express',  'large',       3.00, 4),
  ('mypost',  'express',  'extra_large', 5.00, 5),
  ('eparcel', 'standard', 'up_to_250g',  0.25, 1),
  ('eparcel', 'standard', 'up_to_500g',  0.50, 2),
  ('eparcel', 'standard', 'up_to_1kg',   1.00, 3),
  ('eparcel', 'standard', 'up_to_3kg',   3.00, 4),
  ('eparcel', 'standard', 'up_to_5kg',   5.00, 5),
  ('eparcel', 'standard', 'per_kg',      NULL, 6),
  ('eparcel', 'express',  'up_to_250g',  0.25, 1),
  ('eparcel', 'express',  'up_to_500g',  0.50, 2),
  ('eparcel', 'express',  'up_to_1kg',   1.00, 3),
  ('eparcel', 'express',  'up_to_3kg',   3.00, 4),
  ('eparcel', 'express',  'up_to_5kg',   5.00, 5),
  ('eparcel', 'express',  'per_kg',      NULL, 6)
) AS v (carrier_code, service_type, size_label, max_weight, sort_order)
JOIN public.carriers c ON c.code = v.carrier_code;

-- ── carrier_zone_rates (138) ────────────────────────────────────────────────
--
-- MyPost: 3 zones x 5 tiers x 2 service levels = 30.
-- eParcel: 9 zones x 6 tiers x 2 service levels = 108.
--
-- Only the per_kg tiers use base_rate + per_kg_rate; every fixed tier uses
-- `rate`. min_charge is NULL on all 138 rows in xpros and stays NULL here --
-- the column exists because the rate lookup honours it, not because this
-- contract sets one.

INSERT INTO public.carrier_zone_rates (service_id, zone, rate, base_rate, per_kg_rate)
SELECT s.id, v.zone, v.rate, v.base_rate, v.per_kg_rate
FROM (VALUES
  -- MyPost standard
  ('mypost', 'standard', 'extra_small', 'Zone_1',  6.12, NULL, NULL),
  ('mypost', 'standard', 'extra_small', 'Zone_2',  8.16, NULL, NULL),
  ('mypost', 'standard', 'extra_small', 'Zone_3',  9.69, NULL, NULL),
  ('mypost', 'standard', 'small',       'Zone_1',  7.02, NULL, NULL),
  ('mypost', 'standard', 'small',       'Zone_2',  9.36, NULL, NULL),
  ('mypost', 'standard', 'small',       'Zone_3', 11.12, NULL, NULL),
  ('mypost', 'standard', 'medium',      'Zone_1',  9.60, NULL, NULL),
  ('mypost', 'standard', 'medium',      'Zone_2', 12.80, NULL, NULL),
  ('mypost', 'standard', 'medium',      'Zone_3', 15.20, NULL, NULL),
  ('mypost', 'standard', 'large',       'Zone_1', 12.15, NULL, NULL),
  ('mypost', 'standard', 'large',       'Zone_2', 16.20, NULL, NULL),
  ('mypost', 'standard', 'large',       'Zone_3', 19.24, NULL, NULL),
  ('mypost', 'standard', 'extra_large', 'Zone_1', 14.67, NULL, NULL),
  ('mypost', 'standard', 'extra_large', 'Zone_2', 19.56, NULL, NULL),
  ('mypost', 'standard', 'extra_large', 'Zone_3', 23.23, NULL, NULL),
  -- MyPost express
  ('mypost', 'express',  'extra_small', 'Zone_1',  7.92, NULL, NULL),
  ('mypost', 'express',  'extra_small', 'Zone_2', 10.56, NULL, NULL),
  ('mypost', 'express',  'extra_small', 'Zone_3', 12.54, NULL, NULL),
  ('mypost', 'express',  'small',       'Zone_1',  9.12, NULL, NULL),
  ('mypost', 'express',  'small',       'Zone_2', 12.16, NULL, NULL),
  ('mypost', 'express',  'small',       'Zone_3', 14.44, NULL, NULL),
  ('mypost', 'express',  'medium',      'Zone_1', 12.00, NULL, NULL),
  ('mypost', 'express',  'medium',      'Zone_2', 16.00, NULL, NULL),
  ('mypost', 'express',  'medium',      'Zone_3', 19.00, NULL, NULL),
  ('mypost', 'express',  'large',       'Zone_1', 14.85, NULL, NULL),
  ('mypost', 'express',  'large',       'Zone_2', 19.80, NULL, NULL),
  ('mypost', 'express',  'large',       'Zone_3', 23.51, NULL, NULL),
  ('mypost', 'express',  'extra_large', 'Zone_1', 19.77, NULL, NULL),
  ('mypost', 'express',  'extra_large', 'Zone_2', 26.36, NULL, NULL),
  ('mypost', 'express',  'extra_large', 'Zone_3', 31.30, NULL, NULL),

  -- eParcel standard
  ('eparcel', 'standard', 'up_to_250g', 'Local',                  4.17, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Same State Metro',       5.65, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Same State Remote',      8.21, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Near State Capital',     5.17, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Near State Metro',       6.04, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Near State Remote',      8.94, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Distant State Capital',  5.84, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Distant State Metro',    7.37, NULL, NULL),
  ('eparcel', 'standard', 'up_to_250g', 'Distant State Remote',   9.49, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Local',                  4.95, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Same State Metro',       6.73, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Same State Remote',      9.06, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Near State Capital',     6.05, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Near State Metro',       7.06, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Near State Remote',      9.88, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Distant State Capital',  6.82, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Distant State Metro',    8.57, NULL, NULL),
  ('eparcel', 'standard', 'up_to_500g', 'Distant State Remote',  10.48, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Local',                  5.67, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Same State Metro',       7.79, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Same State Remote',     11.11, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Near State Capital',     6.66, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Near State Metro',       7.94, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Near State Remote',     12.39, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Distant State Capital',  8.07, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Distant State Metro',   10.90, NULL, NULL),
  ('eparcel', 'standard', 'up_to_1kg',  'Distant State Remote',  15.00, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Local',                  6.25, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Same State Metro',       8.69, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Same State Remote',     13.54, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Near State Capital',     7.82, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Near State Metro',       9.52, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Near State Remote',     15.40, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Distant State Capital', 10.02, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Distant State Metro',   14.31, NULL, NULL),
  ('eparcel', 'standard', 'up_to_3kg',  'Distant State Remote',  20.46, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Local',                  6.55, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Same State Metro',       9.26, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Same State Remote',     16.37, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Near State Capital',    10.32, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Near State Metro',      12.58, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Near State Remote',     18.97, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Distant State Capital', 13.66, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Distant State Metro',   20.16, NULL, NULL),
  ('eparcel', 'standard', 'up_to_5kg',  'Distant State Remote',  26.79, NULL, NULL),
  ('eparcel', 'standard', 'per_kg',     'Local',                 NULL,  5.28, 0.33),
  ('eparcel', 'standard', 'per_kg',     'Same State Metro',      NULL,  7.25, 0.54),
  ('eparcel', 'standard', 'per_kg',     'Same State Remote',     NULL,  9.94, 1.50),
  ('eparcel', 'standard', 'per_kg',     'Near State Capital',    NULL,  6.93, 0.82),
  ('eparcel', 'standard', 'per_kg',     'Near State Metro',      NULL,  8.09, 1.07),
  ('eparcel', 'standard', 'per_kg',     'Near State Remote',     NULL, 10.89, 1.85),
  ('eparcel', 'standard', 'per_kg',     'Distant State Capital', NULL,  7.85, 1.36),
  ('eparcel', 'standard', 'per_kg',     'Distant State Metro',   NULL,  9.96, 2.35),
  ('eparcel', 'standard', 'per_kg',     'Distant State Remote',  NULL, 11.74, 3.34),

  -- eParcel express
  ('eparcel', 'express',  'up_to_250g', 'Local',                  4.17, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Same State Metro',       7.50, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Same State Remote',     11.39, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Near State Capital',     6.84, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Near State Metro',       7.84, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Near State Remote',     12.13, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Distant State Capital',  7.65, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Distant State Metro',    9.28, NULL, NULL),
  ('eparcel', 'express',  'up_to_250g', 'Distant State Remote',  12.65, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Local',                  4.95, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Same State Metro',       8.93, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Same State Remote',     12.58, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Near State Capital',     8.01, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Near State Metro',       9.16, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Near State Remote',     13.40, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Distant State Capital',  8.92, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Distant State Metro',   10.79, NULL, NULL),
  ('eparcel', 'express',  'up_to_500g', 'Distant State Remote',  13.97, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Local',                  5.67, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Same State Metro',      10.40, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Same State Remote',     15.57, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Near State Capital',     9.03, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Near State Metro',      10.47, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Near State Remote',     16.88, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Distant State Capital', 10.60, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Distant State Metro',   13.58, NULL, NULL),
  ('eparcel', 'express',  'up_to_1kg',  'Distant State Remote',  19.49, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Local',                  6.25, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Same State Metro',      12.41, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Same State Remote',     19.18, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Near State Capital',    10.80, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Near State Metro',      12.67, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Near State Remote',     21.07, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Distant State Capital', 13.22, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Distant State Metro',   17.68, NULL, NULL),
  ('eparcel', 'express',  'up_to_3kg',  'Distant State Remote',  26.06, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Local',                  6.55, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Same State Metro',      13.71, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Same State Remote',     23.42, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Near State Capital',    14.43, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Near State Metro',      16.96, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Near State Remote',     25.95, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Distant State Capital', 18.06, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Distant State Metro',   24.78, NULL, NULL),
  ('eparcel', 'express',  'up_to_5kg',  'Distant State Remote',  33.84, NULL, NULL),
  ('eparcel', 'express',  'per_kg',     'Local',                 NULL,  5.28, 0.33),
  ('eparcel', 'express',  'per_kg',     'Same State Metro',      NULL,  9.66, 0.99),
  ('eparcel', 'express',  'per_kg',     'Same State Remote',     NULL, 13.84, 2.20),
  ('eparcel', 'express',  'per_kg',     'Near State Capital',    NULL,  9.20, 1.25),
  ('eparcel', 'express',  'per_kg',     'Near State Metro',      NULL, 10.52, 1.53),
  ('eparcel', 'express',  'per_kg',     'Near State Remote',     NULL, 14.76, 2.57),
  ('eparcel', 'express',  'per_kg',     'Distant State Capital', NULL, 10.28, 1.82),
  ('eparcel', 'express',  'per_kg',     'Distant State Metro',   NULL, 12.52, 2.81),
  ('eparcel', 'express',  'per_kg',     'Distant State Remote',  NULL, 15.60, 4.05)
) AS v (carrier_code, service_type, size_label, zone, rate, base_rate, per_kg_rate)
JOIN public.carriers c ON c.code = v.carrier_code
JOIN public.carrier_services s
  ON s.carrier_id = c.id
 AND s.service_type = v.service_type
 AND s.size_label = v.size_label;

-- ── carrier_dispatch_options (25) ───────────────────────────────────────────
--
-- Which shipping_method values the engine is allowed to quote. A method absent
-- from this table simply never appears as an option.
--
-- Three deliberate absences:
--
--   Letter -- 134,391 historical orders, 66% of them, and still absent. It is
--     untracked mail with no rate structure to look up. xpros leaves it out for
--     the same reason. Staff can still set it by hand on the order.
--
--   Mypost_Reg_Xs_Box / Mypost_Exp_Xs_Box -- these exist in our shipping_method
--     enum, but Australia Post sells no XS box (flat_rate_package_specs has box
--     in S/M/L/XL only). Adding them to "complete the set" would put a
--     permanent `No spec for box XS` error row in every quote result.
--
-- The multi-origin eParcel methods (Eparcel_NSW/QLD/WA, Express_NSW/QLD/WA) are
-- not in our enum at all -- decision 1.

INSERT INTO public.carrier_dispatch_options (
  shipping_method, carrier_id, service_type, fixed_price_aud, max_order_total_aud,
  max_packed_thickness_mm, max_packed_length_mm, max_packed_width_mm
)
SELECT v.shipping_method::public.shipping_method, c.id, v.service_type,
       v.fixed_price_aud, v.max_order_total_aud,
       v.max_packed_thickness_mm, v.max_packed_length_mm, v.max_packed_width_mm
FROM (VALUES
  -- MyPost, unsized: priced off chargeable weight against the rate card.
  ('Mypost_Regular',        'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Express',        'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  -- MyPost flat-rate boxes and satchels: the size determines the price, so the
  -- engine looks the packaging up in flat_rate_package_specs and prices the
  -- weight it maps to.
  ('Mypost_Reg_S_Box',      'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_M_Box',      'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_L_Box',      'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_XL_Box',     'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_S_Box',      'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_M_Box',      'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_L_Box',      'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_XL_Box',     'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  -- The three max_packed_* columns are NULL on every satchel row, including
  -- Mypost_Reg_Xs_Satchel. xpros fills that one row with 260/160/90, which
  -- cannot be right: it claims a thickness larger than its own length, and the
  -- XS satchel is 280 x 215mm. canQuote would test those numbers against the
  -- shortest, longest and middle edge of the package and reject orders the
  -- satchel actually fits, quoting them to something dearer without any error.
  -- Left empty so flat_rate_package_specs decides, which is what the other four
  -- satchel sizes already do.
  ('Mypost_Reg_Xs_Satchel', 'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_S_Satchel',  'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_M_Satchel',  'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_L_Satchel',  'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Reg_XL_Satchel', 'mypost',  'standard', NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_Xs_Satchel', 'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_S_Satchel',  'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_M_Satchel',  'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_L_Satchel',  'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  ('Mypost_Exp_XL_Satchel', 'mypost',  'express',  NULL, NULL, NULL, NULL, NULL),
  -- eParcel
  ('Eparcel_Regular',       'eparcel', 'standard', NULL, NULL, NULL, NULL, NULL),
  ('Eparcel_Express',       'eparcel', 'express',  NULL, NULL, NULL, NULL, NULL),
  -- Aramex quotes live over its API, so no service_type and no rate card. The
  -- $200 ceiling is the transit insurance limit on the account.
  ('Aramex_Parcel',         'aramex',   NULL,      NULL, 200.00, NULL, NULL, NULL),
  ('Aramex_Satchel',        'aramex',   NULL,      NULL, 200.00, NULL, NULL, NULL),
  -- Registered Post prepaid labels: one price, bought in advance, no zones and
  -- no weight tiers. $5.00 is the go2office rate, confirmed 2026-08-16 as
  -- unchanged from xhunter's.
  --
  -- The number only affects which option wins, and it fails quietly either way:
  -- set it too high and Register_Letter is never selected, too low and it takes
  -- orders that should have gone MyPost. Its four ceilings are the $100
  -- Registered Post cover limit and an A4 envelope, 20mm thick.
  ('Register_Letter',       'reg_letter', NULL,    5.00, 100.00, 20, 297, 210)
) AS v (
  shipping_method, carrier_code, service_type, fixed_price_aud, max_order_total_aud,
  max_packed_thickness_mm, max_packed_length_mm, max_packed_width_mm
)
JOIN public.carriers c ON c.code = v.carrier_code;

-- ── flat_rate_package_specs (9) ─────────────────────────────────────────────
--
-- Australia Post's prepaid packaging. maps_to_weight_kg is what the carrier
-- charges the satchel or box as, whatever it actually weighs.
--
-- Box XS is absent because Australia Post does not sell one -- see the note on
-- dispatch options above.

INSERT INTO public.flat_rate_package_specs
  (package_type, size_label, length_mm, width_mm, depth_mm, maps_to_weight_kg, sort_order)
VALUES
  ('satchel', 'XS', 280, 215, NULL, 0.25, 0),
  ('satchel', 'S',  355, 225, NULL, 0.50, 1),
  ('satchel', 'M',  390, 270, NULL, 1.00, 2),
  ('satchel', 'L',  415, 315, NULL, 3.00, 3),
  ('satchel', 'XL', 510, 440, NULL, 5.00, 4),
  ('box',     'S',  220, 160,  70, 0.50, 1),
  ('box',     'M',  240, 190, 120, 1.00, 2),
  ('box',     'L',  390, 280, 140, 3.00, 3),
  ('box',     'XL', 440, 277, 168, 5.00, 4);

-- ── Row-count assertion ─────────────────────────────────────────────────────
--
-- Every insert above resolves its parent through a JOIN, and a JOIN that finds
-- no match drops the row rather than complaining. A mistyped carrier code or
-- size_label would leave a quietly incomplete rate card -- orders would still
-- quote, just to the wrong carrier or not at all for one tier.

DO $$
DECLARE
  v_carriers   bigint;
  v_services   bigint;
  v_rates      bigint;
  v_options    bigint;
  v_specs      bigint;
BEGIN
  SELECT count(*) INTO v_carriers FROM public.carriers;
  SELECT count(*) INTO v_services FROM public.carrier_services;
  SELECT count(*) INTO v_rates    FROM public.carrier_zone_rates;
  SELECT count(*) INTO v_options  FROM public.carrier_dispatch_options;
  SELECT count(*) INTO v_specs    FROM public.flat_rate_package_specs;

  IF v_carriers <> 4 OR v_services <> 22 OR v_rates <> 138
     OR v_options <> 25 OR v_specs <> 9 THEN
    RAISE EXCEPTION
      'Carrier seed incomplete: carriers=% (want 4), services=% (want 22), rates=% (want 138), options=% (want 25), specs=% (want 9). A parent lookup in this file failed to match.',
      v_carriers, v_services, v_rates, v_options, v_specs;
  END IF;
END $$;

COMMIT;
