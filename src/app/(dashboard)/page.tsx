import { Suspense } from "react"

import { createClient } from "@/lib/supabase/server"
import { loadDashboard } from "@/lib/queries/dashboard"

import { HealthPanel } from "./_components/health-panel"
import {
  LowStockSection,
  LowStockSkeleton,
  SalesSection,
  SalesSectionSkeleton,
} from "./_components/insight-sections"
import { QueueCards } from "./_components/queue-cards"
import { RecentActivity } from "./_components/recent-activity"
import { RefreshButton } from "./_components/refresh-button"

export default async function DashboardPage() {
  const supabase = await createClient()
  const dashboard = await loadDashboard(supabase)

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            What is waiting at each step from allocation to dispatch, anything that needs attention, and how
            sales are tracking.
          </p>
        </div>
        <RefreshButton />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Work queues</h2>
        <QueueCards queues={dashboard.queues} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Health</h2>
        <HealthPanel alerts={dashboard.alerts} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Sales</h2>
        <Suspense fallback={<SalesSectionSkeleton />}>
          <SalesSection />
        </Suspense>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Suspense fallback={<LowStockSkeleton />}>
          <LowStockSection />
        </Suspense>
        <RecentActivity entries={dashboard.activity} />
      </div>
    </div>
  )
}
