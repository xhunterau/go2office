import { shopifyMutation, shopifyQuery } from "@/lib/shopify/client"
import { PlatformRefusalError, type PushOutcome } from "@/lib/fulfillment/platform-push"
import { SHOPIFY_TRACKING_COMPANY, type Shipment } from "@/lib/fulfillment/platform-carriers"

// Marks a Shopify order fulfilled, with its tracking number (docs/order-dispatch.md
// §5). Admin GraphQL 2026-10; field names and the tracking company list were
// checked against the docs on 2026-11-16.
//
// Safe to repeat: the order's current fulfillments are read first, and a
// fulfillment already carrying this number is reported as `already`. That is
// what lets a run whose response was lost (shopifyMutation does not retry
// transport failures) simply run again.
//
// notifyCustomer is always false: the dispatch email will be sent by
// go2office, not Shopify (user decision, 2026-11-16).

const ORDER_QUERY = `
  query FulfillmentState($id: ID!) {
    order(id: $id) {
      name
      cancelledAt
      fulfillmentOrders(first: 20) {
        nodes { id status supportedActions { action } }
      }
      fulfillments(first: 20) {
        id
        status
        trackingInfo { company number }
      }
    }
  }
`

const CREATE_MUTATION = `
  mutation Fulfil($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`

const UPDATE_TRACKING_MUTATION = `
  mutation UpdateTracking($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: false
    ) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`

export type ShopifyFulfillmentState = {
  name: string
  cancelledAt: string | null
  fulfillmentOrders: {
    nodes: { id: string; status: string; supportedActions: { action: string }[] }[]
  }
  fulfillments: {
    id: string
    status: string
    trackingInfo: { company: string | null; number: string | null }[]
  }[]
}

type UserError = { field: string[] | null; message: string }

/** Fulfillment orders still waiting for something before they can be fulfilled. */
const WAITING_STATUSES = new Set(["OPEN", "IN_PROGRESS", "ON_HOLD", "SCHEDULED", "INCOMPLETE"])

export type ShopifyPlan =
  | { kind: "create"; fulfillmentOrderIds: string[] }
  | { kind: "update"; fulfillmentId: string }
  | { kind: "done"; outcome: PushOutcome }

const sameNumber = (a: string | null | undefined, b: string) =>
  (a ?? "").trim().toUpperCase() === b.trim().toUpperCase()

/**
 * What to do, from the order's current state. Pure, so the branches are tested
 * without a network.
 *
 * `ourFulfillmentId` is the fulfillment an earlier push of ours created: when
 * the tracking number has changed since, it is updated rather than a second
 * fulfillment created (there is nothing left to fulfil anyway).
 */
export function planShopifyFulfillment(
  state: ShopifyFulfillmentState,
  shipment: Shipment,
  ourFulfillmentId: string | null
): ShopifyPlan {
  if (state.cancelledAt) {
    throw new PlatformRefusalError(`${state.name} was cancelled on Shopify; nothing was sent.`)
  }

  const live = state.fulfillments.filter((f) => f.status !== "CANCELLED" && f.status !== "ERROR" && f.status !== "FAILURE")

  if (shipment.tracked) {
    const match = live.find((f) => f.trackingInfo.some((t) => sameNumber(t.number, shipment.trackingNumber)))
    if (match) {
      return {
        kind: "done",
        outcome: { result: "already", fulfillmentId: match.id, message: `Shopify ${state.name} already has tracking number ${shipment.trackingNumber}.` },
      }
    }
    if (ourFulfillmentId && live.some((f) => f.id === ourFulfillmentId)) {
      return { kind: "update", fulfillmentId: ourFulfillmentId }
    }
  }

  const fulfillable = state.fulfillmentOrders.nodes.filter((fo) =>
    fo.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT")
  )
  if (fulfillable.length > 0) {
    return { kind: "create", fulfillmentOrderIds: fulfillable.map((fo) => fo.id) }
  }

  const waiting = state.fulfillmentOrders.nodes.filter((fo) => WAITING_STATUSES.has(fo.status))
  if (waiting.length > 0) {
    throw new PlatformRefusalError(
      `${state.name} cannot be fulfilled on Shopify right now (${[...new Set(waiting.map((fo) => fo.status))].join(", ")}). Release it in Shopify admin, then retry.`
    )
  }

  // Nothing left to fulfil: done by hand in Shopify admin, or by an earlier run
  // of ours whose response was lost (for a letter there is no number to tell
  // the two apart, and either way the buyer sees it shipped).
  if (!shipment.tracked) {
    return {
      kind: "done",
      outcome: { result: "already", fulfillmentId: live[0]?.id ?? null, message: `Shopify ${state.name} is already fulfilled.` },
    }
  }
  const otherNumbers = live.flatMap((f) => f.trackingInfo.map((t) => t.number).filter(Boolean))
  return {
    kind: "done",
    outcome: {
      result: "skipped",
      fulfillmentId: null,
      message: `Shopify ${state.name} was already fulfilled ${
        otherNumbers.length > 0 ? `with ${otherNumbers.join(", ")}` : "with no tracking number"
      }; ${shipment.trackingNumber} was not added.`,
    },
  }
}

function trackingInput(shipment: Shipment) {
  // A company from Shopify's list makes Shopify build the tracking URL itself.
  return shipment.tracked
    ? { company: SHOPIFY_TRACKING_COMPANY[shipment.carrier], number: shipment.trackingNumber }
    : undefined
}

function throwOnUserErrors(name: string, errors: UserError[]) {
  if (errors.length > 0) {
    throw new PlatformRefusalError(
      `Shopify refused ${name}: ${errors.map((e) => e.message).join("; ")}`
    )
  }
}

/** Pushes one Shopify order. `platformOrderId` is its legacyResourceId (order_transactions.order_id_ebay). */
export async function pushShopifyFulfillment(
  platformOrderId: string,
  shipment: Shipment,
  ourFulfillmentId: string | null
): Promise<PushOutcome> {
  if (!/^\d+$/.test(platformOrderId)) {
    throw new PlatformRefusalError(`Not a Shopify order id: ${platformOrderId}`)
  }

  const data = await shopifyQuery<{ order: ShopifyFulfillmentState | null }>(ORDER_QUERY, {
    id: `gid://shopify/Order/${platformOrderId}`,
  })
  if (!data.order) {
    // Apps without read_all_orders only see the last 60 days of orders.
    throw new PlatformRefusalError(
      `Shopify order ${platformOrderId} was not found (the app can only see orders from the last 60 days).`
    )
  }
  const state = data.order
  const plan = planShopifyFulfillment(state, shipment, ourFulfillmentId)
  if (plan.kind === "done") return plan.outcome

  const numberText = shipment.tracked ? `tracking number ${shipment.trackingNumber}` : "no tracking number"

  if (plan.kind === "update") {
    const result = await shopifyMutation<{
      fulfillmentTrackingInfoUpdate: { fulfillment: { id: string } | null; userErrors: UserError[] }
    }>(UPDATE_TRACKING_MUTATION, { fulfillmentId: plan.fulfillmentId, trackingInfoInput: trackingInput(shipment) })
    throwOnUserErrors(state.name, result.fulfillmentTrackingInfoUpdate.userErrors)
    return {
      result: "updated",
      fulfillmentId: plan.fulfillmentId,
      message: `Shopify ${state.name} tracking changed to ${numberText}.`,
    }
  }

  const result = await shopifyMutation<{
    fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: UserError[] }
  }>(CREATE_MUTATION, {
    fulfillment: {
      // No line items listed: each fulfillment order is fulfilled in full.
      lineItemsByFulfillmentOrder: plan.fulfillmentOrderIds.map((fulfillmentOrderId) => ({ fulfillmentOrderId })),
      notifyCustomer: false,
      trackingInfo: trackingInput(shipment),
    },
  })
  throwOnUserErrors(state.name, result.fulfillmentCreate.userErrors)

  return {
    result: "created",
    fulfillmentId: result.fulfillmentCreate.fulfillment?.id ?? null,
    message: `Shopify ${state.name} fulfilled with ${numberText}.`,
  }
}
