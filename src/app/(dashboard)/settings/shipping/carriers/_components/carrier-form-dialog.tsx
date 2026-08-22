"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { CarrierRow } from "@/lib/queries/shipping-reference"
import {
  carrierCreateSchema,
  type CarrierCreateInput,
} from "@/lib/validations/shipping-reference"
import { createCarrier, updateCarrier } from "@/lib/actions/carrier"
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
import { Switch } from "@/components/ui/switch"

export function CarrierFormDialog({
  open,
  onOpenChange,
  carrier,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  carrier?: CarrierRow | null
}) {
  const isEdit = Boolean(carrier)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<CarrierCreateInput>({
    resolver: zodResolver(carrierCreateSchema),
    defaultValues: { code: "", name: "", is_active: true },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: carrier?.code ?? "",
        name: carrier?.name ?? "",
        is_active: carrier?.is_active ?? true,
      })
    }
  }, [open, carrier, form])

  function onSubmit(values: CarrierCreateInput) {
    startTransition(async () => {
      // The code is deliberately not sent on an edit. The column-level grant
      // from 20260812100000 would reject it anyway; leaving it out means the
      // rejection never has to happen.
      const result = isEdit
        ? await updateCarrier(carrier!.id, {
            name: values.name,
            is_active: values.is_active,
          })
        : await createCarrier(values)

      if (result.success) {
        toast.success(isEdit ? "Carrier updated" : "Carrier created")
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
          <DialogTitle>{isEdit ? "Edit Carrier" : "Add Carrier"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Rename this carrier or take it out of quoting."
              : "Add a carrier account. Its rate card and dispatch options are set up afterwards."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Australia Post eParcel" {...field} />
                  </FormControl>
                  <FormDescription>
                    Display only — shown on the order&apos;s quote list. Safe to
                    change at any time.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. eparcel"
                      className="font-mono lowercase"
                      readOnly={isEdit}
                      disabled={isEdit}
                      {...field}
                      onBlur={(event) => {
                        const next = event.target.value.trim().toLowerCase()
                        if (next !== event.target.value) {
                          form.setValue("code", next, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        field.onBlur()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {isEdit
                      ? "Set once, and not editable. The quote engine looks this carrier's weight and dimension limits up by this value, so changing it would detach the carrier from its own limits without any visible error."
                      : "Lowercase key, not a label. A new code has no entry in the engine's capability table yet, so this carrier will not be quoted until one is added in code."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                      Inactive carriers are skipped by every future quote. Their
                      rate cards and past quotes are left untouched.
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
