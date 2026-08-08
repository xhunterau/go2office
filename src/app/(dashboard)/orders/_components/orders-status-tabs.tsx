"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { NEEDS_ACTION, type OrderStatusCounts } from "@/lib/queries/orders"
import { STATUS_TABS } from "@/lib/orders/status"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const numberFormatter = new Intl.NumberFormat("en-AU")

// The status row is the page's main structure rather than one more dropdown:
// unpaid is a chasing queue, backorder a purchasing queue, picked a packing
// queue (docs/orders-ui.md 5.2). The full ten-value dropdown stays in the
// filter bar for the statuses without a tab.
export function OrdersStatusTabs({
  counts,
}: {
  // Null when the count query failed. The tabs still have to work -- they are
  // the navigation, and losing the numbers is not a reason to lose the links.
  counts: OrderStatusCounts | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const current = searchParams.get("status")

  function select(value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set("status", value)
    else params.delete("status")
    params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function countFor(value: (typeof STATUS_TABS)[number]["value"]): number | null {
    if (!counts) return null
    if (value === null) return counts.total
    if (value === NEEDS_ACTION) return counts.needsAction
    return counts.byStatus[value]
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
      {STATUS_TABS.map((tab) => {
        const active = (current ?? null) === tab.value
        const count = countFor(tab.value)

        return (
          <Button
            key={tab.value ?? "all"}
            variant="ghost"
            size="sm"
            onClick={() => select(tab.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "gap-2",
              active && "bg-muted text-foreground"
            )}
          >
            {tab.label}
            {/* Six of the ten statuses are empty in the migrated data. The tabs
                still render at zero: hiding them would mean the queue becomes
                invisible on the day it first has something in it. */}
            {count !== null && (
              <Badge variant={active ? "secondary" : "inactive"}>
                {numberFormatter.format(count)}
              </Badge>
            )}
          </Button>
        )
      })}
    </div>
  )
}
