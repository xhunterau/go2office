import type { ShippingMethod } from "@/lib/orders/shipping-method"
import { usesInvoiceAsTracking } from "@/lib/fulfillment/dispatch"

// What to tell Shopify and eBay about a dispatched parcel: which carrier, and
// whether there is a tracking number at all. See docs/order-dispatch.md §5.
//
// Getting this wrong fails silently: a number filed under the wrong carrier is
// accepted by both platforms, and the buyer's tracking link just finds nothing.
// So every lookup below either answers or throws -- no `?? default`
// (CLAUDE.md rule 24).

export type Carrier = "australia_post" | "aramex"

export type Shipment =
  | { tracked: true; carrier: Carrier; trackingNumber: string }
  /** Marked shipped with no tracking number: a letter, or a placeholder number. */
  | { tracked: false }

/** A shipment the platforms cannot be told about correctly; the sync row fails with this message. */
export class UnmappableShipmentError extends Error {}

/**
 * Where the carrier comes from, per shipping_method:
 *   a Carrier     -- the method decides it;
 *   "by_prefix"   -- the method does not (historically these went out with
 *                    either carrier), so the tracking number's prefix does;
 *   "untracked"   -- never a real tracking number.
 *
 * A Record over the whole enum, so a new shipping_method does not compile until
 * it is given a row here.
 */
const METHOD_CARRIER: Record<ShippingMethod, Carrier | "by_prefix" | "untracked"> = {
  // Stamped letters. The "tracking number" field holds the invoice number
  // (2,285 of 2,690 eBay letters in the last year, and the dispatch page's
  // default), which is sent as Australia Post's (user decision, 2026-11-25).
  Letter: "australia_post",
  Register_Letter: "australia_post",
  Parcel_Post: "australia_post",
  Express_Post: "australia_post",
  Eparcel_Regular: "australia_post",
  Eparcel_Express: "australia_post",
  Mypost_Regular: "australia_post",
  Mypost_Express: "australia_post",
  Mypost_Reg_S_Box: "australia_post",
  Mypost_Reg_M_Box: "australia_post",
  Mypost_Reg_L_Box: "australia_post",
  Mypost_Reg_XL_Box: "australia_post",
  Mypost_Exp_S_Box: "australia_post",
  Mypost_Exp_M_Box: "australia_post",
  Mypost_Exp_L_Box: "australia_post",
  Mypost_Exp_XL_Box: "australia_post",
  Mypost_Reg_Xs_Satchel: "australia_post",
  Mypost_Reg_S_Satchel: "australia_post",
  Mypost_Reg_M_Satchel: "australia_post",
  Mypost_Reg_L_Satchel: "australia_post",
  Mypost_Reg_XL_Satchel: "australia_post",
  Mypost_Exp_Xs_Satchel: "australia_post",
  Mypost_Exp_S_Satchel: "australia_post",
  Mypost_Exp_M_Satchel: "australia_post",
  Mypost_Exp_L_Satchel: "australia_post",
  Mypost_Exp_XL_Satchel: "australia_post",
  Aramex_Parcel: "aramex",
  Aramex_Satchel: "aramex",
  // UBI's last mile is Australia Post, and its tracking numbers are looked up
  // there (user decision, 2026-11-25).
  Ubi: "australia_post",
  // History: Click_and_Collect numbers are all Australia Post; Store_Delivery
  // mixes Australia Post, Aramex and others (user decision, 2026-11-16).
  Store_Delivery: "by_prefix",
  Click_and_Collect: "by_prefix",
  Direct_Freight: "by_prefix",
}

/**
 * The carrier a tracking number's own format names, or null when it names
 * none. Formats as stored, i.e. after normalize_tracking_number (CLAUDE.md
 * rule 20): Aramex `MS…`/`MP…`; Australia Post eParcel/StarTrack article ids
 * (`33GLH…`), registered post (`RPP…`/`TMP…`) and MyPost (`99…`, digits).
 */
export function carrierFromTrackingNumber(trackingNumber: string): Carrier | null {
  const tn = trackingNumber.trim().toUpperCase()
  if (/^M[SP]\d{6,}$/.test(tn)) return "aramex"
  if (/^33[A-Z]{3}\d+$/.test(tn) || /^(RPP|TMP)\d+$/.test(tn) || /^99\d{10,}$/.test(tn)) {
    return "australia_post"
  }
  return null
}

/**
 * The shipment to report for a dispatched order.
 *
 * Untracked when the method never has a number, or when the stored number is
 * really the invoice number (how some parcels were recorded) -- sending that to
 * a buyer as a tracking number would be worse than none (user decision,
 * 2026-11-16). Letter is the exception: its invoice number is sent as Australia
 * Post's tracking number (user decision, 2026-11-25; usesInvoiceAsTracking).
 *
 * When both the method and the number's format name a carrier and they
 * disagree, it throws rather than picking one.
 */
export function resolveShipment(order: {
  shipping_method: ShippingMethod | null
  tracking_number: string | null
  invoice_number: string
}): Shipment {
  const tn = order.tracking_number?.trim() || null
  const rule = order.shipping_method === null ? "by_prefix" : METHOD_CARRIER[order.shipping_method]

  if (rule === "untracked" || tn === null) return { tracked: false }
  if (
    tn.toUpperCase() === order.invoice_number.trim().toUpperCase() &&
    !usesInvoiceAsTracking(order)
  ) {
    return { tracked: false }
  }

  const fromNumber = carrierFromTrackingNumber(tn)

  if (rule === "by_prefix") {
    // A number in no format we know goes out without a carrier rather than
    // under a guessed one.
    return fromNumber === null ? { tracked: false } : { tracked: true, carrier: fromNumber, trackingNumber: tn }
  }

  if (fromNumber !== null && fromNumber !== rule) {
    throw new UnmappableShipmentError(
      `Tracking number ${tn} looks like ${CARRIER_LABELS[fromNumber]}, but the order ships ${order.shipping_method} (${CARRIER_LABELS[rule]}). Fix the shipping method or the tracking number, then retry.`
    )
  }
  return { tracked: true, carrier: rule, trackingNumber: tn }
}

export const CARRIER_LABELS: Record<Carrier, string> = {
  australia_post: "Australia Post",
  aramex: "Aramex",
}

/**
 * Shopify's tracking company names, exactly as its supported list spells them
 * (capitalisation matters). Verified 2026-11-16 against the FulfillmentTrackingInfo
 * docs, API 2026-10: "Australia Post" (global list), "Aramex Australia"
 * (Australia list; plain "Aramex" is not listed). A listed name makes Shopify
 * build the tracking URL itself, so no url is sent.
 */
export const SHOPIFY_TRACKING_COMPANY: Record<Carrier, string> = {
  australia_post: "Australia Post",
  aramex: "Aramex Australia",
}

/**
 * eBay's shippingCarrierCode values, taken from the eBay Australia site's own
 * carrier list (Trading API GeteBayDetails, ShippingCarrierDetails, SiteID 15,
 * read 2026-11-18): 35 carriers, "AustraliaPost" among them, no Aramex.
 * Aramex Australia is Fastway Couriers renamed (2022), and fastway.com.au now
 * redirects to aramex.com.au/tools/track, so Aramex goes as the site's
 * "FASTWAYCOURIERS" (user decision, 2026-11-18). The global "ARAMEX" value is
 * not on the AU list. A null here makes that carrier fail with a message
 * instead of being sent under a guess.
 */
export const EBAY_CARRIER_CODE: Record<Carrier, string | null> = {
  australia_post: "AustraliaPost",
  aramex: "FASTWAYCOURIERS",
}

export function ebayCarrierCode(carrier: Carrier): string {
  const code = EBAY_CARRIER_CODE[carrier]
  if (code === null) {
    throw new UnmappableShipmentError(
      `The eBay carrier code for ${CARRIER_LABELS[carrier]} has not been confirmed yet, so the tracking number was not sent. Add it to EBAY_CARRIER_CODE in src/lib/fulfillment/platform-carriers.ts, or add the tracking number in Seller Hub.`
    )
  }
  return code
}
