"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

const numberFormatter = new Intl.NumberFormat("en-AU")

// Pagination for a list whose total is a planner estimate.
//
// Not a variant of InventoryPagination: that component assumes an exact total,
// and every difference here follows from the total being approximate --
// "about N", a page count that can be wrong, and no jump-to-last control
// (docs/orders-ui.md 4.3 decision C). Sharing one component would mean an
// `isEstimate` branch through all of it.
// Both estimated lists in this round use it (203315 orders, 178024 customers),
// which is why it sits outside either domain folder.
export function EstimatedPagination({
  page,
  pageSize,
  total,
  isEstimate,
  rowCount,
  noun,
}: {
  page: number
  pageSize: number
  total: number
  isEstimate: boolean
  // Rows actually returned for this page. A short page is the one thing that is
  // certainly true about where the end is, whatever the estimate says.
  rowCount: number
  // Plural, for the empty message: "No orders found."
  noun: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = rowCount === 0 ? 0 : (page - 1) * pageSize + 1
  const to = (page - 1) * pageSize + rowCount

  // With an estimated total the computed page count can land either side of the
  // truth, so the estimate never gets to disable Next on its own -- a short page
  // does. Going one page past the end shows an empty table, which is recoverable;
  // being unable to reach the last page is not.
  const atEnd = rowCount < pageSize || (!isEstimate && page >= totalPages)

  function goTo(target: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (target <= 1) params.delete("page")
    else params.set("page", String(target))
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        {rowCount === 0
          ? `No ${noun} found.`
          : `Showing ${numberFormatter.format(from)}–${numberFormatter.format(to)} of ${
              isEstimate ? "about " : ""
            }${numberFormatter.format(total)}`}
      </p>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => page > 1 && goTo(page - 1)}
              aria-disabled={page <= 1}
              className={
                page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
              }
            />
          </PaginationItem>
          <PaginationItem>
            <span className="px-3 text-sm text-muted-foreground">
              {/* No "of N pages" when the count is estimated: 10,164 pages is
                  already past the point where the number means anything, and an
                  estimated one would just be wrong. */}
              Page {numberFormatter.format(page)}
              {!isEstimate && ` of ${numberFormatter.format(totalPages)}`}
            </span>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              onClick={() => !atEnd && goTo(page + 1)}
              aria-disabled={atEnd}
              className={
                atEnd ? "pointer-events-none opacity-50" : "cursor-pointer"
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
