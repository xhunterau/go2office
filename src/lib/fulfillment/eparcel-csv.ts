import { mmToCm } from "@/lib/shipping/dimensions"
import type { ShippingMethod } from "@/lib/orders/shipping-method"
import type { DispatchOrder } from "@/lib/queries/fulfillment"
import type { EPARCEL_METHODS } from "@/lib/fulfillment/carrier-groups"
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
} from "@/lib/fulfillment/types"

type EParcelMethod = (typeof EPARCEL_METHODS)[number]

// The 25-column eParcel bulk template. It has no sender columns at all: the
// charge code identifies the account, and the account carries the address.

const HEADERS = [
  "C_CHARGE_CODE",
  "C_CONSIGNEE_NAME",
  "C_CONSIGNEE_BUSINESS_NAME",
  "C_CONSIGNEE_ADDRESS_1",
  "C_CONSIGNEE_ADDRESS_2",
  "C_CONSIGNEE_ADDRESS_3",
  "C_CONSIGNEE_ADDRESS_4",
  "C_CONSIGNEE_SUBURB",
  "C_CONSIGNEE_STATE_CODE",
  "C_CONSIGNEE_POSTCODE",
  "C_CONSIGNEE_COUNTRY_CODE",
  "C_CONSIGNEE_EMAIL",
  "C_EMAIL_NOTIFICATION",
  "C_CONSIGNEE_PHONE_NUMBER",
  "C_SIGNATURE_REQUIRED",
  "C_REF",
  "C_REF_PRINT_REQUIRED",
  "A_ACTUAL_CUBIC_WEIGHT",
  "A_LENGTH",
  "A_WIDTH",
  "A_HEIGHT",
  "A_IS_TRANSIT_COVER_REQUIRED",
  "A_TRANSIT_COVER_AMOUNT",
  "A_PROD_CLASSIFICATION",
  "A_CLASSIFICATION_EXPLANATION",
] as const

// eParcel's template carries a second header row naming each column's
// obligation, and the importer expects it to be there.
const ANNOTATIONS = [
  "MANDATORY",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "OPTIONAL",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "OPTIONAL",
  "OPTIONAL",
  "OPTIONAL",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "OPTIONAL",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "OPTIONAL",
  "OPTIONAL",
  "OPTIONAL",
  "MANDATORY",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "OPTIONAL",
  "OPTIONAL",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
  "MANDATORY/OPTIONAL REFER TO GUIDE",
] as const

/** Four consignee address columns, 40 characters each. */
const ADDRESS_SLOTS = 4
const ADDRESS_MAX = 40

const FILLER_DIMENSION_CM = 12

/**
 * go2office's eParcel contract codes, confirmed 2026-08-23.
 *
 * No default, unlike xpros' `?? '3D55'`. A charge code decides which account is
 * billed and at what rate: falling back to the regular code would bill an
 * express parcel as a regular one and produce a label the carrier will still
 * accept, so nothing would ever surface it.
 *
 * xpros' Z6 codes (3D85 / 3J85) have no equivalent here -- that account was not
 * carried over. Keyed on EPARCEL_METHODS so a new eParcel service cannot be
 * routed to this exporter without a code being decided for it.
 */
const CHARGE_CODES: Partial<Record<EParcelMethod, string>> = {
  Eparcel_Regular: "3D55",
  Eparcel_Express: "3J55",
}

export function mapChargeCode(
  method: ShippingMethod,
  invoiceNumber: string
): string {
  const code = CHARGE_CODES[method as EParcelMethod]
  if (!code) {
    throw new UnmappableOrderError(
      invoiceNumber,
      `no eParcel charge code is configured for ${method}`
    )
  }
  return code
}

/**
 * eParcel prices in weight bands, and a consignment declared between two bands
 * is billed at the higher one anyway. Rounding up here means the declared
 * weight matches the invoice.
 */
export function tieredWeight(weight: number): number {
  const bands = [0.25, 0.5, 1, 3, 5]
  for (const band of bands) {
    if (weight <= band) return band
  }
  return Math.ceil(weight)
}

/**
 * Transit cover above $300 of goods, insured for what the goods cost us rather
 * than what they sold for -- cover is there to make us whole, and a claim is
 * settled on documented value.
 *
 * xpros reads total_sale and total_unit_cost; the equivalents here are
 * goods_total (ex-postage, ex-discount) and total_cost (ex-GST).
 */
export function transitCover(
  goodsTotal: number,
  totalCost: number
): { required: "Y" | "N"; amount: number } {
  if (goodsTotal < 300) return { required: "N", amount: 0 }
  return { required: "Y", amount: totalCost }
}

export type EParcelBuildOptions = {
  fallbacks: ContactFallbacks
}

export type BuiltCsv = {
  csv: string
  truncated: string[]
}

export function buildEParcelCsv(
  orders: readonly DispatchOrder[],
  { fallbacks }: EParcelBuildOptions
): BuiltCsv {
  const truncated: string[] = []
  const rows: string[][] = [[...HEADERS], [...ANNOTATIONS]]

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

    const weight = tieredWeight(Math.max(0, order.metrics.chargeable_weight_kg))
    const cover = transitCover(order.metrics.goods_total, order.metrics.total_cost)

    rows.push([
      mapChargeCode(method, order.invoice_number),
      cleanCommas(customer?.full_name),
      cleanCommas(customer?.company_name),
      address.lines[0],
      address.lines[1],
      address.lines[2],
      address.lines[3],
      cleanCommas(customer?.city),
      cleanCommas(customer?.state),
      cleanCommas(customer?.postcode),
      // Only domestic methods are in EPARCEL_METHODS, so the country code is AU
      // by construction rather than by reading a column that legitimately holds
      // phone numbers and delivery notes (CLAUDE.md rule 21).
      "AU",
      cleanCommas(customer?.email) || fallbacks.email,
      "Y",
      formatPhone(customer?.phone, customer?.country, fallbacks.phone),
      // A = leave in a safe place without a signature.
      "A",
      cleanCommas(order.invoice_number),
      "Y",
      String(weight),
      String(mmToCm(order.metrics.dominant_length_mm, "ceil") ?? FILLER_DIMENSION_CM),
      String(mmToCm(order.metrics.dominant_width_mm, "ceil") ?? FILLER_DIMENSION_CM),
      String(mmToCm(order.metrics.dominant_height_mm, "ceil") ?? FILLER_DIMENSION_CM),
      cover.required,
      String(cover.amount),
      // eParcel rejects SALE_OF_GOODS. GIFT is what the domestic template takes;
      // the OTHER + explanation pair is only needed on international consignments,
      // which this export does not carry.
      "GIFT",
      "",
    ])
  }

  return { csv: toCsv(rows), truncated }
}
