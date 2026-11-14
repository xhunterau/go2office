"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Bug, CheckCircle2, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
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
 *
 * `testOrder` is the shopify_import_test_order debug setting as the page saw it.
 * It changes the label and the confirmation so a switch left on is visible --
 * otherwise every later import quietly fetches one order and the store looks
 * as if it had no new orders. The action re-reads the setting when it starts.
 */
export function ShopifyImportButton({ testOrder }: { testOrder: string | null }) {
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
    const merging =
      "An order from a customer who already has a Pending Shopify order at the same address is merged into it, which sends that order back to the Address check and clears its quotes."
    const ok = await confirm(
      testOrder
        ? {
            title: `Debug import: only ${testOrder}?`,
            description: `The shopify_import_test_order debug setting is on, so only this order is fetched — shipped or not — and added as Pending unless it is already in go2office. ${merging} Turn the setting off in Settings → Debug for a normal import.`,
            confirmText: "Import this order",
          }
        : {
            title: "Import orders from Shopify?",
            description: `Every unshipped Shopify order not already in go2office is added as Pending. ${merging}`,
            confirmText: "Import",
          }
    )
    if (!ok) return

    startTransition(async () => {
      const result = await triggerShopifyImport()
      if (!result.success || !result.data) {
        toast.error("Failed to start the Shopify import", { description: result.error })
        return
      }
      // The setting may have changed since this page was rendered.
      if (result.data.testOrder !== testOrder) {
        toast.warning(
          result.data.testOrder
            ? `Debug mode is on: importing only ${result.data.testOrder}`
            : "Debug mode was turned off: importing every unshipped order"
        )
        router.refresh()
      }
      setEnding(null)
      setOpen(true)
      start(result.data.runId)
    })
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="outline" onClick={handleClick} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Import from Shopify
        </Button>
        {testOrder ? (
          <Link href="/settings/debug">
            <Badge variant="outline" className="gap-1 border-warning/60 text-warning-foreground">
              <Bug className="size-3" />
              Debug: only {testOrder}
            </Badge>
          </Link>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Rule 12. The failure list is unbounded. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Shopify import</DialogTitle>
            <DialogDescription>
              {running
                ? "Closing this window does not stop the import."
                : testOrder
                  ? `Debug mode: only ${testOrder} from go2buy-australia.myshopify.com.`
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

      {output.testOrder ? (
        <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
          <Bug className="mt-0.5 size-3.5 shrink-0" />
          {output.fetched === 0
            ? `Debug mode: no Shopify order matches ${output.testOrder}. Check the name or id in Settings → Debug.`
            : `Debug mode: only ${output.testOrder} was fetched.`}
        </p>
      ) : null}

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
