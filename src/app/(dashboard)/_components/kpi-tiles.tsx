import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"

import { percentChange, type Kpis } from "@/lib/dashboard/sales"
import { formatMoney } from "@/lib/format"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"

const numberFormatter = new Intl.NumberFormat("en-AU")
const percentFormatter = new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 0 })

// Direction is shown by icon and sign, in body ink: a rise in orders is not a
// status, so it does not borrow the reserved good / critical colours.
function Change({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous)
  if (change === null) {
    return <p className="text-xs text-muted-foreground">No orders the week before</p>
  }
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      <span className="font-medium tabular-nums text-foreground">
        {change > 0 ? "+" : ""}
        {percentFormatter.format(change)}
      </span>
      vs previous 7 days
    </p>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {children}
    </div>
  )
}

export function KpiTiles({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Tile label="Orders today" value={numberFormatter.format(kpis.ordersToday)}>
        <p className="text-xs text-muted-foreground">
          {kpis.ordersTodayByPlatform.length === 0
            ? "None yet"
            : kpis.ordersTodayByPlatform
                .map((part) => `${SALES_PLATFORM_LABELS[part.platform]} ${part.count}`)
                .join(" · ")}
        </p>
      </Tile>
      <Tile label="Shipped today" value={numberFormatter.format(kpis.shippedToday)}>
        <p className="text-xs text-muted-foreground">By posted date</p>
      </Tile>
      <Tile label="Orders · last 7 days" value={numberFormatter.format(kpis.orders7d)}>
        <Change current={kpis.orders7d} previous={kpis.ordersPrev7d} />
      </Tile>
      <Tile label="Sales · last 7 days" value={formatMoney(kpis.sales7d)}>
        <Change current={kpis.sales7d} previous={kpis.salesPrev7d} />
      </Tile>
      <Tile label="Avg order value · 7 days" value={formatMoney(kpis.avgOrderValue7d)}>
        <p className="text-xs text-muted-foreground">Goods + postage − discount</p>
      </Tile>
    </div>
  )
}
