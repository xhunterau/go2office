import Link from "next/link"
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react"

import type { DashboardAlert } from "@/lib/dashboard/alerts"
import { cn } from "@/lib/utils"

export function HealthPanel({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-success-foreground" />
        All systems normal — no failed write-backs, stuck orders or configuration gaps.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => {
        const critical = alert.tone === "critical"
        const Icon = critical ? CircleAlert : TriangleAlert
        return (
          <li
            key={alert.id}
            className={cn(
              "flex gap-3 rounded-xl border p-4 text-sm",
              critical
                ? "border-destructive/40 bg-destructive/10"
                : "border-amber-500/40 bg-amber-500/10"
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                critical ? "text-destructive" : "text-amber-600 dark:text-amber-400"
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-medium text-foreground">{alert.title}</p>
              {alert.detail ? <p className="break-words text-muted-foreground">{alert.detail}</p> : null}

              {alert.orders && alert.orders.length > 0 ? (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {alert.orders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="font-mono text-xs text-foreground underline underline-offset-4"
                    >
                      {order.invoiceNumber}
                    </Link>
                  ))}
                </p>
              ) : null}

              {alert.href ? (
                <Link
                  href={alert.href}
                  className="w-fit font-medium text-foreground underline underline-offset-4"
                >
                  {alert.linkLabel ?? "Open"}
                </Link>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
