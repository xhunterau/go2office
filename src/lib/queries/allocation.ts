import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import type { Loaded } from "@/lib/queries/shipping-reference"
import type { ShippingQuoteRow } from "@/lib/queries/shipping-quotes"
import type { ShippingMethod } from "@/lib/orders/shipping-method"
// The one JS-side implementation of `lpad(btrim(x), 4, '0')`. Reused rather
// than mirrored: this comparison has to stay identical to the SQL in
// standardize_customer_address and in verify_pending_order_addresses, and a
// second copy is precisely how those drift (CLAUDE.md rule 21).
import { normalizePostcode } from "@/lib/shipping/adapters/zone-resolver"

// Order Allocation reads two queues out of one status.
//
// xpros carries a `pending_status` enum to say which stage an order is in.
// go2office does not do the backorder stage, so there are two stages and one
// bit of state, and that bit is orders.address_verified_at (migration
// 20260824100000). Everything in this module is a filter on that pair.

type Client = SupabaseClient<Database>

/** The status an order must be in to appear in either allocation queue. */
export const ALLOCATION_STATUS = "pending" as const

/**
 * Where an approved order lands: the queue /fulfillment/export-labels reads.
 * Approving here is the step that hands the order to label production.
 */
export const APPROVED_STATUS = "processing" as const

/**
 * Allocation is Australia-only (user decision).
 *
 * The postcode reference is Australian, and the method xpros routes overseas
 * orders to -- Eparcel_Intl_Express -- was dropped in migration 20260823110000
 * because there is no international contract. Rather than park those orders in
 * a queue that can never clear, they stay on /orders and are handled by hand.
 * customers.country is an ISO code by the time it is stored
 * (customers_standardize_address, CLAUDE.md rule 21), so this compares against
 * the code and not against the word "Australia".
 */
export const ALLOCATION_COUNTRY = "AU" as const

export type AllocationCustomer = {
  id: number
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  address_line3: string | null
  address_line4: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
}

export type AllocationOrder = {
  id: number
  invoice_number: string
  platform: Database["public"]["Enums"]["sales_platform"]
  shipping_method: ShippingMethod | null
  /** What the CUSTOMER paid for postage. Not what the carrier will charge. */
  postage_and_handling: number
  posted_on_date: string | null
  created_at: string
  customer: AllocationCustomer | null
}

export type AllocationMetrics = {
  total_weight_kg: number
  chargeable_weight_kg: number
  goods_total: number
  max_dimension_mm: number | null
}

export type PostageStageOrder = AllocationOrder & {
  /**
   * Null when order_metrics_summary has no row. The quote engine throws on
   * those orders rather than inventing a weight, so the page says so up front.
   */
  metrics: AllocationMetrics | null
  /** The most recent quote batch, or an empty list if never quoted. */
  quotes: ShippingQuoteRow[]
  quotedAt: string | null
}

export type AddressStageOrder = AllocationOrder & {
  /**
   * Localities the postcode reference does hold for this order's postcode.
   *
   * Empty means the postcode itself is unknown; non-empty means the postcode is
   * fine and the suburb is what does not match, which is by far the common case
   * and is fixed by picking one of these. Saves the operator a trip to
   * /settings/postcodes to find out which it is.
   */
  knownLocalities: string[]
}

// Spelled out as one literal: postgrest-js infers the row shape from it, and a
// string built by concatenation degrades to `unknown`.
const ORDER_SELECT =
  "id, invoice_number, platform, shipping_method, postage_and_handling, posted_on_date, created_at, customers!inner (id, full_name, company_name, email, phone, address_line1, address_line2, address_line3, address_line4, city, state, postcode, country)" as const

const METRICS_COLUMNS =
  "order_id, total_weight_kg, chargeable_weight_kg, goods_total, max_dimension_mm" as const

type RawOrder = {
  id: number
  invoice_number: string
  platform: Database["public"]["Enums"]["sales_platform"]
  shipping_method: ShippingMethod | null
  postage_and_handling: number
  posted_on_date: string | null
  created_at: string
  customers: unknown
}

// Supabase types an embedded to-one relation as an object but hands back an
// array whenever it cannot prove the relation is to-one. Both shapes are
// handled everywhere in this codebase; this is that check, once.
function oneCustomer(value: unknown): AllocationCustomer | null {
  if (Array.isArray(value)) return (value[0] as AllocationCustomer) ?? null
  return (value as AllocationCustomer) ?? null
}

function toAllocationOrder(row: RawOrder): AllocationOrder {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    platform: row.platform,
    shipping_method: row.shipping_method,
    postage_and_handling: Number(row.postage_and_handling),
    posted_on_date: row.posted_on_date,
    created_at: row.created_at,
    customer: oneCustomer(row.customers),
  }
}

function countQueue(
  client: Client,
  verified: boolean
): PromiseLike<{ count: number | null; error: { message: string } | null }> {
  const query = client
    .from("orders")
    .select("id, customers!inner (country)", { count: "exact", head: true })
    .eq("status", ALLOCATION_STATUS)
    .eq("customers.country", ALLOCATION_COUNTRY)

  return verified
    ? query.not("address_verified_at", "is", null)
    : query.is("address_verified_at", null)
}

export async function countAddressQueue(client: Client): Promise<Loaded<number>> {
  const { count, error } = await countQueue(client, false)
  if (error) return { data: null, error: error.message }
  return { data: count ?? 0, error: null }
}

export async function countPostageQueue(client: Client): Promise<Loaded<number>> {
  const { count, error } = await countQueue(client, true)
  if (error) return { data: null, error: error.message }
  return { data: count ?? 0, error: null }
}

/**
 * Orders whose address has not been confirmed yet, oldest first.
 *
 * No pagination. This queue is what the batch check could not resolve
 * automatically -- about 3.4% of Australian customers, so a few dozen a month
 * at the historical order rate -- and every card in it needs a human anyway.
 */
export async function fetchAddressStageOrders(
  client: Client
): Promise<Loaded<AddressStageOrder[]>> {
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", ALLOCATION_STATUS)
    .eq("customers.country", ALLOCATION_COUNTRY)
    .is("address_verified_at", null)
    .order("id", { ascending: true })

  if (error) return { data: null, error: error.message }

  const orders = ((data ?? []) as unknown as RawOrder[]).map(toAllocationOrder)
  if (orders.length === 0) return { data: [], error: null }

  const postcodes = [
    ...new Set(
      orders
        .map((order) => normalizePostcode(order.customer?.postcode ?? ""))
        .filter((code) => code.length === 4)
    ),
  ]

  const localities = new Map<string, string[]>()
  if (postcodes.length > 0) {
    const { data: rows, error: postcodeError } = await client
      .from("postcodes")
      .select("postcode, locality")
      .in("postcode", postcodes)
      .order("locality", { ascending: true })

    if (postcodeError) return { data: null, error: postcodeError.message }

    for (const row of rows ?? []) {
      const list = localities.get(row.postcode)
      if (list) list.push(row.locality)
      else localities.set(row.postcode, [row.locality])
    }
  }

  return {
    data: orders.map((order) => ({
      ...order,
      knownLocalities: localities.get(normalizePostcode(order.customer?.postcode ?? "")) ?? [],
    })),
    error: null,
  }
}

export type PostageQueueRef = { id: number; invoice_number: string }

/**
 * Just the ids and invoice numbers in the Postage queue.
 *
 * What the batch quote task needs: it re-reads each order through the quote
 * engine anyway, so pulling metrics and prior quote batches for the whole queue
 * first would be work thrown away. The invoice number is carried because it is
 * what a failure is reported by -- an id means nothing to the operator.
 */
export async function fetchPostageQueueRefs(
  client: Client
): Promise<Loaded<PostageQueueRef[]>> {
  const { data, error } = await client
    .from("orders")
    .select("id, invoice_number, customers!inner (country)")
    .eq("status", ALLOCATION_STATUS)
    .eq("customers.country", ALLOCATION_COUNTRY)
    .not("address_verified_at", "is", null)
    .order("id", { ascending: true })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((row) => ({
      id: row.id,
      invoice_number: row.invoice_number,
    })),
    error: null,
  }
}

/**
 * Orders whose address is confirmed and which are waiting on a priced,
 * approved carrier, oldest first.
 */
export async function fetchPostageStageOrders(
  client: Client
): Promise<Loaded<PostageStageOrder[]>> {
  const { data, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", ALLOCATION_STATUS)
    .eq("customers.country", ALLOCATION_COUNTRY)
    .not("address_verified_at", "is", null)
    .order("id", { ascending: true })

  if (error) return { data: null, error: error.message }

  const orders = ((data ?? []) as unknown as RawOrder[]).map(toAllocationOrder)
  if (orders.length === 0) return { data: [], error: null }

  const orderIds = orders.map((order) => order.id)

  const [metrics, quotes] = await Promise.all([
    fetchMetricsFor(client, orderIds),
    fetchLatestQuotesForOrders(client, orderIds),
  ])

  if (metrics.error) return { data: null, error: metrics.error }
  if (quotes.error) return { data: null, error: quotes.error }

  return {
    data: orders.map((order) => {
      const batch = quotes.data?.get(order.id)
      return {
        ...order,
        metrics: metrics.data?.get(order.id) ?? null,
        quotes: batch?.quotes ?? [],
        quotedAt: batch?.quotedAt ?? null,
      }
    }),
    error: null,
  }
}

async function fetchMetricsFor(
  client: Client,
  orderIds: number[]
): Promise<Loaded<Map<number, AllocationMetrics>>> {
  const { data, error } = await client
    .from("order_metrics_summary")
    .select(METRICS_COLUMNS)
    .in("order_id", orderIds)

  if (error) return { data: null, error: error.message }

  return {
    data: new Map(
      (data ?? []).map((row) => [
        row.order_id,
        {
          total_weight_kg: Number(row.total_weight_kg),
          chargeable_weight_kg: Number(row.chargeable_weight_kg),
          goods_total: Number(row.goods_total),
          max_dimension_mm: row.max_dimension_mm,
        } satisfies AllocationMetrics,
      ])
    ),
    error: null,
  }
}

type RawQuote = Omit<ShippingQuoteRow, "carrier_code" | "carrier_name"> & {
  order_id: number
  carriers: { code: string; name: string } | null
}

const QUOTE_COLUMNS =
  "id, order_id, shipping_method, carrier_id, zone, quoted_rate, computation_type, is_selected, error_message, quoted_at, carriers(code, name)" as const

/**
 * The newest quote batch for each of several orders, in one round trip.
 *
 * fetchLatestShippingQuotes does this for a single order; looping it over a
 * queue would be an N+1 against a table that grows a batch per re-quote. Older
 * batches are dropped here for the same reason they are there: an order
 * accumulates one per re-quote, and mixing them would put two prices for the
 * same carrier on screen at once.
 */
export async function fetchLatestQuotesForOrders(
  client: Client,
  orderIds: readonly number[]
): Promise<Loaded<Map<number, { quotes: ShippingQuoteRow[]; quotedAt: string }>>> {
  if (orderIds.length === 0) return { data: new Map(), error: null }

  const { data, error } = await client
    .from("order_shipping_quotes")
    .select(QUOTE_COLUMNS)
    .in("order_id", orderIds)
    .order("quoted_at", { ascending: false })
    .order("quoted_rate", { ascending: true })

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as RawQuote[]
  const latest = new Map<number, { quotes: ShippingQuoteRow[]; quotedAt: string }>()

  for (const { carriers, order_id, ...quote } of rows) {
    const existing = latest.get(order_id)

    // Rows arrive newest batch first, so the first quoted_at seen for an order
    // is that order's latest batch and anything older is skipped.
    if (existing && existing.quotedAt !== quote.quoted_at) continue

    const mapped: ShippingQuoteRow = {
      ...quote,
      quoted_rate: Number(quote.quoted_rate),
      carrier_code: carriers?.code ?? "",
      carrier_name: carriers?.name ?? carriers?.code ?? "—",
    }

    if (existing) existing.quotes.push(mapped)
    else latest.set(order_id, { quotes: [mapped], quotedAt: quote.quoted_at })
  }

  return { data: latest, error: null }
}
