"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"
import type { ShippingSettingsRow } from "@/lib/queries/shipping-reference"
import {
  shippingSettingsSchema,
  type ShippingSettingsInput,
} from "@/lib/validations/shipping-reference"
import { updateShippingSettings } from "@/lib/actions/shipping-settings"
import { Button } from "@/components/ui/button"
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
import { Separator } from "@/components/ui/separator"

type NumberFieldSpec = {
  kind?: "number"
  name: NumberField
  label: string
  description: string
  unit: string
  step: string
}

type TextFieldSpec = {
  kind: "text"
  name: TextField
  label: string
  description: string
  placeholder?: string
}

type FieldSpec = NumberFieldSpec | TextFieldSpec

// Split by value type rather than listed by hand, so a column added to the
// schema cannot be given the wrong input kind here without failing to compile.
type NumberField = {
  [K in keyof ShippingSettingsInput]: ShippingSettingsInput[K] extends number
    ? K
    : never
}[keyof ShippingSettingsInput]

type TextField = {
  [K in keyof ShippingSettingsInput]: ShippingSettingsInput[K] extends string
    ? K
    : never
}[keyof ShippingSettingsInput]

const LIMIT_FIELDS: FieldSpec[] = [
  {
    name: "au_post_max_length_mm",
    label: "Australia Post Max Length",
    description:
      "Longest side Australia Post will carry. Anything over it drops eParcel and MyPost from the quote entirely, and a postal-only address that exceeds it is escalated for manual booking.",
    unit: "mm",
    step: "1",
  },
  {
    name: "au_post_max_weight_kg",
    label: "Australia Post Max Weight",
    description:
      "eParcel's real ceiling. MyPost has its own 5 kg limit in code, which this does not override.",
    unit: "kg",
    step: "0.001",
  },
]

const EPARCEL_FIELDS: FieldSpec[] = [
  {
    name: "eparcel_oversize_threshold_mm",
    label: "eParcel Oversize Threshold",
    description: "A parcel longer than this attracts the oversize surcharge.",
    unit: "mm",
    step: "1",
  },
  {
    name: "eparcel_oversize_surcharge_aud",
    label: "eParcel Oversize Surcharge",
    description: "Added once to an eParcel quote that crosses the threshold.",
    unit: "AUD",
    step: "0.01",
  },
  {
    name: "eparcel_fuel_charge_rate",
    label: "eParcel Fuel Charge",
    description:
      "A fraction, not a percentage: 0.099 means 9.9%. Applied to the eParcel rate after the surcharge.",
    unit: "ratio",
    step: "0.0001",
  },
]

const SELECTION_FIELDS: FieldSpec[] = [
  {
    name: "quote_tiebreak_threshold",
    label: "Quote Tiebreak Threshold",
    description:
      "Two quotes within this fraction of each other count as the same price, and the tie goes to the preferred carrier rather than the cheaper row. At 0 the cheapest always wins. 0.05 means 5%.",
    unit: "ratio",
    step: "0.0001",
  },
]

const SENDER_FIELDS: FieldSpec[] = [
  {
    kind: "text",
    name: "sender_name",
    label: "Sender Name",
    description: "The trading name that appears as the sender.",
    placeholder: "Go2buy Australia",
  },
  {
    kind: "text",
    name: "sender_address_line1",
    label: "Sender Address Line 1",
    description: "Street address or Parcel Locker line.",
    placeholder: "Parcel Locker 10147 39821",
  },
  {
    kind: "text",
    name: "sender_address_line2",
    label: "Sender Address Line 2",
    description: "Optional. Leave blank if line 1 is the whole address.",
    placeholder: "1-7 Venture Way",
  },
  {
    kind: "text",
    name: "sender_suburb",
    label: "Sender Suburb",
    description: "",
    placeholder: "Braeside",
  },
  {
    kind: "text",
    name: "sender_state",
    label: "Sender State",
    description: "",
    placeholder: "VIC",
  },
  {
    kind: "text",
    name: "sender_postcode",
    label: "Sender Postcode",
    description: "Four digits.",
    placeholder: "3195",
  },
]

const FALLBACK_FIELDS: FieldSpec[] = [
  {
    kind: "text",
    name: "fallback_email",
    label: "Fallback Email",
    description:
      "Stands in when a customer has no email on file. Australia Post treats it as mandatory on most consignment types. Leave blank and the exports stop with a message instead of running — which is the safe outcome, since anything put here is printed on someone else's parcel.",
    placeholder: "dispatch@example.com",
  },
  {
    kind: "text",
    name: "fallback_phone",
    label: "Fallback Phone",
    description:
      "Stands in when a customer's phone number has fewer than nine digits. Same rule as the email: blank stops the export rather than inventing a number.",
    placeholder: "+61300000000",
  },
]

export function ShippingSettingsForm({
  settings,
}: {
  settings: ShippingSettingsRow
}) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ShippingSettingsInput>({
    resolver: zodResolver(shippingSettingsSchema),
    defaultValues: {
      au_post_max_length_mm: settings.au_post_max_length_mm,
      au_post_max_weight_kg: settings.au_post_max_weight_kg,
      eparcel_oversize_surcharge_aud: settings.eparcel_oversize_surcharge_aud,
      eparcel_oversize_threshold_mm: settings.eparcel_oversize_threshold_mm,
      eparcel_fuel_charge_rate: settings.eparcel_fuel_charge_rate,
      quote_tiebreak_threshold: settings.quote_tiebreak_threshold,
      sender_name: settings.sender_name,
      sender_address_line1: settings.sender_address_line1,
      sender_address_line2: settings.sender_address_line2,
      sender_suburb: settings.sender_suburb,
      sender_state: settings.sender_state,
      sender_postcode: settings.sender_postcode,
      fallback_email: settings.fallback_email,
      fallback_phone: settings.fallback_phone,
    },
  })

  function onSubmit(values: ShippingSettingsInput) {
    startTransition(async () => {
      const result = await updateShippingSettings(values)
      if (result.success) {
        toast.success("Shipping constants updated")
        form.reset(values)
      } else {
        toast.error(result.error ?? "Failed to update shipping constants")
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <FieldGroup title="Carrier limits" fields={LIMIT_FIELDS} form={form} />
        <Separator />
        <FieldGroup title="eParcel surcharges" fields={EPARCEL_FIELDS} form={form} />
        <Separator />
        <FieldGroup title="Quote selection" fields={SELECTION_FIELDS} form={form} />
        <Separator />
        <FieldGroup
          title="Sender block"
          description="Printed on the MyPost Business CSV's Send From columns and on the self-printed A6 label. eParcel takes the sender from the charge account and Aramex from its own account, so neither reads these."
          fields={SENDER_FIELDS}
          form={form}
        />
        <Separator />
        <FieldGroup
          title="Contact fallbacks"
          fields={FALLBACK_FIELDS}
          form={form}
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Last updated {formatDateTime(settings.updated_at)}
          </p>
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function FieldGroup({
  title,
  description,
  fields,
  form,
}: {
  title: string
  description?: string
  fields: FieldSpec[]
  form: ReturnType<typeof useForm<ShippingSettingsInput>>
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {description ? (
        <p className="text-xs text-muted-foreground sm:max-w-3xl">{description}</p>
      ) : null}
      <div className="rounded-xl border border-border">
        {fields.map((field, index) => (
          <FormField
            key={field.name}
            control={form.control}
            name={field.name}
            render={({ field: controlled }) => (
              <FormItem
                className={cn(
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between",
                  index > 0 && "border-t border-border"
                )}
              >
                <div className="space-y-1 sm:max-w-md">
                  <FormLabel>{field.label}</FormLabel>
                  {field.description ? (
                    <FormDescription>{field.description}</FormDescription>
                  ) : null}
                  <FormMessage />
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  {field.kind === "text" ? (
                    <FormControl>
                      <Input
                        type="text"
                        className="w-64"
                        placeholder={field.placeholder}
                        {...controlled}
                        value={typeof controlled.value === "string" ? controlled.value : ""}
                      />
                    </FormControl>
                  ) : (
                    <>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step={field.step}
                          className="w-40"
                          {...controlled}
                          value={
                            Number.isFinite(controlled.value)
                              ? (controlled.value as number)
                              : ""
                          }
                          // Empty input yields NaN rather than 0, so the Zod
                          // message reads "is required" instead of silently
                          // saving a zero -- and a zero in any of these fields
                          // is a real value the engine would act on.
                          onChange={(event) =>
                            controlled.onChange(
                              event.target.value === ""
                                ? Number.NaN
                                : event.target.valueAsNumber
                            )
                          }
                        />
                      </FormControl>
                      <span className="w-12 text-xs text-muted-foreground">
                        {field.unit}
                      </span>
                    </>
                  )}
                </div>
              </FormItem>
            )}
          />
        ))}
      </div>
    </div>
  )
}
