import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { fetchCustomerDetail } from "@/lib/queries/customers"
import {
  fetchOrderList,
  ORDERS_PAGE_SIZE,
  parseOrderFilters,
} from "@/lib/queries/orders"
import { EstimatedPagination } from "@/components/estimated-pagination"
import { OrdersTable } from "@/components/orders/orders-table"
import { CustomerDetailHeader } from "./_components/customer-detail-header"

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const customerId = Number(id)
  if (!Number.isInteger(customerId) || customerId <= 0) notFound()

  const supabase = await createClient()

  // The order history is the same query and the same table as /orders, scoped
  // to this customer -- one component, one filter parser (project rule 5).
  const filters = parseOrderFilters(query)

  const [detail, orders] = await Promise.all([
    fetchCustomerDetail(supabase, customerId),
    fetchOrderList(supabase, filters, customerId),
  ])

  if (detail.error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load customer: {detail.error}
      </div>
    )
  }

  if (!detail.customer) notFound()

  return (
    <div className="flex flex-1 flex-col gap-6">
      <CustomerDetailHeader customer={detail.customer} />

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Order history</h2>

        {orders.error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
            Failed to load orders: {orders.error}
          </div>
        ) : (
          <>
            <OrdersTable
              rows={orders.rows}
              showCustomer={false}
              emptyMessage="This customer has no orders."
            />
            <EstimatedPagination
              page={filters.page}
              pageSize={ORDERS_PAGE_SIZE}
              total={orders.count}
              isEstimate={orders.isEstimate}
              rowCount={orders.rows.length}
              noun="orders"
            />
          </>
        )}
      </div>
    </div>
  )
}
