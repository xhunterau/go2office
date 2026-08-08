"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Copy, MoreHorizontal, Pencil, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import type { OrderDetail } from "@/lib/queries/orders"
import { rebuildOrderItems } from "@/lib/actions/order"
import { formatDate } from "@/lib/format"
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OrderEditDialog } from "./order-edit-dialog"

export function OrderDetailHeader({ order }: { order: OrderDetail }) {
  const confirm = useConfirm()
  const [editOpen, setEditOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  async function copyInvoice() {
    try {
      await navigator.clipboard.writeText(order.invoice_number)
      toast.success(`Copied ${order.invoice_number}`)
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  // The only supported way to bring an order's picked lines up to the current
  // kit contents -- and destructive with no undo, because it replaces what was
  // actually shipped (docs/orders-ui.md 6.4).
  async function handleRebuild() {
    const ok = await confirm({
      title: "Rebuild picked items",
      description:
        "This replaces what was actually shipped with today's kit contents. Every picked line on this order is deleted and regenerated, manual pick locations and hand-corrected lines are lost, and there is no undo.",
      confirmText: "Rebuild",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await rebuildOrderItems(order.id)
      if (result.success) {
        toast.success(
          `Rebuilt ${result.data?.rowsWritten ?? 0} picked ${
            result.data?.rowsWritten === 1 ? "line" : "lines"
          }`
        )
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/orders"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">
              {order.invoice_number}
            </h1>
            <Badge variant={ORDER_STATUS_VARIANTS[order.status]}>
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            <Badge variant="outline">
              {SALES_PLATFORM_LABELS[order.platform]}
            </Badge>
          </div>
          {/* No "last updated": every one of the 203315 rows carries the
              migration timestamp, so showing it would claim the order was
              touched yesterday (docs/orders-ui.md 4.2.3). */}
          <p className="text-sm text-muted-foreground">
            Created {formatDate(order.created_at)}
            {order.posted_on_date
              ? ` · Dispatched ${formatDate(order.posted_on_date)}`
              : " · Not dispatched"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyInvoice()}>
                <Copy />
                Copy invoice number
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending}
                onSelect={(event) => {
                  // Keep the menu's close animation from unmounting the trigger
                  // before the confirmation dialog has taken focus.
                  event.preventDefault()
                  void handleRebuild()
                }}
              >
                <RefreshCw />
                Rebuild picked items
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <OrderEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        order={order}
      />
    </div>
  )
}
