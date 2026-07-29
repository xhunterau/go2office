"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { PricingSettings } from "@/lib/queries/product-pricing"
import {
  pricingSettingsSchema,
  type PricingSettingsInput,
} from "@/lib/validations/pricing-settings"
import { updatePricingSettings } from "@/lib/actions/pricing-settings"
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

type FieldName = keyof PricingSettingsInput

type FieldSpec = {
  name: FieldName
  label: string
  description: string
  unit: string
  step: string
}

// Labels deliberately match the legacy System Constants screen so the numbers
// stay recognisable, with two corrections: the legacy "Sea Freight per sqm" was
// a typo for cbm, and the volumetric factors are new.
const RATE_FIELDS: FieldSpec[] = [
  {
    name: "usd_to_aud",
    label: "USD to AUD",
    description: "1 USD equals this many AUD. USD purchase prices are multiplied by it.",
    unit: "ratio",
    step: "0.000001",
  },
  {
    name: "aud_to_cny",
    label: "AUD to CNY",
    description: "1 AUD equals this many CNY. CNY purchase prices are divided by it.",
    unit: "ratio",
    step: "0.000001",
  },
  {
    name: "gst_rate",
    label: "GST Rate",
    description: "A fraction, not a percentage: 0.1 means 10%.",
    unit: "ratio",
    step: "0.0001",
  },
]

const FREIGHT_FIELDS: FieldSpec[] = [
  {
    name: "air_freight_aud_per_kg",
    label: "Air Freight per kg",
    description: "Charged per chargeable kilogram.",
    unit: "AUD/kg",
    step: "0.01",
  },
  {
    name: "sea_freight_aud_per_cbm",
    label: "Sea Freight per cbm",
    description: "Charged per cubic metre.",
    unit: "AUD/m³",
    step: "0.01",
  },
  {
    name: "air_volumetric_kg_per_cbm",
    label: "Air Volumetric Factor",
    description:
      "1 m³ counts as this many kg. Air freight bills the greater of actual and volumetric weight.",
    unit: "kg/m³",
    step: "0.01",
  },
  {
    name: "sea_volumetric_kg_per_cbm",
    label: "Sea Volumetric Factor",
    description:
      "1 m³ counts as this many kg. Sea freight bills the greater of actual volume and weight.",
    unit: "kg/m³",
    step: "0.01",
  },
]

export function PricingSettingsForm({
  settings,
}: {
  settings: PricingSettings
}) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<PricingSettingsInput>({
    resolver: zodResolver(pricingSettingsSchema),
    defaultValues: {
      usd_to_aud: settings.usd_to_aud,
      aud_to_cny: settings.aud_to_cny,
      gst_rate: settings.gst_rate,
      air_freight_aud_per_kg: settings.air_freight_aud_per_kg,
      sea_freight_aud_per_cbm: settings.sea_freight_aud_per_cbm,
      air_volumetric_kg_per_cbm: settings.air_volumetric_kg_per_cbm,
      sea_volumetric_kg_per_cbm: settings.sea_volumetric_kg_per_cbm,
    },
  })

  function onSubmit(values: PricingSettingsInput) {
    startTransition(async () => {
      const result = await updatePricingSettings(values)
      if (result.success) {
        toast.success("System constants updated")
        form.reset(values)
      } else {
        toast.error(result.error ?? "Failed to update system constants")
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <FieldGroup fields={RATE_FIELDS} form={form} />
        <Separator />
        <FieldGroup fields={FREIGHT_FIELDS} form={form} />

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Last updated{" "}
            {new Date(settings.updated_at).toLocaleString("en-AU", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
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
  fields,
  form,
}: {
  fields: FieldSpec[]
  form: ReturnType<typeof useForm<PricingSettingsInput>>
}) {
  return (
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
                <FormDescription>{field.description}</FormDescription>
                <FormMessage />
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step={field.step}
                    className="w-40"
                    {...controlled}
                    value={
                      Number.isFinite(controlled.value) ? controlled.value : ""
                    }
                    // Empty input yields NaN rather than 0 so the Zod message
                    // reads "is required" instead of silently saving a zero.
                    onChange={(event) =>
                      controlled.onChange(
                        event.target.value === ""
                          ? Number.NaN
                          : event.target.valueAsNumber
                      )
                    }
                  />
                </FormControl>
                <span className="w-16 text-xs text-muted-foreground">
                  {field.unit}
                </span>
              </div>
            </FormItem>
          )}
        />
      ))}
    </div>
  )
}
