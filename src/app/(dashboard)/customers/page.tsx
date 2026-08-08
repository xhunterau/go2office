import { createClient } from "@/lib/supabase/server"
import {
  CUSTOMERS_PAGE_SIZE,
  fetchCustomerList,
  parseCustomerFilters,
} from "@/lib/queries/customers"
import { EstimatedPagination } from "@/components/estimated-pagination"
import { AddCustomerButton } from "./_components/add-customer-button"
import { CustomersFilters } from "./_components/customers-filters"
import { CustomersTable } from "./_components/customers-table"

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseCustomerFilters(params)

  const supabase = await createClient()
  const list = await fetchCustomerList(supabase, filters)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {/* Why this table exists at all: the legacy system inserted a buyer
                row per order, so "what has this person bought" was not a
                question it could answer (docs/orders-ui.md 7.2). */}
            One row per buyer, deduplicated across every order they have placed.
            Open a customer to see their order history.
          </p>
        </div>
        <AddCustomerButton />
      </div>

      <CustomersFilters />

      {list.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load customers: {list.error}
        </div>
      ) : (
        <>
          <CustomersTable rows={list.rows} />
          <EstimatedPagination
            page={filters.page}
            pageSize={CUSTOMERS_PAGE_SIZE}
            total={list.count}
            isEstimate={list.isEstimate}
            rowCount={list.rows.length}
            noun="customers"
          />
        </>
      )}
    </div>
  )
}
