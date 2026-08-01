"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  kitItemCreateSchema,
  kitItemQtySchema,
} from "@/lib/validations/product-kit-item"
import {
  searchKitCandidates,
  type KitCandidate,
} from "@/lib/queries/product-kit-items"

const PATH = "/products"

// Both the list badge and the detail page show kit information, so every
// mutation refreshes the kit's own detail route plus the list. The component
// carries the relationship too — its "Used In" tab is the reverse of the kit's
// Kit Components tab — so its route is refreshed alongside.
function revalidateKit(kitProductId: number, componentProductId: number): void {
  revalidatePath(PATH)
  revalidatePath(`${PATH}/${kitProductId}`)
  revalidatePath(`${PATH}/${componentProductId}`)
}

// Translate the constraints declared in migration 20260725110000 into messages
// the user can act on.
function messageFor(error: { code?: string; message: string }): string {
  if (isUniqueViolation(error)) {
    return "This product is already a component of this kit."
  }
  if (isForeignKeyViolation(error)) {
    return "The kit or the selected component no longer exists."
  }
  if (isCheckViolation(error)) {
    return "Invalid component: the quantity must be greater than 0 and a kit cannot contain itself."
  }
  return error.message
}

function invalidId(value: number): boolean {
  return !Number.isInteger(value) || value <= 0
}

// The server half of the picker's filters (searchKitCandidates applies the same
// two rules): a component must be an ordinary, active product.
//
// Rejecting kits is what keeps pricing correct — product_cost_kit does not
// expand nested kits, so one kit inside another leaves the parent with no
// rolled-up cost at all — and it is also what makes a reference cycle
// impossible: a non-kit owns no components, so no path can lead back.
//
// Returns null when the component is usable, or the message to show otherwise.
async function assertUsableComponent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  componentProductId: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("products")
    .select("is_kit, is_active")
    .eq("id", componentProductId)
    .maybeSingle()

  if (error) return error.message
  if (!data) return "The selected component no longer exists."
  if (data.is_kit) {
    return "A kit cannot be used as a component of another kit."
  }
  if (!data.is_active) {
    return "Inactive products cannot be added to a kit."
  }
  return null
}

export async function addKitItem(input: unknown): Promise<ActionResult> {
  const parsed = kitItemCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()

  const rejection = await assertUsableComponent(
    supabase,
    data.component_product_id
  )
  if (rejection) return { success: false, error: rejection }

  // created_at/updated_at come from the DB defaults + moddatetime trigger
  // (migration 20260725110000), so they are never set here.
  const { error } = await supabase.from("product_kit_items").insert({
    kit_product_id: data.kit_product_id,
    component_product_id: data.component_product_id,
    qty: data.qty,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateKit(data.kit_product_id, data.component_product_id)
  return { success: true }
}

// The kit id is passed alongside the line id and used as a filter, so a request
// can only touch a line that really belongs to the kit it claims.
export async function updateKitItemQty(
  id: number,
  kitProductId: number,
  input: unknown
): Promise<ActionResult> {
  if (invalidId(id) || invalidId(kitProductId)) {
    return { success: false, error: "Invalid kit component" }
  }

  const parsed = kitItemQtySchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("product_kit_items")
    .update({ qty: parsed.data.qty })
    .eq("id", id)
    .eq("kit_product_id", kitProductId)
    .select("id, component_product_id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Kit component not found" }

  revalidateKit(kitProductId, updated.component_product_id)
  return { success: true }
}

export async function removeKitItem(
  id: number,
  kitProductId: number
): Promise<ActionResult> {
  if (invalidId(id) || invalidId(kitProductId)) {
    return { success: false, error: "Invalid kit component" }
  }

  const supabase = await createClient()
  const { data: deleted, error } = await supabase
    .from("product_kit_items")
    .delete()
    .eq("id", id)
    .eq("kit_product_id", kitProductId)
    .select("id, component_product_id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!deleted) return { success: false, error: "Kit component not found" }

  revalidateKit(kitProductId, deleted.component_product_id)
  return { success: true }
}

// Backs the component picker's search box. A Server Action rather than a route
// handler so the picker reuses the same Supabase server client and auth cookie
// handling as the rest of the page.
export async function searchKitCandidatesAction(
  kitProductId: number,
  keyword: string
): Promise<ActionResult<KitCandidate[]>> {
  if (invalidId(kitProductId)) {
    return { success: false, error: "Invalid product id" }
  }

  const supabase = await createClient()
  const { candidates, error } = await searchKitCandidates(
    supabase,
    kitProductId,
    typeof keyword === "string" ? keyword.slice(0, 100) : ""
  )

  if (error) return { success: false, error }
  return { success: true, data: candidates }
}
