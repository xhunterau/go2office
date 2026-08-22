import { aramexFetch } from "@/lib/aramex/client"
import type {
  AramexItem,
  AramexQuoteRequest,
  AramexQuoteResponse,
  AramexSatchelSize,
} from "@/lib/aramex/types"
import { mmToCm } from "@/lib/shipping/dimensions"
import type {
  DispatchOptionForQuote,
  OrderPackage,
  QuoteResult,
} from "@/lib/shipping/types"

export interface AramexDestination {
  addressLine1: string | null
  city: string | null
  state: string | null
  postcode: string
}

// Quoting never produces a label, so Aramex only needs the payload to be
// well-formed here -- nothing is sent to this contact. It is the business's own
// details rather than the customer's for exactly that reason.
const QUOTE_PLACEHOLDER_CONTACT = {
  ContactName: "Quote",
  PhoneNumber: "+61431950696",
  Email: "admin@xhunter.com.au",
} as const

// Aramex satchels are sold by size, and the size is chosen by what the parcel
// bills at. Above 5kg there is no satchel: the caller is expected to be quoting
// Aramex_Parcel as well, and this failure lands in the results table as that
// option's error rather than stopping the batch.
export function determineSatchelSize(chargeableWeightKg: number): AramexSatchelSize {
  if (chargeableWeightKg < 0.3) return "300gm"
  if (chargeableWeightKg < 0.5) return "A5"
  if (chargeableWeightKg < 1) return "A4"
  if (chargeableWeightKg < 3) return "A3"
  if (chargeableWeightKg < 5) return "A2"
  throw new Error(
    `Chargeable weight ${chargeableWeightKg}kg exceeds the 5kg satchel limit -- quote Aramex_Parcel instead`
  )
}

export function buildAramexItem(
  shippingMethod: string,
  pkg: OrderPackage
): AramexItem {
  if (shippingMethod !== "Aramex_Parcel") {
    return {
      Quantity: 1,
      PackageType: "S",
      SatchelSize: determineSatchelSize(pkg.chargeableWeightKg),
    }
  }

  // packed_*, not dominant_*. The packing estimate is deliberately pessimistic
  // -- it never assumes the small items ride inside the big one's carton -- and
  // a quote should err high. xpros quotes off packed_* here too but books the
  // real consignment off dominant_*; that second set is for the dispatch step,
  // which go2office has not built yet.
  return {
    Quantity: 1,
    PackageType: "P",
    WeightDead: pkg.totalWeightKg,
    Length: mmToCm(pkg.packedLengthMm, "round1") ?? undefined,
    Width: mmToCm(pkg.packedWidthMm, "round1") ?? undefined,
    Height: mmToCm(pkg.packedHeightMm, "round1") ?? undefined,
  }
}

export async function aramexQuote(
  option: DispatchOptionForQuote,
  pkg: OrderPackage,
  destination: AramexDestination
): Promise<QuoteResult> {
  const payload: AramexQuoteRequest = {
    To: {
      ...QUOTE_PLACEHOLDER_CONTACT,
      Address: {
        StreetAddress: destination.addressLine1 ?? "",
        Locality: destination.city ?? "",
        StateOrProvince: destination.state ?? "",
        PostalCode: destination.postcode,
        Country: "AU",
      },
    },
    Items: [buildAramexItem(option.shippingMethod, pkg)],
  }

  const response = await aramexFetch<{ data: AramexQuoteResponse }>(
    "/api/consignments/quote",
    { method: "POST", body: JSON.stringify(payload) }
  )

  return {
    carrierId: option.carrierId,
    carrierCode: option.carrierCode,
    shippingMethod: option.shippingMethod,
    serviceId: null,
    zone: null,
    // `total`, not `price`: total is price + GST, and the Australia Post rate
    // card this is ranked against is GST-inclusive too (confirmed 2026-08-22).
    // Switching to the ex-GST `price` would make Aramex look 10% cheaper than
    // every other carrier and win quotes it should not -- a difference nothing
    // on the page would show.
    //
    // Aramex answers to six decimal places (70.806197). order_shipping_quotes is
    // numeric(10,2), so the stored figure is rounded either way -- rounding here
    // is what keeps the number the engine ranks and logs identical to the number
    // in the row. The rate-card adapters round for the same reason.
    quotedRate: Math.round(response.data.total * 100) / 100,
    computationType: "api",
  }
}
