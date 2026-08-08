"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, Copy, MoreHorizontal, Pencil } from "lucide-react"
import { toast } from "sonner"

import type { OrderListRow, OrderTransaction } from "@/lib/queries/orders"
import { loadOrderTransactions } from "@/lib/actions/order"
import { formatDate, formatMoney } from "@/lib/format"
import { displayShippingMethod } from "@/lib/orders/shipping-method"
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
import { cn } from "@/lib/utils"
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

  // chevron + Invoice + Date + [Customer] + Platform + Status + Items + Total
  // + Shipping + Dispatched + actions.
  const columnCount = showCustomer ? 11 : 10

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

  async function copyInvoice(invoiceNumber: string) {
    try {
      await navigator.clipboard.writeText(invoiceNumber)
      toast.success(`Copied ${invoiceNumber}`)
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded browsers. Failing silently would look like the click missed.
      toast.error("Could not copy to the clipboard")
    }
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
                      {row.transaction_count}
                    </TableCell>
                    {/* Not sortable, by design: ordering by this would mean
                        aggregating all 250413 transaction rows on every page
                        change (docs/orders-ui.md 3.3). */}
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.order_total)}
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
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/orders/${row.id}`}>
                              <Pencil />
                              View and edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void copyInvoice(row.invoice_number)}
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
