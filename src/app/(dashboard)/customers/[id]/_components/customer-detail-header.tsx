"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { CustomerDetail } from "@/lib/queries/customers"
import { deleteCustomer } from "@/lib/actions/customer"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"

export function CustomerDetailHeader({
  customer,
}: {
  customer: CustomerDetail
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [editOpen, setEditOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const displayName =
    customer.full_name ?? customer.platform_user_id ?? customer.email ?? "—"

  const addressLines = [
    customer.company_name,
    customer.address_line1,
    customer.address_line2,
    customer.address_line3,
    customer.address_line4,
    [customer.city, customer.state, customer.postcode].filter(Boolean).join(" "),
    customer.country,
  ].filter((line): line is string => Boolean(line && line.trim()))

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete customer",
      description:
        customer.order_count > 0
          ? `${displayName} has ${customer.order_count} ${
              customer.order_count === 1 ? "order" : "orders"
            } on file and cannot be deleted.`
          : `Delete ${displayName}? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteCustomer(customer.id)
      if (result.success) {
        toast.success("Customer deleted")
        router.push("/customers")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/customers"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">
            {displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {customer.order_count === 1
              ? "1 order"
              : `${customer.order_count} orders`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending}
                onSelect={(event) => {
                  event.preventDefault()
                  void handleDelete()
                }}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Name">{customer.full_name ?? "—"}</Field>
            <Field label="eBay username">
              {customer.platform_user_id ?? "—"}
            </Field>
            <Field label="Email">
              {customer.email ? (
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  {customer.email}
                  {/* An @members.ebay.com relay address: it stops accepting
                      mail once the transaction closes, so anything built on it
                      later will bounce (docs/orders-ui.md 12). */}
                  {customer.is_anonymised_email && (
                    <Badge variant="inactive">Relay address</Badge>
                  )}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Phone">{customer.phone ?? "—"}</Field>
            <Field label="Company">{customer.company_name ?? "—"}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {addressLines.length > 0 ? (
              <div className="space-y-1 text-muted-foreground">
                {addressLines.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No address on file.</p>
            )}
            {/* Editing this changes the address shown on every one of their
                orders, past ones included -- orders keep no snapshot of their
                own (docs/orders-ui.md 7.3). */}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Used for all of this customer&apos;s orders, including past ones.
            </p>
          </CardContent>
        </Card>
      </div>

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customerId={customer.id}
      />
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  )
}
