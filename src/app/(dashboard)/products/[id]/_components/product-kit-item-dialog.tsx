"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import {
  addKitItem,
  searchKitCandidatesAction,
  updateKitItemQty,
} from "@/lib/actions/product-kit-item"
import {
  kitItemFormSchema,
  type KitItemFormValues,
} from "@/lib/validations/product-kit-item"
import { ProductPicker } from "@/components/products/product-picker"
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

// Editing an existing line: the component is fixed, only the quantity changes.
export type KitItemToEdit = {
  id: number
  componentProductId: number
  componentLabel: string
  qty: number
}

// One dialog for both adding a component and editing a line's quantity: the
// only difference is whether the component is picked or already fixed.
export function ProductKitItemDialog({
  open,
  onOpenChange,
  kitProductId,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kitProductId: number
  item: KitItemToEdit | null
}) {
  const [isPending, startTransition] = React.useTransition()

  // Memoized: ProductPicker debounces on this, so a fresh closure each render
  // would restart the timer while the quantity field is being typed in.
  const searchCandidates = React.useCallback(
    (keyword: string) => searchKitCandidatesAction(kitProductId, keyword),
    [kitProductId]
  )

  const defaultValues = React.useMemo<KitItemFormValues>(
    () => ({
      component_product_id: item ? String(item.componentProductId) : "",
      qty: item ? String(item.qty) : "1",
    }),
    [item]
  )

  const form = useForm<KitItemFormValues>({
    resolver: zodResolver(kitItemFormSchema),
    defaultValues,
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues)
  }, [open, defaultValues, form])

  function onSubmit(values: KitItemFormValues) {
    startTransition(async () => {
      const result = item
        ? await updateKitItemQty(item.id, kitProductId, { qty: values.qty })
        : await addKitItem({
            kit_product_id: kitProductId,
            component_product_id: values.component_product_id,
            qty: values.qty,
          })

      if (result.success) {
        toast.success(item ? "Quantity updated" : "Component added")
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit component quantity" : "Add kit component"}
          </DialogTitle>
          <DialogDescription>
            {item
              ? item.componentLabel
              : "Pick the product that goes into this kit and how many of it are needed."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!item && (
              <FormField
                control={form.control}
                name="component_product_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Component</FormLabel>
                    <FormControl>
                      <ProductPicker
                        search={searchCandidates}
                        value={field.value}
                        onSelect={(candidate) =>
                          field.onChange(String(candidate.id))
                        }
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
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
  )
}
