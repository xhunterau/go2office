"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"

import { SEARCH_FIELDS, type SearchField } from "@/lib/queries/orders"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DEFAULT_FIELD: SearchField = "invoice"

const FIELD_LABELS: Record<SearchField, string> = {
  invoice: "Invoice",
  tracking: "Tracking",
  customer: "Customer",
  // "Suburb" is customers.city in the database (docs/orders-ui.md 4.1). The
  // label follows what an Australian user calls it, the query follows the
  // column name.
  location: "Suburb or postcode",
  sku: "SKU",
}

const PLACEHOLDERS: Record<SearchField, string> = {
  invoice: "Invoice number",
  tracking: "Tracking number",
  customer: "Name, email or eBay username",
  location: "Suburb or postcode",
  // The only exact dimension: a SKU is an identifier, not a description, and
  // matching it exactly reuses the unique index on products.sku instead of
  // needing a seventh trigram index (docs/orders-ui.md 5.3).
  sku: "Exact SKU",
}

// One search box with a dimension selector, not one box that guesses. The five
// dimensions resolve through different columns, indexes and match semantics, so
// running all five per keystroke would cost five queries and still leave the
// page picking which answer to show (docs/orders-ui.md 5.2).
export function OrdersSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const field =
    (SEARCH_FIELDS as readonly string[]).includes(searchParams.get("field") ?? "")
      ? (searchParams.get("field") as SearchField)
      : DEFAULT_FIELD
  const term = searchParams.get("q") ?? ""

  const commit = React.useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      params.delete("page")
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  // Local state keeps typing smooth; the URL follows 300ms after the last
  // keystroke. Syncs back when the URL changes from elsewhere (back button,
  // Clear filters).
  const [local, setLocal] = React.useState(term)
  const [previous, setPrevious] = React.useState(term)
  if (term !== previous) {
    setPrevious(term)
    setLocal(term)
  }

  React.useEffect(() => {
    if (local === term) return
    const timer = setTimeout(() => commit({ q: local.trim() || null }), 300)
    return () => clearTimeout(timer)
  }, [local, term, commit])

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Search</span>
      <div className="flex gap-2">
        <Select
          value={field}
          // Switching dimension re-runs the current term against the new one
          // rather than clearing it: the usual reason to switch is that the
          // term was pasted into the wrong dimension.
          onValueChange={(value) =>
            commit({ field: value === DEFAULT_FIELD ? null : value })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_FIELDS.map((value) => (
              <SelectItem key={value} value={value}>
                {FIELD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={local}
            onChange={(event) => setLocal(event.target.value)}
            placeholder={PLACEHOLDERS[field]}
            aria-label={`Search by ${FIELD_LABELS[field]}`}
            className="pl-8"
          />
        </div>
      </div>
    </div>
  )
}
