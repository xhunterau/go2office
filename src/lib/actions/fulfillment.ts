"use server"

import { revalidatePath } from "next/cache"
import { auth, tasks } from "@trigger.dev/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"
import type { ActionResult } from "@/lib/actions/action-result"
import {
  countDispatchableOrders,
  fetchDispatchableOrders,
  LABELLED_STATUS,
  type DispatchOrder,
} from "@/lib/queries/fulfillment"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import {
  ARAMEX_METHODS,
  EPARCEL_METHODS,
  MYPOST_METHODS,
  SELF_PRINT_METHODS,
} from "@/lib/fulfillment/carrier-groups"
// A type-only import: the task module pulls in the Aramex client and the
// service-role Supabase client, and bundling that into the Next.js build would
// ship the service-role path to the server bundle for no reason. The string id
// below is what actually addresses the task.
import type { submitAramexBatchTask } from "@/trigger/submit-aramex-batch"
import { exportFilename } from "@/lib/fulfillment/csv"
import { buildMyPostCsv } from "@/lib/fulfillment/mypost-csv"
import { buildEParcelCsv } from "@/lib/fulfillment/eparcel-csv"
import {
  requireFallbacks,
  senderFrom,
  UnmappableOrderError,
} from "@/lib/fulfillment/types"

type Client = SupabaseClient<Database>

export type CsvExportResult = {
  csv: string
  filename: string
  count: number
  /** Invoice numbers whose address was truncated to fit the carrier's columns. */
  truncated: string[]
  /** Non-fatal problems worth telling the operator about. */
  warning?: string
}

export type MarkPrintedResult = {
  orderIds: number[]
  warning?: string
}

function revalidate(): void {
  revalidatePath("/fulfillment/export-labels")
  revalidatePath("/orders")
}

async function currentUser(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Moves a batch to `labelled` and logs it.
 *
 * The `.select("id")` is not decoration: RLS refuses an UPDATE by filtering the
 * rows away rather than raising, so without reading the rows back a blocked
 * write reports success (CLAUDE.md rule 22). Comparing the count also catches
 * an order whose status changed underneath us between the read and the write.
 *
 * A failed log is reported but does not fail the call. The status change has
 * already happened by then, and telling the operator the export failed when the
 * orders have in fact moved is the worse of the two wrong answers.
 */
async function markDispatched(
  supabase: Client,
  orderIds: number[],
  logAction: string,
  userId: string
): Promise<{ error: string | null; warning?: string }> {
  const { data: updated, error } = await supabase
    .from("orders")
    .update({ status: LABELLED_STATUS })
    .in("id", orderIds)
    .select("id")

  if (error) return { error: error.message }

  const changed = updated?.length ?? 0
  if (changed !== orderIds.length) {
    return {
      error:
        `Only ${changed} of ${orderIds.length} orders could be moved to Labelled. ` +
        `Nothing has been exported — reload and try again.`,
    }
  }

  const { error: logError } = await supabase.from("order_logs").insert(
    orderIds.map((orderId) => ({ order_id: orderId, action: logAction, user_id: userId }))
  )

  if (logError) {
    return {
      error: null,
      warning: `The orders were marked Labelled, but the order log was not written: ${logError.message}`,
    }
  }

  return { error: null }
}

/**
 * The shape every CSV export shares: load the queue, build the file, and only
 * then move the orders.
 *
 * Order matters. xpros updates the status before returning the CSV but reports
 * a failed log as an outright error, so an export can leave the orders moved and
 * the operator holding nothing. Building first means a mapping failure costs
 * nothing, and the status only moves once there is a file to hand over.
 */
async function exportCsv(
  methods: readonly Database["public"]["Enums"]["shipping_method"][],
  logAction: string,
  filenamePrefix: string,
  build: (
    orders: DispatchOrder[],
    settings: NonNullable<
      Awaited<ReturnType<typeof fetchShippingSettings>>["data"]
    >,
    fallbacks: { email: string; phone: string }
  ) => { csv: string; truncated: string[] }
): Promise<ActionResult<CsvExportResult>> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Authentication required" }

  const settings = await fetchShippingSettings(supabase)
  if (!settings.data) {
    return { success: false, error: settings.error ?? "Shipping settings are missing" }
  }

  const fallbacks = requireFallbacks(settings.data)
  if (!fallbacks.fallbacks) return { success: false, error: fallbacks.error }

  const queue = await fetchDispatchableOrders(supabase, methods)
  if (!queue.data) return { success: false, error: queue.error ?? "Failed to load orders" }
  if (queue.data.length === 0) {
    return { success: false, error: "No orders are waiting on a label for this carrier." }
  }

  let built: { csv: string; truncated: string[] }
  try {
    built = build(queue.data, settings.data, fallbacks.fallbacks)
  } catch (error) {
    if (error instanceof UnmappableOrderError) {
      return {
        success: false,
        error: `${error.message}. Nothing has been exported — fix that order and try again.`,
      }
    }
    throw error
  }

  const orderIds = queue.data.map((order) => order.id)
  const dispatched = await markDispatched(supabase, orderIds, logAction, user.id)
  if (dispatched.error) return { success: false, error: dispatched.error }

  revalidate()

  return {
    success: true,
    data: {
      csv: built.csv,
      filename: exportFilename(filenamePrefix),
      count: orderIds.length,
      truncated: built.truncated,
      warning: dispatched.warning,
    },
  }
}

export async function exportMyPostCsv(): Promise<ActionResult<CsvExportResult>> {
  return exportCsv(
    MYPOST_METHODS,
    "MyPost Business CSV exported",
    "mypost_export",
    (orders, settings, fallbacks) =>
      buildMyPostCsv(orders, { sender: senderFrom(settings), fallbacks })
  )
}

export async function exportEParcelCsv(): Promise<ActionResult<CsvExportResult>> {
  return exportCsv(
    EPARCEL_METHODS,
    "eParcel CSV exported",
    "eparcel_export",
    (orders, _settings, fallbacks) => buildEParcelCsv(orders, { fallbacks })
  )
}

/**
 * Moves the self-print queue to `labelled` and hands back the ids so the client
 * can open the PDF route.
 *
 * The status flips on click rather than on a confirmed print, which is xpros'
 * behaviour and the right one: the browser never tells the page whether the
 * dialog was completed, and an order stuck in `processing` because someone
 * cancelled a print preview is worse than one marked `labelled` that gets
 * reprinted. The print route takes ids directly, so a reprint always works.
 */
export async function markSelfPrintLabelsPrinted(): Promise<
  ActionResult<MarkPrintedResult>
> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Authentication required" }

  const queue = await fetchDispatchableOrders(supabase, SELF_PRINT_METHODS)
  if (!queue.data) return { success: false, error: queue.error ?? "Failed to load orders" }
  if (queue.data.length === 0) {
    return { success: false, error: "No orders are waiting on a self-printed label." }
  }

  const orderIds = queue.data.map((order) => order.id)
  const dispatched = await markDispatched(
    supabase,
    orderIds,
    "Shipping label printed (batch)",
    user.id
  )
  if (dispatched.error) return { success: false, error: dispatched.error }

  revalidate()

  return { success: true, data: { orderIds, warning: dispatched.warning } }
}

export type AramexBatchRun = {
  runId: string
  /** Scoped to reading this one run, so the browser can subscribe to progress. */
  publicToken: string
}

/**
 * Starts the Aramex batch. Unlike the CSV exports this cannot be done inline:
 * each order is a live booking against Aramex, and a queue of any size would
 * outrun a Server Action's budget.
 *
 * The status change and the tracking write-back happen inside the task, per
 * order, because a booking that has been accepted by Aramex must be recorded
 * even if a later one in the batch fails.
 */
export async function triggerAramexBatch(): Promise<ActionResult<AramexBatchRun>> {
  const supabase = await createClient()
  const user = await currentUser(supabase)
  if (!user) return { success: false, error: "Authentication required" }

  const settings = await fetchShippingSettings(supabase)
  if (!settings.data) {
    return { success: false, error: settings.error ?? "Shipping settings are missing" }
  }

  // Checked here as well as in the task, so an unset fallback is a message on
  // the page rather than a failed run the operator has to go and read.
  const fallbacks = requireFallbacks(settings.data)
  if (!fallbacks.fallbacks) return { success: false, error: fallbacks.error }

  const queue = await countDispatchableOrders(supabase, ARAMEX_METHODS)
  if (queue.data === 0) {
    return { success: false, error: "No orders are waiting on an Aramex consignment." }
  }

  try {
    const run = await tasks.trigger<typeof submitAramexBatchTask>(
      "submit-aramex-batch",
      { userId: user.id }
    )

    const publicToken = await auth.createPublicToken({
      scopes: { read: { runs: [run.id] } },
      expirationTime: "2h",
    })

    return { success: true, data: { runId: run.id, publicToken } }
  } catch (error) {
    // Almost always no dev worker running, or TRIGGER_SECRET_KEY missing. Both
    // read as "failed to start", so the message is worth passing through.
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to start the Aramex submission",
    }
  }
}

/** Called when a run finishes, so the page picks up the new queue counts. */
export async function revalidateDispatchQueues(): Promise<void> {
  revalidate()
}
