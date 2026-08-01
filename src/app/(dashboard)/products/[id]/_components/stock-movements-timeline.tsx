"use client"

import type { MovementRow } from "@/lib/queries/inventory"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

const KIND_LABELS: Record<MovementRow["kind"], string> = {
  receive: "Receive",
  dispatch: "Dispatch",
  adjust: "Count",
  move_in: "Move in",
  move_out: "Move out",
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function StockMovementsTimeline({
  movements,
}: {
  movements: MovementRow[]
}) {
  if (movements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No movements recorded yet. Opening quantities were imported from the
        legacy system, which kept no usable history.
      </p>
    )
  }

  return (
    <ol className="divide-y divide-border">
      {movements.map((movement) => (
        <li
          key={movement.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
        >
          <Badge
            variant={movement.qty_delta > 0 ? "success" : "destructive"}
            className="shrink-0"
          >
            {KIND_LABELS[movement.kind]}
          </Badge>
          <span
            className={cn(
              "shrink-0 font-medium tabular-nums",
              movement.qty_delta > 0 ? "text-emerald-600" : "text-destructive"
            )}
          >
            {movement.qty_delta > 0 ? "+" : "−"}
            {Math.abs(movement.qty_delta)}
          </span>
          <span className="text-muted-foreground">
            {movement.location_name}
            {movement.counterpart_location_name &&
              ` ${movement.qty_delta > 0 ? "←" : "→"} ${movement.counterpart_location_name}`}
          </span>
          <span className="text-muted-foreground tabular-nums">
            → {movement.qty_after} on hand
          </span>
          {movement.note && (
            <span className="text-muted-foreground italic">
              &ldquo;{movement.note}&rdquo;
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatWhen(movement.created_at)}
          </span>
        </li>
      ))}
    </ol>
  )
}
