"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { CountryRow } from "@/lib/queries/countries"
import { countrySchema, type CountryInput } from "@/lib/validations/country"
import { createCountry, updateCountry } from "@/lib/actions/country"
import { titleCase } from "@/lib/format"
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

export function CountryFormDialog({
  open,
  onOpenChange,
  country,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  country?: CountryRow | null
}) {
  const isEdit = Boolean(country)
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<CountryInput>({
    resolver: zodResolver(countrySchema),
    defaultValues: { country_name: "", country_code: "" },
  })

  // Reset fields whenever the dialog opens for a different record.
  React.useEffect(() => {
    if (open) {
      form.reset({
        country_name: country?.country_name ?? "",
        country_code: country?.country_code ?? "",
      })
    }
  }, [open, country, form])

  function save(values: CountryInput) {
    startTransition(async () => {
      const result = isEdit
        ? await updateCountry(country!.id, values)
        : await createCountry(values)

      if (result.success) {
        toast.success(isEdit ? "Country updated" : "Country created")
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  async function onSubmit(values: CountryInput) {
    const nextCode = values.country_code.trim().toUpperCase()

    // Changing the code is the one consequential edit on this page, and the
    // consequence is invisible from here: the standardiser does not revisit
    // existing rows. Renaming the country has no equivalent cost, because the
    // lookup lowercases both sides -- so only this branch asks.
    if (isEdit && nextCode !== country!.country_code) {
      const ok = await confirm({
        title: "Change country code",
        description: `Customers already standardised to ${country!.country_code} keep that code — this is not retroactive. New saves will use ${nextCode}, so ${country!.country_name} will sit under two codes until every one of those customers is written again, and grouping by country will count them twice.`,
        confirmText: "Change code",
        cancelText: "Cancel",
        variant: "destructive",
      })
      if (!ok) return
    }

    save(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Country" : "Add Country"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update how this country's name is collapsed onto an ISO code."
              : "Add a destination this business has started shipping to."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="country_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. New Zealand"
                      {...field}
                      // Tidied on blur, not on submit. Casing here is display
                      // only, and titleCase gets names like "Bosnia and
                      // Herzegovina" wrong -- so the suggestion has to be one
                      // the user can type over and keep.
                      onBlur={(event) => {
                        const next = titleCase(event.target.value.trim())
                        if (next !== event.target.value) {
                          form.setValue("country_name", next, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        field.onBlur()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Matched against whatever the customer typed, ignoring case.
                    Capitalisation is tidied as you leave the field — edit it
                    back if a name needs a lowercase word.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="country_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. NZ"
                      maxLength={2}
                      autoCapitalize="characters"
                      className="uppercase"
                      {...field}
                      // Unlike the name, this one is not a suggestion -- the
                      // column's CHECK takes uppercase only. Lifting it on blur
                      // just means the user sees the stored value before
                      // submitting rather than after.
                      onBlur={(event) => {
                        const next = event.target.value.trim().toUpperCase()
                        if (next !== event.target.value) {
                          form.setValue("country_code", next, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        field.onBlur()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    ISO 3166-1 alpha-2 — two letters, stored uppercase. This is
                    the value written onto every customer in this country.
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
