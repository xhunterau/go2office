import { describe, expect, it } from "vitest"

import {
  normalizeLocality,
  normalizePostcode,
} from "@/lib/shipping/adapters/zone-resolver"

// These two have to agree exactly with standardize_customer_address()
// (migration 20260809130000). Two different readings of the same
// (postcode, city) pair produce a customer whose state resolves and whose
// shipping zone does not, which is a hard fault to trace back here.
describe("normalizePostcode", () => {
  it("pads to the four digits the reference table stores", () => {
    expect(normalizePostcode("800")).toBe("0800")
    expect(normalizePostcode("200")).toBe("0200")
    expect(normalizePostcode("12")).toBe("0012")
  })

  it("leaves a four-digit postcode alone", () => {
    expect(normalizePostcode("3000")).toBe("3000")
  })

  it("trims surrounding whitespace, as btrim does", () => {
    expect(normalizePostcode("  3000 ")).toBe("3000")
  })

  it("truncates anything longer, as Postgres lpad does", () => {
    expect(normalizePostcode("30001")).toBe("3000")
  })
})

describe("normalizeLocality", () => {
  it("uppercases, because postcodes.locality is CHECK-constrained to upper()", () => {
    expect(normalizeLocality("Port Melbourne")).toBe("PORT MELBOURNE")
  })

  it("trims", () => {
    expect(normalizeLocality("  MELBOURNE  ")).toBe("MELBOURNE")
  })
})
