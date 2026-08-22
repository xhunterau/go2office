"use server"

import { revalidatePath } from "next/cache"
import { tasks } from "@trigger.dev/sdk"

import type { ActionResult } from "@/lib/actions/action-result"
import {
  fetchLatestShippingQuotes,
  type ShippingQuoteBatch,
} from "@/lib/queries/shipping-quotes"
import { createClient } from "@/lib/supabase/server"
// A type-only import: the task's own module pulls in the engine and the
// Supabase service client, and bundling that into the Next.js build would ship
// the service role key path to the server bundle for no reason. The string id
// below is what actually addresses the task.
import type { quoteShippingTask } from "@/trigger/quote-shipping"

function revalidateOrder(orderId: number): void {
  revalidatePath(`/orders/${orderId}`)
}

// Starts a quote run. Returns as soon as the task is queued -- the panel polls
// for the batch, because the run takes a second or two and one of the four
// pricing paths is a live call to Aramex.
export async function triggerShippingQuote(
  orderId: number
): Promise<ActionResult<{ runId: string }>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  try {
    const run = await tasks.trigger<typeof quoteShippingTask>("quote-shipping", {
      orderId,
      triggeredBy: "manual",
      userId: user?.id ?? null,
    })
    return { success: true, data: { runId: run.id } }
  } catch (error) {
    // The most common cause by far is no dev worker running, or
    // TRIGGER_SECRET_KEY missing. Both read as "failed to start" in the toast,
    // so the message is worth passing through verbatim.
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start the quote job",
    }
  }
}

export async function loadLatestShippingQuotes(
  orderId: number
): Promise<ActionResult<ShippingQuoteBatch>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const batch = await fetchLatestShippingQuotes(supabase, orderId)
  if (batch.error) return { success: false, error: batch.error }
  return { success: true, data: batch }
}

// Marks one quote as the order's shipping method. Also the step that commits
// the engine's own pick: the engine sets is_selected but deliberately does not
// touch orders.shipping_method, because putting a carrier on an order is an
// operator's decision.
export async function selectShippingQuote(
  quoteId: number,
  orderId: number
): Promise<ActionResult> {
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return { success: false, error: "Invalid quote" }
  }
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()

  const { data: quote, error: fetchError } = await supabase
    .from("order_shipping_quotes")
    .select("shipping_method, error_message")
    .eq("id", quoteId)
    .eq("order_id", orderId)
    .maybeSingle()

  if (fetchError) return { success: false, error: fetchError.message }
  if (!quote) return { success: false, error: "Quote not found" }
  if (quote.error_message) {
    return { success: false, error: "That option could not be priced" }
  }

  // Clear first, set second. order_shipping_quotes_one_selected_idx is a unique
  // index on (order_id) WHERE is_selected, so the reverse order fails on the
  // second statement and leaves nothing selected at all.
  const { error: clearError } = await supabase
    .from("order_shipping_quotes")
    .update({ is_selected: false })
    .eq("order_id", orderId)
    .eq("is_selected", true)

  if (clearError) return { success: false, error: clearError.message }

  const { error: selectError } = await supabase
    .from("order_shipping_quotes")
    .update({ is_selected: true })
    .eq("id", quoteId)

  if (selectError) return { success: false, error: selectError.message }

  const { error: orderError } = await supabase
    .from("orders")
    .update({ shipping_method: quote.shipping_method })
    .eq("id", orderId)

  if (orderError) return { success: false, error: orderError.message }

  revalidateOrder(orderId)
  return { success: true }
}

// Deletes every batch for the order, not only the newest. The button says
// "Clear Quotes" and the confirm dialog says all of them; leaving older batches
// behind would resurrect one on the next page load.
export async function clearShippingQuotes(orderId: number): Promise<ActionResult> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("order_shipping_quotes")
    .delete()
    .eq("order_id", orderId)

  if (error) return { success: false, error: error.message }

  revalidateOrder(orderId)
  return { success: true }
}
