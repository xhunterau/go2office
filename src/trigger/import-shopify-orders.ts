import { createClient } from "@supabase/supabase-js"
// The package root, never "@trigger.dev/sdk/v3" (see batch-postage-check.ts).
import { logger, metadata, task } from "@trigger.dev/sdk"

import type { Database, Json } from "@/lib/supabase/database.types"
import { fetchShopifyOrdersPage, type ShopifyOrder } from "@/lib/shopify/orders"
import { mapShopifyOrder } from "@/lib/shopify/order-mapper"

export interface ImportShopifyOrdersPayload {
  /** Who pressed the button; written to order_logs.user_id. */
  userId?: string | null
  /**
   * Import just this order: its name ("#G2B24707") or numeric id
   * ("7930453721225"), see ordersFilter(). The page sends it while the
   * shopify_import_test_order debug setting is on (/settings/debug); it can
   * also be set by hand from the Trigger.dev dashboard.
   */
  testOrder?: string
}

export interface ShopifyImportFailure {
  name: string
  reason: string
}

export interface ImportShopifyOrdersResult {
  /** The debug test order this run was narrowed to, or null for a full import. */
  testOrder: string | null
  fetched: number
  /** New orders created. */
  imported: number
  /**
   * Shopify orders added to the same customer's pending order. Each one sent
   * that order back to the Address queue and deleted its quotes, so they are
   * listed by invoice for the operator to look at again.
   */
  merged: number
  mergedInvoices: string[]
  /** Already in go2office -- by this import or by Laravel before the cutover. */
  duplicates: number
  /** Cancelled, test, or nothing left to ship. Never sent to the database. */
  ignored: number
  failures: ShopifyImportFailure[]
}

type ImportOutcome = {
  result: "imported" | "merged" | "skipped"
  order_id?: number
  invoice_number?: string
}

export const importShopifyOrdersTask = task({
  id: "import-shopify-orders",
  // One page of 25 is one GraphQL call; each order is one RPC. A backlog of a
  // few hundred unshipped orders is well inside this.
  maxDuration: 600,
  // Two runs at once would both page through the same orders. The function's
  // advisory lock keeps that from duplicating anything, but it would still
  // double the work and interleave the merges.
  queue: { concurrencyLimit: 1 },
  // A retry starts over from page one. Orders the first attempt imported are
  // skipped as duplicates, so it would be safe -- but it would hide a failure
  // the operator should see, the same reasoning as batch-postage-check.
  retry: { maxAttempts: 1 },

  run: async (payload: ImportShopifyOrdersPayload): Promise<ImportShopifyOrdersResult> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
      )
    }

    // Service role: import_shopify_order is revoked from anon and authenticated.
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const testOrder = payload.testOrder?.trim() || null

    await metadata.set("stage", "fetching")

    // Fetch everything first, then write: a Shopify failure halfway through the
    // pages then costs nothing, rather than leaving half a backlog imported, and
    // the progress bar knows its total from the start.
    const orders: ShopifyOrder[] = []
    let cursor: string | null = null
    for (;;) {
      const page = await fetchShopifyOrdersPage(cursor, testOrder ?? undefined)
      orders.push(...page.orders)
      if (!page.hasNextPage) break
      cursor = page.endCursor
    }

    logger.info("Fetched Shopify orders", {
      count: orders.length,
      testOrder,
    })

    // Oldest first (the query sorts by CREATED_AT), so when two orders from one
    // customer arrive together the first one creates the order and the second
    // merges into it, matching the order they were placed in.
    const result: ImportShopifyOrdersResult = {
      testOrder,
      fetched: orders.length,
      imported: 0,
      merged: 0,
      mergedInvoices: [],
      duplicates: 0,
      ignored: 0,
      failures: [],
    }

    await metadata.set("stage", "processing")
    await metadata.set("progress", { current: 0, total: orders.length })

    // Serial. Each order may merge into one created moments earlier in this same
    // loop, which only works if that one has committed.
    for (const [index, order] of orders.entries()) {
      try {
        const mapped = mapShopifyOrder(order)
        if (mapped.kind === "skip") {
          result.ignored += 1
          logger.info("Ignored Shopify order", { name: order.name, reason: mapped.reason })
        } else {
          const { data, error } = await supabase.rpc("import_shopify_order", {
            p_order: mapped.payload as unknown as Json,
            p_user_id: payload.userId ?? null,
          })
          if (error) throw new Error(error.message)

          const outcome = data as unknown as ImportOutcome
          if (outcome.result === "imported") result.imported += 1
          else if (outcome.result === "merged") {
            result.merged += 1
            if (outcome.invoice_number) result.mergedInvoices.push(outcome.invoice_number)
          } else result.duplicates += 1
        }
      } catch (error) {
        // One bad order must not stop the rest; the function rolled it back
        // whole, so there is nothing half-written to clean up.
        const reason = error instanceof Error ? error.message : "Unknown error"
        result.failures.push({ name: order.name, reason })
        logger.error("Shopify order failed to import", { name: order.name, reason })
      }

      await metadata.set("progress", { current: index + 1, total: orders.length })
    }

    logger.info("Shopify import complete", {
      ...result,
      mergedInvoices: undefined,
      failures: result.failures.length,
    })
    return result
  },
})
