"use server"

import { revalidatePath } from "next/cache"
import { runs, tasks } from "@trigger.dev/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { ActionResult } from "@/lib/actions/action-result"
import type { Database } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"
import { snapshotOf, type RunSnapshot } from "@/lib/trigger/run-status"
import {
  ALLOCATION_COUNTRY,
  ALLOCATION_STATUS,
  APPROVED_STATUS,
  countPostageQueue,
} from "@/lib/queries/allocation"
import {
  normalizeLocality,
  normalizePostcode,
} from "@/lib/shipping/adapters/zone-resolver"
import {
  allocationAddressSchema,
  manualApprovalSchema,
  type AllocationAddressInput,
  type ManualApprovalInput,
} from "@/lib/validations/allocation"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
// A type-only import: the task module pulls in the quote engine and the
// service-role Supabase client, and bundling that into the Next.js build would
// ship the service-role path to the server bundle for no reason. The string id
// below is what actually addresses the task.
import type {
  batchPostageCheckTask,
  BatchPostageCheckResult,
} from "@/trigger/batch-postage-check"

type Client = SupabaseClient<Database>

function revalidate(orderId?: number): void {
  revalidatePath("/fulfillment/allocation")
  revalidatePath("/fulfillment/allocation/address")
  revalidatePath("/fulfillment/allocation/postage")
  revalidatePath("/fulfillment/export-labels")
  revalidatePath("/orders")
  if (orderId) revalidatePath(`/orders/${orderId}`)
}

async function currentUser(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Appends to the order's audit trail.
 *
 * Never fatal on its own. Every caller here logs AFTER the state change it is
 * describing, and by then telling the operator "that failed" would be the worse
 * of two wrong answers -- the order has moved and they would move it again
 * (CLAUDE.md rule 24). Returns a warning to surface instead.
 */
async function logAction(
  supabase: Client,
  orderId: number,
  action: string,
  userId: string
): Promise<string | undefined> {
  const { error } = await supabase
    .from("order_logs")
    .insert({ order_id: orderId, action, user_id: userId })

  return error ? `The order log was not written: ${error.message}` : undefined
}

// ── Address stage ───────────────────────────────────────────────────────────

export type AddressCheckResult = { verified: number }

/**
 * Marks every pending AU order whose address resolves in the postcode
 * reference, in one statement.
 *
 * Not a background task, unlike xpros' batch-address-check. That version loops
 * order by order because it queries the reference table once per order; the
 * work is a join, so here it is one `UPDATE … EXISTS (…)` inside
 * verify_pending_order_addresses() and finishes in a single round trip
 * regardless of queue size. CLAUDE.md rule 21 documents the same row-level
 * versus set-based split for the 004 import, where it was the difference
 * between minutes and 178,024 trigger firings.
 */
export async function runAddressCheck(): Promise<ActionResult<AddressCheckResult>> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  const { data, error } = await supabase.rpc("verify_pending_order_addresses")
  if (error) return { success: false, error: error.message }

  revalidate()
  return { success: true, data: { verified: data ?? 0 } }
}

/**
 * True when this (postcode, suburb) pair exists in the reference table.
 *
 * The same question verify_pending_order_addresses() asks in SQL and
 * resolveZone asks when pricing. Asked here so that saving an address that
 * still will not resolve says so, rather than letting the operator find out
 * when the quote comes back empty.
 */
async function resolvesInReference(
  supabase: Client,
  postcode: string,
  city: string
): Promise<boolean> {
  const { data } = await supabase
    .from("postcodes")
    .select("id")
    .eq("postcode", normalizePostcode(postcode))
    // Equality, and upper() on the input: the reference stores localities
    // upper-cased, and ILIKE would make a `%` in a suburb name a wildcard
    // (CLAUDE.md rule 21).
    .eq("locality", normalizeLocality(city))
    .limit(1)
    .maybeSingle()

  return data != null
}

export type AddressResolution = {
  resolved: boolean
  /**
   * Every locality the reference holds for this postcode, so the card can offer
   * them. Empty means the postcode itself is unknown, which is a different
   * problem from a misspelt suburb and worth being able to tell apart.
   */
  localities: string[]
}

/**
 * Live feedback for the address form: would this pair resolve if saved?
 *
 * Called as the operator edits, so the answer is about what is in the boxes
 * right now rather than about the postcode the order arrived with. Without it
 * the only way to find out is to save and see whether the quote comes back
 * empty ten minutes later.
 */
export async function checkAddressResolution(
  postcode: string,
  city: string
): Promise<ActionResult<AddressResolution>> {
  const padded = normalizePostcode(postcode)
  if (!/^\d{4}$/.test(padded)) {
    return { success: true, data: { resolved: false, localities: [] } }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("postcodes")
    .select("locality")
    .eq("postcode", padded)
    .order("locality", { ascending: true })

  if (error) return { success: false, error: error.message }

  const localities = (data ?? []).map((row) => row.locality)
  return {
    success: true,
    data: {
      resolved: localities.includes(normalizeLocality(city)),
      localities,
    },
  }
}

/**
 * Moves one order out of the Address queue.
 *
 * `.select("id")` is not decoration: RLS refuses an UPDATE by filtering the
 * rows away rather than raising, so without reading a row back a blocked write
 * reports success (CLAUDE.md rule 22). The status and null checks in the WHERE
 * also catch an order somebody else has already dealt with.
 */
async function markVerified(
  supabase: Client,
  orderId: number,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("orders")
    .update({ address_verified_at: new Date().toISOString(), address_verified_by: userId })
    .eq("id", orderId)
    .eq("status", ALLOCATION_STATUS)
    .is("address_verified_at", null)
    .select("id")
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) {
    return {
      ok: false,
      error: "This order is no longer waiting on an address check. Reload the page.",
    }
  }
  return { ok: true }
}

export type AddressPassResult = {
  /**
   * False when the saved address still does not resolve in the postcode
   * reference. The order is passed either way -- the operator has looked at it
   * and said it is right -- but the quote will probably come back empty, so the
   * page says so now instead of leaving them to work it out later.
   */
  resolved: boolean
  warning?: string
}

/** Saves the corrected address onto the customer, then passes the order. */
export async function saveAddressAndVerify(
  orderId: number,
  input: AllocationAddressInput
): Promise<ActionResult<AddressPassResult>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const parsed = allocationAddressSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid address" }
  }
  const address = parsed.data

  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("customer_id, invoice_number, customers!inner (country)")
    .eq("id", orderId)
    .eq("status", ALLOCATION_STATUS)
    .maybeSingle()

  if (orderError) return { success: false, error: orderError.message }
  if (!order) {
    return { success: false, error: "Order not found, or no longer pending" }
  }
  if (order.customers.country !== ALLOCATION_COUNTRY) {
    return { success: false, error: "Allocation only handles Australian addresses" }
  }

  // The customer's address, not the order's: orders keep no snapshot of their
  // own, so this rewrites the address on every order this customer has,
  // including historical ones (docs/orders-ui.md 6.3). The card says so.
  //
  // state and country are absent on purpose. customers_standardize_address
  // derives state from (postcode, suburb) on write, so sending one would be
  // overwritten in the same statement (CLAUDE.md rule 21).
  const { data: saved, error: saveError } = await supabase
    .from("customers")
    .update({
      address_line1: address.address_line1,
      address_line2: address.address_line2 || null,
      city: address.city,
      postcode: address.postcode,
    })
    .eq("id", order.customer_id)
    .select("id")
    .maybeSingle()

  if (saveError) return { success: false, error: saveError.message }
  if (!saved) return { success: false, error: "The address could not be saved" }

  const resolved = await resolvesInReference(supabase, address.postcode, address.city)

  const marked = await markVerified(supabase, orderId, user.id)
  if (!marked.ok) return { success: false, error: marked.error }

  const warning = await logAction(
    supabase,
    orderId,
    `Allocation: address corrected and verified by hand (${address.city} ${address.postcode})${
      resolved ? "" : " — still not in the postcode reference"
    }.`,
    user.id
  )

  revalidate(orderId)
  return { success: true, data: { resolved, warning } }
}

/** Passes the order with the address exactly as it stands. */
export async function verifyAddressWithoutChanges(
  orderId: number
): Promise<ActionResult<{ warning?: string }>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  const marked = await markVerified(supabase, orderId, user.id)
  if (!marked.ok) return { success: false, error: marked.error }

  const warning = await logAction(
    supabase,
    orderId,
    "Allocation: address accepted as it stands, without changes.",
    user.id
  )

  revalidate(orderId)
  return { success: true, data: { warning } }
}

// ── Postage stage ───────────────────────────────────────────────────────────

export type PostageCheckStatus = RunSnapshot<BatchPostageCheckResult>

/**
 * Starts the batch quote run.
 *
 * Unlike the address check this cannot be inline: it is one quote batch per
 * order, each including a live Aramex call, and a queue of any size would
 * outrun a Server Action's budget.
 */
export async function triggerPostageCheck(): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  const queue = await countPostageQueue(supabase)
  if (queue.error) return { success: false, error: queue.error }
  if (queue.data === 0) {
    return { success: false, error: "No orders are waiting on a shipping quote." }
  }

  try {
    const run = await tasks.trigger<typeof batchPostageCheckTask>(
      "batch-postage-check",
      { userId: user.id }
    )
    return { success: true, data: { runId: run.id } }
  } catch (error) {
    // Almost always no dev worker running, or TRIGGER_SECRET_KEY missing. Both
    // read as "failed to start", so the message is worth passing through.
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to start the postage check",
    }
  }
}

/** Polled by the page while the batch runs. See src/lib/trigger/run-status.ts. */
export async function getPostageCheckStatus(
  runId: string
): Promise<ActionResult<PostageCheckStatus>> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  try {
    const run = await runs.retrieve<typeof batchPostageCheckTask>(runId)
    return { success: true, data: snapshotOf(run) }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not read the postage check status",
    }
  }
}

export type ApprovalResult = { warning?: string }

/**
 * Commits the order to a carrier and hands it to label production.
 *
 * This is the one place the operator's decision is written. The quote engine
 * marks a row `is_selected` when it runs, but that is a suggestion and never
 * reaches orders.shipping_method on its own -- putting a carrier on an order is
 * an operator's action (docs/shipping-quote-engine.md).
 */
export async function approveQuotedOrder(
  orderId: number,
  quoteId: number
): Promise<ActionResult<ApprovalResult>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return { success: false, error: "Invalid quote" }
  }

  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  const { data: quote, error: quoteError } = await supabase
    .from("order_shipping_quotes")
    .select("shipping_method, quoted_rate, error_message")
    .eq("id", quoteId)
    .eq("order_id", orderId)
    .maybeSingle()

  if (quoteError) return { success: false, error: quoteError.message }
  if (!quote) return { success: false, error: "Quote not found" }
  if (quote.error_message) {
    return { success: false, error: "That option could not be priced" }
  }

  const rate = Number(quote.quoted_rate)
  if (!(rate > 0)) {
    return { success: false, error: "That option has no price" }
  }

  // Clear first, set second. order_shipping_quotes_one_selected_idx is unique on
  // (order_id) WHERE is_selected, so the reverse order fails on the second
  // statement and leaves the order with nothing selected at all.
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

  const moved = await moveToProcessing(supabase, orderId, quote.shipping_method, rate)
  if (!moved.ok) return { success: false, error: moved.error }

  const warning = await logAction(
    supabase,
    orderId,
    `Allocation approved: ${SHIPPING_METHOD_LABELS[quote.shipping_method]} at $${rate.toFixed(2)} (quoted). Order moved to ${APPROVED_STATUS}.`,
    user.id
  )

  revalidate(orderId)
  return { success: true, data: { warning } }
}

/**
 * Approves an order no carrier could price.
 *
 * Without this an order whose every quote failed has no way forward: it cannot
 * be approved from a quote it does not have, and leaving it in the queue makes
 * the queue a place things go to be ignored. The method list is restricted to
 * routed channels (see MANUAL_APPROVAL_METHODS) so the order cannot be sent to
 * `processing` and then vanish from /fulfillment/export-labels.
 */
export async function approveWithoutQuote(
  orderId: number,
  input: ManualApprovalInput
): Promise<ActionResult<ApprovalResult>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const parsed = manualApprovalSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { shipping_method, postage_paid } = parsed.data

  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Your session has expired" }

  // The chosen method need not match any quoted row, so no row may stay marked
  // selected -- the same reason updateOrderShippingMethod clears it when the
  // method is set by hand on the order page (docs/orders-ui.md 6.8). The quote
  // rows themselves are left alone: they record what was quoted that day and
  // are not rewritten when circumstances change (CLAUDE.md rule 23).
  const { error: clearError } = await supabase
    .from("order_shipping_quotes")
    .update({ is_selected: false })
    .eq("order_id", orderId)
    .eq("is_selected", true)

  if (clearError) return { success: false, error: clearError.message }

  const moved = await moveToProcessing(supabase, orderId, shipping_method, postage_paid)
  if (!moved.ok) return { success: false, error: moved.error }

  const warning = await logAction(
    supabase,
    orderId,
    `Allocation approved by hand: ${SHIPPING_METHOD_LABELS[shipping_method]} at $${postage_paid.toFixed(2)} (entered, not quoted). Order moved to ${APPROVED_STATUS}.`,
    user.id
  )

  revalidate(orderId)
  return { success: true, data: { warning } }
}

/**
 * The state change both approval paths share.
 *
 * postage_paid is what WE expect to pay the carrier, not what the customer paid
 * us -- that is postage_and_handling, and the two are easy to confuse because
 * xpros names them the other way round. Writing it also fires the
 * order_metrics_summary triggers, which is correct: postage_paid feeds gross
 * profit.
 *
 * The WHERE is the concurrency guard. RLS refuses an UPDATE by returning no
 * rows rather than raising (CLAUDE.md rule 22), and so does an order somebody
 * else approved a second ago; both land on the same message.
 */
async function moveToProcessing(
  supabase: Client,
  orderId: number,
  shippingMethod: Database["public"]["Enums"]["shipping_method"],
  postagePaid: number
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("orders")
    .update({
      shipping_method: shippingMethod,
      postage_paid: postagePaid,
      status: APPROVED_STATUS,
    })
    .eq("id", orderId)
    .eq("status", ALLOCATION_STATUS)
    .not("address_verified_at", "is", null)
    .select("id")
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) {
    return {
      ok: false,
      error:
        "This order is no longer waiting for approval — it may have been approved already, or its address check undone. Reload the page.",
    }
  }
  return { ok: true }
}
