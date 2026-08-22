"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2, Truck } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useConfirm } from "@/components/providers/confirm-provider"
import {
  clearShippingQuotes,
  loadLatestShippingQuotes,
  selectShippingQuote,
  triggerShippingQuote,
} from "@/lib/actions/shipping-quote"
import { formatDateTime, formatMoney, formatWeightKg } from "@/lib/format"
import type { ShippingQuoteRow } from "@/lib/queries/shipping-quotes"
import { cn } from "@/lib/utils"

// A batch takes a second or two: a handful of Supabase round trips plus one
// live Aramex call. Thirty attempts at two seconds gives the run a minute
// before the panel stops watching and tells the user to check back.
const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 30

type Props = {
  orderId: number
  initialQuotes: ShippingQuoteRow[]
  initialQuotedAt: string | null
  totalWeightKg: number | null
  chargeableWeightKg: number | null
  // Both come from order_metrics_summary and both make the packed size a guess,
  // which is what the flat-rate satchel and box fit checks are decided on.
  hasEstimatedDimensions: boolean
  unresolvedItemCount: number
}

function formatMethod(method: string): string {
  return method.replace(/_/g, " ")
}

function isExpressMethod(method: string): boolean {
  return /Express|Exp_/i.test(method)
}

function isFlatRateMethod(method: string): boolean {
  return /^Mypost_(Reg|Exp)_/i.test(method)
}

export function ShippingQuotesPanel({
  orderId,
  initialQuotes,
  initialQuotedAt,
  totalWeightKg,
  chargeableWeightKg,
  hasEstimatedDimensions,
  unresolvedItemCount,
}: Props) {
  const [quotes, setQuotes] = useState(initialQuotes)
  const [quotedAt, setQuotedAt] = useState(initialQuotedAt)
  const [isTriggering, startTrigger] = useTransition()
  const [isClearing, startClear] = useTransition()
  const [selectingId, setSelectingId] = useState<number | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const pollTimer = useRef<number | null>(null)
  const confirm = useConfirm()
  const router = useRouter()

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const priced = quotes.filter((quote) => !quote.error_message)
  const failed = quotes.filter((quote) => quote.error_message)
  // Only worth saying when there is something priced to distrust, and only in
  // terms of what it does to a quote -- the order summary above already reports
  // the estimate itself.
  const showEstimateWarning =
    quotes.length > 0 && (hasEstimatedDimensions || unresolvedItemCount > 0)

  function stopPolling() {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    setIsPolling(false)
  }

  function pollForNewBatch(previousQuotedAt: string | null) {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    setIsPolling(true)
    let attempts = 0

    const poll = async () => {
      attempts += 1
      const result = await loadLatestShippingQuotes(orderId)

      if (!result.success || !result.data) {
        stopPolling()
        toast.error("Failed to refresh quotes", { description: result.error })
        return
      }

      const batch = result.data
      if (batch.quotedAt && batch.quotedAt !== previousQuotedAt) {
        stopPolling()
        setQuotes(batch.quotes)
        setQuotedAt(batch.quotedAt)

        // Commit whatever the ENGINE selected, not simply the cheapest row.
        // The engine treats quotes within a few percent of each other as the
        // same price and breaks the tie on carrier, so the cheapest row is
        // regularly not the one it chose -- overriding it here would quietly
        // undo that rule.
        const engineChoice = batch.quotes.find((quote) => quote.is_selected)
        if (engineChoice) {
          const applied = await selectShippingQuote(engineChoice.id, orderId)
          if (applied.success) {
            router.refresh()
            toast.success(
              `Quoted — ${formatMethod(engineChoice.shipping_method)} at ${formatMoney(engineChoice.quoted_rate)}`
            )
            return
          }
        }
        toast.success("Shipping quotes updated", {
          description: engineChoice
            ? "The order's shipping method was left unchanged."
            : "No option could be priced for this order.",
        })
        return
      }

      if (attempts >= POLL_MAX_ATTEMPTS) {
        stopPolling()
        toast.message("Still waiting for quotes", {
          description:
            "The quote job is taking longer than expected. Keep working and reload in a moment.",
        })
        return
      }

      pollTimer.current = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    pollTimer.current = window.setTimeout(poll, POLL_INTERVAL_MS)
  }

  function handleReQuote() {
    startTrigger(async () => {
      const result = await triggerShippingQuote(orderId)
      if (!result.success) {
        toast.error("Failed to start the quote job", { description: result.error })
        return
      }
      pollForNewBatch(quotedAt)
      toast.success("Quote job started", {
        description: "Rates will appear here as soon as the batch is ready.",
      })
    })
  }

  async function handleSelect(quote: ShippingQuoteRow) {
    setSelectingId(quote.id)
    const result = await selectShippingQuote(quote.id, orderId)
    setSelectingId(null)

    if (!result.success) {
      toast.error("Failed to select this quote", { description: result.error })
      return
    }
    setQuotes((previous) =>
      previous.map((row) => ({ ...row, is_selected: row.id === quote.id }))
    )
    router.refresh()
    toast.success(`Shipping method set to ${formatMethod(quote.shipping_method)}`)
  }

  async function handleClear() {
    const confirmed = await confirm({
      title: "Clear shipping quotes",
      description:
        "Every quote batch on this order is deleted permanently. The order's shipping method is left as it is.",
      confirmText: "Clear quotes",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return

    startClear(async () => {
      const result = await clearShippingQuotes(orderId)
      if (!result.success) {
        toast.error("Failed to clear quotes", { description: result.error })
        return
      }
      setQuotes([])
      setQuotedAt(null)
      toast.success("Shipping quotes cleared")
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Truck className="size-4 text-muted-foreground" />
            <CardTitle>Shipping Quotes</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            {quotedAt ? `Quoted ${formatDateTime(quotedAt)} · ` : ""}
            Actual {formatWeightKg(totalWeightKg)} · Chargeable{" "}
            {formatWeightKg(chargeableWeightKg)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {quotes.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={isClearing || isPolling}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Clear quotes
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleReQuote}
            disabled={isTriggering || isPolling}
          >
            <RefreshCw
              className={cn("size-3.5", (isTriggering || isPolling) && "animate-spin")}
            />
            {isPolling ? "Waiting for quotes…" : "Re-quote shipping"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {showEstimateWarning && (
          <p className="flex items-start gap-1.5 px-6 pb-3 text-xs text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            The packed size behind these rates is an estimate, so the satchel and
            box options may not reflect what actually fits.
          </p>
        )}

        {quotes.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No quotes yet. Re-quote shipping to price this order against every
            available carrier.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {priced.map((quote) => (
                  <TableRow
                    key={quote.id}
                    className={cn(quote.is_selected && "bg-success/10")}
                  >
                    <TableCell>
                      <MethodCell method={quote.shipping_method} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {quote.carrier_name}
                    </TableCell>
                    <TableCell className="text-sm">{quote.zone ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(quote.quoted_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {quote.is_selected ? (
                        <Badge variant="success">
                          <CheckCircle2 />
                          Selected
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={selectingId !== null}
                          onClick={() => handleSelect(quote)}
                        >
                          Select
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

                {/* Kept rather than hidden: a flat-rate group where nothing fits
                    reports its reason on every size, and dropping those rows
                    would silently shorten the list with no explanation. */}
                {failed.map((quote) => (
                  <TableRow key={quote.id} className="opacity-60">
                    <TableCell>
                      <MethodCell method={quote.shipping_method} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {quote.carrier_name}
                    </TableCell>
                    <TableCell className="text-sm">{quote.zone ?? "—"}</TableCell>
                    <TableCell
                      className="text-right text-xs text-muted-foreground"
                      colSpan={2}
                    >
                      {quote.error_message}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MethodCell({ method }: { method: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium whitespace-nowrap">
        {formatMethod(method)}
      </span>
      {isExpressMethod(method) && <Badge variant="warning">Express</Badge>}
      {isFlatRateMethod(method) && <Badge variant="info">Flat rate</Badge>}
    </div>
  )
}
