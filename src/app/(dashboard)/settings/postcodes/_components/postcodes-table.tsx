"use client"

import * as React from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { PostcodeRow } from "@/lib/queries/postcodes"
import { deletePostcode } from "@/lib/actions/postcode"
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
import { PostcodeFormDialog } from "./postcode-form-dialog"

const COLUMN_COUNT = 4

export function PostcodesTable({ rows }: { rows: PostcodeRow[] }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState<PostcodeRow | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  async function handleDelete(row: PostcodeRow) {
    const ok = await confirm({
      title: "Delete postcode",
      // No foreign key blocks this, so the dialog carries the consequence the
      // database will not: customers in this locality stop being standardised,
      // silently.
      description: `Delete ${row.postcode} ${row.locality}? Customer addresses in this locality will no longer have their state filled in automatically.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deletePostcode(row.id)
      if (result.success) toast.success("Postcode deleted")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Postcode</TableHead>
              <TableHead>Locality</TableHead>
              <TableHead className="w-24">State</TableHead>
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
                  No postcodes found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium tabular-nums">
                    {row.postcode}
                  </TableCell>
                  <TableCell>{row.locality}</TableCell>
                  <TableCell>
                    {row.state ?? (
                      // Not missing data: Australia Post lists these alias
                      // localities without a state.
                      <Badge variant="inactive">None</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${row.postcode} ${row.locality}`}
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

      <PostcodeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        postcode={editing}
      />
    </>
  )
}
