"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { approveWithoutQuote } from "@/lib/actions/allocation"
import type { PostageStageOrder } from "@/lib/queries/allocation"
import {
  MANUAL_APPROVAL_METHODS,
  manualApprovalSchema,
  type ManualApprovalInput,
} from "@/lib/validations/allocation"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import { formatMoney } from "@/lib/format"

/**
 * Approving an order no carrier priced.
 *
 * The escape hatch for a queue that would otherwise trap orders: every quote
 * failed, so there is no row to approve, and without this the order stays
 * pending forever while looking like it is being worked on.
 */
export function ManualApprovalDialog({
  order,
  onOpenChange,
}: {
  order: PostageStageOrder | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ManualApprovalInput>({
    resolver: zodResolver(manualApprovalSchema),
    defaultValues: { shipping_method: "Parcel_Post", postage_paid: 0 },
  })

  // Reset whenever the dialog opens for a different order, so yesterday's
  // number is never sitting in the box.
  React.useEffect(() => {
    if (order) form.reset({ shipping_method: "Parcel_Post", postage_paid: 0 })
  }, [order, form])

  function onSubmit(values: ManualApprovalInput) {
    if (!order) return

    startTransition(async () => {
      const result = await approveWithoutQuote(order.id, values)
      if (!result.success) {
        toast.error("The order could not be approved", { description: result.error })
        return
      }

      toast.success(`${order.invoice_number} approved`, {
        description: `${SHIPPING_METHOD_LABELS[values.shipping_method]} at ${formatMoney(values.postage_paid)} — now in Processing.`,
      })
      if (result.data?.warning) toast.warning(result.data.warning)
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      {/* Rule 12: never taller than the viewport, always scrollable. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve without a quote</DialogTitle>
          <DialogDescription>
            {order
              ? `${order.invoice_number} — the customer paid ${formatMoney(order.postage_and_handling)} for postage.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="shipping_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shipping method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MANUAL_APPROVAL_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {SHIPPING_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {/* Direct Freight and Click and Collect are missing on
                        purpose: neither has a label channel, so an order sent to
                        Processing on one would never appear on Export Labels. */}
                    Only methods Export Labels can produce a label for.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="postage_paid"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postage cost</FormLabel>
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
                  <FormDescription>
                    What <strong>we</strong> expect to pay the carrier — not what
                    the customer paid us. Leave it at 0 if you do not know yet.
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
                Approve and move to Processing
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
