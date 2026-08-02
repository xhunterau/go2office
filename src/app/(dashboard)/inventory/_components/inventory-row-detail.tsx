"use client"

import type {
  MovementPruneRow,
  MovementRow,
  ProductStockLine,
} from "@/lib/queries/inventory"
import { MovementsHistorySection } from "@/components/inventory/movements-history-section"
import { StockLinesTable } from "@/components/inventory/stock-lines-table"

// The panel revealed under an expanded row: where the units sit, and every
// change that put them there. Mirrors the product detail Stock tab, minus the
// header — the row above it already names the product.
export function InventoryRowDetail({
  productId,
  lines,
  movements,
  prunes,
  loading,
  error,
  onCount,
  onPruned,
}: {
  productId: number
  lines: ProductStockLine[]
  // Undefined until the ledger has been fetched for this product.
  movements: MovementRow[] | undefined
  prunes: MovementPruneRow[] | undefined
  loading: boolean
  error: string | null
  onCount: (locationId: number) => void
  onPruned: () => void
}) {
  return (
    <div className="space-y-4 py-2">
      {lines.length > 0 ? (
        <StockLinesTable lines={lines} onCount={onCount} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No stock recorded in any location. Use Receive to record units
          arriving.
        </p>
      )}

      <MovementsHistorySection
        productId={productId}
        movements={movements}
        prunes={prunes}
        loading={loading}
        error={error}
        onPruned={onPruned}
      />
    </div>
  )
}
