"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "node:crypto"

import { createClient } from "@/lib/supabase/server"
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  productCreateSchema,
  DEFAULT_DIMENSION,
  type ProductCreateInput,
} from "@/lib/validations/product"

const PATH = "/products"

// Normalize optional text: empty string -> null so the DB keeps NULLs, not "".
function toNullable(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Compose the SKU from the brand/origin abbreviations and the zero-padded id.
// e.g. abbr "AC" + id 42 + abbr "CN" -> "AC00042CN".
function buildSku(brandAbbr: string, id: number, originAbbr: string): string {
  return `${brandAbbr}${String(id).padStart(5, "0")}${originAbbr}`
}

// Create a product. Because the SKU embeds the auto-generated `id` (which only
// exists after insert) yet the `sku` column is NOT NULL, we write in two steps:
// insert with a unique placeholder to obtain the id, then update with the real
// SKU. On any failure after insert we delete the orphan row (compensating
// rollback) so no placeholder-SKU record is left behind.
export async function createProduct(
  input: ProductCreateInput
): Promise<ActionResult<{ id: number }>> {
  const parsed = productCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }
  const data = parsed.data

  const supabase = await createClient()

  // Both abbreviations are required to build the SKU. Validate they exist and
  // are non-empty before touching the products table.
  const [brandResult, originResult] = await Promise.all([
    supabase.from("brands").select("abbr").eq("id", data.brand_id).maybeSingle(),
    supabase
      .from("origins")
      .select("abbr")
      .eq("id", data.origin_id)
      .maybeSingle(),
  ])

  const brandAbbr = brandResult.data?.abbr?.trim()
  const originAbbr = originResult.data?.abbr?.trim()
  if (!brandAbbr) {
    return {
      success: false,
      error: "The selected brand has no abbreviation set; SKU cannot be generated.",
    }
  }
  if (!originAbbr) {
    return {
      success: false,
      error: "The selected origin has no abbreviation set; SKU cannot be generated.",
    }
  }

  // Step 1: insert with a unique placeholder SKU to obtain the generated id.
  // created_at/updated_at are populated by DB defaults + the moddatetime
  // trigger (see migration 20260719150000), so we never set them here.
  const placeholderSku = `__PENDING__${randomUUID()}`
  const { data: inserted, error: insertError } = await supabase
    .from("products")
    .insert({
      sku: placeholderSku,
      brand_id: data.brand_id,
      origin_id: data.origin_id,
      supplier_id: data.supplier_id,
      name: data.name,
      weight: data.weight,
      currency: data.currency,
      purchase_price: data.purchase_price,
      retail_price: data.retail_price,
      length: data.length ?? DEFAULT_DIMENSION,
      width: data.width ?? DEFAULT_DIMENSION,
      height: data.height ?? DEFAULT_DIMENSION,
      is_gst: false,
      is_active: data.is_active,
      is_kit: data.is_kit,
      model: toNullable(data.model),
      upc: toNullable(data.upc),
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    return {
      success: false,
      error: insertError?.message ?? "Failed to create product",
    }
  }

  // Step 2: build the real SKU from the id and persist it.
  const sku = buildSku(brandAbbr, inserted.id, originAbbr)
  const { error: updateError } = await supabase
    .from("products")
    .update({ sku })
    .eq("id", inserted.id)

  if (updateError) {
    // Compensating rollback: remove the orphaned placeholder row.
    await supabase.from("products").delete().eq("id", inserted.id)
    return {
      success: false,
      error: isUniqueViolation(updateError)
        ? "A product with this SKU already exists."
        : updateError.message,
    }
  }

  revalidatePath(PATH)
  return { success: true, data: { id: inserted.id } }
}

export async function deleteProduct(id: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("products").delete().eq("id", id)

  if (error) {
    if (isForeignKeyViolation(error)) {
      return {
        success: false,
        error:
          "This product is still referenced elsewhere and cannot be deleted.",
      }
    }
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}
