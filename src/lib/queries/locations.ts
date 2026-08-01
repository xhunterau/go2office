import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

export type LocationRow = Database["public"]["Tables"]["locations"]["Row"]

// A location plus how many products sit in it. The count drives both the list
// column and the delete confirmation copy, because the location_id foreign key
// is RESTRICT: a location holding any stock row — including one sitting at
// zero — cannot be deleted.
export type LocationListRow = LocationRow & {
  product_count: number
}

// Options for the location selects on the stock dialogs.
export type LocationOption = Pick<LocationRow, "id" | "name">

export async function fetchLocations(
  supabase: SupabaseClient<Database>
): Promise<{ rows: LocationListRow[]; error: string | null }> {
  // The embedded aggregate is PostgREST's count syntax; it resolves the
  // inventory_levels foreign key, so no second round trip per row.
  const { data, error } = await supabase
    .from("locations")
    .select("*, inventory_levels(count)")
    .order("name")

  if (error) return { rows: [], error: error.message }

  const rows = (data ?? []).map((row) => {
    const { inventory_levels, ...location } = row as LocationRow & {
      inventory_levels: { count: number }[]
    }
    return {
      ...location,
      product_count: inventory_levels?.[0]?.count ?? 0,
    }
  })

  return { rows, error: null }
}

export async function fetchLocationOptions(
  supabase: SupabaseClient<Database>
): Promise<{ options: LocationOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name")
    .order("name")

  if (error) return { options: [], error: error.message }
  return { options: data ?? [], error: null }
}
