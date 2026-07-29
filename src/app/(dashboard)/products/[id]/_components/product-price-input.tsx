"use client"

import * as React from "react"

import { charmPrice } from "@/lib/pricing"
import { Input } from "@/components/ui/input"

/**
 * Price input that snaps to `.95` cents on blur.
 *
 * The same `charmPrice` the suggested retail price uses, applied to whatever the
 * user typed, so a hand-entered price lands on the same grid as a suggested one.
 * The snap is announced rather than silent — a price changing under you without
 * explanation is worse than the untidy number it replaced.
 */
export function ProductPriceInput({
  value,
  onChange,
  onBlur,
  name,
  step,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  name: string
  step: string
  placeholder?: string
  disabled?: boolean
}) {
  const [snappedFrom, setSnappedFrom] = React.useState<string | null>(null)

  function handleBlur() {
    const raw = value.trim()
    const parsed = Number(raw)

    // Leave blanks and anything unparseable alone; the Zod schema owns those.
    if (raw !== "" && Number.isFinite(parsed) && parsed > 0) {
      const snapped = charmPrice(parsed)
      if (snapped !== parsed) {
        onChange(snapped.toFixed(2))
        setSnappedFrom(raw)
      }
    }

    onBlur()
  }

  return (
    <div className="grid gap-1">
      <Input
        type="number"
        inputMode="decimal"
        name={name}
        step={step}
        min="0"
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          // Typing again invalidates the previous snap notice.
          if (snappedFrom !== null) setSnappedFrom(null)
          onChange(event.target.value)
        }}
        onBlur={handleBlur}
      />
      {snappedFrom !== null && (
        <p className="text-xs text-muted-foreground">
          Snapped from {snappedFrom}
        </p>
      )}
    </div>
  )
}
