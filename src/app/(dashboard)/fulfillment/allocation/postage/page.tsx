import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { countAddressQueue, fetchPostageStageOrders } from "@/lib/queries/allocation"

import { AllocationHeader, QueueLoadError } from "../_components/allocation-header"
import { PostageStageClient } from "../_components/postage-stage-client"

export default async function PostageStagePage() {
  const supabase = await createClient()
  const [orders, addressCount] = await Promise.all([
    fetchPostageStageOrders(supabase),
    countAddressQueue(supabase),
  ])

  return (
    <div className="flex flex-1 flex-col gap-4">
      <AllocationHeader
        title="Postage"
        active="postage"
        counts={
          orders.data && addressCount.data != null
            ? { address: addressCount.data, postage: orders.data.length }
            : null
        }
        description={
          <>
            Orders with a confirmed address, priced against every carrier that can take them.{" "}
            <strong>Nothing is approved automatically</strong> — approving moves the order to Processing for{" "}
            <Link href="/fulfillment/export-labels" className="font-medium text-foreground underline underline-offset-4">
              Export Labels
            </Link>
            .
          </>
        }
      />

      {orders.error ? (
        <QueueLoadError what="postage" message={orders.error} />
      ) : (
        <PostageStageClient orders={orders.data ?? []} />
      )}
    </div>
  )
}
