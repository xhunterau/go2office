"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { LocationOption } from "@/lib/queries/locations"
import type { ProductStockLine } from "@/lib/queries/inventory"
import {
  stockFormSchema,
  type StockAction,
  type StockFormValues,
} from "@/lib/validations/inventory"
import {
  adjustStock,
  dispatchStock,
  moveStock,
  receiveStock,
} from "@/lib/actions/inventory"
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

export type { StockAction }

const COPY: Record<
  StockAction,
  { title: string; description: string; submit: string; qtyLabel: string }
> = {
  receive: {
    title: "Receive Stock",
    description: "Add units arriving into a location.",
    submit: "Receive",
    qtyLabel: "Quantity to receive",
  },
  dispatch: {
    title: "Dispatch Stock",
    description: "Remove units leaving a location.",
    submit: "Dispatch",
    qtyLabel: "Quantity to dispatch",
  },
  adjust: {
    title: "Count Stock",
    description:
      "Record a stocktake. Enter the quantity you counted, not the difference.",
    submit: "Save count",
    qtyLabel: "Counted quantity",
  },
  move: {
    title: "Move Stock",
    description: "Transfer units between two locations.",
    submit: "Move",
    qtyLabel: "Quantity to move",
  },
}

export function StockMovementDialog({
  open,
  onOpenChange,
  action,
  productId,
  locations,
  lines,
  presetLocationId,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: StockAction
  productId: number
  locations: LocationOption[]
  lines: ProductStockLine[]
  presetLocationId?: number | null
  // Fired once the ledger has actually changed. Server data refreshes itself
  // through revalidatePath; this is for callers holding client-side state the
  // movement invalidates, such as a cached history on the list page.
  onSuccess?: () => void
}) {
  const [isPending, startTransition] = React.useTransition()
  const copy = COPY[action]

  // Receiving can target any location; everything else can only act on one that
  // already holds a row for this product.
  const sourceOptions = React.useMemo(
    () =>
      action === "receive"
        ? locations
        : locations.filter((location) =>
            lines.some((line) => line.location_id === location.id)
          ),
    [action, locations, lines]
  )

  const defaultValues = React.useMemo<StockFormValues>(
    () => ({
      location_id: presetLocationId
        ? String(presetLocationId)
        : sourceOptions.length === 1
          ? String(sourceOptions[0].id)
          : "",
      to_location_id: "",
      qty: "",
      note: "",
    }),
    [presetLocationId, sourceOptions]
  )

  const form = useForm<StockFormValues>({
    resolver: zodResolver(stockFormSchema(action)),
    defaultValues,
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues)
  }, [open, defaultValues, form])

  // useWatch rather than form.watch(): the latter returns a fresh function each
  // render, which opts the whole component out of React Compiler memoization.
  const selectedLocationId = useWatch({
    control: form.control,
    name: "location_id",
  })
  const currentQty = React.useMemo(() => {
    const id = Number(selectedLocationId)
    return lines.find((line) => line.location_id === id)?.qty ?? null
  }, [selectedLocationId, lines])

  function onSubmit(values: StockFormValues) {
    const locationId = Number(values.location_id)
    const qty = Number(values.qty)
    const note = values.note.trim() || undefined

    startTransition(async () => {
      const result =
        action === "receive"
          ? await receiveStock({
              product_id: productId,
              location_id: locationId,
              qty,
              note,
            })
          : action === "dispatch"
            ? await dispatchStock({
                product_id: productId,
                location_id: locationId,
                qty,
                note,
              })
            : action === "adjust"
              ? await adjustStock({
                  product_id: productId,
                  location_id: locationId,
                  new_qty: qty,
                  note,
                })
              : await moveStock({
                  product_id: productId,
                  from_location_id: locationId,
                  to_location_id: Number(values.to_location_id),
                  qty,
                  note,
                })

      if (!result.success) {
        toast.error(result.error ?? "Something went wrong")
        return
      }

      // A stocktake matching the figure already on file writes no ledger row.
      // Reporting "saved" would imply otherwise.
      if (action === "adjust" && result.data === "unchanged") {
        toast.info("Count matched the recorded quantity. Nothing changed.")
      } else {
        toast.success(`${copy.submit} recorded`)
        onSuccess?.()
      }
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="location_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {action === "move" ? "From location" : "Location"}
                  </FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a location" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sourceOptions.map((location) => {
                        const line = lines.find(
                          (l) => l.location_id === location.id
                        )
                        return (
                          <SelectItem
                            key={location.id}
                            value={String(location.id)}
                          >
                            {location.name}
                            {line ? ` — ${line.qty} on hand` : ""}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {sourceOptions.length === 0 && (
                    <FormDescription>
                      This product has no stock recorded yet. Receive some
                      first.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {action === "move" && (
              <FormField
                control={form.control}
                name="to_location_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To location</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a destination" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {locations
                          .filter((l) => String(l.id) !== selectedLocationId)
                          .map((location) => (
                            <SelectItem
                              key={location.id}
                              value={String(location.id)}
                            >
                              {location.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
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
                  <FormLabel>{copy.qtyLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={action === "adjust" ? 0 : 1}
                      step={1}
                      placeholder="0"
                      {...field}
                    />
                  </FormControl>
                  {currentQty !== null && (
                    <FormDescription>
                      Currently {currentQty} on hand at this location.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Optional — reference, reason, or who asked for it"
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
              <Button
                type="submit"
                disabled={isPending || sourceOptions.length === 0}
              >
                {isPending ? "Saving..." : copy.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
