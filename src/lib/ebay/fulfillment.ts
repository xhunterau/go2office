import { ebayGet, ebayPost, type EbayAccount } from "@/lib/ebay/client"
import { EBAY_ORDER_ID_PATTERN } from "@/lib/ebay/order-id"
import type { EbayOrder } from "@/lib/ebay/orders"
import { PlatformRefusalError, type PushOutcome } from "@/lib/fulfillment/platform-push"
import { ebayCarrierCode, type Shipment } from "@/lib/fulfillment/platform-carriers"

// Marks an eBay order shipped, with its tracking number (Sell Fulfillment API,
// createShippingFulfillment). docs/order-dispatch.md §5.
//
// Safe to repeat: the order and its existing shipping fulfillments are read
// first. ebayPost does not retry, so a lost response is recovered by running
// the whole push again, which then finds its own fulfillment and reports
// `already`.
//
// Line items come from eBay's copy of the order, never from order_items: those
// can have been rebuilt by rebuild_order_items, and a merged go2office order
// holds lines from several eBay orders.

export type EbayShippingFulfillment = {
  fulfillmentId: string
  shipmentTrackingNumber?: string
  shippingCarrierCode?: string
  shippedDate?: string
  lineItems?: { lineItemId: string; quantity?: number }[]
}

type ShippingFulfillmentsResponse = { total?: number; fulfillments?: EbayShippingFulfillment[] }

export type EbayFulfillmentBody = {
  lineItems: { lineItemId: string; quantity: number }[]
  shippedDate: string
  shippingCarrierCode?: string
  trackingNumber?: string
}

export type EbayPlan =
  | { kind: "create"; body: EbayFulfillmentBody }
  | { kind: "done"; outcome: PushOutcome }

const sameNumber = (a: string | undefined, b: string) =>
  (a ?? "").trim().toUpperCase() === b.trim().toUpperCase()

/**
 * What to do, from eBay's current state. Pure, so the branches are tested
 * without a network.
 *
 * A changed tracking number becomes a second shipping fulfillment: eBay has no
 * call to edit one.
 */
export function planEbayFulfillment(
  order: Pick<EbayOrder, "orderId" | "orderFulfillmentStatus" | "orderPaymentStatus" | "cancelStatus" | "lineItems">,
  existing: EbayShippingFulfillment[],
  shipment: Shipment,
  shippedAt: Date
): EbayPlan {
  const cancelState = order.cancelStatus?.cancelState
  if (cancelState === "CANCELED") {
    throw new PlatformRefusalError(`eBay order ${order.orderId} was cancelled; nothing was sent.`)
  }
  if (cancelState === "IN_PROGRESS") {
    throw new PlatformRefusalError(
      `The buyer asked to cancel eBay order ${order.orderId}. Settle it in Seller Hub, then retry.`
    )
  }
  if (order.orderPaymentStatus === "FULLY_REFUNDED") {
    throw new PlatformRefusalError(`eBay order ${order.orderId} was refunded in full; nothing was sent.`)
  }

  // Before any lookup: an unconfirmed carrier code fails the same way whatever
  // eBay holds.
  const carrierCode = shipment.tracked ? ebayCarrierCode(shipment.carrier) : null

  if (shipment.tracked) {
    const match = existing.find((f) => sameNumber(f.shipmentTrackingNumber, shipment.trackingNumber))
    if (match) {
      return {
        kind: "done",
        outcome: {
          result: "already",
          fulfillmentId: match.fulfillmentId,
          message: `eBay order ${order.orderId} already has tracking number ${shipment.trackingNumber}.`,
        },
      }
    }
  } else if (order.orderFulfillmentStatus === "FULFILLED") {
    return {
      kind: "done",
      outcome: {
        result: "already",
        fulfillmentId: existing[0]?.fulfillmentId ?? null,
        message: `eBay order ${order.orderId} is already marked shipped.`,
      },
    }
  }

  if (order.lineItems.length === 0) {
    throw new PlatformRefusalError(`eBay order ${order.orderId} has no line items.`)
  }

  const body: EbayFulfillmentBody = {
    lineItems: order.lineItems.map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity })),
    shippedDate: shippedAt.toISOString(),
  }
  // Both or neither: eBay takes a tracking number only with its carrier.
  if (shipment.tracked && carrierCode) {
    body.shippingCarrierCode = carrierCode
    body.trackingNumber = shipment.trackingNumber
  }
  return { kind: "create", body }
}

/** The id at the end of the Location header eBay returns for the new fulfillment. */
export function fulfillmentIdFromLocation(location: string | null): string | null {
  if (!location) return null
  const id = location.split("?")[0].replace(/\/+$/, "").split("/").pop()
  return id ? decodeURIComponent(id) : null
}

/** Pushes one eBay order. `shippedAt` is the go2office posted_on_date. */
export async function pushEbayFulfillment(
  account: EbayAccount,
  platformOrderId: string,
  shipment: Shipment,
  shippedAt: Date
): Promise<PushOutcome> {
  if (!EBAY_ORDER_ID_PATTERN.test(platformOrderId)) {
    throw new PlatformRefusalError(`Not an eBay order number: ${platformOrderId}`)
  }
  const base = `/sell/fulfillment/v1/order/${encodeURIComponent(platformOrderId)}`

  const order = await ebayGet<EbayOrder>(account, base)
  const existing = await ebayGet<ShippingFulfillmentsResponse>(account, `${base}/shipping_fulfillment`)

  const plan = planEbayFulfillment(order, existing.fulfillments ?? [], shipment, shippedAt)
  if (plan.kind === "done") return plan.outcome

  const result = await ebayPost<unknown>(account, `${base}/shipping_fulfillment`, plan.body)
  const numberText = plan.body.trackingNumber
    ? `tracking number ${plan.body.trackingNumber}`
    : "no tracking number"

  return {
    result: "created",
    fulfillmentId: fulfillmentIdFromLocation(result.location),
    message: `eBay order ${platformOrderId} marked shipped with ${numberText}.`,
  }
}
