import { describe, expect, it } from "vitest"

import {
  defaultPickLocation,
  defaultPicks,
  defaultTrackingNumber,
  findShortages,
  invoiceScanProblem,
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

describe("defaultTrackingNumber", () => {
  const order = (
    shipping_method: Parameters<typeof defaultTrackingNumber>[0]["shipping_method"],
    tracking_number: string | null
  ) => ({ shipping_method, tracking_number, invoice_number: "2603247F" })

  it("starts a letter from its invoice number", () => {
    expect(defaultTrackingNumber(order("Letter", null))).toBe("2603247F")
    expect(defaultTrackingNumber(order("Letter", "  "))).toBe("2603247F")
  })

  it("keeps a number the order already has", () => {
    expect(defaultTrackingNumber(order("Letter", " 33GLH0035717 "))).toBe("33GLH0035717")
    expect(defaultTrackingNumber(order("Aramex_Parcel", "MS0020719756"))).toBe("MS0020719756")
  })

  it("leaves every other method empty, registered letters included", () => {
    expect(defaultTrackingNumber(order("Register_Letter", null))).toBe("")
    expect(defaultTrackingNumber(order("Parcel_Post", null))).toBe("")
    expect(defaultTrackingNumber(order(null, null))).toBe("")
  })
})

describe("invoiceScanProblem", () => {
  const letter = { shipping_method: "Letter" as const, invoice_number: "2603247F" }
  const parcel = { shipping_method: "Parcel_Post" as const, invoice_number: "2603247F" }

  it("lets a letter use its own invoice number, in any case", () => {
    expect(invoiceScanProblem("2603247F", letter, false)).toBeNull()
    expect(invoiceScanProblem("2603247f", letter, false)).toBeNull()
  })

  it("flags the order's own invoice on anything but a letter", () => {
    expect(invoiceScanProblem("2603247F", parcel, false)).toBe("this_order")
    expect(
      invoiceScanProblem("2603247F", { ...parcel, shipping_method: "Register_Letter" }, false)
    ).toBe("this_order")
  })

  it("flags another order's invoice, letters included", () => {
    expect(invoiceScanProblem("2603247B", letter, false)).toBe("other_order")
    expect(invoiceScanProblem("2603247B", parcel, false)).toBe("other_order")
  })

  it("lets the stored number through and ignores non-invoice values", () => {
    expect(invoiceScanProblem("2603247F", parcel, true)).toBeNull()
    expect(invoiceScanProblem("33GLH0035717", parcel, false)).toBeNull()
  })
})
