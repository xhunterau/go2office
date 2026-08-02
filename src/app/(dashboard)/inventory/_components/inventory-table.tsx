"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  History,
  ImageOff,
  Minus,
  MoreHorizontal,
  Plus,
} from "lucide-react"

import type { InventoryListRow } from "@/lib/queries/inventory"
import type { LocationOption } from "@/lib/queries/locations"
import {
  loadProductHistory,
  type ProductHistory,
} from "@/lib/actions/inventory"
import type { StockAction } from "@/lib/validations/inventory"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
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
import { StockMovementDialog } from "@/components/inventory/stock-movement-dialog"
import { InventoryRowDetail } from "./inventory-row-detail"

// What the dialog is currently acting on. Kept after the dialog closes so the
// close animation still has something to render.
type DialogTarget = {
  productId: number
  action: StockAction
  locationId: number | null
}

const COLUMN_COUNT = 7

export function InventoryTable({
  rows,
  locations,
  hidingZeroStock,
}: {
  rows: InventoryListRow[]
  locations: LocationOption[]
  // The default view hides products at zero, so an empty table has to say that
  // — otherwise a SKU that exists but holds nothing reads as "no such product".
  hidingZeroStock: boolean
}) {
  // One row open at a time: two ledgers side by side push the rest of the table
  // off screen without helping anyone compare them.
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [history, setHistory] = React.useState<
    Record<number, ProductHistory>
  >({})
  const [loadingId, setLoadingId] = React.useState<number | null>(null)
  // Scoped to the expanded row, which is the only place it can be shown.
  const [historyError, setHistoryError] = React.useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [target, setTarget] = React.useState<DialogTarget | null>(null)

  const loadHistory = React.useCallback(async (productId: number) => {
    setLoadingId(productId)
    const result = await loadProductHistory(productId)
    setLoadingId((current) => (current === productId ? null : current))

    const loaded = result.data
    if (!result.success || !loaded) {
      setHistoryError(result.error ?? "Something went wrong")
      return
    }
    setHistory((current) => ({ ...current, [productId]: loaded }))
  }, [])

  function toggle(productId: number) {
    if (expandedId === productId) {
      setExpandedId(null)
      return
    }
    setExpandedId(productId)
    setHistoryError(null)
    // Already fetched once: the movement handler below drops the entry whenever
    // it stops being true, so a cache hit is safe to trust.
    if (!history[productId]) void loadHistory(productId)
  }

  function openDialog(
    productId: number,
    action: StockAction,
    locationId: number | null = null
  ) {
    setTarget({ productId, action, locationId })
    setDialogOpen(true)
  }

  // Server data comes back fresh through revalidatePath, but a ledger held in
  // client state does not, so the affected product is dropped from the cache and
  // refetched if it is on screen. Called after a movement and after a prune.
  function invalidateHistory(productId: number) {
    setHistory((current) => {
      const next = { ...current }
      delete next[productId]
      return next
    })
    if (expandedId === productId) {
      setHistoryError(null)
      void loadHistory(productId)
    }
  }

  const targetRow = target
    ? rows.find((row) => row.id === target.productId)
    : undefined

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="w-16">Image</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead>Locations</TableHead>
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
                  {hidingZeroStock
                    ? "No products in stock. Set Stock to All to include products at zero."
                    : "No products found."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const expanded = expandedId === row.id
                const hasStock = row.lines.length > 0

                return (
                  <React.Fragment key={row.id}>
                    <TableRow className={cn(expanded && "border-b-0")}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => toggle(row.id)}
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `Hide stock detail for ${row.sku}`
                              : `Show stock detail for ${row.sku}`
                          }
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
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
                          // Zero is an ordinary state here (696 rows carry it),
                          // so it is dimmed rather than flagged — colouring it
                          // red would turn a third of the table into a warning.
                          row.on_hand === 0 && "text-muted-foreground"
                        )}
                      >
                        {row.on_hand}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.location_names ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`Stock actions for ${row.sku}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => openDialog(row.id, "receive")}
                            >
                              <Plus />
                              Receive
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!hasStock}
                              onSelect={() => openDialog(row.id, "dispatch")}
                            >
                              <Minus />
                              Dispatch
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!hasStock || locations.length < 2}
                              onSelect={() => openDialog(row.id, "move")}
                            >
                              <ArrowLeftRight />
                              Move
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!hasStock}
                              onSelect={() => openDialog(row.id, "adjust")}
                            >
                              <ClipboardCheck />
                              Count
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => toggle(row.id)}>
                              <History />
                              {expanded ? "Hide history" : "View history"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30">
                          <InventoryRowDetail
                            productId={row.id}
                            lines={row.lines}
                            movements={history[row.id]?.movements}
                            prunes={history[row.id]?.prunes}
                            loading={loadingId === row.id}
                            error={historyError}
                            onCount={(locationId) =>
                              openDialog(row.id, "adjust", locationId)
                            }
                            onPruned={() => invalidateHistory(row.id)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {targetRow && target && (
        <StockMovementDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          action={target.action}
          productId={target.productId}
          locations={locations}
          lines={targetRow.lines}
          presetLocationId={target.locationId}
          onSuccess={() => invalidateHistory(target.productId)}
        />
      )}
    </>
  )
}
