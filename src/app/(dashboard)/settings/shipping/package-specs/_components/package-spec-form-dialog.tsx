"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { PackageSpecRow } from "@/lib/queries/shipping-reference"
import {
  PACKAGE_SIZE_LABELS,
  PACKAGE_TYPES,
  packageSpecFormSchema,
  type PackageSpecFormValues,
} from "@/lib/validations/shipping-reference"
import { createPackageSpec, updatePackageSpec } from "@/lib/actions/package-spec"
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

// Numbers live in the form as strings, which is what the inputs produce; the
// server schema coerces them on arrival. Same split as the product dialogs.
type FormValues = PackageSpecFormValues

const EMPTY: FormValues = {
  package_type: "satchel",
  size_label: "M",
  length_mm: "",
  width_mm: "",
  depth_mm: "",
  maps_to_weight_kg: "",
  sort_order: "0",
}

export function PackageSpecFormDialog({
  open,
  onOpenChange,
  spec,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec?: PackageSpecRow | null
}) {
  const isEdit = Boolean(spec)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(packageSpecFormSchema),
    defaultValues: EMPTY,
  })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      spec
        ? {
            package_type: spec.package_type as FormValues["package_type"],
            size_label: spec.size_label as FormValues["size_label"],
            length_mm: String(spec.length_mm),
            width_mm: String(spec.width_mm),
            depth_mm: spec.depth_mm === null ? "" : String(spec.depth_mm),
            maps_to_weight_kg: String(spec.maps_to_weight_kg),
            sort_order: String(spec.sort_order),
          }
        : EMPTY
    )
  }, [open, spec, form])

  // useWatch rather than form.watch(): the latter returns a fresh function each
  // render, which opts the whole component out of React Compiler memoization.
  const packageType = useWatch({ control: form.control, name: "package_type" })

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = isEdit
        ? await updatePackageSpec(spec!.id, values)
        : await createPackageSpec(values)

      if (result.success) {
        toast.success(isEdit ? "Package spec updated" : "Package spec created")
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
          <DialogTitle>
            {isEdit ? "Edit Package Spec" : "Add Package Spec"}
          </DialogTitle>
          <DialogDescription>
            The dimensions an order is fit-checked against, and the weight this
            packaging is billed at.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="package_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Package type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PACKAGE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type === "satchel" ? "Satchel" : "Box"}
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
                name="size_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PACKAGE_SIZE_LABELS.map((size) => (
                          <SelectItem key={size} value={size}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Matched against the shipping method&apos;s own size, e.g.
                      MyPost Regular M Satchel.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField
                form={form}
                name="length_mm"
                label="Length"
                unit="mm"
                step="1"
              />
              <NumberField
                form={form}
                name="width_mm"
                label="Width"
                unit="mm"
                step="1"
              />
              <NumberField
                form={form}
                name="depth_mm"
                label="Depth"
                unit="mm"
                step="1"
                description={
                  packageType === "satchel"
                    ? "Leave blank — a satchel has no fixed depth."
                    : "Required for a box."
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                form={form}
                name="maps_to_weight_kg"
                label="Billed as"
                unit="kg"
                step="0.001"
                description="Must match a rate card tier weight for this carrier exactly, or the option cannot be priced."
              />
              <NumberField
                form={form}
                name="sort_order"
                label="Sort order"
                unit=""
                step="1"
                description="Display order within its type."
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

function NumberField({
  form,
  name,
  label,
  unit,
  step,
  description,
}: {
  form: ReturnType<typeof useForm<FormValues>>
  name: keyof FormValues
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
            {unit && (
              <span className="ml-1 text-xs text-muted-foreground">({unit})</span>
            )}
          </FormLabel>
          <FormControl>
            <Input type="number" inputMode="decimal" step={step} {...field} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
