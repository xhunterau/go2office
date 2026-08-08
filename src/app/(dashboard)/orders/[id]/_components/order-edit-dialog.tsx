"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { OrderDetail } from "@/lib/queries/orders"
import { ORDER_STATUSES, SALES_PLATFORMS } from "@/lib/queries/orders"
import { updateOrder } from "@/lib/actions/order"
import {
  SHIPPING_METHOD_LABELS,
  SHIPPING_METHOD_OPTIONS,
} from "@/lib/orders/shipping-method"
import {
  ORDER_STATUS_LABELS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
import {
  orderUpdateSchema,
  type OrderUpdateInput,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

// Sentinel for "no carrier" -- 375 orders have none, and SelectItem forbids an
// empty value.
const NO_METHOD = "none"

// Edits the order's own fields only. Transaction lines are edited elsewhere, on
// purpose: they are watched by order_transactions_rebuild_items_update, and a
// single "save everything" button would let a typo fix in the comments rewrite
// the pick list (docs/orders-ui.md 6.4).
export function OrderEditDialog({
  open,
  onOpenChange,
  order,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: OrderDetail
}) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<OrderUpdateInput>({
    resolver: zodResolver(orderUpdateSchema),
    defaultValues: {
      status: order.status,
      platform: order.platform,
      shipping_method: order.shipping_method,
      postage_and_handling: order.postage_and_handling,
      tracking_number: order.tracking_number ?? "",
      web_order_id: order.web_order_id ?? "",
      comments: order.comments ?? "",
      posted_on_date: order.posted_on_date ?? "",
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        status: order.status,
        platform: order.platform,
        shipping_method: order.shipping_method,
        postage_and_handling: order.postage_and_handling,
        tracking_number: order.tracking_number ?? "",
        web_order_id: order.web_order_id ?? "",
        comments: order.comments ?? "",
        posted_on_date: order.posted_on_date ?? "",
      })
    }
  }, [open, order, form])

  // Only true while the retired value is still what the page displays. Once a
  // current method is chosen the legacy column stops being the display source,
  // but it is never cleared (docs/orders-ui.md 4.3 decision B).
  const showsRetiredCarrier =
    !order.shipping_method && Boolean(order.legacy_shipping_method)

  function onSubmit(values: OrderUpdateInput) {
    startTransition(async () => {
      const result = await updateOrder(order.id, values)
      if (result.success) {
        toast.success("Order updated")
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
          <DialogTitle>Edit order {order.invoice_number}</DialogTitle>
          <DialogDescription>
            {/* Said outright because it is the opposite of what people expect
                from an order screen: marking an order dispatched here moves no
                stock (docs/orders-ui.md 12). */}
            Changing the status or dispatch date here does not move any stock.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ORDER_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {ORDER_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SALES_PLATFORMS.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {SALES_PLATFORM_LABELS[platform]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="shipping_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shipping method</FormLabel>
                  <Select
                    value={field.value ?? NO_METHOD}
                    onValueChange={(value) =>
                      field.onChange(value === NO_METHOD ? null : value)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_METHOD}>No method</SelectItem>
                      {SHIPPING_METHOD_OPTIONS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {SHIPPING_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showsRetiredCarrier && (
                    <FormDescription>
                      This order shipped with{" "}
                      <span className="font-medium">
                        {order.legacy_shipping_method}
                      </span>
                      , a carrier that is no longer offered and so is not in this
                      list. Choosing a method here changes what the order shows;
                      the original carrier is kept on record either way.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="tracking_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tracking number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Optional"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="posted_on_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dispatched on</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(event.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Empty means not dispatched.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="postage_and_handling"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postage and handling</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value === ""
                              ? Number.NaN
                              : Number(event.target.value)
                          )
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormDescription>
                      Added to the goods total; the order total follows.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="web_order_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Web order ID</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Optional"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="comments"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comments</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Optional"
                      {...field}
                      value={field.value ?? ""}
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
