"use server"

import { runs, tasks } from "@trigger.dev/sdk"

import type { ActionResult } from "@/lib/actions/action-result"
import { readImportStatus, startOrderImport } from "@/lib/order-import/start-import"
import type { RunSnapshot } from "@/lib/trigger/run-status"
import type {
  importEbayOrdersTask,
  ImportEbayOrdersResult,
} from "@/trigger/import-ebay-orders"

export type EbayImportStatus = RunSnapshot<ImportEbayOrdersResult>

/**
 * Starts the eBay import, narrowed to one order while the
 * ebay_import_test_order debug setting is on. See startOrderImport.
 */
export async function triggerEbayImport(): Promise<
  ActionResult<{ runId: string; testOrder: string | null }>
> {
  return startOrderImport("ebay_import_test_order", "eBay", (payload) =>
    tasks.trigger<typeof importEbayOrdersTask>("import-ebay-orders", payload)
  )
}

/** Polled by the page while the import runs. */
export async function getEbayImportStatus(
  runId: string
): Promise<ActionResult<EbayImportStatus>> {
  return readImportStatus(() => runs.retrieve<typeof importEbayOrdersTask>(runId))
}
