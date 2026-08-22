import type {
  CarrierCapability,
  DispatchOptionForQuote,
  PostageConstraints,
  QuoteInput,
} from "@/lib/shipping/types"

// Keyed by carriers.code, which is unique, lowercase and CHECK-enforced
// (migration 20260810100000) precisely so this table can be looked up by it.
//
// There is no eparcel_z9: xpros ran two eParcel charge accounts and go2office
// took over only the live one, under the plain `eparcel` code. Nor is there a
// direct_freight -- we do not quote it (decision 2).
export const CARRIER_CAPABILITIES: Record<string, CarrierCapability> = {
  // eParcel's real ceiling is Australia Post's, read from shipping_settings at
  // quote time. The 20 here is only a fallback for a missing settings row.
  eparcel: { postalDelivery: true, maxWeightKg: 20 },
  mypost: { postalDelivery: true, maxWeightKg: 5 },
  aramex: { postalDelivery: false, maxWeightKg: null },
  reg_letter: { postalDelivery: true, maxWeightKg: 0.5 },
}

// Matches the sized MyPost methods (Mypost_Reg_M_Satchel, Mypost_Exp_L_Box, ...)
// and deliberately not Mypost_Regular / Mypost_Express, which have no trailing
// underscore after the service level and are priced off the rate card instead.
export function isFlatRateMethod(shippingMethod: string): boolean {
  return /^Mypost_(Reg|Exp)_/i.test(shippingMethod)
}

export function isExpressMethod(shippingMethod: string): boolean {
  return /Express|Exp_/i.test(shippingMethod)
}

// Which adapter prices an option. Fixed price is tested first and that ordering
// is the whole point: Register_Letter is the one option with a price of its own,
// and reaching it before the carrier and method tests is what keeps reg_letter
// out of the zone and rate-card tables entirely (they hold zero rows for it,
// which is the correct state -- see docs/shipping-quote-engine.md section 2.5.1).
export type QuoteStrategy = "fixed_price" | "api" | "flat_rate" | "rate_card"

export function quoteStrategyFor(option: DispatchOptionForQuote): QuoteStrategy {
  if (option.fixedPriceAud !== null) return "fixed_price"
  if (option.carrierCode === "aramex") return "api"
  return isFlatRateMethod(option.shippingMethod) ? "flat_rate" : "rate_card"
}

// Manual-escalation guard for postal-only addresses.
//
// A postal-only order is unsolvable only when it beats EVERY postal-capable
// carrier, and the strongest of those is eParcel at Australia Post's own limits.
// MyPost's 5kg cap is not the system ceiling: a 12kg parcel to a PO box still
// has to reach quoting so eParcel can price it, and canQuote drops MyPost from
// that quote on its own.
export function shouldEscalatePostalToManual(
  pkg: { maxDimensionMm: number; totalWeightKg: number },
  constraints: PostageConstraints
): { escalate: boolean; reason: string | null } {
  if (pkg.maxDimensionMm > constraints.auPostMaxLengthMm) {
    return {
      escalate: true,
      reason: `Postal-only address with oversized package (max dimension ${pkg.maxDimensionMm}mm)`,
    }
  }
  // A physical limit, so it is judged on real weight -- never on the cubed
  // chargeable weight, which can exceed 22kg for a large light parcel that the
  // counter would accept without comment.
  if (pkg.totalWeightKg > constraints.auPostMaxWeightKg) {
    return {
      escalate: true,
      reason: `Postal-only address with weight ${pkg.totalWeightKg}kg exceeds Australia Post ${constraints.auPostMaxWeightKg}kg limit`,
    }
  }
  return { escalate: false, reason: null }
}

// Which weight a method is judged by. Flat-rate packaging and eParcel are about
// what physically fits or what a person can lift, so they use the real weight;
// MyPost's own-packaging methods are billed on the cubed weight, so that is what
// their cap applies to.
function billableWeightForCap(
  option: DispatchOptionForQuote,
  pkg: QuoteInput["pkg"]
): number {
  const byActualWeight =
    option.carrierCode === "eparcel" || isFlatRateMethod(option.shippingMethod)
  return byActualWeight ? pkg.totalWeightKg : pkg.chargeableWeightKg
}

export function canQuote(
  option: DispatchOptionForQuote,
  input: QuoteInput,
  constraints: PostageConstraints
): boolean {
  const capability = CARRIER_CAPABILITIES[option.carrierCode]
  if (!capability) return false

  const { pkg, orderServiceLevel, isPostalOnly, orderTotalAud } = input

  // A customer who paid for express does not get quoted a standard service.
  // The reverse is allowed: an express option may win a standard order on price.
  if (orderServiceLevel === "express" && !isExpressMethod(option.shippingMethod)) {
    return false
  }

  if (isPostalOnly && !capability.postalDelivery) return false

  if (capability.maxWeightKg !== null) {
    const maxWeightKg =
      option.carrierCode === "eparcel"
        ? constraints.auPostMaxWeightKg
        : capability.maxWeightKg
    if (billableWeightForCap(option, pkg) > maxWeightKg) return false
  }

  if (
    capability.postalDelivery &&
    pkg.maxDimensionMm > constraints.auPostMaxLengthMm
  ) {
    return false
  }

  if (option.maxOrderTotalAud !== null && orderTotalAud > option.maxOrderTotalAud) {
    return false
  }

  if (
    option.maxPackedThicknessMm !== null ||
    option.maxPackedLengthMm !== null ||
    option.maxPackedWidthMm !== null
  ) {
    // Longest, middle, shortest. The package can be turned any way up, so the
    // limits are matched to the edges by size, not by which column they came
    // from -- order_metrics_summary stacks along height and its packedHeightMm
    // is frequently the longest edge of the three.
    const [longest, middle, shortest] = sortedEdges(pkg)
    if (
      option.maxPackedThicknessMm !== null &&
      shortest > option.maxPackedThicknessMm
    ) {
      return false
    }
    if (option.maxPackedLengthMm !== null && longest > option.maxPackedLengthMm) {
      return false
    }
    if (option.maxPackedWidthMm !== null && middle > option.maxPackedWidthMm) {
      return false
    }
  }

  return true
}

// Descending, so [longest, middle, shortest].
export function sortedEdges(pkg: {
  packedLengthMm: number
  packedWidthMm: number
  packedHeightMm: number
}): [number, number, number] {
  const [a, b, c] = [pkg.packedLengthMm, pkg.packedWidthMm, pkg.packedHeightMm].sort(
    (x, y) => y - x
  )
  return [a, b, c]
}
