import { describe, expect, it } from "vitest"

import {
  defaultPickLocation,
  defaultPicks,
  findShortages,
  needsLocationChoice,
  toDispatchPicks,
  type DispatchLine,
  type StockSlot,
} from "@/lib/fulfillment/dispatch"

const slot = (location_id: number, qty: number): StockSlot => ({
  location_id,
  location_name: `L${location_id}`,
  qty,
})

describe("defaultPickLocation", () => {
  it("picks the only location when it covers the quantity", () => {
    expect(defaultPickLocation(2, [slot(23, 378)])).toBe(23)
  })

  it("picks the location with the most stock", () => {
    expect(defaultPickLocation(1, [slot(1, 3), slot(2, 9)])).toBe(2)
  })

  it("returns null when no single location covers it", () => {
    expect(defaultPickLocation(5, [slot(1, 3), slot(2, 4)])).toBeNull()
  })

  it("returns null when the product has no stock at all", () => {
    expect(defaultPickLocation(1, [])).toBeNull()
  })
})

describe("defaultPicks", () => {
  it("counts two lines of one product together", () => {
    const lines: DispatchLine[] = [
      { id: 10, product_id: 7, quantity: 2 },
      { id: 11, product_id: 7, quantity: 2 },
    ]
    // 3 covers either line alone but not both, so neither is pre-selected.
    const stock = new Map([[7, [slot(1, 3)]]])
    expect(defaultPicks(lines, stock)).toEqual(new Map([[10, null], [11, null]]))
  })

  it("leaves unresolved lines without a pick", () => {
    const lines: DispatchLine[] = [{ id: 10, product_id: null, quantity: 1 }]
    expect(defaultPicks(lines, new Map()).get(10)).toBeNull()
  })
})

describe("findShortages", () => {
  const stock = new Map([
    [7, [slot(1, 3), slot(2, 1)]],
    [8, [slot(1, 5)]],
  ])

  it("sums lines that take from the same shelf", () => {
    const lines: DispatchLine[] = [
      { id: 10, product_id: 7, quantity: 2 },
      { id: 11, product_id: 7, quantity: 2 },
    ]
    const picks = new Map([[10, 1], [11, 1]])
    expect(findShortages(lines, picks, stock)).toEqual([
      { product_id: 7, location_id: 1, needed: 4, available: 3 },
    ])
  })

  it("is empty once the lines are split across shelves that cover them", () => {
    const lines: DispatchLine[] = [
      { id: 10, product_id: 7, quantity: 3 },
      { id: 11, product_id: 7, quantity: 1 },
    ]
    expect(findShortages(lines, new Map([[10, 1], [11, 2]]), stock)).toEqual([])
  })

  it("treats a location with no stock row as zero", () => {
    const lines: DispatchLine[] = [{ id: 12, product_id: 8, quantity: 1 }]
    expect(findShortages(lines, new Map([[12, 9]]), stock)).toEqual([
      { product_id: 8, location_id: 9, needed: 1, available: 0 },
    ])
  })
})

describe("needsLocationChoice", () => {
  it("shows a plain label for a single covering location", () => {
    expect(needsLocationChoice([slot(1, 5)], 1)).toBe(false)
  })

  it("asks when there is more than one location", () => {
    expect(needsLocationChoice([slot(1, 5), slot(2, 1)], 1)).toBe(true)
  })

  it("asks when nothing could be pre-selected", () => {
    expect(needsLocationChoice([slot(1, 0)], null)).toBe(true)
  })
})

describe("toDispatchPicks", () => {
  const lines: DispatchLine[] = [
    { id: 10, product_id: 7, quantity: 1 },
    { id: 11, product_id: 8, quantity: 1 },
  ]

  it("lists every line", () => {
    expect(toDispatchPicks(lines, new Map([[10, 1], [11, 2]]))).toEqual([
      { order_item_id: 10, location_id: 1 },
      { order_item_id: 11, location_id: 2 },
    ])
  })

  it("is null while a line has no location", () => {
    expect(toDispatchPicks(lines, new Map([[10, 1], [11, null]]))).toBeNull()
  })
})
