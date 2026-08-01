"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

import { STOCK_STATUS_ALL } from "@/lib/queries/inventory"
import type { LocationOption } from "@/lib/queries/locations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Sentinel used for the "All" choice — shadcn SelectItem forbids empty values.
// Shared with the stock filter, where it is a real URL value rather than a
// sentinel: see STOCK_STATUS_ALL.
const ALL = STOCK_STATUS_ALL

// The stock filter defaults to "in stock" instead of "everything", so an absent
// param is that choice rather than no choice.
const DEFAULT_STATUS = "in_stock"

const TEXT_FIELDS = ["sku", "name"] as const
type TextField = (typeof TEXT_FIELDS)[number]

const TEXT_LABELS: Record<TextField, string> = {
  sku: "SKU",
  name: "Name",
}

const FILTER_KEYS = ["sku", "name", "locationId", "status"] as const

export function InventoryFilters({
  locations,
}: {
  locations: LocationOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Push a set of param changes to the URL. Any filter change resets page to 1.
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
      {TEXT_FIELDS.map((field) => (
        <TextFilter
          key={field}
          field={field}
          label={TEXT_LABELS[field]}
          value={searchParams.get(field) ?? ""}
          onCommit={(value) => commit({ [field]: value })}
        />
      ))}

      {/* Only locations actually holding units match: a row at zero records
          where a product belongs, not what is there to pick. */}
      <SelectFilter
        label="Location"
        value={searchParams.get("locationId") ?? ALL}
        placeholder="All locations"
        options={locations.map((location) => ({
          value: String(location.id),
          label: location.name,
        }))}
        onChange={(v) => commit({ locationId: v === ALL ? null : v })}
      />

      {/* Zero-stock products are hidden until asked for: "All" or "Out of
          stock" both put an explicit status in the URL, and clearing filters
          returns to "In stock". */}
      <SelectFilter
        label="Stock"
        value={searchParams.get("status") ?? DEFAULT_STATUS}
        placeholder="All"
        options={[
          { value: DEFAULT_STATUS, label: "In stock" },
          { value: "out_of_stock", label: "Out of stock" },
        ]}
        onChange={(v) => commit({ status: v === DEFAULT_STATUS ? null : v })}
      />

      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() =>
            commit({ sku: null, name: null, locationId: null, status: null })
          }
        >
          <X />
          Clear
        </Button>
      )}
    </div>
  )
}

// Debounced text input. Local state keeps typing smooth; the URL is updated
// 300ms after the last keystroke. Syncs back when the URL value changes
// externally (e.g. browser back/forward or Clear).
function TextFilter({
  field,
  label,
  value,
  onCommit,
}: {
  field: TextField
  label: string
  value: string
  onCommit: (value: string | null) => void
}) {
  const [local, setLocal] = React.useState(value)
  const [prevValue, setPrevValue] = React.useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setLocal(value)
  }

  React.useEffect(() => {
    if (local === value) return
    const timer = setTimeout(() => onCommit(local.trim() || null), 300)
    return () => clearTimeout(timer)
  }, [local, value, onCommit])

  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={`inventory-filter-${field}`}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative w-40">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`inventory-filter-${field}`}
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          placeholder={`Search ${label}`}
          className="pl-8"
        />
      </div>
    </div>
  )
}

function SelectFilter({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
