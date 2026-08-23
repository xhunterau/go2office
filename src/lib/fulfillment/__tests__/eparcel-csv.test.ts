import { describe, expect, it } from "vitest"

import {
  buildEParcelCsv,
  mapChargeCode,
  tieredWeight,
  transitCover,
} from "@/lib/fulfillment/eparcel-csv"
import { UnmappableOrderError } from "@/lib/fulfillment/types"
import type { DispatchOrder } from "@/lib/queries/fulfillment"

const FALLBACKS = { email: "dispatch@example.com", phone: "+61300000000" }

function order(overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    id: 1,
    invoice_number: "INV-2001",
    shipping_method: "Eparcel_Regular",
    customer: {
      full_name: "Jane Doe",
      company_name: "Doe Supplies",
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
      chargeable_weight_kg: 2.2,
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
  return buildEParcelCsv(orders, { fallbacks: FALLBACKS })
}

function dataRows(csv: string): string[][] {
  return csv
    .split("\r\n")
    .slice(2)
    .map((line) => line.split(","))
}

describe("mapChargeCode", () => {
  it("maps go2office's two domestic contract codes", () => {
    expect(mapChargeCode("Eparcel_Regular", "INV-1")).toBe("3D55")
    expect(mapChargeCode("Eparcel_Express", "INV-1")).toBe("3J55")
  })

  // xpros defaults to 3D55, which would bill an international consignment at
  // the domestic rate and still produce a label the carrier accepts.
  it("refuses a method with no configured code, naming the invoice", () => {
    expect(() => mapChargeCode("Eparcel_Intl_Express", "INV-2001")).toThrow(
      UnmappableOrderError
    )
    expect(() => mapChargeCode("Eparcel_Intl_Express", "INV-2001")).toThrow(/INV-2001/)
  })
})

describe("tieredWeight", () => {
  it.each([
    [0, 0.25],
    [0.1, 0.25],
    [0.25, 0.25],
    [0.26, 0.5],
    [0.5, 0.5],
    [0.9, 1],
    [1, 1],
    [2.2, 3],
    [3, 3],
    [4.1, 5],
    [5, 5],
    [5.1, 6],
    [7.4, 8],
  ])("rounds %s kg up to the %s kg band", (input, expected) => {
    expect(tieredWeight(input)).toBe(expected)
  })
})

describe("transitCover", () => {
  it("is not required below $300 of goods", () => {
    expect(transitCover(299.99, 150)).toEqual({ required: "N", amount: 0 })
  })

  it("insures for cost, not for the sale price, from $300", () => {
    expect(transitCover(300, 150)).toEqual({ required: "Y", amount: 150 })
    expect(transitCover(1200, 640)).toEqual({ required: "Y", amount: 640 })
  })
})

describe("buildEParcelCsv", () => {
  it("emits both header rows, 25 columns wide", () => {
    const { csv } = build([order()])
    const lines = csv.split("\r\n")

    expect(lines).toHaveLength(3)
    expect(lines[0].split(",")[0]).toBe("C_CHARGE_CODE")
    expect(lines[1].split(",")[0]).toBe("MANDATORY")
    for (const line of lines) {
      expect(line.split(",")).toHaveLength(25)
    }
  })

  it("never writes the eBay reference code into an address column", () => {
    const { csv } = build([order()])

    expect(csv).not.toContain("ebay:")
    const [row] = dataRows(csv)
    expect(row.slice(3, 7)).toEqual(["12 Smith Street", "Unit 4", "", ""])
  })

  it("uses the invoice number as C_REF", () => {
    const [row] = dataRows(build([order()]).csv)
    expect(row[15]).toBe("INV-2001")
  })

  it("declares the chargeable weight, rounded to the billing band", () => {
    const [row] = dataRows(build([order()]).csv)
    // chargeable_weight_kg 2.2 falls in the 3kg band.
    expect(row[17]).toBe("3")
  })

  it("declares dimensions in whole centimetres, rounded up", () => {
    const [row] = dataRows(build([order()]).csv)
    expect(row.slice(18, 21)).toEqual(["31", "21", "5"])
  })

  it("sets the fixed template columns", () => {
    const [row] = dataRows(build([order()]).csv)

    expect(row[10]).toBe("AU") // country code
    expect(row[12]).toBe("Y") // email notification
    expect(row[14]).toBe("A") // signature required
    expect(row[16]).toBe("Y") // print the reference
    expect(row[23]).toBe("GIFT") // eParcel rejects SALE_OF_GOODS
    expect(row[24]).toBe("")
  })

  it("adds transit cover once the goods pass $300", () => {
    const [row] = dataRows(
      build([
        order({
          metrics: { ...order().metrics!, goods_total: 450, total_cost: 210 },
        }),
      ]).csv
    )

    expect(row[21]).toBe("Y")
    expect(row[22]).toBe("210")
  })

  it("uses the configured fallbacks when the customer has no contact details", () => {
    const [row] = dataRows(
      build([order({ customer: { ...order().customer!, email: null, phone: "" } })]).csv
    )

    expect(row[11]).toBe("dispatch@example.com")
    expect(row[13]).toBe("+61300000000")
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

    expect(truncated).toEqual(["INV-2001"])
  })

  it("refuses an order with no computed metrics", () => {
    expect(() => build([order({ metrics: null })])).toThrow(UnmappableOrderError)
  })
})
