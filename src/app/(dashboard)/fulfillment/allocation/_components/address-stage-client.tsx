"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { APIProvider } from "@vis.gl/react-google-maps"
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { runAddressCheck } from "@/lib/actions/allocation"
import type { AddressStageOrder } from "@/lib/queries/allocation"

import { AddressOrderCard } from "./address-order-card"
import { InfoHint } from "./info-hint"

export function AddressStageClient({
  orders,
  mapsApiKey,
}: {
  orders: AddressStageOrder[]
  mapsApiKey: string
}) {
  const router = useRouter()
  const [isChecking, startCheck] = React.useTransition()

  function handleCheck() {
    startCheck(async () => {
      const result = await runAddressCheck()
      if (!result.success || !result.data) {
        toast.error("The address check failed", { description: result.error })
        return
      }

      const { verified } = result.data
      if (verified === 0) {
        toast.message("Nothing to clear", {
          description:
            "Every pending order either already has a confirmed address or needs one of the corrections below.",
        })
      } else {
        toast.success(
          `${verified} order${verified === 1 ? "" : "s"} passed to Postage`,
          { description: "Their suburb and postcode matched the reference." }
        )
      }
      router.refresh()
    })
  }

  const list = (
    <div className="flex flex-col gap-3">
      {orders.map((order) => (
        <AddressOrderCard key={order.id} order={order} searchEnabled={mapsApiKey !== ""} />
      ))}
    </div>
  )

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={handleCheck} disabled={isChecking}>
            {isChecking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Run address check
          </Button>
          {/* Worth saying, because the button finishing instantly on a queue of
              any size looks like it did nothing. It is one statement, not a
              per-order loop. */}
          <InfoHint>
            Checks every pending Australian order in a single pass and passes the ones that resolve to
            Postage. Safe to run at any time.
          </InfoHint>
        </div>
        <p className="text-sm text-muted-foreground">
          {orders.length === 0 ? (
            "Queue is clear"
          ) : (
            <>
              <span className="font-medium tabular-nums text-foreground">{orders.length}</span> order
              {orders.length === 1 ? "" : "s"} to review
            </>
          )}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
          <CheckCircle2 className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No addresses to review</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Every pending order has a confirmed address. Run the check after new
            orders arrive.
          </p>
        </div>
      ) : mapsApiKey ? (
        // One APIProvider around the whole list rather than one per card: it
        // loads the Maps JS bundle, and N copies of that is N loads.
        <APIProvider apiKey={mapsApiKey}>{list}</APIProvider>
      ) : (
        <>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            <span className="font-medium">Address search is off</span>
            <span className="text-muted-foreground">
              {" "}
              — NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set. Fields are still editable by hand and the postcode
              check still works.
            </span>
          </p>
          {list}
        </>
      )}
    </div>
  )
}
