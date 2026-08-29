import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { fetchPostageStageOrders } from "@/lib/queries/allocation"

import { PostageStageClient } from "../_components/postage-stage-client"

export default async function PostageStagePage() {
  const supabase = await createClient()
  const orders = await fetchPostageStageOrders(supabase)

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
        <h1 className="text-lg font-semibold text-foreground">Postage</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Orders with a confirmed address, priced against every carrier that can
          carry them. <strong>Nothing is approved automatically</strong> — open an
          order, read the rates, and pick one. Approving moves the order to{" "}
          <strong>Processing</strong>, where{" "}
          <Link
            href="/fulfillment/export-labels"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Export Labels
          </Link>{" "}
          picks it up.
        </p>
      </div>

      {orders.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-foreground">
            The postage queue could not be loaded.
          </p>
          <p className="mt-1 text-muted-foreground">{orders.error}</p>
        </div>
      ) : (
        <PostageStageClient orders={orders.data ?? []} />
      )}
    </div>
  )
}
