import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { parseFlatRateMethod } from "@/lib/shipping/adapters/flat-rate.adapter"

// The quote engine's reference data, read for /settings/shipping. Written as
// one module rather than six because the pages share a shape -- small tables,
// no pagination, ordered for reading -- and because three of them need the
// carrier list alongside their own rows.

export type CarrierRow = Database["public"]["Tables"]["carriers"]["Row"]
export type CarrierServiceRow =
  Database["public"]["Tables"]["carrier_services"]["Row"]
export type CarrierZoneRateRow =
  Database["public"]["Tables"]["carrier_zone_rates"]["Row"]
export type DispatchOptionRow =
  Database["public"]["Tables"]["carrier_dispatch_options"]["Row"]
export type PackageSpecRow =
  Database["public"]["Tables"]["flat_rate_package_specs"]["Row"]
export type ShippingSettingsRow =
  Database["public"]["Tables"]["shipping_settings"]["Row"]

type Client = SupabaseClient<Database>

// Deliberately not a discriminated union: pages read two or three of these at
// once, and `if (a.error || b.error)` narrows neither. Checking `data` does.
export type Loaded<T> = { data: T | null; error: string | null }

// ── carriers ──────────────────────────────────────────────────────────────

// Four rows, and meant to stay that way -- one per account the business holds.
// No filter bar for the same reason the countries page has none.
export async function fetchCarriers(client: Client): Promise<Loaded<CarrierRow[]>> {
  const { data, error } = await client
    .from("carriers")
    .select("*")
    .order("name", { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

// What a carrier would take with it if it were deleted, and what makes its row
// worth reading: a carrier with no dispatch options is not being quoted at all,
// whatever its is_active says.
export type CarrierUsage = {
  serviceCount: number
  dispatchOptionCount: number
  activeDispatchOptionCount: number
  zoneCount: number
}

export async function fetchCarrierUsage(
  client: Client,
  carrierIds: number[]
): Promise<Loaded<Map<number, CarrierUsage>>> {
  // The two small tables (22 and 25 rows) are scanned; the zone table is
  // counted per carrier instead.
  //
  // Not scanned: PostgREST caps a response at 1000 rows by default, and
  // postcode_carrier_zones holds 33,424. Selecting carrier_id off it returns
  // the first thousand -- all belonging to whichever carrier sorts first -- so
  // the tally came out as "1000, 0, 0, 0" and looked like data rather than like
  // a truncated page. head + exact asks Postgres for the number and returns no
  // rows at all, which is both correct and cheaper.
  const [services, options, ...zoneCounts] = await Promise.all([
    client.from("carrier_services").select("carrier_id"),
    client.from("carrier_dispatch_options").select("carrier_id, is_active"),
    ...carrierIds.map((carrierId) =>
      client
        .from("postcode_carrier_zones")
        .select("id", { count: "exact", head: true })
        .eq("carrier_id", carrierId)
    ),
  ])

  const failed =
    services.error ?? options.error ?? zoneCounts.find((row) => row.error)?.error
  if (failed) return { data: null, error: failed.message }

  const usage = new Map<number, CarrierUsage>()
  const entry = (carrierId: number) => {
    const existing = usage.get(carrierId)
    if (existing) return existing
    const created: CarrierUsage = {
      serviceCount: 0,
      dispatchOptionCount: 0,
      activeDispatchOptionCount: 0,
      zoneCount: 0,
    }
    usage.set(carrierId, created)
    return created
  }

  for (const carrierId of carrierIds) entry(carrierId)
  for (const row of services.data ?? []) entry(row.carrier_id).serviceCount += 1
  for (const row of options.data ?? []) {
    const record = entry(row.carrier_id)
    record.dispatchOptionCount += 1
    if (row.is_active) record.activeDispatchOptionCount += 1
  }
  carrierIds.forEach((carrierId, index) => {
    entry(carrierId).zoneCount = zoneCounts[index]?.count ?? 0
  })

  return { data: usage, error: null }
}

// ── rate cards ────────────────────────────────────────────────────────────

export type RateCard = {
  carrier: CarrierRow
  services: CarrierServiceRow[]
  zones: string[]
  // Keyed `${service_id}:${zone}` -- the matrix looks a cell up per render.
  rates: Map<string, CarrierZoneRateRow>
}

export function rateKey(serviceId: number, zone: string): string {
  return `${serviceId}:${zone}`
}

export async function fetchRateCard(
  client: Client,
  carrierId: number
): Promise<Loaded<RateCard>> {
  const [carrier, services, zones] = await Promise.all([
    client.from("carriers").select("*").eq("id", carrierId).maybeSingle(),
    client
      .from("carrier_services")
      .select("*")
      .eq("carrier_id", carrierId)
      // service_type groups the card into its Standard and Express halves;
      // sort_order is the weight ladder within each.
      .order("service_type", { ascending: true })
      .order("sort_order", { ascending: true }),
    client.from("carrier_zones").select("zone").eq("carrier_id", carrierId),
  ])

  const failed = carrier.error ?? services.error ?? zones.error
  if (failed) return { data: null, error: failed.message }
  if (!carrier.data) return { data: null, error: "Carrier not found" }

  const serviceRows = services.data ?? []
  const rates = new Map<string, CarrierZoneRateRow>()

  if (serviceRows.length > 0) {
    const { data, error } = await client
      .from("carrier_zone_rates")
      .select("*")
      .in(
        "service_id",
        serviceRows.map((service) => service.id)
      )
    if (error) return { data: null, error: error.message }
    for (const rate of data ?? []) rates.set(rateKey(rate.service_id, rate.zone), rate)
  }

  return {
    data: {
      carrier: carrier.data,
      services: serviceRows,
      // Zone_1 .. Zone_8 sort lexicographically into the right order, and a
      // non-numbered zone lands after them rather than anywhere surprising.
      zones: [...new Set((zones.data ?? []).map((row) => row.zone))].sort(),
      rates,
    },
    error: null,
  }
}

// ── dispatch options ──────────────────────────────────────────────────────

export type DispatchOptionWithCarrier = DispatchOptionRow & {
  carrier: Pick<CarrierRow, "id" | "code" | "name" | "is_active"> | null
}

export async function fetchDispatchOptions(
  client: Client
): Promise<Loaded<DispatchOptionWithCarrier[]>> {
  const { data, error } = await client
    .from("carrier_dispatch_options")
    .select("*, carrier:carriers(id, code, name, is_active)")
    .order("shipping_method", { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as DispatchOptionWithCarrier[], error: null }
}

// The service_type values a dispatch option may point at, per carrier. Offered
// as a closed list rather than a text box on purpose: the column joins to
// carrier_services.service_type, and xpros stores 'Standard' on one side and
// 'standard' on the other, papered over with .toLowerCase() at two of the three
// call sites. The third finds no tiers at all.
export async function fetchServiceTypesByCarrier(
  client: Client
): Promise<Loaded<Map<number, string[]>>> {
  const { data, error } = await client
    .from("carrier_services")
    .select("carrier_id, service_type")

  if (error) return { data: null, error: error.message }

  const byCarrier = new Map<number, Set<string>>()
  for (const row of data ?? []) {
    const set = byCarrier.get(row.carrier_id) ?? new Set<string>()
    set.add(row.service_type)
    byCarrier.set(row.carrier_id, set)
  }

  return {
    data: new Map(
      [...byCarrier].map(([carrierId, types]) => [carrierId, [...types].sort()])
    ),
    error: null,
  }
}

// ── flat-rate package specs ───────────────────────────────────────────────

export async function fetchPackageSpecs(
  client: Client
): Promise<Loaded<PackageSpecRow[]>> {
  const { data, error } = await client
    .from("flat_rate_package_specs")
    .select("*")
    .order("package_type", { ascending: true })
    .order("sort_order", { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

// ── shipping settings ─────────────────────────────────────────────────────

export async function fetchShippingSettings(
  client: Client
): Promise<Loaded<ShippingSettingsRow>> {
  const { data, error } = await client
    .from("shipping_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: "The shipping settings row is missing." }
  return { data, error: null }
}

// Whether each flat-rate spec is actually reachable.
//
// The flat-rate adapter pins its weight tier by looking for a carrier_services
// row whose max_weight equals the spec's maps_to_weight_kg exactly. A spec whose
// billed weight matches no tier still looks perfectly filled in here, and the
// only symptom is a quote row reading "No standard tier at 5kg" -- so the page
// says it up front instead.
export type PackageSpecCoverage = {
  // Active dispatch options that would use this spec.
  optionCount: number
  // Of those, how many find a tier at the spec's billed weight.
  pricedCount: number
}

export async function fetchPackageSpecCoverage(
  client: Client,
  specs: PackageSpecRow[]
): Promise<Loaded<Map<number, PackageSpecCoverage>>> {
  const [options, services] = await Promise.all([
    client
      .from("carrier_dispatch_options")
      .select("shipping_method, carrier_id, service_type")
      .eq("is_active", true),
    client.from("carrier_services").select("carrier_id, service_type, max_weight"),
  ])

  const failed = options.error ?? services.error
  if (failed) return { data: null, error: failed.message }

  // Same key the adapter matches on: carrier, service type, exact tier weight.
  const tiers = new Set(
    (services.data ?? []).map(
      (row) => `${row.carrier_id}:${row.service_type}:${row.max_weight}`
    )
  )

  const coverage = new Map<number, PackageSpecCoverage>()
  for (const spec of specs) coverage.set(spec.id, { optionCount: 0, pricedCount: 0 })

  for (const option of options.data ?? []) {
    const parsed = parseFlatRateMethod(option.shipping_method)
    if (!parsed) continue
    const spec = specs.find(
      (row) =>
        row.package_type === parsed.packageType && row.size_label === parsed.sizeLabel
    )
    if (!spec) continue

    const record = coverage.get(spec.id)!
    record.optionCount += 1
    // The adapter's own fallback when a dispatch option leaves service_type
    // empty.
    const serviceType = option.service_type ?? "standard"
    if (tiers.has(`${option.carrier_id}:${serviceType}:${spec.maps_to_weight_kg}`)) {
      record.pricedCount += 1
    }
  }

  return { data: coverage, error: null }
}
