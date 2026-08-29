"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react"
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
import { cn } from "@/lib/utils"

import { ManualApprovalDialog } from "./manual-approval-dialog"

export function PostageStageClient({ orders }: { orders: PostageStageOrder[] }) {
  const router = useRouter()
  const [expanded, setExpanded] = React.useState<number | null>(null)
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
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Goods</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Cheapest</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <OrderRows
                  key={order.id}
                  order={order}
                  expanded={expanded === order.id}
                  onToggle={() =>
                    setExpanded((current) => (current === order.id ? null : order.id))
                  }
                  approvingQuote={approvingQuote}
                  requoting={requoting === order.id}
                  disabled={busy}
                  onApprove={(quote) => void handleApprove(order, quote)}
                  onRequote={() => void handleRequote(order)}
                  onManual={() => setManualOrder(order)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ManualApprovalDialog
        order={manualOrder}
        onOpenChange={(open) => !open && setManualOrder(null)}
      />
    </div>
  )
}

function OrderRows({
  order,
  expanded,
  onToggle,
  approvingQuote,
  requoting,
  disabled,
  onApprove,
  onRequote,
  onManual,
}: {
  order: PostageStageOrder
  expanded: boolean
  onToggle: () => void
  approvingQuote: number | null
  requoting: boolean
  disabled: boolean
  onApprove: (quote: ShippingQuoteRow) => void
  onRequote: () => void
  onManual: () => void
}) {
  const priced = order.quotes.filter((quote) => !quote.error_message && quote.quoted_rate > 0)
  const failed = order.quotes.filter((quote) => quote.error_message || quote.quoted_rate <= 0)
  const cheapest = priced.length > 0 ? Math.min(...priced.map((q) => q.quoted_rate)) : null
  const customer = order.customer

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <TableCell>
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </TableCell>
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
          {formatMoney(order.metrics?.goods_total ?? null)}
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums">
          {order.metrics ? (
            formatWeightKg(order.metrics.total_weight_kg)
          ) : (
            <span className="text-warning-foreground">No metrics</span>
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

      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={9} className="bg-muted/30 p-4">
            <div className="flex flex-col gap-3">
              {order.metrics === null ? (
                <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  This order has no row in order_metrics_summary, so it has no
                  weight or size to quote against. Quoting it will fail until the
                  metrics are rebuilt from the order page.
                </p>
              ) : null}

              {order.quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rates yet. Use <strong>Quote all</strong> above, or re-quote
                  just this order.
                </p>
              ) : (
                <QuoteTable
                  quotes={priced}
                  failed={failed}
                  cheapest={cheapest}
                  received={order.postage_and_handling}
                  approvingQuote={approvingQuote}
                  disabled={disabled}
                  onApprove={onApprove}
                />
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || requoting}
                  onClick={onRequote}
                >
                  {requoting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Re-quote this order
                </Button>
                <Button size="sm" variant="outline" disabled={disabled} onClick={onManual}>
                  Approve without a quote
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function QuoteTable({
  quotes,
  failed,
  cheapest,
  received,
  approvingQuote,
  disabled,
  onApprove,
}: {
  quotes: ShippingQuoteRow[]
  failed: ShippingQuoteRow[]
  cheapest: number | null
  received: number
  approvingQuote: number | null
  disabled: boolean
  onApprove: (quote: ShippingQuoteRow) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Method</TableHead>
            <TableHead>Carrier</TableHead>
            <TableHead>Zone</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">vs received</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map((quote) => (
            <TableRow key={quote.id}>
              <TableCell className="text-sm font-medium whitespace-nowrap">
                {SHIPPING_METHOD_LABELS[quote.shipping_method]}
                {/* A hint, not a default. The operator picks; nothing here is
                    pre-selected and no row is hidden for being expensive. */}
                {cheapest !== null && quote.quoted_rate === cheapest ? (
                  <Badge variant="info" className="ml-2">
                    Cheapest
                  </Badge>
                ) : null}
                {quote.is_selected ? (
                  <Badge variant="secondary" className="ml-2">
                    Engine pick
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {quote.carrier_name}
              </TableCell>
              <TableCell className="text-sm">{quote.zone ?? "—"}</TableCell>
              <TableCell className="text-right text-sm font-medium tabular-nums">
                {formatMoney(quote.quoted_rate)}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                <Margin rate={quote.quoted_rate} received={received} showRate={false} />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={disabled || approvingQuote !== null}
                  onClick={() => onApprove(quote)}
                >
                  {approvingQuote === quote.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Approve
                </Button>
              </TableCell>
            </TableRow>
          ))}

          {/* Kept rather than hidden. A flat-rate group where nothing fits
              reports its reason on every size, and dropping those rows would
              silently shorten the list with no explanation given. */}
          {failed.map((quote) => (
            <TableRow key={quote.id} className="opacity-60">
              <TableCell className="text-sm whitespace-nowrap">
                {SHIPPING_METHOD_LABELS[quote.shipping_method]}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {quote.carrier_name}
              </TableCell>
              <TableCell colSpan={4} className="text-xs text-muted-foreground">
                {quote.error_message ?? "No price returned"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * The rate, and what it does to this order's postage.
 *
 * Colour only reports; it never filters. A rate above what the customer paid is
 * a loss on the postage line, which is normal on some orders and a mistake on
 * others -- that judgement is the operator's, which is the whole reason this
 * screen exists.
 */
function Margin({
  rate,
  received,
  showRate = true,
}: {
  rate: number
  received: number
  showRate?: boolean
}) {
  const delta = received - rate
  const over = delta < 0

  return (
    <span
      className={cn(
        "tabular-nums",
        over ? "text-warning-foreground" : "text-success-foreground"
      )}
    >
      {showRate ? `${formatMoney(rate)} ` : ""}
      <span className="text-xs">
        ({over ? "−" : "+"}
        {formatMoney(Math.abs(delta))})
      </span>
    </span>
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
