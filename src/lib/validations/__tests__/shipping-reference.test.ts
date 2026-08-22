import { describe, expect, it } from "vitest"

import {
  carrierCreateSchema,
  carrierServiceFormSchema,
  carrierServiceSchema,
  dispatchOptionSchema,
  NO_SERVICE_TYPE,
  packageSpecFormSchema,
  packageSpecSchema,
  toServiceTypeColumn,
  zoneRateFormSchema,
  zoneRateSchema,
} from "@/lib/validations/shipping-reference"

// These schemas guard four things the database would otherwise accept quietly
// or reject with a message nobody can act on. Each block below is one of them.

describe("carrierCreateSchema", () => {
  it("keeps the code to the lowercase key shape the engine looks carriers up by", () => {
    expect(carrierCreateSchema.safeParse({
      code: "eparcel",
      name: "Australia Post eParcel",
      is_active: true,
    }).success).toBe(true)

    // Mirrors carriers_code_lower. A capitalised code would pass PostgREST's
    // insert only to fail the CHECK, and CARRIER_CAPABILITIES would never match
    // it either way.
    expect(carrierCreateSchema.safeParse({
      code: "Eparcel",
      name: "x",
      is_active: true,
    }).success).toBe(false)

    expect(carrierCreateSchema.safeParse({
      code: "reg letter",
      name: "x",
      is_active: true,
    }).success).toBe(false)
  })
})

describe("carrierServiceSchema", () => {
  it("lowercases service_type, because the dispatch option joins to it", () => {
    const parsed = carrierServiceSchema.parse({
      service_type: " Standard ",
      size_label: "3kg",
      max_weight: "3",
      sort_order: "2",
    })
    expect(parsed.service_type).toBe("standard")
    expect(parsed.max_weight).toBe(3)
  })

  it("reads a blank max weight as the per-kg tier rather than as zero", () => {
    expect(carrierServiceSchema.parse({
      service_type: "standard",
      size_label: "Over 5kg",
      max_weight: "",
      sort_order: "9",
    }).max_weight).toBeNull()
  })

  it("rejects a zero or negative tier weight", () => {
    for (const max_weight of ["0", "-1"]) {
      expect(
        carrierServiceSchema.safeParse({
          service_type: "standard",
          size_label: "x",
          max_weight,
          sort_order: "0",
        }).success
      ).toBe(false)
    }
  })
})

describe("zoneRateSchema", () => {
  it("accepts either pricing method", () => {
    expect(zoneRateSchema.safeParse({
      rate: "9.83",
      base_rate: "",
      per_kg_rate: "",
      min_charge: "",
    }).success).toBe(true)

    expect(zoneRateSchema.safeParse({
      rate: "",
      base_rate: "12.50",
      per_kg_rate: "1.80",
      min_charge: "15",
    }).success).toBe(true)
  })

  it("refuses a cell with neither, which would price at $0 and win outright", () => {
    // Mirrors carrier_zone_rates_has_pricing. The constraint exists because a
    // $0 quote is not an error anywhere downstream -- it is simply the cheapest
    // option.
    const result = zoneRateSchema.safeParse({
      rate: "",
      base_rate: "",
      per_kg_rate: "",
      min_charge: "",
    })
    expect(result.success).toBe(false)

    // Half of the per-kg pair is not enough either.
    expect(zoneRateSchema.safeParse({
      rate: "",
      base_rate: "12.50",
      per_kg_rate: "",
      min_charge: "",
    }).success).toBe(false)
  })

  it("keeps an explicit zero, which is a real rate and not an empty cell", () => {
    expect(zoneRateSchema.parse({
      rate: "0",
      base_rate: "",
      per_kg_rate: "",
      min_charge: "",
    }).rate).toBe(0)
  })

  it("holds the same line on the form side", () => {
    expect(zoneRateFormSchema.safeParse({
      rate: "",
      base_rate: "",
      per_kg_rate: "",
      min_charge: "",
    }).success).toBe(false)
    expect(zoneRateFormSchema.safeParse({
      rate: "9.83",
      base_rate: "",
      per_kg_rate: "",
      min_charge: "",
    }).success).toBe(true)
  })
})

describe("packageSpecSchema", () => {
  it("requires a depth on a box and allows a satchel to have none", () => {
    // The fit check is 3D for a box and 2D for a satchel: a box with no depth
    // would compare the item's shortest edge against 0 and never fit.
    expect(packageSpecSchema.safeParse({
      package_type: "box",
      size_label: "M",
      length_mm: "310",
      width_mm: "225",
      depth_mm: "",
      maps_to_weight_kg: "5",
      sort_order: "3",
    }).success).toBe(false)

    expect(packageSpecSchema.safeParse({
      package_type: "satchel",
      size_label: "M",
      length_mm: "310",
      width_mm: "405",
      depth_mm: "",
      maps_to_weight_kg: "3",
      sort_order: "3",
    }).success).toBe(true)
  })

  it("holds the same line on the form side", () => {
    expect(packageSpecFormSchema.safeParse({
      package_type: "box",
      size_label: "M",
      length_mm: "310",
      width_mm: "225",
      depth_mm: "",
      maps_to_weight_kg: "5",
      sort_order: "3",
    }).success).toBe(false)
  })

  it("rejects a fractional millimetre", () => {
    expect(packageSpecFormSchema.safeParse({
      package_type: "satchel",
      size_label: "M",
      length_mm: "310.5",
      width_mm: "405",
      depth_mm: "",
      maps_to_weight_kg: "3",
      sort_order: "3",
    }).success).toBe(false)
  })
})

describe("dispatchOptionSchema", () => {
  it("maps the select's 'none' sentinel back to a null column", () => {
    // aramex and reg_letter never read the rate card, so a null service_type is
    // the correct state rather than a missing value.
    expect(toServiceTypeColumn(NO_SERVICE_TYPE)).toBeNull()
    expect(toServiceTypeColumn("Standard")).toBe("standard")
  })

  it("reads blank limits as absent rather than as zero", () => {
    const parsed = dispatchOptionSchema.parse({
      shipping_method: "Eparcel_Regular",
      carrier_id: "1",
      billing_weight_mode: "chargeable",
      service_type: "standard",
      fixed_price_aud: "",
      max_order_total_aud: "",
      max_packed_thickness_mm: "",
      max_packed_length_mm: "",
      max_packed_width_mm: "",
      is_active: true,
    })
    // A zero here would drop every order from the option instead of applying no
    // limit at all.
    expect(parsed.fixed_price_aud).toBeNull()
    expect(parsed.max_order_total_aud).toBeNull()
    expect(parsed.max_packed_length_mm).toBeNull()
  })

  it("rejects a shipping method outside the enum", () => {
    expect(dispatchOptionSchema.safeParse({
      shipping_method: "Eparcel_NSW",
      carrier_id: "1",
      billing_weight_mode: "chargeable",
      service_type: "standard",
      fixed_price_aud: "",
      max_order_total_aud: "",
      max_packed_thickness_mm: "",
      max_packed_length_mm: "",
      max_packed_width_mm: "",
      is_active: true,
    }).success).toBe(false)
  })
})

describe("carrierServiceFormSchema", () => {
  it("accepts a blank max weight and a zero sort order", () => {
    expect(carrierServiceFormSchema.safeParse({
      service_type: "standard",
      size_label: "Over 5kg",
      max_weight: "",
      sort_order: "0",
    }).success).toBe(true)
  })

  it("rejects a negative sort order", () => {
    expect(carrierServiceFormSchema.safeParse({
      service_type: "standard",
      size_label: "x",
      max_weight: "",
      sort_order: "-1",
    }).success).toBe(false)
  })
})
