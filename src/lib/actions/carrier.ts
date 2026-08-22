"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  carrierCreateSchema,
  carrierUpdateSchema,
  type CarrierCreateInput,
  type CarrierUpdateInput,
} from "@/lib/validations/shipping-reference"
import { isUniqueViolation, type ActionResult } from "@/lib/actions/action-result"

const PATH = "/settings/shipping/carriers"

export async function createCarrier(
  input: CarrierCreateInput
): Promise<ActionResult> {
  const parsed = carrierCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("carriers").insert(parsed.data)

  if (error) {
    if (isUniqueViolation(error)) {
      return { success: false, error: "That carrier code is already taken." }
    }
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}

// `code` is absent from the payload by design, and the database agrees: the
// column-level grant from 20260812100000 rejects an UPDATE that touches it. A
// carrier's code is what CARRIER_CAPABILITIES keys off, so renaming happens in
// `name`.
export async function updateCarrier(
  id: number,
  input: CarrierUpdateInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid carrier" }
  }

  const parsed = carrierUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("carriers")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!updated) return { success: false, error: "Carrier not found" }

  // A carrier going inactive changes what every future quote considers, so the
  // rate card and dispatch option pages are re-rendered too.
  revalidatePath("/settings/shipping", "layout")
  return { success: true }
}
