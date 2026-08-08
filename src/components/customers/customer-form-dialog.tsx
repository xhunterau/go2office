"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import type { CustomerDetail } from "@/lib/queries/customers"
import {
  createCustomer,
  loadCustomer,
  updateCustomer,
} from "@/lib/actions/customer"
import { customerSchema, type CustomerInput } from "@/lib/validations/customer"
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
import { Skeleton } from "@/components/ui/skeleton"

const EMPTY: CustomerInput = {
  platform_user_id: "",
  full_name: "",
  email: "",
  phone: "",
  company_name: "",
  address_line1: "",
  address_line2: "",
  address_line3: "",
  address_line4: "",
  city: "",
  state: "",
  postcode: "",
  country: "",
}

function toFormValues(customer: CustomerDetail): CustomerInput {
  return {
    platform_user_id: customer.platform_user_id ?? "",
    full_name: customer.full_name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    company_name: customer.company_name ?? "",
    address_line1: customer.address_line1 ?? "",
    address_line2: customer.address_line2 ?? "",
    address_line3: customer.address_line3 ?? "",
    address_line4: customer.address_line4 ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    postcode: customer.postcode ?? "",
    country: customer.country ?? "",
  }
}

// Shared by /customers and /customers/[id] (project rule 5).
//
// Takes an id, not a row: updateCustomer writes all thirteen editable columns,
// while the list row carries eight of them. Seeding the form from whatever the
// caller happened to have would silently blank the rest, so the full row is
// always fetched when the dialog opens.
export function CustomerFormDialog({
  open,
  onOpenChange,
  customerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Absent for a new customer.
  customerId?: number
}) {
  const isEdit = customerId !== undefined
  const [isPending, startTransition] = React.useTransition()
  // The fetch runs in a transition so the pending flag comes from React rather
  // than from a setState in the effect body.
  const [loading, startLoading] = React.useTransition()

  const form = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY,
  })

  React.useEffect(() => {
    if (!open) return

    if (customerId === undefined) {
      form.reset(EMPTY)
      return
    }

    let cancelled = false
    startLoading(async () => {
      const result = await loadCustomer(customerId)
      if (cancelled) return
      if (result.success && result.data) {
        form.reset(toFormValues(result.data))
      } else {
        toast.error(result.error ?? "Could not load this customer")
        onOpenChange(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [open, customerId, form, onOpenChange])

  function onSubmit(values: CustomerInput) {
    startTransition(async () => {
      const result = isEdit
        ? await updateCustomer(customerId, values)
        : await createCustomer(values)

      if (result.success) {
        toast.success(isEdit ? "Customer updated" : "Customer created")
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
          <DialogTitle>{isEdit ? "Edit customer" : "Add customer"}</DialogTitle>
          <DialogDescription>
            Every field is optional, but a customer needs at least one detail.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  form={form}
                  name="full_name"
                  label="Name"
                  placeholder="Full name"
                />
                <TextField
                  form={form}
                  name="platform_user_id"
                  label="eBay username"
                  placeholder="Platform user ID"
                />
                <TextField
                  form={form}
                  name="email"
                  label="Email"
                  placeholder="name@example.com"
                />
                <TextField form={form} name="phone" label="Phone" />
                <TextField form={form} name="company_name" label="Company" />
              </div>

              <div className="space-y-4 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Address
                  </h3>
                  {/* Orders keep no address of their own, so this one is what
                      every order of theirs displays -- 8150 orders already show
                      an address they were not sent to (docs/orders-ui.md 7.3).
                      Whoever edits it has to know that. */}
                  <p className="text-sm text-muted-foreground">
                    Used for all of this customer&apos;s orders, including past
                    ones.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    form={form}
                    name="address_line1"
                    label="Address line 1"
                  />
                  <TextField
                    form={form}
                    name="address_line2"
                    label="Address line 2"
                  />
                  <TextField
                    form={form}
                    name="address_line3"
                    label="Address line 3"
                  />
                  <TextField
                    form={form}
                    name="address_line4"
                    label="Address line 4"
                  />
                  {/* The column is `city`; Australian users call it a suburb
                      (docs/orders-ui.md 4.1). */}
                  <TextField form={form} name="city" label="Suburb" />
                  <TextField form={form} name="state" label="State" />
                  <TextField form={form} name="postcode" label="Postcode" />
                  <TextField form={form} name="country" label="Country" />
                </div>
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
        )}
      </DialogContent>
    </Dialog>
  )
}

function TextField({
  form,
  name,
  label,
  placeholder,
}: {
  form: ReturnType<typeof useForm<CustomerInput>>
  name: keyof CustomerInput
  label: string
  placeholder?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
