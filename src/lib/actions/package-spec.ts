"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  packageSpecSchema,
  type PackageSpecInput,
} from "@/lib/validations/shipping-reference"
import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/settings/shipping/package-specs"

export async function createPackageSpec(
  input: PackageSpecInput
): Promise<ActionResult> {
  const parsed = packageSpecSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("flat_rate_package_specs")
    .insert(parsed.data)

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

export async function updatePackageSpec(
  id: number,
  input: PackageSpecInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid package spec" }
  }

  const parsed = packageSpecSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("flat_rate_package_specs")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Package spec not found" }

  revalidatePath(PATH)
  return { success: true }
}

// Nothing references these rows by foreign key. What a delete costs is silent:
// the flat-rate adapter matches a dispatch option's size label against this
// table, and a method whose spec is gone stops being quoted rather than
// erroring. The confirm dialog says so.
export async function deletePackageSpec(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid package spec" }
  }

  const supabase = await createClient()
  const { data: deleted, error } = await supabase
    .from("flat_rate_package_specs")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!deleted) return { success: false, error: "Package spec not found" }

  revalidatePath(PATH)
  return { success: true }
}

function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    return "That package type already has a spec for this size."
  }
  if (isCheckViolation(error)) {
    return "Package type must be satchel or box, and size must be XS, S, M, L or XL."
  }
  return error.message ?? "Something went wrong"
}
