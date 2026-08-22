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

// Weights are kilograms throughout (products.weight, and everything
// order_metrics_summary derives from it). Three decimals because the catalogue
// is mostly small items: 0.03 kg rounds to nothing at one decimal place.
const weightFormatter = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

export function formatWeightKg(value: number | null): string {
  if (value === null) return "—"
  return `${weightFormatter.format(value)} kg`
}

// Dimensions are millimetres throughout, and are whole numbers in practice.
const dimensionFormatter = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
})

// One L x W x H string. Returns null when any edge is missing, because a
// partial box is not a measurement -- callers render their own placeholder.
export function formatDimensionsMm(
  length: number | null,
  width: number | null,
  height: number | null
): string | null {
  if (length === null || width === null || height === null) return null
  const parts = [length, width, height].map((n) => dimensionFormatter.format(n))
  return `${parts.join(" × ")} mm`
}

// Capitalises the first letter of every word and lowers the rest. Hyphenated
// parts count as words, so Timor-Leste survives.
//
// This is a suggestion rather than a rule, and the distinction is the whole
// point: it is applied on blur in the country form and never inside a Zod
// schema, because it gets real names wrong -- "Bosnia and Herzegovina" comes
// back as "Bosnia And Herzegovina" -- and the user has to be able to type the
// correct form and keep it. Nothing downstream depends on the casing:
// standardize_customer_address() matches on lower(country_name), so this is
// display only.
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_match, boundary: string, letter: string) =>
        boundary + letter.toUpperCase()
    )
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

// Date and time. Unlike formatDate above, this one is for timestamps the app
// itself writes -- a quote batch's quoted_at, for instance -- where the time is
// a real fact and two runs on the same day have to be tellable apart.
const dateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormatter.format(parsed)
}
