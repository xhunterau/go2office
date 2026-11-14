import { createClient } from "@/lib/supabase/server"
import { fetchDebugSettings } from "@/lib/queries/debug-settings"
import { DebugSettingCard } from "./_components/debug-setting-card"

export default async function DebugSettingsPage() {
  const supabase = await createClient()
  const { rows, error } = await fetchDebugSettings(supabase)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Debug</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Runtime overrides for testing against live data. A change applies to
          the next run, with no deploy. Turn a switch off when you are done:
          while it is on, the feature it controls does not behave normally.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load debug settings: {error}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No debug settings configured.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <DebugSettingCard key={row.key} setting={row} />
          ))}
        </div>
      )}
    </div>
  )
}
