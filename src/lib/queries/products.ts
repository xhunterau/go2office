import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import {
  escapeLike,
  positiveIntParam,
  textParam,
} from "@/lib/queries/search-params"

export const PRODUCTS_PAGE_SIZE = 20

// Below this GST-exclusive margin an imported item stops reliably covering
// per-order fulfilment overhead. Used to tint the list and as the default for
// the "low margin" filter — a warning, never a block.
export const LOW_MARGIN_THRESHOLD = 30

// Columns fetched for the list view (kept narrow — no heavy text columns).
const LIST_COLUMNS =
  "id, sku, name, retail_price, image_url, is_active, is_kit, brand_id, brand_name, unit_cost_aud, retail_margin_pct, on_hand"

// A single row as returned by the list query. Sourced from
// public.product_list_pricing, which flattens the brand name and attaches cost
// figures; kits appear with null cost columns rather than being dropped.
export type ProductListRow = Pick<
  Database["public"]["Views"]["product_list_pricing"]["Row"],
  | "id"
  | "sku"
  | "name"
  | "retail_price"
  | "image_url"
  | "is_active"
  | "is_kit"
  | "brand_id"
  | "brand_name"
  | "unit_cost_aud"
  | "retail_margin_pct"
  | "on_hand"
>

// Lookup options for the brand / origin / supplier selects. Shared by the list
// page (filters + create dialog) and the detail page (section edit dialog).
export type ProductLookupOptions = {
  brands: { id: number; name: string | null }[]
  origins: { id: number; name: string | null }[]
  suppliers: { id: number; company_name: string | null }[]
  error: string | null
}

export async function fetchProductLookupOptions(
  supabase: SupabaseClient<Database>
): Promise<ProductLookupOptions> {
  const [brands, suppliers, origins] = await Promise.all([
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("suppliers").select("id, company_name").order("company_name"),
    supabase.from("origins").select("id, name").order("name"),
  ])

  return {
    brands: brands.data ?? [],
    origins: origins.data ?? [],
    suppliers: suppliers.data ?? [],
    error:
      brands.error?.message ??
      suppliers.error?.message ??
      origins.error?.message ??
      null,
  }
}

// Parsed, validated filter state — the single source of truth shared by the
// server query and the client filter UI. `null` means "no filter".
export type ProductFilters = {
  sku: string | null
  name: string | null
  upc: string | null
  model: string | null
  brandId: number | null
  supplierId: number | null
  status: "active" | "inactive" | null
  isKit: boolean | null
  // Upper bound on retail margin %, for finding products priced too thin.
  maxMargin: number | null
  page: number
}

// Parse raw URL search params into a typed, sanitized filter object.
// Invalid/empty values collapse to null so they never reach the query.
export function parseProductFilters(
  params: Record<string, string | string[] | undefined>
): ProductFilters {
  const text = (key: string) => textParam(params, key)
  const numeric = (key: string) => positiveIntParam(params, key)

  const statusRaw = text("status")
  const status =
    statusRaw === "active" || statusRaw === "inactive" ? statusRaw : null

  const kitRaw = text("isKit")
  const isKit = kitRaw === "yes" ? true : kitRaw === "no" ? false : null

  // Margin is a percentage and may legitimately be 0 or negative, so it cannot
  // reuse `numeric` (which requires a positive integer).
  const marginRaw = text("maxMargin")
  const marginParsed = marginRaw === null ? Number.NaN : Number(marginRaw)
  const maxMargin = Number.isFinite(marginParsed) ? marginParsed : null

  const pageRaw = numeric("page")

  return {
    sku: text("sku"),
    name: text("name"),
    upc: text("upc"),
    model: text("model"),
    brandId: numeric("brandId"),
    supplierId: numeric("supplierId"),
    status,
    isKit,
    maxMargin,
    page: pageRaw ?? 1,
  }
}

// Build and execute the paginated, filtered products list query.
// Returns the current page rows plus the total matching count.
export async function fetchProductList(
  supabase: SupabaseClient<Database>,
  filters: ProductFilters
): Promise<{ rows: ProductListRow[]; count: number; error: string | null }> {
  // Newest first: order by created_at (nulls last so rows missing a timestamp
  // never float to the top), with id DESC as a stable tiebreaker. Since id is a
  // monotonic autoincrement, it reliably reflects creation order.
  let query = supabase
    .from("product_list_pricing")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })

  if (filters.sku) query = query.ilike("sku", `%${escapeLike(filters.sku)}%`)
  if (filters.name) query = query.ilike("name", `%${escapeLike(filters.name)}%`)
  if (filters.upc) query = query.ilike("upc", `%${escapeLike(filters.upc)}%`)
  if (filters.model)
    query = query.ilike("model", `%${escapeLike(filters.model)}%`)
  if (filters.brandId !== null) query = query.eq("brand_id", filters.brandId)
  if (filters.supplierId !== null)
    query = query.eq("supplier_id", filters.supplierId)
  if (filters.status !== null)
    query = query.eq("is_active", filters.status === "active")
  if (filters.isKit !== null) query = query.eq("is_kit", filters.isKit)
  // `lt` on a nullable column excludes NULLs, so kits and products with no cost
  // drop out of a margin search — which is what you want: they have no margin to
  // be below the threshold.
  if (filters.maxMargin !== null)
    query = query.lt("retail_margin_pct", filters.maxMargin)

  const from = (filters.page - 1) * PRODUCTS_PAGE_SIZE
  const to = from + PRODUCTS_PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    return { rows: [], count: 0, error: error.message }
  }

  return {
    rows: (data ?? []) as ProductListRow[],
    count: count ?? 0,
    error: null,
  }
}
