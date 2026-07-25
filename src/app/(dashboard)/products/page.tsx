import { createClient } from "@/lib/supabase/server"
import {
  fetchProductList,
  fetchProductLookupOptions,
  parseProductFilters,
  PRODUCTS_PAGE_SIZE,
} from "@/lib/queries/products"
import { AddProductButton } from "./_components/add-product-button"
import { ProductsFilters } from "./_components/products-filters"
import { ProductsPagination } from "./_components/products-pagination"
import { ProductsTable } from "./_components/products-table"

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseProductFilters(params)

  const supabase = await createClient()

  const [list, lookups] = await Promise.all([
    fetchProductList(supabase, filters),
    fetchProductLookupOptions(supabase),
  ])

  const loadError = list.error ?? lookups.error

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog.
          </p>
        </div>
        <AddProductButton
          brands={lookups.brands}
          origins={lookups.origins}
          suppliers={lookups.suppliers}
        />
      </div>

      <ProductsFilters brands={lookups.brands} suppliers={lookups.suppliers} />

      {loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load products: {loadError}
        </div>
      ) : (
        <>
          <ProductsTable products={list.rows} />
          <ProductsPagination
            page={filters.page}
            pageSize={PRODUCTS_PAGE_SIZE}
            total={list.count}
          />
        </>
      )}
    </div>
  )
}
