BEGIN;

-- Global constants driving the pricing engine (exchange rates, freight rates,
-- GST). Mirrors the legacy Laravel "System Constants" screen so the numbers and
-- their meaning carry over unchanged for existing staff.
-- See docs/product-pricing-view.md section 2.1 for the design decisions.
--
-- Single-row table rather than a generic key/value store: public.product_pricing
-- does arithmetic on these values, and typed columns give both correct numeric
-- math and generated TypeScript types (no `any` in the payload).
CREATE TABLE public.pricing_settings (
  -- CHECK (id = 1) is what physically enforces "single row" — no trigger needed.
  id smallint PRIMARY KEY DEFAULT 1,

  -- The two exchange rates run in OPPOSITE directions. This is inherited from
  -- the legacy system and kept deliberately: the column names carry the
  -- direction so callers cannot guess wrong.
  --   usd_to_aud: 1 USD = 1.5 AUD   -> MULTIPLY a USD price
  --   aud_to_cny: 1 AUD = 4.4 CNY   -> DIVIDE a CNY price
  usd_to_aud numeric(12, 6) NOT NULL,
  aud_to_cny numeric(12, 6) NOT NULL,

  -- Australian GST. Applied to strip tax off GST-inclusive AUD purchase prices
  -- and off the shelf retail price when computing margin.
  gst_rate numeric(6, 4) NOT NULL DEFAULT 0.10,

  -- Air freight bills per chargeable KILOGRAM, sea freight per CUBIC METRE.
  -- The asymmetry is real (it is how freight forwarders quote), not a typo.
  air_freight_aud_per_kg numeric(12, 2) NOT NULL,
  sea_freight_aud_per_cbm numeric(12, 2) NOT NULL,

  -- Volumetric-weight conversion factors, used to take the greater of actual
  -- weight and volumetric weight. New relative to the legacy system, which
  -- appears to have billed on one dimension only.
  air_volumetric_kg_per_cbm numeric(10, 2) NOT NULL DEFAULT 167,
  sea_volumetric_kg_per_cbm numeric(10, 2) NOT NULL DEFAULT 1000,

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pricing_settings_single_row CHECK (id = 1),
  CONSTRAINT pricing_settings_usd_to_aud_positive CHECK (usd_to_aud > 0),
  CONSTRAINT pricing_settings_aud_to_cny_positive CHECK (aud_to_cny > 0),
  -- GST must stay below 1: the formulas divide by (1 + gst_rate) and treat it as
  -- a fraction, so a value like 10 (meaning "10%") would silently corrupt every
  -- cost in the system.
  CONSTRAINT pricing_settings_gst_rate_fraction CHECK (gst_rate >= 0 AND gst_rate < 1),
  CONSTRAINT pricing_settings_air_freight_positive CHECK (air_freight_aud_per_kg > 0),
  CONSTRAINT pricing_settings_sea_freight_positive CHECK (sea_freight_aud_per_cbm > 0),
  CONSTRAINT pricing_settings_air_volumetric_positive CHECK (air_volumetric_kg_per_cbm > 0),
  CONSTRAINT pricing_settings_sea_volumetric_positive CHECK (sea_volumetric_kg_per_cbm > 0)
);

-- Same timestamp handling as public.products (migration 20260719150000): the DB
-- owns updated_at, application code never sets it.
CREATE TRIGGER pricing_settings_set_updated_at
  BEFORE UPDATE ON public.pricing_settings
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

-- Seed values carried over from the legacy System Constants screen
-- (last updated there 2026-06-02).
INSERT INTO public.pricing_settings (
  id,
  usd_to_aud,
  aud_to_cny,
  gst_rate,
  air_freight_aud_per_kg,
  sea_freight_aud_per_cbm
) VALUES (1, 1.5, 4.4, 0.10, 15, 240);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

-- No INSERT/DELETE policy: the seed row is the only row that may ever exist, so
-- authenticated users get UPDATE and SELECT only.
CREATE POLICY "authenticated_read" ON public.pricing_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_update" ON public.pricing_settings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, UPDATE ON public.pricing_settings TO authenticated;

COMMIT;
