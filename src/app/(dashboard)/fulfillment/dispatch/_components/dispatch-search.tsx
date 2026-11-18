"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, ScanLine, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The only way into an order on /fulfillment/dispatch: the page deliberately
 * does not list the queue, so the operator opens the order whose parcel is in
 * front of them, found by the invoice number on the slip or the name on the
 * label. Focused on load so a barcode scanner can type straight into it.
 * A search with exactly one match opens that order directly (page.tsx);
 * only several matches show the results to choose from.
 */
export function DispatchSearch({ initialTerm }: { initialTerm: string }) {
  const router = useRouter()
  const [term, setTerm] = React.useState(initialTerm)
  const [isPending, startTransition] = React.useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = term.trim()
    startTransition(() => {
      router.push(value ? `/fulfillment/dispatch?q=${encodeURIComponent(value)}` : "/fulfillment/dispatch")
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          placeholder="Scan the invoice or type a customer name"
          aria-label="Invoice number or customer name"
          autoComplete="off"
          className="h-14 rounded-xl pl-12 text-lg md:text-lg"
        />
      </div>
      <Button type="submit" size="lg" className="h-14 rounded-xl text-base" disabled={isPending}>
        {isPending ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />}
        {isPending ? "Searching…" : "Search"}
      </Button>
    </form>
  )
}
