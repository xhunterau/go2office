import { describe, expect, it } from "vitest"

import {
  canQuote,
  quoteStrategyFor,
  shouldEscalatePostalToManual,
} from "@/lib/shipping/carrier-capabilities"
import type {
  DispatchOptionForQuote,
  OrderPackage,
  PostageConstraints,
  QuoteInput,
  ShippingMethod,
} from "@/lib/shipping/types"

// The seeded shipping_settings row.
const CONSTRAINTS: PostageConstraints = {
  auPostMaxLengthMm: 1040,
  auPostMaxWeightKg: 22,
}

function option(
  overrides: Partial<DispatchOptionForQuote> & {
    shippingMethod: ShippingMethod
    carrierCode: string
  }
): DispatchOptionForQuote {
  return {
    id: 1,
    carrierId: 1,
    billingWeightMode: "chargeable",
    serviceType: "standard",
    fixedPriceAud: null,
    maxOrderTotalAud: null,
    maxPackedThicknessMm: null,
    maxPackedLengthMm: null,
    maxPackedWidthMm: null,
    ...overrides,
  }
}

function pkg(overrides: Partial<OrderPackage> = {}): OrderPackage {
  return {
    totalWeightKg: 1,
    chargeableWeightKg: 1,
    maxDimensionMm: 300,
    packedLengthMm: 300,
    packedWidthMm: 200,
    packedHeightMm: 100,
    ...overrides,
  }
}

function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    orderId: 1,
    destinationPostcode: "3000",
    pkg: pkg(),
    orderServiceLevel: "standard",
    isPostalOnly: false,
    orderTotalAud: 50,
    ...overrides,
  }
}

describe("canQuote — service level", () => {
  it("drops standard options from an express order", () => {
    const standard = option({
      shippingMethod: "Eparcel_Regular",
      carrierCode: "eparcel",
    })
    expect(canQuote(standard, input({ orderServiceLevel: "express" }), CONSTRAINTS)).toBe(
      false
    )
  })

  it("keeps express options on an express order", () => {
    const express = option({
      shippingMethod: "Eparcel_Express",
      carrierCode: "eparcel",
    })
    expect(canQuote(express, input({ orderServiceLevel: "express" }), CONSTRAINTS)).toBe(
      true
    )
  })

  it("lets an express option compete on a standard order", () => {
    const express = option({
      shippingMethod: "Mypost_Exp_M_Satchel",
      carrierCode: "mypost",
    })
    expect(canQuote(express, input(), CONSTRAINTS)).toBe(true)
  })
})

describe("canQuote — postal-only addresses", () => {
  const postalOnly = input({ isPostalOnly: true })

  it("drops Aramex, which needs a door", () => {
    const aramex = option({
      shippingMethod: "Aramex_Parcel",
      carrierCode: "aramex",
      serviceType: null,
    })
    expect(canQuote(aramex, postalOnly, CONSTRAINTS)).toBe(false)
  })

  it("keeps Australia Post", () => {
    const eparcel = option({
      shippingMethod: "Eparcel_Regular",
      carrierCode: "eparcel",
    })
    expect(canQuote(eparcel, postalOnly, CONSTRAINTS)).toBe(true)
  })
})

describe("canQuote — weight caps", () => {
  it("caps MyPost at 5kg of chargeable weight", () => {
    const mypost = option({ shippingMethod: "Mypost_Regular", carrierCode: "mypost" })
    const under = input({ pkg: pkg({ totalWeightKg: 1, chargeableWeightKg: 5 }) })
    const over = input({ pkg: pkg({ totalWeightKg: 1, chargeableWeightKg: 5.001 }) })
    expect(canQuote(mypost, under, CONSTRAINTS)).toBe(true)
    expect(canQuote(mypost, over, CONSTRAINTS)).toBe(false)
  })

  it("caps eParcel at the Australia Post limit, judged on actual weight", () => {
    const eparcel = option({
      shippingMethod: "Eparcel_Regular",
      carrierCode: "eparcel",
    })
    // Cubed far above 22kg but physically light: the counter would take it.
    const light = input({ pkg: pkg({ totalWeightKg: 3, chargeableWeightKg: 40 }) })
    const heavy = input({ pkg: pkg({ totalWeightKg: 22.5, chargeableWeightKg: 22.5 }) })
    expect(canQuote(eparcel, light, CONSTRAINTS)).toBe(true)
    expect(canQuote(eparcel, heavy, CONSTRAINTS)).toBe(false)
  })

  it("judges a flat-rate satchel on actual weight, not the cubed figure", () => {
    const satchel = option({
      shippingMethod: "Mypost_Reg_L_Satchel",
      carrierCode: "mypost",
    })
    const bulky = input({ pkg: pkg({ totalWeightKg: 2, chargeableWeightKg: 9 }) })
    expect(canQuote(satchel, bulky, CONSTRAINTS)).toBe(true)
  })

  it("caps the registered letter at 500g", () => {
    const letter = option({
      shippingMethod: "Register_Letter",
      carrierCode: "reg_letter",
      serviceType: null,
      fixedPriceAud: 5,
    })
    expect(
      canQuote(letter, input({ pkg: pkg({ chargeableWeightKg: 0.5 }) }), CONSTRAINTS)
    ).toBe(true)
    expect(
      canQuote(letter, input({ pkg: pkg({ chargeableWeightKg: 0.6 }) }), CONSTRAINTS)
    ).toBe(false)
  })

  it("leaves Aramex uncapped — its API decides", () => {
    const aramex = option({
      shippingMethod: "Aramex_Parcel",
      carrierCode: "aramex",
      serviceType: null,
    })
    const heavy = input({ pkg: pkg({ totalWeightKg: 40, chargeableWeightKg: 40 }) })
    expect(canQuote(aramex, heavy, CONSTRAINTS)).toBe(true)
  })

  it("rejects a carrier code with no capability entry", () => {
    const unknown = option({
      shippingMethod: "Direct_Freight",
      carrierCode: "direct_freight",
    })
    expect(canQuote(unknown, input(), CONSTRAINTS)).toBe(false)
  })
})

describe("canQuote — dimension and order-total limits", () => {
  it("applies the Australia Post length limit to postal carriers", () => {
    const eparcel = option({
      shippingMethod: "Eparcel_Regular",
      carrierCode: "eparcel",
    })
    const long = input({ pkg: pkg({ maxDimensionMm: 1041 }) })
    expect(canQuote(eparcel, long, CONSTRAINTS)).toBe(false)
  })

  it("matches max_packed_* to the sorted edges, not to the column names", () => {
    // order_metrics_summary stacks along height, so packedHeightMm here is the
    // longest edge. Comparing column to column would reject a package the
    // carrier accepts.
    const letter = option({
      shippingMethod: "Register_Letter",
      carrierCode: "reg_letter",
      serviceType: null,
      fixedPriceAud: 5,
      maxPackedThicknessMm: 20,
      maxPackedLengthMm: 297,
      maxPackedWidthMm: 210,
    })
    const flat = input({
      pkg: pkg({
        chargeableWeightKg: 0.1,
        packedLengthMm: 15,
        packedWidthMm: 200,
        packedHeightMm: 290,
      }),
    })
    expect(canQuote(letter, flat, CONSTRAINTS)).toBe(true)

    const tooThick = input({
      pkg: pkg({
        chargeableWeightKg: 0.1,
        packedLengthMm: 21,
        packedWidthMm: 200,
        packedHeightMm: 290,
      }),
    })
    expect(canQuote(letter, tooThick, CONSTRAINTS)).toBe(false)
  })

  it("enforces the Aramex insurance ceiling", () => {
    const aramex = option({
      shippingMethod: "Aramex_Parcel",
      carrierCode: "aramex",
      serviceType: null,
      maxOrderTotalAud: 200,
    })
    expect(canQuote(aramex, input({ orderTotalAud: 200 }), CONSTRAINTS)).toBe(true)
    expect(canQuote(aramex, input({ orderTotalAud: 200.01 }), CONSTRAINTS)).toBe(false)
  })
})

describe("shouldEscalatePostalToManual", () => {
  it("escalates an oversized parcel", () => {
    const { escalate } = shouldEscalatePostalToManual(
      { maxDimensionMm: 1200, totalWeightKg: 2 },
      CONSTRAINTS
    )
    expect(escalate).toBe(true)
  })

  it("escalates past the Australia Post weight limit", () => {
    const { escalate } = shouldEscalatePostalToManual(
      { maxDimensionMm: 300, totalWeightKg: 23 },
      CONSTRAINTS
    )
    expect(escalate).toBe(true)
  })

  it("does not escalate between MyPost's 5kg and eParcel's ceiling", () => {
    // eParcel can still take it, so the order has to reach quoting.
    const { escalate } = shouldEscalatePostalToManual(
      { maxDimensionMm: 300, totalWeightKg: 12 },
      CONSTRAINTS
    )
    expect(escalate).toBe(false)
  })
})

describe("quoteStrategyFor", () => {
  it("routes a fixed price before anything else", () => {
    const letter = option({
      shippingMethod: "Register_Letter",
      carrierCode: "reg_letter",
      serviceType: null,
      fixedPriceAud: 5,
    })
    expect(quoteStrategyFor(letter)).toBe("fixed_price")
  })

  it("routes Aramex to the API", () => {
    expect(
      quoteStrategyFor(
        option({
          shippingMethod: "Aramex_Satchel",
          carrierCode: "aramex",
          serviceType: null,
        })
      )
    ).toBe("api")
  })

  it("routes sized MyPost methods to the flat-rate card", () => {
    expect(
      quoteStrategyFor(
        option({ shippingMethod: "Mypost_Reg_Xs_Satchel", carrierCode: "mypost" })
      )
    ).toBe("flat_rate")
  })

  it("routes Mypost_Regular to the rate card, not the flat-rate card", () => {
    expect(
      quoteStrategyFor(option({ shippingMethod: "Mypost_Regular", carrierCode: "mypost" }))
    ).toBe("rate_card")
  })
})
