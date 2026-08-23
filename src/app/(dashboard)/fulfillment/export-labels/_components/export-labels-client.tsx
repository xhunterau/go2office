"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { toast } from "sonner"
import { Loader2, MailOpen, Package, Printer, Truck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  exportEParcelCsv,
  exportMyPostCsv,
  markSelfPrintLabelsPrinted,
  triggerAramexBatch,
  type CsvExportResult,
} from "@/lib/actions/fulfillment"
import type { ActionResult } from "@/lib/actions/action-result"
import type { SubmitAramexBatchResult } from "@/trigger/submit-aramex-batch"

type QueueKey = "self-print" | "mypost" | "eparcel" | "aramex"

type RunState = { runId: string; publicToken: string }

// Statuses a run can end on without having completed. Anything else is either
// still in flight or COMPLETED.
const TERMINAL_FAILURES = new Set([
  "FAILED",
  "CRASHED",
  "CANCELED",
  "SYSTEM_FAILURE",
  "INTERRUPTED",
  "TIMED_OUT",
])

function downloadCsv(csv: string, filename: string): void {
  // A BOM, so Excel opens the file as UTF-8 instead of guessing the local
  // codepage and mangling any non-ASCII name in it.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}

function reportTruncation(truncated: string[]): void {
  if (truncated.length === 0) return

  toast.warning(
    `Address truncated on ${truncated.length} order${truncated.length > 1 ? "s" : ""}`,
    {
      description: `${truncated.slice(0, 5).join(", ")}${
        truncated.length > 5 ? ` and ${truncated.length - 5} more` : ""
      } — the address was longer than the carrier's columns allow. Check them before the parcels go out.`,
      duration: 12_000,
    }
  )
}

export function ExportLabelsClient({
  selfPrintCount,
  myPostCount,
  eParcelCount,
  aramexCount,
  exportsDisabled,
}: {
  selfPrintCount: number
  myPostCount: number
  eParcelCount: number
  aramexCount: number
  exportsDisabled: boolean
}) {
  // The counts stay server state: each action revalidates the path and the
  // handlers below pull the new render down. There is deliberately no local
  // copy to zero out -- a second click during the refresh finds an empty queue
  // and is told so, which is a harmless no-op, whereas a mirrored count is a
  // second source of truth that can disagree with the database.
  const router = useRouter()
  const [busy, setBusy] = React.useState<QueueKey | null>(null)
  const [aramexRun, setAramexRun] = React.useState<RunState | null>(null)

  async function runCsvExport(
    key: Exclude<QueueKey, "self-print">,
    action: () => Promise<ActionResult<CsvExportResult>>,
    label: string
  ) {
    if (busy) return
    setBusy(key)

    try {
      const result = await action()
      if (!result.success || !result.data) {
        toast.error(result.error ?? `Failed to export the ${label} CSV`)
        return
      }

      downloadCsv(result.data.csv, result.data.filename)
      toast.success(
        `${result.data.count} order${result.data.count > 1 ? "s" : ""} exported`,
        { description: result.data.filename }
      )
      if (result.data.warning) toast.warning(result.data.warning)
      reportTruncation(result.data.truncated)

      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function runSelfPrint() {
    if (busy) return
    setBusy("self-print")

    try {
      const result = await markSelfPrintLabelsPrinted()
      if (!result.success || !result.data) {
        toast.error(result.error ?? "Failed to prepare the labels")
        return
      }

      const { orderIds, warning } = result.data
      toast.success(
        `${orderIds.length} label${orderIds.length > 1 ? "s" : ""} ready — opening the print view`
      )
      if (warning) toast.warning(warning)

      window.open(`/api/print/shipping-label?ids=${orderIds.join(",")}`, "_blank")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function startAramexBatch() {
    if (busy) return
    setBusy("aramex")

    const result = await triggerAramexBatch()
    if (!result.success || !result.data) {
      toast.error(result.error ?? "Failed to start the Aramex submission")
      setBusy(null)
      return
    }

    // `busy` stays set until the run finishes; the watcher below clears it.
    setAramexRun(result.data)
  }

  function onAramexFinished(outcome: SubmitAramexBatchResult | null) {
    setAramexRun(null)
    setBusy(null)

    if (!outcome) {
      toast.error("The Aramex submission did not finish. Check the run log.")
    } else if (outcome.failures.length === 0) {
      toast.success(
        `${outcome.successCount} consignment${outcome.successCount > 1 ? "s" : ""} booked`
      )
    } else {
      toast.warning(
        `${outcome.successCount} booked, ${outcome.failures.length} failed`,
        {
          description: outcome.failures
            .slice(0, 4)
            .map((failure) => `${failure.invoiceNumber}: ${failure.reason}`)
            .join(" · "),
          duration: 20_000,
        }
      )
    }

    router.refresh()
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <QueueCard
        icon={Printer}
        title="Self-printed Labels"
        description="Letter, Registered Letter, Parcel Post, Express Post and Store Delivery. Produces an A6 PDF, one label per page, and marks the orders Labelled on click — printing is assumed, and the labels can be reprinted from the order at any time."
        count={selfPrintCount}
        actionLabel="Print labels"
        busy={busy === "self-print"}
        disabled={busy != null}
        onRun={runSelfPrint}
      />

      <QueueCard
        icon={MailOpen}
        title="Australia Post MyPost Business"
        description="A 23-column CSV for the MyPost Business Portal, carrying the sender block from Shipping Constants."
        count={myPostCount}
        actionLabel="Export CSV"
        busy={busy === "mypost"}
        disabled={busy != null || exportsDisabled}
        onRun={() => runCsvExport("mypost", exportMyPostCsv, "MyPost")}
      />

      <QueueCard
        icon={Package}
        title="Australia Post eParcel"
        description="A 25-column eParcel CSV. Regular is billed to charge code 3D55 and Express to 3J55; the sender comes from the charge account, not from this app."
        count={eParcelCount}
        actionLabel="Export CSV"
        busy={busy === "eparcel"}
        disabled={busy != null || exportsDisabled}
        onRun={() => runCsvExport("eparcel", exportEParcelCsv, "eParcel")}
      />

      <QueueCard
        icon={Truck}
        title="Aramex"
        description="Books each order with Aramex over the API — there is no file to upload. The consignment id is written back to the order as its tracking number, and an order that fails is reported by invoice while the rest of the batch continues."
        count={aramexCount}
        actionLabel="Book consignments"
        busy={busy === "aramex"}
        disabled={busy != null || exportsDisabled}
        onRun={startAramexBatch}
      />

      {aramexRun ? (
        <AramexRunWatcher run={aramexRun} onFinished={onAramexFinished} />
      ) : null}
    </div>
  )
}

/**
 * Subscribes to the batch run so the operator sees progress rather than a
 * spinner that could mean anything. Rendered only while a run is live, because
 * useRealtimeRun opens a connection for as long as it is mounted.
 */
function AramexRunWatcher({
  run: runState,
  onFinished,
}: {
  run: RunState
  onFinished: (outcome: SubmitAramexBatchResult | null) => void
}) {
  const { run, error } = useRealtimeRun(runState.runId, {
    accessToken: runState.publicToken,
  })

  const onFinishedRef = React.useRef(onFinished)
  React.useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  const status = run?.status
  React.useEffect(() => {
    if (!status) return
    if (status === "COMPLETED") {
      onFinishedRef.current((run?.output as SubmitAramexBatchResult) ?? null)
    } else if (TERMINAL_FAILURES.has(status)) {
      onFinishedRef.current(null)
    }
    // `run.output` is only read once the status says it is there, so status is
    // the only dependency that should re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  React.useEffect(() => {
    if (error) onFinishedRef.current(null)
  }, [error])

  const progress = run?.metadata?.progress as
    | { current: number; total: number }
    | undefined

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
      <Loader2 className="size-4 animate-spin" />
      {progress
        ? `Booking consignment ${progress.current} of ${progress.total}...`
        : "Starting the Aramex batch..."}
    </div>
  )
}

function QueueCard({
  icon: Icon,
  title,
  description,
  count,
  actionLabel,
  busy,
  disabled,
  onRun,
}: {
  icon: React.ElementType
  title: string
  description: string
  count: number
  actionLabel: string
  busy: boolean
  disabled: boolean
  onRun: () => void
}) {
  const hasOrders = count > 0

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        <Badge variant={hasOrders ? "default" : "secondary"} className="shrink-0">
          {hasOrders ? `${count} waiting` : "Empty"}
        </Badge>
      </div>

      <p className="flex-1 text-sm text-muted-foreground">{description}</p>

      <Button
        size="sm"
        className="w-full"
        disabled={!hasOrders || disabled}
        onClick={onRun}
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Working...
          </>
        ) : (
          <>
            {actionLabel}
            {hasOrders ? ` (${count})` : ""}
          </>
        )}
      </Button>
    </div>
  )
}
