import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

// product_kit_items has two foreign keys to products, so every embed must name
// the constraint it travels — PostgREST cannot guess which one is meant.
const COMPONENT_FK = "product_kit_items_component_product_id_fkey"

const KIT_ITEM_COLUMNS = `id, kit_product_id, component_product_id, qty, component:products!${COMPONENT_FK}(id, sku, name, image_url, purchase_price, retail_price, currency, is_active)`

// How many candidates the "Add component" picker shows per search.
export const KIT_CANDIDATE_LIMIT = 20

export type KitComponentProduct = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  | "id"
  | "sku"
  | "name"
  | "image_url"
  | "purchase_price"
  | "retail_price"
  | "currency"
  | "is_active"
>

// One composition line plus the component product it points at.
export type ProductKitItem = Pick<
  Database["public"]["Tables"]["product_kit_items"]["Row"],
  "id" | "kit_product_id" | "component_product_id" | "qty"
> & {
  component: KitComponentProduct | null
}

// A candidate for the "Add component" picker.
export type KitCandidate = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "sku" | "name" | "image_url"
>

// Prepare user input for an `ilike` pattern inside an `or()` filter: drop the
// characters that would break PostgREST's filter grammar (commas, parentheses,
// quotes, backslashes) and escape the LIKE wildcards so they match literally.
function toSearchPattern(value: string): string {
  const cleaned = value.replace(/[,()"\\]/g, "")
  return `%${cleaned.replace(/[%_]/g, (match) => `\\${match}`)}%`
}

// Components of one kit, ordered by component id (the legacy table carries no
// ordering column, so there is no user-defined sort to honour).
export async function fetchProductKitItems(
  supabase: SupabaseClient<Database>,
  kitProductId: number
): Promise<{ items: ProductKitItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("product_kit_items")
    .select(KIT_ITEM_COLUMNS)
    .eq("kit_product_id", kitProductId)
    .order("component_product_id")

  if (error) return { items: [], error: error.message }

  return { items: (data ?? []) as unknown as ProductKitItem[], error: null }
}

// Products that may still be added to this kit: matched on SKU or name, with
// the kit itself and everything already in it filtered out (the DB rejects both
// cases anyway — this keeps them out of the picker in the first place).
export async function searchKitCandidates(
  supabase: SupabaseClient<Database>,
  kitProductId: number,
  keyword: string
): Promise<{ candidates: KitCandidate[]; error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("product_kit_items")
    .select("component_product_id")
    .eq("kit_product_id", kitProductId)

  if (existingError) return { candidates: [], error: existingError.message }

  const excluded = [
    kitProductId,
    ...(existing ?? []).map((row) => row.component_product_id),
  ]

  let query = supabase
    .from("products")
    .select("id, sku, name, image_url")
    .not("id", "in", `(${excluded.join(",")})`)
    .order("sku")
    .limit(KIT_CANDIDATE_LIMIT)

  const term = keyword.trim()
  if (term) {
    const pattern = toSearchPattern(term)
    query = query.or(`sku.ilike.${pattern},name.ilike.${pattern}`)
  }

  const { data, error } = await query

  if (error) return { candidates: [], error: error.message }

  return { candidates: data ?? [], error: null }
}
