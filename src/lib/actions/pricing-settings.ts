"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  pricingSettingsSchema,
  type PricingSettingsInput,
} from "@/lib/validations/pricing-settings"
import { isCheckViolation, type ActionResult } from "@/lib/actions/action-result"

export async function updatePricingSettings(
  input: PricingSettingsInput
): Promise<ActionResult> {
  const parsed = pricingSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // Always row 1 — the table has a CHECK (id = 1) and no insert policy.
  const { error } = await supabase
    .from("pricing_settings")
    .update(parsed.data)
    .eq("id", 1)

  if (error) {
    if (isCheckViolation(error)) {
      return {
        success: false,
        error: "One of the values is outside the range the database allows.",
      }
    }
    return { success: false, error: error.message }
  }

  // These constants feed every landed cost in the app, so the products pages
  // must be re-rendered, not just the settings page.
  revalidatePath("/settings")
  revalidatePath("/products", "layout")
  return { success: true }
}
