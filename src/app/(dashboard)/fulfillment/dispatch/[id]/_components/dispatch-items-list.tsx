"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Wrench } from "lucide-react"

import { StockMovementDialog, type StockAction } from "@/components/inventory/stock-movement-dialog"
import { ProductThumb } from "@/components/products/product-thumb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { needsLocationChoice, type PickChoice, type Shortage } from "@/lib/fulfillment/dispatch"
import type { DispatchItem } from "@/lib/queries/dispatch"
import type { ProductStockLine } from "@/lib/queries/inventory"
import type { LocationOption } from "@/lib/queries/locations"
import { cn } from "@/lib/utils"

type FixTarget = { action: StockAction; productId: number; locationId: number | null }

const FIX_ACTIONS: { action: StockAction; label: string }[] = [
  { action: "adjust", label: "Count stock" },
  { action: "move", label: "Move stock" },
  { action: "receive", label: "Receive stock" },
]

/**
 * The items to take off the shelves, one row per order_items row.
 *
 * A shortage is fixed in place: the menu opens the same StockMovementDialog
 * /inventory uses (CLAUDE.md rule 5), and a refresh brings the new balance in.
 * Dispatching never adjusts stock to make itself fit -- the count is a separate,
 * deliberate entry in the ledger.
 */
export function DispatchItemsTable({
  orderId,
  items,
  stock,
  picks,
  shortages,
  locations,
  onPick,
}: {
  orderId: number
  items: DispatchItem[]
  stock: Record<number, ProductStockLine[]>
  picks: PickChoice
  shortages: Shortage[]
  locations: LocationOption[]
  onPick: (itemId: number, locationId: number) => void
}) {
  const router = useRouter()
  const [fix, setFix] = React.useState<FixTarget | null>(null)

  const isShort = (productId: number | null, locationId: number | null | undefined) =>
    productId !== null &&
    shortages.some((s) => s.product_id === productId && s.location_id === locationId)

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        This order has no items, so no stock will be taken out.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const slots = item.product_id !== null ? (stock[item.product_id] ?? []) : []
              const chosen = picks.get(item.id) ?? null
              const available = slots.find((slot) => slot.location_id === chosen)?.qty ?? null
              const short = isShort(item.product_id, chosen)
              const unresolved = item.product_id === null

              return (
                <TableRow
                  key={item.id}
                  className={cn((unresolved || short || chosen === null) && "bg-warning/10")}
                >
                  <TableCell>
                    <ProductThumb src={item.image_url} alt={item.product_name ?? item.sku} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-sm font-medium">{item.sku ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.product_name ?? item.item_title ?? ""}
                      </span>
                      {unresolved ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="warning">Unresolved SKU</Badge>
                          <Link
                            href={`/orders/${orderId}`}
                            className="text-xs font-medium text-foreground underline underline-offset-4"
                          >
                            Fix on the order page
                          </Link>
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-base font-semibold tabular-nums">
                    {item.quantity}
                  </TableCell>
                  <TableCell>
                    {unresolved ? (
                      "—"
                    ) : slots.length === 0 ? (
                      <span className="text-sm text-warning-foreground">No stock recorded</span>
                    ) : needsLocationChoice(slots, chosen) ? (
                      <Select
                        value={chosen === null ? "" : String(chosen)}
                        onValueChange={(value) => onPick(item.id, Number(value))}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {slots.map((slot) => (
                            <SelectItem key={slot.location_id} value={String(slot.location_id)}>
                              {slot.location_name} — {slot.qty}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-mono text-sm font-medium">{slots[0].location_name}</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      short && "font-medium text-destructive"
                    )}
                  >
                    {available ?? "—"}
                  </TableCell>
                  <TableCell>
                    {unresolved ? null : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant={short || chosen === null ? "outline" : "ghost"}
                            size="icon"
                            aria-label="Fix stock"
                          >
                            <Wrench className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {FIX_ACTIONS.map(({ action, label }) => (
                            <DropdownMenuItem
                              key={action}
                              onSelect={() =>
                                setFix({
                                  action,
                                  productId: item.product_id as number,
                                  locationId: chosen,
                                })
                              }
                            >
                              {label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {fix ? (
        <StockMovementDialog
          open
          onOpenChange={(open) => {
            if (!open) setFix(null)
          }}
          action={fix.action}
          productId={fix.productId}
          locations={locations}
          lines={stock[fix.productId] ?? []}
          // The preset is the dialog's first location -- for a move that is the
          // source, which is not the chosen shelf, so it is left to choose.
          presetLocationId={fix.action === "move" ? null : fix.locationId}
          onSuccess={() => router.refresh()}
        />
      ) : null}
    </>
  )
}
