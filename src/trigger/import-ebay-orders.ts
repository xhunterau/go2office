import { createClient } from "@supabase/supabase-js"
// The package root, never "@trigger.dev/sdk/v3" (see batch-postage-check.ts).
import { logger, metadata, task } from "@trigger.dev/sdk"

import type { Database, Json } from "@/lib/supabase/database.types"
import { loadEbayAccount } from "@/lib/ebay/client"
import { ebayOrderName, mapEbayOrder } from "@/lib/ebay/order-mapper"
import { fetchEbayOrders } from "@/lib/ebay/orders"
import {
  asImportOutcome,
  importOrders,
  type OrderImportResult,
} from "@/lib/order-import/import-orders"

export interface ImportEbayOrdersPayload {
  /** Who pressed the button; written to order_logs.user_id. */
  userId?: string | null
  /**
   * Import just this order, by eBay order number ("17-15414-28640"). The page
   * sends it while the ebay_import_test_order debug setting is on
   * (/settings/debug); it can also be set by hand from the Trigger.dev
   * dashboard.
   */
  testOrder?: string
}

/**
 * See OrderImportResult. `ignored` = cancelled or cancelling, unpaid, or every
 * line already shipped; the first two are also listed in `notices`.
 */
export type ImportEbayOrdersResult = OrderImportResult

export const importEbayOrdersTask = task({
  id: "import-ebay-orders",
  // getOrders pages 200 at a time; each order is one RPC.
  maxDuration: 600,
  // Same reasons as import-shopify-orders: two runs would page through the same
  // orders and interleave the merges. The SQL function's advisory lock is what
  // actually prevents duplicates.
  queue: { concurrencyLimit: 1 },
  // A retry would hide the failure the operator should see. Re-running by hand
  // is safe: imported orders are skipped as duplicates.
  retry: { maxAttempts: 1 },

  run: async (payload: ImportEbayOrdersPayload): Promise<ImportEbayOrdersResult> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
      )
    }

    // Service role twice over: ebay_accounts has no RLS policies, and
    // import_platform_order is revoked from anon and authenticated.
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const testOrder = payload.testOrder?.trim() || null

    await metadata.set("stage", "fetching")

    // An expired or revoked authorisation throws EbayReauthorizationRequired
    // here, failing the run with the instruction in its message -- rather than
    // an import that quietly finds no orders.
    const account = await loadEbayAccount(supabase)

    // Everything first, then write: an eBay failure halfway through the pages
    // costs nothing, and the progress bar knows its total from the start.
    const orders = await fetchEbayOrders(account, testOrder ?? undefined)

    logger.info("Fetched eBay orders", { count: orders.length, testOrder, seller: account.username })

    await metadata.set("stage", "processing")
    await metadata.set("progress", { current: 0, total: orders.length })

    const result = await importOrders(orders, {
      testOrder,
      nameOf: ebayOrderName,
      map: mapEbayOrder,
      write: async (mapped) => {
        const { data, error } = await supabase.rpc("import_platform_order", {
          p_platform: "ebay",
          p_order: mapped as unknown as Json,
          p_user_id: payload.userId ?? null,
        })
        if (error) throw new Error(error.message)
        return asImportOutcome(data)
      },
      onProgress: async (current, total) => {
        await metadata.set("progress", { current, total })
      },
      log: logger,
    })

    logger.info("eBay import complete", {
      ...result,
      mergedInvoices: undefined,
      failures: result.failures.length,
      notices: result.notices.length,
    })
    return result
  },
})
