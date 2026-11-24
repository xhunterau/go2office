import { describe, expect, it } from "vitest"

import {
  editableSectionFields,
  productSectionFormSchema,
  productSectionSchema,
} from "@/lib/validations/product"

const commercialForm = {
  currency: "CNY",
  purchase_price: "6",
  is_gst: false,
  weight: "0.3",
  length: "300",
  width: "200",
  height: "10",
}

describe("editableSectionFields", () => {
  it("keeps the retail price out of the Commercial section", () => {
    expect(editableSectionFields("commercial", false)).not.toContain("retail_price")
    expect(editableSectionFields("commercial", false)).toContain("purchase_price")
  })

  it("leaves a kit's Commercial section with nothing it derives", () => {
    expect(editableSectionFields("commercial", true)).toEqual([])
  })

  it("hides only a kit's origin in Details", () => {
    expect(editableSectionFields("details", false)).toContain("origin_id")
    expect(editableSectionFields("details", true)).not.toContain("origin_id")
    expect(editableSectionFields("details", true)).toContain("is_kit")
  })
})

describe("section schemas", () => {
  // The bug: a hidden retail_price of 0 failed validation where nobody could
  // see it, and Save did nothing (2026-11-25).
  it("saves a product whose hidden retail price is 0", () => {
    const values = { ...commercialForm, retail_price: "0" }
    expect(productSectionFormSchema("commercial", false).safeParse(values).success).toBe(true)

    const parsed = productSectionSchema("commercial", false).parse(values)
    expect(parsed).not.toHaveProperty("retail_price")
  })

  it("never writes a kit's derived placeholders", () => {
    const parsed = productSectionSchema("commercial", true).parse({
      ...commercialForm,
      purchase_price: "0",
      weight: "0",
    })
    expect(parsed).toEqual({})
  })

  it("still validates the fields that are shown", () => {
    const result = productSectionFormSchema("commercial", false).safeParse({
      ...commercialForm,
      weight: "0",
    })
    expect(result.success).toBe(false)
  })
})
