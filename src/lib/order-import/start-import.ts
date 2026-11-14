import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/actions/action-result"
import type { DebugSettingKey } from "@/lib/debug/settings"
import { activeDebugValue } from "@/lib/queries/debug-settings"
import { createClient } from "@/lib/supabase/server"
import { snapshotOf, type RunSnapshot } from "@/lib/trigger/run-status"

// The server side of an "Import from <platform>" button, shared by the Shopify
// and eBay actions. Each action keeps its own tasks.trigger / runs.retrieve
// call, because the SDK only infers payload and output types when the task type
// is concrete at the call site (see run-status.ts).

type ImportPayload = { userId: string; testOrder?: string }

/**
 * Starts an import. The page polls the matching status action with the run id.
 *
 * The debug switch is read here, at trigger time, rather than trusted from the
 * page: the button's label could be minutes old. The value actually used comes
 * back in `testOrder` and in the run's output.
 */
export async function startOrderImport(
  debugKey: DebugSettingKey,
  platform: string,
  trigger: (payload: ImportPayload) => Promise<{ id: string }>
): Promise<ActionResult<{ runId: string; testOrder: string | null }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  // Fail closed. "Off" means every unshipped order, so a switch that cannot be
  // read must not be taken as off.
  const debug = await activeDebugValue(supabase, debugKey)
  if (debug.error) {
    return {
      success: false,
      error: `Could not read the debug settings, so the import was not started: ${debug.error}`,
    }
  }
  const testOrder = debug.value

  try {
    const run = await trigger({ userId: user.id, ...(testOrder ? { testOrder } : {}) })
    return { success: true, data: { runId: run.id, testOrder } }
  } catch (error) {
    // Almost always no dev worker running, or TRIGGER_SECRET_KEY missing.
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to start the ${platform} import`,
    }
  }
}

/** Polled by the page while the import runs. See src/lib/trigger/run-status.ts. */
export async function readImportStatus<TOutput>(
  retrieve: () => Promise<Parameters<typeof snapshotOf<TOutput>>[0]>
): Promise<ActionResult<RunSnapshot<TOutput>>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Your session has expired" }

  try {
    const snapshot = snapshotOf<TOutput>(await retrieve())
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
