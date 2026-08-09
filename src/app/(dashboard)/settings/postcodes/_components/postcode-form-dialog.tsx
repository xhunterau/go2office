"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { PostcodeRow } from "@/lib/queries/postcodes"
import {
  AU_STATES,
  NO_STATE,
  postcodeSchema,
  type PostcodeInput,
} from "@/lib/validations/postcode"
import { createPostcode, updatePostcode } from "@/lib/actions/postcode"
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

export function PostcodeFormDialog({
  open,
  onOpenChange,
  postcode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  postcode?: PostcodeRow | null
}) {
  const isEdit = Boolean(postcode)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<PostcodeInput>({
    resolver: zodResolver(postcodeSchema),
    defaultValues: { postcode: "", locality: "", state: NO_STATE },
  })

  // Reset fields whenever the dialog opens for a different record.
  React.useEffect(() => {
    if (open) {
      form.reset({
        postcode: postcode?.postcode ?? "",
        locality: postcode?.locality ?? "",
        state: (postcode?.state as PostcodeInput["state"]) ?? NO_STATE,
      })
    }
  }, [open, postcode, form])

  function onSubmit(values: PostcodeInput) {
    startTransition(async () => {
      const result = isEdit
        ? await updatePostcode(postcode!.id, values)
        : await createPostcode(values)

      if (result.success) {
        toast.success(isEdit ? "Postcode updated" : "Postcode created")
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
            {isEdit ? "Edit Postcode" : "Add Postcode"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this postcode, locality and state."
              : "Add a locality Australia Post has published since this table was imported."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="postcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 0800"
                      inputMode="numeric"
                      maxLength={4}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {/* Typing 800 for Darwin is the mistake the source data
                        already made on 389 rows, so it is padded rather than
                        rejected. */}
                    Four digits. Shorter entries are padded with leading zeros
                    (800 becomes 0800).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="locality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Locality</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. DARWIN" {...field} />
                  </FormControl>
                  <FormDescription>
                    Stored in uppercase. The suburb a customer types is matched
                    against this exactly.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a state" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {AU_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                      <SelectItem value={NO_STATE}>None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose None for alias localities Australia Post lists without
                    a state — the standardiser then leaves the customer&apos;s
                    state untouched.
                  </FormDescription>
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
