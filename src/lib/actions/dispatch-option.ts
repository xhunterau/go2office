"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  dispatchOptionSchema,
  toServiceTypeColumn,
  type DispatchOptionInput,
} from "@/lib/validations/shipping-reference"
import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/settings/shipping/dispatch-options"

// This table is the engine's entry point: a shipping method with no row here is
// never quoted, whatever rates exist behind it. Deactivating a row is therefore
// the switch that takes an option out of every future quote.

function payloadFrom(parsed: ReturnType<typeof dispatchOptionSchema.parse>) {
  return {
    shipping_method: parsed.shipping_method,
    carrier_id: parsed.carrier_id,
    billing_weight_mode: parsed.billing_weight_mode,
    service_type: toServiceTypeColumn(parsed.service_type),
    fixed_price_aud: parsed.fixed_price_aud,
    max_order_total_aud: parsed.max_order_total_aud,
    max_packed_thickness_mm: parsed.max_packed_thickness_mm,
    max_packed_length_mm: parsed.max_packed_length_mm,
    max_packed_width_mm: parsed.max_packed_width_mm,
    is_active: parsed.is_active,
  }
}

export async function createDispatchOption(
  input: DispatchOptionInput
): Promise<ActionResult> {
  const parsed = dispatchOptionSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("carrier_dispatch_options")
    .insert(payloadFrom(parsed.data))

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

export async function updateDispatchOption(
  id: number,
  input: DispatchOptionInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid dispatch option" }
  }

  const parsed = dispatchOptionSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("carrier_dispatch_options")
    .update(payloadFrom(parsed.data))
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Dispatch option not found" }

  revalidatePath(PATH)
  return { success: true }
}

export async function deleteDispatchOption(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid dispatch option" }
  }

  const supabase = await createClient()
  const { data: deleted, error } = await supabase
    .from("carrier_dispatch_options")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!deleted) return { success: false, error: "Dispatch option not found" }

  revalidatePath(PATH)
  return { success: true }
}

function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    return "That shipping method already has a dispatch option — edit the existing one."
  }
  if (isCheckViolation(error)) {
    if (error.message?.includes("service_type_lower")) {
      return "Service type must be lowercase."
    }
    if (error.message?.includes("weight_mode")) {
      return "Billing weight must be either chargeable or actual."
    }
  }
  return error.message ?? "Something went wrong"
}
