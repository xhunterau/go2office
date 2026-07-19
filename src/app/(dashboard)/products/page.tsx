import { createClient } from "@/lib/supabase/server"
import {
  fetchProductList,
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

  const [list, brandsResult, suppliersResult, originsResult] = await Promise.all([
    fetchProductList(supabase, filters),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("suppliers").select("id, company_name").order("company_name"),
    supabase.from("origins").select("id, name").order("name"),
  ])

  const loadError =
    list.error ??
    brandsResult.error?.message ??
    suppliersResult.error?.message ??
    originsResult.error?.message

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
          brands={brandsResult.data ?? []}
          origins={originsResult.data ?? []}
          suppliers={suppliersResult.data ?? []}
        />
      </div>

      <ProductsFilters
        brands={brandsResult.data ?? []}
        suppliers={suppliersResult.data ?? []}
      />

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
