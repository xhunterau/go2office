"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { AU_STATES } from "@/lib/validations/postcode"
import type { CarrierRow } from "@/lib/queries/shipping-reference"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Sentinel for the "All" choice — shadcn SelectItem forbids empty values.
const ALL = "all"

const FILTER_KEYS = ["postcode", "locality", "state", "carrier", "zone"] as const

export function ZonesFilters({
  carriers,
  zones,
}: {
  carriers: CarrierRow[]
  zones: string[]
}) {
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
      <TextFilter
        id="zones-filter-postcode"
        label="Postcode"
        placeholder="Starts with"
        width="w-32"
        value={searchParams.get("postcode") ?? ""}
        onCommit={(value) => commit({ postcode: value })}
      />
      <TextFilter
        id="zones-filter-locality"
        label="Locality"
        placeholder="Suburb name"
        width="w-56"
        value={searchParams.get("locality") ?? ""}
        onCommit={(value) => commit({ locality: value })}
      />

      <SelectFilter
        label="State"
        placeholder="All states"
        value={searchParams.get("state") ?? ALL}
        width="w-32"
        options={AU_STATES.map((state) => ({ value: state, label: state }))}
        onCommit={(value) => commit({ state: value })}
      />

      <SelectFilter
        label="Carrier"
        placeholder="All carriers"
        value={searchParams.get("carrier") ?? ALL}
        width="w-48"
        options={carriers.map((carrier) => ({
          value: String(carrier.id),
          label: carrier.name,
        }))}
        onCommit={(value) => commit({ carrier: value })}
      />

      <SelectFilter
        label="Zone"
        placeholder="All zones"
        value={searchParams.get("zone") ?? ALL}
        width="w-40"
        options={zones.map((zone) => ({
          value: zone,
          label: zone.replace(/_/g, " "),
        }))}
        onCommit={(value) => commit({ zone: value })}
      />

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

function SelectFilter({
  label,
  placeholder,
  value,
  width,
  options,
  onCommit,
}: {
  label: string
  placeholder: string
  value: string
  width: string
  options: { value: string; label: string }[]
  onCommit: (value: string | null) => void
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select
        value={value}
        onValueChange={(next) => onCommit(next === ALL ? null : next)}
      >
        <SelectTrigger className={width}>
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
