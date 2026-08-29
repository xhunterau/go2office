import { describe, expect, it } from "vitest"

import {
  fitsFlatRatePackage,
  parseFlatRateMethod,
} from "@/lib/shipping/adapters/flat-rate.adapter"
import type { OrderPackage } from "@/lib/shipping/types"

// The seeded flat_rate_package_specs rows used below.
const SATCHEL_M = { lengthMm: 390, widthMm: 270, depthMm: null }
const SATCHEL_XS = { lengthMm: 280, widthMm: 215, depthMm: null }
const BOX_M = { lengthMm: 240, widthMm: 190, depthMm: 120 }

function pkg(length: number, width: number, height: number): OrderPackage {
  return {
    totalWeightKg: 1,
    chargeableWeightKg: 1,
    maxDimensionMm: Math.max(length, width, height),
    packedLengthMm: length,
    packedWidthMm: width,
    packedHeightMm: height,
  }
}

describe("parseFlatRateMethod", () => {
  it.each([
    ["Mypost_Reg_Xs_Satchel", "satchel", "XS"],
    ["Mypost_Exp_XL_Satchel", "satchel", "XL"],
    ["Mypost_Reg_M_Box", "box", "M"],
  ])("parses %s", (method, packageType, sizeLabel) => {
    expect(parseFlatRateMethod(method)).toEqual({ packageType, sizeLabel })
  })

  it("uppercases the size so the enum's `Xs` finds the spec's `XS`", () => {
    expect(parseFlatRateMethod("Mypost_Reg_Xs_Satchel")?.sizeLabel).toBe("XS")
  })

  it.each(["Mypost_Regular", "Eparcel_Express", "Register_Letter"])(
    "returns null for %s",
    (method) => {
      expect(parseFlatRateMethod(method)).toBeNull()
    }
  )
})

describe("fitsFlatRatePackage — satchel (2D)", () => {
  it("absorbs the item's thickness into both flat dimensions", () => {
    // 300 + 50 = 350 <= 390, 200 + 50 = 250 <= 270.
    expect(fitsFlatRatePackage("satchel", SATCHEL_M, pkg(300, 200, 50))).toBe(true)
  })

  it("rejects an item whose thickness pushes it past the length", () => {
    // 350 + 50 = 400 > 390.
    expect(fitsFlatRatePackage("satchel", SATCHEL_M, pkg(350, 200, 50))).toBe(false)
  })

  it("rejects an item whose thickness pushes it past the width", () => {
    // 250 + 50 = 300 > 270.
    expect(fitsFlatRatePackage("satchel", SATCHEL_M, pkg(300, 250, 50))).toBe(false)
  })

  it("sorts the edges first, so orientation does not decide the answer", () => {
    const sizes: [number, number, number][] = [
      [300, 200, 50],
      [50, 300, 200],
      [200, 50, 300],
    ]
    for (const [l, w, h] of sizes) {
      expect(fitsFlatRatePackage("satchel", SATCHEL_M, pkg(l, w, h))).toBe(true)
    }
  })

  it("accepts a flat item in the XS satchel, which carries no max_packed_* of its own", () => {
    // The dispatch option leaves all three limits null on purpose; the spec is
    // what decides. 250 + 10 = 260 <= 280, 150 + 10 = 160 <= 215.
    expect(fitsFlatRatePackage("satchel", SATCHEL_XS, pkg(250, 150, 10))).toBe(true)
  })
})

describe("fitsFlatRatePackage — box (3D)", () => {
  it("checks all three walls", () => {
    expect(fitsFlatRatePackage("box", BOX_M, pkg(240, 190, 120))).toBe(true)
  })

  it("rejects an item deeper than the box", () => {
    expect(fitsFlatRatePackage("box", BOX_M, pkg(200, 150, 121))).toBe(false)
  })

  it("does not add the thickness twice the way a satchel does", () => {
    // A satchel of the same face would fail this; a box holds it.
    expect(fitsFlatRatePackage("box", BOX_M, pkg(240, 180, 100))).toBe(true)
    expect(fitsFlatRatePackage("satchel", { ...BOX_M, depthMm: null }, pkg(240, 180, 100))).toBe(
      false
    )
  })

  it("treats a missing depth as no room at all", () => {
    expect(fitsFlatRatePackage("box", { ...BOX_M, depthMm: null }, pkg(100, 80, 5))).toBe(
      false
    )
  })
})
