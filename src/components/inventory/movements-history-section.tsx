"use client"

import * as React from "react"
import { Eraser, MoreHorizontal, Scissors } from "lucide-react"
import { toast } from "sonner"

import type { MovementPruneRow, MovementRow } from "@/lib/queries/inventory"
import {
  pruneProductMovements,
  type PruneSummary,
} from "@/lib/actions/inventory"
import { MOVEMENT_KEEP_RECENT } from "@/lib/validations/inventory"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { StockMovementsTimeline } from "./stock-movements-timeline"

function formatDay(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function formatPeriod(from: string | null, to: string | null): string {
  return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`
}

// One line accounting for what was thrown away: how much came in, how much went
// out, and over what period.
function summarise(summary: PruneSummary): string {
  const count = `${summary.deleted_count} movement${
    summary.deleted_count === 1 ? "" : "s"
  }`

  return `Deleted ${count} — ${summary.qty_in} in, ${summary.qty_out} out (${formatPeriod(summary.first_at, summary.last_at)})`
}

// Where the timeline stops short, and why. Rendered under the surviving
// movements because that is where the deleted ones would have been — a short
// history otherwise reads as "nothing happened" rather than "the record was
// cleared".
function PruneNotes({ prunes }: { prunes: MovementPruneRow[] }) {
  if (prunes.length === 0) return null

  return (
    <ul className="space-y-1 border-t border-dashed border-border pt-2">
      {prunes.map((prune) => (
        <li
          key={prune.id}
          className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground"
        >
          <Scissors className="size-3.5 shrink-0 self-center" />
          <span>
            {prune.deleted_count} earlier movement
            {prune.deleted_count === 1 ? "" : "s"} deleted on{" "}
            {formatDay(prune.pruned_at)}
          </span>
          <span className="tabular-nums">
            {prune.qty_in} in, {prune.qty_out} out
          </span>
          <span>({formatPeriod(prune.first_at, prune.last_at)})</span>
        </li>
      ))}
    </ul>
  )
}

// The movement history block, with its own housekeeping. Shared by the product
// detail Stock tab and the expanded row on the stock overview list.
export function MovementsHistorySection({
  productId,
  movements,
  prunes = [],
  loading = false,
  error = null,
  onPruned,
}: {
  productId: number
  // Undefined while the ledger is still being fetched.
  movements: MovementRow[] | undefined
  prunes?: MovementPruneRow[]
  loading?: boolean
  error?: string | null
  // Server data refreshes through revalidatePath; this is for callers holding a
  // client-side copy of the history, such as the list page's cache.
  onPruned?: () => void
}) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  const shown = movements?.length ?? 0
  // The timeline is capped at MOVEMENT_HISTORY_LIMIT, so `shown` is a floor on
  // what exists, never a total — no count is ever quoted back to the user.
  const canPrune = shown > 0
  const canTrim = shown > MOVEMENT_KEEP_RECENT

  async function prune(keep: 0 | typeof MOVEMENT_KEEP_RECENT) {
    const ok = await confirm({
      title: keep === 0 ? "Delete movement history" : "Trim movement history",
      description:
        (keep === 0
          ? "Delete every movement recorded for this product? "
          : `Delete every movement except the ${MOVEMENT_KEEP_RECENT} most recent? `) +
        "Stock quantities are not affected — only the record of how they got there. This cannot be undone, though a summary of what was deleted is kept.",
      confirmText: keep === 0 ? "Delete all" : "Trim history",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await pruneProductMovements({
        product_id: productId,
        keep,
      })

      if (!result.success || !result.data) {
        toast.error(result.error ?? "Something went wrong")
        return
      }

      if (result.data.deleted_count === 0) {
        toast.info("Nothing to delete.")
      } else {
        toast.success(summarise(result.data))
      }
      onPruned?.()
    })
  }

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Recent movements
          </h3>
          <p className="text-sm text-muted-foreground">
            Every change to this product&apos;s stock, most recent first.
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={!canPrune || isPending}
              aria-label="Movement history options"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!canTrim}
              onSelect={() => void prune(MOVEMENT_KEEP_RECENT)}
            >
              <Scissors />
              Keep latest {MOVEMENT_KEEP_RECENT}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void prune(0)}
            >
              <Eraser />
              Delete all history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          Failed to load movements: {error}
        </p>
      ) : loading || !movements ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-6 w-3/5" />
        </div>
      ) : (
        <>
          {/* The timeline's empty state blames the legacy import, which is only
              true when nothing was deleted here. With a prune on file the notes
              below are the explanation, so the timeline stands down. */}
          {(shown > 0 || prunes.length === 0) && (
            <StockMovementsTimeline movements={movements} />
          )}
          <PruneNotes prunes={prunes} />
        </>
      )}
    </div>
  )
}
