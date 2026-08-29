import { describe, expect, it } from "vitest"

import {
  buildMyPostCsv,
  mapDeliveryService,
  mapPackagingType,
} from "@/lib/fulfillment/mypost-csv"
import { MYPOST_METHODS } from "@/lib/fulfillment/carrier-groups"
import { UnmappableOrderError } from "@/lib/fulfillment/types"
import type { ShippingMethod } from "@/lib/orders/shipping-method"
import type { DispatchOrder } from "@/lib/queries/fulfillment"

const SENDER = {
  name: "Go2buy Australia",
  addressLine1: "Parcel Locker 10147 39821",
  addressLine2: "1-7 Venture Way",
  suburb: "Braeside",
  state: "VIC",
  postcode: "3195",
}

const FALLBACKS = { email: "dispatch@example.com", phone: "+61300000000" }

function order(overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    id: 1,
    invoice_number: "INV-1001",
    shipping_method: "Mypost_Regular",
    customer: {
      full_name: "Jane Doe",
      company_name: null,
      address_line1: "12 Smith Street",
      address_line2: "Unit 4",
      address_line3: "ebay:1234567890",
      address_line4: null,
      city: "Cardwell",
      state: "QLD",
      postcode: "4849",
      country: "AU",
      email: "jane@example.com",
      phone: "0431950696",
    },
    metrics: {
      total_weight_kg: 1.4,
      chargeable_weight_kg: 1.4,
      goods_total: 120,
      total_cost: 60,
      dominant_length_mm: 305,
      dominant_width_mm: 210,
      dominant_height_mm: 45,
    },
    ...overrides,
  }
}

function build(orders: DispatchOrder[]) {
  return buildMyPostCsv(orders, { sender: SENDER, fallbacks: FALLBACKS })
}

function dataRows(csv: string): string[][] {
  return csv
    .split("\r\n")
    .slice(1)
    .map((line) => line.split(","))
}

describe("mapPackagingType", () => {
  it("maps Australia Post's own packaging to its code", () => {
    expect(mapPackagingType("Mypost_Reg_M_Box", "INV-1")).toBe("AP_BOX_M")
    expect(mapPackagingType("Mypost_Exp_L_Satchel", "INV-1")).toBe("AP_SATCHEL_L")
  })

  it("maps the two self-packed methods to OWN_PACKAGING", () => {
    expect(mapPackagingType("Mypost_Regular", "INV-1")).toBe("OWN_PACKAGING")
    expect(mapPackagingType("Mypost_Express", "INV-1")).toBe("OWN_PACKAGING")
  })

  // The map covers every method in MYPOST_METHODS, so this exercises the guard
  // with a method from another channel. xpros returns OWN_PACKAGING for anything
  // it has no key for, which books an Australia Post box as a self-packed parcel
  // and prices it accordingly, with nothing to show for it.
  it("refuses a method it has no code for rather than defaulting", () => {
    expect(() => mapPackagingType("Letter", "INV-1001")).toThrow(UnmappableOrderError)
    expect(() => mapPackagingType("Letter", "INV-1001")).toThrow(/INV-1001/)
  })
})

describe("mapDeliveryService", () => {
  it.each([
    ["Mypost_Regular", "PP"],
    ["Mypost_Reg_M_Box", "PP"],
    ["Mypost_Reg_L_Satchel", "PP"],
    ["Mypost_Express", "EXP"],
    ["Mypost_Exp_M_Box", "EXP"],
    ["Mypost_Exp_L_Satchel", "EXP"],
  ] as [ShippingMethod, string][])("maps %s to %s", (method, expected) => {
    expect(mapDeliveryService(method)).toBe(expected)
  })

  it("classifies every MyPost method as one or the other", () => {
    for (const method of MYPOST_METHODS) {
      expect(["PP", "EXP"]).toContain(mapDeliveryService(method))
    }
  })
})

describe("buildMyPostCsv", () => {
  it("emits a header row of 23 columns and CRLF line endings", () => {
    const { csv } = build([order()])
    const lines = csv.split("\r\n")

    expect(lines).toHaveLength(2)
    expect(lines[0].split(",")).toHaveLength(23)
    expect(lines[1].split(",")).toHaveLength(23)
  })

  it("writes the sender block into the Send From columns", () => {
    const [row] = dataRows(build([order()]).csv)

    expect(row.slice(1, 7)).toEqual([
      "Go2buy Australia",
      "Parcel Locker 10147 39821",
      "1-7 Venture Way",
      "Braeside",
      "VIC",
      "3195",
    ])
  })

  it("uses the invoice number as the label reference", () => {
    const [row] = dataRows(build([order()]).csv)
    expect(row[0]).toBe("INV-1001")
  })

  // The single most important behaviour in this module.
  it("never writes the eBay reference code into an address column", () => {
    const { csv } = build([order()])

    expect(csv).not.toContain("ebay:")
    const [row] = dataRows(csv)
    expect(row.slice(9, 12)).toEqual(["12 Smith Street", "Unit 4", ""])
  })

  it("sends real dimensions for self-packed parcels", () => {
    const [row] = dataRows(build([order({ shipping_method: "Mypost_Regular" })]).csv)
    // 305mm, 210mm, 45mm rounded up to whole centimetres.
    expect(row.slice(19, 22)).toEqual(["31", "21", "5"])
  })

  it("sends filler dimensions for Australia Post packaging", () => {
    const [row] = dataRows(build([order({ shipping_method: "Mypost_Reg_M_Box" })]).csv)
    expect(row.slice(19, 22)).toEqual(["12", "12", "12"])
  })

  it("falls back to filler when a dimension is unrecorded", () => {
    const [row] = dataRows(
      build([
        order({
          metrics: { ...order().metrics!, dominant_width_mm: null },
        }),
      ]).csv
    )
    expect(row[20]).toBe("12")
  })

  it("floors the weight at 100g, which is the least Australia Post accepts", () => {
    const [row] = dataRows(
      build([order({ metrics: { ...order().metrics!, total_weight_kg: 0 } })]).csv
    )
    expect(row[22]).toBe("0.1")
  })

  it("uses the configured fallbacks when the customer has no contact details", () => {
    const [row] = dataRows(
      build([
        order({
          customer: { ...order().customer!, email: null, phone: null },
        }),
      ]).csv
    )

    expect(row[15]).toBe("dispatch@example.com")
    expect(row[16]).toBe("+61300000000")
  })

  it("normalises the customer's phone to E.164", () => {
    const [row] = dataRows(build([order()]).csv)
    expect(row[16]).toBe("+61431950696")
  })

  it("reports an order whose address had to be truncated", () => {
    const long = "123 Extraordinarily Long Boulevard Northeast Extension Annexe"
    const { truncated } = build([
      order({
        customer: {
          ...order().customer!,
          address_line1: long,
          address_line2: "Building C",
          address_line3: "Level 9",
          address_line4: "Door 4",
        },
      }),
    ])

    expect(truncated).toEqual(["INV-1001"])
  })

  it("refuses an order with no computed metrics", () => {
    expect(() => build([order({ metrics: null })])).toThrow(UnmappableOrderError)
  })

  it("refuses an order with no shipping method", () => {
    expect(() => build([order({ shipping_method: null })])).toThrow(
      UnmappableOrderError
    )
  })

  it("renders one data row per order", () => {
    const { csv } = build([
      order({ id: 1, invoice_number: "INV-1" }),
      order({ id: 2, invoice_number: "INV-2" }),
    ])
    expect(dataRows(csv)).toHaveLength(2)
  })
})
