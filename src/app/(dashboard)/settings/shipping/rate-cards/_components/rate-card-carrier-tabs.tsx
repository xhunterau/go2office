"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import type { CarrierRow } from "@/lib/queries/shipping-reference"
import { cn } from "@/lib/utils"

// The carrier lives in the URL rather than in state, so a rate card is a link
// someone can send — and so the server can fetch only the card being looked at.
export function RateCardCarrierTabs({
  carriers,
  selectedId,
}: {
  carriers: CarrierRow[]
  selectedId: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function select(id: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("carrier", String(id))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
      {carriers.map((carrier) => (
        <button
          key={carrier.id}
          type="button"
          onClick={() => select(carrier.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            carrier.id === selectedId
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
            !carrier.is_active && "italic"
          )}
        >
          {carrier.name}
          {!carrier.is_active && (
            <span className="ml-1.5 text-xs">(inactive)</span>
          )}
        </button>
      ))}
    </div>
  )
}
