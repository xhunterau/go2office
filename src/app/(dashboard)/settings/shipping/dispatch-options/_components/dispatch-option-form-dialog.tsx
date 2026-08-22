"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import {
  SHIPPING_METHOD_LABELS,
  SHIPPING_METHOD_OPTIONS,
} from "@/lib/orders/shipping-method"
import type {
  CarrierRow,
  DispatchOptionWithCarrier,
} from "@/lib/queries/shipping-reference"
import {
  BILLING_WEIGHT_MODES,
  NO_SERVICE_TYPE,
  dispatchOptionFormSchema,
  type DispatchOptionFormValues,
} from "@/lib/validations/shipping-reference"
import {
  createDispatchOption,
  updateDispatchOption,
} from "@/lib/actions/dispatch-option"
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

const EMPTY: DispatchOptionFormValues = {
  shipping_method: "Eparcel_Regular",
  carrier_id: "",
  billing_weight_mode: "chargeable",
  service_type: NO_SERVICE_TYPE,
  fixed_price_aud: "",
  max_order_total_aud: "",
  max_packed_thickness_mm: "",
  max_packed_length_mm: "",
  max_packed_width_mm: "",
  is_active: true,
}

export function DispatchOptionFormDialog({
  open,
  onOpenChange,
  option,
  carriers,
  serviceTypes,
  usedMethods,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  option?: DispatchOptionWithCarrier | null
  carriers: CarrierRow[]
  // [carrier_id, service types that carrier actually has tiers for]
  serviceTypes: [number, string[]][]
  usedMethods: string[]
}) {
  const isEdit = Boolean(option)
  const [isPending, startTransition] = React.useTransition()
  const typesByCarrier = React.useMemo(
    () => new Map(serviceTypes),
    [serviceTypes]
  )

  const form = useForm<DispatchOptionFormValues>({
    resolver: zodResolver(dispatchOptionFormSchema),
    defaultValues: EMPTY,
  })

  // The table has UNIQUE (shipping_method), so a method already mapped is not
  // offered again -- the alternative is an insert that fails on a constraint the
  // user has no way of seeing.
  const availableMethods = React.useMemo(() => {
    const taken = new Set(usedMethods)
    return SHIPPING_METHOD_OPTIONS.filter(
      (method) => !taken.has(method) || method === option?.shipping_method
    )
  }, [usedMethods, option])

  React.useEffect(() => {
    if (!open) return
    form.reset(
      option
        ? {
            shipping_method: option.shipping_method,
            carrier_id: String(option.carrier_id),
            billing_weight_mode:
              option.billing_weight_mode === "actual" ? "actual" : "chargeable",
            service_type: option.service_type ?? NO_SERVICE_TYPE,
            fixed_price_aud:
              option.fixed_price_aud === null ? "" : String(option.fixed_price_aud),
            max_order_total_aud:
              option.max_order_total_aud === null
                ? ""
                : String(option.max_order_total_aud),
            max_packed_thickness_mm:
              option.max_packed_thickness_mm === null
                ? ""
                : String(option.max_packed_thickness_mm),
            max_packed_length_mm:
              option.max_packed_length_mm === null
                ? ""
                : String(option.max_packed_length_mm),
            max_packed_width_mm:
              option.max_packed_width_mm === null
                ? ""
                : String(option.max_packed_width_mm),
            is_active: option.is_active,
          }
        : { ...EMPTY, shipping_method: availableMethods[0] ?? EMPTY.shipping_method }
    )
  }, [open, option, form, availableMethods])

  // useWatch rather than form.watch(): the latter returns a fresh function each
  // render, which opts the whole component out of React Compiler memoization.
  const carrierId = Number(
    useWatch({ control: form.control, name: "carrier_id" })
  )
  const carrierServiceTypes = typesByCarrier.get(carrierId) ?? []
  const fixedPrice = useWatch({ control: form.control, name: "fixed_price_aud" })

  function onSubmit(values: DispatchOptionFormValues) {
    startTransition(async () => {
      const result = isEdit
        ? await updateDispatchOption(option!.id, values)
        : await createDispatchOption(values)

      if (result.success) {
        toast.success(
          isEdit ? "Dispatch option updated" : "Dispatch option created"
        )
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Dispatch Option" : "Add Dispatch Option"}
          </DialogTitle>
          <DialogDescription>
            How this shipping method is priced, and the ceilings that take it out
            of a quote.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="shipping_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shipping method</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isEdit}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableMethods.map((method) => (
                          <SelectItem key={method} value={method}>
                            {SHIPPING_METHOD_LABELS[method]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {isEdit
                        ? "Fixed once mapped — delete the row to remap this method."
                        : "Methods already mapped are not listed; each one may have a single option."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="carrier_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrier</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a carrier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {carriers.map((carrier) => (
                          <SelectItem key={carrier.id} value={String(carrier.id)}>
                            {carrier.name}
                            {!carrier.is_active && " (inactive)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="service_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* A closed list of what this carrier actually has
                            tiers for, never free text: this value joins to
                            carrier_services.service_type, and a value with no
                            tiers behind it fails the quote silently rather than
                            erroring anywhere visible. */}
                        <SelectItem value={NO_SERVICE_TYPE}>
                          None — priced without the rate card
                        </SelectItem>
                        {carrierServiceTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {carrierServiceTypes.length === 0
                        ? "This carrier has no rate card tiers, so it is priced by its API or by a fixed price."
                        : "Which half of the carrier's rate card prices this method."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billing_weight_mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billed on</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BILLING_WEIGHT_MODES.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {mode === "actual"
                              ? "Actual weight"
                              : "Chargeable weight"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Chargeable is the greater of actual and volumetric weight.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <NumberField
              form={form}
              name="fixed_price_aud"
              label="Fixed price"
              unit="AUD"
              step="0.01"
              description="Setting this short-circuits everything else: no zone lookup, no rate card, no API call. Leave it blank unless the price is the same for every destination."
            />

            {fixedPrice === "" && (
              <p className="text-xs text-muted-foreground">
                Priced from the carrier&apos;s rate card or API. The limits below
                are applied before that happens — an order that breaches one is
                dropped from this option with the reason shown on the quote.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                form={form}
                name="max_order_total_aud"
                label="Max order total"
                unit="AUD"
                step="0.01"
                description="Above this, the option is dropped — typically a carrier's insurance ceiling."
              />
              <NumberField
                form={form}
                name="max_packed_length_mm"
                label="Max packed length"
                unit="mm"
                step="1"
              />
              <NumberField
                form={form}
                name="max_packed_width_mm"
                label="Max packed width"
                unit="mm"
                step="1"
              />
              <NumberField
                form={form}
                name="max_packed_thickness_mm"
                label="Max packed thickness"
                unit="mm"
                step="1"
              />
            </div>

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 rounded-lg border border-border p-3">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormDescription>
                      Off means this method is not offered on any future quote.
                      Quotes already recorded keep it.
                    </FormDescription>
                  </div>
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

function NumberField({
  form,
  name,
  label,
  unit,
  step,
  description,
}: {
  form: ReturnType<typeof useForm<DispatchOptionFormValues>>
  name: keyof DispatchOptionFormValues
  label: string
  unit: string
  step: string
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            <span className="ml-1 text-xs text-muted-foreground">({unit})</span>
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              step={step}
              placeholder="No limit"
              {...field}
              value={typeof field.value === "boolean" ? "" : field.value}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
