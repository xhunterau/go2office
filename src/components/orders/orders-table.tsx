"use client"

import * as React from "react"
import Link from "next/link"
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
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/components/copy-button"
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
import { OrderRowDetail } from "@/components/orders/order-row-detail"

// The same table serves /orders and the order history on /customers/[id]; the
// latter drops the Customer column because every row would repeat the customer
// whose page it is (project rule 5, same reasoning as the inventory components
// in src/components/inventory).
export function OrdersTable({
  rows,
  showCustomer = true,
  emptyMessage = "No orders found.",
}: {
  rows: OrderListRow[]
  showCustomer?: boolean
  emptyMessage?: string
}) {
  // One row open at a time, as on /inventory: two expanded line lists push the
  // rest of the page off screen without helping anyone compare them.
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [lines, setLines] = React.useState<Record<number, OrderTransaction[]>>({})
  const [loadingId, setLoadingId] = React.useState<number | null>(null)
  // Scoped to the expanded row, which is the only place it can be shown.
  const [linesError, setLinesError] = React.useState<string | null>(null)

  // chevron + Invoice + Date + [Customer] + Platform + Status + Items + Weight
  // + Total + Shipping + Dispatched + actions.
  const columnCount = showCustomer ? 12 : 11

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
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
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
                  <TableRow className={cn(expanded && "border-b-0")}>
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
                      <Link
                        href={`/orders/${row.id}`}
                        className="hover:underline"
                      >
                        {row.invoice_number}
                      </Link>
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
                            <Link href={`/orders/${row.id}`}>
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
                      <TableCell
                        colSpan={columnCount}
                        className="bg-muted/30"
                      >
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
  )
}
