import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { countPostageQueue, fetchAddressStageOrders } from "@/lib/queries/allocation"

import { AddressStageClient } from "../_components/address-stage-client"
import { AllocationHeader, QueueLoadError } from "../_components/allocation-header"

export default async function AddressStagePage() {
  const supabase = await createClient()
  const [orders, postageCount] = await Promise.all([
    fetchAddressStageOrders(supabase),
    countPostageQueue(supabase),
  ])

  // Read on the server so the page can say the search is unavailable, rather
  // than rendering a permanently disabled "Loading address search…" box.
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""

  return (
    <div className="flex flex-1 flex-col gap-4">
      <AllocationHeader
        title="Address"
        active="address"
        counts={
          orders.data && postageCount.data != null
            ? { address: orders.data.length, postage: postageCount.data }
            : null
        }
        description={
          <>
            Pending orders whose suburb and postcode do not match{" "}
            <Link href="/settings/postcodes" className="font-medium text-foreground underline underline-offset-4">
              the postcode reference
            </Link>
            . Correct the address or accept it — either way the order moves on to Postage.
          </>
        }
      />

      {orders.error ? (
        <QueueLoadError what="address" message={orders.error} />
      ) : (
        <AddressStageClient orders={orders.data ?? []} mapsApiKey={mapsApiKey} />
      )}
    </div>
  )
}
