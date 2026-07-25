"use client"

import Link from "next/link"
import { ImageOff, Pencil, Trash2 } from "lucide-react"

import type { ProductKitItem } from "@/lib/queries/product-kit-items"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Read view of a kit's components. Row actions are delegated upwards so the
// dialog and the confirmation prompt live in one place (the panel).
export function ProductKitItemsTable({
  items,
  onEdit,
  onRemove,
  disabled,
}: {
  items: ProductKitItem[]
  onEdit: (item: ProductKitItem) => void
  onRemove: (item: ProductKitItem) => void
  disabled: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Image</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const component = item.component
            const sku = component?.sku ?? `#${item.component_product_id}`

            return (
              <TableRow key={item.id}>
                <TableCell>
                  {component?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={component.image_url}
                      alt={component.name ?? sku}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="size-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/products/${item.component_product_id}`}
                      className="hover:underline"
                    >
                      {sku}
                    </Link>
                    {component && !component.is_active && (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{component?.name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.qty}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(item)}
                      disabled={disabled}
                      aria-label="Edit quantity"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(item)}
                      disabled={disabled}
                      aria-label="Remove component"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
