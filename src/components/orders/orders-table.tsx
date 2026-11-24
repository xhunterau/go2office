"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronDown, ChevronRight, Copy, MoreHorizontal, Pencil } from "lucide-react"

import type { OrderListRow, OrderTransaction } from "@/lib/queries/orders"
import { loadOrderTransactions } from "@/lib/actions/order"
import { formatDate, formatMoney, formatWeightKg } from "@/lib/format"
import { displayShippingMethod } from "@/lib/orders/shipping-method"
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
import { detailHref } from "@/lib/navigation/list-return"
import { cn } from "@/lib/utils"
import { CopyButton, copyToClipboard } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { OrderRowDetail } from "@/components/orders/order-row-detail"
import { OrdersBulkBar } from "@/components/orders/orders-bulk-bar"

// The same table serves /orders and the order history on /customers/[id]; the
// latter drops the Customer column because every row would repeat the customer
// whose page it is (project rule 5, same reasoning as the inventory components
// in src/components/inventory).
export function OrdersTable({
  rows,
  showCustomer = true,
  emptyMessage = "No orders found.",
  selectable = false,
  linkBackToList = false,
}: {
  rows: OrderListRow[]
  showCustomer?: boolean
  emptyMessage?: string
  /**
   * Tick boxes and the bulk status / shipping-method bar. On for /orders only;
   * a customer's order history is not a place to re-route parcels from.
   * Selection is the current page only -- the parent remounts this table when
   * the page or the filters change, which is what clears it.
   */
  selectable?: boolean
  /**
   * Carry the current URL's query into the order links so the detail page's
   * back link returns to the same filters (lib/navigation/list-return.ts). On
   * for /orders only: the customer page's query is not an order list's.
   */
  linkBackToList?: boolean
}) {
  const searchParams = useSearchParams()
  const orderHref = (id: number) =>
    detailHref(`/orders/${id}`, linkBackToList ? searchParams.toString() : "")

  // One row open at a time, as on /inventory: two expanded line lists push the
  // rest of the page off screen without helping anyone compare them.
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [lines, setLines] = React.useState<Record<number, OrderTransaction[]>>({})
  const [loadingId, setLoadingId] = React.useState<number | null>(null)
  // Scoped to the expanded row, which is the only place it can be shown.
  const [linesError, setLinesError] = React.useState<string | null>(null)

  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<number>>(
    () => new Set()
  )
  // Intersected with what is on screen, so a row that left the page after a
  // refresh (its status moved it out of the tab) cannot stay selected unseen.
  const selectedRows = rows.filter((row) => selectedIds.has(row.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length

  function toggleRow(id: number, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(rows.map((row) => row.id)) : new Set())
  }

  // [select] + chevron + Invoice + Date + [Customer] + Platform + Status + Items + Weight
  // + Total + Shipping + Tracking + Dispatched + actions.
  const columnCount = (showCustomer ? 13 : 12) + (selectable ? 1 : 0)

  const loadLines = React.useCallback(async (orderId: number) => {
    setLoadingId(orderId)
    const result = await loadOrderTransactions(orderId)
    setLoadingId((current) => (current === orderId ? null : current))

    const loaded = result.data
    if (!result.success || !loaded) {
      setLinesError(result.error ?? "Something went wrong")
      return
    }
    setLines((current) => ({ ...current, [orderId]: loaded }))
  }, [])

  function toggle(orderId: number) {
    if (expandedId === orderId) {
      setExpandedId(null)
      return
    }
    setExpandedId(orderId)
    setLinesError(null)
    if (!lines[orderId]) void loadLines(orderId)
  }

  return (
    <div className="flex flex-col gap-3">
      {selectable && selectedRows.length > 0 && (
        <OrdersBulkBar
          selected={selectedRows}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : selectedRows.length > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    disabled={rows.length === 0}
                    aria-label="Select all orders on this page"
                  />
                </TableHead>
              )}
              <TableHead className="w-10" />
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              {showCustomer && <TableHead>Customer</TableHead>}
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
              {/* Chargeable, not actual: it is what the carrier bills, and it is
                the number that decides which satchel this order fits. */}
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Shipping</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead>Dispatched</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const expanded = expandedId === row.id
                const customer = row.customers
                const customerName =
                  customer?.full_name ??
                  customer?.platform_user_id ??
                  customer?.email ??
                  "—"
                const shipping = displayShippingMethod(row)

                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      className={cn(expanded && "border-b-0")}
                      data-state={selectedIds.has(row.id) ? "selected" : undefined}
                    >
                      {selectable && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(row.id)}
                            onCheckedChange={(checked) =>
                              toggleRow(row.id, checked === true)
                            }
                            aria-label={`Select ${row.invoice_number}`}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => toggle(row.id)}
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `Hide lines for ${row.invoice_number}`
                              : `Show lines for ${row.invoice_number}`
                          }
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1">
                          <Link href={orderHref(row.id)} className="hover:underline">
                            {row.invoice_number}
                          </Link>
                          <CopyButton value={row.invoice_number} label="invoice number" />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.created_at)}
                      </TableCell>
                      {showCustomer && (
                        <TableCell className="max-w-48 truncate">
                          <Link
                            href={`/customers/${row.customer_id}`}
                            className="hover:underline"
                          >
                            {customerName}
                          </Link>
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline">
                          {SALES_PLATFORM_LABELS[row.platform]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ORDER_STATUS_VARIANTS[row.status]}>
                          {ORDER_STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.metrics.transaction_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        <span
                          className={cn(
                            row.metrics.has_estimated_dimensions &&
                              "underline decoration-dotted underline-offset-2"
                          )}
                          title={
                            row.metrics.has_estimated_dimensions
                              ? "Estimated: at least one product has no recorded size"
                              : undefined
                          }
                        >
                          {formatWeightKg(row.metrics.chargeable_weight_kg)}
                        </span>
                      </TableCell>
                      {/* Not sortable, and settled: sorting by amount was
                        considered when order_metrics_summary replaced the
                        order_totals view and declined on 2026-08-08. The old
                        reason (aggregating 250413 rows per page) is gone, but
                        PostgREST cannot order a parent row set by an embedded
                        resource's column, so it would mean driving this query
                        from the summary table and rewriting every filter.
                        See docs/order-metrics.md 9 -- this is a closed decision,
                        not a to-do. */}
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.metrics.order_total)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap",
                          (shipping.isRetired || shipping.isEmpty) &&
                            "text-muted-foreground"
                        )}
                      >
                        {shipping.label}
                        {shipping.isRetired && (
                          <span className="ml-1 text-xs">(retired)</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.tracking_number ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs">
                              {row.tracking_number}
                            </span>
                            <CopyButton
                              value={row.tracking_number}
                              label="tracking number"
                            />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.posted_on_date)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`Actions for ${row.invoice_number}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          {/* Width set for the same reason as the detail
                            header's: an icon-button trigger otherwise squeezes
                            the menu to 128px and wraps the labels. */}
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem asChild>
                              <Link href={orderHref(row.id)}>
                                <Pencil />
                                View and edit
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void copyToClipboard(row.invoice_number)}
                            >
                              <Copy />
                              Copy invoice number
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={columnCount} className="bg-muted/30">
                          <OrderRowDetail
                            transactions={lines[row.id]}
                            loading={loadingId === row.id}
                            error={linesError}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
