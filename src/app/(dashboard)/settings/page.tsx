import { createClient } from "@/lib/supabase/server"
import { fetchPricingSettings } from "@/lib/queries/product-pricing"
import { PricingSettingsForm } from "./_components/pricing-settings-form"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { settings, error } = await fetchPricingSettings(supabase)

  // The row is seeded by migration and cannot be inserted from the app (there is
  // no insert policy), so a missing row means something is wrong with the
  // database rather than with this request.
  if (error || !settings) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load system constants
        {error ? `: ${error}` : ". The settings row is missing."}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          System Constants
        </h1>
        <p className="text-sm text-muted-foreground">
          Global exchange rates, freight rates, and tax settings used by the
          pricing engine. Changing them updates every product cost immediately.
        </p>
      </div>

      <PricingSettingsForm settings={settings} />
    </div>
  )
}
