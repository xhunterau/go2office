import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

export type ShippingQuoteRow = {
  id: number
  shipping_method: Database["public"]["Enums"]["shipping_method"]
  carrier_id: number
  carrier_code: string
  carrier_name: string
  zone: string | null
  quoted_rate: number
  computation_type: string
  is_selected: boolean
  error_message: string | null
  quoted_at: string
}

export type ShippingQuoteBatch = {
  // The rows of the most recent run only. Older batches stay in the table --
  // they are what the order was quoted at the time -- but showing them mixed in
  // would put two prices for the same carrier on screen at once.
  quotes: ShippingQuoteRow[]
  quotedAt: string | null
  error: string | null
}

type RawQuote = Omit<ShippingQuoteRow, "carrier_code" | "carrier_name"> & {
  carriers: { code: string; name: string } | null
}

const QUOTE_COLUMNS = `
  id,
  shipping_method,
  carrier_id,
  zone,
  quoted_rate,
  computation_type,
  is_selected,
  error_message,
  quoted_at,
  carriers(code, name)
`

export async function fetchLatestShippingQuotes(
  supabase: SupabaseClient<Database>,
  orderId: number
): Promise<ShippingQuoteBatch> {
  // Newest batch first, cheapest first within it. Filtering to the newest batch
  // happens below rather than in a second round trip: an order accumulates one
  // batch per re-quote and there are at most a couple of dozen rows in each.
  const { data, error } = await supabase
    .from("order_shipping_quotes")
    .select(QUOTE_COLUMNS)
    .eq("order_id", orderId)
    .order("quoted_at", { ascending: false })
    .order("quoted_rate", { ascending: true })

  if (error) return { quotes: [], quotedAt: null, error: error.message }

  const rows = (data ?? []) as unknown as RawQuote[]
  const quotedAt = rows[0]?.quoted_at ?? null
  if (!quotedAt) return { quotes: [], quotedAt: null, error: null }

  const quotes = rows
    .filter((row) => row.quoted_at === quotedAt)
    .map(({ carriers, ...quote }) => ({
      ...quote,
      quoted_rate: Number(quote.quoted_rate),
      carrier_code: carriers?.code ?? "",
      carrier_name: carriers?.name ?? carriers?.code ?? "—",
    }))

  return { quotes, quotedAt, error: null }
}
