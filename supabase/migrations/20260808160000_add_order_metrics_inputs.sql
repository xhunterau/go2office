BEGIN;

-- Inputs that public.order_metrics_summary (migration 20260808170000) needs and
-- this schema does not yet have. Split out from the summary table itself so the
-- "what the business tracks" change is reviewable on its own.

-- ---------------------------------------------------------------------------
-- 1. Order money: what we paid out, and what we gave away.
-- ---------------------------------------------------------------------------
-- orders.postage_and_handling is what the CUSTOMER paid us. Profit needs the
-- other side of that -- what we paid the carrier -- and the discount granted.
-- Neither exists in the legacy data, so every one of the 203315 migrated orders
-- starts at 0.
--
-- Read that honestly when looking at website_profit on historical orders: a
-- postage_paid of 0 does not mean the parcel shipped free, it means nobody
-- recorded the cost. Profit on history is therefore overstated by roughly the
-- postage. Only orders entered after this migration carry a real figure.
ALTER TABLE public.orders
  ADD COLUMN postage_paid numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN discount     numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_postage_paid_non_negative CHECK (postage_paid >= 0),
  -- A discount is stored as a positive number and SUBTRACTED. Allowing a
  -- negative here would let it act as a surcharge, which is a different concept
  -- that should get its own column if it is ever wanted.
  ADD CONSTRAINT orders_discount_non_negative CHECK (discount >= 0);

-- ---------------------------------------------------------------------------
-- 2. Parcel volumetric factor.
-- ---------------------------------------------------------------------------
-- Deliberately a THIRD factor rather than reuse of air_volumetric_kg_per_cbm or
-- sea_volumetric_kg_per_cbm. Those two price inbound freight from the supplier
-- and feed product_pricing; this one prices an outbound domestic parcel. They
-- move for unrelated commercial reasons, and sharing a column would mean
-- renegotiating a sea freight rate silently restated the chargeable weight of
-- every order in the system.
--
-- 250 kg/m3 is the figure the xpros implementation hardcoded (as the constant
-- 4000000, dimensions being in mm: 1e9 mm3/m3 / 250 = 4e6). Carried over as the
-- default so the ported numbers reconcile, but configurable from the start
-- because Australian carriers are not unanimous on it.
ALTER TABLE public.pricing_settings
  ADD COLUMN parcel_volumetric_kg_per_cbm numeric(10, 2) NOT NULL DEFAULT 250;

ALTER TABLE public.pricing_settings
  ADD CONSTRAINT pricing_settings_parcel_volumetric_positive
    CHECK (parcel_volumetric_kg_per_cbm > 0);

COMMIT;
