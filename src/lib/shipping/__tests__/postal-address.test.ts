import { describe, expect, it } from "vitest"

import { isPostalOnlyAddress } from "@/lib/shipping/postal-address"

describe("isPostalOnlyAddress", () => {
  it.each([
    "PO Box 123",
    "P.O. BOX 44",
    "po box 7",
    "GPO Box 1234",
    "DPO Box 9",
    "Locked Bag 5000",
    "Private Bag 12",
    "Parcel Locker 1023 88900",
    "PMB 4 Wilcannia",
    "RMB 220 Old Road",
    "RSD 1180",
    "MS 428",
    "Box 45",
  ])("matches %s", (line) => {
    expect(isPostalOnlyAddress(line)).toBe(true)
  })

  it.each([
    "12 Box Hill Road",
    "PO Boxwood Street",
    "5 Bagot Street",
    "Unit 3, 220 Collins Street",
    "Locker Room Lane",
  ])("does not match %s", (line) => {
    expect(isPostalOnlyAddress(line)).toBe(false)
  })

  it("checks every line, not just the first", () => {
    expect(isPostalOnlyAddress("Xhunter Pty Ltd", null, "PO Box 99", null)).toBe(true)
  })

  it("ignores null, undefined and empty lines", () => {
    expect(isPostalOnlyAddress(null, undefined, "", "  ")).toBe(false)
  })

  it("is unbothered by the ebay:xxxx reference that sits in address_line3", () => {
    expect(
      isPostalOnlyAddress("12 Smith Street", null, "ebay:2841993", null)
    ).toBe(false)
  })
})
