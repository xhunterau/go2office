import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { aramexQuote } from "@/lib/shipping/adapters/aramex.adapter"
import { flatRateQuote } from "@/lib/shipping/adapters/flat-rate.adapter"
import { rateCardQuote } from "@/lib/shipping/adapters/rate-card.adapter"
import {
  CARRIER_CAPABILITIES,
  canQuote,
  quoteStrategyFor,
  shouldEscalatePostalToManual,
} from "@/lib/shipping/carrier-capabilities"
import { isPostalOnlyAddress } from "@/lib/shipping/postal-address"
import { filterFlatRateGroups, selectBestQuote } from "@/lib/shipping/quote-selection"
import type {
  DispatchOptionForQuote,
  OrderPackage,
  PostageConstraints,
  QuoteInput,
  QuoteResult,
  ServiceType,
  ShippingMethod,
} from "@/lib/shipping/types"

export type QuoteEngineResult =
  | {
      status: "quoted"
      quotes: QuoteResult[]
      selectedMethod: ShippingMethod | null
    }
  | { status: "manual_required"; reason: string }

// Where an order goes when nothing can be quoted for it. go2office has no
// "Manual" status; `issued` is the queue a human works through.
const ESCALATION_STATUS = "issued" as const

// Only used when the shipping_settings row is missing, which the singleton CHECK
// makes close to impossible. They match the seeded defaults.
const FALLBACK_MAX_LENGTH_MM = 1040
const FALLBACK_MAX_WEIGHT_KG = 22
const FALLBACK_TIEBREAK_THRESHOLD = 0.05

async function escalateToManual(
  supabase: SupabaseClient<Database>,
  orderId: number,
  reason: string,
  userId: string | null | undefined
): Promise<QuoteEngineResult> {
  // Logged before the status changes, and never conditionally: this rewrites an
  // order's status without anyone asking, so the row in order_logs is the only
  // thing standing between that and a silent edit.
  await supabase.from("order_logs").insert({
    order_id: orderId,
    action: `Auto-escalated to ${ESCALATION_STATUS}: ${reason}`,
    user_id: userId ?? null,
  })
  await supabase
    .from("orders")
    .update({ status: ESCALATION_STATUS })
    .eq("id", orderId)

  return { status: "manual_required", reason }
}

export async function runQuoteEngine(
  supabase: SupabaseClient<Database>,
  orderId: number,
  triggeredBy: "auto" | "manual",
  userId?: string | null
): Promise<QuoteEngineResult> {
  // ── 1. Order, customer, metrics, settings ─────────────────────────────────
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, customers(address_line1, address_line2, address_line3, address_line4, city, state, postcode)"
    )
    .eq("id", orderId)
    .single()

  if (orderError || !order) {
    throw new Error(`Order ${orderId} not found: ${orderError?.message}`)
  }

  const customer = order.customers
  if (!customer?.postcode) {
    throw new Error(`Order ${orderId} has no customer postcode`)
  }

  const { data: metrics, error: metricsError } = await supabase
    .from("order_metrics_summary")
    .select(
      "total_weight_kg, chargeable_weight_kg, max_dimension_mm, packed_length_mm, packed_width_mm, packed_height_mm, goods_total"
    )
    .eq("order_id", orderId)
    .single()

  if (metricsError || !metrics) {
    throw new Error(`No metrics for order ${orderId}: ${metricsError?.message}`)
  }

  const { data: settings } = await supabase
    .from("shipping_settings")
    .select(
      "au_post_max_length_mm, au_post_max_weight_kg, eparcel_oversize_surcharge_aud, eparcel_oversize_threshold_mm, eparcel_fuel_charge_rate, quote_tiebreak_threshold"
    )
    .eq("id", 1)
    .maybeSingle()

  const constraints: PostageConstraints = {
    auPostMaxLengthMm: Number(settings?.au_post_max_length_mm ?? FALLBACK_MAX_LENGTH_MM),
    auPostMaxWeightKg: Number(settings?.au_post_max_weight_kg ?? FALLBACK_MAX_WEIGHT_KG),
  }

  // packed_* is null on the 3981 orders with no resolvable item lines. Zero is
  // the honest reading -- there is nothing to measure -- and it lets those
  // orders quote at the lightest tier rather than throwing.
  const pkg: OrderPackage = {
    totalWeightKg: Number(metrics.total_weight_kg ?? 0),
    chargeableWeightKg: Number(metrics.chargeable_weight_kg ?? 0),
    maxDimensionMm: Number(metrics.max_dimension_mm ?? 0),
    packedLengthMm: Number(metrics.packed_length_mm ?? 0),
    packedWidthMm: Number(metrics.packed_width_mm ?? 0),
    packedHeightMm: Number(metrics.packed_height_mm ?? 0),
  }

  // order_transactions.postage_service is free text from the sales platform, not
  // an enum -- 18 distinct values across 250k rows, of which the express ones are
  // only recognisable by the word itself. Matching on it here keeps that mess out
  // of the schema (docs/shipping-quote-engine.md section 4.4).
  const { data: transactions } = await supabase
    .from("order_transactions")
    .select("postage_service")
    .eq("order_id", orderId)

  const orderServiceLevel: ServiceType = (transactions ?? []).some((t) =>
    /express/i.test(t.postage_service ?? "")
  )
    ? "express"
    : "standard"

  const isPostalOnly = isPostalOnlyAddress(
    customer.address_line1,
    customer.address_line2,
    customer.address_line3,
    customer.address_line4
  )

  // ── 2. Escalate postal-only orders no postal carrier can take ─────────────
  if (isPostalOnly) {
    const { escalate, reason } = shouldEscalatePostalToManual(pkg, constraints)
    if (escalate && reason) {
      return escalateToManual(supabase, orderId, reason, userId)
    }
  }

  // ── 3. Active dispatch options ────────────────────────────────────────────
  const { data: rawOptions, error: optionsError } = await supabase
    .from("carrier_dispatch_options")
    .select(
      "id, shipping_method, carrier_id, billing_weight_mode, service_type, fixed_price_aud, max_order_total_aud, max_packed_thickness_mm, max_packed_length_mm, max_packed_width_mm, carriers!inner(code, is_active)"
    )
    .eq("is_active", true)
    .eq("carriers.is_active", true)

  if (optionsError) {
    throw new Error(`Failed to load dispatch options: ${optionsError.message}`)
  }

  const options: DispatchOptionForQuote[] = (rawOptions ?? []).map((row) => ({
    id: row.id,
    shippingMethod: row.shipping_method,
    carrierId: row.carrier_id,
    carrierCode: row.carriers.code,
    billingWeightMode: row.billing_weight_mode as "chargeable" | "actual",
    serviceType: row.service_type as ServiceType | null,
    fixedPriceAud: row.fixed_price_aud === null ? null : Number(row.fixed_price_aud),
    maxOrderTotalAud:
      row.max_order_total_aud === null ? null : Number(row.max_order_total_aud),
    maxPackedThicknessMm: row.max_packed_thickness_mm,
    maxPackedLengthMm: row.max_packed_length_mm,
    maxPackedWidthMm: row.max_packed_width_mm,
  }))

  // ── 4. Eligibility ────────────────────────────────────────────────────────
  const quoteInput: QuoteInput = {
    orderId,
    destinationPostcode: customer.postcode,
    pkg,
    orderServiceLevel,
    isPostalOnly,
    orderTotalAud: Number(metrics.goods_total ?? 0),
  }

  const eligible = options.filter(
    (option) =>
      CARRIER_CAPABILITIES[option.carrierCode] &&
      canQuote(option, quoteInput, constraints)
  )

  if (eligible.length === 0) {
    return escalateToManual(
      supabase,
      orderId,
      "No eligible carrier for this order",
      userId
    )
  }

  // ── 5. Quote every eligible option ────────────────────────────────────────
  const quotedAt = new Date().toISOString()
  const destLocality = customer.city

  const settled = await Promise.allSettled(
    eligible.map((option): Promise<QuoteResult> => {
      switch (quoteStrategyFor(option)) {
        case "fixed_price":
          // Short-circuits before any zone or rate lookup. This is why reg_letter
          // holds zero rows in carrier_services, carrier_zone_rates and
          // postcode_carrier_zones, and why that is the correct state.
          return Promise.resolve({
            carrierId: option.carrierId,
            carrierCode: option.carrierCode,
            shippingMethod: option.shippingMethod,
            serviceId: null,
            zone: null,
            quotedRate: option.fixedPriceAud!,
            computationType: "rate_card",
          })
        case "api":
          return aramexQuote(option, pkg, {
            addressLine1: customer.address_line1,
            city: customer.city,
            state: customer.state,
            postcode: customer.postcode!,
          })
        case "flat_rate":
          return flatRateQuote(supabase, option, pkg, customer.postcode!, destLocality)
        case "rate_card":
          return rateCardQuote(supabase, option, pkg, customer.postcode!, destLocality)
      }
    })
  )

  const eparcelOversizeSurcharge = Number(settings?.eparcel_oversize_surcharge_aud ?? 0)
  const eparcelOversizeThresholdMm = Number(
    settings?.eparcel_oversize_threshold_mm ?? 0
  )
  const eparcelFuelChargeRate = Number(settings?.eparcel_fuel_charge_rate ?? 0)
  const isEparcelOversize =
    eparcelOversizeSurcharge > 0 && pkg.maxDimensionMm > eparcelOversizeThresholdMm

  const rawQuotes: QuoteResult[] = settled.map((outcome, index) => {
    const option = eligible[index]
    if (outcome.status === "rejected") {
      return {
        carrierId: option.carrierId,
        carrierCode: option.carrierCode,
        shippingMethod: option.shippingMethod,
        serviceId: null,
        zone: null,
        quotedRate: 0,
        computationType: "rate_card",
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      }
    }

    const quote = outcome.value
    if (quote.error || quote.quotedRate <= 0 || quote.carrierCode !== "eparcel") {
      return quote
    }

    // eParcel's card price is before both the oversize fee (a flat amount) and
    // the fuel levy (a percentage on everything, the fee included). Order
    // matters: levy on top of fee, not the other way round.
    const withOversize = isEparcelOversize
      ? quote.quotedRate + eparcelOversizeSurcharge
      : quote.quotedRate
    const withFuel =
      eparcelFuelChargeRate > 0 ? withOversize * (1 + eparcelFuelChargeRate) : withOversize

    return { ...quote, quotedRate: Math.round(withFuel * 100) / 100 }
  })

  const quotes = filterFlatRateGroups(rawQuotes)

  // ── 6. Persist the batch ──────────────────────────────────────────────────
  const { error: insertError } = await supabase.from("order_shipping_quotes").insert(
    quotes.map((quote) => ({
      order_id: orderId,
      carrier_id: quote.carrierId,
      shipping_method: quote.shippingMethod,
      service_id: quote.serviceId,
      zone: quote.zone,
      quoted_rate: quote.quotedRate,
      computation_type: quote.computationType,
      is_selected: false,
      error_message: quote.error ?? null,
      quoted_at: quotedAt,
    }))
  )
  if (insertError) {
    throw new Error(`Failed to persist quotes for order ${orderId}: ${insertError.message}`)
  }

  // ── 7. Auto-select ────────────────────────────────────────────────────────
  const valid = quotes.filter((quote) => !quote.error && quote.quotedRate > 0)
  const selected = selectBestQuote(
    valid,
    Number(settings?.quote_tiebreak_threshold ?? FALLBACK_TIEBREAK_THRESHOLD)
  )
  if (!selected) return { status: "quoted", quotes, selectedMethod: null }

  // order_shipping_quotes_one_selected_idx allows one selected row per order
  // across all batches, so the previous batch's winner has to be cleared before
  // this one's is set. xpros has no such index and skips this; here the update
  // below would fail on the second re-quote of any order.
  await supabase
    .from("order_shipping_quotes")
    .update({ is_selected: false })
    .eq("order_id", orderId)
    .eq("is_selected", true)

  await supabase
    .from("order_shipping_quotes")
    .update({ is_selected: true })
    .eq("order_id", orderId)
    .eq("quoted_at", quotedAt)
    .eq("shipping_method", selected.shippingMethod)

  // orders.shipping_method is deliberately NOT written here. Selecting a quote
  // is a suggestion; committing it to the order is the operator's action, and it
  // lives in the server action that backs the panel.
  await supabase.from("order_logs").insert({
    order_id: orderId,
    action: `Shipping quote completed (${triggeredBy}). Selected ${selected.shippingMethod} at $${selected.quotedRate.toFixed(2)} from ${valid.length} valid quote(s).`,
    user_id: userId ?? null,
  })

  return { status: "quoted", quotes, selectedMethod: selected.shippingMethod }
}
