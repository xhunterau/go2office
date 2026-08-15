"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { countrySchema, type CountryInput } from "@/lib/validations/country"
import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/settings/countries"

// Translate the constraints declared in migration 20260809120000. There are two
// separate unique constraints here, unlike postcodes' single composite one, and
// they fail for reasons the user has to tell apart.
function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    if (error.message?.includes("countries_code_unique")) {
      return "Another country already uses that code."
    }
    // countries_country_name_key is a unique index on lower(country_name), so
    // retyping the name in a different case will not get past it. Saying so is
    // the difference between a fixable error and one the user fights with --
    // retrying in another case is exactly what the message would otherwise
    // invite.
    return "That country name is already listed (matching ignores case)."
  }
  if (isCheckViolation(error)) {
    return "Country code must be two letters, like AU."
  }
  return error.message ?? "Something went wrong"
}

export async function createCountry(input: CountryInput): Promise<ActionResult> {
  const parsed = countrySchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("countries").insert({
    country_name: parsed.data.country_name,
    country_code: parsed.data.country_code,
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

export async function updateCountry(
  id: number,
  input: CountryInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid country" }
  }

  const parsed = countrySchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // updated_at comes from the moddatetime trigger, so it is never set here.
  const { data: updated, error } = await supabase
    .from("countries")
    .update({
      country_name: parsed.data.country_name,
      country_code: parsed.data.country_code,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Country not found" }

  revalidatePath(PATH)
  return { success: true }
}

export async function deleteCountry(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid country" }
  }

  const supabase = await createClient()
  // Nothing references this table by foreign key -- customers hold their country
  // as plain text -- so a delete always succeeds. What it costs is silent:
  // standardize_customer_address() leaves the value exactly as typed when the
  // lookup misses, so customers in that country simply stop being collapsed onto
  // one code, and the two spellings drift apart again. The confirm dialog
  // carries that; there is no error to report here.
  const { data: deleted, error } = await supabase
    .from("countries")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!deleted) return { success: false, error: "Country not found" }

  revalidatePath(PATH)
  return { success: true }
}
