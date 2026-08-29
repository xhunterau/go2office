"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, MailOpen, Package, Printer, Truck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useBatchRunPoll } from "@/hooks/use-batch-run-poll"
import {
  exportEParcelCsv,
  exportMyPostCsv,
  getAramexBatchStatus,
  markSelfPrintLabelsPrinted,
  triggerAramexBatch,
  type CsvExportResult,
} from "@/lib/actions/fulfillment"
import type { ActionResult } from "@/lib/actions/action-result"
import type { SubmitAramexBatchResult } from "@/trigger/submit-aramex-batch"
import type { RunProgress } from "@/lib/trigger/run-status"

type QueueKey = "self-print" | "mypost" | "eparcel" | "aramex"

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

  // The poll loop, the eight-minute ceiling and the manual escape are shared
  // with the allocation postage batch (src/hooks/use-batch-run-poll.ts). Only
  // what to say about the result is particular to Aramex.
  const {
    progress: aramexProgress,
    running: aramexRunning,
    start: startAramexPoll,
    stop: stopAramexPoll,
  } = useBatchRunPoll<SubmitAramexBatchResult>({
    read: getAramexBatchStatus,
    onFinished: (outcome, note) => {
      setBusy(null)
      if (!outcome) {
        toast.error(note ?? "The Aramex submission did not finish. Check the run log.")
      } else {
        reportAramexOutcome(outcome)
      }
      router.refresh()
    },
  })

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

    // `busy` stays set until the poll sees a terminal status, the timeout
    // fires, or the operator stops waiting -- all three land in onFinished.
    startAramexPoll(result.data.runId)
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
        description="Books each order with Aramex over the API — there is no file to upload. The tracking number comes back on the booking and is written to the order; an order that fails is reported by invoice while the rest of the batch continues."
        count={aramexCount}
        actionLabel="Book consignments"
        busy={busy === "aramex" || aramexRunning}
        disabled={busy != null || exportsDisabled}
        progress={aramexProgress}
        onRun={startAramexBatch}
        onStopWaiting={() =>
          stopAramexPoll(
            "Stopped waiting. The batch may still be running — reload the page to see the queue."
          )
        }
      />
    </div>
  )
}


function reportAramexOutcome(outcome: SubmitAramexBatchResult): void {
  const booked = `${outcome.successCount} consignment${outcome.successCount > 1 ? "s" : ""} booked`

  if (outcome.failures.length > 0) {
    toast.warning(`${booked}, ${outcome.failures.length} failed`, {
      description: outcome.failures
        .slice(0, 4)
        .map((failure) => `${failure.invoiceNumber}: ${failure.reason}`)
        .join(" · "),
      duration: 20_000,
    })
  } else {
    toast.success(booked)
  }

  // Booked, but nothing to track it by. Separate from a failure: the parcel is
  // with Aramex either way, so this is a note to go and find the number, not an
  // invitation to book it again.
  if (outcome.untracked.length > 0) {
    toast.warning(
      `${outcome.untracked.length} booking${outcome.untracked.length > 1 ? "s" : ""} came back without a tracking number`,
      {
        description: `${outcome.untracked.slice(0, 5).join(", ")} — look the consignment up in the Aramex portal and set the tracking number on the order by hand.`,
        duration: 20_000,
      }
    )
  }
}

function QueueCard({
  icon: Icon,
  title,
  description,
  count,
  actionLabel,
  busy,
  disabled,
  progress,
  onRun,
  onStopWaiting,
}: {
  icon: React.ElementType
  title: string
  description: string
  count: number
  actionLabel: string
  busy: boolean
  disabled: boolean
  /**
   * Present only for the Aramex batch, which reports how far through the queue
   * it is. The other three are a single server round trip: the bar they get is
   * indeterminate, because there is no honest percentage to show.
   */
  progress?: RunProgress | null
  onRun: () => void
  onStopWaiting?: () => void
}) {
  const hasOrders = count > 0
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null

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

      {busy ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {progress
                ? `Booking consignment ${progress.current} of ${progress.total}`
                : onStopWaiting
                  ? "Starting the batch"
                  : "Preparing"}
            </span>
            {pct !== null ? (
              <span className="tabular-nums">
                {progress?.current} / {progress?.total}
              </span>
            ) : null}
          </div>
          <Progress value={pct} />
          {onStopWaiting ? (
            <button
              type="button"
              onClick={onStopWaiting}
              className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Stop waiting
            </button>
          ) : null}
        </div>
      ) : null}

      <Button
        size="sm"
        className="w-full"
        disabled={!hasOrders || disabled}
        onClick={onRun}
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {progress
              ? `Booking ${progress.current} of ${progress.total}...`
              : "Working..."}
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
