import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { formatDateTime } from "@/lib/format"
import { ORDER_STATUS_LABELS } from "@/lib/orders/status"
import { DISPATCH_STATUS, fetchDispatchOrder } from "@/lib/queries/dispatch"
import { fetchLocationOptions } from "@/lib/queries/locations"
import { createClient } from "@/lib/supabase/server"

import { DispatchOrderClient } from "./_components/dispatch-order-client"

export default async function DispatchOrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) notFound()

  const supabase = await createClient()
  const [result, locations] = await Promise.all([
    fetchDispatchOrder(supabase, orderId),
    fetchLocationOptions(supabase),
  ])

  const back = (
    <Link
      href="/fulfillment/dispatch"
      className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Dispatch
    </Link>
  )

  if (result.error || locations.error) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {back}
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-foreground">The order could not be loaded.</p>
          <p className="mt-1 text-muted-foreground">{result.error ?? locations.error}</p>
        </div>
      </div>
    )
  }
  if (!result.data) notFound()

  const { order, items, stock } = result.data

  // Opened from history, a bookmark, or a second tab after it went out.
  if (order.status !== DISPATCH_STATUS) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {back}
        <h1 className="text-lg font-semibold text-foreground">Order {order.invoice_number}</h1>
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="font-medium text-foreground">
            This order is {ORDER_STATUS_LABELS[order.status]}, not waiting for dispatch.
          </p>
          <p className="mt-1 text-muted-foreground">
            {order.status === "completed" && order.posted_on_date
              ? `Dispatched ${formatDateTime(order.posted_on_date)}${order.tracking_number ? ` with tracking number ${order.tracking_number}` : ""}. `
              : "Only Labelled orders can be dispatched. "}
            <Link
              href={`/orders/${order.id}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Open the order
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {back}
      <DispatchOrderClient
        order={order}
        items={items}
        stock={stock}
        locations={locations.options}
      />
    </div>
  )
}
