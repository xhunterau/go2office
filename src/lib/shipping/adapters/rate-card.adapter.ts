import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { resolveZone } from "@/lib/shipping/adapters/zone-resolver"
import type {
  DispatchOptionForQuote,
  OrderPackage,
  QuoteResult,
} from "@/lib/shipping/types"

// Prices an option off carrier_services + carrier_zone_rates: pick the weight
// tier the parcel falls into, then read that tier's rate for the destination
// zone. Used by Eparcel_Regular/Express and Mypost_Regular/Express -- the
// methods where we supply the packaging, so the weight decides the price.
export async function rateCardQuote(
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

  const billingWeight =
    option.billingWeightMode === "actual" ? pkg.totalWeightKg : pkg.chargeableWeightKg

  const zoneResult = await resolveZone(
    supabase,
    option.carrierId,
    option.carrierCode,
    destPostcode,
    destLocality
  )
  if ("error" in zoneResult) return failed(zoneResult.error)
  const { zone, surcharge } = zoneResult

  let tiersQuery = supabase
    .from("carrier_services")
    .select("id, size_label, max_weight, sort_order")
    .eq("carrier_id", option.carrierId)
    .order("sort_order", { ascending: true })

  // No .toLowerCase() on either side: both service_type columns are stored
  // lowercase under a CHECK (migration 20260810100000). xpros needs the call
  // because its two tables disagree on case, and the one call site that forgot
  // it never matches a tier at all.
  if (option.serviceType) {
    tiersQuery = tiersQuery.eq("service_type", option.serviceType)
  }

  const { data: tiers, error: tiersError } = await tiersQuery
  if (tiersError) return failed(tiersError.message, zone)
  if (!tiers?.length) {
    return failed(`No service tiers for carrier ${option.carrierCode}`, zone)
  }

  // Tiers come back by sort_order, so the first fixed bucket that holds the
  // parcel is also the cheapest one that does. max_weight NULL is the per-kg
  // fallback, taken only when the parcel outgrows every fixed bucket -- MyPost
  // has no such row, which is how a 6kg parcel drops out of MyPost entirely.
  const tier =
    tiers.find((t) => t.max_weight !== null && billingWeight <= t.max_weight) ??
    tiers.find((t) => t.max_weight === null)

  if (!tier) {
    return failed(`Weight ${billingWeight}kg exceeds all service tiers`, zone)
  }

  const { data: rateRow, error: rateError } = await supabase
    .from("carrier_zone_rates")
    .select("rate, base_rate, per_kg_rate, min_charge")
    .eq("service_id", tier.id)
    .eq("zone", zone)
    .maybeSingle()

  if (rateError) return failed(rateError.message, zone)
  if (!rateRow) return failed(`No rate for zone ${zone}`, zone, tier.id)

  // carrier_zone_rates_has_pricing guarantees one of the two forms is filled in,
  // so neither branch can quietly produce the $0 that would win the auto-select.
  const cost =
    tier.max_weight === null
      ? Math.max(
          Number(rateRow.base_rate ?? 0) + billingWeight * Number(rateRow.per_kg_rate ?? 0),
          Number(rateRow.min_charge ?? 0)
        )
      : Number(rateRow.rate ?? 0)

  return {
    ...base,
    zone,
    serviceId: tier.id,
    quotedRate: Math.round((cost + surcharge) * 100) / 100,
  }
}
