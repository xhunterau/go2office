import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

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

// Escape PostgREST `ilike` wildcards so user input is matched literally.
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`)
}

export function parseInventoryFilters(
  params: Record<string, string | string[] | undefined>
): InventoryFilters {
  const text = (key: string): string | null => {
    const raw = params[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    return value ? value : null
  }

  const numeric = (key: string): number | null => {
    const value = text(key)
    if (!value) return null
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

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

  // Location names live in product_stock rather than product_list_pricing: the
  // products list has no use for them, and widening a shared view to serve one
  // column on one page is not worth it. One extra round trip for the 20 rows on
  // screen is cheaper than that coupling.
  const { data: stock, error: stockError } = await supabase
    .from("product_stock")
    .select("product_id, location_names")
    .in(
      "product_id",
      page.map((row) => row.id)
    )

  if (stockError) return { rows: [], count: 0, error: stockError.message }

  const namesByProduct = new Map(
    (stock ?? []).map((row) => [row.product_id, row.location_names])
  )

  return {
    rows: page.map((row) => ({
      ...row,
      location_names: namesByProduct.get(row.id) ?? null,
    })) as InventoryListRow[],
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

export async function fetchProductStockLines(
  supabase: SupabaseClient<Database>,
  productId: number
): Promise<{ lines: ProductStockLine[]; error: string | null }> {
  const { data, error } = await supabase
    .from("inventory_levels")
    .select("id, location_id, qty, locations(name)")
    .eq("product_id", productId)

  if (error) return { lines: [], error: error.message }

  const lines = (data ?? []).map((row) => {
    const embedded = row as typeof row & { locations: { name: string } | null }
    return {
      id: row.id,
      location_id: row.location_id,
      location_name: embedded.locations?.name ?? `#${row.location_id}`,
      qty: row.qty,
    }
  })

  // Sorted by location name in JS: ordering on an embedded resource is not
  // something PostgREST can do from the parent table.
  lines.sort((a, b) => a.location_name.localeCompare(b.location_name))

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
