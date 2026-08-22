"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type {
  CarrierServiceRow,
  CarrierZoneRateRow,
} from "@/lib/queries/shipping-reference"
import {
  zoneRateFormSchema,
  type ZoneRateFormValues,
} from "@/lib/validations/shipping-reference"
import { deleteZoneRate, upsertZoneRate } from "@/lib/actions/rate-card"
import { useConfirm } from "@/components/providers/confirm-provider"
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

const EMPTY: ZoneRateFormValues = {
  rate: "",
  base_rate: "",
  per_kg_rate: "",
  min_charge: "",
}

export function ZoneRateDialog({
  open,
  onOpenChange,
  service,
  zone,
  rate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: CarrierServiceRow | null
  zone: string | null
  rate: CarrierZoneRateRow | null
}) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  // The tier's own shape decides which pricing method the cell uses: a fixed
  // weight tier takes one flat rate, the overflow tier takes base + per kg.
  const isPerKgTier = service?.max_weight === null

  const form = useForm<ZoneRateFormValues>({
    resolver: zodResolver(zoneRateFormSchema),
    defaultValues: EMPTY,
  })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      rate
        ? {
            rate: rate.rate === null ? "" : String(rate.rate),
            base_rate: rate.base_rate === null ? "" : String(rate.base_rate),
            per_kg_rate: rate.per_kg_rate === null ? "" : String(rate.per_kg_rate),
            min_charge: rate.min_charge === null ? "" : String(rate.min_charge),
          }
        : EMPTY
    )
  }, [open, rate, form])

  function onSubmit(values: ZoneRateFormValues) {
    if (!service || !zone) return
    startTransition(async () => {
      // Only the fields belonging to this tier's pricing method are sent, so
      // switching a tier's shape cannot leave a stale flat rate behind it --
      // the rate lookup reads `rate` first and would use the stale one.
      const payload: ZoneRateFormValues = isPerKgTier
        ? { ...values, rate: "" }
        : { ...EMPTY, rate: values.rate }

      const result = await upsertZoneRate(service.id, zone, payload)
      if (result.success) {
        toast.success("Rate saved")
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  async function handleClear() {
    if (!service || !zone) return
    const ok = await confirm({
      title: "Clear this rate",
      description: `Remove the ${zone.replace(/_/g, " ")} rate from ${service.service_type} ${service.size_label}? This tier then does not serve that zone at all — orders going there are quoted through another tier, or not through this carrier.`,
      confirmText: "Clear rate",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteZoneRate(service.id, zone)
      if (result.success) {
        toast.success("Rate cleared")
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
            {service
              ? `${service.service_type} ${service.size_label}`
              : "Zone rate"}
          </DialogTitle>
          <DialogDescription>
            {zone ? zone.replace(/_/g, " ") : ""}
            {service?.max_weight !== null && service?.max_weight !== undefined
              ? ` · up to ${service.max_weight} kg`
              : " · above every fixed tier"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {isPerKgTier ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    form={form}
                    name="base_rate"
                    label="Base rate"
                    description="Charged before the per kg component."
                  />
                  <NumberField
                    form={form}
                    name="per_kg_rate"
                    label="Per kg rate"
                    description="Multiplied by the billed weight."
                  />
                </div>
                <NumberField
                  form={form}
                  name="min_charge"
                  label="Minimum charge"
                  description="A floor on the total. Leave blank for none."
                />
              </>
            ) : (
              <NumberField
                form={form}
                name="rate"
                label="Rate"
                description="The whole price for this tier and zone. Flat-rate satchels and boxes are priced here too, since the packaging fixes the tier."
              />
            )}

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                disabled={isPending || !rate}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Clear rate
              </Button>
              <div className="flex gap-2">
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
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({
  form,
  name,
  label,
  description,
}: {
  form: ReturnType<typeof useForm<ZoneRateFormValues>>
  name: keyof ZoneRateFormValues
  label: string
  description: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            <span className="ml-1 text-xs text-muted-foreground">(AUD)</span>
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              autoFocus={name === "rate" || name === "base_rate"}
              {...field}
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
