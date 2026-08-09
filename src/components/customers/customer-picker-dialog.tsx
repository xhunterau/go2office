"use client"

import * as React from "react"
import { Plus, Search } from "lucide-react"
import { toast } from "sonner"

import type { CustomerListRow } from "@/lib/queries/customers"
import { loadCustomer, searchCustomers } from "@/lib/actions/customer"
import { customerDisplayName } from "@/lib/customers/display-name"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

type PickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Shown as the current one and not selectable, so the picker cannot be used to
  // "replace" a record with what it already has.
  currentCustomerId?: number
  title?: string
  description?: string
  confirmLabel?: string
  // Resolves true when the pick was accepted and the picker should close.
  onPick: (customerId: number) => Promise<boolean>
}

// Find an existing customer, or create one on the spot when the search comes up
// empty. Shared rather than page-local because "point this record at a
// customer" is not going to stay a one-caller problem.
//
// The caller owns what happens to the chosen customer: onPick decides whether to
// confirm, performs the write, and returns whether the picker should close. That
// keeps the confirmation wording -- which is about the caller's record, not
// about customers -- out of here.
export function CustomerPickerDialog(props: PickerProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        {/* The body holds every piece of picker state and lives inside the
            portal, which Radix unmounts on close. That is what resets the search
            between openings -- a reopened picker showing results for whichever
            record was on screen last time would be worse than showing none. No
            effect needed for it. */}
        <PickerBody {...props} />
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({
  onOpenChange,
  currentCustomerId,
  title = "Find a customer",
  description = "Search by name, email, eBay username, suburb or postcode.",
  confirmLabel = "Select customer",
  onPick,
}: PickerProps) {
  const [name, setName] = React.useState("")
  const [suburb, setSuburb] = React.useState("")
  const [postcode, setPostcode] = React.useState("")

  const [rows, setRows] = React.useState<CustomerListRow[]>([])
  const [page, setPage] = React.useState(1)
  const [hasMore, setHasMore] = React.useState(false)
  const [searched, setSearched] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)

  const [isSearching, startSearch] = React.useTransition()
  const [isPicking, startPick] = React.useTransition()
  const busy = isSearching || isPicking

  function runSearch(nextPage: number) {
    startSearch(async () => {
      const result = await searchCustomers({
        name,
        suburb,
        postcode,
        page: nextPage,
      })
      if (!result.success || !result.data) {
        toast.error(result.error ?? "Could not search customers")
        return
      }
      setRows(result.data.rows)
      setPage(result.data.page)
      setHasMore(result.data.hasMore)
      setSearched(true)
      // The selection belongs to the page it was made on; keeping it across a
      // page change would leave the confirm button armed with a row that is no
      // longer on screen.
      setSelectedId(null)
    })
  }

  // The new customer replaces the result list and comes back selected. They were
  // just typed out by hand, so sending the user to the search box to find them
  // again would be theatre.
  function handleCreated(id: number) {
    startSearch(async () => {
      const result = await loadCustomer(id)
      if (!result.success || !result.data) {
        toast.error(
          result.error ?? "Created, but could not load the new customer"
        )
        return
      }
      setRows([result.data])
      setPage(1)
      setHasMore(false)
      setSearched(true)
      setSelectedId(id)
    })
  }

  function handleConfirm() {
    if (selectedId == null) return
    startPick(async () => {
      const done = await onPick(selectedId)
      if (done) onOpenChange(false)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          runSearch(1)
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field
          id="customer-picker-name"
          label="Customer"
          placeholder="Name, email or eBay username"
          className="w-64"
          value={name}
          onChange={setName}
          disabled={busy}
        />
        {/* The column is `city`; Australian users call it a suburb
            (docs/orders-ui.md 4.1). */}
        <Field
          id="customer-picker-suburb"
          label="Suburb"
          placeholder="Suburb"
          className="w-40"
          value={suburb}
          onChange={setSuburb}
          disabled={busy}
        />
        <Field
          id="customer-picker-postcode"
          label="Postcode"
          // Prefix matched, which is all the btree index on postcode supports.
          placeholder="Starts with"
          className="w-32"
          value={postcode}
          onChange={setPostcode}
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          <Search />
          {isSearching ? "Searching..." : "Search"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          Create customer
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Customer</TableHead>
              <TableHead>eBay user</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Suburb</TableHead>
              <TableHead>Postcode</TableHead>
              <TableHead className="text-right">Orders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  {searched
                    ? "No customers matched. Create one instead."
                    : "Search for a customer to get started."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const isCurrent = row.id === currentCustomerId
                return (
                  <TableRow
                    key={row.id}
                    data-state={selectedId === row.id ? "selected" : undefined}
                    className={cn(
                      !isCurrent && "cursor-pointer",
                      isCurrent && "text-muted-foreground"
                    )}
                    onClick={() => {
                      if (!isCurrent && !busy) setSelectedId(row.id)
                    }}
                  >
                    <TableCell>
                      <input
                        type="radio"
                        name="customer-picker-selection"
                        className="size-4 accent-primary"
                        aria-label={`Select ${customerDisplayName(row)}`}
                        checked={selectedId === row.id}
                        disabled={isCurrent || busy}
                        onChange={() => setSelectedId(row.id)}
                      />
                    </TableCell>
                    <TableCell className="max-w-56 truncate font-medium">
                      <span className="flex items-center gap-2">
                        <span className="truncate">
                          {customerDisplayName(row)}
                        </span>
                        {isCurrent && <Badge variant="outline">Current</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.platform_user_id ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-muted-foreground">
                          {row.email ?? "—"}
                        </span>
                        {/* 89287 of these are @members.ebay.com relay
                            addresses, which stop working once the transaction
                            closes (docs/orders-ui.md 12). */}
                        {row.is_anonymised_email && (
                          <Badge variant="inactive">Relay</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.city ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.postcode ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.order_count}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || busy}
              onClick={() => runSearch(page - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasMore || busy}
              onClick={() => runSearch(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={selectedId == null || busy}
        >
          {isPicking ? "Saving..." : confirmLabel}
        </Button>
      </DialogFooter>

      <CustomerFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </>
  )
}

function Field({
  id,
  label,
  placeholder,
  className,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  placeholder: string
  className: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        className={className}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
