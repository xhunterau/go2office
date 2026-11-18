import Link from "next/link"

import type { LowStockItem } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { ProductThumb } from "@/components/products/product-thumb"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const numberFormatter = new Intl.NumberFormat("en-AU")
const coverFormatter = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 })

export function LowStockTable({
  items,
  total,
  windowDays,
  coverDays,
}: {
  items: LowStockItem[]
  total: number
  windowDays: number
  coverDays: number
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Everything sold in the last {windowDays} days has at least {coverDays} days of stock.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Sold in the last {windowDays} days with under {coverDays} days of stock at that rate. Showing{" "}
        {items.length} of {numberFormatter.format(total)}, most urgent first.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Sold {windowDays}d</TableHead>
              <TableHead className="text-right">Days left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.productId}>
                <TableCell className="max-w-80">
                  <div className="flex items-center gap-3">
                    <ProductThumb src={item.imageUrl} alt={item.name ?? item.sku} />
                    <div className="min-w-0">
                      <Link
                        href={`/products/${item.productId}`}
                        className="block truncate font-medium text-foreground hover:underline"
                        title={item.name ?? item.sku}
                      >
                        {item.name ?? item.sku}
                      </Link>
                      <span className="font-mono text-xs text-muted-foreground">{item.sku}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{numberFormatter.format(item.onHand)}</TableCell>
                <TableCell className="text-right tabular-nums">{numberFormatter.format(item.soldQty)}</TableCell>
                <TableCell className="text-right">
                  {item.onHand <= 0 ? (
                    <Badge variant="destructive">Out of stock</Badge>
                  ) : (
                    <span className="tabular-nums">{coverFormatter.format(item.daysOfCover)}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
