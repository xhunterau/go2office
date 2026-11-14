import { describe, expect, it } from "vitest"

import {
  ebayOrderName,
  mapEbayOrder,
  postageServiceName,
  streetLines,
} from "@/lib/ebay/order-mapper"
import type { EbayOrder } from "@/lib/ebay/orders"
import { UnimportableOrderError } from "@/lib/order-import/import-orders"

// Shaped after 17-15414-28640, an unshipped order on 2026-11-14, with the
// personal details replaced.
function order(overrides: Partial<EbayOrder> = {}): EbayOrder {
  return {
    orderId: "17-15414-28640",
    salesRecordReference: "326100",
    creationDate: "2026-11-14T06:00:35.000Z",
    orderFulfillmentStatus: "NOT_STARTED",
    orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "NONE_REQUESTED" },
    pricingSummary: {
      deliveryCost: { value: "0.0", currency: "AUD" },
    },
    paymentSummary: {
      payments: [{ paymentDate: "2026-11-14T06:00:34.801Z" }],
    },
    fulfillmentStartInstructions: [
      {
        shippingStep: {
          shippingServiceCode: "AU_StandardDelivery",
          shipTo: {
            fullName: " Jane Citizen ",
            contactAddress: {
              addressLine1: "ebay:abc1234",
              addressLine2: "PO Box 1 ",
              city: "Warwick",
              stateOrProvince: "QLD",
              postalCode: "4370",
              countryCode: "AU",
            },
            primaryPhone: { phoneNumber: "0400000000" },
            email: "00abc@members.ebay.com",
          },
        },
      },
    ],
    lineItems: [
      {
        lineItemId: "10086367489917",
        legacyItemId: "113807446664",
        sku: " GBDL00517 ",
        title: "Sony SR920 Button Watch Battery",
        quantity: 1,
        lineItemCost: { value: "12.89", currency: "AUD" },
        lineItemFulfillmentStatus: "NOT_STARTED",
      },
    ],
    ...overrides,
  }
}

function imported(o: EbayOrder) {
  const result = mapEbayOrder(o)
  if (result.kind !== "import") throw new Error(`expected import, got skip (${result.reason})`)
  return result
}

describe("mapEbayOrder", () => {
  it("maps the live order shape", () => {
    const { payload, notices } = imported(order())
    expect(notices).toEqual([])
    expect(payload).toMatchObject({
      platform_order_id: "17-15414-28640",
      order_ref: "326100",
      web_order_id: null,
      created_at: "2026-11-14T06:00:35.000Z",
      paid_at: "2026-11-14T06:00:34.801Z",
      note: null,
      postage: 0,
      discount: 0,
    })
    expect(payload.lines).toEqual([
      {
        line_id: "10086367489917",
        item_number: "113807446664",
        sku: "GBDL00517",
        title: "Sony SR920 Button Watch Battery",
        quantity: 1,
        unit_price: 12.89,
        postage_service: "Standard Parcel Delivery",
      },
    ])
  })

  it("drops the ebay: reference code and moves the street up to line 1", () => {
    const { payload } = imported(order())
    expect(payload.customer).toMatchObject({
      full_name: "Jane Citizen",
      address_line1: "PO Box 1",
      address_line2: null,
      postcode: "4370",
      country: "AU",
    })
  })

  it("divides the line total by the quantity for the unit price", () => {
    const o = order()
    o.lineItems[0] = { ...o.lineItems[0], quantity: 2, lineItemCost: { value: "31.98" } }
    expect(imported(o).payload.lines[0]).toMatchObject({ quantity: 2, unit_price: 15.99 })
  })

  it("rounds a uneven split to the cent", () => {
    const o = order()
    o.lineItems[0] = { ...o.lineItems[0], quantity: 3, lineItemCost: { value: "10.00" } }
    expect(imported(o).payload.lines[0].unit_price).toBe(3.33)
  })

  it("stores discounts as positive amounts and nets postage discounts off postage", () => {
    const { payload } = imported(
      order({
        pricingSummary: {
          deliveryCost: { value: "9.95" },
          deliveryDiscount: { value: "-2.00" },
          priceDiscount: { value: "-1.50" },
        },
      })
    )
    expect(payload.postage).toBe(7.95)
    expect(payload.discount).toBe(1.5)
  })

  it("keeps the earliest payment date", () => {
    const { payload } = imported(
      order({
        paymentSummary: {
          payments: [{ paymentDate: "2026-11-15T00:00:00.000Z" }, { paymentDate: "2026-11-14T01:00:00.000Z" }],
        },
      })
    )
    expect(payload.paid_at).toBe("2026-11-14T01:00:00.000Z")
  })

  it("skips a cancellation request with a notice", () => {
    const result = mapEbayOrder(order({ cancelStatus: { cancelState: "IN_PROGRESS" } }))
    expect(result).toMatchObject({ kind: "skip", reason: "cancelled" })
    expect(result.kind === "skip" && result.notice).toMatch(/asked to cancel/)
  })

  it("skips an order that is not paid", () => {
    expect(mapEbayOrder(order({ orderPaymentStatus: "PENDING" }))).toMatchObject({
      kind: "skip",
      reason: "unpaid",
    })
  })

  it("imports a partially refunded order", () => {
    expect(mapEbayOrder(order({ orderPaymentStatus: "PARTIALLY_REFUNDED" })).kind).toBe("import")
  })

  it("drops lines already shipped, and skips the order when none are left", () => {
    const o = order()
    o.lineItems = [
      { ...o.lineItems[0], lineItemFulfillmentStatus: "FULFILLED" },
      { ...o.lineItems[0], lineItemId: "2", lineItemFulfillmentStatus: "NOT_STARTED" },
    ]
    expect(imported(o).payload.lines.map((l) => l.line_id)).toEqual(["2"])

    o.lineItems = [{ ...o.lineItems[0], lineItemFulfillmentStatus: "FULFILLED" }]
    expect(mapEbayOrder(o)).toMatchObject({ kind: "skip", reason: "no_lines" })
  })

  it("refuses an order with no shipping address", () => {
    expect(() => mapEbayOrder(order({ fulfillmentStartInstructions: [] }))).toThrow(
      UnimportableOrderError
    )
  })

  it("refuses a line with a non-positive quantity rather than tripping the CHECK", () => {
    const o = order()
    o.lineItems[0] = { ...o.lineItems[0], quantity: 0 }
    expect(() => mapEbayOrder(o)).toThrow(/quantity 0/)
  })

  it("refuses an amount that is not a number", () => {
    const o = order()
    o.lineItems[0] = { ...o.lineItems[0], lineItemCost: { value: "abc" } }
    expect(() => mapEbayOrder(o)).toThrow(UnimportableOrderError)
  })

  it("stores an unmapped postage service as is and reports it", () => {
    const o = order()
    o.fulfillmentStartInstructions![0].shippingStep!.shippingServiceCode = "AU_Courier"
    const { payload, notices } = imported(o)
    expect(payload.lines[0].postage_service).toBe("AU_Courier")
    expect(notices).toEqual(["Postage service AU_Courier has no mapping; stored as is"])
  })
})

describe("postageServiceName", () => {
  it("maps the two codes in use to the legacy names", () => {
    expect(postageServiceName("AU_StandardDelivery").name).toBe("Standard Parcel Delivery")
    expect(postageServiceName("AU_ExpressDelivery").name).toBe("Express Parcel Delivery")
  })

  it("keeps express detectable for the quote engine", () => {
    expect(/express/i.test(postageServiceName("AU_ExpressDelivery").name ?? "")).toBe(true)
  })
})

describe("streetLines", () => {
  it("keeps a real second line", () => {
    expect(streetLines({ addressLine1: "Unit 2", addressLine2: "10 Main St" })).toEqual([
      "Unit 2",
      "10 Main St",
    ])
  })

  it("drops the code wherever it appears", () => {
    expect(streetLines({ addressLine1: "10 Main St", addressLine2: "ebay:xyz" })).toEqual([
      "10 Main St",
      null,
    ])
  })

  it("drops blanks", () => {
    expect(streetLines({ addressLine1: " ", addressLine2: "10 Main St" })).toEqual(["10 Main St", null])
  })
})

describe("ebayOrderName", () => {
  it("falls back to the order id without a sales record number", () => {
    expect(ebayOrderName(order({ salesRecordReference: undefined }))).toBe("17-15414-28640")
  })
})
