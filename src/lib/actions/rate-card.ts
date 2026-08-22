"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  carrierServiceSchema,
  zoneRateSchema,
  type CarrierServiceInput,
  type ZoneRateInput,
} from "@/lib/validations/shipping-reference"
import {
  isCheckViolation,
  isUniqueViolation,
  type ActionResult,
} from "@/lib/actions/action-result"

const PATH = "/settings/shipping/rate-cards"

// Every rate change takes effect on the next quote and is not retroactive:
// order_shipping_quotes rows keep the price that was quoted on the day. That is
// the intended behaviour -- a quote is a record of what was charged -- and the
// page says so, because nothing about editing a cell suggests it.

export async function createCarrierService(
  carrierId: number,
  input: CarrierServiceInput
): Promise<ActionResult> {
  if (!Number.isInteger(carrierId) || carrierId <= 0) {
    return { success: false, error: "Invalid carrier" }
  }

  const parsed = carrierServiceSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("carrier_services")
    .insert({ carrier_id: carrierId, ...parsed.data })

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

export async function updateCarrierService(
  id: number,
  input: CarrierServiceInput
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid service tier" }
  }

  const parsed = carrierServiceSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("carrier_services")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: messageFor(error) }
  if (!updated) return { success: false, error: "Service tier not found" }

  revalidatePath(PATH)
  return { success: true }
}

// Cascades into this tier's zone rates -- the FK is ON DELETE CASCADE. The
// confirm dialog carries the row count, since the database will not refuse.
export async function deleteCarrierService(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid service tier" }
  }

  const supabase = await createClient()
  const { data: deleted, error } = await supabase
    .from("carrier_services")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: error.message }
  if (!deleted) return { success: false, error: "Service tier not found" }

  revalidatePath(PATH)
  return { success: true }
}

// One cell of the matrix. Upsert rather than update: most (service, zone) pairs
// exist, but a zone that gained postcodes after the card was imported has no
// row yet, and typing a price into it should create one.
export async function upsertZoneRate(
  serviceId: number,
  zone: string,
  input: ZoneRateInput
): Promise<ActionResult> {
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return { success: false, error: "Invalid service tier" }
  }
  if (!zone.trim()) return { success: false, error: "Invalid zone" }

  const parsed = zoneRateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("carrier_zone_rates")
    .upsert(
      { service_id: serviceId, zone: zone.trim(), ...parsed.data },
      { onConflict: "service_id,zone" }
    )

  if (error) return { success: false, error: messageFor(error) }

  revalidatePath(PATH)
  return { success: true }
}

// Clearing a cell, which is not the same as setting it to zero: a missing row
// means this tier does not serve this zone and the engine skips it, while a
// zero means it ships free.
export async function deleteZoneRate(
  serviceId: number,
  zone: string
): Promise<ActionResult> {
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return { success: false, error: "Invalid service tier" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("carrier_zone_rates")
    .delete()
    .eq("service_id", serviceId)
    .eq("zone", zone)

  if (error) return { success: false, error: error.message }

  revalidatePath(PATH)
  return { success: true }
}

function messageFor(error: { code?: string; message?: string }): string {
  if (isUniqueViolation(error)) {
    if (error.message?.includes("carrier_services_unique")) {
      return "That carrier already has a tier with this service type and size label."
    }
    return "That zone already has a rate on this tier."
  }
  if (isCheckViolation(error)) {
    if (error.message?.includes("carrier_zone_rates_has_pricing")) {
      return "A rate needs either a flat rate, or both a base rate and a per kg rate."
    }
    if (error.message?.includes("carrier_services_type_lower")) {
      return "Service type must be lowercase."
    }
  }
  return error.message ?? "Something went wrong"
}
