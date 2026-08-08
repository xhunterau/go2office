"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { X } from "lucide-react"

import { ORDER_STATUSES, SALES_PLATFORMS } from "@/lib/queries/orders"
import {
  ORDER_STATUS_LABELS,
  SALES_PLATFORM_LABELS,
} from "@/lib/orders/status"
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
import { Switch } from "@/components/ui/switch"
import { OrdersSearch } from "./orders-search"

// Sentinel for the "All" choice -- shadcn SelectItem forbids an empty value.
const ALL = "all"

const FILTER_KEYS = [
  "status",
  "platform",
  "notDispatched",
  "from",
  "to",
  "q",
  "field",
] as const

export function OrdersFilters() {
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

  const status = searchParams.get("status")
  // "Needs action" is a tab, not a status, so it has no entry here; the dropdown
  // falls back to All while that tab is active. Both controls write the same
  // param, so picking a status from here simply moves the tab selection.
  const statusValue =
    status && (ORDER_STATUSES as readonly string[]).includes(status)
      ? status
      : ALL

  const hasFilters = FILTER_KEYS.some((key) => searchParams.get(key))

  return (
    <div className="flex flex-wrap items-end gap-3">
      <OrdersSearch />

      {/* All ten statuses, including the four without a tab (new, pending,
          processing, issued). */}
      <SelectFilter
        label="Status"
        value={statusValue}
        placeholder="All statuses"
        options={ORDER_STATUSES.map((value) => ({
          value,
          label: ORDER_STATUS_LABELS[value],
        }))}
        onChange={(value) => commit({ status: value === ALL ? null : value })}
      />

      <SelectFilter
        label="Platform"
        value={searchParams.get("platform") ?? ALL}
        placeholder="All platforms"
        options={SALES_PLATFORMS.map((value) => ({
          value,
          label: SALES_PLATFORM_LABELS[value],
        }))}
        onChange={(value) => commit({ platform: value === ALL ? null : value })}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="orders-filter-from" className="text-xs text-muted-foreground">
          Created from
        </Label>
        <Input
          id="orders-filter-from"
          type="date"
          className="w-40"
          value={searchParams.get("from") ?? ""}
          onChange={(event) => commit({ from: event.target.value || null })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="orders-filter-to" className="text-xs text-muted-foreground">
          Created to
        </Label>
        <Input
          id="orders-filter-to"
          type="date"
          className="w-40"
          value={searchParams.get("to") ?? ""}
          onChange={(event) => commit({ to: event.target.value || null })}
        />
      </div>

      {/* Independent of status on purpose: 4497 completed orders were never
          dispatched and 113 cancelled ones were, so no status finds this set
          (docs/orders-ui.md 4.2.1). */}
      <div className="flex h-9 items-center gap-2">
        <Switch
          id="orders-filter-not-dispatched"
          checked={searchParams.get("notDispatched") === "1"}
          onCheckedChange={(checked) =>
            commit({ notDispatched: checked ? "1" : null })
          }
        />
        <Label htmlFor="orders-filter-not-dispatched" className="text-sm">
          Not dispatched
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
