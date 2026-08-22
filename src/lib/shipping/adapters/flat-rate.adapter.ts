import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { sortedEdges } from "@/lib/shipping/carrier-capabilities"
import { resolveZone } from "@/lib/shipping/adapters/zone-resolver"
import type {
  DispatchOptionForQuote,
  OrderPackage,
  QuoteResult,
} from "@/lib/shipping/types"

export type FlatRatePackageType = "satchel" | "box"

export type FlatRateParsed = {
  packageType: FlatRatePackageType
  sizeLabel: string
}

export type FlatRateSpec = {
  lengthMm: number
  widthMm: number
  // Null on satchels: a satchel has no fixed depth, it just gets fuller.
  depthMm: number | null
}

// Mypost_Reg_M_Satchel -> { satchel, "M" }. The enum spells the smallest size
// "Xs", flat_rate_package_specs stores "XS", hence the uppercasing.
export function parseFlatRateMethod(shippingMethod: string): FlatRateParsed | null {
  const parts = shippingMethod.split("_")
  if (parts.length < 4) return null
  const packageType = parts[parts.length - 1].toLowerCase()
  if (packageType !== "satchel" && packageType !== "box") return null
  return { packageType, sizeLabel: parts[parts.length - 2].toUpperCase() }
}

// Whether the packed order physically goes into the packaging.
//
// A satchel is judged in 2D: it is a flat sleeve, so the item's thickness eats
// into both of the other two dimensions as the sleeve wraps around it. A box is
// judged in 3D against its own walls.
export function fitsFlatRatePackage(
  packageType: FlatRatePackageType,
  spec: FlatRateSpec,
  pkg: OrderPackage
): boolean {
  const [longest, middle, shortest] = sortedEdges(pkg)
  if (packageType === "satchel") {
    return (
      longest + shortest <= spec.lengthMm && middle + shortest <= spec.widthMm
    )
  }
  return (
    longest <= spec.lengthMm &&
    middle <= spec.widthMm &&
    shortest <= (spec.depthMm ?? 0)
  )
}

// Prices a MyPost flat-rate satchel or box. The packaging, not the weight,
// decides the price: each size maps to the weight tier the carrier bills it as,
// however light the contents are.
export async function flatRateQuote(
  supabase: SupabaseClient<Database>,
  option: DispatchOptionForQuote,
  pkg: OrderPackage,
  destPostcode: string,
  destLocality: string | null
): Promise<QuoteResult> {
  const base = {
    carrierId: option.carrierId,
    carrierCode: option.carrierCode,
    shippingMethod: option.shippingMethod,
    computationType: "rate_card" as const,
  }
  const failed = (
    error: string,
    zone: string | null = null,
    serviceId: number | null = null
  ): QuoteResult => ({ ...base, zone, serviceId, quotedRate: 0, error })

  const parsed = parseFlatRateMethod(option.shippingMethod)
  if (!parsed) {
    return failed(`Cannot parse flat rate method: ${option.shippingMethod}`)
  }

  const { data: spec, error: specError } = await supabase
    .from("flat_rate_package_specs")
    .select("length_mm, width_mm, depth_mm, maps_to_weight_kg")
    .eq("package_type", parsed.packageType)
    .eq("size_label", parsed.sizeLabel)
    .maybeSingle()

  if (specError) return failed(specError.message)
  if (!spec) return failed(`No spec for ${parsed.packageType} ${parsed.sizeLabel}`)

  const fits = fitsFlatRatePackage(
    parsed.packageType,
    { lengthMm: spec.length_mm, widthMm: spec.width_mm, depthMm: spec.depth_mm },
    pkg
  )
  if (!fits) {
    const [longest, middle, shortest] = sortedEdges(pkg)
    return failed(
      `Item (${longest}x${middle}x${shortest}mm) does not fit in ${parsed.packageType} ${parsed.sizeLabel}`
    )
  }

  const zoneResult = await resolveZone(
    supabase,
    option.carrierId,
    option.carrierCode,
    destPostcode,
    destLocality
  )
  if ("error" in zoneResult) return failed(zoneResult.error)
  const { zone, surcharge } = zoneResult

  // The tier is pinned by the packaging's billed weight, not by what the parcel
  // actually weighs. Again no .toLowerCase(): service_type is lowercase in both
  // tables by CHECK.
  const serviceType = option.serviceType ?? "standard"
  const { data: tier, error: tierError } = await supabase
    .from("carrier_services")
    .select("id")
    .eq("carrier_id", option.carrierId)
    .eq("service_type", serviceType)
    .eq("max_weight", spec.maps_to_weight_kg)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (tierError) return failed(tierError.message, zone)
  if (!tier) {
    return failed(
      `No ${serviceType} tier at ${spec.maps_to_weight_kg}kg for carrier ${option.carrierCode}`,
      zone
    )
  }

  const { data: rateRow, error: rateError } = await supabase
    .from("carrier_zone_rates")
    .select("rate")
    .eq("service_id", tier.id)
    .eq("zone", zone)
    .maybeSingle()

  if (rateError) return failed(rateError.message, zone, tier.id)
  if (rateRow?.rate == null) {
    return failed(`No rate for zone ${zone} / service ${tier.id}`, zone, tier.id)
  }

  return {
    ...base,
    zone,
    serviceId: tier.id,
    quotedRate: Math.round((Number(rateRow.rate) + surcharge) * 100) / 100,
  }
}
