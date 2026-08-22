"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { CarrierServiceRow } from "@/lib/queries/shipping-reference"
import {
  carrierServiceFormSchema,
  type CarrierServiceFormValues,
} from "@/lib/validations/shipping-reference"
import {
  createCarrierService,
  updateCarrierService,
} from "@/lib/actions/rate-card"
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

const EMPTY: CarrierServiceFormValues = {
  service_type: "standard",
  size_label: "",
  max_weight: "",
  sort_order: "0",
}

export function ServiceFormDialog({
  open,
  onOpenChange,
  carrierId,
  service,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  carrierId: number
  service?: CarrierServiceRow | null
}) {
  const isEdit = Boolean(service)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<CarrierServiceFormValues>({
    resolver: zodResolver(carrierServiceFormSchema),
    defaultValues: EMPTY,
  })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      service
        ? {
            service_type: service.service_type,
            size_label: service.size_label,
            max_weight:
              service.max_weight === null ? "" : String(service.max_weight),
            sort_order: String(service.sort_order),
          }
        : EMPTY
    )
  }, [open, service, form])

  function onSubmit(values: CarrierServiceFormValues) {
    startTransition(async () => {
      const result = isEdit
        ? await updateCarrierService(service!.id, values)
        : await createCarrierService(carrierId, values)

      if (result.success) {
        toast.success(isEdit ? "Weight tier updated" : "Weight tier created")
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Weight Tier" : "Add Weight Tier"}
          </DialogTitle>
          <DialogDescription>
            A row of the rate card. Its zone prices are filled in on the matrix
            afterwards.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="service_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service type</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. standard"
                      className="font-mono lowercase"
                      {...field}
                      // Lowercased as you leave the field, not on submit: the
                      // dispatch option's service_type joins to this value, and
                      // a mixed-case tier is simply never found. The column has
                      // a CHECK saying the same thing.
                      onBlur={(event) => {
                        const next = event.target.value.trim().toLowerCase()
                        if (next !== event.target.value) {
                          form.setValue("service_type", next, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        field.onBlur()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Lowercase. Which half of the card this tier belongs to — the
                    dispatch options point at it by this name.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="size_label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Size label</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 3kg" {...field} />
                  </FormControl>
                  <FormDescription>
                    Display only — how this tier is named on the card.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="max_weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Max weight
                      <span className="ml-1 text-xs text-muted-foreground">
                        (kg)
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        placeholder="Per kg tier"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {/* At most one blank tier per service type: the lookup
                          falls through to the first it finds, so a second would
                          be unreachable. */}
                      Blank makes this the per kg tier, which applies above every
                      fixed tier. Keep only one per service type.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sort_order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort order</FormLabel>
                    <FormControl>
                      <Input type="number" step="1" {...field} />
                    </FormControl>
                    <FormDescription>
                      The weight ladder, lightest first.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
