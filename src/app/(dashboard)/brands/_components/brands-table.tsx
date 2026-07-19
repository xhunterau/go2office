"use client"

import * as React from "react"
import { Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { Tables } from "@/lib/supabase/database.types"
import { deleteBrand } from "@/lib/actions/brand"
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
import { BrandFormDialog } from "./brand-form-dialog"

type Brand = Tables<"brands">

export function BrandsTable({ brands }: { brands: Brand[] }) {
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Brand | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return brands
    return brands.filter(
      (brand) =>
        brand.name?.toLowerCase().includes(q) ||
        brand.abbr?.toLowerCase().includes(q)
    )
  }, [brands, query])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(brand: Brand) {
    setEditing(brand)
    setDialogOpen(true)
  }

  async function handleDelete(brand: Brand) {
    const ok = await confirm({
      title: "Delete brand",
      description: `Are you sure you want to delete "${brand.name ?? "this brand"}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteBrand(brand.id)
      if (result.success) {
        toast.success("Brand deleted")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Brands</h1>
          <p className="text-sm text-muted-foreground">
            Manage product brands.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Brand
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or abbreviation"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Abbreviation</TableHead>
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
                  {brands.length === 0 ? "No brands yet." : "No matches found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell className="font-medium">{brand.name}</TableCell>
                  <TableCell>{brand.abbr ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(brand)}
                        aria-label="Edit"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(brand)}
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

      <BrandFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brand={editing}
      />
    </div>
  )
}
