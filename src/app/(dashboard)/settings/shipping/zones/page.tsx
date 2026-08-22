import { createClient } from "@/lib/supabase/server"
import { fetchCarriers } from "@/lib/queries/shipping-reference"
import {
  fetchPostcodeZoneList,
  fetchZoneOptions,
  parsePostcodeZoneFilters,
  POSTCODE_ZONES_PAGE_SIZE,
} from "@/lib/queries/postcode-carrier-zones"
import { EstimatedPagination } from "@/components/estimated-pagination"
import { ShippingSectionHeader } from "../_components/section-header"
import { ZonesFilters } from "./_components/zones-filters"
import { ZonesTable } from "./_components/zones-table"

export default async function PostcodeZonesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parsePostcodeZoneFilters(params)

  const supabase = await createClient()
  const [list, carriers, zoneOptions] = await Promise.all([
    fetchPostcodeZoneList(supabase, filters),
    fetchCarriers(supabase),
    fetchZoneOptions(supabase),
  ])

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ShippingSectionHeader
        title="Postcode Zones"
        description={
          <p>
            {/* Why there is no edit control here, said before anyone looks for
                one. */}
            The delivery zone each suburb falls in, per carrier — the column a
            rate card is read by. Read-only: this mapping is imported from the
            carriers&apos; own zone files rather than maintained by hand, so a
            correction means a re-import. Suburbs themselves are edited under
            Settings → Postcodes.
          </p>
        }
      />

      <ZonesFilters carriers={carriers.data ?? []} zones={zoneOptions} />

      {list.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load postcode zones: {list.error}
        </div>
      ) : (
        <>
          <ZonesTable rows={list.rows} carriers={carriers.data ?? []} />
          {/* Exact total, so isEstimate is false: the filters cut this table
              down hard, and a count over an indexed filter is cheap enough. */}
          <EstimatedPagination
            page={filters.page}
            pageSize={POSTCODE_ZONES_PAGE_SIZE}
            total={list.count}
            isEstimate={false}
            rowCount={list.rows.length}
            noun="zone rows"
          />
        </>
      )}
    </div>
  )
}
