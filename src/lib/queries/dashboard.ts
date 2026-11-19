import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import type { Loaded } from "@/lib/queries/shipping-reference"
import { fetchAllocationQueueStat, type QueueStat } from "@/lib/queries/allocation"
import { fetchEbayAuthorization } from "@/lib/queries/ebay-authorization"
import { countDispatchableOrders } from "@/lib/queries/fulfillment"
import {
  fetchOrderStatusCounts,
  NEEDS_ACTION_EXCLUDED,
  ORDER_STATUSES,
} from "@/lib/queries/orders"
import { fetchFailedSyncOrders } from "@/lib/queries/platform-fulfillment"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import { requireFallbacks } from "@/lib/fulfillment/types"
import {
  ARAMEX_METHODS,
  EPARCEL_METHODS,
  MYPOST_METHODS,
  SELF_PRINT_METHODS,
} from "@/lib/fulfillment/carrier-groups"
import {
  buildAlerts,
  STALE_SYNC_MS,
  type DashboardAlert,
  type OrderRef,
} from "@/lib/dashboard/alerts"
import {
  addDays,
  addMonths,
  buildDailyChart,
  buildMonthlyComparison,
  summariseKpis,
  sydneyToday,
  type DailyChart,
  type Kpis,
  type MonthlyPoint,
  type SeriesRow,
} from "@/lib/dashboard/sales"

// Everything the dashboard shows, gathered in one parallel round. Each figure
// is a count or a handful of rows behind an index, so the page is a dozen small
// queries rather than anything that scans the 200k-order history.

type Client = SupabaseClient<Database>
type OrderStatus = Database["public"]["Enums"]["order_status"]

const DAY_MS = 24 * 60 * 60 * 1000

/** issued / unpaid / backorder: the /orders "Needs action" tab, from its own list. */
const NEEDS_ACTION_STATUSES = ORDER_STATUSES.filter(
  (status) => !(NEEDS_ACTION_EXCLUDED as readonly OrderStatus[]).includes(status)
)

/** Statuses an order passes through before dispatch, where a bad item line still matters. */
const OPEN_STATUSES = ["pending", "processing", "labelled"] as const satisfies readonly OrderStatus[]

const SAMPLE_SIZE = 5
const ACTIVITY_LIMIT = 15

export type QueueKey = "address" | "postage" | "labels" | "dispatch" | "needs-action"

export type DashboardQueue = {
  key: QueueKey
  count: number
  /** Whole days since the oldest order in the queue was created; null when empty. */
  oldestAgeDays: number | null
  breakdown?: { label: string; count: number }[]
}

export type ActivityEntry = {
  id: number
  orderId: number
  invoiceNumber: string | null
  action: string
  actor: "you" | "staff" | "system"
  createdAt: string
}

export type Dashboard = {
  queues: DashboardQueue[]
  alerts: DashboardAlert[]
  activity: ActivityEntry[]
}

function ageDays(createdAt: string | null, now: number): number | null {
  if (!createdAt) return null
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / DAY_MS))
}

async function fetchStatusQueueStat(
  client: Client,
  statuses: readonly OrderStatus[]
): Promise<{ data: QueueStat | null; error: string | null }> {
  const { data, count, error } = await client
    .from("orders")
    .select("created_at", { count: "exact" })
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(1)
  if (error) return { data: null, error: error.message }
  return { data: { count: count ?? 0, oldestCreatedAt: data?.[0]?.created_at ?? null }, error: null }
}

async function countStalePendingSyncs(client: Client, now: number) {
  const { count, error } = await client
    .from("platform_fulfillment_syncs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", new Date(now - STALE_SYNC_MS).toISOString())
  return { count: count ?? 0, error: error?.message ?? null }
}

async function countRemeasureProducts(client: Client) {
  const { count, error } = await client
    .from("products")
    .select("id", { count: "exact", head: true })
    .not("remeasure_requested_at", "is", null)
  return { count: count ?? 0, error: error?.message ?? null }
}

async function fetchUnresolvedOpenOrders(client: Client) {
  const { data, count, error } = await client
    .from("order_metrics_summary")
    .select("order_id, orders!inner (invoice_number, status)", { count: "exact" })
    .gt("unresolved_item_count", 0)
    .in("orders.status", OPEN_STATUSES)
    .order("order_id", { ascending: true })
    .limit(SAMPLE_SIZE)
  if (error) return { total: 0, sample: [] as OrderRef[], error: error.message }
  return {
    total: count ?? 0,
    sample: (data ?? []).map((row) => ({
      id: row.order_id,
      invoiceNumber: row.orders.invoice_number,
    })),
    error: null,
  }
}

async function fetchRecentActivity(client: Client, userId: string | null) {
  const { data, error } = await client
    .from("order_logs")
    .select("id, order_id, action, user_id, created_at, orders (invoice_number)")
    .order("id", { ascending: false })
    .limit(ACTIVITY_LIMIT)
  if (error) return { entries: [] as ActivityEntry[], error: error.message }

  // There is no staff directory to name other users by; the session only knows
  // who "you" are, so everyone else is "staff" and a null actor is a task.
  return {
    entries: (data ?? []).map(
      (row): ActivityEntry => ({
        id: row.id,
        orderId: row.order_id,
        invoiceNumber: row.orders?.invoice_number ?? null,
        action: row.action,
        actor: row.user_id === null ? "system" : row.user_id === userId ? "you" : "staff",
        createdAt: row.created_at,
      })
    ),
    error: null,
  }
}

export async function loadDashboard(client: Client, now: number = Date.now()): Promise<Dashboard> {
  const {
    data: { user },
  } = await client.auth.getUser()

  const [
    address,
    postage,
    processing,
    labelled,
    needsAction,
    selfPrint,
    myPost,
    eParcel,
    aramex,
    statusCounts,
    failedSyncs,
    staleSyncs,
    ebay,
    settings,
    unresolved,
    remeasure,
    activity,
  ] = await Promise.all([
    fetchAllocationQueueStat(client, false),
    fetchAllocationQueueStat(client, true),
    fetchStatusQueueStat(client, ["processing"]),
    fetchStatusQueueStat(client, ["labelled"]),
    fetchStatusQueueStat(client, NEEDS_ACTION_STATUSES),
    countDispatchableOrders(client, SELF_PRINT_METHODS),
    countDispatchableOrders(client, MYPOST_METHODS),
    countDispatchableOrders(client, EPARCEL_METHODS),
    countDispatchableOrders(client, ARAMEX_METHODS),
    fetchOrderStatusCounts(client),
    fetchFailedSyncOrders(client, SAMPLE_SIZE),
    countStalePendingSyncs(client, now),
    fetchEbayAuthorization(client, now),
    fetchShippingSettings(client),
    fetchUnresolvedOpenOrders(client),
    countRemeasureProducts(client),
    fetchRecentActivity(client, user?.id ?? null),
  ])

  const loadErrors = [
    address.error,
    postage.error,
    processing.error,
    labelled.error,
    needsAction.error,
    selfPrint.error,
    myPost.error,
    eParcel.error,
    aramex.error,
    statusCounts.error,
    failedSyncs.error,
    staleSyncs.error,
    settings.error,
    unresolved.error,
    remeasure.error,
    activity.error,
  ].filter((message): message is string => message != null)

  const channels = [
    { label: "Self-print", count: selfPrint.data ?? 0 },
    { label: "MyPost", count: myPost.data ?? 0 },
    { label: "eParcel", count: eParcel.data ?? 0 },
    { label: "Aramex", count: aramex.data ?? 0 },
  ]
  const processingCount = processing.data?.count ?? 0
  const channelTotal = channels.reduce((sum, channel) => sum + channel.count, 0)
  // Only meaningful when every count loaded; a failed channel query would
  // otherwise read as that many orders with no channel.
  const channelsLoaded = [selfPrint, myPost, eParcel, aramex, processing].every((r) => r.error == null)
  const unroutedProcessing = channelsLoaded ? Math.max(0, processingCount - channelTotal) : 0

  const pendingTotal = statusCounts.counts?.byStatus.pending ?? 0
  const allocationTotal = (address.data?.count ?? 0) + (postage.data?.count ?? 0)
  const nonAuPending =
    statusCounts.counts && address.data && postage.data ? Math.max(0, pendingTotal - allocationTotal) : 0

  const fallbackError = settings.data ? requireFallbacks(settings.data).error : null

  const queue = (
    key: QueueKey,
    stat: QueueStat | null,
    breakdown?: DashboardQueue["breakdown"]
  ): DashboardQueue => ({
    key,
    count: stat?.count ?? 0,
    oldestAgeDays: ageDays(stat?.oldestCreatedAt ?? null, now),
    breakdown,
  })

  return {
    queues: [
      queue("address", address.data),
      queue("postage", postage.data),
      queue("labels", processing.data, channels.filter((channel) => channel.count > 0)),
      queue("dispatch", labelled.data),
      queue("needs-action", needsAction.data),
    ],
    alerts: buildAlerts({
      failedSyncs: failedSyncs.total,
      failedSyncOrders: failedSyncs.orders.map((order) => ({
        id: order.order_id,
        invoiceNumber: order.invoice_number,
      })),
      stalePendingSyncs: staleSyncs.count,
      ebayWarning: ebay.warning,
      ebayBlocked: ebay.blocked,
      fallbackError,
      nonAuPending,
      unroutedProcessing,
      unresolvedOrders: unresolved.total,
      unresolvedSample: unresolved.sample,
      remeasureProducts: remeasure.count,
      loadErrors,
    }),
    activity: activity.entries,
  }
}

// ── Phase 2: sales and stock ───────────────────────────────────────────────
//
// Loaded separately from loadDashboard() so the page can stream them: these
// two aggregate over order lines and take a few hundred milliseconds, which the
// queue counts above should not wait for.

/** Days of history behind the daily chart; also covers the 7-vs-7 comparison. */
export const DAILY_CHART_DAYS = 30

export const LOW_STOCK_WINDOW_DAYS = 30
export const LOW_STOCK_COVER_DAYS = 14
const LOW_STOCK_LIMIT = 10

export type SalesOverview = {
  today: string
  kpis: Kpis
  daily: DailyChart
  monthly: MonthlyPoint[]
}

function toSeriesRows(
  rows: Database["public"]["Functions"]["dashboard_sales_series"]["Returns"] | null
): SeriesRow[] {
  // numeric and bigint arrive as JSON numbers, but Number() costs nothing and
  // keeps a string from ever being summed by concatenation.
  return (rows ?? []).map((row) => ({
    bucket: row.bucket,
    platform: row.platform,
    order_count: Number(row.order_count),
    sales: Number(row.sales),
    shipped_count: Number(row.shipped_count),
  }))
}

export async function loadSalesOverview(
  client: Client,
  now: number = Date.now()
): Promise<Loaded<SalesOverview>> {
  const today = sydneyToday(now)

  const [daily, monthly] = await Promise.all([
    client.rpc("dashboard_sales_series", {
      p_grain: "day",
      p_from: addDays(today, -(DAILY_CHART_DAYS - 1)),
    }),
    client.rpc("dashboard_sales_series", { p_grain: "month", p_from: addMonths(today, -23) }),
  ])

  const error = daily.error ?? monthly.error
  if (error) return { data: null, error: error.message }

  const dailyRows = toSeriesRows(daily.data)
  return {
    data: {
      today,
      kpis: summariseKpis(dailyRows, today),
      daily: buildDailyChart(dailyRows, today, DAILY_CHART_DAYS),
      monthly: buildMonthlyComparison(toSeriesRows(monthly.data), today),
    },
    error: null,
  }
}

export type LowStockItem = {
  productId: number
  sku: string
  name: string | null
  imageUrl: string | null
  onHand: number
  soldQty: number
  daysOfCover: number
}

export async function fetchLowStock(
  client: Client
): Promise<Loaded<{ items: LowStockItem[]; total: number }>> {
  const { data, error } = await client.rpc("dashboard_low_stock", {
    p_window_days: LOW_STOCK_WINDOW_DAYS,
    p_cover_days: LOW_STOCK_COVER_DAYS,
    p_limit: LOW_STOCK_LIMIT,
  })
  if (error) return { data: null, error: error.message }

  const rows = data ?? []

  // Photos fetched by id rather than returned by the function: at most
  // LOW_STOCK_LIMIT rows by primary key, and it keeps the SQL to the arithmetic.
  const images = new Map<number, string | null>()
  if (rows.length > 0) {
    const { data: products, error: imageError } = await client
      .from("products")
      .select("id, image_url")
      .in(
        "id",
        rows.map((row) => row.product_id)
      )
    // A missing photo is a placeholder, not a reason to lose the list.
    if (!imageError) for (const product of products ?? []) images.set(product.id, product.image_url)
  }

  return {
    data: {
      items: rows.map((row) => ({
        productId: row.product_id,
        sku: row.sku,
        name: row.name,
        imageUrl: images.get(row.product_id) ?? null,
        onHand: Number(row.on_hand),
        soldQty: Number(row.sold_qty),
        daysOfCover: Number(row.days_of_cover),
      })),
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    },
    error: null,
  }
}
