// Shapes dashboard_sales_series() rows into the KPI tiles and the two charts.
//
// Pure and timezone-explicit: "today" is a Sydney date string passed in, and
// every date here is a YYYY-MM-DD string -- the same form the SQL buckets come
// back in, so matching a row to a day is string equality, with no Date objects
// drifting across the UTC boundary.

import type { Database } from "@/lib/supabase/database.types"

export type SalesPlatform = Database["public"]["Enums"]["sales_platform"]

export type SeriesRow = {
  bucket: string
  platform: SalesPlatform
  order_count: number
  sales: number
  shipped_count: number
}

/** Chart and breakdown order. Fixed so a platform keeps its colour. */
export const PLATFORM_ORDER = ["shopify", "ebay", "store", "backorder"] as const satisfies readonly SalesPlatform[]

export const BUSINESS_TIME_ZONE = "Australia/Sydney"

const sydneyDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** The calendar date in Sydney at `now`, as YYYY-MM-DD. */
export function sydneyToday(now: number): string {
  return sydneyDateFormatter.format(new Date(now))
}

/** Calendar arithmetic on a YYYY-MM-DD string, done in UTC so DST cannot shift it. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** First day of the month `months` away from the month containing `date`. */
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

// ── KPI tiles ─────────────────────────────────────────────────────────────

export type Kpis = {
  ordersToday: number
  ordersTodayByPlatform: { platform: SalesPlatform; count: number }[]
  shippedToday: number
  /** The 7 days ending today, inclusive. */
  orders7d: number
  /** The 7 days before that, for the comparison. */
  ordersPrev7d: number
  sales7d: number
  salesPrev7d: number
  /** Null when there were no orders in the window. */
  avgOrderValue7d: number | null
}

function sumWhere(rows: SeriesRow[], from: string, to: string, pick: (row: SeriesRow) => number) {
  return rows.reduce((sum, row) => (row.bucket >= from && row.bucket <= to ? sum + pick(row) : sum), 0)
}

export function summariseKpis(dailyRows: SeriesRow[], today: string): Kpis {
  const todayRows = dailyRows.filter((row) => row.bucket === today)
  const weekStart = addDays(today, -6)
  const prevEnd = addDays(today, -7)
  const prevStart = addDays(today, -13)

  const orders7d = sumWhere(dailyRows, weekStart, today, (row) => row.order_count)
  const sales7d = sumWhere(dailyRows, weekStart, today, (row) => row.sales)

  return {
    ordersToday: todayRows.reduce((sum, row) => sum + row.order_count, 0),
    ordersTodayByPlatform: PLATFORM_ORDER.map((platform) => ({
      platform,
      count: todayRows.find((row) => row.platform === platform)?.order_count ?? 0,
    })).filter((part) => part.count > 0),
    shippedToday: todayRows.reduce((sum, row) => sum + row.shipped_count, 0),
    orders7d,
    ordersPrev7d: sumWhere(dailyRows, prevStart, prevEnd, (row) => row.order_count),
    sales7d,
    salesPrev7d: sumWhere(dailyRows, prevStart, prevEnd, (row) => row.sales),
    avgOrderValue7d: orders7d > 0 ? sales7d / orders7d : null,
  }
}

/** Relative change, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / previous
}

// ── Daily orders chart ────────────────────────────────────────────────────

export type DailyPoint = { date: string } & Record<SalesPlatform, number>

export type DailyChart = {
  points: DailyPoint[]
  /** Platforms with at least one order in the window, in PLATFORM_ORDER. */
  platforms: { platform: SalesPlatform; total: number }[]
}

/** One point per day for the `days` days ending today, zero-filled. */
export function buildDailyChart(dailyRows: SeriesRow[], today: string, days: number): DailyChart {
  const start = addDays(today, -(days - 1))
  const points: DailyPoint[] = []
  const byDate = new Map<string, DailyPoint>()

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i)
    const point = { date, shopify: 0, ebay: 0, store: 0, backorder: 0 }
    points.push(point)
    byDate.set(date, point)
  }
  for (const row of dailyRows) {
    const point = byDate.get(row.bucket)
    if (point) point[row.platform] += row.order_count
  }

  const platforms = PLATFORM_ORDER.map((platform) => ({
    platform,
    total: points.reduce((sum, point) => sum + point[platform], 0),
  })).filter((part) => part.total > 0)

  return { points, platforms }
}

// ── Monthly sales chart ───────────────────────────────────────────────────

export type MonthlyPoint = {
  /** First day of the month, YYYY-MM-DD. */
  month: string
  thisYear: number
  lastYear: number
  /** The current month, which is still in progress. */
  partial: boolean
}

/**
 * The 12 months ending with the current one, each beside the same month a year
 * earlier. Expects rows from at least 23 months before the current month.
 */
export function buildMonthlyComparison(monthlyRows: SeriesRow[], today: string): MonthlyPoint[] {
  const salesByMonth = new Map<string, number>()
  for (const row of monthlyRows) {
    salesByMonth.set(row.bucket, (salesByMonth.get(row.bucket) ?? 0) + row.sales)
  }

  const current = addMonths(today, 0)
  return Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(current, i - 11)
    return {
      month,
      thisYear: salesByMonth.get(month) ?? 0,
      lastYear: salesByMonth.get(addMonths(month, -12)) ?? 0,
      partial: month === current,
    }
  })
}
