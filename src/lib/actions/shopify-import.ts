"use server"

import { revalidatePath } from "next/cache"
import { runs, tasks } from "@trigger.dev/sdk"

import type { ActionResult } from "@/lib/actions/action-result"
import { createClient } from "@/lib/supabase/server"
import { snapshotOf, type RunSnapshot } from "@/lib/trigger/run-status"
import type {
  importShopifyOrdersTask,
  ImportShopifyOrdersResult,
} from "@/trigger/import-shopify-orders"

export type ShopifyImportStatus = RunSnapshot<ImportShopifyOrdersResult>

/** Starts the import. The page polls getShopifyImportStatus with the run id. */
export async function triggerShopifyImport(): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  try {
    const run = await tasks.trigger<typeof importShopifyOrdersTask>(
      "import-shopify-orders",
      { userId: user.id }
    )
    return { success: true, data: { runId: run.id } }
  } catch (error) {
    // Almost always no dev worker running, or TRIGGER_SECRET_KEY missing.
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start the Shopify import",
    }
  }
}

/** Polled by the page while the import runs. See src/lib/trigger/run-status.ts. */
export async function getShopifyImportStatus(
  runId: string
): Promise<ActionResult<ShopifyImportStatus>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  try {
    const run = await runs.retrieve<typeof importShopifyOrdersTask>(runId)
    const snapshot = snapshotOf(run)
    // The list and the allocation queues both change once it is done.
    if (snapshot.finished) {
      revalidatePath("/orders")
      revalidatePath("/fulfillment/allocation")
    }
    return { success: true, data: snapshot }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not read the import status",
    }
  }
}
