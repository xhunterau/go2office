"use client"

import { ClipboardCheck } from "lucide-react"

import type { ProductStockLine } from "@/lib/queries/inventory"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function totalOnHand(lines: ProductStockLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0)
}

// A product's holdings per location, with a stocktake entry point on each row.
// Shared by the product detail Stock tab and the expanded row on the stock
// overview list so both read the same and stay in step.
export function StockLinesTable({
  lines,
  onCount,
}: {
  lines: ProductStockLine[]
  onCount: (locationId: number) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-medium">
                {line.location_name}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {line.qty === 0 ? (
                  <span className="text-muted-foreground">0</span>
                ) : (
                  line.qty
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCount(line.location_id)}
                >
                  <ClipboardCheck />
                  Count
                </Button>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell className="font-medium">Total</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {totalOnHand(lines)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
