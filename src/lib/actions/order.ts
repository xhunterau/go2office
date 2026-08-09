"use server"

import { revalidatePath } from "next/cache"

import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  fetchOrderTransactionsWithItems,
  type OrderTransaction,
} from "@/lib/queries/orders"
import { createClient } from "@/lib/supabase/server"
import {
  orderUpdateSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  type OrderUpdateInput,
  type TransactionCreateInput,
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

// The transaction lines behind one order, for the list page's row expansion.
//
// Fetched on demand rather than joined into fetchOrderList: 20 orders expand to
// roughly 25 transactions and 30 picked items, and paying for that on every
// page change to show what is collapsed by default is work spent on something
// nobody asked to see (docs/orders-ui.md 3.3). Same shape as the inventory
// list's loadProductHistory.
//
// Not to be confused with the order_metrics_summary embed in fetchOrderList,
// which IS joined per page: that is one row per order on a primary key, not a
// second table's worth of lines.
export async function loadOrderTransactions(
  orderId: number
): Promise<ActionResult<OrderTransaction[]>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const supabase = await createClient()
  const { transactions, error } = await fetchOrderTransactionsWithItems(
    supabase,
    orderId
  )

  if (error) return { success: false, error }
  return { success: true, data: transactions }
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
      // posted_on_date is deliberately not in this list, and the omission is
      // load-bearing rather than cosmetic. It used to be here as
      // `toNullable(parsed.data.posted_on_date)`; once the form stopped
      // submitting the field that expression became toNullable(undefined),
      // which is null -- so every unrelated edit (a comment, a status) would
      // have silently cleared the dispatch date of the order being saved. Any
      // future field dropped from orderUpdateSchema has to be removed from
      // here in the same change for the same reason.
    })
    .eq("id", id)

  if (error) return { success: false, error: messageFor(error) }

  revalidateOrder(id)
  return { success: true }
}

// Move an order onto a different customer.
//
// Deliberately not a field of updateOrder. That action writes the order's own
// columns, where the worst case is a wrong tracking number; customer_id is a
// pointer at another table and moving it rewrites what the whole page says about
// who this went to -- recipient AND address, because orders keep no address of
// their own and render the customer's current one (docs/orders-ui.md 6.3). It
// also moves the order out of one customer's history and into another's.
//
// Cheap in spite of order_metrics_summary: trg_oms_orders narrows UPDATEs to
// postage_and_handling, discount and postage_paid, so this recomputes nothing.
export async function replaceOrderCustomer(
  orderId: number,
  customerId: number
): Promise<ActionResult> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return { success: false, error: "Invalid customer" }
  }

  const supabase = await createClient()

  // Read the current owner first. Writing the value it already holds would
  // report success and change nothing, which reads as the feature being broken.
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("customer_id")
    .eq("id", orderId)
    .maybeSingle()

  if (readError) return { success: false, error: readError.message }
  if (!order) return { success: false, error: "Order not found" }
  if (order.customer_id === customerId) {
    return {
      success: false,
      error: "This order already belongs to that customer.",
    }
  }

  const { error } = await supabase
    .from("orders")
    .update({ customer_id: customerId })
    .eq("id", orderId)

  if (error) {
    // customer_id is NOT NULL behind orders_customer_id_fkey, so in practice the
    // one way this fails is the customer having been deleted between the
    // picker's search and this save.
    if (isForeignKeyViolation(error)) {
      return { success: false, error: "That customer no longer exists." }
    }
    return { success: false, error: messageFor(error) }
  }

  revalidateOrder(orderId)
  return { success: true }
}

// Add a transaction line by hand.
//
// order_transactions_rebuild_items_insert fires unconditionally on INSERT, so
// the picked lines underneath are generated from custom_label as part of this
// statement -- nobody types them. A plain product yields one line, a kit yields
// one per BOM entry.
//
// Requiring the SKU to exist (below) does not rule out an unresolved result: a
// kit with an empty BOM also expands to a single placeholder with product_id
// NULL, and 24 such kits exist. Nothing about the insert reports that, so the
// generated rows are read back and the outcome is named -- otherwise selling an
// empty kit looks exactly like selling a well-formed one.
export async function createOrderTransaction(
  orderId: number,
  input: TransactionCreateInput
): Promise<
  ActionResult<{ transactionId: number; itemCount: number; unresolved: boolean }>
> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const parsed = transactionCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()

  // The SKU must resolve to a real product. The dialog only offers picked
  // products, so this is the guard for anything that bypasses it -- and the
  // reason it is worth having is that the database would not complain: an
  // unknown label inserts happily and quietly becomes an unresolved picked line.
  // Non-empty by the schema's refinement; the fallback is only here because the
  // refinement cannot narrow the inferred type.
  const label = parsed.data.custom_label?.trim() ?? ""
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("sku", label)
    .maybeSingle()

  if (productError) return { success: false, error: productError.message }
  if (!product) {
    return { success: false, error: `No product matches the SKU ${label}.` }
  }

  // Both dates are NOT NULL with no default. A hand-added line has no separate
  // payment moment to record, so they get the same value.
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("order_transactions")
    .insert({
      order_id: orderId,
      quantity: parsed.data.quantity,
      sale_price: parsed.data.sale_price,
      custom_label: label,
      item_title: toNullable(parsed.data.item_title),
      sale_date: now,
      paid_on_date: now,
    })
    .select("id")
    .single()

  if (error) {
    if (isCheckViolation(error)) {
      return { success: false, error: "Quantity must be at least 1." }
    }
    if (isForeignKeyViolation(error)) {
      return { success: false, error: "This order no longer exists." }
    }
    return { success: false, error: error.message }
  }

  // The line is already saved at this point, so a failed read-back downgrades
  // the message rather than the outcome.
  const { data: items } = await supabase
    .from("order_items")
    .select("product_id")
    .eq("transaction_id", data.id)

  revalidateOrder(orderId)
  return {
    success: true,
    data: {
      transactionId: data.id,
      itemCount: items?.length ?? 0,
      unresolved: (items ?? []).some((item) => item.product_id === null),
    },
  }
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

// Delete one transaction line.
//
// The picked lines underneath go with it: order_items.transaction_id is
// ON DELETE CASCADE, so no second statement is needed and none of them can be
// left orphaned. Nothing else follows -- order_items carries no stock movements
// yet (dispatch-to-inventory is a later round, docs/orders-ui.md 13), so this
// only changes what the order says was sold.
//
// Leaving an order with no lines at all is allowed: 25 migrated orders are
// already in that state, and order_metrics_summary reports 0 for them.
export async function deleteOrderTransaction(
  transactionId: number,
  orderId: number
): Promise<ActionResult> {
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return { success: false, error: "Invalid transaction" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("order_transactions")
    .delete()
    .eq("id", transactionId)

  if (error) return { success: false, error: error.message }

  revalidateOrder(orderId)
  return { success: true }
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
