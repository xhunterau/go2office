import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import type { Loaded } from "@/lib/queries/shipping-reference"
import type { DispatchCustomer } from "@/lib/queries/fulfillment"
import type { ShippingMethod } from "@/lib/orders/shipping-method"

type Client = SupabaseClient<Database>

export type InvoiceLine = {
  id: number
  item_title: string | null
  custom_label: string | null
  quantity: number
  sale_price: number
}

export type InvoiceOrder = {
  id: number
  invoice_number: string
  status: Database["public"]["Enums"]["order_status"]
  platform: Database["public"]["Enums"]["sales_platform"]
  shipping_method: ShippingMethod | null
  legacy_shipping_method: string | null
  postage_and_handling: number
  discount: number
  tracking_number: string | null
  created_at: string
  posted_on_date: string | null
  customer: DispatchCustomer | null
  lines: InvoiceLine[]
  /** From order_metrics_summary, the same numbers the detail page shows. */
  goods_total: number
  order_total: number
}

// The customer columns are exactly the label exports' DispatchCustomer, so the
// type is imported rather than declared again -- an invoice and a parcel label
// print the same address, and usableAddressLines() takes the same shape.
const INVOICE_SELECT = `
  id, invoice_number, status, platform, shipping_method, legacy_shipping_method,
  postage_and_handling, discount, tracking_number, created_at, posted_on_date,
  customers (
    full_name, company_name, address_line1, address_line2, address_line3,
    address_line4, city, state, postcode, country, email, phone
  ),
  order_transactions (id, item_title, custom_label, quantity, sale_price),
  order_metrics_summary (goods_total, order_total)
` as const

// Supabase types an embedded to-one relation as an object but hands back an
// array whenever it cannot prove the relation is to-one. Same guard as
// queries/fulfillment.ts.
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return (value as T) ?? null
}

/**
 * Orders addressed by id, for the invoice print route.
 *
 * One round trip: unlike the transactions table on the detail page this needs
 * no product lookup (an invoice lists what was sold, not what was picked off a
 * shelf), so the transaction lines embed directly.
 *
 * Not filtered by status. An invoice is reprinted long after dispatch, and
 * refusing to print one for a completed order would make the button useless on
 * every order it is most often wanted for.
 */
export async function fetchOrdersForInvoices(
  client: Client,
  orderIds: readonly number[]
): Promise<Loaded<InvoiceOrder[]>> {
  if (orderIds.length === 0) return { data: [], error: null }

  const { data, error } = await client
    .from("orders")
    .select(INVOICE_SELECT)
    .in("id", orderIds)

  if (error) return { data: null, error: error.message }
  if (!data || data.length === 0) return { data: [], error: null }

  const orders: InvoiceOrder[] = data.map((row) => {
    const raw = row as unknown as Omit<
      InvoiceOrder,
      "customer" | "lines" | "goods_total" | "order_total"
    > & {
      customers: unknown
      order_transactions: InvoiceLine[] | null
      order_metrics_summary: {
        goods_total: number
        order_total: number
      } | null
    }

    const metrics = one<{ goods_total: number; order_total: number }>(
      raw.order_metrics_summary
    )

    return {
      id: raw.id,
      invoice_number: raw.invoice_number,
      status: raw.status,
      platform: raw.platform,
      shipping_method: raw.shipping_method,
      legacy_shipping_method: raw.legacy_shipping_method,
      postage_and_handling: Number(raw.postage_and_handling),
      discount: Number(raw.discount),
      tracking_number: raw.tracking_number,
      created_at: raw.created_at,
      posted_on_date: raw.posted_on_date,
      customer: one<DispatchCustomer>(raw.customers),
      // Oldest line first, matching the detail page's table.
      lines: [...(raw.order_transactions ?? [])]
        .map((line) => ({ ...line, sale_price: Number(line.sale_price) }))
        .sort((a, b) => a.id - b.id),
      // Both come from order_metrics_summary rather than being summed here, so
      // the invoice and the order page can never disagree. The fallbacks cover
      // the 25 orders with no transaction lines at all.
      goods_total: metrics ? Number(metrics.goods_total) : 0,
      order_total: metrics ? Number(metrics.order_total) : 0,
    }
  })

  // Print in the order the caller asked for, not the order Postgres returned.
  const byId = new Map(orders.map((order) => [order.id, order]))
  return {
    data: orderIds
      .map((id) => byId.get(id))
      .filter((order): order is InvoiceOrder => order != null),
    error: null,
  }
}
