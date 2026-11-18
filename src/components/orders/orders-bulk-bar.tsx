"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { bulkUpdateOrders } from "@/lib/actions/order"
import {
  SHIPPING_METHOD_LABELS,
  SHIPPING_METHOD_OPTIONS,
} from "@/lib/orders/shipping-method"
import { ORDER_STATUS_LABELS } from "@/lib/orders/status"
import {
  BULK_ORDER_STATUSES,
  bulkOrderChangesSchema,
  type BulkOrderChanges,
} from "@/lib/validations/order"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// shadcn SelectItem forbids an empty value, so "leave as is" needs a sentinel.
const KEEP = "keep"

/**
 * Status and shipping method for the orders ticked on the current page.
 *
 * `completed` is not offered (see BULK_ORDER_STATUSES): finishing an order is
 * the dispatch page's job, because that is where stock is deducted and the
 * tracking number is pushed to the platform.
 */
export function OrdersBulkBar({
  selected,
  onClear,
  onDone,
}: {
  selected: { id: number; invoice_number: string }[]
  onClear: () => void
  onDone: () => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<BulkOrderChanges>({
    resolver: zodResolver(bulkOrderChangesSchema),
    defaultValues: { status: undefined, shipping_method: undefined },
  })

  const [status, method] = useWatch({
    control: form.control,
    name: ["status", "shipping_method"],
  })
  const nothingChosen = status === undefined && method === undefined

  async function onSubmit(values: BulkOrderChanges) {
    const count = selected.length
    const changes = [
      values.status ? `status to ${ORDER_STATUS_LABELS[values.status]}` : null,
      values.shipping_method
        ? `shipping method to ${SHIPPING_METHOD_LABELS[values.shipping_method]}`
        : null,
    ].filter(Boolean)

    const ok = await confirm({
      title: `Update ${count} order${count === 1 ? "" : "s"}?`,
      description: `Set ${changes.join(" and ")} on ${selected
        .map((order) => order.invoice_number)
        .join(", ")}. Each order gets an entry in its log.`,
      confirmText: "Update",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await bulkUpdateOrders(
        selected.map((order) => order.id),
        values
      )
      if (!result.success) {
        toast.error("The orders were not updated", { description: result.error })
        return
      }
      toast.success(`${result.data?.updated ?? count} orders updated`)
      if (result.data?.warning) toast.warning(result.data.warning)
      form.reset({ status: undefined, shipping_method: undefined })
      onDone()
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3"
      >
        <div className="flex h-9 items-center text-sm font-medium">
          {selected.length} selected
        </div>

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem className="gap-1.5">
              <FormLabel className="text-xs text-muted-foreground">Status</FormLabel>
              <Select
                value={field.value ?? KEEP}
                onValueChange={(value) =>
                  field.onChange(value === KEEP ? undefined : value)
                }
              >
                <FormControl>
                  <SelectTrigger className="w-40 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={KEEP}>No change</SelectItem>
                  {BULK_ORDER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {ORDER_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="shipping_method"
          render={({ field }) => (
            <FormItem className="gap-1.5">
              <FormLabel className="text-xs text-muted-foreground">
                Shipping method
              </FormLabel>
              <Select
                value={field.value ?? KEEP}
                onValueChange={(value) =>
                  field.onChange(value === KEEP ? undefined : value)
                }
              >
                <FormControl>
                  <SelectTrigger className="w-56 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={KEEP}>No change</SelectItem>
                  {SHIPPING_METHOD_OPTIONS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {SHIPPING_METHOD_LABELS[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        {/* Disabled rather than validated: with neither field chosen there is
            nothing to apply, and the schema's refine is the server's guard. */}
        <Button type="submit" disabled={isPending || nothingChosen}>
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Apply
        </Button>
        <Button type="button" variant="ghost" onClick={onClear} disabled={isPending}>
          <X />
          Clear selection
        </Button>

      </form>
    </Form>
  )
}
