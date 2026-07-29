import { z } from "zod"

// Mirrors the CHECK constraints on public.pricing_settings so the same rules are
// enforced client-side and server-side (project rule 6).
const positive = (label: string) =>
  z
    .number({ message: `${label} is required` })
    .finite(`${label} must be a number`)
    .positive(`${label} must be greater than 0`)

export const pricingSettingsSchema = z.object({
  // 1 USD = x AUD — multiply a USD purchase price by this.
  usd_to_aud: positive("USD to AUD"),
  // 1 AUD = x CNY — divide a CNY purchase price by this. The opposite direction
  // to usd_to_aud; inherited from the legacy System Constants screen.
  aud_to_cny: positive("AUD to CNY"),
  // A fraction, not a percentage: 0.1 means 10%. Anything >= 1 would silently
  // corrupt every landed cost, so it is rejected rather than clamped.
  gst_rate: z
    .number({ message: "GST rate is required" })
    .min(0, "GST rate cannot be negative")
    .lt(1, "GST rate is a fraction, e.g. 0.1 for 10%"),
  air_freight_aud_per_kg: positive("Air freight per kg"),
  sea_freight_aud_per_cbm: positive("Sea freight per cbm"),
  air_volumetric_kg_per_cbm: positive("Air volumetric factor"),
  sea_volumetric_kg_per_cbm: positive("Sea volumetric factor"),
})

export type PricingSettingsInput = z.infer<typeof pricingSettingsSchema>
