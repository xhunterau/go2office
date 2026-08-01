import { createClient } from "@/lib/supabase/server"
import {
  countZeroStockLevels,
  fetchInventoryList,
  INVENTORY_PAGE_SIZE,
  parseInventoryFilters,
} from "@/lib/queries/inventory"
import { fetchLocationOptions } from "@/lib/queries/locations"
import { InventoryFilters } from "./_components/inventory-filters"
import { InventoryPagination } from "./_components/inventory-pagination"
import { InventoryTable } from "./_components/inventory-table"
import { PurgeZeroStockButton } from "./_components/purge-zero-stock-button"

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseInventoryFilters(params)

  const supabase = await createClient()

  const [list, locations, zeroRows] = await Promise.all([
    fetchInventoryList(supabase, filters),
    fetchLocationOptions(supabase),
    countZeroStockLevels(supabase),
  ])

  const loadError = list.error ?? locations.error

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Products holding stock. Open one to receive, dispatch or count it —
            or set Stock to All to include products at zero.
          </p>
        </div>
        {/* A failed count only costs the button its number, so it is not folded
            into loadError — the list itself is still perfectly renderable. */}
        <PurgeZeroStockButton count={zeroRows.count} />
      </div>

      <InventoryFilters locations={locations.options} />

      {loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load inventory: {loadError}
        </div>
      ) : (
        <>
          <InventoryTable
            rows={list.rows}
            hidingZeroStock={filters.status === "in_stock"}
          />
          <InventoryPagination
            page={filters.page}
            pageSize={INVENTORY_PAGE_SIZE}
            total={list.count}
          />
        </>
      )}
    </div>
  )
}
