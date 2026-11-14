import { describe, expect, it } from "vitest"

import {
  orderNumberCandidates,
  platformOrderNumbers,
} from "@/lib/orders/platform-order-number"

describe("platformOrderNumbers", () => {
  it("lists each number once, in line order", () => {
    // Order 206017: two Shopify orders merged into one.
    expect(
      platformOrderNumbers([
        { sales_record_number: "#G2B24766" },
        { sales_record_number: "#G2B24767" },
        { sales_record_number: "#G2B24766" },
      ])
    ).toEqual(["#G2B24766", "#G2B24767"])
  })

  it("drops blanks and nulls, which 1,357 migrated lines hold", () => {
    expect(
      platformOrderNumbers([
        { sales_record_number: "" },
        { sales_record_number: null },
        { sales_record_number: " 324563 " },
      ])
    ).toEqual(["324563"])
  })
})

describe("orderNumberCandidates", () => {
  it("matches a Shopify name typed with or without #, in any case", () => {
    expect(orderNumberCandidates("G2B24769")).toEqual(["G2B24769", "#G2B24769"])
    expect(orderNumberCandidates("#G2B24769")).toEqual(["G2B24769", "#G2B24769"])
    expect(orderNumberCandidates(" g2b24769 ")).toEqual(["G2B24769", "#G2B24769"])
  })

  it("keeps an eBay record number as typed", () => {
    expect(orderNumberCandidates("324563")).toContain("324563")
  })

  it("returns nothing for a blank term", () => {
    expect(orderNumberCandidates("  #  ")).toEqual([])
  })
})
