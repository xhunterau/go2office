"use client"

import * as React from "react"
import Link from "next/link"
import { ImageOff, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { ProductListRow } from "@/lib/queries/products"
import { LOW_MARGIN_THRESHOLD } from "@/lib/queries/products"
import { deleteProduct } from "@/lib/actions/product"
import { useConfirm } from "@/components/providers/confirm-provider"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const priceFormatter = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function ProductsTable({ products }: { products: ProductListRow[] }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  async function handleDelete(product: ProductListRow) {
    const ok = await confirm({
      title: "Delete product",
      description: `Are you sure you want to delete "${product.sku}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteProduct(product.id)
      if (result.success) {
        toast.success("Product deleted")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Image</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Unit Cost</TableHead>
            <TableHead className="text-right">Retail Price</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead className="text-right">On Hand</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={10}
                className="h-24 text-center text-muted-foreground"
              >
                No products found.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <TableRow key={product.id}>
                <TableCell>
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt={product.name ?? product.sku}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="size-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/products/${product.id}`}
                    className="hover:underline"
                  >
                    {product.sku}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {product.is_kit && (
                      <Badge
                        variant="outline"
                        className="border-primary/40 px-1.5 py-0 text-[10px] font-semibold uppercase text-primary"
                      >
                        Kit
                      </Badge>
                    )}
                    <span>{product.name ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {/* Kits have no landed cost of their own — their roll-up is a
                      later phase — so this stays blank rather than showing 0. */}
                  {product.unit_cost_aud == null
                    ? "—"
                    : priceFormatter.format(product.unit_cost_aud)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {product.retail_price == null
                    ? "—"
                    : priceFormatter.format(product.retail_price)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    product.retail_margin_pct != null &&
                      product.retail_margin_pct < LOW_MARGIN_THRESHOLD &&
                      "text-destructive"
                  )}
                >
                  {product.retail_margin_pct == null
                    ? "—"
                    : `${product.retail_margin_pct.toFixed(1)}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* Kits never hold stock of their own, so a 0 there would
                      read as "out of stock" rather than "not applicable". */}
                  {product.is_kit ? (
                    <span className="text-muted-foreground">—</span>
                  ) : product.on_hand === 0 ? (
                    <span className="text-muted-foreground">0</span>
                  ) : (
                    product.on_hand
                  )}
                </TableCell>
                <TableCell>{product.brand_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={product.is_active ? "success" : "inactive"}
                  >
                    {product.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          aria-label="Edit"
                        >
                          <Link
                            href={`/products/${product.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Pencil />
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(product)}
                      disabled={isPending}
                      aria-label="Delete"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
