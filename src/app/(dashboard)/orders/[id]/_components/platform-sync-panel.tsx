"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { retryPlatformFulfillment } from "@/lib/actions/platform-fulfillment"
import { formatDateTime } from "@/lib/format"
import type { PlatformSync } from "@/lib/queries/platform-fulfillment"

const STATUS_BADGE: Record<
  PlatformSync["status"],
  { label: string; variant: "success" | "warning" | "destructive" | "inactive" }
> = {
  pending: { label: "Waiting", variant: "inactive" },
  succeeded: { label: "Updated", variant: "success" },
  skipped: { label: "Skipped", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
}

/**
 * Whether Shopify / eBay have been told this order shipped. Shown once the
 * order has been dispatched from go2office; orders dispatched in Laravel have
 * no rows and no panel (user decision 2, 2026-11-16).
 *
 * Retry is offered whenever the order is completed: besides failures it pushes
 * a tracking number changed after dispatch (user decision 3). The run is
 * asynchronous, so the page refreshes a few seconds later rather than waiting.
 */
export function PlatformSyncPanel({
  orderId,
  syncs,
  orderTrackingNumber,
  canRetry,
}: {
  orderId: number
  syncs: PlatformSync[]
  orderTrackingNumber: string | null
  canRetry: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function retry() {
    startTransition(async () => {
      const result = await retryPlatformFulfillment(orderId)
      if (!result.success) {
        toast.error("Could not retry", { description: result.error })
        return
      }
      toast.success("Sending to Shopify / eBay", {
        description: "This page refreshes in a few seconds with the result.",
      })
      window.setTimeout(() => router.refresh(), 6000)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Shopify / eBay update</h2>
        {canRetry ? (
          <Button size="sm" variant="outline" onClick={retry} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Retry
          </Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border text-sm">
        {syncs.map((sync) => {
          const badge = STATUS_BADGE[sync.status]
          const stale =
            sync.status === "succeeded" &&
            sync.tracking_number !== null &&
            orderTrackingNumber !== null &&
            sync.tracking_number.toUpperCase() !== orderTrackingNumber.trim().toUpperCase()
          return (
            <li key={sync.id} className="flex flex-col gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {sync.platform === "shopify" ? "Shopify" : "eBay"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{sync.platform_order_id}</span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {stale ? <Badge variant="warning">Tracking number changed</Badge> : null}
              </div>
              {sync.status === "succeeded" ? (
                <p className="text-xs text-muted-foreground">
                  {sync.tracking_number
                    ? `${sync.carrier ?? ""} ${sync.tracking_number}`.trim()
                    : "Marked shipped with no tracking number"}
                  {sync.synced_at ? ` · ${formatDateTime(sync.synced_at)}` : null}
                </p>
              ) : null}
              {sync.last_error && sync.status !== "succeeded" ? (
                <p className="text-xs text-muted-foreground">
                  {sync.last_error}
                  {sync.attempts > 0 ? ` (${sync.attempts} ${sync.attempts === 1 ? "try" : "tries"})` : null}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
