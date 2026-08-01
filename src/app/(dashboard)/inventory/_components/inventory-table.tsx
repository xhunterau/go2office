"use client"

import Link from "next/link"
import { ImageOff } from "lucide-react"

import type { InventoryListRow } from "@/lib/queries/inventory"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function InventoryTable({
  rows,
  hidingZeroStock,
}: {
  rows: InventoryListRow[]
  // The default view hides products at zero, so an empty table has to say that
  // — otherwise a SKU that exists but holds nothing reads as "no such product".
  hidingZeroStock: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Image</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">On Hand</TableHead>
            <TableHead>Locations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="h-24 text-center text-muted-foreground"
              >
                {hidingZeroStock
                  ? "No products in stock. Set Stock to All to include products at zero."
                  : "No products found."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.image_url}
                      alt={row.name ?? row.sku}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="size-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/products/${row.id}?tab=stock`}
                      className="hover:underline"
                    >
                      {row.sku}
                    </Link>
                    {!row.is_active && (
                      <Badge variant="inactive">Inactive</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{row.name ?? "—"}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    // Zero is an ordinary state here (696 rows carry it), so it
                    // is dimmed rather than flagged — colouring it red would
                    // turn a third of the table into a warning.
                    row.on_hand === 0 && "text-muted-foreground"
                  )}
                >
                  {row.on_hand}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.location_names ?? "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
