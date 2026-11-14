"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/actions/action-result"
import { createClient } from "@/lib/supabase/server"
import {
  debugSettingSchema,
  type DebugSettingInput,
} from "@/lib/validations/debug-setting"

export async function updateDebugSetting(input: DebugSettingInput): Promise<ActionResult> {
  const parsed = debugSettingSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  const { key, enabled, value } = parsed.data
  const { data: updated, error } = await supabase
    .from("debug_settings")
    // Only these three columns are granted; the policy's WITH CHECK requires
    // updated_by to be the caller.
    .update({ enabled, value, updated_by: user.id })
    .eq("key", key)
    // RLS refuses an UPDATE by matching no rows, not by raising (rule 22).
    .select("key")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!updated) return { success: false, error: "This setting no longer exists" }

  revalidatePath("/settings/debug")
  // The import button shows when a test order is in force.
  revalidatePath("/orders")
  return { success: true }
}
