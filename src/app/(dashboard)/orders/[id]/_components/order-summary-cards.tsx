import Link from "next/link"
import { AlertTriangle, ExternalLink } from "lucide-react"

import type { OrderDetail } from "@/lib/queries/orders"
import {
  formatDate,
  formatDimensionsMm,
  formatMoney,
  formatWeightKg,
} from "@/lib/format"
import { displayShippingMethod } from "@/lib/orders/shipping-method"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CustomerCardActions } from "./customer-card-actions"

// Who, how and how much -- the three questions asked of an order before anyone
// looks at its lines (docs/orders-ui.md 6.2).
export function OrderSummaryCards({ order }: { order: OrderDetail }) {
  const customer = order.customers
  const shipping = displayShippingMethod(order)
  const metrics = order.metrics

  const packedSize = formatDimensionsMm(
    metrics.packed_length_mm,
    metrics.packed_width_mm,
    metrics.packed_height_mm
  )
  const dominantSize = formatDimensionsMm(
    metrics.dominant_length_mm,
    metrics.dominant_width_mm,
    metrics.dominant_height_mm
  )

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
    // Four cards now, so the three-column row would leave one stranded. Two up
    // on tablets, four across on a wide screen.
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Customer</CardTitle>
          {/* orders.customer_id is NOT NULL, so the actions always have a
              customer to act on even when the embed came back empty. */}
          <CardAction>
            <CustomerCardActions
              orderId={order.id}
              customerId={order.customer_id}
            />
          </CardAction>
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
            <span className="tabular-nums">{formatMoney(metrics.goods_total)}</span>
          </Field>
          <Field label="Postage charged">
            <span className="tabular-nums">
              {formatMoney(order.postage_and_handling)}
            </span>
          </Field>
          {order.discount > 0 && (
            <Field label="Discount">
              <span className="tabular-nums">
                −{formatMoney(order.discount)}
              </span>
            </Field>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3 font-medium">
            <span>Order total</span>
            <span className="tabular-nums">{formatMoney(metrics.order_total)}</span>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <Field label="Cost of goods">
              <span className="tabular-nums">{formatMoney(metrics.total_cost)}</span>
            </Field>
            <Field label="Postage paid">
              <span className="tabular-nums">
                {formatMoney(order.postage_paid)}
              </span>
            </Field>
            <Field label="Gross profit">
              <span
                className={cn(
                  "tabular-nums font-medium",
                  metrics.gross_profit < 0 && "text-destructive"
                )}
              >
                {formatMoney(metrics.gross_profit)}
              </span>
            </Field>
          </div>

          {/* Not a footnote. Legacy orders recorded no carrier cost, so profit
              on them is overstated by roughly the postage -- and that is 203315
              of the orders in the system (migration 20260808160000). Without
              this line the number reads as measured rather than partial. */}
          {order.postage_paid === 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              No carrier cost recorded — profit excludes what postage actually
              cost.
            </p>
          )}
          {metrics.uncosted_item_count > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {metrics.uncosted_item_count} item
              {metrics.uncosted_item_count === 1 ? " has" : "s have"} no cost on
              file — cost and profit are understated.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {metrics.transaction_count === 0
              ? "No transaction lines on this order."
              : `${metrics.transaction_count} transaction ${
                  metrics.transaction_count === 1 ? "line" : "lines"
                }`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Parcel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Items">
            <span className="tabular-nums">{metrics.total_items}</span>
          </Field>
          <Field label="Weight">
            <span className="tabular-nums">
              {formatWeightKg(metrics.total_weight_kg)}
            </span>
          </Field>
          <Field label="Chargeable">
            <span
              className={cn(
                "tabular-nums",
                // Worth pointing at: when volumetric wins, the parcel bills on
                // its size and shrinking the box is what saves money.
                metrics.chargeable_weight_kg > metrics.total_weight_kg &&
                  "font-medium"
              )}
            >
              {formatWeightKg(metrics.chargeable_weight_kg)}
            </span>
          </Field>

          <div className="space-y-3 border-t border-border pt-3">
            <Field label="Packed size">
              <span className="tabular-nums">{packedSize ?? "—"}</span>
            </Field>
            {/* The two sizes answer different questions and are both worth
                showing. Packed assumes every item stacks in its own footprint,
                which is what to use when nothing nests; dominant is the
                heaviest item's own carton, which is what to quote when the
                small things ride inside it. */}
            <Field label="Largest item">
              <span className="tabular-nums">{dominantSize ?? "—"}</span>
            </Field>
          </div>

          {metrics.has_estimated_dimensions && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              At least one product has no recorded size — the packed size is an
              estimate.
            </p>
          )}
          {metrics.unresolved_item_count > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {metrics.unresolved_item_count} item
              {metrics.unresolved_item_count === 1 ? "" : "s"} could not be
              matched to a product — weight and size exclude
              {metrics.unresolved_item_count === 1 ? " it" : " them"}.
            </p>
          )}
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
