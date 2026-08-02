"use client"

import * as React from "react"
import { ArrowLeftRight, Boxes, Minus, Plus } from "lucide-react"

import type { LocationOption } from "@/lib/queries/locations"
import type {
  MovementPruneRow,
  MovementRow,
  ProductStockLine,
} from "@/lib/queries/inventory"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MovementsHistorySection } from "@/components/inventory/movements-history-section"
import {
  StockLinesTable,
  totalOnHand,
} from "@/components/inventory/stock-lines-table"
import {
  StockMovementDialog,
  type StockAction,
} from "@/components/inventory/stock-movement-dialog"

export function ProductStockPanel({
  productId,
  isKit,
  lines,
  movements,
  prunes,
  locations,
  error,
}: {
  productId: number
  isKit: boolean
  lines: ProductStockLine[]
  movements: MovementRow[]
  prunes: MovementPruneRow[]
  locations: LocationOption[]
  error: string | null
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [action, setAction] = React.useState<StockAction>("receive")
  const [presetLocationId, setPresetLocationId] = React.useState<number | null>(
    null
  )

  function open(next: StockAction, locationId?: number) {
    setAction(next)
    setPresetLocationId(locationId ?? null)
    setDialogOpen(true)
  }

  // Kits are barred from holding stock at the database level, so there is
  // nothing to show or do here. Their sellable quantity comes from component
  // availability instead — a separate calculation, not yet built.
  if (isKit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Boxes className="size-5" />
            </div>
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                Kits do not hold their own stock
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                A kit is assembled from its components at pick time. Counting it
                separately would double count the same goods. Check the stock of
                each component on the Kit Components tab.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const total = totalOnHand(lines)
  const hasStock = lines.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stock</CardTitle>
        <CardDescription>
          {hasStock
            ? `${total} on hand across ${lines.length} location${lines.length === 1 ? "" : "s"}.`
            : "On-hand quantities per location."}
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => open("receive")}>
              <Plus />
              Receive
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => open("dispatch")}
              disabled={!hasStock}
            >
              <Minus />
              Dispatch
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => open("move")}
              disabled={!hasStock || locations.length < 2}
            >
              <ArrowLeftRight />
              Move
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load stock: {error}
          </div>
        ) : (
          <>
            {hasStock ? (
              <StockLinesTable
                lines={lines}
                onCount={(locationId) => open("adjust", locationId)}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Boxes className="size-5" />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium text-foreground">
                    No stock recorded
                  </p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    This product has no stock in any location yet. Use Receive to
                    record units arriving.
                  </p>
                </div>
              </div>
            )}

            <MovementsHistorySection
              productId={productId}
              movements={movements}
              prunes={prunes}
            />
          </>
        )}
      </CardContent>

      <StockMovementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={action}
        productId={productId}
        locations={locations}
        lines={lines}
        presetLocationId={presetLocationId}
      />
    </Card>
  )
}
