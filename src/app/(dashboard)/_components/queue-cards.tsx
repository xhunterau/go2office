import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  MapPin,
  PackageCheck,
  Printer,
  Truck,
  type LucideIcon,
} from "lucide-react"

import type { DashboardQueue, QueueKey } from "@/lib/queries/dashboard"
import { cn } from "@/lib/utils"

const numberFormatter = new Intl.NumberFormat("en-AU")

const QUEUE_META: Record<QueueKey, { title: string; href: string; icon: LucideIcon; hint: string }> = {
  address: {
    title: "Address",
    href: "/fulfillment/allocation/address",
    icon: MapPin,
    hint: "Pending, suburb not confirmed",
  },
  postage: {
    title: "Postage",
    href: "/fulfillment/allocation/postage",
    icon: Truck,
    hint: "Pending, waiting for a carrier",
  },
  labels: {
    title: "Export labels",
    href: "/fulfillment/export-labels",
    icon: Printer,
    hint: "Processing, waiting for a label",
  },
  dispatch: {
    title: "Dispatch",
    href: "/fulfillment/dispatch",
    icon: PackageCheck,
    hint: "Labelled, waiting to ship",
  },
  "needs-action": {
    title: "Needs action",
    href: "/orders?status=needs_action",
    icon: AlertCircle,
    hint: "Issued, unpaid or on backorder",
  },
}

/** Past this many days the oldest-order line turns amber. */
const STALE_AFTER_DAYS = 2

function ageLabel(days: number): string {
  if (days === 0) return "Oldest from today"
  return `Oldest ${days} day${days === 1 ? "" : "s"} old`
}

export function QueueCards({ queues }: { queues: DashboardQueue[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {queues.map((queue) => {
        const meta = QUEUE_META[queue.key]
        const empty = queue.count === 0
        const stale = queue.oldestAgeDays != null && queue.oldestAgeDays > STALE_AFTER_DAYS

        return (
          <Link
            key={queue.key}
            href={meta.href}
            className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <meta.icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{meta.title}</span>
              <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>

            <p
              className={cn(
                "text-3xl font-semibold tabular-nums",
                empty ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {numberFormatter.format(queue.count)}
            </p>

            <p className="text-xs text-muted-foreground">{meta.hint}</p>

            {queue.breakdown && queue.breakdown.length > 0 ? (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {queue.breakdown.map((part) => (
                  <li key={part.label}>
                    {part.label}{" "}
                    <span className="font-medium tabular-nums text-foreground">{part.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {queue.oldestAgeDays != null ? (
              <p
                className={cn(
                  "mt-auto text-xs",
                  stale ? "font-medium text-warning-foreground" : "text-muted-foreground"
                )}
              >
                {ageLabel(queue.oldestAgeDays)}
              </p>
            ) : (
              <p className="mt-auto text-xs text-muted-foreground">Nothing waiting</p>
            )}
          </Link>
        )
      })}
    </div>
  )
}
