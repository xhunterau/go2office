import { mmToCm } from "@/lib/shipping/dimensions"
import type { ShippingMethod } from "@/lib/orders/shipping-method"
import type { DispatchOrder } from "@/lib/queries/fulfillment"
import {
  cleanCommas,
  fitAddressLines,
  formatPhone,
  toCsv,
  usableAddressLines,
} from "@/lib/fulfillment/csv"
import {
  UnmappableOrderError,
  type ContactFallbacks,
  type SenderBlock,
} from "@/lib/fulfillment/types"

// The 23-column MyPost Business bulk upload. Column order is the portal's and
// must not be rearranged -- the importer matches by position, not by header.

const HEADERS = [
  "Additional Label Information 1",
  "Send From Name",
  "Send From Address Line 1",
  "Send From Address Line 2",
  "Send From Suburb",
  "Send From State",
  "Send From Postcode",
  "Deliver To Name",
  "Deliver To Business Name",
  "Deliver To Address Line 1",
  "Deliver To Address Line 2",
  "Deliver To Address Line 3",
  "Deliver To Suburb",
  "Deliver To State",
  "Deliver To Postcode",
  "Deliver To Email Address",
  "Deliver To Phone Number",
  "Item Packaging Type",
  "Item Delivery Service",
  "Item Length",
  "Item Width",
  "Item Height",
  "Item Weight",
] as const

/** Deliver To has three address columns, each capped at 40 characters. */
const ADDRESS_SLOTS = 3
const ADDRESS_MAX = 40

/**
 * Australia Post's packaging codes.
 *
 * No `?? 'OWN_PACKAGING'` default, unlike xpros. go2office's enum carries
 * Mypost_Reg_Xs_Box and Mypost_Exp_Xs_Box, which xpros' map has no key for; a
 * default would book those as self-packed parcels and price them accordingly,
 * with nothing to show it happened. They are absent here because the portal's
 * code for an XS box has not been confirmed, and both have 0 orders. The first
 * one to appear fails the export by name.
 */
const PACKAGING_CODES: Partial<Record<ShippingMethod, string>> = {
  Mypost_Regular: "OWN_PACKAGING",
  Mypost_Express: "OWN_PACKAGING",
  Mypost_Reg_S_Box: "AP_BOX_S",
  Mypost_Exp_S_Box: "AP_BOX_S",
  Mypost_Reg_M_Box: "AP_BOX_M",
  Mypost_Exp_M_Box: "AP_BOX_M",
  Mypost_Reg_L_Box: "AP_BOX_L",
  Mypost_Exp_L_Box: "AP_BOX_L",
  Mypost_Reg_XL_Box: "AP_BOX_XL",
  Mypost_Exp_XL_Box: "AP_BOX_XL",
  Mypost_Reg_Xs_Satchel: "AP_SATCHEL_XS",
  Mypost_Exp_Xs_Satchel: "AP_SATCHEL_XS",
  Mypost_Reg_S_Satchel: "AP_SATCHEL_S",
  Mypost_Exp_S_Satchel: "AP_SATCHEL_S",
  Mypost_Reg_M_Satchel: "AP_SATCHEL_M",
  Mypost_Exp_M_Satchel: "AP_SATCHEL_M",
  Mypost_Reg_L_Satchel: "AP_SATCHEL_L",
  Mypost_Exp_L_Satchel: "AP_SATCHEL_L",
  Mypost_Reg_XL_Satchel: "AP_SATCHEL_XL",
  Mypost_Exp_XL_Satchel: "AP_SATCHEL_XL",
}

/** Only these two are packed by us, so only these two carry real dimensions. */
const OWN_PACKAGING_METHODS = new Set<ShippingMethod>([
  "Mypost_Regular",
  "Mypost_Express",
])

/**
 * The dimension columns are mandatory but ignored for Australia Post's own
 * packaging -- the packaging code already fixes the size. 12cm is the filler
 * xpros uses and the portal accepts.
 */
const FILLER_DIMENSION_CM = 12

export function mapPackagingType(
  method: ShippingMethod,
  invoiceNumber: string
): string {
  const code = PACKAGING_CODES[method]
  if (!code) {
    throw new UnmappableOrderError(
      invoiceNumber,
      `no MyPost packaging code is configured for ${method}`
    )
  }
  return code
}

/**
 * PP (Parcel Post) or EXP (Express). Every express method spells it `Exp` in
 * the enum; matching on that substring is what xpros does, and the enum's
 * naming is stable enough to rely on because SHIPPING_METHOD_LABELS would fail
 * to compile if a value were added without a label.
 */
export function mapDeliveryService(method: ShippingMethod): "PP" | "EXP" {
  return method === "Mypost_Express" || method.includes("Exp") ? "EXP" : "PP"
}

function dimension(mm: number | null, useReal: boolean): string {
  if (!useReal) return String(FILLER_DIMENSION_CM)
  return String(mmToCm(mm, "ceil") ?? FILLER_DIMENSION_CM)
}

export type MyPostBuildOptions = {
  sender: SenderBlock
  fallbacks: ContactFallbacks
}

export type BuiltCsv = {
  csv: string
  /** Orders whose address had to be truncated to fit the carrier's columns. */
  truncated: string[]
}

export function buildMyPostCsv(
  orders: readonly DispatchOrder[],
  { sender, fallbacks }: MyPostBuildOptions
): BuiltCsv {
  const truncated: string[] = []
  const rows: string[][] = [[...HEADERS]]

  for (const order of orders) {
    const method = order.shipping_method
    if (!method) {
      throw new UnmappableOrderError(
        order.invoice_number,
        "the order has no shipping method"
      )
    }
    if (!order.metrics) {
      throw new UnmappableOrderError(
        order.invoice_number,
        "no computed weight or size is on file for this order"
      )
    }

    const customer = order.customer
    const address = fitAddressLines(
      customer ? usableAddressLines(customer) : [],
      ADDRESS_SLOTS,
      ADDRESS_MAX
    )
    if (address.overflow) truncated.push(order.invoice_number)

    const useRealDimensions = OWN_PACKAGING_METHODS.has(method)
    // Australia Post rejects a zero weight; 100g is the smallest it accepts.
    const weight = Math.max(0.1, order.metrics.total_weight_kg)

    rows.push([
      cleanCommas(order.invoice_number),
      sender.name,
      sender.addressLine1,
      sender.addressLine2,
      sender.suburb,
      sender.state,
      sender.postcode,
      cleanCommas(customer?.full_name),
      cleanCommas(customer?.company_name),
      address.lines[0],
      address.lines[1],
      address.lines[2],
      cleanCommas(customer?.city),
      cleanCommas(customer?.state),
      cleanCommas(customer?.postcode),
      cleanCommas(customer?.email) || fallbacks.email,
      formatPhone(customer?.phone, customer?.country, fallbacks.phone),
      mapPackagingType(method, order.invoice_number),
      mapDeliveryService(method),
      dimension(order.metrics.dominant_length_mm, useRealDimensions),
      dimension(order.metrics.dominant_width_mm, useRealDimensions),
      dimension(order.metrics.dominant_height_mm, useRealDimensions),
      String(weight),
    ])
  }

  return { csv: toCsv(rows), truncated }
}
