"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/actions/action-result"
import { createClient } from "@/lib/supabase/server"
import { dispatchOrderSchema } from "@/lib/validations/dispatch"

// dispatch_order()'s own SQLSTATEs (migration 20261114150000).
const SHARED_TRACKING = "GO001"

export type DispatchOutcome = {
  /** The number as stored, after normalize_tracking_number. */
  trackingNumber?: string
  /**
   * Set, with success false, when the number is already on other orders. The
   * page asks whether one parcel really carries both, and retries with
   * allow_shared_tracking.
   */
  sharedWith?: string
}

/**
 * Dispatches a labelled order: stock out, pick locations, tracking number and
 * `completed`, in one database transaction (see dispatch_order()).
 *
 * No order-log write here and so no warning path, unlike the allocation and
 * export actions (CLAUDE.md rule 24): the log line is inside the same
 * transaction, so it either exists or the dispatch did not happen.
 */
export async function dispatchOrder(input: unknown): Promise<ActionResult<DispatchOutcome>> {
  const parsed = dispatchOrderSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const data = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  const { data: trackingNumber, error } = await supabase.rpc("dispatch_order", {
    p_order_id: data.order_id,
    p_tracking_number: data.tracking_number,
    p_picks: data.picks,
    p_allow_shared_tracking: data.allow_shared_tracking,
  })

  if (error) {
    // The function's messages are written to be shown as they are.
    return {
      success: false,
      error: error.message,
      data: error.code === SHARED_TRACKING ? { sharedWith: error.hint ?? "" } : undefined,
    }
  }

  revalidatePath("/fulfillment/dispatch")
  revalidatePath(`/fulfillment/dispatch/${data.order_id}`)
  revalidatePath("/orders")
  revalidatePath(`/orders/${data.order_id}`)
  // Stock moved: the same paths a manual movement refreshes.
  revalidatePath("/inventory")
  revalidatePath("/products", "layout")

  return { success: true, data: { trackingNumber } }
}
