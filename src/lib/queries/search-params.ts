// Shared helpers for turning a Next.js searchParams bag into typed filters.
//
// These were written twice (products, inventory) before the orders round needed
// them a third and fourth time. One copy, project rule 5.

export type SearchParams = Record<string, string | string[] | undefined>

// Escape PostgREST `ilike` wildcards so user input is matched literally. Without
// this a customer searching for "50%" gets every row.
export function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`)
}

// The same, for a pattern that goes inside an `or()` filter. Commas,
// parentheses, quotes and backslashes are PostgREST's own filter grammar, so
// they have to come out before the value is spliced into `sku.ilike.%x%,...`;
// escapeLike alone leaves the request malformed rather than unmatched.
export function orLikePattern(value: string): string {
  return `%${escapeLike(value.replace(/[,()"\\]/g, ""))}%`
}

// A trimmed, non-empty string, or null. Repeated params (?a=1&a=2) take the
// first value, which is what the filter bars produce when a control is reset
// and set in the same navigation.
export function textParam(params: SearchParams, key: string): string | null {
  const raw = params[key]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value ? value : null
}

// A positive integer, or null. Anything else (0, -1, 2.5, "abc") is treated as
// absent rather than as an error: these come from the URL, where a stale or
// hand-edited value should degrade to the default view, not break the page.
export function positiveIntParam(
  params: SearchParams,
  key: string
): number | null {
  const value = textParam(params, key)
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// A value constrained to a known set, or null. Used for enum-backed filters
// (order status, platform) so an unrecognised URL value cannot reach a query
// and produce a Postgres cast error.
export function enumParam<T extends string>(
  params: SearchParams,
  key: string,
  allowed: readonly T[]
): T | null {
  const value = textParam(params, key)
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

// A checkbox/switch filter. Only the literal "1" turns it on, so an absent or
// malformed param means off.
export function flagParam(params: SearchParams, key: string): boolean {
  return textParam(params, key) === "1"
}

// An ISO date (YYYY-MM-DD) from a date input, or null.
export function dateParam(params: SearchParams, key: string): string | null {
  const value = textParam(params, key)
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}
