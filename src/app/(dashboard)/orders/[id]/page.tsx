import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  fetchOrderDetail,
  fetchOrderTransactionsWithItems,
} from "@/lib/queries/orders"
import { fetchLatestShippingQuotes } from "@/lib/queries/shipping-quotes"
import { OrderDetailHeader } from "./_components/order-detail-header"
import { OrderSummaryCards } from "./_components/order-summary-cards"
import { OrderTransactionsTable } from "./_components/order-transactions-table"
import { ShippingQuotesPanel } from "./_components/shipping-quotes-panel"

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) notFound()

  const supabase = await createClient()

  // Both levels up front rather than lazily on expand: the median order has a
  // handful of picked lines (250687 items over 203315 orders), so a second
  // round trip per expansion would cost more than fetching them all
  // (docs/orders-ui.md 6.1).
  const [detail, lines, quotes] = await Promise.all([
    fetchOrderDetail(supabase, orderId),
    fetchOrderTransactionsWithItems(supabase, orderId),
    fetchLatestShippingQuotes(supabase, orderId),
  ])

  if (detail.error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load order: {detail.error}
      </div>
    )
  }

  if (!detail.order) notFound()

  return (
    <div className="flex flex-1 flex-col gap-6">
      <OrderDetailHeader order={detail.order} />

      <OrderSummaryCards order={detail.order} />

      {lines.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load order lines: {lines.error}
        </div>
      ) : (
        <OrderTransactionsTable
          orderId={detail.order.id}
          transactions={lines.transactions}
        />
      )}

      {/* A quote failure is not a reason to hide the panel: the button that
          fixes it lives inside. The batch just comes back empty. */}
      <ShippingQuotesPanel
        orderId={detail.order.id}
        initialQuotes={quotes.quotes}
        initialQuotedAt={quotes.quotedAt}
        totalWeightKg={detail.order.metrics.total_weight_kg}
        chargeableWeightKg={detail.order.metrics.chargeable_weight_kg}
        hasEstimatedDimensions={detail.order.metrics.has_estimated_dimensions}
        unresolvedItemCount={detail.order.metrics.unresolved_item_count}
      />

      {detail.order.comments && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Comments</h2>
          <p className="whitespace-pre-wrap rounded-xl border border-border p-4 text-sm text-muted-foreground">
            {detail.order.comments}
          </p>
        </div>
      )}
    </div>
  )
}
