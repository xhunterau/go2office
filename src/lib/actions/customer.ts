"use server"

import { revalidatePath } from "next/cache"

import {
  isForeignKeyViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"
import {
  countCustomerOrders,
  fetchCustomerDetail,
  type CustomerDetail,
} from "@/lib/queries/customers"
import { createClient } from "@/lib/supabase/server"
import { customerSchema, type CustomerInput } from "@/lib/validations/customer"

function revalidateCustomer(id?: number): void {
  revalidatePath("/customers")
  if (id !== undefined) revalidatePath(`/customers/${id}`)
  // Orders render the customer's name and address, so both list and detail go.
  revalidatePath("/orders", "layout")
}

function toNullable(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Every column is nullable in the database; empty strings from the form become
// NULL so that "not provided" is one value rather than two.
function toRow(input: CustomerInput) {
  return {
    platform_user_id: toNullable(input.platform_user_id),
    full_name: toNullable(input.full_name),
    email: toNullable(input.email),
    phone: toNullable(input.phone),
    company_name: toNullable(input.company_name),
    address_line1: toNullable(input.address_line1),
    address_line2: toNullable(input.address_line2),
    address_line3: toNullable(input.address_line3),
    address_line4: toNullable(input.address_line4),
    city: toNullable(input.city),
    state: toNullable(input.state),
    postcode: toNullable(input.postcode),
    country: toNullable(input.country),
  }
}

function parse(input: CustomerInput) {
  const parsed = customerSchema.safeParse(input)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      data: null,
    }
  }
  return { error: null, data: parsed.data }
}

// Every column of one customer, for the edit form.
//
// The form must be loaded from the full row, never from a list row: the list
// carries eight of the thirteen editable columns, and updateCustomer writes all
// thirteen. Opening the form on a partial row would save NULL over the phone,
// company and address lines that were never on screen.
export async function loadCustomer(
  id: number
): Promise<ActionResult<CustomerDetail>> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid customer" }
  }

  const supabase = await createClient()
  const { customer, error } = await fetchCustomerDetail(supabase, id)

  if (error) return { success: false, error }
  if (!customer) return { success: false, error: "Customer not found" }
  return { success: true, data: customer }
}

export async function createCustomer(
  input: CustomerInput
): Promise<ActionResult<{ id: number }>> {
  const { error: invalid, data } = parse(input)
  if (invalid || !data) return { success: false, error: invalid ?? "Invalid input" }

  const supabase = await createClient()
  const { data: created, error } = await supabase
    .from("customers")
    .insert(toRow(data))
    .select("id")
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: "A customer with this platform user ID already exists.",
      }
    }
    return { success: false, error: error.message }
  }

  revalidateCustomer(created.id)
  return { success: true, data: { id: created.id } }
}

// Editing a customer's address changes the address shown on ALL of their
// orders, past ones included -- orders keep no snapshot of where they actually
// shipped, which the fourth review round accepted knowingly (8150 orders are
// already displaying an address they were not sent to). The form says so; this
// is the note for whoever reads the action.
export async function updateCustomer(
  id: number,
  input: CustomerInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid customer" }
  }

  const { error: invalid, data } = parse(input)
  if (invalid || !data) return { success: false, error: invalid ?? "Invalid input" }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("customers")
    .update(toRow(data))
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: "A customer with this platform user ID already exists.",
      }
    }
    return { success: false, error: error.message }
  }
  if (!updated) return { success: false, error: "Customer not found" }

  revalidateCustomer(id)
  return { success: true }
}

// Deleting a customer usually fails, and that is correct rather than broken:
// orders.customer_id is ON DELETE RESTRICT and almost all 178024 customers have
// orders. Same shape as deleting a location that still holds stock. The message
// carries the order count, because "violates foreign key constraint" gives the
// user nothing to act on.
export async function deleteCustomer(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid customer" }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("customers").delete().eq("id", id)

  if (error) {
    if (isForeignKeyViolation(error)) {
      const orders = await countCustomerOrders(supabase, id)
      return {
        success: false,
        error: `This customer has ${orders} ${
          orders === 1 ? "order" : "orders"
        } on file and cannot be deleted.`,
      }
    }
    return { success: false, error: error.message }
  }

  revalidateCustomer()
  return { success: true }
}
