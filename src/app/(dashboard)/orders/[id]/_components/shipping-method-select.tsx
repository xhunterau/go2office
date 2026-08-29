"use client"

import * as React from "react"
import { toast } from "sonner"

import { updateOrderShippingMethod } from "@/lib/actions/order"
import {
  SHIPPING_METHOD_LABELS,
  SHIPPING_METHOD_OPTIONS,
  type ShippingMethod,
} from "@/lib/orders/shipping-method"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Sentinel for "no carrier" -- 375 orders have none, and SelectItem forbids an
// empty value. Same constant, same reason, as the edit dialog.
const NO_METHOD = "none"

/**
 * The carrier, editable in place on the Shipping card.
 *
 * Saves on change rather than behind a Save button: it is one enum column with
 * no companion fields to keep consistent, and picking the carrier is the single
 * most common edit an order gets before it is dispatched. The edit dialog keeps
 * its own copy of this field for the case where several things change at once.
 *
 * The seven retired carriers are absent from the list by design. When the order
 * still displays one, saying so under the control is the only way the operator
 * can tell that an apparently empty dropdown is not missing data.
 */
export function ShippingMethodSelect({
  orderId,
  value,
  legacyMethod,
}: {
  orderId: number
  value: ShippingMethod | null
  legacyMethod: string | null
}) {
  const [isPending, startTransition] = React.useTransition()
  // useOptimistic rather than useState: the trigger must show the new carrier
  // immediately, and once the transition settles React drops back to whatever
  // the server sent -- the saved value on success, the old one on failure --
  // with no effect syncing the two.
  const [selected, setSelected] = React.useOptimistic(value)

  function onChange(next: string) {
    const method = next === NO_METHOD ? null : (next as ShippingMethod)

    startTransition(async () => {
      setSelected(method)
      const result = await updateOrderShippingMethod(orderId, method)
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong")
        return
      }
      if (result.data?.warning) {
        toast.warning(result.data.warning)
        return
      }
      toast.success(
        method ? `Shipping method set to ${SHIPPING_METHOD_LABELS[method]}` : "Shipping method cleared"
      )
    })
  }

  const showsRetiredCarrier = !selected && Boolean(legacyMethod)

  return (
    <div className="space-y-1">
      <Select
        value={selected ?? NO_METHOD}
        onValueChange={onChange}
        disabled={isPending}
      >
        <SelectTrigger
          size="sm"
          className={cn("w-full", !selected && "text-muted-foreground")}
          aria-label="Shipping method"
        >
          <SelectValue />
        </SelectTrigger>
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
        <p className="text-xs text-muted-foreground">
          Shipped with{" "}
          <span className="font-medium">{legacyMethod}</span>, a carrier no
          longer offered and so absent from this list. It stays on record
          whatever is chosen here.
        </p>
      )}
      {/* Choosing a carrier by hand is an override of whatever the quote panel
          decided, and the panel sits further down the page where the change is
          not visible. */}
      <p className="text-xs text-muted-foreground">
        Changing this clears the selected shipping quote.
      </p>
    </div>
  )
}
