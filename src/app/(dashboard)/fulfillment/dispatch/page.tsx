import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertCircle, ChevronRight, PackageCheck, SearchX } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
import { countDispatchQueue, searchDispatchQueue } from "@/lib/queries/dispatch"
import { fetchFailedSyncOrders } from "@/lib/queries/platform-fulfillment"
import { textParam } from "@/lib/queries/search-params"
import { createClient } from "@/lib/supabase/server"

import { DispatchSearch } from "./_components/dispatch-search"

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const term = textParam(await searchParams, "q")
  const supabase = await createClient()

  const [queue, results, failedSyncs] = await Promise.all([
    countDispatchQueue(supabase),
    term ? searchDispatchQueue(supabase, term) : Promise.resolve(null),
    fetchFailedSyncOrders(supabase),
  ])

  // A single match is the parcel in front of the operator (a scanned invoice
  // number almost always is), so open it instead of making them click through.
  // Server-side, so the results never flash; the redirect replaces the ?q=
  // history entry, and the detail page links back without q, so Back does not
  // bounce into it again.
  if (results && !results.error && results.rows.length === 1) {
    redirect(`/fulfillment/dispatch/${results.rows[0].id}`)
  }

  return (
    // Laid out for a tablet on the packing bench: one centred column, large
    // targets, nothing that needs a precise tap.
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 pt-6 pb-10 sm:pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <PackageCheck className="size-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dispatch</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Scan the invoice on the parcel in front of you.
          </p>
        </div>
        {queue.error ? null : (
          <Badge variant={queue.count > 0 ? "info" : "secondary"} className="px-3 py-1 text-sm">
            {queue.count} {queue.count === 1 ? "order" : "orders"} waiting
          </Badge>
        )}
      </div>

      <DispatchSearch initialTerm={term ?? ""} />

      {results?.error ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">The search failed.</p>
            <p className="mt-1 text-muted-foreground">{results.error}</p>
          </div>
        </div>
      ) : results && results.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <SearchX className="size-6 text-muted-foreground" />
          <p className="font-medium text-foreground">No labelled order matches &ldquo;{term}&rdquo;</p>
          <p className="text-sm text-muted-foreground">An order shows up here once its label has been exported.</p>
        </div>
      ) : results ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            {results.rows.length} orders match — tap the one to dispatch
          </p>
          {results.rows.map((row) => (
            <Link
              key={row.id}
              href={`/fulfillment/dispatch/${row.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 active:scale-[0.99] active:bg-accent"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold text-foreground">{row.invoice_number}</span>
                  <Badge variant="outline">{SALES_PLATFORM_LABELS[row.platform]}</Badge>
                </div>
                <p className="truncate text-base text-foreground">{row.customer_name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">
                  {row.shipping_method ? SHIPPING_METHOD_LABELS[row.shipping_method] : "No shipping method"} ·{" "}
                  {formatDate(row.created_at)}
                </p>
              </div>
              <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : null}

      {/* Here rather than only on the order page: nobody opens a completed
          order to check whether its platform update went through. */}
      {failedSyncs.total > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-foreground">
            {failedSyncs.total} Shopify / eBay {failedSyncs.total === 1 ? "update" : "updates"} failed. Open the
            order to see why and retry.
          </p>
          <ul className="flex flex-col gap-1">
            {failedSyncs.orders.map((row) => (
              <li key={row.order_id} className="flex flex-wrap gap-x-2">
                <Link
                  href={`/orders/${row.order_id}`}
                  className="font-mono font-medium text-foreground underline underline-offset-4"
                >
                  {row.invoice_number}
                </Link>
                <span className="text-muted-foreground">{row.last_error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
