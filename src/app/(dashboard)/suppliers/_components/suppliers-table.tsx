"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { Tables } from "@/lib/supabase/database.types"
import { deleteSupplier } from "@/lib/actions/supplier"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SupplierFormDialog } from "./supplier-form-dialog"

type Supplier = Tables<"suppliers">

export function SuppliersTable({
  suppliers,
  page,
  pageCount,
  total,
  query,
}: {
  suppliers: Supplier[]
  page: number
  pageCount: number
  total: number
  query: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Supplier | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [search, setSearch] = React.useState(query)

  // Build a URL for the current pathname with the given page / query params.
  const buildUrl = React.useCallback(
    (nextPage: number, nextQuery: string) => {
      const params = new URLSearchParams()
      if (nextQuery) params.set("q", nextQuery)
      if (nextPage > 1) params.set("page", String(nextPage))
      const qs = params.toString()
      return qs ? `${pathname}?${qs}` : pathname
    },
    [pathname]
  )

  // Debounce free-text search: reset to page 1 whenever the term changes.
  React.useEffect(() => {
    if (search === query) return
    const timer = setTimeout(() => {
      router.push(buildUrl(1, search.trim()))
    }, 350)
    return () => clearTimeout(timer)
  }, [search, query, router, buildUrl])

  function goToPage(nextPage: number) {
    router.push(buildUrl(nextPage, query))
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier)
    setDialogOpen(true)
  }

  async function handleDelete(supplier: Supplier) {
    const ok = await confirm({
      title: "Delete supplier",
      description: `Are you sure you want to delete "${supplier.company_name ?? "this supplier"}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteSupplier(supplier.id)
      if (result.success) {
        toast.success("Supplier deleted")
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Suppliers</h1>
          <p className="text-sm text-muted-foreground">
            Manage product suppliers.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Supplier
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search company, contact, email or phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  {query ? "No matches found." : "No suppliers yet."}
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">
                    {supplier.company_name}
                  </TableCell>
                  <TableCell>{supplier.contact_person ?? "—"}</TableCell>
                  <TableCell>{supplier.email ?? "—"}</TableCell>
                  <TableCell>{supplier.phone ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(supplier)}
                        aria-label="Edit"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(supplier)}
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

      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount} · {total} total
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  aria-disabled={page <= 1}
                  className={
                    page <= 1 ? "pointer-events-none opacity-50" : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault()
                    if (page > 1) goToPage(page - 1)
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink isActive aria-current="page">
                  {page}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  aria-disabled={page >= pageCount}
                  className={
                    page >= pageCount
                      ? "pointer-events-none opacity-50"
                      : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault()
                    if (page < pageCount) goToPage(page + 1)
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <SupplierFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        supplier={editing}
      />
    </div>
  )
}
