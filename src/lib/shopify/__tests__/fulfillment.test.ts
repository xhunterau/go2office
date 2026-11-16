import { describe, expect, it } from "vitest"

import { PlatformRefusalError } from "@/lib/fulfillment/platform-push"
import type { Shipment } from "@/lib/fulfillment/platform-carriers"
import { planShopifyFulfillment, type ShopifyFulfillmentState } from "@/lib/shopify/fulfillment"

const tracked: Shipment = { tracked: true, carrier: "australia_post", trackingNumber: "33GLH0035717" }
const letter: Shipment = { tracked: false }

function state(overrides: Partial<ShopifyFulfillmentState> = {}): ShopifyFulfillmentState {
  return {
    name: "#G2B24707",
    cancelledAt: null,
    fulfillmentOrders: {
      nodes: [{ id: "gid://shopify/FulfillmentOrder/1", status: "OPEN", supportedActions: [{ action: "CREATE_FULFILLMENT" }] }],
    },
    fulfillments: [],
    ...overrides,
  }
}

const closed = { nodes: [{ id: "gid://shopify/FulfillmentOrder/1", status: "CLOSED", supportedActions: [] }] }

describe("planShopifyFulfillment", () => {
  it("fulfils every open fulfillment order", () => {
    const s = state({
      fulfillmentOrders: {
        nodes: [
          { id: "fo1", status: "OPEN", supportedActions: [{ action: "CREATE_FULFILLMENT" }] },
          { id: "fo2", status: "IN_PROGRESS", supportedActions: [{ action: "CREATE_FULFILLMENT" }] },
          { id: "fo3", status: "CLOSED", supportedActions: [] },
        ],
      },
    })
    expect(planShopifyFulfillment(s, tracked, null)).toEqual({ kind: "create", fulfillmentOrderIds: ["fo1", "fo2"] })
  })

  it("reports a fulfillment that already has the number, so a lost response can be re-run", () => {
    const s = state({
      fulfillmentOrders: closed,
      fulfillments: [{ id: "f1", status: "SUCCESS", trackingInfo: [{ company: "Australia Post", number: "33glh0035717" }] }],
    })
    expect(planShopifyFulfillment(s, tracked, null)).toMatchObject({ kind: "done", outcome: { result: "already", fulfillmentId: "f1" } })
  })

  it("ignores a cancelled fulfillment with the same number", () => {
    const s = state({
      fulfillments: [{ id: "f1", status: "CANCELLED", trackingInfo: [{ company: null, number: "33GLH0035717" }] }],
    })
    expect(planShopifyFulfillment(s, tracked, null).kind).toBe("create")
  })

  it("updates our own fulfillment when the number changed", () => {
    const s = state({
      fulfillmentOrders: closed,
      fulfillments: [{ id: "f1", status: "SUCCESS", trackingInfo: [{ company: "Australia Post", number: "OLD" }] }],
    })
    expect(planShopifyFulfillment(s, tracked, "f1")).toEqual({ kind: "update", fulfillmentId: "f1" })
  })

  it("skips an order fulfilled elsewhere without this number", () => {
    const s = state({
      fulfillmentOrders: closed,
      fulfillments: [{ id: "f9", status: "SUCCESS", trackingInfo: [] }],
    })
    expect(planShopifyFulfillment(s, tracked, null)).toMatchObject({ kind: "done", outcome: { result: "skipped" } })
  })

  it("counts a fulfilled order as done for a letter", () => {
    const s = state({ fulfillmentOrders: closed, fulfillments: [{ id: "f9", status: "SUCCESS", trackingInfo: [] }] })
    expect(planShopifyFulfillment(s, letter, null)).toMatchObject({ kind: "done", outcome: { result: "already" } })
  })

  it("refuses a cancelled order", () => {
    expect(() => planShopifyFulfillment(state({ cancelledAt: "2026-11-15T00:00:00Z" }), tracked, null)).toThrow(PlatformRefusalError)
  })

  it("refuses an order on hold instead of calling it done", () => {
    const s = state({ fulfillmentOrders: { nodes: [{ id: "fo1", status: "ON_HOLD", supportedActions: [{ action: "RELEASE_HOLD" }] }] } })
    expect(() => planShopifyFulfillment(s, tracked, null)).toThrow(/ON_HOLD/)
  })
})
