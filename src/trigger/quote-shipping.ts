import { createClient } from "@supabase/supabase-js"
// Always the package root. NEVER "@trigger.dev/sdk/v3" -- that is the v3 path,
// still present for compatibility and used throughout xpros, which was built
// before v4.
import { logger, task } from "@trigger.dev/sdk"

import { runQuoteEngine, type QuoteEngineResult } from "@/lib/shipping/quote-engine"
import type { Database } from "@/lib/supabase/database.types"

export interface QuoteShippingPayload {
  orderId: number
  // `auto` for a quote raised by the system, `manual` for one an operator asked
  // for. It only affects the wording of the order_logs entry.
  triggeredBy: "auto" | "manual"
  userId?: string | null
}

export const quoteShippingTask = task({
  id: "quote-shipping",
  maxDuration: 60,
  run: async (payload: QuoteShippingPayload): Promise<QuoteEngineResult> => {
    // The service role key, not the anon key: every shipping table is
    // SELECT-only for `authenticated`, and the engine writes to
    // order_shipping_quotes, order_logs and (when nothing can be quoted)
    // orders.status. There is no user session inside a task to carry RLS
    // anyway. Both variables have to exist in the Trigger.dev dashboard as
    // well -- a deployed task cannot see .env.local.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
      )
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const result = await runQuoteEngine(
      supabase,
      payload.orderId,
      payload.triggeredBy,
      payload.userId ?? null
    )

    if (result.status === "manual_required") {
      logger.warn("No quote available; order escalated", {
        orderId: payload.orderId,
        reason: result.reason,
      })
    } else {
      logger.info("Quote batch complete", {
        orderId: payload.orderId,
        quoteCount: result.quotes.length,
        validCount: result.quotes.filter((q) => !q.error).length,
        selectedMethod: result.selectedMethod,
      })
    }

    return result
  },
})
