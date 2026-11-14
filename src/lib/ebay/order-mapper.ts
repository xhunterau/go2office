import type { EbayAmount, EbayOrder } from "@/lib/ebay/orders"
import { isReferenceCode } from "@/lib/fulfillment/csv"
import {
  cleanText,
  toAmount,
  UnimportableOrderError,
  type MappedOrder,
} from "@/lib/order-import/import-orders"

// eBay order -> the payload public.import_platform_order('ebay', jsonb) takes.
//
// Pure, so every rule below is pinned by src/lib/ebay/__tests__/
// order-mapper.test.ts. Column by column, with the reasons, in
// docs/ebay-order-import.md.

export type EbayImportLine = {
  line_id: string
  item_number: string | null
  sku: string | null
  title: string
  quantity: number
  unit_price: number
  postage_service: string | null
}

export type EbayImportPayload = {
  platform_order_id: string
  order_ref: string
  /** Always null: none of the 178k legacy eBay orders has one. */
  web_order_id: null
  created_at: string
  paid_at: string | null
  note: string | null
  postage: number
  discount: number
  customer: {
    full_name: string | null
    email: string | null
    phone: string | null
    company_name: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }
  lines: EbayImportLine[]
}

/**
 * eBay shipping service codes -> the names the legacy data stores in
 * order_transactions.postage_service (user decision, 2026-11-14). eBay's own
 * labels for these two codes are the same names, and they are 14,517 of the
 * 14,564 eBay lines of the last two years.
 *
 * The quote engine only asks /express/i of this column (quote-engine.ts), so
 * an unmapped code is not dangerous: it is stored as it came and reported as a
 * notice so the table can be extended.
 */
export const POSTAGE_SERVICE_NAMES: Record<string, string> = {
  AU_StandardDelivery: "Standard Parcel Delivery",
  AU_ExpressDelivery: "Express Parcel Delivery",
}

export function postageServiceName(code: string | null | undefined): {
  name: string | null
  notice?: string
} {
  const trimmed = cleanText(code)
  if (!trimmed) return { name: null, notice: "No postage service on the order" }
  const name = POSTAGE_SERVICE_NAMES[trimmed]
  if (name) return { name }
  return {
    name: trimmed,
    notice: `Postage service ${trimmed} has no mapping; stored as is`,
  }
}

/**
 * The street lines, with eBay's reference code dropped (user decision,
 * 2026-11-14). It arrives in addressLine1 with the street in addressLine2;
 * shifting the street up matters because line 1 is one of the three fields a
 * customer is matched on.
 *
 * Same test as the label builders use (isReferenceCode), so what the import
 * drops and what the labels refuse to print cannot disagree.
 */
export function streetLines(address: {
  addressLine1?: string
  addressLine2?: string
}): [string | null, string | null] {
  const lines = [address.addressLine1, address.addressLine2]
    .map(cleanText)
    .filter((line): line is string => line !== null && !isReferenceCode(line))
  return [lines[0] ?? null, lines[1] ?? null]
}

/** Money as a positive amount. eBay writes discounts as negative values. */
function positive(amount: EbayAmount | undefined, field: string, name: string): number {
  return Math.abs(toAmount(amount?.value, field, name))
}

/** To the cent, so 10.00 / 3 does not land as 3.3333333. */
function cents(value: number): number {
  return Math.round(value * 100) / 100
}

/** The earliest payment, or null when eBay reports none. */
function paidAt(order: EbayOrder): string | null {
  const dates = (order.paymentSummary?.payments ?? [])
    .map((payment) => payment.paymentDate)
    .filter((date): date is string => Boolean(date))
    .sort()
  return dates[0] ?? null
}

/** What the operator calls it: the sales record number, else the order id. */
export function ebayOrderName(order: EbayOrder): string {
  return cleanText(order.salesRecordReference) ?? order.orderId
}

const UNPAID: Record<string, string> = {
  PENDING: "Payment is still pending",
  FAILED: "Payment failed",
  FULLY_REFUNDED: "Fully refunded",
}

export function mapEbayOrder(order: EbayOrder): MappedOrder<EbayImportPayload> {
  const name = ebayOrderName(order)

  // A cancellation in any state -- requested or done -- keeps the order out,
  // and is listed so nobody goes looking for it: shipping an order the buyer
  // is cancelling is the expensive mistake.
  const cancelState = order.cancelStatus?.cancelState ?? "NONE_REQUESTED"
  if (cancelState !== "NONE_REQUESTED") {
    return {
      kind: "skip",
      reason: "cancelled",
      notice:
        cancelState === "CANCELED"
          ? "Cancelled on eBay; not imported"
          : "The buyer asked to cancel; not imported. Run the import again if the request is declined",
    }
  }

  const unpaid = UNPAID[order.orderPaymentStatus]
  if (unpaid) {
    return { kind: "skip", reason: "unpaid", notice: `${unpaid}; not imported` }
  }

  // A line already marked shipped on eBay is not goods to send.
  const lines = order.lineItems.filter((line) => line.lineItemFulfillmentStatus !== "FULFILLED")
  if (lines.length === 0) return { kind: "skip", reason: "no_lines" }

  const step = order.fulfillmentStartInstructions?.[0]?.shippingStep
  const shipTo = step?.shipTo
  const address = shipTo?.contactAddress
  if (!shipTo || !address) {
    throw new UnimportableOrderError(`${name} has no shipping address`)
  }

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new UnimportableOrderError(`${name}: line ${line.lineItemId} has quantity ${line.quantity}`)
    }
  }

  const postage = postageServiceName(step?.shippingServiceCode)
  const [line1, line2] = streetLines(address)

  const pricing = order.pricingSummary
  // What the buyer paid for postage: the charge less any postage discount.
  const postageCharged = cents(
    positive(pricing?.deliveryCost, "delivery cost", name) -
      positive(pricing?.deliveryDiscount, "delivery discount", name)
  )

  return {
    kind: "import",
    notices: postage.notice ? [postage.notice] : [],
    payload: {
      platform_order_id: order.orderId,
      order_ref: name,
      web_order_id: null,
      created_at: order.creationDate,
      paid_at: paidAt(order),
      note: cleanText(order.buyerCheckoutNotes),
      postage: Math.max(0, postageCharged),
      discount: positive(pricing?.priceDiscount, "discount", name),
      customer: {
        full_name: cleanText(shipTo.fullName),
        email: cleanText(shipTo.email),
        phone: cleanText(shipTo.primaryPhone?.phoneNumber),
        company_name: cleanText(address.companyName),
        address_line1: line1,
        address_line2: line2,
        city: cleanText(address.city),
        // Rewritten from postcode + suburb by customers_standardize_address
        // anyway; kept for the addresses that lookup cannot resolve.
        state: cleanText(address.stateOrProvince),
        postcode: cleanText(address.postalCode),
        country: cleanText(address.countryCode),
      },
      lines: lines.map((line) => ({
        line_id: line.lineItemId,
        item_number: cleanText(line.legacyItemId),
        sku: cleanText(line.sku),
        title: line.title,
        quantity: line.quantity,
        // lineItemCost is the line total (EbayLineItem); the column is a unit
        // price, as in the legacy data (15.99 x 2, not 31.98).
        unit_price: cents(toAmount(line.lineItemCost.value, "line cost", name) / line.quantity),
        postage_service: postage.name,
      })),
    },
  }
}
