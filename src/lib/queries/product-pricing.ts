import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Tables, Views } from "@/lib/supabase/database.types"

export type PricingSettings = Tables<"pricing_settings">
export type ProductPricing = Views<"product_pricing">

export async function fetchPricingSettings(
  supabase: SupabaseClient<Database>
): Promise<{ settings: PricingSettings | null; error: string | null }> {
  // Single row by construction (CHECK (id = 1)), so no ordering is needed.
  const { data, error } = await supabase
    .from("pricing_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle()

  return { settings: data ?? null, error: error?.message ?? null }
}

export async function fetchProductPricing(
  supabase: SupabaseClient<Database>,
  productId: number
): Promise<{ pricing: ProductPricing | null; error: string | null }> {
  const { data, error } = await supabase
    .from("product_pricing")
    .select("*")
    .eq("id", productId)
    .maybeSingle()

  // Kits are included: the view rolls their cost up from their components. A
  // kit with no components still returns a row, with null cost columns.
  return { pricing: data ?? null, error: error?.message ?? null }
}

// One component line of a kit, with the cost it contributes.
export type KitComponentCost = {
  componentProductId: number
  qty: number
  unitCostAud: number | null
  lineCostAud: number | null
}

/**
 * The per-component cost breakdown behind a kit's rolled-up unit cost.
 *
 * Two round trips rather than one embedded select: `product_kit_items` has no
 * foreign key into `product_pricing`, and PostgREST can only embed across one.
 * A kit holds at most nine components, so the id list stays far short of any
 * URL length concern.
 */
export async function fetchKitComponentCosts(
  supabase: SupabaseClient<Database>,
  kitProductId: number
): Promise<{ costs: KitComponentCost[]; error: string | null }> {
  const { data: items, error: itemsError } = await supabase
    .from("product_kit_items")
    .select("component_product_id, qty")
    .eq("kit_product_id", kitProductId)

  if (itemsError) return { costs: [], error: itemsError.message }
  if (!items || items.length === 0) return { costs: [], error: null }

  const { data: pricing, error: pricingError } = await supabase
    .from("product_pricing")
    .select("id, unit_cost_aud")
    .in(
      "id",
      items.map((item) => item.component_product_id)
    )

  if (pricingError) return { costs: [], error: pricingError.message }

  const unitCostById = new Map(
    (pricing ?? []).map((row) => [row.id, row.unit_cost_aud])
  )

  return {
    costs: items.map((item) => {
      // Undefined means the component has no row at all — it is itself a kit,
      // which the roll-up does not expand. Null means it has a row but no cost.
      // Both leave the kit without a total, so both collapse to null here.
      const unitCost = unitCostById.get(item.component_product_id) ?? null
      return {
        componentProductId: item.component_product_id,
        qty: item.qty,
        unitCostAud: unitCost,
        lineCostAud: unitCost === null ? null : unitCost * item.qty,
      }
    }),
    error: null,
  }
}
