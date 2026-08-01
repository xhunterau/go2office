"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ImageOff, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteProduct } from "@/lib/actions/product"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ProductDetail } from "./product-detail-types"

// Sticky identity strip: it sits outside the tabs so the product it belongs to
// stays visible while switching between Overview, Stock and Kit Components.
export function ProductDetailHeader({
  product,
  usedInKitCount,
}: {
  product: ProductDetail
  usedInKitCount: number
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  async function handleDelete() {
    const confirmed = await confirm({
      title: "Delete product",
      description: `${product.sku} will be permanently deleted. This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return

    startTransition(async () => {
      const result = await deleteProduct(product.id)
      if (result.success) {
        toast.success("Product deleted")
        router.push("/products")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit text-muted-foreground"
      >
        <Link href="/products">
          <ArrowLeft />
          Products
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name ?? product.sku}
              className="size-16 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
              <ImageOff className="size-5" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-foreground">
              {product.name ?? "Untitled product"}
            </h1>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {product.sku}
              </span>
              <Badge variant={product.is_active ? "success" : "inactive"}>
                {product.is_active ? "Active" : "Inactive"}
              </Badge>
              {product.is_kit && <Badge variant="outline">Kit</Badge>}
              {usedInKitCount > 0 && (
                <Badge variant="outline">
                  In {usedInKitCount} Kit{usedInKitCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          disabled={isPending}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
          Delete
        </Button>
      </div>
    </div>
  )
}
