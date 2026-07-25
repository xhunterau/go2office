"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { updateProductSection } from "@/lib/actions/product"
import {
  CURRENCIES,
  PRODUCT_SECTION_FIELDS,
  productSectionFormSchemas,
  type ProductFieldKey,
  type ProductSection,
} from "@/lib/validations/product"
import {
  PRODUCT_FIELD_META,
  PRODUCT_SECTION_TITLES,
  type SectionFormValues,
} from "./product-fields"
import { ProductImageField } from "./product-image-field"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export type SectionLookups = {
  brands: { id: number; name: string | null }[]
  origins: { id: number; name: string | null }[]
  suppliers: { id: number; company_name: string | null }[]
}

// Fields that need the full dialog width rather than a grid column.
const FULL_WIDTH_KINDS = new Set(["textarea", "image"])

// Options for a lookup select, normalized to { value, label }.
function lookupOptions(
  lookups: SectionLookups,
  source: "brands" | "origins" | "suppliers"
) {
  if (source === "suppliers") {
    return lookups.suppliers.map((s) => ({
      value: String(s.id),
      label: s.company_name ?? `#${s.id}`,
    }))
  }
  return lookups[source].map((item) => ({
    value: String(item.id),
    label: item.name ?? `#${item.id}`,
  }))
}

// One dialog drives every card on the detail page: the section decides which
// fields render, which schema validates and which columns the action writes.
export function ProductSectionDialog({
  open,
  onOpenChange,
  productId,
  section,
  initialValues,
  lookups,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: number
  section: ProductSection
  initialValues: SectionFormValues
  lookups: SectionLookups
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<SectionFormValues>({
    // The schema is picked at runtime from a union of per-section shapes, so
    // its resolver cannot be statically tied to the generic value record.
    resolver: zodResolver(
      productSectionFormSchemas[section]
    ) as unknown as Resolver<SectionFormValues>,
    defaultValues: initialValues,
  })

  React.useEffect(() => {
    if (open) form.reset(initialValues)
  }, [open, initialValues, form])

  function onSubmit(values: SectionFormValues) {
    startTransition(async () => {
      const result = await updateProductSection(productId, section, values)
      if (result.success) {
        toast.success(`${PRODUCT_SECTION_TITLES[section]} updated`)
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  const fields = PRODUCT_SECTION_FIELDS[section] as readonly ProductFieldKey[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {PRODUCT_SECTION_TITLES[section]}</DialogTitle>
          {section === "details" && (
            <DialogDescription>
              The SKU is generated when the product is created and does not
              change when the brand or origin is edited.
            </DialogDescription>
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((key) => {
                const meta = PRODUCT_FIELD_META[key]
                const { control } = meta
                const fullWidth = FULL_WIDTH_KINDS.has(control.kind)

                return (
                  <FormField
                    key={key}
                    control={form.control}
                    name={key}
                    render={({ field }) => (
                      <FormItem
                        className={
                          fullWidth
                            ? "sm:col-span-2"
                            : control.kind === "switch"
                              ? "flex items-center gap-2"
                              : undefined
                        }
                      >
                        {control.kind !== "switch" && (
                          <FormLabel>{meta.label}</FormLabel>
                        )}

                        {control.kind === "switch" ? (
                          <>
                            <FormControl>
                              <Switch
                                checked={Boolean(field.value)}
                                onCheckedChange={field.onChange}
                                disabled={isPending}
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">
                              {meta.label}
                            </FormLabel>
                          </>
                        ) : control.kind === "image" ? (
                          <FormControl>
                            <ProductImageField
                              productId={productId}
                              value={String(field.value ?? "")}
                              onChange={field.onChange}
                              disabled={isPending}
                            />
                          </FormControl>
                        ) : control.kind === "textarea" ? (
                          <FormControl>
                            <Textarea
                              rows={control.rows}
                              placeholder={meta.placeholder}
                              disabled={isPending}
                              {...field}
                              value={String(field.value ?? "")}
                            />
                          </FormControl>
                        ) : control.kind === "currency" ? (
                          <Select
                            value={String(field.value ?? "")}
                            onValueChange={field.onChange}
                            disabled={isPending}
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {CURRENCIES.map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                  {currency}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : control.kind === "lookup" ? (
                          <Select
                            value={String(field.value ?? "")}
                            onValueChange={field.onChange}
                            disabled={isPending}
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={`Select ${meta.label.toLowerCase()}`}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {lookupOptions(lookups, control.source).map(
                                (option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        ) : (
                          <FormControl>
                            <Input
                              type={control.kind === "number" ? "number" : "text"}
                              step={
                                control.kind === "number"
                                  ? control.step
                                  : undefined
                              }
                              min={control.kind === "number" ? "0" : undefined}
                              placeholder={meta.placeholder}
                              disabled={isPending}
                              {...field}
                              value={String(field.value ?? "")}
                            />
                          </FormControl>
                        )}

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )
              })}
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
