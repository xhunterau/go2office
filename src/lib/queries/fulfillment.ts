import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import type { Loaded } from "@/lib/queries/shipping-reference"
import type { ShippingMethod } from "@/lib/orders/shipping-method"

// Order data for label production: the CSV exports, the self-printed PDF and
// the Aramex consignment submitter all read the same three things -- the order,
// its customer's address, and its computed weight and size.
//
// One module rather than a loader per carrier because the joins are identical
// and the per-order round trips are what make xpros' version slow: it calls the
// picking-zone RPC once per order inside the export loop. go2office has no
// picking zones (decision 1), so the whole N+1 disappears and this is two
// queries regardless of batch size.

type Client = SupabaseClient<Database>

/**
 * The status an order must be in to have a label produced.
 *
 * This is xpros' `Ready`. go2office's order_status has no such value; the stage
 * that means "picked, paid, waiting on a label" is `processing`, and producing
 * the label moves it to `labelled`.
 */
export const DISPATCH_STATUS = "processing" as const

/** Where an order lands once its label has been produced. */
export const LABELLED_STATUS = "labelled" as const

export type DispatchCustomer = {
  full_name: string | null
  company_name: string | null
  address_line1: string | null
  address_line2: string | null
  address_line3: string | null
  address_line4: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
  email: string | null
  phone: string | null
}

export type DispatchMetrics = {
  total_weight_kg: number
  chargeable_weight_kg: number
  goods_total: number
  total_cost: number
  dominant_length_mm: number | null
  dominant_width_mm: number | null
  dominant_height_mm: number | null
}

export type DispatchOrder = {
  id: number
  invoice_number: string
  shipping_method: ShippingMethod | null
  customer: DispatchCustomer | null
  // Null when order_metrics_summary has no row for this order. The table is
  // trigger-maintained, so that means something is wrong rather than that the
  // order is new -- the exports name the order instead of guessing a weight.
  metrics: DispatchMetrics | null
}

// One literal, for the same inference reason as METRICS_COLUMNS below.
const ORDER_SELECT =
  "id, invoice_number, shipping_method, customers (full_name, company_name, address_line1, address_line2, address_line3, address_line4, city, state, postcode, country, email, phone)" as const

// Spelled out on one line rather than concatenated: postgrest-js infers the row
// shape from the literal, and a built-up string degrades it to `unknown`.
const METRICS_COLUMNS =
  "order_id, total_weight_kg, chargeable_weight_kg, goods_total, total_cost, dominant_length_mm, dominant_width_mm, dominant_height_mm" as const

// Supabase types an embedded to-one relation as an object, but the runtime hands
// back an array when it cannot prove the relation is to-one. Both shapes are
// handled at every call site in this codebase; this is that check, once.
function oneCustomer(value: unknown): DispatchCustomer | null {
  if (Array.isArray(value)) return (value[0] as DispatchCustomer) ?? null
  return (value as DispatchCustomer) ?? null
}

export async function countDispatchableOrders(
  client: Client,
  methods: readonly ShippingMethod[]
): Promise<Loaded<number>> {
  if (methods.length === 0) return { data: 0, error: null }

  const { count, error } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", DISPATCH_STATUS)
    .in("shipping_method", methods)

  if (error) return { data: null, error: error.message }
  return { data: count ?? 0, error: null }
}

/**
 * Every order waiting on a label for the given carrier methods, oldest first.
 *
 * No pagination: the whole point is to hand the carrier one batch. The queue is
 * single digits today and would have to reach five figures before the two
 * queries here became the problem.
 */
export async function fetchDispatchableOrders(
  client: Client,
  methods: readonly ShippingMethod[]
): Promise<Loaded<DispatchOrder[]>> {
  if (methods.length === 0) return { data: [], error: null }

  const { data: orders, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", DISPATCH_STATUS)
    .in("shipping_method", methods)
    .order("id", { ascending: true })

  if (error) return { data: null, error: error.message }
  if (!orders || orders.length === 0) return { data: [], error: null }

  return attachMetrics(client, orders)
}

/**
 * Orders addressed by id, for the print route. Deliberately unfiltered by
 * status: the status flip happens when the operator clicks print, so by the
 * time the PDF is requested the orders are already `labelled`, and reprinting a
 * label later has to keep working.
 */
export async function fetchOrdersForLabels(
  client: Client,
  orderIds: readonly number[]
): Promise<Loaded<DispatchOrder[]>> {
  if (orderIds.length === 0) return { data: [], error: null }

  const { data: orders, error } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .in("id", orderIds)

  if (error) return { data: null, error: error.message }
  if (!orders || orders.length === 0) return { data: [], error: null }

  const loaded = await attachMetrics(client, orders)
  if (!loaded.data) return loaded

  // Print in the order the caller asked for, not the order Postgres returned:
  // the ids come from a table the operator has just sorted.
  const byId = new Map(loaded.data.map((order) => [order.id, order]))
  return {
    data: orderIds
      .map((id) => byId.get(id))
      .filter((order): order is DispatchOrder => order != null),
    error: null,
  }
}

type RawOrder = {
  id: number
  invoice_number: string
  shipping_method: ShippingMethod | null
  customers: unknown
}

async function attachMetrics(
  client: Client,
  orders: RawOrder[]
): Promise<Loaded<DispatchOrder[]>> {
  const { data: metrics, error } = await client
    .from("order_metrics_summary")
    .select(METRICS_COLUMNS)
    .in(
      "order_id",
      orders.map((order) => order.id)
    )

  if (error) return { data: null, error: error.message }

  const byOrder = new Map(
    (metrics ?? []).map((row) => [
      row.order_id,
      {
        total_weight_kg: Number(row.total_weight_kg),
        chargeable_weight_kg: Number(row.chargeable_weight_kg),
        goods_total: Number(row.goods_total),
        total_cost: Number(row.total_cost),
        dominant_length_mm: row.dominant_length_mm,
        dominant_width_mm: row.dominant_width_mm,
        dominant_height_mm: row.dominant_height_mm,
      } satisfies DispatchMetrics,
    ])
  )

  return {
    data: orders.map((order) => ({
      id: order.id,
      invoice_number: order.invoice_number,
      shipping_method: order.shipping_method,
      customer: oneCustomer(order.customers),
      metrics: byOrder.get(order.id) ?? null,
    })),
    error: null,
  }
}
