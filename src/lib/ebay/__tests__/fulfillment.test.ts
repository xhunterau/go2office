import { describe, expect, it } from "vitest"

import { fulfillmentIdFromLocation, planEbayFulfillment } from "@/lib/ebay/fulfillment"
import type { EbayLineItem } from "@/lib/ebay/orders"
import { PlatformRefusalError } from "@/lib/fulfillment/platform-push"
import { UnmappableShipmentError, type Shipment } from "@/lib/fulfillment/platform-carriers"

const tracked: Shipment = { tracked: true, carrier: "australia_post", trackingNumber: "99721681914001000830906" }
const letter: Shipment = { tracked: false }
const shippedAt = new Date("2026-11-16T03:04:05.678Z")

const line = (lineItemId: string, quantity: number): EbayLineItem => ({
  lineItemId,
  title: "Item",
  quantity,
  lineItemCost: { value: "10.00" },
  lineItemFulfillmentStatus: "NOT_STARTED",
})

type PlanOrder = Parameters<typeof planEbayFulfillment>[0]

function order(overrides: Partial<PlanOrder> = {}): PlanOrder {
  return {
    orderId: "17-15414-28640",
    orderFulfillmentStatus: "NOT_STARTED",
    orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "NONE_REQUESTED" },
    lineItems: [line("10082056971425", 1), line("10082056971426", 3)],
    ...overrides,
  }
}

describe("planEbayFulfillment", () => {
  it("ships every eBay line item with the number and carrier", () => {
    expect(planEbayFulfillment(order(), [], tracked, shippedAt)).toEqual({
      kind: "create",
      body: {
        lineItems: [
          { lineItemId: "10082056971425", quantity: 1 },
          { lineItemId: "10082056971426", quantity: 3 },
        ],
        shippedDate: "2026-11-16T03:04:05.678Z",
        shippingCarrierCode: "AustraliaPost",
        trackingNumber: "99721681914001000830906",
      },
    })
  })

  it("sends a letter with neither number nor carrier", () => {
    const plan = planEbayFulfillment(order(), [], letter, shippedAt)
    expect(plan.kind === "create" && plan.body).not.toHaveProperty("trackingNumber")
    expect(plan.kind === "create" && plan.body).not.toHaveProperty("shippingCarrierCode")
  })

  it("finds its own earlier fulfillment, so a lost response can be re-run", () => {
    const existing = [{ fulfillmentId: "F1", shipmentTrackingNumber: "99721681914001000830906" }]
    expect(planEbayFulfillment(order({ orderFulfillmentStatus: "FULFILLED" }), existing, tracked, shippedAt)).toMatchObject({
      kind: "done",
      outcome: { result: "already", fulfillmentId: "F1" },
    })
  })

  it("adds a new fulfillment when the number changed", () => {
    const existing = [{ fulfillmentId: "F1", shipmentTrackingNumber: "OLD" }]
    expect(planEbayFulfillment(order({ orderFulfillmentStatus: "FULFILLED" }), existing, tracked, shippedAt).kind).toBe("create")
  })

  it("counts an order already marked shipped as done for a letter", () => {
    // What Laravel leaves behind: fulfillmentId "999", no number.
    const existing = [{ fulfillmentId: "999" }]
    expect(planEbayFulfillment(order({ orderFulfillmentStatus: "FULFILLED" }), existing, letter, shippedAt)).toMatchObject({
      kind: "done",
      outcome: { result: "already" },
    })
  })

  it.each([
    [{ cancelStatus: { cancelState: "CANCELED" as const } }, /cancelled/],
    [{ cancelStatus: { cancelState: "IN_PROGRESS" as const } }, /asked to cancel/],
    [{ orderPaymentStatus: "FULLY_REFUNDED" as const }, /refunded/],
  ])("refuses %o", (overrides, message) => {
    expect(() => planEbayFulfillment(order(overrides), [], tracked, shippedAt)).toThrow(PlatformRefusalError)
    expect(() => planEbayFulfillment(order(overrides), [], tracked, shippedAt)).toThrow(message)
  })

  it("refuses Aramex until its eBay code is confirmed", () => {
    const aramex: Shipment = { tracked: true, carrier: "aramex", trackingNumber: "MS0020719756" }
    expect(() => planEbayFulfillment(order(), [], aramex, shippedAt)).toThrow(UnmappableShipmentError)
  })
})

describe("fulfillmentIdFromLocation", () => {
  it("takes the last path segment", () => {
    expect(
      fulfillmentIdFromLocation("https://api.ebay.com/sell/fulfillment/v1/order/17-15414-28640/shipping_fulfillment/9405509699937003457459")
    ).toBe("9405509699937003457459")
  })

  it("is null without a header", () => {
    expect(fulfillmentIdFromLocation(null)).toBeNull()
  })
})
