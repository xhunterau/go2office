"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "node:crypto"

import type { Database } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"
import {
  searchOrderLineProducts,
  type OrderLineProduct,
} from "@/lib/queries/products"
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  productCreateSchema,
  productSectionSchemas,
  retailPriceSchema,
  productsLogisticsUpdateSchema,
  DEFAULT_DIMENSION,
  type ProductCreateInput,
  type ProductSection,
} from "@/lib/validations/product"
import { ALLOCATION_STATUS } from "@/lib/queries/allocation"
import {
  PRODUCT_IMAGES_BUCKET,
  objectPathFromPublicUrl,
} from "@/lib/storage/product-images"

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

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"]

// Turn a validated section payload into a DB update: every text value gets
// trimmed and empty strings become NULL, so blanking an optional field clears
// the column instead of storing "".
function toUpdatePayload(values: Record<string, unknown>): ProductUpdate {
  const entries = Object.entries(values).map(([key, value]) => [
    key,
    typeof value === "string" ? toNullable(value) : value,
  ])
  return Object.fromEntries(entries) as ProductUpdate
}

// Delete the previously uploaded image once it has been replaced. Best effort:
// a failure here must never block the update, and legacy external URLs (which
// are not ours to delete) resolve to a null path and are skipped.
async function removeReplacedImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previousUrl: string | null,
  nextUrl: string | null
): Promise<void> {
  if (previousUrl === nextUrl) return
  const path = objectPathFromPublicUrl(previousUrl)
  if (!path) return
  await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
}

// Update one section of a product (see PRODUCT_SECTION_FIELDS). A single action
// dispatches on `section` rather than one action per card, so the schema, error
// mapping and revalidation live in one place.
export async function updateProductSection(
  id: number,
  section: ProductSection,
  input: unknown
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid product id" }
  }

  const schema = productSectionSchemas[section]
  if (!schema) return { success: false, error: "Unknown section" }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const payload = toUpdatePayload(parsed.data)
  const supabase = await createClient()

  // Read the current image before overwriting it so the old object can be
  // cleaned up afterwards.
  let previousImageUrl: string | null = null
  if (section === "details") {
    const { data: current } = await supabase
      .from("products")
      .select("image_url")
      .eq("id", id)
      .maybeSingle()
    previousImageUrl = current?.image_url ?? null
  }

  // updated_at is maintained by the moddatetime trigger (migration
  // 20260719150000), so it is never set here.
  const { data: updated, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isForeignKeyViolation(error)) {
      return {
        success: false,
        error: "The selected brand, origin or supplier no longer exists.",
      }
    }
    if (isUniqueViolation(error)) {
      return { success: false, error: "That value is already taken." }
    }
    return { success: false, error: error.message }
  }

  if (!updated) return { success: false, error: "Product not found" }

  if (section === "details") {
    await removeReplacedImage(
      supabase,
      previousImageUrl,
      (payload.image_url as string | null) ?? null
    )
  }

  revalidatePath(PATH)
  revalidatePath(`${PATH}/${id}`)
  return { success: true }
}

// Set the retail price on its own, from the Pricing tab.
//
// Deliberately not routed through updateProductSection("commercial"): that
// schema demands the whole commercial group, so a submit from the Pricing tab
// would rewrite the purchase price, weight and dimensions from whatever the
// page was rendered with — a stale overwrite waiting to happen. One column in,
// one column out.
export async function updateProductRetailPrice(
  id: number,
  input: unknown
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid product id" }
  }

  const parsed = retailPriceSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // updated_at is maintained by the moddatetime trigger (migration
  // 20260719150000), so it is never set here.
  const { data: updated, error } = await supabase
    .from("products")
    .update({ retail_price: parsed.data.retail_price })
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!updated) return { success: false, error: "Product not found" }

  revalidatePath(PATH)
  revalidatePath(`${PATH}/${id}`)
  return { success: true }
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

// Backs the order line picker's search box. A Server Action rather than a route
// handler for the same reason as searchKitCandidatesAction: it reuses the
// server Supabase client and its auth cookie handling.
export async function searchOrderLineProductsAction(
  keyword: string
): Promise<ActionResult<OrderLineProduct[]>> {
  const supabase = await createClient()
  const { products, error } = await searchOrderLineProducts(
    supabase,
    typeof keyword === "string" ? keyword.slice(0, 100) : ""
  )

  if (error) return { success: false, error }
  return { success: true, data: products }
}

export type ProductLogistics = {
  id: number
  sku: string
  name: string | null
  is_kit: boolean
  weight: number
  length: number
  width: number
  height: number
}

// Current weight and dimensions for the Postage dialog's edit form. Read when
// the form opens rather than carried from the page, so the values typed over
// are the ones in the database now, not the ones the queue was rendered with.
export async function loadProductsLogistics(
  ids: number[]
): Promise<ActionResult<ProductLogistics[]>> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0)
  if (unique.length === 0) return { success: false, error: "No products to load" }
  if (unique.length > 50) return { success: false, error: "Too many products" }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, is_kit, weight, length, width, height")
    .in("id", unique)
    .order("sku", { ascending: true })

  if (error) return { success: false, error: error.message }
  return { success: true, data: data ?? [] }
}

// Above this many affected queue orders the rest are left to the hourly
// refresh_stale_order_metrics job, which picks them up by products.updated_at
// anyway. Each rebuild is one RPC, and the save should not stall on a
// product that happens to sit in half the queue.
const MAX_QUEUE_REBUILDS = 100

/**
 * Write weight and dimensions for a handful of products, then bring the
 * affected orders' packed figures up to date.
 *
 * The second half is the point. order_metrics_summary has no trigger on
 * products -- only on orders, order_transactions and order_items -- so without
 * it the operator fixes a size and the dialog keeps showing the old packed
 * size until the hourly job runs. Rebuilt: the order the edit was made from,
 * plus every other order in the Postage queue that picks the same product.
 *
 * Quotes are NOT re-run. They hit carrier APIs and are a record of what was
 * offered (CLAUDE.md rule 23); the caller tells the operator to re-quote.
 *
 * Kits are refused: their weight and size are derived from the components, and
 * order metrics are built from the picked components, so a number written on
 * the kit row would change nothing that is shown.
 */
export async function updateProductsLogistics(
  orderId: number,
  input: unknown
): Promise<ActionResult<{ rebuiltOrders: number }>> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "Invalid order" }
  }

  const parsed = productsLogisticsUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const ids = parsed.data.map((row) => row.id)

  const { data: kits, error: kitError } = await supabase
    .from("products")
    .select("sku")
    .in("id", ids)
    .eq("is_kit", true)
  if (kitError) return { success: false, error: kitError.message }
  if (kits && kits.length > 0) {
    return {
      success: false,
      error: `${kits.map((k) => k.sku).join(", ")} is a kit; edit its components instead.`,
    }
  }

  // Sequential, one row each: every product gets its own values, and a row
  // that comes back empty (deleted, or refused by RLS -- rule 22) has to be
  // reported rather than toasted as saved.
  for (const { id, ...values } of parsed.data) {
    const { data: updated, error } = await supabase
      .from("products")
      .update(values)
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!updated) return { success: false, error: `Product ${id} not found` }
  }

  // Every queue order that picks one of these products, this one included.
  const { data: affected, error: affectedError } = await supabase
    .from("order_items")
    .select("order_transactions!inner(order_id, orders!inner(status))")
    .in("product_id", ids)
    .eq("order_transactions.orders.status", ALLOCATION_STATUS)

  const orderIds = new Set<number>([orderId])
  if (!affectedError) {
    for (const row of affected ?? []) {
      orderIds.add(row.order_transactions.order_id)
    }
  }

  let rebuiltOrders = 0
  let rebuildError: string | null = null
  for (const id of [...orderIds].slice(0, MAX_QUEUE_REBUILDS)) {
    const { error } = await supabase.rpc("rebuild_order_metrics", { p_order_id: id })
    if (error) {
      rebuildError = error.message
      if (id === orderId) break
      continue
    }
    rebuiltOrders += 1
  }

  revalidatePath(PATH)
  for (const id of ids) revalidatePath(`${PATH}/${id}`)
  revalidatePath("/fulfillment/allocation")

  // The products are saved either way; a failed rebuild only means the packed
  // size catches up on the next hourly refresh, so it is not a failure.
  if (rebuildError && rebuiltOrders === 0) {
    return {
      success: true,
      data: { rebuiltOrders },
      error: `Saved, but the order figures were not recalculated: ${rebuildError}`,
    }
  }
  return { success: true, data: { rebuiltOrders } }
}
