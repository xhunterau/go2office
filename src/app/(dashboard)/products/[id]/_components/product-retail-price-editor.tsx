"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { updateProductRetailPrice } from "@/lib/actions/product"
import { formatMoney, formatPercent } from "@/lib/pricing"
import {
  retailPriceFormSchema,
  type RetailPriceFormValues,
} from "@/lib/validations/product"
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { ProductPriceInput } from "./product-price-input"

/**
 * The retail price's edit affordance, mounted on the Retail & Margin card.
 *
 * It lives here rather than in the Overview's Commercial section because the
 * price is a decision, not a stored input: the numbers that inform it — landed
 * cost and the suggested price — are on this tab, and repeated inside the
 * dialog so they stay visible while the figure is typed.
 */
export function ProductRetailPriceEditor({
  productId,
  retailPrice,
  unitCost,
  suggestedPrice,
  suggestedMargin,
}: {
  productId: number
  retailPrice: number | null
  unitCost: number | null
  suggestedPrice: number | null
  suggestedMargin: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const defaultValues = React.useMemo<RetailPriceFormValues>(
    () => ({ retail_price: retailPrice === null ? "" : String(retailPrice) }),
    [retailPrice]
  )

  const form = useForm<RetailPriceFormValues>({
    resolver: zodResolver(retailPriceFormSchema),
    defaultValues,
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues)
  }, [open, defaultValues, form])

  function onSubmit(values: RetailPriceFormValues) {
    startTransition(async () => {
      const result = await updateProductRetailPrice(productId, values)
      if (result.success) {
        toast.success("Retail price updated")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil />
        Edit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set retail price</DialogTitle>
            <DialogDescription>
              The GST-inclusive shelf price, in AUD.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Unit cost (ex-GST)</span>
              <span className="font-medium tabular-nums">
                {formatMoney(unitCost)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Suggested</span>
              <span className="font-medium tabular-nums">
                {formatMoney(suggestedPrice)}
                {suggestedMargin !== null && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {formatPercent(suggestedMargin)} margin
                  </span>
                )}
              </span>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="retail_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Retail Price (AUD, incl. GST)</FormLabel>
                    <FormControl>
                      <ProductPriceInput
                        name={field.name}
                        step="0.01"
                        placeholder="Optional"
                        disabled={isPending}
                        value={String(field.value ?? "")}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription>
                      Leave blank to clear the price. Values snap to .95 cents.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
