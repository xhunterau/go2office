"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  shippingSettingsSchema,
  type ShippingSettingsInput,
} from "@/lib/validations/shipping-reference"
import { isCheckViolation, type ActionResult } from "@/lib/actions/action-result"

export async function updateShippingSettings(
  input: ShippingSettingsInput
): Promise<ActionResult> {
  const parsed = shippingSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // Always row 1 -- the table has a CHECK (id = 1) and neither an insert nor a
  // delete policy.
  const { data: updated, error } = await supabase
    .from("shipping_settings")
    .update(parsed.data)
    .eq("id", 1)
    // Reading the row back is what makes a blocked write visible: RLS refuses an
    // UPDATE by filtering the row away, not by raising, so without this a
    // rejected save would report success (CLAUDE.md rule 22).
    .select("id")
    .maybeSingle()

  if (error) {
    if (isCheckViolation(error)) {
      return {
        success: false,
        error: "One of the values is outside the range the database allows.",
      }
    }
    return { success: false, error: error.message }
  }
  if (!updated) {
    return { success: false, error: "The shipping settings row is missing." }
  }

  revalidatePath("/settings/shipping/constants")
  return { success: true }
}
