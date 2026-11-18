"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createManualOrder } from "@/lib/actions/order"
import {
  manualOrderCreateSchema,
  type ManualOrderCreateInput,
} from "@/lib/validations/order"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export type NewOrderCustomer = { id: number; name: string }

const EMPTY = { postage_and_handling: 0, discount: 0, comments: "" }

/**
 * Hand-made order, step 2 of 2: what the order itself holds. Creates it and
 * opens it, where the lines are added.
 */
export function NewOrderDetailsDialog({
  customer,
  onOpenChange,
}: {
  customer: NewOrderCustomer | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ManualOrderCreateInput>({
    resolver: zodResolver(manualOrderCreateSchema),
    defaultValues: { customer_id: 0, ...EMPTY },
  })

  // A fresh form for every customer, so the last order's postage never carries over.
  React.useEffect(() => {
    if (customer) form.reset({ customer_id: customer.id, ...EMPTY })
  }, [customer, form])

  function onSubmit(values: ManualOrderCreateInput) {
    startTransition(async () => {
      const result = await createManualOrder(values)
      if (!result.success || !result.data) {
        toast.error("The order could not be created", { description: result.error })
        return
      }

      toast.success(`Order ${result.data.invoiceNumber} created`, {
        description: "Add the items. Once it has some, it can be approved in Allocation.",
      })
      if (result.data.warning) toast.warning(result.data.warning)
      onOpenChange(false)
      router.push(`/orders/${result.data.orderId}`)
    })
  }

  return (
    <Dialog open={customer !== null} onOpenChange={onOpenChange}>
      {/* Rule 12: never taller than the viewport, always scrollable. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            {customer ? `For ${customer.name}. You will add the items on the next page.` : ""}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                control={form.control}
                name="postage_and_handling"
                label="Postage charged"
                description="What the customer pays us for postage."
              />
              <MoneyField control={form.control} name="discount" label="Discount" />
            </div>

            <FormField
              control={form.control}
              name="comments"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comments</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormDescription>
                    Shown on the dispatch page, where it must be read before the order can go
                    out. Put any outside reference here.
                  </FormDescription>
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
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Create order
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function MoneyField({
  control,
  name,
  label,
  description,
}: {
  control: ReturnType<typeof useForm<ManualOrderCreateInput>>["control"]
  name: "postage_and_handling" | "discount"
  label: string
  description?: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={Number.isNaN(field.value) ? "" : field.value}
              onChange={(event) => field.onChange(event.target.valueAsNumber)}
              onBlur={field.onBlur}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
