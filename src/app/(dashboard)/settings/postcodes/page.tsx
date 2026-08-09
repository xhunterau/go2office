import { createClient } from "@/lib/supabase/server"
import {
  fetchPostcodeList,
  parsePostcodeFilters,
  POSTCODES_PAGE_SIZE,
} from "@/lib/queries/postcodes"
import { EstimatedPagination } from "@/components/estimated-pagination"
import { AddPostcodeButton } from "./_components/add-postcode-button"
import { PostcodesFilters } from "./_components/postcodes-filters"
import { PostcodesTable } from "./_components/postcodes-table"

export default async function PostcodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parsePostcodeFilters(params)

  const supabase = await createClient()
  const list = await fetchPostcodeList(supabase, filters)

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Postcodes</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {/* Both halves of this matter and neither is visible from the UI:
                editing a customer's state by hand is undone on their next save
                (CLAUDE.md rule 21), and edits here are not retroactive. */}
            Australia Post reference data. A customer&apos;s state is derived
            from their postcode and suburb through this table, so changing a row
            here is the only durable way to correct it — a state typed on the
            customer itself is overwritten the next time that customer is saved.
            Changes apply from the next save onwards and do not revisit existing
            customers.
          </p>
        </div>
        <AddPostcodeButton />
      </div>

      <PostcodesFilters />

      {list.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load postcodes: {list.error}
        </div>
      ) : (
        <>
          <PostcodesTable rows={list.rows} />
          {/* Exact total, so isEstimate is false: the component's estimate
              branches (the "about" prefix, the hidden page count) switch off and
              it behaves as a plain paginator. */}
          <EstimatedPagination
            page={filters.page}
            pageSize={POSTCODES_PAGE_SIZE}
            total={list.count}
            isEstimate={false}
            rowCount={list.rows.length}
            noun="postcodes"
          />
        </>
      )}
    </div>
  )
}
