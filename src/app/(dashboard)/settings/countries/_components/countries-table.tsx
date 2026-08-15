"use client"

import * as React from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { CountryRow } from "@/lib/queries/countries"
import { deleteCountry } from "@/lib/actions/country"
import { useConfirm } from "@/components/providers/confirm-provider"
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
import { CountryFormDialog } from "./country-form-dialog"

const COLUMN_COUNT = 3

export function CountriesTable({ rows }: { rows: CountryRow[] }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState<CountryRow | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  async function handleDelete(row: CountryRow) {
    const ok = await confirm({
      title: "Delete country",
      // No foreign key blocks this, so the dialog carries the consequence the
      // database will not: the spellings this row was collapsing start drifting
      // apart again, silently.
      description: `Delete ${row.country_name}? Customers already holding ${row.country_code} keep it, but new saves will store the country exactly as typed — so the spellings this row was collapsing will start to accumulate again.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteCountry(row.id)
      if (result.success) toast.success("Country deleted")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead className="w-24">Code</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  No countries found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.country_name}
                  </TableCell>
                  <TableCell className="font-mono">{row.country_code}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${row.country_name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(row)
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

      <CountryFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        country={editing}
      />
    </>
  )
}
