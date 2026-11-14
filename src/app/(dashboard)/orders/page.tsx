import { createClient } from "@/lib/supabase/server"
import { activeDebugValue } from "@/lib/queries/debug-settings"
import { fetchEbayAuthorization } from "@/lib/queries/ebay-authorization"
import {
  fetchOrderList,
  fetchOrderStatusCounts,
  ORDERS_PAGE_SIZE,
  parseOrderFilters,
} from "@/lib/queries/orders"
import { EstimatedPagination } from "@/components/estimated-pagination"
import { OrdersTable } from "@/components/orders/orders-table"
import { OrdersFilters } from "./_components/orders-filters"
import { OrdersStatusTabs } from "./_components/orders-status-tabs"
import { ShopifyImportButton } from "./_components/shopify-import-button"
import { EbayImportButton } from "@/app/(dashboard)/orders/_components/ebay-import-button"

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseOrderFilters(params)

  const supabase = await createClient()

  const [list, statusCounts, shopifyDebug, ebayDebug, ebayAuthorization] = await Promise.all([
    fetchOrderList(supabase, filters),
    fetchOrderStatusCounts(supabase),
    // Only the buttons' labels. The actions read them again when an import starts.
    activeDebugValue(supabase, "shopify_import_test_order"),
    activeDebugValue(supabase, "ebay_import_test_order"),
    fetchEbayAuthorization(supabase),
  ])

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Every order in the system. Pick a status tab for a work queue, or
            search by invoice, tracking, customer, suburb or SKU. Expand a row
            to see what was sold.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <EbayImportButton testOrder={ebayDebug.value} authorization={ebayAuthorization} />
          <ShopifyImportButton testOrder={shopifyDebug.value} />
        </div>
      </div>

      {/* A failed count costs the tabs their numbers, not their links, so it is
          not folded into the list error below. */}
      <OrdersStatusTabs counts={statusCounts.counts} />

      <OrdersFilters />

      {list.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load orders: {list.error}
        </div>
      ) : (
        <>
          <OrdersTable
            rows={list.rows}
            emptyMessage={
              // "No such SKU" and "this SKU has never sold" are different
              // answers and the second is the one that needs no explanation
              // (docs/orders-ui.md 5.3).
              list.unknownSku
                ? "No product matches this SKU."
                : "No orders found."
            }
          />
          <EstimatedPagination
            page={filters.page}
            pageSize={ORDERS_PAGE_SIZE}
            total={list.count}
            isEstimate={list.isEstimate}
            rowCount={list.rows.length}
            noun="orders"
          />
        </>
      )}
    </div>
  )
}
