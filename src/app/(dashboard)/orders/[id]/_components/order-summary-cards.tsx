import Link from "next/link"
import { AlertTriangle, ExternalLink } from "lucide-react"

import type { OrderDetail } from "@/lib/queries/orders"
import { formatDate, formatMoney } from "@/lib/format"
import { displayShippingMethod } from "@/lib/orders/shipping-method"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Who, how and how much -- the three questions asked of an order before anyone
// looks at its lines (docs/orders-ui.md 6.2).
export function OrderSummaryCards({ order }: { order: OrderDetail }) {
  const customer = order.customers
  const shipping = displayShippingMethod(order)

  const addressLines = customer
    ? [
        customer.company_name,
        customer.address_line1,
        customer.address_line2,
        customer.address_line3,
        customer.address_line4,
        [customer.city, customer.state, customer.postcode]
          .filter(Boolean)
          .join(" "),
        customer.country,
      ].filter((line): line is string => Boolean(line && line.trim()))
    : []

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {customer ? (
            <>
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {customer.full_name ?? customer.platform_user_id ?? "—"}
                </p>
                {customer.platform_user_id && customer.full_name && (
                  <p className="text-muted-foreground">
                    {customer.platform_user_id}
                  </p>
                )}
                {customer.email && (
                  <p className="flex flex-wrap items-center gap-1.5 break-all text-muted-foreground">
                    {customer.email}
                    {/* 89287 customers carry an @members.ebay.com relay
                        address. Unmarked, the first person to build an email
                        feature will assume they are reachable. */}
                    {customer.is_anonymised_email && (
                      <Badge variant="inactive">Relay address</Badge>
                    )}
                  </p>
                )}
                {customer.phone && (
                  <p className="text-muted-foreground">{customer.phone}</p>
                )}
              </div>

              <div className="space-y-1 border-t border-border pt-3">
                {addressLines.length > 0 ? (
                  addressLines.map((line, index) => (
                    <p key={index} className="text-muted-foreground">
                      {line}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">No address on file.</p>
                )}
                {/* Not optional copy. The fourth review round moved the address
                    from orders to customers, and 8150 orders (4%) shipped to an
                    address this customer no longer has -- those are gone. Read
                    as a shipping address, this block is wrong on 1 order in 25
                    (docs/orders-ui.md 6.3). */}
                <p className="flex items-start gap-1.5 pt-2 text-xs text-warning-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Current customer address — not a snapshot of where this order
                  shipped.
                </p>
              </div>

              <Link
                href={`/customers/${order.customer_id}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View customer
                <ExternalLink className="size-3.5" />
              </Link>
            </>
          ) : (
            <p className="text-muted-foreground">No customer on this order.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Shipping</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Method">
            <span
              className={cn(
                (shipping.isRetired || shipping.isEmpty) &&
                  "text-muted-foreground"
              )}
            >
              {shipping.label}
              {shipping.isRetired && (
                <span className="ml-1 text-xs">(retired)</span>
              )}
            </span>
          </Field>
          <Field label="Tracking">{order.tracking_number ?? "—"}</Field>
          <Field label="Dispatched">{formatDate(order.posted_on_date)}</Field>
          <Field label="Web order ID">{order.web_order_id ?? "—"}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Goods">
            <span className="tabular-nums">{formatMoney(order.goods_total)}</span>
          </Field>
          <Field label="Postage">
            <span className="tabular-nums">
              {formatMoney(order.postage_and_handling)}
            </span>
          </Field>
          <div className="flex items-center justify-between border-t border-border pt-3 font-medium">
            <span>Order total</span>
            <span className="tabular-nums">{formatMoney(order.order_total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {order.transaction_count === 0
              ? "No transaction lines on this order."
              : `${order.transaction_count} transaction ${
                  order.transaction_count === 1 ? "line" : "lines"
                }`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  )
}
