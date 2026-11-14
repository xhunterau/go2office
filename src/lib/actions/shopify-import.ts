"use server"

import { runs, tasks } from "@trigger.dev/sdk"

import type { ActionResult } from "@/lib/actions/action-result"
import { readImportStatus, startOrderImport } from "@/lib/order-import/start-import"
import type { RunSnapshot } from "@/lib/trigger/run-status"
import type {
  importShopifyOrdersTask,
  ImportShopifyOrdersResult,
} from "@/trigger/import-shopify-orders"

export type ShopifyImportStatus = RunSnapshot<ImportShopifyOrdersResult>

/**
 * Starts the Shopify import, narrowed to one order while the
 * shopify_import_test_order debug setting is on. See startOrderImport.
 */
export async function triggerShopifyImport(): Promise<
  ActionResult<{ runId: string; testOrder: string | null }>
> {
  return startOrderImport("shopify_import_test_order", "Shopify", (payload) =>
    tasks.trigger<typeof importShopifyOrdersTask>("import-shopify-orders", payload)
  )
}

/** Polled by the page while the import runs. */
export async function getShopifyImportStatus(
  runId: string
): Promise<ActionResult<ShopifyImportStatus>> {
  return readImportStatus(() => runs.retrieve<typeof importShopifyOrdersTask>(runId))
}
