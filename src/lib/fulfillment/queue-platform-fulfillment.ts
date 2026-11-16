
import { tasks } from "@trigger.dev/sdk"

import type { ActionResult } from "@/lib/actions/action-result"
import type { pushPlatformFulfillmentTask } from "@/trigger/push-platform-fulfillment"

// Deliberately not a "use server" module: every export of one is callable from
// the browser, and this takes the acting user's id as an argument. Callers are
// Server Actions that have already read the user from the session.

/**
 * Starts the Shopify / eBay push for one order. Used by dispatchOrder right
 * after the dispatch commits, and by the Retry button on the order page.
 *
 * It only triggers the task: the rows' outcome columns are written by the task
 * under the service role, and there is no UPDATE policy for authenticated
 * (migration 20261116100000).
 */
export async function queuePlatformFulfillment({
  orderId,
  userId,
  manual = false,
}: {
  orderId: number
  userId: string
  manual?: boolean
}): Promise<ActionResult<{ runId: string }>> {
  try {
    const run = await tasks.trigger<typeof pushPlatformFulfillmentTask>(
      "push-platform-fulfillment",
      { orderId, userId, manual }
    )
    return { success: true, data: { runId: run.id } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start the platform update",
    }
  }
}
