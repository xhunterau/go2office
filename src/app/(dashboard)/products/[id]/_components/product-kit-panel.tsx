"use client"

import * as React from "react"
import { Boxes, Plus } from "lucide-react"
import { toast } from "sonner"

import type { ProductKitItem } from "@/lib/queries/product-kit-items"
import { removeKitItem } from "@/lib/actions/product-kit-item"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ProductKitItemDialog,
  type KitItemToEdit,
} from "./product-kit-item-dialog"
import { ProductKitItemsTable } from "./product-kit-items-table"

// The Kit Components tab. A Client Component because the header owns the "Add
// component" affordance; the data itself is fetched on the server and passed in.
export function ProductKitPanel({
  kitProductId,
  items,
  error,
}: {
  kitProductId: number
  items: ProductKitItem[]
  error: string | null
}) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<KitItemToEdit | null>(null)

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(item: ProductKitItem) {
    const sku = item.component?.sku ?? `#${item.component_product_id}`
    setEditing({
      id: item.id,
      componentProductId: item.component_product_id,
      componentLabel: item.component?.name ? `${sku} — ${item.component.name}` : sku,
      qty: item.qty,
    })
    setDialogOpen(true)
  }

  async function handleRemove(item: ProductKitItem) {
    const sku = item.component?.sku ?? `#${item.component_product_id}`
    const ok = await confirm({
      title: "Remove component",
      description: `Remove "${sku}" from this kit? The product itself is not deleted.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await removeKitItem(item.id, kitProductId)
      if (result.success) toast.success("Component removed")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kit Components</CardTitle>
        <CardDescription>
          {items.length === 0
            ? "The products that make up this kit."
            : `${items.length} component${items.length === 1 ? "" : "s"} in this kit.`}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={openAdd} disabled={isPending}>
            <Plus />
            Add Component
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load kit components: {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Boxes className="size-5" />
            </div>
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                No components yet
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                This product is marked as a kit but has no components recorded.
                Add the products it is assembled from.
              </p>
            </div>
          </div>
        ) : (
          <ProductKitItemsTable
            items={items}
            onEdit={openEdit}
            onRemove={handleRemove}
            disabled={isPending}
          />
        )}
      </CardContent>

      <ProductKitItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kitProductId={kitProductId}
        item={editing}
      />
    </Card>
  )
}
