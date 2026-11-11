"use client"

import * as React from "react"
import Link from "next/link"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  loadProductsLogistics,
  updateProductsLogistics,
  type ProductLogistics,
} from "@/lib/actions/product"
import {
  PRODUCT_LOGISTICS_FIELDS,
  productsLogisticsFormSchema,
  type ProductsLogisticsFormValues,
} from "@/lib/validations/product"

const FIELD_META: Record<
  (typeof PRODUCT_LOGISTICS_FIELDS)[number],
  { label: string; step: string }
> = {
  weight: { label: "Weight (kg)", step: "0.001" },
  length: { label: "L (mm)", step: "0.01" },
  width: { label: "W (mm)", step: "0.01" },
  height: { label: "H (mm)", step: "0.01" },
}

function toFormRow(product: ProductLogistics) {
  return {
    id: product.id,
    weight: String(product.weight),
    length: String(product.length),
    width: String(product.width),
    height: String(product.height),
  }
}

/**
 * Weight and size of the products one order line picks, editable in place.
 *
 * Edits the picked products, not the sold one. For a plain listing they are
 * the same product; for a kit the order's packed size is built from the
 * components (order_metrics_summary reads order_items), and a kit's own weight
 * and size are derived from those components anyway -- so the kit row is not
 * offered.
 */
export function ProductLogisticsDialog({
  orderId,
  productIds,
  lineTitle,
  onOpenChange,
  onSaved,
}: {
  orderId: number
  /** Null closes the dialog. */
  productIds: number[] | null
  lineTitle: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const open = productIds !== null
  const [products, setProducts] = React.useState<ProductLogistics[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ProductsLogisticsFormValues>({
    resolver: zodResolver(productsLogisticsFormSchema),
    defaultValues: { products: [] },
  })
  const { fields } = useFieldArray({ control: form.control, name: "products" })

  const idsKey = productIds?.join(",") ?? ""

  React.useEffect(() => {
    if (!idsKey) return
    let active = true
    void loadProductsLogistics(idsKey.split(",").map(Number)).then((result) => {
      if (!active) return
      if (!result.success) {
        setProducts(null)
        setLoadError(result.error ?? "Could not load the products")
        return
      }
      const rows = result.data ?? []
      setProducts(rows)
      setLoadError(null)
      form.reset({ products: rows.filter((p) => !p.is_kit).map(toFormRow) })
    })
    return () => {
      active = false
      setProducts(null)
      setLoadError(null)
    }
  }, [idsKey, form])

  // Same order as the form rows, which are built from this list in the effect.
  const editable = (products ?? []).filter((p) => !p.is_kit)
  const kits = (products ?? []).filter((p) => p.is_kit)

  function onSubmit(values: ProductsLogisticsFormValues) {
    startTransition(async () => {
      const result = await updateProductsLogistics(orderId, values.products)
      if (!result.success) {
        toast.error("Could not save", { description: result.error })
        return
      }
      const others = Math.max(0, (result.data?.rebuiltOrders ?? 0) - 1)
      if (result.error) {
        toast.warning(result.error)
      } else {
        toast.success("Weight & size saved", {
          description: `Packed size recalculated${
            others > 0 ? ` here and on ${others} other queued order${others === 1 ? "" : "s"}` : ""
          }. Re-quote to refresh the rates.`,
        })
      }
      onOpenChange(false)
      onSaved()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Rule 12. A kit can pick a dozen components. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit weight &amp; size</DialogTitle>
          <DialogDescription className="line-clamp-2">{lineTitle}</DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {loadError}
          </p>
        ) : products === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading products…
          </p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              {fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing on this line can be edited here.
                </p>
              ) : (
                fields.map((field, index) => {
                  const product = editable[index]
                  return (
                    <div
                      key={field.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <Link
                          href={`/products/${product?.id ?? ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {product?.sku} <ExternalLink className="size-3" />
                        </Link>
                        <span className="line-clamp-1 text-muted-foreground">
                          {product?.name}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {PRODUCT_LOGISTICS_FIELDS.map((key) => (
                          <FormField
                            key={key}
                            control={form.control}
                            name={`products.${index}.${key}`}
                            render={({ field: input }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  {FIELD_META[key].label}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step={FIELD_META[key].step}
                                    min="0"
                                    {...input}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })
              )}

              {kits.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {kits.map((k) => k.sku).join(", ")} is a kit. Its weight and
                  size come from its components, so edit those on the product
                  page.
                </p>
              ) : null}

              {/* The products_normalize_fields trigger re-sorts the edges on
                  write (rule 19). Said up front so a "wrong" order after saving
                  does not read as a bug. */}
              <p className="text-xs text-muted-foreground">
                Dimensions are stored longest first (L ≥ W ≥ H), so they may be
                re-ordered on save. Existing rates are not re-quoted.
              </p>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || fields.length === 0}>
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
