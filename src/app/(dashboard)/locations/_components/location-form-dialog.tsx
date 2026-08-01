"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { LocationListRow } from "@/lib/queries/locations"
import { locationSchema, type LocationInput } from "@/lib/validations/location"
import { createLocation, updateLocation } from "@/lib/actions/location"
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
import { Textarea } from "@/components/ui/textarea"

export function LocationFormDialog({
  open,
  onOpenChange,
  location,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  location?: LocationListRow | null
}) {
  const isEdit = Boolean(location)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<LocationInput>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: "", comments: "" },
  })

  // Reset fields whenever the dialog opens for a different record.
  React.useEffect(() => {
    if (open) {
      form.reset({
        name: location?.name ?? "",
        comments: location?.comments ?? "",
      })
    }
  }, [open, location, form])

  function onSubmit(values: LocationInput) {
    startTransition(async () => {
      const result = isEdit
        ? await updateLocation(location!.id, values)
        : await createLocation(values)

      if (result.success) {
        toast.success(isEdit ? "Location updated" : "Location created")
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
            {isEdit ? "Edit Location" : "Add Location"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the storage location details below."
              : "Create a new storage location."}
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
                    <Input placeholder="e.g. S-1-1" {...field} />
                  </FormControl>
                  <FormDescription>
                    Must be unique across the warehouse.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="comments"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comments</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional"
                      rows={3}
                      {...field}
                      value={field.value ?? ""}
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
