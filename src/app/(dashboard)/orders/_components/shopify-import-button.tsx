"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { useConfirm } from "@/components/providers/confirm-provider"
import { useBatchRunPoll } from "@/hooks/use-batch-run-poll"
import {
  getShopifyImportStatus,
  triggerShopifyImport,
} from "@/lib/actions/shopify-import"
import type { ImportShopifyOrdersResult } from "@/trigger/import-shopify-orders"

type Ending = { output: ImportShopifyOrdersResult | null; note?: string }

/**
 * Pulls every unshipped Shopify order into go2office.
 *
 * Runs as the import-shopify-orders task and is watched by polling, not a
 * realtime subscription (src/lib/trigger/run-status.ts). The dialog stays open
 * for the result, because the merged orders in it are ones the operator has to
 * act on: each went back to the Address queue with its quotes deleted.
 */
export function ShopifyImportButton() {
  const router = useRouter()
  const confirm = useConfirm()
  const [open, setOpen] = React.useState(false)
  const [ending, setEnding] = React.useState<Ending | null>(null)
  const [isStarting, startTransition] = React.useTransition()

  const { progress, running, start, stop } = useBatchRunPoll<ImportShopifyOrdersResult>({
    read: getShopifyImportStatus,
    onFinished: (output, note) => {
      setEnding({ output, note })
      router.refresh()
    },
  })

  const busy = isStarting || running

  async function handleClick() {
    const ok = await confirm({
      title: "Import orders from Shopify?",
      description:
        "Every unshipped Shopify order not already in go2office is added as Pending. An order from a customer who already has a Pending Shopify order at the same address is merged into it, which sends that order back to the Address check and clears its quotes.",
      confirmText: "Import",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await triggerShopifyImport()
      if (!result.success || !result.data) {
        toast.error("Failed to start the Shopify import", { description: result.error })
        return
      }
      setEnding(null)
      setOpen(true)
      start(result.data.runId)
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleClick} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        Import from Shopify
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Rule 12. The failure list is unbounded. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Shopify import</DialogTitle>
            <DialogDescription>
              {running
                ? "Closing this window does not stop the import."
                : "Unshipped orders from go2buy-australia.myshopify.com."}
            </DialogDescription>
          </DialogHeader>

          {running ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  {progress
                    ? `Importing order ${progress.current} of ${progress.total}`
                    : "Fetching orders from Shopify…"}
                </span>
                {progress ? (
                  <span className="tabular-nums">
                    {progress.current} / {progress.total}
                  </span>
                ) : null}
              </div>
              <Progress
                value={
                  progress && progress.total > 0
                    ? Math.round((progress.current / progress.total) * 100)
                    : null
                }
              />
              <button
                type="button"
                onClick={() =>
                  stop("Stopped waiting. The import may still be running — reload the page in a minute.")
                }
                className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Stop waiting
              </button>
            </div>
          ) : ending ? (
            <ImportSummary ending={ending} />
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ImportSummary({ ending }: { ending: Ending }) {
  const { output, note } = ending

  if (!output) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {note ?? "The import did not finish. Check the run log."}
      </p>
    )
  }

  const rows: [string, number][] = [
    ["Fetched from Shopify", output.fetched],
    ["New orders", output.imported],
    ["Merged into a pending order", output.merged],
    ["Already in go2office", output.duplicates],
    ["Ignored (cancelled, test or nothing to ship)", output.ignored],
    ["Failed", output.failures.length],
  ]

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="size-4 text-success-foreground" />
        Import finished
      </p>

      <dl className="flex flex-col gap-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {output.mergedInvoices.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
          <p className="font-medium">Back in the Address queue</p>
          <p className="text-xs text-muted-foreground">
            These orders gained lines, so their address check and postage quotes
            were reset: {output.mergedInvoices.join(", ")}
          </p>
        </div>
      ) : null}

      {output.failures.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/40 p-3">
          <p className="font-medium text-warning-foreground">Not imported</p>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {output.failures.map((failure) => (
              <li key={failure.name}>
                <span className="font-mono">{failure.name}</span>: {failure.reason}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Nothing was written for these. Running the import again retries them.
          </p>
        </div>
      ) : null}
    </div>
  )
}
