"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { MonthlyPoint } from "@/lib/dashboard/sales"
import { formatMoney } from "@/lib/format"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

import { YEAR_CHART_CONFIG } from "./chart-palette"

const monthFormatter = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" })
const monthYearFormatter = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })
const compactMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 0,
})

function monthDate(month: string) {
  return new Date(`${month}T00:00:00Z`)
}

export function MonthlySalesChart({ points }: { points: MonthlyPoint[] }) {
  const thisYearTotal = points.reduce((sum, point) => sum + point.thisYear, 0)
  const lastYearTotal = points.reduce((sum, point) => sum + point.lastYear, 0)
  const legend = [
    { key: "thisYear" as const, total: thisYearTotal },
    { key: "lastYear" as const, total: lastYearTotal },
  ]

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {legend.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: `var(--color-${item.key})` }} />
            {YEAR_CHART_CONFIG[item.key].label}
            <span className="font-medium tabular-nums text-foreground">{formatMoney(Math.round(item.total))}</span>
          </li>
        ))}
      </ul>

      <ChartContainer config={YEAR_CHART_CONFIG} className="aspect-auto h-56 w-full">
        <BarChart data={points} margin={{ left: 0, right: 4, top: 4 }} barGap={2}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: string) => monthFormatter.format(monthDate(value))}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => compactMoney.format(value)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as MonthlyPoint | undefined
                  if (!point) return ""
                  const label = monthYearFormatter.format(monthDate(point.month))
                  return point.partial ? `${label} (to date)` : label
                }}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="size-2.5 rounded-[2px]"
                        style={{ backgroundColor: `var(--color-${String(name)})` }}
                      />
                      {YEAR_CHART_CONFIG[name as keyof typeof YEAR_CHART_CONFIG]?.label ?? name}
                    </span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatMoney(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="thisYear" fill="var(--color-thisYear)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Bar dataKey="lastYear" fill="var(--color-lastYear)" radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Order totals (goods + postage − discount), excluding cancelled orders. The latest month is still in
        progress. Gross profit is left out until carrier postage is recorded on orders.
      </p>
    </div>
  )
}
