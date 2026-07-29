// Pricing helpers shared by the product forms and the pricing breakdown UI.
// The numbers themselves are computed by the `public.product_pricing` view; this
// module only mirrors the one formula the client also needs, plus display
// formatting.

/**
 * Snap a price to `.95` cents, keeping the dollar amount.
 *
 * MIRROR OF SQL: `public.charm_price(numeric)` in
 * `supabase/migrations/20260729120000_create_product_pricing_view.sql`.
 * Both sides must change together — see CLAUDE.md rule 17. If they drift, the
 * price the form snaps to stops matching the suggested price the view computes.
 *
 * The rule is neither "round up" nor "round to nearest": `24.10 -> 24.95` moves
 * up 0.85 while `19.99 -> 19.95` moves down 0.04. Only the cents change, so a
 * price never crosses into the next dollar band.
 *
 * Idempotent: `charmPrice(19.95) === 19.95`, which is what makes it safe to run
 * on every blur.
 *
 * Non-positive and non-finite inputs are returned untouched — `Math.floor(-0.3)`
 * is `-1`, which would produce a meaningless `-0.05`.
 */
export function charmPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value
  // Round back through integer cents: 19 + 0.95 evaluates to 19.949999999999996
  // in binary floating point, and that value would render as 19.95 but fail an
  // equality check against the SQL side.
  return Math.round((Math.floor(value) + 0.95) * 100) / 100
}

/**
 * Render a volume in the unit that keeps it readable.
 *
 * Products are stored in mm, so a small item is ~0.000048 m³ — technically
 * correct and completely unreadable on screen. Scale to litres or cm³ instead.
 */
export function formatVolume(cbm: number | null): string {
  if (cbm === null || !Number.isFinite(cbm)) return "—"
  if (cbm >= 0.1) return `${cbm.toFixed(3)} m³`
  if (cbm >= 0.001) return `${(cbm * 1000).toFixed(2)} L`
  return `${Math.round(cbm * 1_000_000)} cm³`
}

/** AUD money, or an em dash when the underlying cost could not be computed. */
export function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return `$${value.toFixed(2)}`
}

/** Percentage with one decimal, or an em dash. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(1)}%`
}

/** Weight in kg, trimmed to gram precision. */
export function formatWeight(kg: number | null): string {
  if (kg === null || !Number.isFinite(kg)) return "—"
  return `${kg.toFixed(3)} kg`
}

/** Drop the trailing zeros a numeric(10,2) column always carries. */
function trimDecimals(value: number): string {
  return String(Number(value.toFixed(2)))
}

/**
 * `L × W × H` in mm, or an em dash if any side is missing.
 *
 * A kit's height is null when its footprint is zero, so this has to survive a
 * partially populated triple rather than assume all three are present.
 */
export function formatDimensions(
  length: number | null,
  width: number | null,
  height: number | null
): string {
  const sides = [length, width, height]
  if (sides.some((side) => side === null || !Number.isFinite(side))) return "—"
  return `${sides.map((side) => trimDecimals(side as number)).join(" × ")} mm`
}
