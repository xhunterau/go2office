import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import {
  dateParam,
  enumParam,
  escapeLike,
  flagParam,
  positiveIntParam,
  textParam,
  type SearchParams,
} from "@/lib/queries/search-params"

export const ORDERS_PAGE_SIZE = 20

type OrderStatus = Database["public"]["Enums"]["order_status"]
type SalesPlatform = Database["public"]["Enums"]["sales_platform"]

// Declaration order is the business lifecycle (migration 20260804100000), and
// the enum's sort order. Rendering a dropdown by iterating this comes out in
// the right order, which is why there is no separate ordering constant to drift
// out of sync.
// `as const` rather than `readonly OrderStatus[]` so z.enum can consume it
// directly (src/lib/validations/order.ts) without a cast that would let the two
// lists drift apart.
export const ORDER_STATUSES = [
  "new",
  "pending",
  "unpaid",
  "backorder",
  "processing",
  "picked",
  "labelled",
  "issued",
  "completed",
  "cancelled",
] as const satisfies readonly OrderStatus[]

// Statuses that mean the order is finished. Everything else is a work queue,
// which is what the "Needs action" tab aggregates.
export const TERMINAL_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly OrderStatus[]

export const SALES_PLATFORMS = [
  "ebay",
  "shopify",
  "backorder",
  "store",
] as const satisfies readonly SalesPlatform[]

// The five search dimensions (docs/orders-ui.md section 5.2). One dimension is
// searched at a time: their target columns, match semantics and resolution
// paths all differ, so a single box would mean running five queries per
// keystroke and guessing which one the user meant.
export const SEARCH_FIELDS = [
  "invoice",
  "tracking",
  "customer",
  "location",
  "sku",
] as const

export type SearchField = (typeof SEARCH_FIELDS)[number]

// "Needs action" is not a status, it is `status NOT IN (completed, cancelled)`.
// It is the only tab that keeps working when the enum gains a value.
export const NEEDS_ACTION = "needs_action"

export type StatusTab = OrderStatus | typeof NEEDS_ACTION | null

export type OrderFilters = {
  status: StatusTab
  platform: SalesPlatform | null
  notDispatched: boolean
  createdFrom: string | null
  createdTo: string | null
  searchField: SearchField
  searchTerm: string | null
  page: number
}

export function parseOrderFilters(params: SearchParams): OrderFilters {
  const statusRaw = textParam(params, "status")
  const status: StatusTab =
    statusRaw === NEEDS_ACTION
      ? NEEDS_ACTION
      : enumParam(params, "status", ORDER_STATUSES)

  return {
    status,
    platform: enumParam(params, "platform", SALES_PLATFORMS),
    notDispatched: flagParam(params, "notDispatched"),
    createdFrom: dateParam(params, "from"),
    createdTo: dateParam(params, "to"),
    searchField: enumParam(params, "field", SEARCH_FIELDS) ?? "invoice",
    searchTerm: textParam(params, "q"),
    page: positiveIntParam(params, "page") ?? 1,
  }
}

// Columns the list table renders. The customer is embedded rather than joined
// through a flattened view: orders.customer_id is indexed and 20 rows of nested
// select costs less than a view that has to be kept in sync by hand (rule 18).
const LIST_COLUMNS = `
  id,
  invoice_number,
  status,
  platform,
  shipping_method,
  legacy_shipping_method,
  postage_and_handling,
  tracking_number,
  posted_on_date,
  created_at,
  customer_id,
  customers(id, full_name, platform_user_id, email)
`

// Same columns, but the customer embed becomes an inner join so a filter on a
// customer column can be pushed down. Written out rather than string-patched:
// `!inner` changes the row semantics, and that should be visible at the call
// site rather than hidden in a replace().
const LIST_COLUMNS_CUSTOMER_INNER = LIST_COLUMNS.replace(
  "customers(",
  "customers!inner("
)

type EmbeddedCustomer = {
  id: number
  full_name: string | null
  platform_user_id: string | null
  email: string | null
}

export type OrderListRow = {
  id: number
  invoice_number: string
  status: OrderStatus
  platform: SalesPlatform
  shipping_method: Database["public"]["Enums"]["shipping_method"] | null
  legacy_shipping_method: string | null
  postage_and_handling: number
  tracking_number: string | null
  posted_on_date: string | null
  created_at: string
  customer_id: number
  customers: EmbeddedCustomer | null
  // Filled in by a second query against order_totals, keyed on this page's ids.
  // Zero for the 25 orders that have no transaction lines at all.
  goods_total: number
  order_total: number
  transaction_count: number
}

export type OrderListResult = {
  rows: OrderListRow[]
  count: number
  // True when `count` is a planner estimate rather than a tally. Drives the
  // "about N" wording in the pagination bar.
  isEstimate: boolean
  error: string | null
  // Set when a SKU search found no such product, which is a different answer
  // from "that product has never sold" and has to read differently on screen.
  unknownSku: boolean
}

const EMPTY: Omit<OrderListResult, "error"> = {
  rows: [],
  count: 0,
  isEstimate: false,
  unknownSku: false,
}

export async function fetchOrderList(
  supabase: SupabaseClient<Database>,
  filters: OrderFilters,
  // Restricts the list to one customer, for the order history on
  // /customers/[id]. Passed in rather than living on OrderFilters because it
  // comes from the route, not from a control the user can change.
  customerId?: number
): Promise<OrderListResult> {
  const term = filters.searchTerm
  const searchingCustomer =
    term !== null &&
    (filters.searchField === "customer" || filters.searchField === "location")

  // The SKU dimension is the only one that cannot be expressed as a filter on
  // this query alone: orders -> order_transactions -> order_items is two hops.
  // The SKU is resolved to a product_id first, against the unique index on
  // products.sku, so the second hop is an equality on an indexed column.
  let skuProductId: number | null = null
  if (term !== null && filters.searchField === "sku") {
    const { data, error } = await supabase
      .from("products")
      .select("id")
      .eq("sku", term)
      .maybeSingle()

    if (error) return { ...EMPTY, error: error.message }
    // No such SKU at all. Reported separately from an empty result so the page
    // can say "no product matches this SKU" instead of implying the product
    // exists but has never sold.
    if (!data) return { ...EMPTY, unknownSku: true, error: null }
    skuProductId = data.id
  }

  // count: "estimated" rather than the exact count the products and inventory
  // lists use. Exact counting means a full COUNT(*) over 203315 rows on every
  // page change; estimated reads pg_class.reltuples and falls back to an exact
  // tally once a filter narrows the result below PostgREST's threshold.
  //
  // The estimate is only as good as the last ANALYZE. Migration 20260808100000
  // runs one; if the list ever starts reporting a number that is obviously
  // wrong, check pg_stat_user_tables.last_autoanalyze before suspecting this
  // code.
  // The select clause is decided before the query is built, not patched onto it
  // afterwards: which embeds are present changes the row semantics (`!inner` is
  // a join, not a projection), and supabase-js gives no reliable way to replace
  // a select once filters are attached.
  const selectClause = searchingCustomer
    ? LIST_COLUMNS_CUSTOMER_INNER
    : skuProductId !== null
      ? `${LIST_COLUMNS}, order_transactions!inner(order_items!inner(product_id))`
      : LIST_COLUMNS

  let query = supabase
    .from("orders")
    .select(selectClause, { count: "estimated" })
    .order("created_at", { ascending: false })
    // created_at is a date in practice (the legacy system stored no time), so
    // it ties constantly. Without a tiebreaker the same order can appear on two
    // pages and another on neither.
    .order("id", { ascending: false })

  if (customerId !== undefined) query = query.eq("customer_id", customerId)

  if (filters.status === NEEDS_ACTION) {
    query = query.not(
      "status",
      "in",
      `(${TERMINAL_STATUSES.join(",")})`
    )
  } else if (filters.status !== null) {
    query = query.eq("status", filters.status)
  }

  if (filters.platform) query = query.eq("platform", filters.platform)

  // Independent of status on purpose: 4497 completed orders were never
  // dispatched and 113 cancelled ones were, so no status filter finds this set
  // (docs/orders-ui.md section 4.2.1).
  if (filters.notDispatched) query = query.is("posted_on_date", null)

  if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom)
  // Inclusive of the end date: a date input means the whole day, and
  // created_at carries a time component.
  if (filters.createdTo) query = query.lt("created_at", nextDay(filters.createdTo))

  if (term !== null) {
    const like = `%${escapeLike(term)}%`
    switch (filters.searchField) {
      case "invoice":
        query = query.ilike("invoice_number", like)
        break
      case "tracking":
        query = query.ilike("tracking_number", like)
        break
      case "customer":
        // Any of the three ways a customer is identified. PostgREST `or` on an
        // embedded resource needs the table named via referencedTable.
        query = query.or(
          `full_name.ilike.${like},email.ilike.${like},platform_user_id.ilike.${like}`,
          { referencedTable: "customers" }
        )
        break
      case "location":
        // "Suburb" in the UI is customers.city in the database -- the fourth
        // review round moved the address off orders using generic naming, so
        // the Australian suburb lives in `city`. See docs/orders-ui.md 4.1.
        //
        // Suburb is matched loosely and postcode by prefix, in one query,
        // because a user typing "30" could mean either and the two indexes
        // (GIN trigram on city, btree text_pattern_ops on postcode) support
        // exactly these two shapes.
        query = query.or(
          `city.ilike.${like},postcode.like.${escapeLike(term)}%`,
          { referencedTable: "customers" }
        )
        break
      case "sku":
        // The two `!inner` embeds are already in selectClause; this pushes the
        // product_id equality down to order_items while pagination stays on
        // orders. Measured at 19 ms for the SKU with the most orders (7100) --
        // but only with fresh planner statistics; see docs/orders-ui.md 5.3.
        query = query.eq(
          "order_transactions.order_items.product_id",
          skuProductId as number
        )
        break
    }
  }

  const from = (filters.page - 1) * ORDERS_PAGE_SIZE
  const to = from + ORDERS_PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)
  if (error) return { ...EMPTY, error: error.message }

  const page = (data ?? []) as unknown as Omit<
    OrderListRow,
    "goods_total" | "order_total" | "transaction_count"
  >[]

  const total = count ?? 0
  // PostgREST returns the exact tally once the estimate drops below its
  // threshold, so anything at or under one page is known to be exact.
  const isEstimate = total > page.length

  if (page.length === 0) {
    return { rows: [], count: total, isEstimate, error: null, unknownSku: false }
  }

  // Totals for this page only. order_totals aggregates all 250413 transaction
  // rows every time it is referenced, so joining it into the query above would
  // compute 203315 totals to display 20 (migration 20260803160000 says so in
  // as many words).
  const { data: totals, error: totalsError } = await supabase
    .from("order_totals")
    .select("order_id, goods_total, order_total, transaction_count")
    .in(
      "order_id",
      page.map((row) => row.id)
    )

  if (totalsError) return { ...EMPTY, error: totalsError.message }

  const byOrder = new Map(totals?.map((t) => [t.order_id, t]) ?? [])

  return {
    rows: page.map((row) => {
      const t = byOrder.get(row.id)
      return {
        ...row,
        goods_total: t?.goods_total ?? 0,
        order_total: t?.order_total ?? 0,
        transaction_count: t?.transaction_count ?? 0,
      }
    }),
    count: total,
    isEstimate,
    error: null,
    unknownSku: false,
  }
}

export type OrderStatusCounts = {
  // Every status in the enum, including those at zero.
  byStatus: Record<OrderStatus, number>
  needsAction: number
  total: number
}

// Counts for the status tabs, in one query.
//
// Not `select("status, count()")`: PostgREST top-level aggregates are disabled
// on this project and that returns PGRST123. The order_status_counts view
// (migration 20260808100000) exists for this. Unlike order_totals it is safe to
// query directly -- one index-only scan, once per page load.
export async function fetchOrderStatusCounts(
  supabase: SupabaseClient<Database>
): Promise<{ counts: OrderStatusCounts | null; error: string | null }> {
  const { data, error } = await supabase
    .from("order_status_counts")
    .select("status, order_count")

  if (error) return { counts: null, error: error.message }

  // Seed from the enum, not from the rows: the view omits statuses with no
  // orders, and six of the ten currently have none. Tabs for empty queues still
  // have to render, or the queue becomes invisible the moment it matters.
  const byStatus = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0])
  ) as Record<OrderStatus, number>

  for (const row of data ?? []) byStatus[row.status] = Number(row.order_count)

  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
  const terminal = TERMINAL_STATUSES.reduce((sum, s) => sum + byStatus[s], 0)

  return { counts: { byStatus, needsAction: total - terminal, total }, error: null }
}

const DETAIL_COLUMNS = `
  id,
  invoice_number,
  status,
  platform,
  shipping_method,
  legacy_shipping_method,
  postage_and_handling,
  tracking_number,
  web_order_id,
  comments,
  posted_on_date,
  created_at,
  customer_id,
  customers(
    id, platform_user_id, full_name, email, phone, is_anonymised_email,
    company_name, address_line1, address_line2, address_line3, address_line4,
    city, state, postcode, country
  )
`

export type OrderDetailCustomer = Pick<
  Database["public"]["Tables"]["customers"]["Row"],
  | "id"
  | "platform_user_id"
  | "full_name"
  | "email"
  | "phone"
  | "is_anonymised_email"
  | "company_name"
  | "address_line1"
  | "address_line2"
  | "address_line3"
  | "address_line4"
  | "city"
  | "state"
  | "postcode"
  | "country"
>

export type OrderDetail = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "invoice_number"
  | "status"
  | "platform"
  | "shipping_method"
  | "legacy_shipping_method"
  | "postage_and_handling"
  | "tracking_number"
  | "web_order_id"
  | "comments"
  | "posted_on_date"
  | "created_at"
  | "customer_id"
> & {
  customers: OrderDetailCustomer | null
  goods_total: number
  order_total: number
  transaction_count: number
}

export async function fetchOrderDetail(
  supabase: SupabaseClient<Database>,
  id: number
): Promise<{ order: OrderDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error) return { order: null, error: error.message }
  if (!data) return { order: null, error: null }

  const { data: totals, error: totalsError } = await supabase
    .from("order_totals")
    .select("goods_total, order_total, transaction_count")
    .eq("order_id", id)
    .maybeSingle()

  if (totalsError) return { order: null, error: totalsError.message }

  return {
    order: {
      ...(data as unknown as Omit<
        OrderDetail,
        "goods_total" | "order_total" | "transaction_count"
      >),
      // The 25 orders with no transaction lines get no row back from the view's
      // LEFT JOIN side; they render at zero rather than blank.
      goods_total: totals?.goods_total ?? 0,
      order_total: totals?.order_total ?? 0,
      transaction_count: totals?.transaction_count ?? 0,
    },
    error: null,
  }
}

// One picked line: what the warehouse actually took off a shelf.
export type OrderPickedItem = {
  id: number
  product_id: number | null
  sku_snapshot: string | null
  quantity: number
  location_id: number | null
  location_name: string | null
  // false means the row is a real historical record (all 250687 migrated rows
  // are), true means the trigger derived it from the current BOM.
  is_auto_generated: boolean
  product_name: string | null
}

// One transaction: what the platform sold. A kit sells as a single line here
// and expands into several picked items -- the two are different facts, not two
// spellings of the same one, which is why the page shows both levels.
export type OrderTransaction = {
  id: number
  item_title: string | null
  item_number: string | null
  custom_label: string | null
  quantity: number
  sale_price: number
  sale_date: string
  postage_service: string | null
  order_id_ebay: string | null
  transaction_id_ebay: string | null
  items: OrderPickedItem[]
  // Any picked line whose SKU could not be resolved. Surfaced on the parent row
  // because the expansion is collapsed by default -- marking it only inside the
  // expanded area would make 313 unresolved lines invisible in practice.
  hasUnresolved: boolean
}

// Both levels in one round trip. A kit expands into a handful of components
// (250687 items across 250413 transactions is 1.2 lines each), so lazy-loading
// the expansion the way /inventory does would buy nothing.
export async function fetchOrderTransactionsWithItems(
  supabase: SupabaseClient<Database>,
  orderId: number
): Promise<{ transactions: OrderTransaction[]; error: string | null }> {
  const { data, error } = await supabase
    .from("order_transactions")
    .select(
      `id, item_title, item_number, custom_label, quantity, sale_price,
       sale_date, postage_service, order_id_ebay, transaction_id_ebay,
       order_items(
         id, product_id, sku_snapshot, quantity, location_id, is_auto_generated,
         products(name), locations(name)
       )`
    )
    .eq("order_id", orderId)
    .order("id", { ascending: true })

  if (error) return { transactions: [], error: error.message }

  type Raw = Omit<OrderTransaction, "items" | "hasUnresolved"> & {
    order_items: {
      id: number
      product_id: number | null
      sku_snapshot: string | null
      quantity: number
      location_id: number | null
      is_auto_generated: boolean
      products: { name: string | null } | null
      locations: { name: string } | null
    }[]
  }

  const transactions = ((data ?? []) as unknown as Raw[]).map((t) => {
    const items: OrderPickedItem[] = t.order_items
      .map((item) => ({
        id: item.id,
        product_id: item.product_id,
        sku_snapshot: item.sku_snapshot,
        quantity: item.quantity,
        location_id: item.location_id,
        location_name: item.locations?.name ?? null,
        is_auto_generated: item.is_auto_generated,
        product_name: item.products?.name ?? null,
      }))
      .sort((a, b) => (a.sku_snapshot ?? "").localeCompare(b.sku_snapshot ?? ""))

    return {
      id: t.id,
      item_title: t.item_title,
      item_number: t.item_number,
      custom_label: t.custom_label,
      quantity: t.quantity,
      sale_price: t.sale_price,
      sale_date: t.sale_date,
      postage_service: t.postage_service,
      order_id_ebay: t.order_id_ebay,
      transaction_id_ebay: t.transaction_id_ebay,
      items,
      hasUnresolved: items.some((item) => item.product_id === null),
    }
  })

  return { transactions, error: null }
}

// The end of an inclusive date filter, as the exclusive upper bound a timestamp
// comparison needs.
function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
