"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { Tables } from "@/lib/supabase/database.types"
import { brandSchema, type BrandInput } from "@/lib/validations/brand"
import { createBrand, updateBrand } from "@/lib/actions/brand"
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

type Brand = Tables<"brands">

export function BrandFormDialog({
  open,
  onOpenChange,
  brand,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brand?: Brand | null
}) {
  const isEdit = Boolean(brand)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<BrandInput>({
    resolver: zodResolver(brandSchema),
    defaultValues: { name: "", abbr: "" },
  })

  // Reset fields whenever the dialog opens for a different record.
  React.useEffect(() => {
    if (open) {
      form.reset({
        name: brand?.name ?? "",
        abbr: brand?.abbr ?? "",
      })
    }
  }, [open, brand, form])

  function onSubmit(values: BrandInput) {
    startTransition(async () => {
      const result = isEdit
        ? await updateBrand(brand!.id, values)
        : await createBrand(values)

      if (result.success) {
        toast.success(isEdit ? "Brand updated" : "Brand created")
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
          <DialogTitle>{isEdit ? "Edit Brand" : "Add Brand"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the brand details below."
              : "Create a new brand."}
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
                    <Input placeholder="Brand name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="abbr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Abbreviation</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
