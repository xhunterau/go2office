"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  isCheckViolation,
  isForeignKeyViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  moveStockSchema,
  setStockSchema,
  stockMovementSchema,
} from "@/lib/validations/inventory"

// A stock change shows up on the inventory list, the products list (On Hand
// column) and the product's own detail page, so all three are invalidated.
function revalidateStock(productId: number): void {
  revalidatePath("/inventory")
  revalidatePath("/products")
  revalidatePath(`/products/${productId}`)
}

// Turn a Postgres error from the stock functions into something actionable.
//
// Over-dispatch surfaces as a CHECK violation on
// inventory_levels_qty_non_negative rather than a pre-flight error: checking
// the balance before writing would be a race, so the constraint is the check.
function messageFor(error: { code?: string; message?: string }): string {
  const raw = error.message ?? ""

  if (raw.includes("Kits cannot hold stock")) {
    return "Kits cannot hold stock of their own."
  }
  if (raw.includes("No stock recorded at this location")) {
    return "There is no stock at this location to remove."
  }
  if (raw.includes("Source and destination locations must differ")) {
    return "Source and destination must be different locations."
  }
  if (isCheckViolation(error)) {
    if (raw.includes("qty_non_negative")) {
      return "Not enough stock in this location."
    }
    return raw.replace(/^.*?error:\s*/, "")
  }
  if (isForeignKeyViolation(error)) {
    return "The product or location no longer exists."
  }
  return raw || "Something went wrong"
}

export async function receiveStock(input: unknown): Promise<ActionResult> {
  const parsed = stockMovementSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_stock_movement", {
    p_product_id: data.product_id,
    p_location_id: data.location_id,
    p_kind: "receive",
    p_qty_delta: data.qty,
    p_note: data.note ?? null,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateStock(data.product_id)
  return { success: true }
}

export async function dispatchStock(input: unknown): Promise<ActionResult> {
  const parsed = stockMovementSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()
  // The form collects an unsigned amount; the sign belongs to the direction,
  // which is decided here rather than trusted from the client.
  const { error } = await supabase.rpc("record_stock_movement", {
    p_product_id: data.product_id,
    p_location_id: data.location_id,
    p_kind: "dispatch",
    p_qty_delta: -data.qty,
    p_note: data.note ?? null,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateStock(data.product_id)
  return { success: true }
}

// Stocktake. Sends the counted figure, not a delta: resolving "set it to N"
// inside the database avoids landing on the wrong number when the balance moves
// between the page load and the submit.
export async function adjustStock(
  input: unknown
): Promise<ActionResult<"adjusted" | "unchanged">> {
  const parsed = setStockSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()
  const { data: movementId, error } = await supabase.rpc("set_stock_level", {
    p_product_id: data.product_id,
    p_location_id: data.location_id,
    p_new_qty: data.new_qty,
    p_note: data.note ?? null,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateStock(data.product_id)
  // A null id means the count matched what was already on file, so no ledger
  // entry was written. Worth saying — silence would read as a failed save.
  return {
    success: true,
    data: movementId === null ? "unchanged" : "adjusted",
  }
}

// Housekeeping: drop every stock row sitting at zero.
//
// Safe to run at any time. A zero row records nothing about quantity, and
// record_stock_movement recreates it on the next receipt via its ON CONFLICT
// arm, so nothing is lost — the ledger keeps the history either way. What it
// does buy is a location that can finally be deleted (the location_id foreign
// key is RESTRICT, and a zero row blocks the delete just as a full one does)
// and a product stock panel that lists only real holdings.
export async function purgeZeroStockLevels(): Promise<ActionResult<number>> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("inventory_levels")
    .delete({ count: "exact" })
    .eq("qty", 0)

  if (error) return { success: false, error: messageFor(error) }

  // Location names, per-location rows and the delete guard on /locations all
  // shift, so the whole product tree is invalidated rather than one product.
  revalidatePath("/inventory")
  revalidatePath("/locations")
  revalidatePath("/products", "layout")
  return { success: true, data: count ?? 0 }
}

export async function moveStock(input: unknown): Promise<ActionResult> {
  const parsed = moveStockSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("move_stock", {
    p_product_id: data.product_id,
    p_from_location_id: data.from_location_id,
    p_to_location_id: data.to_location_id,
    p_qty: data.qty,
    p_note: data.note ?? null,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateStock(data.product_id)
  return { success: true }
}
