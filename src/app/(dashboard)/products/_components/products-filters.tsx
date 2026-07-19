"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type BrandOption = { id: number; name: string | null }
type SupplierOption = { id: number; company_name: string | null }

// Sentinel used for the "All" choice — shadcn SelectItem forbids empty values.
const ALL = "all"

const TEXT_FIELDS = ["sku", "name", "upc", "model"] as const
type TextField = (typeof TEXT_FIELDS)[number]

const TEXT_LABELS: Record<TextField, string> = {
  sku: "SKU",
  name: "Name",
  upc: "UPC",
  model: "Model",
}

export function ProductsFilters({
  brands,
  suppliers,
}: {
  brands: BrandOption[]
  suppliers: SupplierOption[]
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

  const hasFilters = TEXT_FIELDS.some((f) => searchParams.get(f)) ||
    ["brandId", "supplierId", "status", "isKit"].some((k) =>
      searchParams.get(k)
    )

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

      <SelectFilter
        label="Brand"
        value={searchParams.get("brandId") ?? ALL}
        placeholder="All brands"
        options={brands.map((b) => ({
          value: String(b.id),
          label: b.name ?? `#${b.id}`,
        }))}
        onChange={(v) => commit({ brandId: v === ALL ? null : v })}
      />

      <SelectFilter
        label="Supplier"
        value={searchParams.get("supplierId") ?? ALL}
        placeholder="All suppliers"
        options={suppliers.map((s) => ({
          value: String(s.id),
          label: s.company_name ?? `#${s.id}`,
        }))}
        onChange={(v) => commit({ supplierId: v === ALL ? null : v })}
      />

      <SelectFilter
        label="Status"
        value={searchParams.get("status") ?? ALL}
        placeholder="All"
        options={[
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
        onChange={(v) => commit({ status: v === ALL ? null : v })}
      />

      <SelectFilter
        label="Is Kit"
        value={searchParams.get("isKit") ?? ALL}
        placeholder="All"
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={(v) => commit({ isKit: v === ALL ? null : v })}
      />

      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() =>
            commit({
              sku: null,
              name: null,
              upc: null,
              model: null,
              brandId: null,
              supplierId: null,
              status: null,
              isKit: null,
            })
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
  // Sync back when the URL value changes externally (back/forward, Clear).
  // Adjusting state during render is React's recommended pattern here.
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
        htmlFor={`filter-${field}`}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative w-40">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`filter-${field}`}
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
