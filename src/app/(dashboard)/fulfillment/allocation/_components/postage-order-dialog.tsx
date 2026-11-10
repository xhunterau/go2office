"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  Package,
  Phone,
  RefreshCw,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProductThumb } from "@/components/products/product-thumb"
import { loadOrderContents } from "@/lib/actions/allocation"
import type { PostageStageOrder } from "@/lib/queries/allocation"
import type { OrderTransaction } from "@/lib/queries/orders"
import type { ShippingQuoteRow } from "@/lib/queries/shipping-quotes"
// 62% of listing titles carry their variant in trailing brackets, which a CSS
// truncate drops -- the four Beston battery lines in this queue then render
// identically. Clips the middle instead.
import { shortenItemTitle } from "@/lib/orders/item-title"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
// The one implementation of "which of the four address lines belong on a
// label". 114,161 of the 114,193 non-empty address_line3 values are `ebay:xxxx`
// reference codes rather than addresses, so concatenating the columns puts an
// eBay reference where a street should be (CLAUDE.md rule 24).
import { usableAddressLines } from "@/lib/fulfillment/csv"
// Reused rather than re-detected: this is the same predicate that drops Aramex
// from an order's quotes, so the badge it drives here explains a carrier list
// the operator is looking at.
import { isPostalOnlyAddress } from "@/lib/shipping/postal-address"
import {
  formatDate,
  formatDimensionsMm,
  formatMoney,
  formatWeightKg,
} from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * One order in the Postage queue, in full, with its rates.
 *
 * Replaces an expanding table row. The row could only ever widen to the table's
 * own columns, which is why the queue grew to show eight numbers and none of
 * the things the decision actually turns on: what is in the box, where it is
 * going, how big the thing is and whether that size is a measurement or a
 * guess. All of that is here, and so is Approve, so the operator never has to
 * leave for /orders/[id] and lose their place in the queue.
 */
export function PostageOrderDialog({
  order,
  position,
  total,
  onNavigate,
  approvingQuote,
  requoting,
  disabled,
  onApprove,
  onRequote,
  onManual,
  onOpenChange,
}: {
  order: PostageStageOrder | null
  /** 1-based index of this order in the queue, for "3 of 21". */
  position: number
  total: number
  onNavigate: (step: -1 | 1) => void
  approvingQuote: number | null
  requoting: boolean
  disabled: boolean
  onApprove: (quote: ShippingQuoteRow) => void
  onRequote: () => void
  onManual: () => void
  onOpenChange: (open: boolean) => void
}) {
  // Carries the id it belongs to rather than being cleared when the id
  // changes: stepping to the next order would otherwise need a setState in the
  // effect body to blank the previous order's lines, and the stale render in
  // between would show one order's contents under another's header. Keyed, the
  // mismatch simply reads as "not loaded yet".
  const [loaded, setLoaded] = React.useState<{
    orderId: number
    transactions: OrderTransaction[] | null
    error: string | null
  } | null>(null)

  const orderId = order?.id ?? null

  React.useEffect(() => {
    if (orderId === null) return

    let active = true
    void loadOrderContents(orderId).then((result) => {
      if (!active) return
      setLoaded({
        orderId,
        transactions: result.success ? (result.data ?? []) : null,
        error: result.success
          ? null
          : (result.error ?? "Could not load the order lines"),
      })
    })

    return () => {
      active = false
    }
  }, [orderId])

  const current = loaded !== null && loaded.orderId === orderId ? loaded : null

  if (!order) return null

  const priced = order.quotes.filter((quote) => !quote.error_message && quote.quoted_rate > 0)
  const failed = order.quotes.filter((quote) => quote.error_message || quote.quoted_rate <= 0)
  const cheapest = priced.length > 0 ? Math.min(...priced.map((q) => q.quoted_rate)) : null
  const customer = order.customer
  const metrics = order.metrics

  const addressLines = customer ? usableAddressLines(customer) : []
  const postalOnly = customer
    ? isPostalOnlyAddress(
        customer.address_line1,
        customer.address_line2,
        customer.address_line3,
        customer.address_line4
      )
    : false

  const packedSize = metrics
    ? formatDimensionsMm(
        metrics.packed_length_mm,
        metrics.packed_width_mm,
        metrics.packed_height_mm
      )
    : null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* Wide because the rate table sets the floor, not by preference: six
          columns, and the Method cell alone carries a label as long as "MyPost
          Regular XS Satchel" plus up to two badges. At 3xl the rates wrapped
          and the zone column was unreadable.

          Rule 12: never taller than the viewport, and scrolls rather than
          clipping. The quote table alone can run to two dozen rows. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {order.invoice_number}
            <Badge variant="secondary">{SALES_PLATFORM_LABELS[order.platform]}</Badge>
            <Link
              href={`/orders/${order.id}`}
              className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open order <ExternalLink className="size-3" />
            </Link>
          </DialogTitle>
          <DialogDescription>
            {formatDate(order.posted_on_date ?? order.created_at)} · Customer paid{" "}
            {formatMoney(order.postage_and_handling)} postage
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Summary stacked in a third of the width, lines in the other two:
              the address and the figures are short and read as a column, while
              the lines are a table and want the room. Both collapse to full
              width below lg, where the dialog is the viewport anyway. */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="flex flex-col gap-5">
              <ShipTo
                customer={customer}
                addressLines={addressLines}
                postalOnly={postalOnly}
              />
              <WeightAndSize metrics={metrics} packedSize={packedSize} />
            </div>

            <div className="lg:col-span-2">
              <Contents
                transactions={current?.transactions ?? null}
                loading={current === null}
                error={current?.error ?? null}
              />
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Rates
            </h3>
            {order.quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rates yet. Use <strong>Quote all</strong> on the queue, or
                re-quote just this order below.
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
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {/* Walking the queue without closing the dialog: 21 orders at one
                dialog each is 42 extra clicks, and the operator loses their
                place in the list on every one. */}
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={position <= 1}
                onClick={() => onNavigate(-1)}
                aria-label="Previous order"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                {position} of {total}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={position >= total}
                onClick={() => onNavigate(1)}
                aria-label="Next order"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
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
                Re-quote
              </Button>
              <Button size="sm" variant="outline" disabled={disabled} onClick={onManual}>
                Approve without a quote
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShipTo({
  customer,
  addressLines,
  postalOnly,
}: {
  customer: PostageStageOrder["customer"]
  addressLines: string[]
  postalOnly: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Ship to
      </h3>

      {customer === null ? (
        <p className="text-sm text-muted-foreground">No customer on this order.</p>
      ) : (
        <div className="flex flex-col gap-1.5 text-sm">
          <div>
            <p className="font-medium">{customer.full_name?.trim() || "—"}</p>
            {customer.company_name?.trim() ? (
              <p className="text-muted-foreground">{customer.company_name}</p>
            ) : null}
          </div>

          <div className="text-muted-foreground">
            {addressLines.length === 0 ? (
              <p className="text-warning-foreground">No usable street address.</p>
            ) : (
              addressLines.map((line, index) => <p key={index}>{line}</p>)
            )}
            <p className="tabular-nums">
              {[customer.city, customer.state, customer.postcode]
                .map((part) => part?.trim())
                .filter(Boolean)
                .join("  ")}
            </p>
          </div>

          {postalOnly ? (
            <Badge variant="info" className="w-fit">
              PO Box / bag — Australia Post only
            </Badge>
          ) : null}

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {customer.phone?.trim() ? (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3" /> {customer.phone}
              </span>
            ) : null}
            {customer.email?.trim() ? (
              <span className="inline-flex items-center gap-1.5 break-all">
                <Mail className="size-3" /> {customer.email}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

function WeightAndSize({
  metrics,
  packedSize,
}: {
  metrics: PostageStageOrder["metrics"]
  packedSize: string | null
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Weight &amp; size
      </h3>

      {metrics === null ? (
        <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          No row in order_metrics_summary, so there is no weight or size to quote
          against. Quoting fails until the metrics are rebuilt from the order
          page.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 text-sm">
          <Figure label="Actual weight" value={formatWeightKg(metrics.total_weight_kg)} />
          {/* The number the carrier bills on -- the greater of real and
              volumetric weight. The queue used to show actual weight only,
              which is the wrong number to pick a tier against. */}
          <Figure
            label="Chargeable"
            value={formatWeightKg(metrics.chargeable_weight_kg)}
            emphasis
          />
          <Figure label="Packed size" value={packedSize ?? "—"} />
          <Figure label="Lines" value={String(metrics.total_items)} />

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {metrics.has_estimated_dimensions ? (
              <Badge variant="warning">Estimated size</Badge>
            ) : null}
            {metrics.unresolved_item_count > 0 ? (
              <Badge variant="warning">
                {metrics.unresolved_item_count} line
                {metrics.unresolved_item_count === 1 ? "" : "s"} unresolved
              </Badge>
            ) : null}
          </div>

          {metrics.has_estimated_dimensions ? (
            <p className="text-xs text-muted-foreground">
              At least one product has no measured dimensions and fell back to
              10&nbsp;mm, so the packed size is a guess rather than a
              measurement.
            </p>
          ) : null}
          {metrics.unresolved_item_count > 0 ? (
            <p className="text-xs text-warning-foreground">
              Unresolved lines carry a quantity but no weight, size or cost, so
              every figure above is understated.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function Figure({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", emphasis && "font-medium")}>{value}</span>
    </div>
  )
}

function Contents({
  transactions,
  loading,
  error,
}: {
  transactions: OrderTransaction[] | null
  loading: boolean
  error: string | null
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        What&apos;s in it
      </h3>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading lines…
        </p>
      ) : error ? (
        <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : transactions === null || transactions.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="size-3.5" /> No lines on this order.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Item</TableHead>
                {/* Fixed widths on everything except Item, so the title is what
                    absorbs the slack instead of pushing these off the edge. */}
                <TableHead className="w-32">SKU</TableHead>
                <TableHead className="w-12 text-right">Qty</TableHead>
                <TableHead className="w-20 text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {/* The sold product's own photo, resolved from
                        custom_label -- not the first picked item's, which on a
                        kit would be one component standing in for the bundle
                        (queries/orders.ts). 19 of the 21 lines in the queue
                        have one. */}
                    <ProductThumb
                      src={transaction.image_url}
                      alt={transaction.item_title ?? transaction.custom_label}
                    />
                  </TableCell>
                  {/* max-w is what makes the clipping real: the table is
                      table-auto, so without a ceiling the cell just grows to
                      fit and no CSS truncation can ever trigger. */}
                  <TableCell className="max-w-[20rem] text-sm">
                    <span title={transaction.item_title ?? undefined}>
                      {shortenItemTitle(transaction.item_title) || "—"}
                    </span>
                    {/* Surfaced on the line itself: a kit expands into picked
                        components, and an unresolved one contributes no weight
                        to the figures above. */}
                    {transaction.hasUnresolved ? (
                      <Badge variant="warning" className="mt-1 flex w-fit">
                        Unresolved SKU
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all text-muted-foreground">
                    {transaction.custom_label?.trim() || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {transaction.quantity}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatMoney(transaction.sale_price)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
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
              <TableCell className="text-sm font-medium">
                <span className="whitespace-nowrap">
                  {SHIPPING_METHOD_LABELS[quote.shipping_method]}
                </span>
                {/* Badges on their own line rather than trailing the label. The
                    two can both apply at once -- the engine's pick often IS the
                    cheapest -- and inline they pushed this column past 350px,
                    which is what squeezed the zone and rate columns. */}
                {(cheapest !== null && quote.quoted_rate === cheapest) ||
                quote.is_selected ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {/* A hint, not a default. The operator picks; nothing here
                        is pre-selected and no row is hidden for being
                        expensive. */}
                    {cheapest !== null && quote.quoted_rate === cheapest ? (
                      <Badge variant="info">Cheapest</Badge>
                    ) : null}
                    {quote.is_selected ? (
                      <Badge variant="secondary">Engine pick</Badge>
                    ) : null}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                {quote.carrier_name}
              </TableCell>
              {/* Zone names run to "Near State Remote"; wrapped, they read as
                  two unrelated words stacked. */}
              <TableCell className="text-sm whitespace-nowrap">
                {quote.zone ?? "—"}
              </TableCell>
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
 *
 * Lives here rather than in the queue component because both use it and the
 * queue imports this file, not the other way round.
 */
export function Margin({
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
