import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { AU_STATES, NO_STATE } from "@/lib/validations/postcode"
import {
  enumParam,
  escapeLike,
  positiveIntParam,
  textParam,
  type SearchParams,
} from "@/lib/queries/search-params"

export const POSTCODES_PAGE_SIZE = 20

export type PostcodeRow = Database["public"]["Tables"]["postcodes"]["Row"]

export type PostcodeFilters = {
  postcode: string | null
  locality: string | null
  // A state code, or NO_STATE for the 136 alias localities that have none.
  state: string | null
  page: number
}

const STATE_OPTIONS = [...AU_STATES, NO_STATE] as const

export function parsePostcodeFilters(params: SearchParams): PostcodeFilters {
  return {
    postcode: textParam(params, "postcode"),
    locality: textParam(params, "locality"),
    state: enumParam(params, "state", STATE_OPTIONS),
    page: positiveIntParam(params, "page") ?? 1,
  }
}

export type PostcodeListResult = {
  rows: PostcodeRow[]
  count: number
  error: string | null
}

export async function fetchPostcodeList(
  supabase: SupabaseClient<Database>,
  filters: PostcodeFilters
): Promise<PostcodeListResult> {
  // Exact, unlike the orders and customers lists: 16712 rows is small enough to
  // tally on every page change, and an exact total is what makes the last page
  // reachable.
  let query = supabase
    .from("postcodes")
    .select("*", { count: "exact" })
    // The lookup key, so it is also the reading order: a postcode's localities
    // sit together.
    .order("postcode", { ascending: true })
    .order("locality", { ascending: true })

  // Prefix, matched as typed rather than zero-padded. Padding the search term
  // would make '08' (all of NT) unsearchable in exchange for making '800' find
  // DARWIN, and the prefix is the more useful of the two.
  if (filters.postcode) {
    query = query.like("postcode", `${escapeLike(filters.postcode)}%`)
  }
  // Rows are uppercase by CHECK constraint, but the box is not, so this stays
  // case-insensitive.
  if (filters.locality) {
    query = query.ilike("locality", `%${escapeLike(filters.locality)}%`)
  }
  if (filters.state) {
    query =
      filters.state === NO_STATE
        ? query.is("state", null)
        : query.eq("state", filters.state)
  }

  const from = (filters.page - 1) * POSTCODES_PAGE_SIZE
  const to = from + POSTCODES_PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)
  if (error) return { rows: [], count: 0, error: error.message }

  return { rows: data ?? [], count: count ?? 0, error: null }
}
