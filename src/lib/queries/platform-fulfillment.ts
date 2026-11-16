import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Tables } from "@/lib/supabase/database.types"

type Client = SupabaseClient<Database>

export type PlatformSync = Pick<
  Tables<"platform_fulfillment_syncs">,
  | "id"
  | "platform"
  | "platform_order_id"
  | "status"
  | "tracking_number"
  | "carrier"
  | "attempts"
  | "last_error"
  | "synced_at"
  | "updated_at"
>

const SYNC_COLUMNS =
  "id, platform, platform_order_id, status, tracking_number, carrier, attempts, last_error, synced_at, updated_at"

/** The write-back rows behind one order, for the order page. */
export async function fetchPlatformSyncs(
  supabase: Client,
  orderId: number
): Promise<{ syncs: PlatformSync[]; error: string | null }> {
  const { data, error } = await supabase
    .from("platform_fulfillment_syncs")
    .select(SYNC_COLUMNS)
    .eq("order_id", orderId)
    .order("id")
  if (error) return { syncs: [], error: error.message }
  return { syncs: data ?? [], error: null }
}

export type FailedSyncOrder = { order_id: number; invoice_number: string; last_error: string | null }

/**
 * Orders with a failed write-back, for the dispatch page -- without it a
 * failure is a row nobody opens. Every failure is listed, including those the
 * sweep has given up on: those are the ones that need a person.
 */
export async function fetchFailedSyncOrders(
  supabase: Client,
  limit = 20
): Promise<{ orders: FailedSyncOrder[]; total: number; error: string | null }> {
  const { data, count, error } = await supabase
    .from("platform_fulfillment_syncs")
    .select("order_id, last_error, orders!inner(invoice_number)", { count: "exact" })
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(limit)
  if (error) return { orders: [], total: 0, error: error.message }

  const byOrder = new Map<number, FailedSyncOrder>()
  for (const row of data ?? []) {
    if (!byOrder.has(row.order_id)) {
      byOrder.set(row.order_id, {
        order_id: row.order_id,
        invoice_number: row.orders.invoice_number,
        last_error: row.last_error,
      })
    }
  }
  return { orders: [...byOrder.values()], total: count ?? 0, error: null }
}
