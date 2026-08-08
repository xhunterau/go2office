"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ImageOff,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import type { OrderPickedItem, OrderTransaction } from "@/lib/queries/orders"
import { deleteOrderTransaction } from "@/lib/actions/order"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useConfirm } from "@/components/providers/confirm-provider"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TransactionCreateDialog } from "./transaction-create-dialog"
import { TransactionEditDialog } from "./transaction-edit-dialog"

const COLUMN_COUNT = 7

// Two levels, visibly nested: a transaction is what the platform sold, the rows
// under it are what the warehouse picked. A kit sells as one line and is picked
// as several, so flattening the two would lose one of them
// (docs/orders-ui.md 6.1).
export function OrderTransactionsTable({
  orderId,
  transactions,
}: {
  orderId: number
  transactions: OrderTransaction[]
}) {
  const confirm = useConfirm()
  // One row at a time, as everywhere else in the app.
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [editing, setEditing] = React.useState<OrderTransaction | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function openEditor(transaction: OrderTransaction) {
    setEditing(transaction)
    setDialogOpen(true)
  }

  // The picked lines go with it (order_items.transaction_id is ON DELETE
  // CASCADE), so the count is named -- on a kit line that is several rows
  // disappearing from a table the user may have collapsed.
  async function handleDelete(transaction: OrderTransaction) {
    const itemCount = transaction.items.length
    const ok = await confirm({
      title: "Delete line",
      description: `This removes the line from the order along with ${itemCount} picked ${
        itemCount === 1 ? "item" : "items"
      }, and changes the order total. This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteOrderTransaction(transaction.id, orderId)
      if (result.success) {
        toast.success("Line deleted")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          Transactions ({transactions.length})
        </h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          Add line
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Item</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  {/* A real state in the migrated data: 25 orders have no
                      transaction lines at all. */}
                  This order has no transaction lines.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((transaction) => {
                const expanded = expandedId === transaction.id

                return (
                  <React.Fragment key={transaction.id}>
                    <TableRow className={cn(expanded && "border-b-0")}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() =>
                            setExpandedId(expanded ? null : transaction.id)
                          }
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? "Hide picked items"
                              : "Show picked items"
                          }
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="truncate">
                            {transaction.item_title ?? "—"}
                          </span>
                          {/* On the parent row, not only inside the expansion:
                              everything is collapsed by default, so marking it
                              only below would keep 313 unresolved lines
                              invisible to anyone who does not already know to
                              look (docs/orders-ui.md 4.3 decision D). */}
                          {transaction.hasUnresolved && (
                            <Badge variant="warning">
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
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(transaction.sale_price)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(
                          transaction.sale_price * transaction.quantity
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled={isPending}
                              aria-label={`Actions for ${
                                transaction.item_title ?? "this line"
                              }`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => openEditor(transaction)}
                            >
                              <Pencil />
                              Edit line
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void handleDelete(transaction)}
                            >
                              <Trash2 />
                              Delete line
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={COLUMN_COUNT}
                          className="bg-muted/30"
                        >
                          <PickedItems items={transaction.items} />
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

      {/* Mounted per open so the product picker and the form start clean each
          time, without a reset effect. */}
      {createOpen && (
        <TransactionCreateDialog
          onOpenChange={setCreateOpen}
          orderId={orderId}
        />
      )}

      {editing && (
        <TransactionEditDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          orderId={orderId}
          transaction={editing}
        />
      )}
    </div>
  )
}

function PickedItems({ items }: { items: OrderPickedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {/* 3026 transactions came across with no picked lines and cannot be
            recalculated (docs/orders-domain-migration.md). */}
        No picked items recorded for this line.
      </p>
    )
  }

  return (
    <div className="space-y-2 py-2">
      <p className="text-xs font-medium text-muted-foreground">Picked items</p>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">Image</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const unresolved = item.product_id === null

            return (
              <TableRow
                key={item.id}
                className={cn(
                  "hover:bg-transparent",
                  // The SKU no longer matches any product. sku_snapshot is the
                  // only lead left, and this round has no way to reassign it --
                  // the repair queue is deliberately out of scope
                  // (docs/orders-ui.md 6.5).
                  unresolved && "bg-warning/10"
                )}
              >
                <TableCell>
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt={item.product_name ?? item.sku_snapshot ?? "Product"}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    // Same single placeholder as everywhere else: an unresolved
                    // SKU and a product without a photo are not worth two
                    // different pictures.
                    <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="size-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {item.product_id !== null ? (
                      <Link
                        href={`/products/${item.product_id}`}
                        className="hover:underline"
                      >
                        {item.sku_snapshot ?? "—"}
                      </Link>
                    ) : (
                      <span>{item.sku_snapshot ?? "—"}</span>
                    )}
                    {unresolved && (
                      <Badge variant="warning">
                        <AlertTriangle data-icon="inline-start" />
                        Unresolved
                      </Badge>
                    )}
                    {/* Quiet, not a column: all 250687 migrated rows are false
                        (what actually shipped), and only trigger-generated rows
                        are true (docs/orders-ui.md 6.6). */}
                    {item.is_auto_generated && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Sparkles
                            className="size-3.5 text-muted-foreground"
                            aria-label="Generated from current kit contents"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          Generated from the current kit contents, not a record
                          of what shipped
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.product_name ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.location_name ?? "—"}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
