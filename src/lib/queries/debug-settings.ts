import type { SupabaseClient } from "@supabase/supabase-js"

import type { DebugSettingKey } from "@/lib/debug/settings"
import type { Database } from "@/lib/supabase/database.types"

export type DebugSettingRow = Database["public"]["Tables"]["debug_settings"]["Row"]

export async function fetchDebugSettings(
  supabase: SupabaseClient<Database>
): Promise<{ rows: DebugSettingRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("debug_settings")
    .select("*")
    .order("key", { ascending: true })

  if (error) return { rows: [], error: error.message }
  return { rows: data ?? [], error: null }
}

/**
 * The override in force for one key: its value while the switch is on and the
 * value is not blank, otherwise null.
 *
 * A failed read is returned as an error, not as "off". For the Shopify import
 * "off" means every unshipped order, so treating an unreadable switch as off
 * would turn a one-order test run into the full import.
 */
export async function activeDebugValue(
  supabase: SupabaseClient<Database>,
  key: DebugSettingKey
): Promise<{ value: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("debug_settings")
    .select("enabled, value")
    .eq("key", key)
    .maybeSingle()

  if (error) return { value: null, error: error.message }
  const value = data?.enabled ? data.value.trim() : ""
  return { value: value || null, error: null }
}
