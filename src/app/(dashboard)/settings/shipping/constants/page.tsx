import { createClient } from "@/lib/supabase/server"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import { ShippingSectionHeader } from "../_components/section-header"
import { ShippingSettingsForm } from "./_components/shipping-settings-form"

export default async function ShippingConstantsPage() {
  const supabase = await createClient()
  const { data: settings, error } = await fetchShippingSettings(supabase)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ShippingSectionHeader
        title="Shipping Constants"
        description="Global limits and surcharges the quote engine applies on top of the rate cards. They are read once per quote, so a change here reaches every carrier at the same time."
      />

      {/* The row is seeded by migration and cannot be inserted from the app
          (there is no insert policy), so a missing row means something is wrong
          with the database rather than with this request. */}
      {settings ? (
        <ShippingSettingsForm settings={settings} />
      ) : (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load shipping constants{error ? `: ${error}` : "."}
        </div>
      )}
    </div>
  )
}
