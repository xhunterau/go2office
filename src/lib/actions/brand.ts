"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { brandSchema, type BrandInput } from "@/lib/validations/brand"
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/brands"

// Normalize optional text: empty string -> null so the DB keeps NULLs, not "".
function toNullable(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Map a unique-constraint violation to a friendly, column-specific message.
// Falls back to null when the error is not a unique violation.
function uniqueError(error: { code?: string; message?: string }): string | null {
  if (!isUniqueViolation(error)) return null
  if (error.message?.includes("brands_abbr_key")) {
    return "A brand with this abbreviation already exists."
  }
  return "A brand with this name already exists."
}

export async function createBrand(input: BrandInput): Promise<ActionResult> {
  const parsed = brandSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("brands").insert({
    name: parsed.data.name,
    abbr: toNullable(parsed.data.abbr),
  })

  if (error) {
    return { success: false, error: uniqueError(error) ?? error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}

export async function updateBrand(
  id: number,
  input: BrandInput
): Promise<ActionResult> {
  const parsed = brandSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("brands")
    .update({
      name: parsed.data.name,
      abbr: toNullable(parsed.data.abbr),
    })
    .eq("id", id)

  if (error) {
    return { success: false, error: uniqueError(error) ?? error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}

export async function deleteBrand(id: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("brands").delete().eq("id", id)

  if (error) {
    if (isForeignKeyViolation(error)) {
      return {
        success: false,
        error: "This brand is still referenced by products and cannot be deleted.",
      }
    }
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}
