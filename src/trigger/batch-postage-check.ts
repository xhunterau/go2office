import { createClient } from "@supabase/supabase-js"
// Always the package root. NEVER "@trigger.dev/sdk/v3" -- that is the v3 path,
// still present for compatibility and used throughout xpros, which was built
// before v4.
import { logger, metadata, task } from "@trigger.dev/sdk"

import type { Database } from "@/lib/supabase/database.types"
import { fetchPostageQueueRefs } from "@/lib/queries/allocation"
import { runQuoteEngine } from "@/lib/shipping/quote-engine"

export interface BatchPostageCheckPayload {
  userId?: string | null
}

export interface PostageCheckFailure {
  invoiceNumber: string
  reason: string
}

export interface BatchPostageCheckResult {
  processed: number
  /** Orders that came back with at least one priced option. */
  quotedCount: number
  /**
   * Orders the engine could quote but for which nothing priced -- every
   * carrier returned an error or a zero. They stay in the queue with their
   * failure reasons on screen, so the operator can approve one by hand.
   */
  unpricedCount: number
  /**
   * Orders the engine escalated. It sets status to `issued` itself when no
   * carrier is eligible or a PO Box parcel exceeds what any postal carrier
   * takes -- which also drops the order out of this queue, because the queue is
   * `pending`. Counted separately so that disappearance is reported rather than
   * merely happening.
   */
  escalatedCount: number
  failures: PostageCheckFailure[]
}

export const batchPostageCheckTask = task({
  id: "batch-postage-check",
  // The queue is one quote batch per order and a batch is ~1.6s, most of it a
  // live Aramex call. 300s covers a queue of about 150 before the ceiling
  // matters; a larger one is run twice, since a second pass simply re-quotes
  // whatever is still in `pending`.
  maxDuration: 300,
  // A retry would re-run the engine over the orders the first attempt already
  // quoted, inserting a second full batch into order_shipping_quotes for each.
  // Failures are collected per order and reported instead. Same reasoning as
  // submit-aramex-batch, minus the money.
  retry: { maxAttempts: 1 },

  run: async (
    payload: BatchPostageCheckPayload
  ): Promise<BatchPostageCheckResult> => {
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

    const queue = await fetchPostageQueueRefs(supabase)
    if (!queue.data) throw new Error(queue.error ?? "Failed to load the postage queue")
    if (queue.data.length === 0) {
      throw new Error("No orders are waiting on a shipping quote.")
    }

    const failures: PostageCheckFailure[] = []
    let quotedCount = 0
    let unpricedCount = 0
    let escalatedCount = 0

    await metadata.set("progress", { current: 0, total: queue.data.length })

    // Serial, not Promise.all. Every iteration makes a live Aramex call, and
    // firing the whole queue at that endpoint at once is how you get rate
    // limited into a batch of spurious "could not be priced" rows.
    for (const [index, order] of queue.data.entries()) {
      await metadata.set("progress", { current: index + 1, total: queue.data.length })

      try {
        const result = await runQuoteEngine(
          supabase,
          order.id,
          "auto",
          payload.userId ?? null
        )

        if (result.status === "manual_required") {
          escalatedCount += 1
          logger.warn("Order escalated out of the allocation queue", {
            orderId: order.id,
            invoiceNumber: order.invoice_number,
            reason: result.reason,
          })
          continue
        }

        // selectedMethod is null when every option errored or priced at zero.
        // The rows are still on file with their reasons, which is what the
        // review table shows.
        if (result.selectedMethod === null) unpricedCount += 1
        else quotedCount += 1
      } catch (error) {
        // One order must not take the batch down. The engine throws outright on
        // a customer with no postcode and on an order with no
        // order_metrics_summary row -- it will not invent a weight -- and both
        // are conditions a human has to resolve.
        const reason = error instanceof Error ? error.message : "Unknown error"
        failures.push({ invoiceNumber: order.invoice_number, reason })
        logger.error("Quote failed for order", {
          orderId: order.id,
          invoiceNumber: order.invoice_number,
          reason,
        })
      }
    }

    logger.info("Batch postage check complete", {
      processed: queue.data.length,
      quotedCount,
      unpricedCount,
      escalatedCount,
      failureCount: failures.length,
    })

    return {
      processed: queue.data.length,
      quotedCount,
      unpricedCount,
      escalatedCount,
      failures,
    }
  },
})
