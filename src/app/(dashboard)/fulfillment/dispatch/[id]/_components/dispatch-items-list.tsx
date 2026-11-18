"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MapPin, Wrench } from "lucide-react"

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
 * The items to take off the shelves, one card per order_items row -- cards
 * rather than a table so every target is thumb-sized on a tablet.
 *
 * A shortage is fixed in place: the menu opens the same StockMovementDialog
 * /inventory uses (CLAUDE.md rule 5), and a refresh brings the new balance in.
 * Dispatching never adjusts stock to make itself fit -- the count is a separate,
 * deliberate entry in the ledger.
 */
export function DispatchItemsList({
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
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground">
        This order has no items, so no stock will be taken out.
      </p>
    )
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const slots = item.product_id !== null ? (stock[item.product_id] ?? []) : []
          const chosen = picks.get(item.id) ?? null
          const available = slots.find((slot) => slot.location_id === chosen)?.qty ?? null
          const short = isShort(item.product_id, chosen)
          const unresolved = item.product_id === null
          const attention = unresolved || short || chosen === null

          return (
            <li
              key={item.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-card p-4",
                attention ? "border-warning/60 bg-warning/10" : "border-border"
              )}
            >
              <div className="flex items-start gap-4">
                <ProductThumb
                  src={item.image_url}
                  alt={item.product_name ?? item.sku}
                  className="size-16 rounded-lg"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-base font-semibold text-foreground">{item.sku ?? "—"}</span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">
                    {item.product_name ?? item.item_title ?? ""}
                  </span>
                  {unresolved ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">Unresolved SKU</Badge>
                      <Link
                        href={`/orders/${orderId}`}
                        className="text-sm font-medium text-foreground underline underline-offset-4"
                      >
                        Fix on the order page
                      </Link>
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-xs text-muted-foreground">Qty</span>
                  <span className="text-3xl leading-none font-semibold tabular-nums text-foreground">
                    {item.quantity}
                  </span>
                </div>
              </div>

              {unresolved ? null : (
                <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
                  <MapPin className="size-5 shrink-0 text-muted-foreground" />
                  {slots.length === 0 ? (
                    <span className="text-base font-medium text-warning-foreground">No stock recorded</span>
                  ) : needsLocationChoice(slots, chosen) ? (
                    <Select
                      value={chosen === null ? "" : String(chosen)}
                      onValueChange={(value) => onPick(item.id, Number(value))}
                    >
                      <SelectTrigger className="h-12! min-w-48 text-base">
                        <SelectValue placeholder="Choose a location" />
                      </SelectTrigger>
                      <SelectContent>
                        {slots.map((slot) => (
                          <SelectItem
                            key={slot.location_id}
                            value={String(slot.location_id)}
                            className="py-3 text-base"
                          >
                            {slot.location_name} — {slot.qty}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-mono text-xl font-semibold text-foreground">
                      {slots[0].location_name}
                    </span>
                  )}

                  <span
                    className={cn(
                      "text-sm text-muted-foreground",
                      short && "font-medium text-destructive"
                    )}
                  >
                    In stock <span className="tabular-nums">{available ?? "—"}</span>
                  </span>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant={short || chosen === null ? "outline" : "ghost"}
                        className="ml-auto h-12 gap-2 px-4 text-base"
                      >
                        <Wrench className="size-5" />
                        Fix stock
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {FIX_ACTIONS.map(({ action, label }) => (
                        <DropdownMenuItem
                          key={action}
                          className="py-3 text-base"
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
                </div>
              )}
            </li>
          )
        })}
      </ul>

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
