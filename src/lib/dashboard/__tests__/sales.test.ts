import { describe, expect, it } from "vitest"

import {
  addDays,
  addMonths,
  buildDailyChart,
  buildMonthlyComparison,
  percentChange,
  summariseKpis,
  sydneyToday,
  type SeriesRow,
} from "@/lib/dashboard/sales"

function row(bucket: string, platform: SeriesRow["platform"], orders: number, sales: number, shipped = 0): SeriesRow {
  return { bucket, platform, order_count: orders, sales, shipped_count: shipped }
}

describe("date helpers", () => {
  it("reads today in Sydney, not UTC", () => {
    // 2026-11-18 14:00 UTC is 2026-11-19 01:00 in Sydney (AEDT, +11).
    expect(sydneyToday(Date.UTC(2026, 10, 18, 14, 0))).toBe("2026-11-19")
    expect(sydneyToday(Date.UTC(2026, 10, 18, 12, 0))).toBe("2026-11-18")
  })

  it("crosses month, year and DST boundaries by calendar day", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05") // Sydney DST starts
  })

  it("moves by months to the first of the month", () => {
    expect(addMonths("2026-11-18", 0)).toBe("2026-11-01")
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01")
    expect(addMonths("2026-11-18", -23)).toBe("2024-12-01")
  })
})

describe("summariseKpis", () => {
  const today = "2026-11-18"
  const rows = [
    row("2026-11-18", "shopify", 4, 100, 3),
    row("2026-11-18", "ebay", 2, 50, 1),
    row("2026-11-12", "shopify", 4, 50), // first day of this week
    row("2026-11-11", "ebay", 5, 100), // last day of the previous week
    row("2026-11-05", "ebay", 5, 100), // first day of the previous week
    row("2026-11-04", "ebay", 99, 999), // outside both windows
  ]

  it("splits today by platform in fixed order", () => {
    const kpis = summariseKpis(rows, today)
    expect(kpis.ordersToday).toBe(6)
    expect(kpis.ordersTodayByPlatform).toEqual([
      { platform: "shopify", count: 4 },
      { platform: "ebay", count: 2 },
    ])
    expect(kpis.shippedToday).toBe(4)
  })

  it("compares the 7 days ending today with the 7 before", () => {
    const kpis = summariseKpis(rows, today)
    expect(kpis.orders7d).toBe(10)
    expect(kpis.sales7d).toBe(200)
    expect(kpis.ordersPrev7d).toBe(10)
    expect(kpis.salesPrev7d).toBe(200)
    expect(kpis.avgOrderValue7d).toBe(20)
  })

  it("has no average when nothing was ordered", () => {
    expect(summariseKpis([], today).avgOrderValue7d).toBeNull()
  })
})

describe("percentChange", () => {
  it("returns null without a baseline", () => {
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(15, 10)).toBeCloseTo(0.5)
  })
})

describe("buildDailyChart", () => {
  it("zero-fills every day and lists only platforms that sold", () => {
    const chart = buildDailyChart([row("2026-11-17", "ebay", 3, 30), row("2026-11-01", "ebay", 9, 9)], "2026-11-18", 3)
    expect(chart.points.map((p) => p.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"])
    expect(chart.points[1].ebay).toBe(3)
    expect(chart.points[0].ebay).toBe(0)
    expect(chart.platforms).toEqual([{ platform: "ebay", total: 3 }])
  })
})

describe("buildMonthlyComparison", () => {
  it("pairs each of the last 12 months with the same month a year earlier", () => {
    const points = buildMonthlyComparison(
      [
        row("2026-11-01", "shopify", 1, 100),
        row("2026-11-01", "ebay", 1, 50),
        row("2025-11-01", "ebay", 1, 80),
        row("2025-12-01", "ebay", 1, 70),
      ],
      "2026-11-18"
    )
    expect(points).toHaveLength(12)
    expect(points[0]).toEqual({ month: "2025-12-01", thisYear: 70, lastYear: 0, partial: false })
    expect(points[11]).toEqual({ month: "2026-11-01", thisYear: 150, lastYear: 80, partial: true })
  })
})
