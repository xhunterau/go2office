import { createClient } from "@supabase/supabase-js"
// The package root, never "@trigger.dev/sdk/v3" (see batch-postage-check.ts).
import { logger, queue, schedules, task } from "@trigger.dev/sdk"

import {
  findOrdersToSweep,
  syncOrderFulfillments,
  type SyncOrderResult,
} from "@/lib/fulfillment/platform-sync"
import type { Database } from "@/lib/supabase/database.types"

// Tracking number write-back to Shopify and eBay (docs/order-dispatch.md §5).
// The to-do rows are written by dispatch_order(); these two tasks do the
// pushing and record the outcome on each row.

/**
 * One queue for both tasks, one run at a time: the dispatch's trigger and the
 * sweep must never push the same order at once, since each push first reads
 * what the platform holds and then writes. Volume is a few dozen orders a day.
 */
const platformFulfillmentQueue = queue({ name: "platform-fulfillment", concurrencyLimit: 1 })

function serviceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
    )
  }
  // Service role: platform_fulfillment_syncs' outcome columns have no policy
  // for authenticated, and ebay_accounts has none at all.
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface PushPlatformFulfillmentPayload {
  orderId: number
  /** Who dispatched or pressed Retry; written to order_logs.user_id. */
  userId?: string | null
  /** Retry from the order page: also re-pushes skipped rows, exhausted failures, and changed numbers. */
  manual?: boolean
}

export const pushPlatformFulfillmentTask = task({
  id: "push-platform-fulfillment",
  queue: platformFulfillmentQueue,
  maxDuration: 120,
  // Not retried by Trigger.dev. A failure is recorded on the row and picked up
  // by the sweep; retrying here would only hide it from the order page. Unlike
  // submit-aramex-batch (CLAUDE.md rule 24), a repeat is safe -- every push
  // reads the platform first -- so the sweep and Retry are free to re-run it.
  retry: { maxAttempts: 1 },

  run: async (payload: PushPlatformFulfillmentPayload): Promise<SyncOrderResult> => {
    const result = await syncOrderFulfillments(serviceClient(), payload.orderId, {
      manual: payload.manual ?? false,
      userId: payload.userId ?? null,
    })
    logger.info("Platform fulfillment sync", { ...result })
    return result
  },
})

export type SweepPlatformFulfillmentResult = {
  orders: number
  failedRows: number
  errors: { orderId: number; error: string }[]
}

/**
 * Picks up what the dispatch's own trigger missed: the trigger call failed,
 * the platform was down, or the push failed and has tries left.
 */
export const sweepPlatformFulfillmentTask = schedules.task({
  id: "sweep-platform-fulfillment",
  // Deployed environments only: a local `trigger dev` would otherwise push
  // real orders from a laptop every 15 minutes.
  cron: { pattern: "*/15 * * * *", environments: ["STAGING", "PRODUCTION"] },
  queue: platformFulfillmentQueue,
  maxDuration: 600,
  retry: { maxAttempts: 1 },

  run: async (): Promise<SweepPlatformFulfillmentResult> => {
    const supabase = serviceClient()
    const orderIds = await findOrdersToSweep(supabase)

    let failedRows = 0
    const errors: SweepPlatformFulfillmentResult["errors"] = []
    // One order at a time, for the same reason as the queue.
    for (const orderId of orderIds) {
      try {
        const result = await syncOrderFulfillments(supabase, orderId)
        failedRows += result.rows.filter((row) => row.status === "failed").length
      } catch (error) {
        // One order's bookkeeping failure must not stop the rest.
        errors.push({ orderId, error: error instanceof Error ? error.message : String(error) })
      }
    }

    logger.info("Platform fulfillment sweep", { orders: orderIds.length, failedRows, errors })
    return { orders: orderIds.length, failedRows, errors }
  },
})
