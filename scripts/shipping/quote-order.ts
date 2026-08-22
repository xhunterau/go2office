/**
 * Runs the shipping quote engine against real orders, for acceptance item 5 of
 * docs/shipping-quote-engine.md: quote the same orders here and in xpros and
 * check that a given carrier comes out at the same cents.
 *
 * Dry run by default. runQuoteEngine is NOT read-only -- it writes a batch to
 * order_shipping_quotes, writes to order_logs, and on an unquotable order it
 * rewrites orders.status to `issued`. In dry-run mode every write is
 * intercepted and printed instead of executed; --commit lets them through.
 *
 * Aramex is quoted over its live API either way. That call creates nothing and
 * costs nothing, but it does leave the building.
 *
 *   npx tsx scripts/shipping/quote-order.ts --pick
 *   npx tsx scripts/shipping/quote-order.ts 12345 12346
 *   npx tsx scripts/shipping/quote-order.ts 12345 --commit
 *
 * Delete this script once the engine is wired to the Trigger.dev task and the
 * panel; it exists to check the port, not to be part of the app.
 */
import { readFileSync } from "node:fs"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { runQuoteEngine } from "@/lib/shipping/quote-engine"
import type { Database } from "@/lib/supabase/database.types"

// Literal parse, no variable expansion. CLAUDE.md rule 16: DATABASE_URL's
// password contains a `$`, and both `source` and dotenv-expand silently eat the
// rest of the value, which then looks exactly like a wrong password.
function loadEnvLocal(): void {
  const text = readFileSync(".env.local", "utf8")
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] ??= value
  }
}

type WriteLog = string[]

// Resolves to { data: null, error: null } however far the caller chains.
function stubWriteResult(): unknown {
  const result = { data: null, error: null, count: null, status: 200, statusText: "OK" }
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return () => proxy
      },
    }
  )
  return proxy
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"])

function dryRunClient(
  real: SupabaseClient<Database>,
  log: WriteLog
): SupabaseClient<Database> {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver)
      return (table: string) => {
        const builder = target.from(table as never)
        return new Proxy(builder as object, {
          get(inner, method, innerReceiver) {
            if (typeof method === "string" && WRITE_METHODS.has(method)) {
              return (...args: unknown[]) => {
                log.push(`${method} ${table} ${JSON.stringify(args[0] ?? null)}`)
                return stubWriteResult()
              }
            }
            const value = Reflect.get(inner, method, innerReceiver)
            return typeof value === "function" ? value.bind(inner) : value
          },
        })
      }
    },
  }) as SupabaseClient<Database>
}

// The acceptance list asks for orders across these shapes. Each probe returns
// the newest matching order, so re-running picks a stable set.
async function pickSampleOrders(
  supabase: SupabaseClient<Database>
): Promise<{ label: string; orderId: number | null; note: string }[]> {
  const picks: { label: string; orderId: number | null; note: string }[] = []

  const metric = async (
    label: string,
    note: string,
    build: (
      query: ReturnType<typeof buildMetricsQuery>
    ) => ReturnType<typeof buildMetricsQuery>
  ) => {
    const { data } = await build(buildMetricsQuery(supabase)).limit(1)
    picks.push({ label, orderId: data?.[0]?.order_id ?? null, note })
  }

  await metric("light + small", "under 500g, should reach the satchel tiers", (q) =>
    q.lt("chargeable_weight_kg", 0.5).gt("chargeable_weight_kg", 0)
  )
  await metric("5kg boundary", "MyPost's cap -- expect MyPost to drop out just above", (q) =>
    q.gte("chargeable_weight_kg", 4.9).lte("chargeable_weight_kg", 5.1)
  )
  await metric("over 1040mm", "past the Australia Post length limit", (q) =>
    q.gt("max_dimension_mm", 1040)
  )
  await metric("over $200", "past the Aramex insurance ceiling", (q) =>
    q.gt("goods_total", 200)
  )
  // Register_Letter also has to clear 297 x 210 x 20mm, and those limits apply
  // to the SORTED edges -- which PostgREST cannot express, so the shape test
  // happens here over a batch of weight/value candidates.
  const { data: letterCandidates } = await supabase
    .from("order_metrics_summary")
    .select("order_id, packed_length_mm, packed_width_mm, packed_height_mm")
    .lte("chargeable_weight_kg", 0.5)
    .gt("goods_total", 0)
    .lte("goods_total", 100)
    .lte("max_dimension_mm", 297)
    .order("order_id", { ascending: false })
    .limit(500)

  const letter = (letterCandidates ?? []).find((row) => {
    const [longest, middle, shortest] = [
      row.packed_length_mm ?? 0,
      row.packed_width_mm ?? 0,
      row.packed_height_mm ?? 0,
    ].sort((a, b) => b - a)
    return longest > 0 && longest <= 297 && middle <= 210 && shortest <= 20
  })
  picks.push({
    label: "registered letter candidate",
    orderId: letter?.order_id ?? null,
    note: "<=0.5kg, <=$100, fits 297x210x20mm -- should quote Register_Letter",
  })

  // Postal-only lives on the customer, not the metrics row.
  const { data: postal } = await supabase
    .from("orders")
    .select("id, customers!inner(address_line1)")
    .ilike("customers.address_line1", "%po box%")
    .order("id", { ascending: false })
    .limit(1)
  picks.push({
    label: "PO Box address",
    orderId: postal?.[0]?.id ?? null,
    note: "postal-only: Aramex must be excluded",
  })

  return picks
}

function buildMetricsQuery(supabase: SupabaseClient<Database>) {
  return supabase
    .from("order_metrics_summary")
    .select("order_id")
    .order("order_id", { ascending: false })
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`
}

async function quoteOne(
  real: SupabaseClient<Database>,
  orderId: number,
  commit: boolean
): Promise<void> {
  const writes: WriteLog = []
  const client = commit ? real : dryRunClient(real, writes)

  const { data: order } = await real
    .from("orders")
    .select("invoice_number, status, shipping_method")
    .eq("id", orderId)
    .maybeSingle()

  console.log(`\n${"=".repeat(78)}`)
  console.log(
    `order ${orderId}  invoice ${order?.invoice_number ?? "?"}  status ${order?.status ?? "?"}  current method ${order?.shipping_method ?? "-"}`
  )

  const { data: metrics } = await real
    .from("order_metrics_summary")
    .select(
      "total_weight_kg, chargeable_weight_kg, max_dimension_mm, packed_length_mm, packed_width_mm, packed_height_mm, goods_total"
    )
    .eq("order_id", orderId)
    .maybeSingle()

  if (metrics) {
    console.log(
      `  weight ${metrics.total_weight_kg}kg (chargeable ${metrics.chargeable_weight_kg}kg)  ` +
        `packed ${metrics.packed_length_mm}x${metrics.packed_width_mm}x${metrics.packed_height_mm}mm  ` +
        `max ${metrics.max_dimension_mm}mm  goods ${formatMoney(Number(metrics.goods_total))}`
    )
  }

  let result
  try {
    result = await runQuoteEngine(client, orderId, "manual", null)
  } catch (error) {
    console.log(`  THREW: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  if (result.status === "manual_required") {
    console.log(`  ESCALATED: ${result.reason}`)
  } else {
    const rows = [...result.quotes].sort((a, b) => {
      if (!!a.error !== !!b.error) return a.error ? 1 : -1
      return a.quotedRate - b.quotedRate
    })
    for (const quote of rows) {
      const selected = quote.shippingMethod === result.selectedMethod ? " <= selected" : ""
      const price = quote.error ? "     -" : formatMoney(quote.quotedRate).padStart(9)
      console.log(
        `  ${price}  ${quote.shippingMethod.padEnd(24)} ${(quote.zone ?? "").padEnd(22)}` +
          `${quote.error ? `ERROR ${quote.error}` : ""}${selected}`
      )
    }
    if (!result.selectedMethod) console.log("  nothing selected: no valid quote")
  }

  if (!commit) {
    console.log(`  -- ${writes.length} write(s) suppressed:`)
    for (const write of writes) console.log(`     ${write.slice(0, 200)}`)
  }
}

async function main(): Promise<void> {
  loadEnvLocal()

  const args = process.argv.slice(2)
  const commit = args.includes("--commit")
  const pick = args.includes("--pick")
  const orderIds = args.filter((a) => /^\d+$/.test(a)).map(Number)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be in .env.local"
    )
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(commit ? "MODE: COMMIT -- writes go to the database" : "MODE: dry run")

  if (pick) {
    const picks = await pickSampleOrders(supabase)
    console.log("\nsample orders:")
    for (const p of picks) {
      console.log(`  ${(p.orderId ?? "none").toString().padStart(8)}  ${p.label.padEnd(28)} ${p.note}`)
    }
    // One order routinely satisfies several probes; quote it once.
    const seen = new Set<number>()
    for (const p of picks) {
      if (p.orderId && !seen.has(p.orderId)) {
        seen.add(p.orderId)
        await quoteOne(supabase, p.orderId, commit)
      }
    }
  }

  for (const orderId of orderIds) {
    await quoteOne(supabase, orderId, commit)
  }

  if (!pick && orderIds.length === 0) {
    console.log("\nnothing to do. Pass order ids, or --pick for a sample across the acceptance scenarios.")
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
