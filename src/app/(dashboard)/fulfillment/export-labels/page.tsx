import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { countDispatchableOrders } from "@/lib/queries/fulfillment"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import { requireFallbacks } from "@/lib/fulfillment/types"
import {
  ARAMEX_METHODS,
  EPARCEL_METHODS,
  MYPOST_METHODS,
  SELF_PRINT_METHODS,
} from "@/lib/fulfillment/carrier-groups"

import { ExportLabelsClient } from "./_components/export-labels-client"

export default async function ExportLabelsPage() {
  const supabase = await createClient()

  const [selfPrint, mypost, eparcel, aramex, settings] = await Promise.all([
    countDispatchableOrders(supabase, SELF_PRINT_METHODS),
    countDispatchableOrders(supabase, MYPOST_METHODS),
    countDispatchableOrders(supabase, EPARCEL_METHODS),
    countDispatchableOrders(supabase, ARAMEX_METHODS),
    fetchShippingSettings(supabase),
  ])

  // Blank fallbacks stop the CSV exports and the Aramex batch (an unset value
  // must never reach a customer's parcel), so the page says so up front rather
  // than letting the operator find out by clicking.
  const fallbackError = settings.data ? requireFallbacks(settings.data).error : null

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Export Labels</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Orders sitting in <strong>Processing</strong>, grouped by how their
          label is produced. Exporting moves the whole group to{" "}
          <strong>Labelled</strong> and records it against each order — there is
          no partial export, so an order that cannot be mapped stops the batch
          rather than being skipped.
        </p>
      </div>

      {fallbackError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-foreground">
            Exporting is unavailable until the contact fallbacks are set.
          </p>
          <p className="mt-1 text-muted-foreground">{fallbackError}</p>
          <Link
            href="/settings/shipping/constants"
            className="mt-2 inline-block font-medium text-foreground underline underline-offset-4"
          >
            Open Shipping Constants
          </Link>
        </div>
      ) : null}

      <ExportLabelsClient
        selfPrintCount={selfPrint.data ?? 0}
        myPostCount={mypost.data ?? 0}
        eParcelCount={eparcel.data ?? 0}
        aramexCount={aramex.data ?? 0}
        exportsDisabled={fallbackError != null}
      />
    </div>
  )
}
