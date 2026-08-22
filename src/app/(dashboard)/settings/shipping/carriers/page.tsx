import { createClient } from "@/lib/supabase/server"
import { fetchCarriers, fetchCarrierUsage } from "@/lib/queries/shipping-reference"
import { ShippingSectionHeader } from "../_components/section-header"
import { AddCarrierButton } from "./_components/add-carrier-button"
import { CarriersTable } from "./_components/carriers-table"

export default async function CarriersPage() {
  const supabase = await createClient()
  const list = await fetchCarriers(supabase)
  // Sequential, because the zone tally is counted per carrier and so needs the
  // ids first.
  const usage = await fetchCarrierUsage(
    supabase,
    (list.data ?? []).map((carrier) => carrier.id)
  )

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ShippingSectionHeader
        title="Carriers"
        description={
          <p>
            {/* The one thing the table cannot show: a carrier is only quoted if
                the code matches a capability entry in
                src/lib/shipping/carrier-capabilities.ts. */}
            The accounts this business holds. A carrier&apos;s code is a key the
            quote engine looks its weight and dimension limits up by — it is set
            once and cannot be edited afterwards. Retire a carrier by turning it
            off rather than deleting it: everything else on these pages hangs off
            its row.
          </p>
        }
        action={<AddCarrierButton />}
      />

      {list.data && usage.data ? (
        <CarriersTable rows={list.data} usage={[...usage.data]} />
      ) : (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load carriers: {list.error ?? usage.error}
        </div>
      )}
    </div>
  )
}
