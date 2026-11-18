"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { DailyChart } from "@/lib/dashboard/sales"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

import { PLATFORM_CHART_CONFIG } from "./chart-palette"

const numberFormatter = new Intl.NumberFormat("en-AU")
// Dates are calendar strings; format them as UTC so the browser's own zone
// cannot move a bar to the neighbouring day.
const dayFormatter = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })
const weekdayFormatter = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

function formatDay(date: string, formatter = dayFormatter) {
  return formatter.format(new Date(`${date}T00:00:00Z`))
}

export function DailyOrdersChart({ chart }: { chart: DailyChart }) {
  const platforms = chart.platforms.map((part) => part.platform)
  const last = platforms.at(-1)

  return (
    <div className="flex flex-col gap-3">
      {/* Legend with the window's totals: two of the light-mode colours sit
          below 3:1 on the card, so every series carries its number in text. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {chart.platforms.map((part) => (
          <li key={part.platform} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px]"
              style={{ backgroundColor: `var(--color-${part.platform})` }}
            />
            {PLATFORM_CHART_CONFIG[part.platform].label}
            <span className="font-medium tabular-nums text-foreground">
              {numberFormatter.format(part.total)}
            </span>
          </li>
        ))}
      </ul>

      <ChartContainer config={PLATFORM_CHART_CONFIG} className="aspect-auto h-56 w-full">
        <BarChart data={chart.points} margin={{ left: 0, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatDay(value)}
          />
          <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const date = payload?.[0]?.payload?.date as string | undefined
                  return date ? formatDay(date, weekdayFormatter) : ""
                }}
              />
            }
          />
          {platforms.map((platform) => (
            <Bar
              key={platform}
              dataKey={platform}
              stackId="orders"
              fill={`var(--color-${platform})`}
              stroke="var(--card)"
              strokeWidth={1}
              radius={platform === last ? [4, 4, 0, 0] : 0}
              maxBarSize={24}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  )
}
