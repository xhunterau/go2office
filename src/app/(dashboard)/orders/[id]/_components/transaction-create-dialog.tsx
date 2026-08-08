"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { createOrderTransaction } from "@/lib/actions/order"
import { searchOrderLineProductsAction } from "@/lib/actions/product"
import type { OrderLineProduct } from "@/lib/queries/products"
import { formatMoney } from "@/lib/format"
import {
  transactionCreateSchema,
  type TransactionCreateInput,
} from "@/lib/validations/order"
import { ProductPicker } from "@/components/products/product-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  TransactionPriceField,
  TransactionQuantityField,
  TransactionTitleField,
} from "./transaction-fields"

// NaN, not 0, for the price: an empty number input reads back as "", and the
// form has to be able to tell "not filled in yet" from a genuine zero.
const EMPTY: TransactionCreateInput = {
  quantity: 1,
  sale_price: Number.NaN,
  custom_label: "",
  item_title: "",
}

// Most kits carry retail_price = 0 rather than NULL (556 of 640,
// docs/product-kit-pricing.md 11), so both mean "nobody has priced this" and
// neither may be prefilled -- writing the 0 through would put a free line on a
// real order without anyone noticing.
function prefillPrice(product: OrderLineProduct): number {
  const price = product.retail_price
  return price !== null && price > 0 ? price : Number.NaN
}

// One form, one save button -- unlike the edit dialog.
//
// The split over there exists because saving custom_label or quantity on an
// existing line rebuilds its picked items and discards manual pick locations.
// On insert there is nothing to discard: the picked items are generated for the
// first time, from the picked product, as part of the save
// (docs/orders-ui.md 6.4.1).
// Mounted only while open (see order-transactions-table), so both the form and
// the picked product start empty every time without a reset effect.
export function TransactionCreateDialog({
  onOpenChange,
  orderId,
}: {
  onOpenChange: (open: boolean) => void
  orderId: number
}) {
  const [isPending, startTransition] = React.useTransition()
  // The form holds the SKU, because that is what the transaction stores. The
  // product itself is kept alongside it for the picker's selected state and for
  // the kit / inactive notes under it.
  const [product, setProduct] = React.useState<OrderLineProduct | null>(null)

  const form = useForm<TransactionCreateInput>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: EMPTY,
  })

  // Picking overwrites the title and price unconditionally, including over
  // hand-typed values (user decision, 2026-08-08). Choosing a different product
  // is an explicit act, and "sometimes it overwrites" is harder to predict than
  // "it always does".
  function selectProduct(next: OrderLineProduct) {
    setProduct(next)
    form.setValue("custom_label", next.sku, { shouldValidate: true })
    form.setValue("item_title", next.name ?? "")
    form.setValue("sale_price", prefillPrice(next))
  }

  function onSubmit(values: TransactionCreateInput) {
    startTransition(async () => {
      const result = await createOrderTransaction(orderId, values)

      if (!result.success) {
        toast.error(result.error ?? "Something went wrong")
        return
      }

      // Reachable even though the SKU is known to exist: a kit with an empty
      // BOM expands to a single unresolved placeholder.
      if (result.data?.unresolved) {
        toast.warning(
          "Line added, but nothing could be picked for it — check the kit's contents"
        )
      } else {
        const count = result.data?.itemCount ?? 0
        toast.success(
          `Line added — ${count} picked ${count === 1 ? "item" : "items"} generated`
        )
      }

      onOpenChange(false)
    })
  }

  const unpriced = product !== null && Number.isNaN(prefillPrice(product))

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add line</DialogTitle>
          <DialogDescription>
            {/* The platform fields (listing id, sales record, eBay ids) are
                deliberately absent: this line was not sold by a marketplace, so
                it has no such identifiers to record. */}
            A line added by hand. Its picked items are generated from the product
            when you save — a kit expands into its components.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="custom_label"
              render={() => (
                <FormItem>
                  <FormLabel>Product</FormLabel>
                  <FormControl>
                    <ProductPicker
                      search={searchOrderLineProductsAction}
                      value={product ? String(product.id) : ""}
                      onSelect={selectProduct}
                      disabled={isPending}
                      renderMeta={(option) => (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {option.is_kit && <Badge variant="secondary">Kit</Badge>}
                          {!option.is_active && (
                            <Badge variant="inactive">Inactive</Badge>
                          )}
                          {option.retail_price !== null &&
                            option.retail_price > 0 &&
                            formatMoney(option.retail_price)}
                        </span>
                      )}
                    />
                  </FormControl>
                  <FormDescription>
                    {product
                      ? `SKU ${product.sku}${
                          product.is_kit
                            ? " — a kit, picked as its components"
                            : ""
                        }`
                      : "Only products already in the system can be added to an order."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <TransactionTitleField control={form.control} />
            <TransactionQuantityField control={form.control} />
            <TransactionPriceField
              control={form.control}
              description={
                unpriced
                  ? "This product has no retail price set — enter the sale price."
                  : undefined
              }
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Adding..." : "Add line"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
