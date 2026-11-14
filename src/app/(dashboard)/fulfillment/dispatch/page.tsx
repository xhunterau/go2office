import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
import { countDispatchQueue, searchDispatchQueue } from "@/lib/queries/dispatch"
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

  const [queue, results] = await Promise.all([
    countDispatchQueue(supabase),
    term ? searchDispatchQueue(supabase, term) : Promise.resolve(null),
  ])

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Dispatch</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Find the order for the parcel in front of you by its invoice number or
          the customer&apos;s name. Dispatching takes the items out of stock,
          records the tracking number and completes the order.{" "}
          {queue.error ? null : (
            <span className="font-medium text-foreground">
              {queue.count} {queue.count === 1 ? "order is" : "orders are"} waiting.
            </span>
          )}
        </p>
      </div>

      <DispatchSearch initialTerm={term ?? ""} />

      {results?.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-foreground">The search failed.</p>
          <p className="mt-1 text-muted-foreground">{results.error}</p>
        </div>
      ) : results && results.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No labelled order matches &ldquo;{term}&rdquo;. An order shows up here
          once its label has been exported.
        </p>
      ) : results ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Shipping</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Ordered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/fulfillment/dispatch/${row.id}`}
                      className="font-mono font-medium text-foreground underline underline-offset-4"
                    >
                      {row.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customer_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{SALES_PLATFORM_LABELS[row.platform]}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.shipping_method ? SHIPPING_METHOD_LABELS[row.shipping_method] : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.tracking_number ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}
