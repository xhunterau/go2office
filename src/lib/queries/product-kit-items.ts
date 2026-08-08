import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { orLikePattern } from "@/lib/queries/search-params"

// product_kit_items has two foreign keys to products, so every embed must name
// the constraint it travels — PostgREST cannot guess which one is meant.
const COMPONENT_FK = "product_kit_items_component_product_id_fkey"
const KIT_FK = "product_kit_items_kit_product_id_fkey"

const KIT_ITEM_COLUMNS = `id, kit_product_id, component_product_id, qty, component:products!${COMPONENT_FK}(id, sku, name, image_url, purchase_price, retail_price, currency, is_active)`

const KIT_PARENT_COLUMNS = `id, kit_product_id, component_product_id, qty, kit:products!${KIT_FK}(id, sku, name, image_url, is_active)`

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

// The kit side of a composition line, for the reverse ("Used In") lookup.
export type KitParentProduct = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "sku" | "name" | "image_url" | "is_active"
>

// One composition line seen from the component's side: which kit uses it, and
// how many units that kit takes.
export type ProductKitParent = Pick<
  Database["public"]["Tables"]["product_kit_items"]["Row"],
  "id" | "kit_product_id" | "component_product_id" | "qty"
> & {
  kit: KitParentProduct | null
}

// A candidate for the "Add component" picker.
export type KitCandidate = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "sku" | "name" | "image_url"
>

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

// The reverse of fetchProductKitItems: every kit this product is a component
// of. Backed by product_kit_items_component_product_id_idx, so it stays cheap
// even though it is run for every product, kit or not.
export async function fetchKitsContainingProduct(
  supabase: SupabaseClient<Database>,
  componentProductId: number
): Promise<{ parents: ProductKitParent[]; error: string | null }> {
  const { data, error } = await supabase
    .from("product_kit_items")
    .select(KIT_PARENT_COLUMNS)
    .eq("component_product_id", componentProductId)
    .order("kit_product_id")

  if (error) return { parents: [], error: error.message }

  return { parents: (data ?? []) as unknown as ProductKitParent[], error: null }
}

// Products that may still be added to this kit: matched on SKU or name, with
// the kit itself and everything already in it filtered out (the DB rejects both
// cases anyway — this keeps them out of the picker in the first place).
//
// Kits and inactive products are excluded as well. product_cost_kit does not
// expand nested kits: a kit used as a component has no product_cost_base row,
// which trips the "every component must have a cost" guard and silently blanks
// out the parent kit's whole pricing. Excluding kits here also makes a
// reference cycle unreachable, since a component can then never own components
// of its own. assertUsableComponent() in the Server Action enforces the same
// two rules — this is only the picker half.
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
    .eq("is_kit", false)
    .eq("is_active", true)
    .order("sku")
    .limit(KIT_CANDIDATE_LIMIT)

  const term = keyword.trim()
  if (term) {
    const pattern = orLikePattern(term)
    query = query.or(`sku.ilike.${pattern},name.ilike.${pattern}`)
  }

  const { data, error } = await query

  if (error) return { candidates: [], error: error.message }

  return { candidates: data ?? [], error: null }
}
