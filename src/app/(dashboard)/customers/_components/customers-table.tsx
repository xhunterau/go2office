"use client"

import * as React from "react"
import Link from "next/link"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { CustomerListRow } from "@/lib/queries/customers"
import { deleteCustomer } from "@/lib/actions/customer"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"

const COLUMN_COUNT = 7

// A customer is identified by whichever of the three they have: 20347 rows have
// no eBay username, and the deduplication that produced this table keyed on
// username falling back to email (docs/orders-domain-migration.md 4.2).
export function customerDisplayName(customer: {
  full_name: string | null
  platform_user_id: string | null
  email: string | null
}): string {
  return (
    customer.full_name ?? customer.platform_user_id ?? customer.email ?? "—"
  )
}

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  // Only the id: the dialog fetches the full row itself, because the list row
  // is missing five of the columns the update writes.
  const [editingId, setEditingId] = React.useState<number | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  async function handleDelete(customer: CustomerListRow) {
    const ok = await confirm({
      title: "Delete customer",
      description: `Delete ${customerDisplayName(customer)}? Customers with orders cannot be deleted.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteCustomer(customer.id)
      if (result.success) toast.success("Customer deleted")
      // Almost every customer has orders and ON DELETE RESTRICT stops it. The
      // action turns that into a message carrying the order count, which is the
      // whole point of surfacing it rather than a raw constraint error.
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>eBay user</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Suburb</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Postcode</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT + 1}
                  className="h-24 text-center text-muted-foreground"
                >
                  No customers found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-56 truncate font-medium">
                    <Link
                      href={`/customers/${row.id}`}
                      className="hover:underline"
                    >
                      {customerDisplayName(row)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.platform_user_id ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-muted-foreground">
                        {row.email ?? "—"}
                      </span>
                      {/* 89287 of these are @members.ebay.com relay addresses,
                          which stop working once the transaction closes
                          (docs/orders-ui.md 12). */}
                      {row.is_anonymised_email && (
                        <Badge variant="inactive">Relay</Badge>
                      )}
                    </div>
                  </TableCell>
                  {/* customers.city holds the suburb (docs/orders-ui.md 4.1),
                      and the values are migrated verbatim -- mixed case and
                      spelling variants are expected here. */}
                  <TableCell className="text-muted-foreground">
                    {row.city ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.state ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.postcode ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.order_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${customerDisplayName(row)}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditingId(row.id)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isPending}
                          onSelect={(event) => {
                            event.preventDefault()
                            void handleDelete(row)
                          }}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customerId={editingId}
      />
    </>
  )
}
