import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import {
  escapeLike,
  flagParam,
  positiveIntParam,
  textParam,
  type SearchParams,
} from "@/lib/queries/search-params"

export const CUSTOMERS_PAGE_SIZE = 20

export type CustomerFilters = {
  // Matched against full_name, email and platform_user_id together.
  name: string | null
  // "Suburb" on screen. See the note in parseCustomerFilters.
  suburb: string | null
  postcode: string | null
  hasOrders: boolean
  page: number
}

// NOTE ON `suburb`: there is no suburb column. The fourth review round moved the
// address from orders onto customers using generic naming (city / state /
// postcode / country), so the Australian suburb is stored in `customers.city`.
// The decision was to change the label, not the column -- renaming would mean
// touching scripts/migration/004_orders_data.sql and migration 20260803170000
// under CLAUDE.md rule 15, for the sake of one word.
//
// This function is the one place that mismatch is visible, so it is written
// down here: the UI says Suburb, the query reads city.
//
// These addresses were migrated verbatim and never normalised -- `NSW` and
// `New South Wales` both occur, and suburbs vary in case and spelling. Suburb
// matching is therefore fuzzy and case-insensitive, never an equality.
export function parseCustomerFilters(params: SearchParams): CustomerFilters {
  return {
    name: textParam(params, "q"),
    suburb: textParam(params, "suburb"),
    postcode: textParam(params, "postcode"),
    hasOrders: flagParam(params, "hasOrders"),
    page: positiveIntParam(params, "page") ?? 1,
  }
}

export type CustomerListRow = Pick<
  Database["public"]["Tables"]["customers"]["Row"],
  | "id"
  | "platform_user_id"
  | "full_name"
  | "email"
  | "is_anonymised_email"
  | "city"
  | "state"
  | "postcode"
> & {
  order_count: number
}

// The embedded `orders(count)` aggregate. This is the to-many count PostgREST
// has always supported (the same shape /locations uses for product_count), not
// the top-level `count()` aggregate that is disabled on this project -- see
// docs/orders-ui.md section 3.4.
const LIST_COLUMNS = `
  id,
  platform_user_id,
  full_name,
  email,
  is_anonymised_email,
  city,
  state,
  postcode,
  orders(count)
`

const LIST_COLUMNS_ORDERS_INNER = LIST_COLUMNS.replace("orders(", "orders!inner(")

export type CustomerListResult = {
  rows: CustomerListRow[]
  count: number
  isEstimate: boolean
  error: string | null
}

export async function fetchCustomerList(
  supabase: SupabaseClient<Database>,
  filters: CustomerFilters
): Promise<CustomerListResult> {
  // Estimated for the same reason as the order list: 178024 rows is too many to
  // tally on every page change. See fetchOrderList for the ANALYZE caveat.
  let query = supabase
    .from("customers")
    // `hasOrders` becomes an inner join on the count embed, which is a
    // semi-join in the database rather than a filter applied after the fact.
    // 1790 customers have no orders at all.
    .select(filters.hasOrders ? LIST_COLUMNS_ORDERS_INNER : LIST_COLUMNS, {
      count: "estimated",
    })
    .order("id", { ascending: false })

  if (filters.name) {
    const like = `%${escapeLike(filters.name)}%`
    query = query.or(
      `full_name.ilike.${like},email.ilike.${like},platform_user_id.ilike.${like}`
    )
  }
  if (filters.suburb) query = query.ilike("city", `%${escapeLike(filters.suburb)}%`)
  // Prefix, not contains: postcodes are four digits and the btree index built
  // for them (text_pattern_ops) only serves `LIKE 'x%'`.
  if (filters.postcode) query = query.like("postcode", `${escapeLike(filters.postcode)}%`)

  const from = (filters.page - 1) * CUSTOMERS_PAGE_SIZE
  const to = from + CUSTOMERS_PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)
  if (error) return { rows: [], count: 0, isEstimate: false, error: error.message }

  type Raw = Omit<CustomerListRow, "order_count"> & {
    orders: { count: number }[]
  }

  const rows = ((data ?? []) as unknown as Raw[]).map(({ orders, ...rest }) => ({
    ...rest,
    order_count: orders?.[0]?.count ?? 0,
  }))

  const total = count ?? 0
  return { rows, count: total, isEstimate: total > rows.length, error: null }
}

export type CustomerDetail = Database["public"]["Tables"]["customers"]["Row"] & {
  order_count: number
}

export async function fetchCustomerDetail(
  supabase: SupabaseClient<Database>,
  id: number
): Promise<{ customer: CustomerDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .select("*, orders(count)")
    .eq("id", id)
    .maybeSingle()

  if (error) return { customer: null, error: error.message }
  if (!data) return { customer: null, error: null }

  const { orders, ...rest } = data as typeof data & { orders: { count: number }[] }

  return {
    customer: {
      ...(rest as Database["public"]["Tables"]["customers"]["Row"]),
      order_count: orders?.[0]?.count ?? 0,
    },
    error: null,
  }
}

// How many orders a customer has, for the delete-blocked message. Read on demand
// rather than carried around: the message is only ever built after a 23503, and
// orders.customer_id is ON DELETE RESTRICT so most deletes hit it.
export async function countCustomerOrders(
  supabase: SupabaseClient<Database>,
  customerId: number
): Promise<number> {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)

  return count ?? 0
}
