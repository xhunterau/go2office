import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { fetchAddressStageOrders } from "@/lib/queries/allocation"

import { AddressStageClient } from "../_components/address-stage-client"

export default async function AddressStagePage() {
  const supabase = await createClient()
  const orders = await fetchAddressStageOrders(supabase)

  // Read on the server so the page can say the search is unavailable, rather
  // than rendering a permanently disabled "Loading address search…" box.
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          href="/fulfillment/allocation"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Order Allocation
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Address</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pending orders whose suburb and postcode do not match{" "}
          <Link
            href="/settings/postcodes"
            className="font-medium text-foreground underline underline-offset-4"
          >
            the postcode reference
          </Link>
          . Run the check to clear everything that does match; what is left is
          here. Correct the address or accept it as it stands — either way the
          order moves on to Postage.
        </p>
      </div>

      {orders.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-foreground">
            The address queue could not be loaded.
          </p>
          <p className="mt-1 text-muted-foreground">{orders.error}</p>
        </div>
      ) : (
        <AddressStageClient orders={orders.data ?? []} mapsApiKey={mapsApiKey} />
      )}
    </div>
  )
}
