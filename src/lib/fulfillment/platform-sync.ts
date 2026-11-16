import type { SupabaseClient } from "@supabase/supabase-js"

import { loadEbayAccount, type EbayAccount } from "@/lib/ebay/client"
import { pushEbayFulfillment } from "@/lib/ebay/fulfillment"
import { CARRIER_LABELS, resolveShipment, type Shipment } from "@/lib/fulfillment/platform-carriers"
import type { PushOutcome } from "@/lib/fulfillment/platform-push"
import { pushShopifyFulfillment } from "@/lib/shopify/fulfillment"
import type { Database, Tables } from "@/lib/supabase/database.types"

// Works through one order's platform_fulfillment_syncs rows: tells Shopify or
// eBay the order has shipped, and records what happened. Run by the
// push-platform-fulfillment and sweep-platform-fulfillment tasks under the
// service role -- the outcome columns have no RLS policy for anyone else.
// docs/order-dispatch.md §5.

/** The sweep gives up on a failing row after this many tries; Retry on the order page still works. */
export const MAX_AUTO_ATTEMPTS = 3

type SyncRow = Tables<"platform_fulfillment_syncs">

export type SyncRowResult = {
  platform: SyncRow["platform"]
  platformOrderId: string
  status: SyncRow["status"]
  message: string
}

export type SyncOrderResult = {
  orderId: number
  /** Why nothing was attempted, when nothing was. */
  idle?: string
  rows: SyncRowResult[]
}

/**
 * Whether this run should push the row.
 *
 * Automatic runs push what is waiting, and retry a failure a few times. A
 * manual Retry also pushes a failure past that limit, a skipped row, and a row
 * that went through with a number the order no longer has (the tracking
 * number was changed after dispatch; user decision 3, 2026-11-16).
 */
export function shouldPush(row: Pick<SyncRow, "status" | "attempts" | "tracking_number">, shipment: Shipment | null, manual: boolean): boolean {
  switch (row.status) {
    case "pending":
      return true
    case "failed":
      return manual || row.attempts < MAX_AUTO_ATTEMPTS
    case "skipped":
      return manual
    case "succeeded":
      return (
        manual &&
        shipment !== null &&
        shipment.tracked &&
        (row.tracking_number ?? "").toUpperCase() !== shipment.trackingNumber.toUpperCase()
      )
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text
}

export async function syncOrderFulfillments(
  supabase: SupabaseClient<Database>,
  orderId: number,
  { manual = false, userId = null }: { manual?: boolean; userId?: string | null } = {}
): Promise<SyncOrderResult> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, invoice_number, status, shipping_method, tracking_number, posted_on_date")
    .eq("id", orderId)
    .maybeSingle()
  if (orderError) throw new Error(`Reading order ${orderId} failed: ${orderError.message}`)
  if (!order) return { orderId, idle: "Order not found", rows: [] }

  // Sent back from completed (e.g. to correct it and dispatch again): the rows
  // wait for the next dispatch rather than tell the platform it shipped.
  if (order.status !== "completed") {
    return { orderId, idle: `Order is ${order.status}, not completed`, rows: [] }
  }

  const { data: rows, error: rowsError } = await supabase
    .from("platform_fulfillment_syncs")
    .select("*")
    .eq("order_id", orderId)
    .order("id")
  if (rowsError) throw new Error(`Reading platform syncs for order ${orderId} failed: ${rowsError.message}`)
  if (!rows || rows.length === 0) return { orderId, idle: "No platform orders to update", rows: [] }

  // Resolved once for the whole order: every platform order behind it went in
  // the same parcel. A shipment that cannot be resolved fails every row with
  // the same reason.
  let shipment: Shipment | null = null
  let shipmentError: string | null = null
  try {
    shipment = resolveShipment(order)
  } catch (error) {
    shipmentError = errorMessage(error)
  }

  const shippedAt = order.posted_on_date ? new Date(order.posted_on_date) : new Date()
  let ebayAccount: EbayAccount | null = null
  const results: SyncRowResult[] = []

  // One at a time: two pushes to the same platform order would race each
  // other's "already there?" check.
  for (const row of rows) {
    if (!shouldPush(row, shipment, manual)) continue

    let outcome: PushOutcome | null = null
    let failure: string | null = shipmentError
    if (shipment !== null) {
      try {
        if (row.platform === "shopify") {
          outcome = await pushShopifyFulfillment(row.platform_order_id, shipment, row.platform_fulfillment_id)
        } else {
          ebayAccount ??= await loadEbayAccount(supabase)
          outcome = await pushEbayFulfillment(ebayAccount, row.platform_order_id, shipment, shippedAt)
        }
      } catch (error) {
        failure = errorMessage(error)
      }
    }

    const status: SyncRow["status"] =
      outcome === null ? "failed" : outcome.result === "skipped" ? "skipped" : "succeeded"
    const message = outcome?.message ?? `${platformLabel(row.platform)} order ${row.platform_order_id} not updated: ${failure}`

    const update: Database["public"]["Tables"]["platform_fulfillment_syncs"]["Update"] =
      outcome === null
        ? { status, attempts: row.attempts + 1, last_error: failure }
        : {
            status,
            attempts: row.attempts + 1,
            last_error: status === "skipped" ? outcome.message : null,
            tracking_number: shipment?.tracked && outcome.result !== "skipped" ? shipment.trackingNumber : row.tracking_number,
            carrier: shipment?.tracked ? CARRIER_LABELS[shipment.carrier] : null,
            platform_fulfillment_id: outcome.fulfillmentId ?? row.platform_fulfillment_id,
            synced_at: new Date().toISOString(),
          }

    const { data: written, error: writeError } = await supabase
      .from("platform_fulfillment_syncs")
      .update(update)
      .eq("id", row.id)
      .select("id")
    if (writeError || !written || written.length !== 1) {
      // The platform may already hold the change; the next run's read-first
      // check finds it, so this is loud but not dangerous.
      throw new Error(
        `${message} -- but recording it failed: ${writeError?.message ?? "row not updated"}`
      )
    }

    const { error: logError } = await supabase
      .from("order_logs")
      .insert({ order_id: orderId, action: message, user_id: userId })
    if (logError) {
      // The sync row is the record that matters, and it is written.
      console.warn(`order_logs write failed for order ${orderId}: ${logError.message}`)
    }

    results.push({ platform: row.platform, platformOrderId: row.platform_order_id, status, message })
  }

  return results.length === 0 ? { orderId, idle: "Nothing to push", rows: [] } : { orderId, rows: results }
}

function platformLabel(platform: SyncRow["platform"]): string {
  return platform === "shopify" ? "Shopify" : "eBay"
}

/**
 * Orders the sweep should look at: something pending (and not just created --
 * the dispatch's own trigger is probably running it), or failed with tries
 * left and not tried in the last few minutes.
 */
export async function findOrdersToSweep(
  supabase: SupabaseClient<Database>,
  limit = 50
): Promise<number[]> {
  const settle = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("platform_fulfillment_syncs")
    .select("order_id, orders!inner(status)")
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_AUTO_ATTEMPTS})`)
    .lt("updated_at", settle)
    .eq("orders.status", "completed")
    .order("updated_at")
    .limit(limit)
  if (error) throw new Error(`Finding platform syncs to retry failed: ${error.message}`)
  return [...new Set((data ?? []).map((row) => row.order_id))]
}
