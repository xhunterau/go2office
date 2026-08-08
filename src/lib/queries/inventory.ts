import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import {
  escapeLike,
  positiveIntParam,
  textParam,
} from "@/lib/queries/search-params"

export const INVENTORY_PAGE_SIZE = 20

// How many ledger entries the detail page shows before "see all".
export const MOVEMENT_HISTORY_LIMIT = 20

// One row of the /inventory list: a product with its stock rolled up across
// locations. Sourced from product_list_pricing, which already carries on_hand
// alongside the identifying columns the table renders.
export type InventoryListRow = Pick<
  Database["public"]["Views"]["product_list_pricing"]["Row"],
  "id" | "sku" | "name" | "image_url" | "is_active" | "is_kit" | "on_hand"
> & {
  // Which locations hold the units, joined for display. Null when none do.
  location_names: string | null
  // The same holdings unrolled, so a row can be received, dispatched, moved or
  // counted in place without a round trip per row when the menu opens.
  lines: ProductStockLine[]
}

const LIST_COLUMNS = "id, sku, name, image_url, is_active, is_kit, on_hand"

export type StockStatus = "in_stock" | "out_of_stock"

// URL value for "no stock filter at all". Needed because an absent status now
// means the default view (in stock only), so showing everything has to be said
// explicitly rather than by omission.
export const STOCK_STATUS_ALL = "all"

export type InventoryFilters = {
  sku: string | null
  name: string | null
  locationId: number | null
  status: StockStatus | null
  page: number
}

export function parseInventoryFilters(
  params: Record<string, string | string[] | undefined>
): InventoryFilters {
  const text = (key: string) => textParam(params, key)
  const numeric = (key: string) => positiveIntParam(params, key)

  // Default view is "in stock". Two thirds of the catalogue sits at zero — most
  // of it never received rather than sold out — so an unfiltered list buries
  // the stock this page exists to show. `status=all` opts back into everything.
  const statusRaw = text("status")
  const status: StockStatus | null =
    statusRaw === "out_of_stock"
      ? "out_of_stock"
      : statusRaw === STOCK_STATUS_ALL
        ? null
        : "in_stock"

  return {
    sku: text("sku"),
    name: text("name"),
    locationId: numeric("locationId"),
    status,
    page: numeric("page") ?? 1,
  }
}

export async function fetchInventoryList(
  supabase: SupabaseClient<Database>,
  filters: InventoryFilters
): Promise<{ rows: InventoryListRow[]; count: number; error: string | null }> {
  // Filtering by location cannot be expressed against the rolled-up view, so it
  // is resolved first into the set of products stored there. Only locations
  // holding a positive quantity count — a row at zero records where a product
  // belongs, not what is actually there to pick.
  let productIds: number[] | null = null
  if (filters.locationId !== null) {
    const { data, error } = await supabase
      .from("inventory_levels")
      .select("product_id")
      .eq("location_id", filters.locationId)
      .gt("qty", 0)

    if (error) return { rows: [], count: 0, error: error.message }
    productIds = (data ?? []).map((row) => row.product_id)

    // No products in that location: return early rather than send an empty
    // `in.()` filter, which PostgREST rejects.
    if (productIds.length === 0) return { rows: [], count: 0, error: null }
  }

  let query = supabase
    .from("product_list_pricing")
    .select(LIST_COLUMNS, { count: "exact" })
    // Kits are barred from holding stock (migration 20260801130000), so they
    // would only ever show as a wall of zeroes here.
    .eq("is_kit", false)
    .order("on_hand", { ascending: false })
    .order("id", { ascending: false })

  if (filters.sku) query = query.ilike("sku", `%${escapeLike(filters.sku)}%`)
  if (filters.name) query = query.ilike("name", `%${escapeLike(filters.name)}%`)
  if (productIds !== null) query = query.in("id", productIds)
  if (filters.status === "in_stock") query = query.gt("on_hand", 0)
  if (filters.status === "out_of_stock") query = query.eq("on_hand", 0)

  const from = (filters.page - 1) * INVENTORY_PAGE_SIZE
  const to = from + INVENTORY_PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) return { rows: [], count: 0, error: error.message }

  const page = data ?? []
  if (page.length === 0) return { rows: [], count: count ?? 0, error: null }

  // Per-location holdings for the 20 rows on screen. Read from inventory_levels
  // rather than product_stock because the row menu acts on a single location:
  // the rolled-up view only carries the joined names, which cannot be dispatched
  // or counted against. The names are derived from these lines instead, so this
  // stays one extra round trip rather than two.
  const { data: stock, error: stockError } = await supabase
    .from("inventory_levels")
    .select("id, product_id, location_id, qty, locations(name)")
    .in(
      "product_id",
      page.map((row) => row.id)
    )

  if (stockError) return { rows: [], count: 0, error: stockError.message }

  const linesByProduct = new Map<number, ProductStockLine[]>()
  for (const row of stock ?? []) {
    const embedded = row as typeof row & { locations: { name: string } | null }
    const lines = linesByProduct.get(row.product_id) ?? []
    lines.push(toStockLine(embedded))
    linesByProduct.set(row.product_id, lines)
  }
  for (const lines of linesByProduct.values()) lines.sort(byLocationName)

  return {
    rows: page.map((row) => {
      const lines = linesByProduct.get(row.id) ?? []
      // Mirrors product_stock.location_names, filter included: a location
      // holding zero records where the product belongs, not what is there to
      // pick, so it is not named.
      const names = lines
        .filter((line) => line.qty > 0)
        .map((line) => line.location_name)
        .join(", ")

      return { ...row, location_names: names || null, lines }
    }) as InventoryListRow[],
    count: count ?? 0,
    error: null,
  }
}

// How many stock rows sit at exactly zero. Drives the "Clear Zero Rows" button
// on the inventory list: these rows hold nothing, yet each one still pins a
// product to a location and blocks that location from being deleted, because
// inventory_levels.location_id is ON DELETE RESTRICT.
export async function countZeroStockLevels(
  supabase: SupabaseClient<Database>
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await supabase
    .from("inventory_levels")
    .select("id", { count: "exact", head: true })
    .eq("qty", 0)

  if (error) return { count: 0, error: error.message }
  return { count: count ?? 0, error: null }
}

// A product's stock in one location, for the detail page table.
export type ProductStockLine = {
  id: number
  location_id: number
  location_name: string
  qty: number
}

// Flatten one inventory_levels row with its location embedded. Shared so the
// list and the detail page describe a holding the same way.
function toStockLine(row: {
  id: number
  location_id: number
  qty: number
  locations: { name: string } | null
}): ProductStockLine {
  return {
    id: row.id,
    location_id: row.location_id,
    location_name: row.locations?.name ?? `#${row.location_id}`,
    qty: row.qty,
  }
}

// Sorted in JS: ordering on an embedded resource is not something PostgREST can
// do from the parent table.
function byLocationName(a: ProductStockLine, b: ProductStockLine): number {
  return a.location_name.localeCompare(b.location_name)
}

export async function fetchProductStockLines(
  supabase: SupabaseClient<Database>,
  productId: number
): Promise<{ lines: ProductStockLine[]; error: string | null }> {
  const { data, error } = await supabase
    .from("inventory_levels")
    .select("id, location_id, qty, locations(name)")
    .eq("product_id", productId)

  if (error) return { lines: [], error: error.message }

  const lines = (data ?? []).map((row) =>
    toStockLine(row as typeof row & { locations: { name: string } | null })
  )
  lines.sort(byLocationName)

  return { lines, error: null }
}

export type MovementRow = {
  id: number
  kind: Database["public"]["Enums"]["stock_movement_kind"]
  qty_delta: number
  qty_after: number
  note: string | null
  created_at: string
  location_name: string
  counterpart_location_name: string | null
}

export async function fetchProductMovements(
  supabase: SupabaseClient<Database>,
  productId: number,
  limit: number = MOVEMENT_HISTORY_LIMIT
): Promise<{ movements: MovementRow[]; error: string | null }> {
  // Two foreign keys point at locations, so each embed has to name the
  // constraint it follows or PostgREST cannot tell them apart.
  //
  // Written as one literal rather than concatenated pieces on purpose:
  // supabase-js infers the row type by parsing this string at the type level,
  // and a concatenation collapses to `string`, which types the result as an
  // error instead.
  const { data, error } = await supabase
    .from("inventory_movements")
    .select(
      "id, kind, qty_delta, qty_after, note, created_at, location:locations!inventory_movements_location_id_fkey(name), counterpart:locations!inventory_movements_counterpart_location_id_fkey(name)"
    )
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)

  if (error) return { movements: [], error: error.message }

  const movements = (data ?? []).map((row) => {
    const embedded = row as typeof row & {
      location: { name: string } | null
      counterpart: { name: string } | null
    }
    return {
      id: row.id,
      kind: row.kind,
      qty_delta: row.qty_delta,
      qty_after: row.qty_after,
      note: row.note,
      created_at: row.created_at,
      location_name: embedded.location?.name ?? "—",
      counterpart_location_name: embedded.counterpart?.name ?? null,
    }
  })

  return { movements, error: null }
}

// A gap in the timeline: one past prune, summarised. Read from
// inventory_movement_prunes, which the prune function writes and nothing else
// can (migration 20260802100000).
export type MovementPruneRow = Pick<
  Database["public"]["Tables"]["inventory_movement_prunes"]["Row"],
  | "id"
  | "kept"
  | "deleted_count"
  | "qty_in"
  | "qty_out"
  | "first_at"
  | "last_at"
  | "pruned_at"
>

// Enough to explain why a timeline is short without turning the panel into a
// list of housekeeping. The full record is in the table for anyone who needs it.
export const PRUNE_NOTE_LIMIT = 5

export async function fetchProductPrunes(
  supabase: SupabaseClient<Database>,
  productId: number,
  limit: number = PRUNE_NOTE_LIMIT
): Promise<{ prunes: MovementPruneRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("inventory_movement_prunes")
    .select(
      "id, kept, deleted_count, qty_in, qty_out, first_at, last_at, pruned_at"
    )
    .eq("product_id", productId)
    .order("pruned_at", { ascending: false })
    .limit(limit)

  if (error) return { prunes: [], error: error.message }
  return { prunes: data ?? [], error: null }
}

// What the history block needs: the surviving movements, plus a note for each
// stretch that was deleted. Fetched together because showing one without the
// other misleads — a short timeline reads as "nothing happened" when the truth
// is "the record was cleared".
export async function fetchProductHistory(
  supabase: SupabaseClient<Database>,
  productId: number
): Promise<{
  movements: MovementRow[]
  prunes: MovementPruneRow[]
  error: string | null
}> {
  const [movements, prunes] = await Promise.all([
    fetchProductMovements(supabase, productId),
    fetchProductPrunes(supabase, productId),
  ])

  return {
    movements: movements.movements,
    prunes: prunes.prunes,
    error: movements.error ?? prunes.error,
  }
}
