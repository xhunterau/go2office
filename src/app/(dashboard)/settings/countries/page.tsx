import { createClient } from "@/lib/supabase/server"
import { fetchCountryList } from "@/lib/queries/countries"
import { AddCountryButton } from "./_components/add-country-button"
import { CountriesTable } from "./_components/countries-table"

export default async function CountriesPage() {
  const supabase = await createClient()
  const list = await fetchCountryList(supabase)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Countries</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {/* Three things the table itself cannot show: that it is small on
                purpose, that a miss is silent, and that edits do not look
                backwards. See CLAUDE.md rule 21. */}
            Reference data for collapsing country names onto ISO codes — typing
            Australia on a customer stores AU. Deliberately short: it lists the
            destinations this business actually ships to, and a name it does not
            recognise is stored exactly as typed rather than guessed at. Changes
            apply from the next save onwards and do not revisit existing
            customers.
          </p>
        </div>
        <AddCountryButton />
      </div>

      {list.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load countries: {list.error}
        </div>
      ) : (
        <CountriesTable rows={list.rows} />
      )}
    </div>
  )
}
