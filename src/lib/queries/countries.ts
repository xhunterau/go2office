import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

export type CountryRow = Database["public"]["Tables"]["countries"]["Row"]

export type CountryListResult = {
  rows: CountryRow[]
  error: string | null
}

// No filters, no pagination and no count -- unlike every other list in the app.
// This table holds the destinations the business has actually shipped to (seven
// rows on import) and is meant to stay that size; a filter bar over seven rows
// is a control the reader has to look past to reach the data. If it ever grows
// past a screenful, that is the moment to reconsider, not before.
export async function fetchCountryList(
  supabase: SupabaseClient<Database>
): Promise<CountryListResult> {
  const { data, error } = await supabase
    .from("countries")
    .select("*")
    // By name, because that is the column a reader scans. The code is the key
    // the standardiser writes, but nobody looks a country up by 'CA'.
    .order("country_name", { ascending: true })

  if (error) return { rows: [], error: error.message }

  return { rows: data ?? [], error: null }
}
