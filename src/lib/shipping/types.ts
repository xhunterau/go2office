import type { Database } from "@/lib/supabase/database.types"

export type ShippingMethod = Database["public"]["Enums"]["shipping_method"]

// Both carrier_services.service_type and carrier_dispatch_options.service_type
// are stored lowercase, with a CHECK on each (migration 20260810100000). xpros
// stores them in two different cases and papers over the mismatch with
// .toLowerCase() at every comparison; keeping the union lowercase here is what
// makes those calls unnecessary rather than merely omitted.
export type ServiceType = "standard" | "express"

export interface OrderPackage {
  totalWeightKg: number
  chargeableWeightKg: number
  maxDimensionMm: number
  // Verbatim from order_metrics_summary and NOT sorted: that view stacks units
  // along height, so packedHeightMm is routinely the longest of the three.
  // Anything comparing against a carrier's L/W/H limits has to sort first.
  packedLengthMm: number
  packedWidthMm: number
  packedHeightMm: number
}

export interface QuoteInput {
  orderId: number
  destinationPostcode: string
  pkg: OrderPackage
  orderServiceLevel: ServiceType
  isPostalOnly: boolean
  orderTotalAud: number
}

export interface QuoteResult {
  carrierId: number
  // Carried on the result, unlike xpros, which looks the code back up out of
  // the eligible-option list every time it needs to rank a quote.
  carrierCode: string
  shippingMethod: ShippingMethod
  serviceId: number | null
  zone: string | null
  quotedRate: number
  computationType: "rate_card" | "api"
  error?: string
}

export interface CarrierCapability {
  postalDelivery: boolean
  // Null means the carrier has no weight ceiling of its own.
  maxWeightKg: number | null
}

// A carrier_dispatch_options row joined to its carrier, in the shape the engine
// works in. There is no originWarehouseId: go2office ships from one warehouse
// (decision 1), so the column does not exist.
export interface DispatchOptionForQuote {
  id: number
  shippingMethod: ShippingMethod
  carrierId: number
  carrierCode: string
  billingWeightMode: "chargeable" | "actual"
  serviceType: ServiceType | null
  fixedPriceAud: number | null
  maxOrderTotalAud: number | null
  maxPackedThicknessMm: number | null
  maxPackedLengthMm: number | null
  maxPackedWidthMm: number | null
}

export interface PostageConstraints {
  auPostMaxLengthMm: number
  auPostMaxWeightKg: number
}
