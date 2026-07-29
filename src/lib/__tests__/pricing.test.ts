import { describe, expect, it } from "vitest"

import { charmPrice, formatMoney, formatVolume } from "@/lib/pricing"

// charmPrice mirrors public.charm_price() in SQL. These cases are the contract
// between the two implementations — CLAUDE.md rule 17 requires updating both
// sides and extending this file whenever the formula changes.
describe("charmPrice", () => {
  it("keeps the dollar amount and forces .95 cents", () => {
    expect(charmPrice(24.1)).toBe(24.95)
    expect(charmPrice(23.72)).toBe(23.95)
    expect(charmPrice(7.23)).toBe(7.95)
    expect(charmPrice(137.4)).toBe(137.95)
  })

  it("moves down when the cents are already above 95", () => {
    // The distinguishing case: 19.99 must land on 19.95, not 20.95.
    expect(charmPrice(19.99)).toBe(19.95)
    expect(charmPrice(19.96)).toBe(19.95)
  })

  it("is idempotent", () => {
    expect(charmPrice(19.95)).toBe(19.95)
    expect(charmPrice(charmPrice(24.1))).toBe(24.95)
    expect(charmPrice(charmPrice(charmPrice(0.42)))).toBe(0.95)
  })

  it("never crosses into the next dollar", () => {
    for (const cents of [0.01, 0.5, 0.94, 0.95, 0.96, 0.99]) {
      expect(Math.floor(charmPrice(19 + cents))).toBe(19)
    }
  })

  it("returns exact cents, not binary-float noise", () => {
    // 19 + 0.95 is 19.949999999999996 without the integer-cents round-trip.
    expect(charmPrice(19.2)).toBe(19.95)
    expect(charmPrice(19.2) * 100).toBe(1995)
  })

  it("leaves non-positive and non-finite input untouched", () => {
    expect(charmPrice(0)).toBe(0)
    expect(charmPrice(-0.3)).toBe(-0.3)
    expect(charmPrice(Number.NaN)).toBeNaN()
  })

  it("snaps sub-dollar costs up to 0.95", () => {
    expect(charmPrice(0.5759)).toBe(0.95)
    expect(charmPrice(0.01)).toBe(0.95)
  })
})

describe("formatVolume", () => {
  it("switches unit by magnitude so small items stay readable", () => {
    expect(formatVolume(0.352)).toBe("0.352 m³")
    expect(formatVolume(0.0048)).toBe("4.80 L")
    expect(formatVolume(0.000048)).toBe("48 cm³")
  })

  it("uses m³ from 0.1 up and cm³ below 0.001", () => {
    expect(formatVolume(0.1)).toBe("0.100 m³")
    expect(formatVolume(0.001)).toBe("1.00 L")
    expect(formatVolume(0.0009)).toBe("900 cm³")
  })

  it("renders a dash for missing volume", () => {
    expect(formatVolume(null)).toBe("—")
  })
})

describe("formatMoney", () => {
  it("renders two decimals and a dash for missing cost", () => {
    expect(formatMoney(1.5)).toBe("$1.50")
    expect(formatMoney(0)).toBe("$0.00")
    expect(formatMoney(null)).toBe("—")
  })
})
