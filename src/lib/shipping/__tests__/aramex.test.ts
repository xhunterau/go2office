import { describe, expect, it } from "vitest"

import {
  aramexQuote,
  buildAramexItem,
  determineSatchelSize,
} from "@/lib/shipping/adapters/aramex.adapter"
import { mmToCm } from "@/lib/shipping/dimensions"
import type { OrderPackage } from "@/lib/shipping/types"

function pkg(overrides: Partial<OrderPackage> = {}): OrderPackage {
  return {
    totalWeightKg: 2,
    chargeableWeightKg: 2.5,
    maxDimensionMm: 305,
    packedLengthMm: 305,
    packedWidthMm: 204,
    packedHeightMm: 96,
    ...overrides,
  }
}

describe("determineSatchelSize", () => {
  it.each([
    [0.29, "300gm"],
    [0.3, "A5"],
    [0.49, "A5"],
    [0.5, "A4"],
    [0.99, "A4"],
    [1, "A3"],
    [2.99, "A3"],
    [3, "A2"],
    [4.99, "A2"],
  ])("bills %skg as %s", (weight, size) => {
    expect(determineSatchelSize(weight)).toBe(size)
  })

  it("throws above 5kg, which lands in the results table as that option's error", () => {
    expect(() => determineSatchelSize(5)).toThrow(/5kg satchel limit/)
  })
})

describe("buildAramexItem", () => {
  it("sends a satchel by size, with no dimensions", () => {
    const item = buildAramexItem("Aramex_Satchel", pkg())
    expect(item).toEqual({ Quantity: 1, PackageType: "S", SatchelSize: "A3" })
  })

  it("sends a parcel by weight and centimetres to one decimal", () => {
    const item = buildAramexItem("Aramex_Parcel", pkg())
    expect(item).toEqual({
      Quantity: 1,
      PackageType: "P",
      WeightDead: 2,
      Length: 30.5,
      Width: 20.4,
      Height: 9.6,
    })
  })

  it("omits a dimension the metrics could not measure rather than sending 0", () => {
    const item = buildAramexItem("Aramex_Parcel", pkg({ packedHeightMm: 0 }))
    expect(item.Height).toBeUndefined()
  })
})

describe("aramexQuote", () => {
  it("rounds the API's six-decimal answer to cents", async () => {
    // The real response for order 204226 was 70.806197. Left unrounded, the
    // engine ranks and logs a figure the numeric(10,2) column cannot hold.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("token")) {
        return new Response(
          JSON.stringify({ access_token: "t", expires_in: 3600, token_type: "Bearer" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({ data: { price: 64.37, tax: 6.44, total: 70.806197, items: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }) as typeof fetch

    process.env.ARAMEX_TOKEN_URL = "https://example.invalid/token"
    process.env.ARAMEX_API_BASE_URL = "https://example.invalid"
    process.env.ARAMEX_CLIENT_ID = "id"
    process.env.ARAMEX_CLIENT_SECRET = "secret"

    try {
      const quote = await aramexQuote(
        {
          id: 1,
          shippingMethod: "Aramex_Parcel",
          carrierId: 3,
          carrierCode: "aramex",
          billingWeightMode: "chargeable",
          serviceType: null,
          fixedPriceAud: null,
          maxOrderTotalAud: 200,
          maxPackedThicknessMm: null,
          maxPackedLengthMm: null,
          maxPackedWidthMm: null,
        },
        pkg(),
        { addressLine1: "1 Test Street", city: "MELBOURNE", state: "VIC", postcode: "3000" }
      )
      expect(quote.quotedRate).toBe(70.81)
      expect(quote.computationType).toBe("api")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("mmToCm", () => {
  it("rounds to one decimal for the Aramex API", () => {
    expect(mmToCm(305, "round1")).toBe(30.5)
    expect(mmToCm(304, "round1")).toBe(30.4)
  })

  it("rounds up to whole centimetres for carrier exports", () => {
    expect(mmToCm(301, "ceil")).toBe(31)
  })

  it("returns null for a missing or non-positive measurement", () => {
    expect(mmToCm(null, "round1")).toBeNull()
    expect(mmToCm(undefined, "round1")).toBeNull()
    expect(mmToCm(0, "round1")).toBeNull()
    expect(mmToCm(-5, "round1")).toBeNull()
  })
})
