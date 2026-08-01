"use client"

import * as React from "react"
import Link from "next/link"
import { Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { LocationListRow } from "@/lib/queries/locations"
import { deleteLocation } from "@/lib/actions/location"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { LocationFormDialog } from "./location-form-dialog"

export function LocationsTable({
  locations,
}: {
  locations: LocationListRow[]
}) {
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<LocationListRow | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return locations
    return locations.filter((location) => location.name.toLowerCase().includes(q))
  }, [locations, query])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(location: LocationListRow) {
    setEditing(location)
    setDialogOpen(true)
  }

  async function handleDelete(location: LocationListRow) {
    // The foreign key is RESTRICT, so a location with any stock row cannot be
    // deleted — even rows sitting at zero, which still record that a product
    // belongs here. Saying so up front beats letting the server reject it.
    if (location.product_count > 0) {
      toast.error(
        `${location.name} still holds ${location.product_count} product${
          location.product_count === 1 ? "" : "s"
        }. Move or clear its stock first.`
      )
      return
    }

    const ok = await confirm({
      title: "Delete location",
      description: `Are you sure you want to delete "${location.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteLocation(location.id)
      if (result.success) {
        toast.success("Location deleted")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Locations</h1>
          <p className="text-sm text-muted-foreground">
            Manage warehouse storage locations.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Location
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="h-24 text-center text-muted-foreground"
                >
                  {locations.length === 0
                    ? "No locations yet."
                    : "No matches found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((location) => (
                <TableRow key={location.id}>
                  <TableCell className="font-medium">{location.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {location.product_count === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <Link
                        href={`/inventory?locationId=${location.id}`}
                        className="hover:underline"
                      >
                        {location.product_count}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(location)}
                        aria-label="Edit"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(location)}
                        disabled={isPending}
                        aria-label="Delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LocationFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        location={editing}
      />
    </div>
  )
}
