// Pick-location logic for /fulfillment/dispatch/[id]. Client-safe: the page
// recomputes shortages as the operator changes a location, and
// dispatch_order() (migration 20261114150000) repeats the same check under row
// locks, so nothing here is trusted for correctness -- it only decides what the
// page shows and pre-selects.

import type { ShippingMethod } from "@/lib/orders/shipping-method"

/** One order_items row to be picked. */
export type DispatchLine = {
  id: number
  product_id: number | null
  quantity: number
}

/** A product's stock in one location. */
export type StockSlot = {
  location_id: number
  location_name: string
  qty: number
}

/** What dispatch_order() takes as p_picks. */
export type DispatchPick = { order_item_id: number; location_id: number }

export type Shortage = {
  product_id: number
  location_id: number
  needed: number
  available: number
}

/** order_items id -> chosen location id, or null while none is chosen. */
export type PickChoice = Map<number, number | null>

/** The quantity of each product across the whole order. */
function neededByProduct(lines: DispatchLine[]): Map<number, number> {
  const needed = new Map<number, number>()
  for (const line of lines) {
    if (line.product_id === null) continue
    needed.set(line.product_id, (needed.get(line.product_id) ?? 0) + line.quantity)
  }
  return needed
}

/**
 * The location to pre-select: the one with the most stock, provided it covers
 * everything the order needs of that product. Counted per product rather than
 * per line, so two lines of the same product (a kit component also sold on its
 * own) default to one shelf that can serve both.
 *
 * Null when no single location covers it. The operator then has to choose, and
 * the shortage is shown -- silently pre-selecting a shelf that cannot fill the
 * line would only move the error to the submit.
 */
export function defaultPickLocation(needed: number, slots: StockSlot[]): number | null {
  const best = slots.reduce<StockSlot | null>(
    (top, slot) => (top === null || slot.qty > top.qty ? slot : top),
    null
  )
  return best !== null && best.qty >= needed ? best.location_id : null
}

export function defaultPicks(
  lines: DispatchLine[],
  stock: Map<number, StockSlot[]>
): PickChoice {
  const needed = neededByProduct(lines)
  const picks: PickChoice = new Map()
  for (const line of lines) {
    picks.set(
      line.id,
      line.product_id === null
        ? null
        : defaultPickLocation(needed.get(line.product_id) ?? 0, stock.get(line.product_id) ?? [])
    )
  }
  return picks
}

/**
 * Every product and location whose stock cannot cover what the chosen picks
 * take from it. Grouped the way dispatch_order() deducts: per product and
 * location, summed over lines.
 */
export function findShortages(
  lines: DispatchLine[],
  picks: PickChoice,
  stock: Map<number, StockSlot[]>
): Shortage[] {
  const taken = new Map<string, Shortage>()
  for (const line of lines) {
    const locationId = picks.get(line.id)
    if (line.product_id === null || locationId == null) continue

    const key = `${line.product_id}:${locationId}`
    const entry = taken.get(key) ?? {
      product_id: line.product_id,
      location_id: locationId,
      needed: 0,
      available:
        stock.get(line.product_id)?.find((slot) => slot.location_id === locationId)?.qty ?? 0,
    }
    entry.needed += line.quantity
    taken.set(key, entry)
  }
  return [...taken.values()].filter((entry) => entry.available < entry.needed)
}

/**
 * Whether the line needs a location dropdown rather than a plain label: more
 * than one place to take it from, or nothing pre-selected.
 */
export function needsLocationChoice(slots: StockSlot[], chosen: number | null): boolean {
  return slots.length !== 1 || chosen === null
}

/** The picks as dispatch_order() wants them, or null while any line lacks one. */
export function toDispatchPicks(lines: DispatchLine[], picks: PickChoice): DispatchPick[] | null {
  const result: DispatchPick[] = []
  for (const line of lines) {
    const locationId = picks.get(line.id)
    if (locationId == null) return null
    result.push({ order_item_id: line.id, location_id: locationId })
  }
  return result
}

/**
 * Two-digit year + six upper-case hex digits (format_invoice_number). A scan of
 * that shape is usually the packing slip, not the label.
 */
const INVOICE_PATTERN = /^[0-9A-F]{8}$/i

/**
 * A stamped letter has no label to scan, so its invoice number stands in as the
 * tracking number and is sent to the platforms as Australia Post's (user
 * decision, 2026-11-25; platform-carriers.ts). Register_Letter is not included:
 * it carries a real article id.
 */
export function usesInvoiceAsTracking(order: { shipping_method: ShippingMethod | null }): boolean {
  return order.shipping_method === "Letter"
}

/** What the dispatch page's tracking field starts with. */
export function defaultTrackingNumber(order: {
  shipping_method: ShippingMethod | null
  tracking_number: string | null
  invoice_number: string
}): string {
  const existing = order.tracking_number?.trim()
  if (existing) return existing
  return usesInvoiceAsTracking(order) ? order.invoice_number : ""
}

/**
 * Why a submitted value must not be saved as this order's tracking number
 * because it is an invoice number, or null when it may be.
 *
 *   "this_order"  -- the order's own invoice on a parcel (the slip was scanned);
 *   "other_order" -- another order's invoice: that order is the one to open.
 *
 * `keepsExisting` exempts the stored number: some historical orders carry their
 * invoice number in the tracking field already (rule 27).
 */
export function invoiceScanProblem(
  value: string,
  order: { shipping_method: ShippingMethod | null; invoice_number: string },
  keepsExisting: boolean
): "this_order" | "other_order" | null {
  if (keepsExisting || !INVOICE_PATTERN.test(value)) return null
  if (value.toUpperCase() !== order.invoice_number.toUpperCase()) return "other_order"
  return usesInvoiceAsTracking(order) ? null : "this_order"
}
