import { createClient } from "@/lib/supabase/server"
import { fetchCarriers, fetchRateCard } from "@/lib/queries/shipping-reference"
import { positiveIntParam } from "@/lib/queries/search-params"
import { ShippingSectionHeader } from "../_components/section-header"
import { AddServiceButton } from "./_components/add-service-button"
import { RateCardCarrierTabs } from "./_components/rate-card-carrier-tabs"
import { RateCardMatrix } from "./_components/rate-card-matrix"

export default async function RateCardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const carriers = await fetchCarriers(supabase)

  if (!carriers.data) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <ShippingSectionHeader title="Rate Cards" description="Negotiated prices per weight tier and zone." />
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load carriers: {carriers.error}
        </div>
      </div>
    )
  }

  const requested = positiveIntParam(params, "carrier")
  const selected =
    carriers.data.find((carrier) => carrier.id === requested) ?? carriers.data[0]

  if (!selected) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <ShippingSectionHeader title="Rate Cards" description="Negotiated prices per weight tier and zone." />
        <p className="text-sm text-muted-foreground">
          No carriers yet. Add one first.
        </p>
      </div>
    )
  }

  const card = await fetchRateCard(supabase, selected.id)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ShippingSectionHeader
        title="Rate Cards"
        description={
          <p>
            {/* Two facts a table of numbers cannot state for itself. */}
            The negotiated price per weight tier and delivery zone. Rates apply
            from the next quote onwards — an order already quoted keeps the price
            it was given. Zones come from the postcode mapping and cannot be
            added here.
          </p>
        }
        action={<AddServiceButton carrierId={selected.id} />}
      />

      <RateCardCarrierTabs carriers={carriers.data} selectedId={selected.id} />

      {card.data ? (
        <RateCardMatrix
          services={card.data.services}
          zones={card.data.zones}
          rates={[...card.data.rates]}
        />
      ) : (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load the rate card: {card.error}
        </div>
      )}
    </div>
  )
}
