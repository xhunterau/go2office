import { createClient } from "@/lib/supabase/server"
import { fetchLocations } from "@/lib/queries/locations"
import { LocationsTable } from "./_components/locations-table"

export default async function LocationsPage() {
  const supabase = await createClient()
  const { rows, error } = await fetchLocations(supabase)

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load locations: {error}
      </div>
    )
  }

  return <LocationsTable locations={rows} />
}
