import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { aramexFetch } from "@/lib/aramex/client"
import type {
  AramexConsignmentRequest,
  AramexConsignmentResponse,
  AramexItem,
} from "@/lib/aramex/types"
import { determineSatchelSize } from "@/lib/shipping/adapters/aramex.adapter"
import { mmToCm } from "@/lib/shipping/dimensions"
import { formatPhone, usableAddressLines } from "@/lib/fulfillment/csv"
import {
  UnmappableOrderError,
  type ContactFallbacks,
} from "@/lib/fulfillment/types"
import { LABELLED_STATUS, type DispatchOrder } from "@/lib/queries/fulfillment"

// Booking an Aramex consignment: the mapper is pure and testable, the submitter
// does the round trip and the write-back.

type Client = SupabaseClient<Database>

export function buildConsignmentItem(order: DispatchOrder): AramexItem {
  const metrics = order.metrics
  if (!metrics) {
    throw new UnmappableOrderError(
      order.invoice_number,
      "no computed weight or size is on file for this order"
    )
  }

  if (order.shipping_method === "Aramex_Satchel") {
    let satchelSize
    try {
      satchelSize = determineSatchelSize(metrics.chargeable_weight_kg)
    } catch (error) {
      throw new UnmappableOrderError(
        order.invoice_number,
        error instanceof Error ? error.message : "the satchel size cannot be determined"
      )
    }

    return {
      Quantity: 1,
      PackageType: "S",
      SatchelSize: satchelSize,
      Reference: order.invoice_number,
    }
  }

  // dominant_*, not packed_*. The quote adapter deliberately uses the
  // pessimistic packing estimate so a price errs high; a booking should declare
  // what is actually going in the carton, which is the dominant item's own size.
  // xpros splits it the same way.
  return {
    Quantity: 1,
    PackageType: "P",
    Reference: order.invoice_number,
    WeightDead: metrics.total_weight_kg,
    Length: mmToCm(metrics.dominant_length_mm, "round1") ?? undefined,
    Width: mmToCm(metrics.dominant_width_mm, "round1") ?? undefined,
    Height: mmToCm(metrics.dominant_height_mm, "round1") ?? undefined,
  }
}

export function mapOrderToConsignment(
  order: DispatchOrder,
  fallbacks: ContactFallbacks
): AramexConsignmentRequest {
  const customer = order.customer
  if (!customer) {
    throw new UnmappableOrderError(order.invoice_number, "the order has no customer")
  }
  if (!customer.full_name) {
    throw new UnmappableOrderError(order.invoice_number, "the customer has no name")
  }

  // Aramex rejects an incomplete address with a 400 whose body names no order,
  // so the batch would report a failure it cannot attribute. Checking here
  // means the invoice number is in the message.
  const missing = (
    [
      ["street address", customer.address_line1],
      ["suburb", customer.city],
      ["state", customer.state],
      ["postcode", customer.postcode],
    ] as const
  )
    .filter(([, value]) => value == null || value.trim() === "")
    .map(([label]) => label)

  if (missing.length > 0) {
    throw new UnmappableOrderError(
      order.invoice_number,
      `the customer address is missing its ${missing.join(", ")}`
    )
  }

  // The same reference-code filter the CSV and PDF paths use: address_line3
  // holds an `ebay:...` code on 114,161 customer rows, and xpros concatenates
  // lines 2 to 4 into AdditionalDetails without looking.
  const [, ...extraLines] = usableAddressLines(customer)

  return {
    To: {
      ContactName: customer.full_name,
      BusinessName: customer.company_name ?? undefined,
      PhoneNumber: formatPhone(customer.phone, customer.country, fallbacks.phone),
      Email: customer.email?.trim() || fallbacks.email,
      Address: {
        StreetAddress: customer.address_line1 as string,
        AdditionalDetails: extraLines.join(" ") || undefined,
        Locality: customer.city as string,
        StateOrProvince: customer.state as string,
        PostalCode: customer.postcode as string,
        Country: "AU",
      },
    },
    Items: [buildConsignmentItem(order)],
    ExternalRef1: order.invoice_number,
  }
}

export type ConsignmentResult = {
  orderId: number
  invoiceNumber: string
  consignmentId: number
}

/**
 * Books one order with Aramex, then records the outcome.
 *
 * The write-back is the part xpros does not do: it takes the consignmentId,
 * flips the status and throws the id away, so afterwards nothing connects the
 * order to the consignment. Storing it in orders.tracking_number is safe past
 * the normalize_tracking_number trigger (CLAUDE.md rule 20) -- the only numeric
 * branch is MyPost's, which requires a value both starting `99` and longer than
 * 23 characters, and a consignment id is a bigint.
 */
export async function submitConsignment(
  supabase: Client,
  order: DispatchOrder,
  fallbacks: ContactFallbacks,
  userId: string | null
): Promise<ConsignmentResult> {
  const payload = mapOrderToConsignment(order, fallbacks)

  const response = await aramexFetch<AramexConsignmentResponse>("/api/consignments", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  const consignmentId = response.data.consignmentId

  // Aramex has already accepted the booking at this point, so a failed write
  // here must be loud: the parcel is committed and the only record of it is in
  // the error. Retrying the task would book a second consignment.
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      status: LABELLED_STATUS,
      tracking_number: String(consignmentId),
    })
    .eq("id", order.id)
    .select("id")
    .maybeSingle()

  if (error) {
    throw new Error(
      `Aramex booked consignment ${consignmentId} for ${order.invoice_number}, ` +
        `but the order could not be updated: ${error.message}`
    )
  }
  if (!updated) {
    throw new Error(
      `Aramex booked consignment ${consignmentId} for ${order.invoice_number}, ` +
        `but the order row could not be written to. Record the consignment manually.`
    )
  }

  await supabase.from("order_logs").insert({
    order_id: order.id,
    action: `Aramex consignment ${consignmentId} created`,
    user_id: userId,
  })

  return {
    orderId: order.id,
    invoiceNumber: order.invoice_number,
    consignmentId,
  }
}
