import { createClient } from "@supabase/supabase-js"
// Always the package root. NEVER "@trigger.dev/sdk/v3" -- that is the v3 path,
// still present for compatibility and used throughout xpros, which was built
// before v4.
import { logger, metadata, task } from "@trigger.dev/sdk"

import type { Database } from "@/lib/supabase/database.types"
import { submitConsignment } from "@/lib/aramex/consignment"
import { UnmappableOrderError } from "@/lib/fulfillment/types"
import { requireFallbacks } from "@/lib/fulfillment/types"
import { fetchDispatchableOrders } from "@/lib/queries/fulfillment"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import { ARAMEX_METHODS } from "@/lib/fulfillment/carrier-groups"

export interface SubmitAramexBatchPayload {
  userId?: string | null
}

export interface AramexBatchFailure {
  invoiceNumber: string
  reason: string
}

export interface SubmitAramexBatchResult {
  successCount: number
  failures: AramexBatchFailure[]
  consignmentIds: number[]
  /** Written back to orders.tracking_number, one per successful booking. */
  trackingNumbers: string[]
  /**
   * Bookings Aramex accepted but whose id and label could not be read from the
   * response, so the order carries no tracking number. Not a failure -- the
   * parcel is booked -- but it needs a human to look the number up.
   */
  untracked: string[]
}

export const submitAramexBatchTask = task({
  id: "submit-aramex-batch",
  maxDuration: 300,
  // Booking is not idempotent: a retry after a partial run would rebook every
  // order the first attempt already committed. Orders that succeeded have moved
  // to `labelled` and would drop out of the queue, but an order that failed
  // *after* Aramex accepted it would be booked twice. Failures are collected
  // and reported instead.
  retry: { maxAttempts: 1 },

  run: async (
    payload: SubmitAramexBatchPayload
  ): Promise<SubmitAramexBatchResult> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
      )
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const settings = await fetchShippingSettings(supabase)
    if (!settings.data) {
      throw new Error(settings.error ?? "Shipping settings are missing")
    }

    const fallbacks = requireFallbacks(settings.data)
    if (!fallbacks.fallbacks) throw new Error(fallbacks.error)

    const queue = await fetchDispatchableOrders(supabase, ARAMEX_METHODS)
    if (!queue.data) throw new Error(queue.error ?? "Failed to load Aramex orders")
    if (queue.data.length === 0) {
      throw new Error("No orders are waiting on an Aramex consignment.")
    }

    const failures: AramexBatchFailure[] = []
    const consignmentIds: number[] = []
    const trackingNumbers: string[] = []
    const untracked: string[] = []

    await metadata.set("progress", { current: 0, total: queue.data.length })

    // Serial, not Promise.all. Each iteration is a booking that costs money and
    // Aramex rate-limits the endpoint; a partial failure also has to leave the
    // orders it already booked alone.
    for (const [index, order] of queue.data.entries()) {
      await metadata.set("progress", { current: index + 1, total: queue.data.length })

      try {
        const result = await submitConsignment(
          supabase,
          order,
          fallbacks.fallbacks,
          payload.userId ?? null
        )
        if (result.consignmentId != null) consignmentIds.push(result.consignmentId)
        if (result.trackingNumber != null) {
          trackingNumbers.push(result.trackingNumber)
        } else {
          untracked.push(order.invoice_number)
          logger.warn("Aramex booking carried no id or label", {
            orderId: order.id,
            invoiceNumber: order.invoice_number,
          })
        }
      } catch (error) {
        const reason =
          error instanceof UnmappableOrderError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error"

        failures.push({ invoiceNumber: order.invoice_number, reason })
        logger.error("Aramex consignment failed", {
          orderId: order.id,
          invoiceNumber: order.invoice_number,
          reason,
        })
      }
    }

    // successCount counts orders booked, not ids collected: a booking whose id
    // could not be read is still a parcel Aramex has taken, and counting it as a
    // failure would invite a second booking for the same order.
    const successCount = queue.data.length - failures.length

    logger.info("Aramex batch complete", {
      successCount,
      failureCount: failures.length,
      untrackedCount: untracked.length,
    })

    return { successCount, failures, consignmentIds, trackingNumbers, untracked }
  },
})
