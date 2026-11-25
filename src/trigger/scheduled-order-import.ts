// The package root, never "@trigger.dev/sdk/v3" (see batch-postage-check.ts).
import { idempotencyKeys, logger, schedules } from "@trigger.dev/sdk"

import type { DebugSettingKey } from "@/lib/debug/settings"
import { activeDebugValue } from "@/lib/queries/debug-settings"
import { createServiceClient } from "@/lib/supabase/service"
import { importEbayOrdersTask } from "@/trigger/import-ebay-orders"
import { importShopifyOrdersTask } from "@/trigger/import-shopify-orders"

type PlatformOutcome =
  | { status: "triggered"; runId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }

export type ScheduledOrderImportResult = {
  shopify: PlatformOutcome
  ebay: PlatformOutcome
}

/**
 * Starts the Shopify and eBay imports every hour from 07:00 to 23:00 Melbourne
 * time (user decision, 2026-11-25).
 *
 * It only triggers the two import tasks the Orders page buttons run, so a
 * scheduled import behaves exactly like a manual one: one run per platform at a
 * time (a scheduled run queues behind a manual one), no retries, and orders
 * already imported are skipped. Each platform is its own run, so an expired
 * eBay authorisation does not stop the Shopify import.
 */
export const scheduledOrderImportTask = schedules.task({
  id: "scheduled-order-import",
  // Production only (user decision): staging shares the database, and running
  // in both would import every hour twice. Also keeps a local `trigger dev`
  // from importing real orders from a laptop.
  cron: {
    pattern: "0 7-23 * * *",
    timezone: "Australia/Melbourne",
    environments: ["PRODUCTION"],
  },
  maxDuration: 60,
  retry: { maxAttempts: 1 },

  run: async (payload): Promise<ScheduledOrderImportResult> => {
    const supabase = createServiceClient()
    // The scheduled hour, so a re-run of this tick cannot import twice.
    const slot = payload.timestamp.toISOString()

    async function start(
      platform: "shopify" | "ebay",
      debugKey: DebugSettingKey,
      trigger: (idempotencyKey: string) => Promise<{ id: string }>
    ): Promise<PlatformOutcome> {
      // Skipped while the test-order switch is on (user decision): a full
      // import in the background would defeat a one-order test. A switch that
      // cannot be read is treated as on, as startOrderImport does.
      const debug = await activeDebugValue(supabase, debugKey)
      if (debug.error) {
        return { status: "skipped", reason: `Could not read the debug settings: ${debug.error}` }
      }
      if (debug.value) {
        return { status: "skipped", reason: `Test order ${debug.value} is set in /settings/debug` }
      }

      try {
        const key = await idempotencyKeys.create(`scheduled-import:${platform}:${slot}`, {
          scope: "global",
        })
        const run = await trigger(key)
        return { status: "triggered", runId: run.id }
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : String(error) }
      }
    }

    // userId omitted: order_logs.user_id stays NULL, which is how a scheduled
    // import is told apart from someone pressing the button.
    const shopify = await start("shopify", "shopify_import_test_order", (idempotencyKey) =>
      importShopifyOrdersTask.trigger({}, { idempotencyKey })
    )
    const ebay = await start("ebay", "ebay_import_test_order", (idempotencyKey) =>
      importEbayOrdersTask.trigger({}, { idempotencyKey })
    )

    logger.info("Scheduled order import", { slot, shopify, ebay })

    // Failing the run is the only signal there is (no alerting yet, user
    // decision), so a platform that could not be started must show as failed.
    const failed = [shopify, ebay].filter((outcome) => outcome.status === "failed")
    if (failed.length > 0) {
      throw new Error(`Could not start ${failed.length} import(s): ${JSON.stringify({ shopify, ebay })}`)
    }
    return { shopify, ebay }
  },
})
