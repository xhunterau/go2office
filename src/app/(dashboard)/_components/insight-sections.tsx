import { createClient } from "@/lib/supabase/server"
import {
  fetchLowStock,
  loadSalesOverview,
  DAILY_CHART_DAYS,
  LOW_STOCK_COVER_DAYS,
  LOW_STOCK_WINDOW_DAYS,
} from "@/lib/queries/dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { DailyOrdersChart } from "./daily-orders-chart"
import { KpiTiles } from "./kpi-tiles"
import { LowStockTable } from "./low-stock-table"
import { MonthlySalesChart } from "./monthly-sales-chart"

// The slower half of the dashboard. Each section is its own async component so
// the page can stream it behind a Suspense boundary instead of holding the work
// queues back for an aggregate over order lines.

function LoadError({ what, message }: { what: string; message: string }) {
  return (
    <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
      Could not load {what}: {message}
    </p>
  )
}

export async function SalesSection() {
  const supabase = await createClient()
  const overview = await loadSalesOverview(supabase)
  if (!overview.data) return <LoadError what="sales figures" message={overview.error ?? "unknown error"} />

  return (
    <div className="flex flex-col gap-3">
      <KpiTiles kpis={overview.data.kpis} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders per day · last {DAILY_CHART_DAYS} days</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyOrdersChart chart={overview.data.daily} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monthly sales · year on year</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlySalesChart points={overview.data.monthly} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export async function LowStockSection() {
  const supabase = await createClient()
  const lowStock = await fetchLowStock(supabase)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Running low</CardTitle>
      </CardHeader>
      <CardContent>
        {lowStock.data ? (
          <LowStockTable
            items={lowStock.data.items}
            total={lowStock.data.total}
            windowDays={LOW_STOCK_WINDOW_DAYS}
            coverDays={LOW_STOCK_COVER_DAYS}
          />
        ) : (
          <LoadError what="stock levels" message={lowStock.error ?? "unknown error"} />
        )}
      </CardContent>
    </Card>
  )
}

export function SalesSectionSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}

export function LowStockSkeleton() {
  return <Skeleton className="h-96 rounded-xl" />
}
