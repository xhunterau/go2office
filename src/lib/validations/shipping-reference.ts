import { z } from "zod"

import { SHIPPING_METHOD_OPTIONS } from "@/lib/orders/shipping-method"

// Mirrors the constraints declared in migration 20260810100000 so the same
// rules hold client-side and server-side (project rule 6). Where a CHECK exists
// the message here explains the consequence rather than restating the SQL --
// the database will reject it either way, but only this side can say why it
// matters.

// Blank number inputs arrive as "" or NaN; both mean "not set" for a nullable
// column, and neither should be coerced to 0. A 0 in a rate column is a real
// value that wins every price comparison outright.
const nullablePositive = (label: string) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined || Number.isNaN(value)
        ? null
        : value,
    z.coerce
      .number()
      .positive(`${label} must be greater than 0`)
      .nullable()
  )

const nullablePositiveInt = (label: string) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined || Number.isNaN(value)
        ? null
        : value,
    z.coerce
      .number()
      .int(`${label} must be a whole number`)
      .positive(`${label} must be greater than 0`)
      .nullable()
  )

const nullableMoney = (label: string) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined || Number.isNaN(value)
        ? null
        : value,
    z.coerce
      .number()
      .min(0, `${label} cannot be negative`)
      .nullable()
  )

// ── carriers ──────────────────────────────────────────────────────────────

// Split in two on purpose. `code` is settable at creation and immutable
// afterwards -- CARRIER_CAPABILITIES in src/lib/shipping/carrier-capabilities.ts
// is keyed by it, so an edit would detach the carrier from its own weight and
// dimension limits without raising anything. Migration 20260812100000 enforces
// the same split at the column-grant level; this is the half the user sees.
export const carrierCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32, "Code is too long")
    .regex(
      /^[a-z0-9_]+$/,
      "Lowercase letters, digits and underscores only — it is a key, not a label"
    ),
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  is_active: z.boolean(),
})

export const carrierUpdateSchema = carrierCreateSchema.omit({ code: true })

export type CarrierCreateInput = z.input<typeof carrierCreateSchema>
export type CarrierUpdateInput = z.input<typeof carrierUpdateSchema>

// ── carrier services (rate card rows) ─────────────────────────────────────

export const carrierServiceSchema = z.object({
  // Lowercased rather than validated as lowercase, for the same reason the
  // column has a CHECK: carrier_dispatch_options.service_type joins to it, and
  // a mixed-case row simply matches nothing.
  service_type: z
    .string()
    .trim()
    .min(1, "Service type is required")
    .max(32, "Service type is too long")
    .transform((value) => value.toLowerCase()),
  size_label: z
    .string()
    .trim()
    .min(1, "Size label is required")
    .max(32, "Size label is too long"),
  // Null marks the per-kg overflow tier, which applies above every fixed tier.
  // At most one per (carrier, service_type) -- a second is unreachable, since
  // the lookup falls through to the first it finds.
  max_weight: nullablePositive("Max weight"),
  sort_order: z.coerce
    .number()
    .int("Sort order must be a whole number")
    .min(0, "Sort order cannot be negative"),
})

export type CarrierServiceInput = z.input<typeof carrierServiceSchema>

// ── zone rates (rate card cells) ──────────────────────────────────────────

// Mirrors carrier_zone_rates_has_pricing. A row with neither method filled in
// prices at $0, and $0 wins the cheapest-option comparison outright -- so this
// is rejected here rather than left to surface as an order that shipped free.
export const zoneRateSchema = z
  .object({
    rate: nullableMoney("Rate"),
    base_rate: nullableMoney("Base rate"),
    per_kg_rate: nullableMoney("Per kg rate"),
    min_charge: nullableMoney("Minimum charge"),
  })
  .refine(
    (values) =>
      values.rate !== null ||
      (values.base_rate !== null && values.per_kg_rate !== null),
    {
      message:
        "Enter either a flat rate, or both a base rate and a per kg rate — a cell with neither prices at $0.",
      path: ["rate"],
    }
  )

export type ZoneRateInput = z.input<typeof zoneRateSchema>

// ── dispatch options ──────────────────────────────────────────────────────

export const BILLING_WEIGHT_MODES = ["chargeable", "actual"] as const

// The Select's stand-in for null -- shadcn SelectItem forbids an empty value.
export const NO_SERVICE_TYPE = "none"

export const dispatchOptionSchema = z.object({
  shipping_method: z.enum(SHIPPING_METHOD_OPTIONS),
  carrier_id: z.coerce
    .number()
    .int()
    .positive("Carrier is required"),
  billing_weight_mode: z.enum(BILLING_WEIGHT_MODES),
  // NO_SERVICE_TYPE for the carriers that never read the rate card: aramex
  // prices over its API and reg_letter has a fixed price.
  service_type: z.string().trim().min(1, "Service type is required"),
  // Non-null short-circuits the whole engine: no zone lookup, no rate card.
  fixed_price_aud: nullableMoney("Fixed price"),
  max_order_total_aud: nullableMoney("Max order total"),
  max_packed_thickness_mm: nullablePositiveInt("Max packed thickness"),
  max_packed_length_mm: nullablePositiveInt("Max packed length"),
  max_packed_width_mm: nullablePositiveInt("Max packed width"),
  is_active: z.boolean(),
})

export type DispatchOptionInput = z.input<typeof dispatchOptionSchema>

export function toServiceTypeColumn(value: string): string | null {
  return value === NO_SERVICE_TYPE ? null : value.toLowerCase()
}

// ── flat-rate package specs ───────────────────────────────────────────────

export const PACKAGE_TYPES = ["satchel", "box"] as const
export const PACKAGE_SIZE_LABELS = ["XS", "S", "M", "L", "XL"] as const

export const packageSpecSchema = z
  .object({
    package_type: z.enum(PACKAGE_TYPES),
    size_label: z.enum(PACKAGE_SIZE_LABELS),
    length_mm: z.coerce
      .number()
      .int("Length must be a whole number of mm")
      .positive("Length must be greater than 0"),
    width_mm: z.coerce
      .number()
      .int("Width must be a whole number of mm")
      .positive("Width must be greater than 0"),
    // Satchels have no fixed depth -- they take whatever fits, which is why the
    // satchel fit check adds the item's thickness to both other axes instead.
    depth_mm: nullablePositiveInt("Depth"),
    maps_to_weight_kg: z.coerce
      .number()
      .positive("Billed weight must be greater than 0"),
    sort_order: z.coerce
      .number()
      .int("Sort order must be a whole number")
      .min(0, "Sort order cannot be negative"),
  })
  .refine(
    (values) => values.package_type !== "box" || values.depth_mm !== null,
    {
      message: "A box needs a depth — the fit check is strict 3D containment.",
      path: ["depth_mm"],
    }
  )

export type PackageSpecInput = z.input<typeof packageSpecSchema>

// ── shipping settings ─────────────────────────────────────────────────────

const positive = (label: string) =>
  z
    .number({ message: `${label} is required` })
    .finite(`${label} must be a number`)
    .positive(`${label} must be greater than 0`)

export const shippingSettingsSchema = z.object({
  au_post_max_length_mm: positive("Max length"),
  au_post_max_weight_kg: positive("Max weight"),
  eparcel_oversize_surcharge_aud: z
    .number({ message: "Oversize surcharge is required" })
    .finite("Oversize surcharge must be a number")
    .min(0, "Oversize surcharge cannot be negative"),
  eparcel_oversize_threshold_mm: z
    .number({ message: "Oversize threshold is required" })
    .int("Oversize threshold must be a whole number of mm")
    .positive("Oversize threshold must be greater than 0"),
  // A fraction, not a percentage.
  eparcel_fuel_charge_rate: z
    .number({ message: "Fuel charge is required" })
    .min(0, "Fuel charge cannot be negative")
    .lt(1, "Fuel charge is a fraction, e.g. 0.099 for 9.9%"),
  // Two quotes within this fraction of each other count as the same price, and
  // the tie goes to the preferred carrier. At 0 the cheapest row always wins;
  // at 1 the first carrier always does.
  quote_tiebreak_threshold: z
    .number({ message: "Tiebreak threshold is required" })
    .min(0, "Tiebreak threshold cannot be negative")
    .lt(1, "Tiebreak threshold is a fraction, e.g. 0.05 for 5%"),
})

export type ShippingSettingsInput = z.infer<typeof shippingSettingsSchema>

// ── form-side schemas ─────────────────────────────────────────────────────
//
// The dialogs bind plain strings, because that is what HTML inputs produce, and
// validate them as strings so z.input matches z.output and react-hook-form's
// types stay clean. The server schemas above coerce the same values on arrival
// -- project rule 6's two halves, in the shape the product dialogs already use.

const requiredNumberField = (
  label: string,
  options: { int?: boolean; min?: number; exclusiveMin?: number } = {}
) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => Number.isFinite(Number(value)), {
      message: `${label} must be a number`,
    })
    .refine((value) => !options.int || Number.isInteger(Number(value)), {
      message: `${label} must be a whole number`,
    })
    .refine(
      (value) =>
        options.exclusiveMin === undefined || Number(value) > options.exclusiveMin,
      { message: `${label} must be greater than ${options.exclusiveMin}` }
    )
    .refine((value) => options.min === undefined || Number(value) >= options.min, {
      message: `${label} cannot be less than ${options.min}`,
    })

const optionalNumberField = (
  label: string,
  options: { int?: boolean; min?: number; exclusiveMin?: number } = {}
) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || Number.isFinite(Number(value)), {
      message: `${label} must be a number`,
    })
    .refine(
      (value) => value === "" || !options.int || Number.isInteger(Number(value)),
      { message: `${label} must be a whole number` }
    )
    .refine(
      (value) =>
        value === "" ||
        options.exclusiveMin === undefined ||
        Number(value) > options.exclusiveMin,
      { message: `${label} must be greater than ${options.exclusiveMin}` }
    )
    .refine(
      (value) =>
        value === "" || options.min === undefined || Number(value) >= options.min,
      { message: `${label} cannot be less than ${options.min}` }
    )

export const packageSpecFormSchema = z
  .object({
    package_type: z.enum(PACKAGE_TYPES),
    size_label: z.enum(PACKAGE_SIZE_LABELS),
    length_mm: requiredNumberField("Length", { int: true, exclusiveMin: 0 }),
    width_mm: requiredNumberField("Width", { int: true, exclusiveMin: 0 }),
    depth_mm: optionalNumberField("Depth", { int: true, exclusiveMin: 0 }),
    maps_to_weight_kg: requiredNumberField("Billed weight", { exclusiveMin: 0 }),
    sort_order: requiredNumberField("Sort order", { int: true, min: 0 }),
  })
  .refine((values) => values.package_type !== "box" || values.depth_mm !== "", {
    message: "A box needs a depth — the fit check is strict 3D containment.",
    path: ["depth_mm"],
  })

export type PackageSpecFormValues = z.infer<typeof packageSpecFormSchema>

export const carrierServiceFormSchema = z.object({
  service_type: z
    .string()
    .trim()
    .min(1, "Service type is required")
    .max(32, "Service type is too long"),
  size_label: z
    .string()
    .trim()
    .min(1, "Size label is required")
    .max(32, "Size label is too long"),
  max_weight: optionalNumberField("Max weight", { exclusiveMin: 0 }),
  sort_order: requiredNumberField("Sort order", { int: true, min: 0 }),
})

export type CarrierServiceFormValues = z.infer<typeof carrierServiceFormSchema>

export const zoneRateFormSchema = z
  .object({
    rate: optionalNumberField("Rate", { min: 0 }),
    base_rate: optionalNumberField("Base rate", { min: 0 }),
    per_kg_rate: optionalNumberField("Per kg rate", { min: 0 }),
    min_charge: optionalNumberField("Minimum charge", { min: 0 }),
  })
  .refine(
    (values) =>
      values.rate !== "" || (values.base_rate !== "" && values.per_kg_rate !== ""),
    {
      message:
        "Enter either a flat rate, or both a base rate and a per kg rate — a cell with neither prices at $0.",
      path: ["rate"],
    }
  )

export type ZoneRateFormValues = z.infer<typeof zoneRateFormSchema>

export const dispatchOptionFormSchema = z.object({
  shipping_method: z.enum(SHIPPING_METHOD_OPTIONS),
  carrier_id: z
    .string()
    .min(1, "Carrier is required")
    .refine((value) => Number.isInteger(Number(value)) && Number(value) > 0, {
      message: "Carrier is required",
    }),
  billing_weight_mode: z.enum(BILLING_WEIGHT_MODES),
  service_type: z.string().min(1, "Service type is required"),
  fixed_price_aud: optionalNumberField("Fixed price", { min: 0 }),
  max_order_total_aud: optionalNumberField("Max order total", { min: 0 }),
  max_packed_thickness_mm: optionalNumberField("Max packed thickness", {
    int: true,
    exclusiveMin: 0,
  }),
  max_packed_length_mm: optionalNumberField("Max packed length", {
    int: true,
    exclusiveMin: 0,
  }),
  max_packed_width_mm: optionalNumberField("Max packed width", {
    int: true,
    exclusiveMin: 0,
  }),
  is_active: z.boolean(),
})

export type DispatchOptionFormValues = z.infer<typeof dispatchOptionFormSchema>
