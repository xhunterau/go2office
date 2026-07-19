"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { supplierSchema, type SupplierInput } from "@/lib/validations/supplier"
import {
  isForeignKeyViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/suppliers"

function toNullable(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function toRow(input: SupplierInput) {
  return {
    company_name: input.company_name.trim(),
    contact_person: toNullable(input.contact_person),
    email: toNullable(input.email),
    phone: toNullable(input.phone),
    comments: toNullable(input.comments),
  }
}

export async function createSupplier(
  input: SupplierInput
): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("suppliers").insert(toRow(parsed.data))

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}

export async function updateSupplier(
  id: number,
  input: SupplierInput
): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("suppliers")
    .update(toRow(parsed.data))
    .eq("id", id)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}

export async function deleteSupplier(id: number): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("suppliers").delete().eq("id", id)

  if (error) {
    if (isForeignKeyViolation(error)) {
      return {
        success: false,
        error: "This supplier is still referenced by products and cannot be deleted.",
      }
    }
    return { success: false, error: error.message }
  }

  revalidatePath(PATH)
  return { success: true }
}
