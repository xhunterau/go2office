import { describe, expect, it } from "vitest"

import { filterFlatRateGroups, selectBestQuote } from "@/lib/shipping/quote-selection"
import type { QuoteResult, ShippingMethod } from "@/lib/shipping/types"

const CARRIER_IDS: Record<string, number> = {
  mypost: 1,
  eparcel: 2,
  aramex: 3,
  reg_letter: 4,
}

// The seeded shipping_settings.quote_tiebreak_threshold.
const TIEBREAK = 0.05

function quote(
  shippingMethod: ShippingMethod,
  carrierCode: string,
  quotedRate: number,
  error?: string
): QuoteResult {
  return {
    carrierId: CARRIER_IDS[carrierCode],
    carrierCode,
    shippingMethod,
    serviceId: null,
    zone: "Zone_1",
    quotedRate,
    computationType: "rate_card",
    ...(error ? { error } : {}),
  }
}

describe("filterFlatRateGroups", () => {
  it("keeps only the smallest fitting size in a group", () => {
    const kept = filterFlatRateGroups([
      quote("Mypost_Reg_Xs_Satchel", "mypost", 0, "does not fit"),
      quote("Mypost_Reg_S_Satchel", "mypost", 9.5),
      quote("Mypost_Reg_M_Satchel", "mypost", 11.4),
      quote("Mypost_Reg_L_Satchel", "mypost", 14.8),
    ])
    expect(kept.map((q) => q.shippingMethod)).toEqual(["Mypost_Reg_S_Satchel"])
  })

  it("keeps satchels, boxes and service levels as separate groups", () => {
    const kept = filterFlatRateGroups([
      quote("Mypost_Reg_S_Satchel", "mypost", 9.5),
      quote("Mypost_Reg_M_Satchel", "mypost", 11.4),
      quote("Mypost_Reg_S_Box", "mypost", 10.95),
      quote("Mypost_Reg_M_Box", "mypost", 13.4),
      quote("Mypost_Exp_S_Satchel", "mypost", 14.3),
      quote("Mypost_Exp_M_Satchel", "mypost", 16.2),
    ])
    expect(kept.map((q) => q.shippingMethod).sort()).toEqual([
      "Mypost_Exp_S_Satchel",
      "Mypost_Reg_S_Box",
      "Mypost_Reg_S_Satchel",
    ])
  })

  it("keeps every row of a group where nothing fits, so the errors survive", () => {
    const group = [
      quote("Mypost_Reg_S_Satchel", "mypost", 0, "does not fit"),
      quote("Mypost_Reg_M_Satchel", "mypost", 0, "does not fit"),
    ]
    expect(filterFlatRateGroups(group)).toHaveLength(2)
  })

  it("passes non-flat-rate quotes through untouched", () => {
    const quotes = [
      quote("Eparcel_Regular", "eparcel", 12.1),
      quote("Mypost_Regular", "mypost", 11.5),
      quote("Register_Letter", "reg_letter", 5),
    ]
    expect(filterFlatRateGroups(quotes)).toHaveLength(3)
  })
})

describe("selectBestQuote", () => {
  it("returns null for an empty list", () => {
    expect(selectBestQuote([], TIEBREAK)).toBeNull()
  })

  it("takes the cheapest when nothing else is close", () => {
    const selected = selectBestQuote(
      [quote("Eparcel_Regular", "eparcel", 14), quote("Mypost_Regular", "mypost", 11)],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Mypost_Regular")
  })

  it("prefers eParcel over MyPost inside the 5% band", () => {
    // 11.40 is within 5% of 11.00, so the two count as the same price.
    const selected = selectBestQuote(
      [quote("Mypost_Regular", "mypost", 11), quote("Eparcel_Regular", "eparcel", 11.4)],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Eparcel_Regular")
  })

  it("drops back to price once the gap exceeds the band", () => {
    // 11.60 is more than 5% above 11.00.
    const selected = selectBestQuote(
      [quote("Mypost_Regular", "mypost", 11), quote("Eparcel_Regular", "eparcel", 11.6)],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Mypost_Regular")
  })

  it("prefers a satchel, then a box, then own packaging within one carrier", () => {
    const selected = selectBestQuote(
      [
        quote("Mypost_Regular", "mypost", 10),
        quote("Mypost_Reg_S_Box", "mypost", 10.2),
        quote("Mypost_Reg_S_Satchel", "mypost", 10.4),
      ],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Mypost_Reg_S_Satchel")
  })

  it("ranks the registered letter last in a tie, so $5 has to win outright", () => {
    // Both inside the band of 5.00: the letter is cheapest but unranked.
    const selected = selectBestQuote(
      [quote("Register_Letter", "reg_letter", 5), quote("Eparcel_Regular", "eparcel", 5.2)],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Eparcel_Regular")
  })

  it("still selects the registered letter when it beats the field outright", () => {
    const selected = selectBestQuote(
      [quote("Register_Letter", "reg_letter", 5), quote("Eparcel_Regular", "eparcel", 9.5)],
      TIEBREAK
    )
    expect(selected?.shippingMethod).toBe("Register_Letter")
  })

  it("honours a threshold changed in shipping_settings", () => {
    const quotes = [
      quote("Mypost_Regular", "mypost", 11),
      quote("Eparcel_Regular", "eparcel", 11.6),
    ]
    expect(selectBestQuote(quotes, 0.1)?.shippingMethod).toBe("Eparcel_Regular")
    expect(selectBestQuote(quotes, 0)?.shippingMethod).toBe("Mypost_Regular")
  })

  it("does not mutate the list it is given", () => {
    const quotes = [
      quote("Eparcel_Regular", "eparcel", 14),
      quote("Mypost_Regular", "mypost", 11),
    ]
    selectBestQuote(quotes, TIEBREAK)
    expect(quotes.map((q) => q.shippingMethod)).toEqual([
      "Eparcel_Regular",
      "Mypost_Regular",
    ])
  })
})
