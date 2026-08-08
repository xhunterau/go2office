"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const TEXT_FILTERS = [
  {
    key: "q",
    label: "Customer",
    // One box over three columns, matching how the customer dimension works on
    // /orders: a user searching for a person does not know which of the three
    // the record was filed under.
    placeholder: "Name, email or eBay username",
    width: "w-64",
  },
  {
    key: "suburb",
    label: "Suburb",
    placeholder: "Suburb",
    width: "w-40",
  },
  {
    key: "postcode",
    label: "Postcode",
    // Prefix matched, which is all the btree index on postcode supports.
    placeholder: "Starts with",
    width: "w-32",
  },
] as const

const FILTER_KEYS = ["q", "suburb", "postcode", "hasOrders"] as const

export function CustomersFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

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

  const hasFilters = FILTER_KEYS.some((key) => searchParams.get(key))

  return (
    <div className="flex flex-wrap items-end gap-3">
      {TEXT_FILTERS.map((filter) => (
        <TextFilter
          key={filter.key}
          id={`customers-filter-${filter.key}`}
          label={filter.label}
          placeholder={filter.placeholder}
          width={filter.width}
          value={searchParams.get(filter.key) ?? ""}
          onCommit={(value) => commit({ [filter.key]: value })}
        />
      ))}

      {/* 1790 customers have no orders at all -- rows the deduplication kept but
          nothing references (docs/orders-domain-migration.md 13.4). */}
      <div className="flex h-9 items-center gap-2">
        <Switch
          id="customers-filter-has-orders"
          checked={searchParams.get("hasOrders") === "1"}
          onCheckedChange={(checked) =>
            commit({ hasOrders: checked ? "1" : null })
          }
        />
        <Label htmlFor="customers-filter-has-orders" className="text-sm">
          Has orders
        </Label>
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() =>
            commit(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))
          }
        >
          <X />
          Clear
        </Button>
      )}
    </div>
  )
}

// Debounced text input: local state keeps typing smooth, the URL follows 300ms
// after the last keystroke and syncs back when it changes from elsewhere.
function TextFilter({
  id,
  label,
  placeholder,
  width,
  value,
  onCommit,
}: {
  id: string
  label: string
  placeholder: string
  width: string
  value: string
  onCommit: (value: string | null) => void
}) {
  const [local, setLocal] = React.useState(value)
  const [previous, setPrevious] = React.useState(value)
  if (value !== previous) {
    setPrevious(value)
    setLocal(value)
  }

  React.useEffect(() => {
    if (local === value) return
    const timer = setTimeout(() => onCommit(local.trim() || null), 300)
    return () => clearTimeout(timer)
  }, [local, value, onCommit])

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className={cn("relative", width)}>
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>
    </div>
  )
}
