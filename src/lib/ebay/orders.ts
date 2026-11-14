import { ebayGet, type EbayAccount } from "@/lib/ebay/client"
import { EBAY_ORDER_ID_PATTERN } from "@/lib/ebay/order-id"

// The eBay orders the import reads (Sell Fulfillment API, getOrders), and the
// subset of their shape it uses. Field notes are from the live orders of
// 2026-11-14; see docs/ebay-order-import.md.

/** getOrders' maximum page size. */
export const ORDERS_PAGE_LIMIT = 200

export type EbayAmount = { value: string; currency?: string }

export type EbayLineItem = {
  /** -> order_transactions.transaction_id_ebay, as in the legacy data. */
  lineItemId: string
  /** The listing id -> order_transactions.item_number. */
  legacyItemId?: string
  sku?: string
  title: string
  quantity: number
  /**
   * The line total before discounts: unit price x quantity, per the API
   * reference ("calculated by multiplying the single unit price by the number
   * of units purchased"). Not the unit price.
   */
  lineItemCost: EbayAmount
  lineItemFulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED"
}

export type EbayContactAddress = {
  /**
   * On every order seen so far this is a reference code ("ebay:abc1234"), and
   * the street is in addressLine2. The mapper drops the code (user decision,
   * 2026-11-14).
   */
  addressLine1?: string
  addressLine2?: string
  city?: string
  stateOrProvince?: string
  postalCode?: string
  countryCode?: string
  companyName?: string
}

export type EbayShipTo = {
  fullName?: string
  contactAddress?: EbayContactAddress
  primaryPhone?: { phoneNumber?: string }
  /** A @members.ebay.com relay address; stored, never used to match customers. */
  email?: string
}

export type EbayOrder = {
  /** "17-15414-28640" -> order_transactions.order_id_ebay, the duplicate key. */
  orderId: string
  /** "326100" -> order_transactions.sales_record_number. */
  salesRecordReference?: string
  creationDate: string
  orderFulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED"
  orderPaymentStatus: "PAID" | "PENDING" | "FAILED" | "PARTIALLY_REFUNDED" | "FULLY_REFUNDED"
  cancelStatus?: { cancelState?: "NONE_REQUESTED" | "IN_PROGRESS" | "CANCELED" }
  buyerCheckoutNotes?: string
  pricingSummary?: {
    deliveryCost?: EbayAmount
    /** Returned only when there is one; eBay writes discounts as negative values. */
    deliveryDiscount?: EbayAmount
    priceDiscount?: EbayAmount
  }
  paymentSummary?: { payments?: { paymentDate?: string }[] }
  fulfillmentStartInstructions?: {
    shippingStep?: { shipTo?: EbayShipTo; shippingServiceCode?: string }
  }[]
  lineItems: EbayLineItem[]
}

type GetOrdersResponse = {
  total?: number
  orders?: EbayOrder[]
}

/**
 * Every order not yet shipped, oldest first; or, for a debug run, just the one
 * order asked for, shipped or not.
 *
 * With `orderIds` getOrders ignores every other filter, which is what makes a
 * shipped order fetchable for a test. Without it, getOrders only looks back 90
 * days -- more than enough for orders still waiting to be sent.
 *
 * Oldest first matters: when one customer's two orders arrive in the same run,
 * the first creates the order and the second merges into it, matching the
 * order they were placed in.
 */
export async function fetchEbayOrders(
  account: EbayAccount,
  testOrder?: string
): Promise<EbayOrder[]> {
  const orderId = testOrder?.trim()
  if (orderId) {
    if (!EBAY_ORDER_ID_PATTERN.test(orderId)) {
      throw new Error(`Not an eBay order number: ${orderId} (expected e.g. 17-15414-28640)`)
    }
    const data = await ebayGet<GetOrdersResponse>(account, "/sell/fulfillment/v1/order", {
      orderIds: orderId,
    })
    return data.orders ?? []
  }

  const orders: EbayOrder[] = []
  for (let offset = 0; ; offset += ORDERS_PAGE_LIMIT) {
    const data = await ebayGet<GetOrdersResponse>(account, "/sell/fulfillment/v1/order", {
      filter: "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}",
      limit: ORDERS_PAGE_LIMIT,
      offset,
    })
    const page = data.orders ?? []
    orders.push(...page)
    if (page.length < ORDERS_PAGE_LIMIT || orders.length >= (data.total ?? 0)) break
  }

  return orders.sort((a, b) => a.creationDate.localeCompare(b.creationDate))
}
