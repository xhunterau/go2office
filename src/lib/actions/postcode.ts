"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  postcodeSchema,
  toStateColumn,
  type PostcodeInput,
} from "@/lib/validations/postcode"
import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/settings/postcodes"

// Translate the constraints declared in migration 20260809110000. The Zod schema
// pads and uppercases, so a CHECK violation reaching here means the two drifted
// apart rather than that the user typed something odd -- which is exactly when a
// readable message is worth having.
function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    return "That postcode and locality pair already exists."
  }
  if (isCheckViolation(error)) {
    if (error.message?.includes("postcodes_postcode_format")) {
      return "Postcode must be exactly four digits."
    }
    return "Locality and state must be uppercase."
  }
  return error.message ?? "Something went wrong"
}

export async function createPostcode(
  input: PostcodeInput
): Promise<ActionResult> {
  const parsed = postcodeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("postcodes").insert({
    postcode: parsed.data.postcode,
    locality: parsed.data.locality,
    state: toStateColumn(parsed.data.state),
  })

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

export async function updatePostcode(
  id: number,
  input: PostcodeInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid postcode" }
  }

  const parsed = postcodeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  // updated_at comes from the moddatetime trigger, so it is never set here.
  const { data: updated, error } = await supabase
    .from("postcodes")
    .update({
      postcode: parsed.data.postcode,
      locality: parsed.data.locality,
      state: toStateColumn(parsed.data.state),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Postcode not found" }

  revalidatePath(PATH)
  return { success: true }
}

export async function deletePostcode(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid postcode" }
  }

  const supabase = await createClient()
  // Nothing references this table by foreign key -- customers carry their
  // address as plain columns -- so a delete always succeeds. What it costs is
  // silent: standardize_customer_address() leaves address alone when the lookup
  // misses, so the customers in that locality simply stop being standardised.
  // The confirm dialog says so; there is no error to report here.
  const { data: deleted, error } = await supabase
    .from("postcodes")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!deleted) return { success: false, error: "Postcode not found" }

  revalidatePath(PATH)
  return { success: true }
}
