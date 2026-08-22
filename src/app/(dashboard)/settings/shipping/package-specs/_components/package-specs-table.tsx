"use client"

import * as React from "react"
import { AlertTriangle, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type {
  PackageSpecCoverage,
  PackageSpecRow,
} from "@/lib/queries/shipping-reference"
import { deletePackageSpec } from "@/lib/actions/package-spec"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PackageSpecFormDialog } from "./package-spec-form-dialog"

const COLUMN_COUNT = 6

export function PackageSpecsTable({
  rows,
  coverage,
  packageType,
}: {
  rows: PackageSpecRow[]
  coverage: [number, PackageSpecCoverage][]
  packageType: "satchel" | "box"
}) {
  const confirm = useConfirm()
  const coverageById = React.useMemo(() => new Map(coverage), [coverage])
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState<PackageSpecRow | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  async function handleDelete(row: PackageSpecRow) {
    const ok = await confirm({
      title: "Delete package spec",
      // No foreign key blocks this, and nothing errors afterwards: the adapter
      // simply reports "No spec for box M" on that quote row.
      description: `Delete the ${row.package_type} ${row.size_label} spec? Every shipping method that uses this size stops being priced — the quote list will show it as unavailable rather than raising an error.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deletePackageSpec(row.id)
      if (result.success) toast.success("Package spec deleted")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Size</TableHead>
              <TableHead className="text-right">Length</TableHead>
              <TableHead className="text-right">Width</TableHead>
              <TableHead className="text-right">Depth</TableHead>
              <TableHead className="text-right">Billed as</TableHead>
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
                  No {packageType} specs.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const stats = coverageById.get(row.id)
                // An active option pointing at this size that finds no weight
                // tier at its billed weight. Silent otherwise: the quote just
                // comes back unpriced.
                const unpriced = stats
                  ? stats.optionCount - stats.pricedCount
                  : 0

                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.size_label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.length_mm} mm
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.width_mm} mm
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.depth_mm === null ? "—" : `${row.depth_mm} mm`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {unpriced > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="size-3.5 text-warning-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-72">
                              {unpriced} shipping method
                              {unpriced === 1 ? "" : "s"} using this size has no
                              rate card tier at {row.maps_to_weight_kg} kg, so it
                              cannot be priced. The tier weight has to match this
                              number exactly.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {row.maps_to_weight_kg} kg
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${row.package_type} ${row.size_label}`}
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
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PackageSpecFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        spec={editing}
      />
    </>
  )
}
