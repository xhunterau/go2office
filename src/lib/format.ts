// Display formatting shared across list and detail pages.
//
// Both formatters are module-level singletons: Intl constructors are expensive
// enough that building one per table cell is measurable on a 20-row page.

// Every amount in the orders domain is AUD -- the legacy system had no currency
// column on orders and the business sells domestically. This is deliberately
// not parameterised by currency, unlike the product retail price, where getting
// that wrong labelled 2258 Australian prices as CNY.
const moneyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
})

export function formatMoney(value: number | null): string {
  if (value === null) return "—"
  return moneyFormatter.format(value)
}

// Date only, no time. orders.created_at is a timestamp, but the legacy system
// stored no time component, so every migrated order reads 00:00 -- showing it
// would be showing a fact that is not there.
const dateFormatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" })

export function formatDate(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormatter.format(parsed)
}
