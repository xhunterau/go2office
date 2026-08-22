import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

export type ZoneResult = { zone: string; surcharge: number } | { error: string }

// Mirrors `lpad(btrim(postcode), 4, '0')` from standardize_customer_address()
// (migration 20260809130000), truncation included -- Postgres lpad cuts a longer
// string down to the target length rather than leaving it be.
//
// xpros strips leading zeros instead. Doing that here would match nothing at
// all: postcodes.postcode is CHECK-constrained to exactly four digits, so the
// 1283 customers in Darwin and Canberra would silently stop being quotable.
export function normalizePostcode(postcode: string): string {
  const trimmed = postcode.trim()
  return trimmed.length >= 4 ? trimmed.slice(0, 4) : trimmed.padStart(4, "0")
}

export function normalizeLocality(locality: string): string {
  return locality.trim().toUpperCase()
}

export async function resolveZone(
  supabase: SupabaseClient<Database>,
  carrierId: number,
  carrierCode: string,
  destPostcode: string,
  destLocality: string | null
): Promise<ZoneResult> {
  let postcodeQuery = supabase
    .from("postcodes")
    .select("id")
    .eq("postcode", normalizePostcode(destPostcode))

  if (destLocality) {
    // Equality, not ILIKE. xpros passes the suburb to ilike(), where the right
    // side is a PATTERN: a customer whose city contains % or _ would match some
    // other suburb and be quoted its zone. Equality is also the only form that
    // can use postcodes_postcode_locality_unique.
    postcodeQuery = postcodeQuery.eq("locality", normalizeLocality(destLocality))
  }

  // A postcode maps to exactly one zone per carrier -- no postcode in the table
  // carries two -- so taking the first matching suburb row cannot pick the wrong
  // zone even where the suburb was left out.
  const { data: rows, error: postcodeError } = await postcodeQuery.limit(1)
  if (postcodeError) return { error: postcodeError.message }
  if (!rows?.length) {
    return {
      error: `No postcode record for ${destPostcode}${destLocality ? ` / ${destLocality}` : ""}`,
    }
  }

  const { data: zoneRow, error: zoneError } = await supabase
    .from("postcode_carrier_zones")
    .select("zone, surcharge")
    .eq("postcode_id", rows[0].id)
    .eq("carrier_id", carrierId)
    .maybeSingle()

  if (zoneError) return { error: zoneError.message }
  if (!zoneRow) {
    return { error: `No zone for postcode ${destPostcode} / carrier ${carrierCode}` }
  }

  // surcharge is NOT NULL DEFAULT 0 in this schema, unlike xpros's nullable one.
  return { zone: zoneRow.zone, surcharge: Number(zoneRow.surcharge) }
}
