"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useConfirm } from "@/components/providers/confirm-provider"
import { useBatchRunPoll } from "@/hooks/use-batch-run-poll"
import {
  approveQuotedOrder,
  getPostageCheckStatus,
  triggerPostageCheck,
} from "@/lib/actions/allocation"
import { triggerShippingQuote } from "@/lib/actions/shipping-quote"
import type { PostageStageOrder } from "@/lib/queries/allocation"
import type { ShippingQuoteRow } from "@/lib/queries/shipping-quotes"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
import { formatDate, formatMoney, formatWeightKg } from "@/lib/format"
import type { BatchPostageCheckResult } from "@/trigger/batch-postage-check"

import { ManualApprovalDialog } from "./manual-approval-dialog"
import { Margin, PostageOrderDialog } from "./postage-order-dialog"

export function PostageStageClient({ orders }: { orders: PostageStageOrder[] }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [openOrderId, setOpenOrderId] = React.useState<number | null>(null)
  const [approvingQuote, setApprovingQuote] = React.useState<number | null>(null)
  const [requoting, setRequoting] = React.useState<number | null>(null)
  const [manualOrder, setManualOrder] = React.useState<PostageStageOrder | null>(null)
  const [isStarting, startBatch] = React.useTransition()

  const { progress, running, start, stop } = useBatchRunPoll<BatchPostageCheckResult>({
    read: getPostageCheckStatus,
    onFinished: (output, note) => {
      if (!output) {
        toast.error(note ?? "The postage check did not finish. Check the run log.")
      } else {
        reportBatch(output)
      }
      router.refresh()
    },
  })

  const busy = isStarting || running

  // Resolved from the list rather than held as its own copy of the order, so a
  // router.refresh() behind the dialog shows the new rates instead of the ones
  // that were on screen when it opened.
  const openIndex = orders.findIndex((order) => order.id === openOrderId)
  const openOrder = openIndex >= 0 ? orders[openIndex] : null

  function handleRunBatch() {
    startBatch(async () => {
      const result = await triggerPostageCheck()
      if (!result.success || !result.data) {
        toast.error("Failed to start the postage check", { description: result.error })
        return
      }
      start(result.data.runId)
      toast.success("Quoting started", {
        description: "Rates appear here as each order is priced.",
      })
    })
  }

  async function handleRequote(order: PostageStageOrder) {
    setRequoting(order.id)
    const result = await triggerShippingQuote(order.id)
    setRequoting(null)

    if (!result.success) {
      toast.error("Failed to re-quote", { description: result.error })
      return
    }
    // The single-order task finishes in a second or two. No poll here: the row
    // is refreshed on the next render and the operator can reopen it.
    toast.success(`Re-quoting ${order.invoice_number}`, {
      description: "Refresh in a moment to see the new rates.",
    })
  }

  async function handleApprove(order: PostageStageOrder, quote: ShippingQuoteRow) {
    // Rule 9, via the shared hook rather than a dialog of its own. Approving is
    // one-way: the order leaves this queue for `processing` and only a hand-
    // written UPDATE brings it back, so the carrier and the price are repeated
    // here to be read before it goes.
    const ok = await confirm({
      title: `Approve ${order.invoice_number}?`,
      description: `${SHIPPING_METHOD_LABELS[quote.shipping_method]} at ${formatMoney(quote.quoted_rate)} with ${quote.carrier_name}. The order moves to Processing and appears on Export Labels; it cannot be sent back from here.`,
      confirmText: "Approve",
    })
    if (!ok) return

    setApprovingQuote(quote.id)
    const result = await approveQuotedOrder(order.id, quote.id)
    setApprovingQuote(null)

    if (!result.success) {
      toast.error("The order could not be approved", { description: result.error })
      return
    }
    toast.success(`${order.invoice_number} approved`, {
      description: `${SHIPPING_METHOD_LABELS[quote.shipping_method]} at ${formatMoney(quote.quoted_rate)} — now in Processing.`,
    })
    if (result.data?.warning) toast.warning(result.data.warning)
    // The order has left the queue, so there is nothing left to look at.
    setOpenOrderId(null)
    router.refresh()
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={handleRunBatch} disabled={busy || orders.length === 0}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {running ? "Quoting…" : `Quote all${orders.length ? ` (${orders.length})` : ""}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Prices every order in the queue against each carrier that can carry
            it. Re-running replaces the rates shown; it never approves anything.
          </p>
        </div>

        {running ? (
          <div className="flex max-w-md flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {progress
                  ? `Quoting order ${progress.current} of ${progress.total}`
                  : "Starting the batch"}
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
                stop(
                  "Stopped waiting. The batch may still be running — reload the page to see the rates."
                )
              }
              className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Stop waiting
            </button>
          </div>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
          <CheckCircle2 className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Nothing to approve</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Orders arrive here once their address has been confirmed on the{" "}
            <Link
              href="/fulfillment/allocation/address"
              className="underline underline-offset-4"
            >
              Address
            </Link>{" "}
            stage.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Select an order to see what is in it, where it is going and every
            rate it was quoted.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="text-right">Goods</TableHead>
                  <TableHead className="text-right">Chargeable</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Cheapest</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onOpen={() => setOpenOrderId(order.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <PostageOrderDialog
        order={openOrder}
        position={openIndex + 1}
        total={orders.length}
        onNavigate={(step) => {
          const next = orders[openIndex + step]
          if (next) setOpenOrderId(next.id)
        }}
        approvingQuote={approvingQuote}
        requoting={openOrder !== null && requoting === openOrder.id}
        disabled={busy}
        onApprove={(quote) => {
          if (openOrder) void handleApprove(openOrder, quote)
        }}
        onRequote={() => {
          if (openOrder) void handleRequote(openOrder)
        }}
        onManual={() => {
          if (openOrder) setManualOrder(openOrder)
        }}
        onOpenChange={(open) => !open && setOpenOrderId(null)}
      />

      <ManualApprovalDialog
        order={manualOrder}
        onOpenChange={(open) => {
          if (!open) setManualOrder(null)
        }}
      />
    </div>
  )
}

/**
 * One line in the queue: enough to triage, not enough to decide.
 *
 * The figures that settle the choice -- packed size, whether that size is
 * measured, what is actually in the box, the full address -- are in the dialog.
 * Putting them here would mean a dozen columns, and the weight shown is the
 * chargeable one because that is what the carrier bills.
 */
function OrderRow({
  order,
  onOpen,
}: {
  order: PostageStageOrder
  onOpen: () => void
}) {
  const priced = order.quotes.filter((quote) => !quote.error_message && quote.quoted_rate > 0)
  const cheapest = priced.length > 0 ? Math.min(...priced.map((q) => q.quoted_rate)) : null
  const customer = order.customer
  const metrics = order.metrics

  // Hoisted out of the dialog: 28% of products have no measured dimensions and
  // 313 order lines resolve to no product, so an order whose numbers cannot be
  // trusted has to say so where the numbers are read, not one click away.
  const caveats = metrics
    ? [
        metrics.has_estimated_dimensions ? "Size is estimated" : null,
        metrics.unresolved_item_count > 0
          ? `${metrics.unresolved_item_count} unresolved line${metrics.unresolved_item_count === 1 ? "" : "s"} — weight understated`
          : null,
      ].filter((note): note is string => note !== null)
    : []

  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
      // Clickable rows are not reachable by keyboard on their own, and this row
      // is now the only way into the order.
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <TableCell>
        <Link
          href={`/orders/${order.id}`}
          onClick={(event) => event.stopPropagation()}
          className="font-medium underline-offset-4 hover:underline"
        >
          {order.invoice_number}
        </Link>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Badge variant="secondary">{SALES_PLATFORM_LABELS[order.platform]}</Badge>
        </div>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
        {formatDate(order.posted_on_date ?? order.created_at)}
      </TableCell>
      <TableCell className="text-sm">
        {customer?.city?.trim() || "—"}{" "}
        <span className="text-muted-foreground tabular-nums">
          {customer?.state ?? ""} {customer?.postcode ?? ""}
        </span>
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {formatMoney(metrics?.goods_total ?? null)}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {metrics ? (
          <span className="inline-flex items-center gap-1.5">
            {caveats.length > 0 ? (
              <span title={caveats.join(" · ")} className="inline-flex">
                <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" />
                <span className="sr-only">{caveats.join(". ")}</span>
              </span>
            ) : null}
            {formatWeightKg(metrics.chargeable_weight_kg)}
          </span>
        ) : (
          <span
            className="text-warning-foreground"
            title="No row in order_metrics_summary — quoting fails until the metrics are rebuilt."
          >
            No metrics
          </span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {formatMoney(order.postage_and_handling)}
      </TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums">
        {cheapest === null ? (
          <span className="text-muted-foreground">
            {order.quotes.length === 0 ? "Not quoted" : "No price"}
          </span>
        ) : (
          <Margin rate={cheapest} received={order.postage_and_handling} />
        )}
      </TableCell>
      <TableCell className="text-right">
        <span className="text-xs text-muted-foreground">
          {priced.length > 0
            ? `${priced.length} option${priced.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </TableCell>
    </TableRow>
  )
}

function reportBatch(output: BatchPostageCheckResult): void {
  const parts = [`${output.quotedCount} priced`]
  if (output.unpricedCount > 0) parts.push(`${output.unpricedCount} with no price`)
  toast.success(`Quoted ${output.processed} order${output.processed === 1 ? "" : "s"}`, {
    description: parts.join(", "),
  })

  // Reported on its own, and deliberately loudly: the engine sets these orders
  // to `issued` itself, which drops them out of this queue entirely. Rolled
  // into the summary above, the only visible effect would be a queue that got
  // shorter than it should have.
  if (output.escalatedCount > 0) {
    toast.warning(
      `${output.escalatedCount} order${output.escalatedCount === 1 ? "" : "s"} left the queue`,
      {
        description:
          "No carrier could take them, so the quote engine moved them to Issued. Find them under Needs action on Orders.",
        duration: 20_000,
      }
    )
  }

  if (output.failures.length > 0) {
    toast.error(
      `${output.failures.length} order${output.failures.length === 1 ? "" : "s"} could not be quoted`,
      {
        description: output.failures
          .slice(0, 4)
          .map((failure) => `${failure.invoiceNumber}: ${failure.reason}`)
          .join(" · "),
        duration: 20_000,
      }
    )
  }
}
