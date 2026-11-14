import type { SupabaseClient } from "@supabase/supabase-js"

import type { DispatchLine } from "@/lib/fulfillment/dispatch"
import type { Database } from "@/lib/supabase/database.types"
import {
  fetchOrderDetail,
  fetchOrderTransactionsWithItems,
  type OrderDetail,
} from "@/lib/queries/orders"
import type { ProductStockLine } from "@/lib/queries/inventory"
import { escapeLike } from "@/lib/queries/search-params"

type Client = SupabaseClient<Database>

/**
 * The dispatch queue: orders whose label has been produced. /fulfillment/
 * export-labels moves `processing` here; dispatch_order() moves it on to
 * `completed`.
 */
export const DISPATCH_STATUS = "labelled" satisfies Database["public"]["Enums"]["order_status"]

/** Search results per query. The queue is a day's labels, not a history. */
const SEARCH_LIMIT = 20

export type DispatchSearchRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "invoice_number" | "platform" | "shipping_method" | "tracking_number" | "created_at"
> & { customer_name: string | null }

const SEARCH_COLUMNS = "id, invoice_number, platform, shipping_method, tracking_number, created_at"

export async function countDispatchQueue(
  supabase: Client
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", DISPATCH_STATUS)

  if (error) return { count: 0, error: error.message }
  return { count: count ?? 0, error: null }
}

/**
 * Labelled orders matching an invoice number or a customer name.
 *
 * Two queries merged rather than one `or()`: the name lives on the embedded
 * customer, and PostgREST cannot OR a column of the parent with a column of an
 * embed. Both are small -- the status filter leaves a few dozen rows -- and the
 * name match rides customers_full_name_trgm_idx.
 */
export async function searchDispatchQueue(
  supabase: Client,
  term: string
): Promise<{ rows: DispatchSearchRow[]; error: string | null }> {
  const like = `%${escapeLike(term)}%`

  const [byInvoice, byCustomer] = await Promise.all([
    supabase
      .from("orders")
      .select(`${SEARCH_COLUMNS}, customers(full_name)`)
      .eq("status", DISPATCH_STATUS)
      .ilike("invoice_number", like)
      .limit(SEARCH_LIMIT),
    supabase
      .from("orders")
      .select(`${SEARCH_COLUMNS}, customers!inner(full_name)`)
      .eq("status", DISPATCH_STATUS)
      .ilike("customers.full_name", like)
      .limit(SEARCH_LIMIT),
  ])

  const error = byInvoice.error ?? byCustomer.error
  if (error) return { rows: [], error: error.message }

  type Raw = Omit<DispatchSearchRow, "customer_name"> & {
    customers: { full_name: string | null } | null
  }
  const merged = new Map<number, DispatchSearchRow>()
  for (const row of [...(byInvoice.data ?? []), ...(byCustomer.data ?? [])] as unknown as Raw[]) {
    const { customers, ...order } = row
    merged.set(order.id, { ...order, customer_name: customers?.full_name ?? null })
  }

  const rows = [...merged.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, SEARCH_LIMIT)
  return { rows, error: null }
}

/** One order_items row on the dispatch page. */
export type DispatchItem = DispatchLine & {
  sku: string | null
  product_name: string | null
  image_url: string | null
  /** The sold line's title, for a component whose own name says little. */
  item_title: string | null
}

export type DispatchOrder = {
  order: OrderDetail
  items: DispatchItem[]
  /**
   * product id -> its stock by location, most first. A plain object: it crosses
   * to the client. ProductStockLine rather than StockSlot so the same rows feed
   * the shared StockMovementDialog for an in-place fix.
   */
  stock: Record<number, ProductStockLine[]>
}

/**
 * Everything /fulfillment/dispatch/[id] shows. Reuses the order page's two
 * loaders, so the items listed are exactly the ones the order page calls
 * "picked items" -- and exactly the rows dispatch_order() deducts.
 */
export async function fetchDispatchOrder(
  supabase: Client,
  id: number
): Promise<{ data: DispatchOrder | null; error: string | null }> {
  const [detail, lines] = await Promise.all([
    fetchOrderDetail(supabase, id),
    fetchOrderTransactionsWithItems(supabase, id),
  ])

  if (detail.error) return { data: null, error: detail.error }
  if (lines.error) return { data: null, error: lines.error }
  if (!detail.order) return { data: null, error: null }

  const items: DispatchItem[] = lines.transactions.flatMap((transaction) =>
    transaction.items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      sku: item.sku_snapshot,
      product_name: item.product_name,
      image_url: item.image_url,
      item_title: transaction.item_title,
    }))
  )

  const productIds = [
    ...new Set(items.map((item) => item.product_id).filter((pid): pid is number => pid !== null)),
  ]

  const stock: Record<number, ProductStockLine[]> = {}
  if (productIds.length > 0) {
    const { data, error } = await supabase
      .from("inventory_levels")
      .select("id, product_id, location_id, qty, locations(name)")
      .in("product_id", productIds)

    if (error) return { data: null, error: error.message }

    for (const row of (data ?? []) as unknown as {
      id: number
      product_id: number
      location_id: number
      qty: number
      locations: { name: string } | null
    }[]) {
      ;(stock[row.product_id] ??= []).push({
        id: row.id,
        location_id: row.location_id,
        location_name: row.locations?.name ?? `#${row.location_id}`,
        qty: row.qty,
      })
    }
    for (const slots of Object.values(stock)) {
      slots.sort((a, b) => b.qty - a.qty || a.location_name.localeCompare(b.location_name))
    }
  }

  return { data: { order: detail.order, items, stock }, error: null }
}
