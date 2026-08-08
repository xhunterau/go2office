"use server"

import { revalidatePath } from "next/cache"

import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import { createClient } from "@/lib/supabase/server"
import {
  orderUpdateSchema,
  transactionUpdateSchema,
  type OrderUpdateInput,
  type TransactionUpdateInput,
} from "@/lib/validations/order"

function revalidateOrder(id: number): void {
  revalidatePath("/orders")
  revalidatePath(`/orders/${id}`)
  // The customer's order history renders the same rows.
  revalidatePath("/customers", "layout")
}

function toNullable(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    return "An order with this invoice number already exists."
  }
  if (isCheckViolation(error)) {
    return "One of the values is outside the range this order allows."
  }
  return error.message ?? "Something went wrong"
}

// Update the order's own fields.
//
// This never touches order_transactions, so it cannot fire
// order_transactions_rebuild_items_update. That separation is the point: the
// trigger's `UPDATE OF custom_label, quantity` clause exists so that fixing a
// typo in the comments does not silently rewrite the pick list. Keep transaction
// fields out of this action.
export async function updateOrder(
  id: number,
  input: OrderUpdateInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const parsed = orderUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("orders")
    .update({
      status: parsed.data.status,
      platform: parsed.data.platform,
      shipping_method: parsed.data.shipping_method,
      // legacy_shipping_method is deliberately not in this list. Setting a
      // current shipping_method stops the retired carrier being displayed, but
      // erasing it would destroy the only record of who actually carried 29143
      // historical parcels (docs/orders-ui.md 4.3 decision B).
      postage_and_handling: parsed.data.postage_and_handling,
      tracking_number: toNullable(parsed.data.tracking_number),
      web_order_id: toNullable(parsed.data.web_order_id),
      comments: toNullable(parsed.data.comments),
      posted_on_date: toNullable(parsed.data.posted_on_date),
    })
    .eq("id", id)

  if (error) return { success: false, error: messageFor(error) }

  revalidateOrder(id)
  return { success: true }
}

// Update one transaction line.
//
// DANGER: changing custom_label or quantity fires
// order_transactions_rebuild_items_update, which deletes and regenerates every
// order_items row under this transaction. Pick locations survive only for
// products still in the new expansion, and any hand-corrected line
// (is_auto_generated = false) is replaced by a generated one. The caller must
// confirm with the user first (project rule 9) -- the returned
// `rebuiltPickedItems` flag tells the UI whether that happened so it can say so
// afterwards.
export async function updateOrderTransaction(
  transactionId: number,
  orderId: number,
  input: TransactionUpdateInput
): Promise<ActionResult<{ rebuiltPickedItems: boolean }>> {
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return { success: false, error: "Invalid transaction" }
  }

  const parsed = transactionUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()

  // Read the two watched columns first so the caller can be told whether the
  // pick list was actually rebuilt. The trigger's WHEN clause uses the same
  // IS DISTINCT FROM comparison, so this predicts it exactly.
  const { data: before, error: readError } = await supabase
    .from("order_transactions")
    .select("custom_label, quantity")
    .eq("id", transactionId)
    .maybeSingle()

  if (readError) return { success: false, error: readError.message }
  if (!before) return { success: false, error: "Transaction not found" }

  const nextLabel = toNullable(parsed.data.custom_label)
  const rebuiltPickedItems =
    before.custom_label !== nextLabel || before.quantity !== parsed.data.quantity

  const { error } = await supabase
    .from("order_transactions")
    .update({
      quantity: parsed.data.quantity,
      sale_price: parsed.data.sale_price,
      custom_label: nextLabel,
      item_title: toNullable(parsed.data.item_title),
    })
    .eq("id", transactionId)

  if (error) {
    if (isCheckViolation(error)) {
      return { success: false, error: "Quantity must be at least 1." }
    }
    return { success: false, error: error.message }
  }

  revalidateOrder(orderId)
  return { success: true, data: { rebuiltPickedItems } }
}

// Recalculate every picked line on an order against today's kit contents.
//
// Destructive and irreversible: it replaces what was actually shipped with what
// the current BOM says would ship now, and there is no undo. The confirmation
// copy has to say that outright. It is still the only supported way to pull an
// order up to the current BOM -- product_kit_items changes deliberately do not
// cascade into order_items.
export async function rebuildOrderItems(orderId: number): Promise<
  ActionResult<{ rowsWritten: number }>
> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("rebuild_order_items_for_order", {
    p_order_id: orderId,
  })

  if (error) return { success: false, error: error.message }

  revalidateOrder(orderId)
  return { success: true, data: { rowsWritten: data ?? 0 } }
}
