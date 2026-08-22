import { createClient } from "@/lib/supabase/server"
import {
  fetchCarriers,
  fetchDispatchOptions,
  fetchServiceTypesByCarrier,
} from "@/lib/queries/shipping-reference"
import { ShippingSectionHeader } from "../_components/section-header"
import { AddDispatchOptionButton } from "./_components/add-dispatch-option-button"
import { DispatchOptionsTable } from "./_components/dispatch-options-table"

export default async function DispatchOptionsPage() {
  const supabase = await createClient()
  const [options, carriers, serviceTypes] = await Promise.all([
    fetchDispatchOptions(supabase),
    fetchCarriers(supabase),
    fetchServiceTypesByCarrier(supabase),
  ])

  if (!options.data || !carriers.data || !serviceTypes.data) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <ShippingSectionHeader
          title="Dispatch Options"
          description="Which shipping methods get quoted."
        />
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load dispatch options:{" "}
          {options.error ?? carriers.error ?? serviceTypes.error}
        </div>
      </div>
    )
  }

  const usedMethods = options.data.map((option) => option.shipping_method)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ShippingSectionHeader
        title="Dispatch Options"
        description={
          <p>
            {/* The engine's entry point, and the thing that is invisible from
                anywhere else: no row here means no quote, regardless of what
                rates exist. */}
            One row per shipping method that takes part in quoting. A method
            without a row here is never priced, and switching a row off removes
            that option from every future quote without touching its rates or
            any quote already recorded.
          </p>
        }
        action={
          <AddDispatchOptionButton
            carriers={carriers.data}
            serviceTypes={[...serviceTypes.data]}
            usedMethods={usedMethods}
          />
        }
      />

      <DispatchOptionsTable
        rows={options.data}
        carriers={carriers.data}
        serviceTypes={[...serviceTypes.data]}
        usedMethods={usedMethods}
      />
    </div>
  )
}
