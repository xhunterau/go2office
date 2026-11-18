import Link from "next/link"

import type { ActivityEntry } from "@/lib/queries/dashboard"
import { formatDateTime } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ACTOR_LABEL: Record<ActivityEntry["actor"], string> = {
  you: "You",
  staff: "Staff",
  system: "System",
}

export function RecentActivity({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No order activity recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-40">
                  {formatDateTime(entry.createdAt)}
                </span>
                <Link
                  href={`/orders/${entry.orderId}`}
                  className="shrink-0 font-mono text-xs text-foreground underline underline-offset-4 sm:w-28"
                >
                  {entry.invoiceNumber ?? `#${entry.orderId}`}
                </Link>
                <span className="min-w-0 flex-1 break-words text-sm text-foreground">{entry.action}</span>
                <Badge variant={entry.actor === "system" ? "inactive" : "secondary"} className="w-fit shrink-0">
                  {ACTOR_LABEL[entry.actor]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
