"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  FileText,
  GitBranch,
  MoreHorizontal,
  Package,
  Pencil,
} from "lucide-react"
import { toast } from "sonner"

import type { OrderDetail } from "@/lib/queries/orders"
import { createFollowUpOrder } from "@/lib/actions/order"
import { formatDate } from "@/lib/format"
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VARIANTS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
import { useConfirm } from "@/components/providers/confirm-provider"
import { CopyButton } from "@/components/copy-button"
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

  // Both print routes render a PDF inline, so a new tab lands on the browser's
  // own viewer with its print dialog one keystroke away. The shipping label is
  // offered whatever the carrier: the A6 sheet is only the real label for the
  // self-print methods, but reprinting one as a picking aid or a spare is a
  // normal thing to want and there is no harm in the paper.
  function openPrint(path: string) {
    window.open(`${path}?ids=${order.id}`, "_blank", "noopener")
  }

  async function handleFollowUp() {
    const ok = await confirm({
      title: "Create follow-up order",
      description:
        `A new empty order will be created for ${
          order.customers?.full_name ?? "this customer"
        }, numbered after ${order.invoice_number}. Add the lines to it yourself — nothing is copied across.`,
      confirmText: "Create",
      cancelText: "Cancel",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await createFollowUpOrder(order.id)
      if (!result.success || !result.data) {
        toast.error(result.error ?? "Something went wrong")
        return
      }
      const { orderId, invoiceNumber } = result.data
      toast.success(`Created ${invoiceNumber}`, {
        action: {
          label: "Open",
          onClick: () => window.open(`/orders/${orderId}`, "_blank", "noopener"),
        },
      })
      window.open(`/orders/${orderId}`, "_blank", "noopener")
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
            {/* Next to the number rather than in the ⋯ menu: it is copied
                constantly, and two clicks made it slower than selecting the
                text by hand. */}
            <CopyButton value={order.invoice_number} label="invoice number" />
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
              <Button
                variant="outline"
                size="icon"
                aria-label="More actions"
                disabled={isPending}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            {/* An explicit width because the default is the trigger's
                (w-(--radix-dropdown-menu-trigger-width)), and this trigger is a
                36px icon button -- the menu collapses to its 128px minimum and
                wraps every label onto three lines. w-56 matches user-nav. */}
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={isPending}
                onSelect={(event) => {
                  // Keep the menu's close animation from unmounting the trigger
                  // before the confirmation dialog has taken focus.
                  event.preventDefault()
                  void handleFollowUp()
                }}
              >
                <GitBranch />
                Create follow-up order
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openPrint("/api/print/invoice")}>
                <FileText />
                Print invoice
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openPrint("/api/print/shipping-label")}
              >
                <Package />
                Print shipping label
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
