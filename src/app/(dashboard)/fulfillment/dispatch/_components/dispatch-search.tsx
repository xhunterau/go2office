"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The only way into an order on /fulfillment/dispatch: the page deliberately
 * does not list the queue, so the operator opens the order whose parcel is in
 * front of them, found by the invoice number on the slip or the name on the
 * label. Focused on load so a barcode scanner can type straight into it.
 */
export function DispatchSearch({ initialTerm }: { initialTerm: string }) {
  const router = useRouter()
  const [term, setTerm] = React.useState(initialTerm)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = term.trim()
    router.push(value ? `/fulfillment/dispatch?q=${encodeURIComponent(value)}` : "/fulfillment/dispatch")
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-xl gap-2">
      <Input
        autoFocus
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        placeholder="Invoice number or customer name"
        aria-label="Invoice number or customer name"
      />
      <Button type="submit">
        <Search className="size-4" />
        Search
      </Button>
    </form>
  )
}
