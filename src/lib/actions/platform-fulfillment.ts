"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/actions/action-result"
import { createClient } from "@/lib/supabase/server"
import { queuePlatformFulfillment } from "@/lib/fulfillment/queue-platform-fulfillment"

/** The Retry button on the order page. */
export async function retryPlatformFulfillment(
  orderId: unknown
): Promise<ActionResult<{ runId: string }>> {
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  // Read under the user's own RLS: nothing to retry is an answer, not a run.
  const { count, error } = await supabase
    .from("platform_fulfillment_syncs")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
  if (error) return { success: false, error: error.message }
  if (!count) return { success: false, error: "This order has no Shopify or eBay orders to update." }

  const result = await queuePlatformFulfillment({ orderId, userId: user.id, manual: true })
  revalidatePath(`/orders/${orderId}`)
  return result
}
