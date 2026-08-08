"use client"

import { AlertTriangle, ImageOff } from "lucide-react"

import type { OrderTransaction } from "@/lib/queries/orders"
import { formatMoney } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// The panel under an expanded order row: what the platform sold, one line per
// transaction. The picked items each line expands into are a separate fact and
// live on the order detail page (docs/orders-ui.md 6.1) -- this summary only
// flags that an unresolved one exists, so those 313 lines are visible from the
// list rather than only to someone who already opened the order.
export function OrderRowDetail({
  transactions,
  loading,
  error,
}: {
  // Undefined until the lines have been fetched for this order.
  transactions: OrderTransaction[] | undefined
  loading: boolean
  error: string | null
}) {
  if (loading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="py-2 text-sm text-destructive">
        Failed to load order lines: {error}
      </p>
    )
  }

  if (!transactions || transactions.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {/* 25 orders carry no transaction lines at all. That is a real state in
            the migrated data, not a loading failure. */}
        This order has no transaction lines.
      </p>
    )
  }

  return (
    <div className="py-2">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">Image</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Line total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id} className="hover:bg-transparent">
              <TableCell>
                {transaction.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={transaction.image_url}
                    alt={transaction.item_title ?? "Product"}
                    className="size-10 rounded-md object-cover"
                  />
                ) : (
                  // No image resolves for two different reasons -- the SKU
                  // matches no product, or the product has no photo -- and
                  // neither is worth two placeholders.
                  <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ImageOff className="size-4" />
                  </div>
                )}
              </TableCell>
              <TableCell className="max-w-md">
                <div className="flex items-center gap-2">
                  <span className="truncate">
                    {transaction.item_title ?? "—"}
                  </span>
                  {transaction.hasUnresolved && (
                    <Badge variant="warning" title="A picked line has no product">
                      <AlertTriangle data-icon="inline-start" />
                      Unresolved
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {transaction.custom_label ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.quantity}
              </TableCell>
              {/* Negative prices are legitimate: refunds were recorded as
                  negative transaction lines (docs/orders-ui.md 2). */}
              <TableCell className="text-right tabular-nums">
                {formatMoney(transaction.sale_price)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(transaction.sale_price * transaction.quantity)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
