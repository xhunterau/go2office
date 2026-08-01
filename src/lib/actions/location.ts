"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { locationSchema, type LocationInput } from "@/lib/validations/location"
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/locations"

// Location names appear on the inventory list and in the stock dialogs, so a
// rename has to invalidate those too.
function revalidateLocations(): void {
  revalidatePath(PATH)
  revalidatePath("/inventory")
  revalidatePath("/products", "layout")
}

function toNullable(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Translate the constraints declared in migration 20260801100000.
function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    return "A location with this name already exists."
  }
  if (isCheckViolation(error)) {
    return "Location name cannot be blank."
  }
  return error.message ?? "Something went wrong"
}

export async function createLocation(
  input: LocationInput
): Promise<ActionResult> {
  const parsed = locationSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // created_at/updated_at come from the DB defaults + moddatetime trigger
  // (migration 20260801100000), so they are never set here.
  const { error } = await supabase.from("locations").insert({
    name: parsed.data.name,
    comments: toNullable(parsed.data.comments),
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidateLocations()
  return { success: true }
}

export async function updateLocation(
  id: number,
  input: LocationInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid location" }
  }

  const parsed = locationSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("locations")
    .update({
      name: parsed.data.name,
      comments: toNullable(parsed.data.comments),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Location not found" }

  revalidateLocations()
  return { success: true }
}

export async function deleteLocation(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid location" }
  }

  const supabase = await createClient()
  const { data: deleted, error } = await supabase
    .from("locations")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    // inventory_levels.location_id is RESTRICT, and a stock row sitting at zero
    // blocks the delete just as a full one does — it still records that the
    // product belongs here.
    if (isForeignKeyViolation(error)) {
      return {
        success: false,
        error:
          "This location still holds products and cannot be deleted. Move or clear its stock first.",
      }
    }
    return { success: false, error: error.message }
  }
  if (!deleted) return { success: false, error: "Location not found" }

  revalidateLocations()
  return { success: true }
}
