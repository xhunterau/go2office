import { isFlatRateMethod } from "@/lib/shipping/carrier-capabilities"
import type { QuoteResult } from "@/lib/shipping/types"

// Tiebreak order when two quotes are close enough in price to be interchangeable.
// reg_letter is deliberately absent: it falls through to the bottom, so the $5
// registered letter is only ever auto-selected when it beats the field outright
// rather than merely tying with it.
const CARRIER_PRIORITY = ["eparcel", "mypost", "aramex"]
const UNRANKED_CARRIER = 99

const FLAT_RATE_SIZE_ORDER: Record<string, number> = {
  XS: 0,
  S: 1,
  M: 2,
  L: 3,
  XL: 4,
}

// mypost_reg_satchel, mypost_exp_box, ... -- one group per series and packaging
// kind, holding that group's five sizes.
function flatRateGroupKey(shippingMethod: string): string | null {
  const parts = shippingMethod.split("_")
  if (parts.length < 4) return null
  const packageType = parts[parts.length - 1].toLowerCase()
  if (packageType !== "satchel" && packageType !== "box") return null
  return [...parts.slice(0, -2), packageType].join("_").toLowerCase()
}

function flatRateSizeIndex(shippingMethod: string): number {
  const parts = shippingMethod.split("_")
  const size = parts[parts.length - 2]?.toUpperCase() ?? ""
  return FLAT_RATE_SIZE_ORDER[size] ?? UNRANKED_CARRIER
}

// Within one flat-rate group the sizes are nested, so every size above the
// smallest that fits also fits and costs more. Keeping them all would bury the
// result table in redundant rows, so only the smallest fitting size survives.
//
// When nothing in a group fits, every row is kept instead: those rows carry the
// "does not fit" errors, and dropping them would leave the panel silently short
// of five options with no reason given.
export function filterFlatRateGroups(quotes: QuoteResult[]): QuoteResult[] {
  const groups = new Map<string, QuoteResult[]>()
  const passthrough: QuoteResult[] = []

  for (const quote of quotes) {
    const key = isFlatRateMethod(quote.shippingMethod)
      ? flatRateGroupKey(quote.shippingMethod)
      : null
    if (!key) {
      passthrough.push(quote)
      continue
    }
    const group = groups.get(key)
    if (group) group.push(quote)
    else groups.set(key, [quote])
  }

  const kept: QuoteResult[] = []
  for (const group of groups.values()) {
    const fitting = group
      .filter((q) => !q.error && q.quotedRate > 0)
      .sort(
        (a, b) =>
          flatRateSizeIndex(a.shippingMethod) - flatRateSizeIndex(b.shippingMethod)
      )
    if (fitting.length > 0) kept.push(fitting[0])
    else kept.push(...group)
  }

  return [...passthrough, ...kept]
}

// Within one carrier: satchel, then box, then own-packaging. Satchels and boxes
// are prepaid stock we already hold, so at the same price they are preferred.
function methodPriority(shippingMethod: string): number {
  if (/satchel/i.test(shippingMethod)) return 0
  if (/_box/i.test(shippingMethod)) return 1
  return 2
}

function carrierPriority(carrierCode: string): number {
  const index = CARRIER_PRIORITY.indexOf(carrierCode)
  return index === -1 ? UNRANKED_CARRIER : index
}

// Cheapest wins, except that anything within `tiebreakThreshold` of the cheapest
// counts as the same price and is decided on carrier, then method, then price.
// The threshold comes from shipping_settings.quote_tiebreak_threshold; xpros
// hard-codes 0.05.
//
// Returns null only for an empty list.
export function selectBestQuote(
  valid: QuoteResult[],
  tiebreakThreshold: number
): QuoteResult | null {
  if (valid.length === 0) return null

  const cheapestRate = Math.min(...valid.map((q) => q.quotedRate))
  const candidates = valid.filter(
    (q) => q.quotedRate <= cheapestRate * (1 + tiebreakThreshold)
  )

  candidates.sort((a, b) => {
    const byCarrier = carrierPriority(a.carrierCode) - carrierPriority(b.carrierCode)
    if (byCarrier !== 0) return byCarrier

    const byMethod = methodPriority(a.shippingMethod) - methodPriority(b.shippingMethod)
    if (byMethod !== 0) return byMethod

    return a.quotedRate - b.quotedRate
  })

  return candidates[0]
}
