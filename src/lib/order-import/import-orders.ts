import type { Json } from "@/lib/supabase/database.types"

// The part of a platform order import that does not depend on the platform:
// map each fetched order, hand it to the database one at a time, and tally what
// happened. Shared by import-shopify-orders and import-ebay-orders, whose pages
// render the same result with OrderImportButton.

export interface ImportFailure {
  /** The order as the operator knows it: "#G2B24707", "326100". */
  name: string
  reason: string
}

export interface OrderImportResult {
  /** The debug test order this run was narrowed to, or null for a full import. */
  testOrder: string | null
  fetched: number
  /** New orders created. */
  imported: number
  /**
   * Orders added to the same customer's pending order. Each one sent that order
   * back to the Address queue and deleted its quotes, so they are listed by
   * invoice for the operator to look at again.
   */
  merged: number
  mergedInvoices: string[]
  /** Already in go2office -- by this import or by Laravel before the cutover. */
  duplicates: number
  /** Not for go2office (cancelled, test, nothing to ship). Never sent to the database. */
  ignored: number
  failures: ImportFailure[]
  /**
   * Things that went through (or were left out on purpose) but that the
   * operator should know about: an order skipped because the buyer asked to
   * cancel, a postage service with no mapping.
   */
  notices: ImportFailure[]
}

/** What a mapper decides for one order. */
export type MappedOrder<TPayload> =
  | { kind: "import"; payload: TPayload; notices?: string[] }
  | { kind: "skip"; reason: string; notice?: string }

/** What the SQL import function returns. */
export type ImportOutcome = {
  result: "imported" | "merged" | "skipped"
  order_id?: number
  invoice_number?: string
}

type ImportOptions<TOrder, TPayload> = {
  testOrder: string | null
  nameOf: (order: TOrder) => string
  map: (order: TOrder) => MappedOrder<TPayload>
  /** One RPC. Throws on a database error. */
  write: (payload: TPayload) => Promise<ImportOutcome>
  onProgress: (current: number, total: number) => Promise<void>
  log: {
    info: (message: string, data?: Record<string, unknown>) => void
    error: (message: string, data?: Record<string, unknown>) => void
  }
}

/**
 * Imports `orders` in the order given. Serial on purpose: an order may merge
 * into one created moments earlier in this same loop, which only works if that
 * one has committed.
 *
 * One bad order never stops the rest. The SQL function rolls a failed order
 * back whole, so there is nothing half-written to clean up, and the next run
 * retries it.
 */
export async function importOrders<TOrder, TPayload>(
  orders: TOrder[],
  options: ImportOptions<TOrder, TPayload>
): Promise<OrderImportResult> {
  const result: OrderImportResult = {
    testOrder: options.testOrder,
    fetched: orders.length,
    imported: 0,
    merged: 0,
    mergedInvoices: [],
    duplicates: 0,
    ignored: 0,
    failures: [],
    notices: [],
  }

  for (const [index, order] of orders.entries()) {
    const name = options.nameOf(order)
    try {
      const mapped = options.map(order)
      if (mapped.kind === "skip") {
        result.ignored += 1
        if (mapped.notice) result.notices.push({ name, reason: mapped.notice })
        options.log.info("Ignored order", { name, reason: mapped.reason })
      } else {
        const outcome = await options.write(mapped.payload)
        if (outcome.result === "imported") result.imported += 1
        else if (outcome.result === "merged") {
          result.merged += 1
          if (outcome.invoice_number) result.mergedInvoices.push(outcome.invoice_number)
        } else result.duplicates += 1

        // Only for orders that were written: a duplicate's notices were
        // reported the first time it came through.
        if (outcome.result !== "skipped") {
          for (const notice of mapped.notices ?? []) {
            result.notices.push({ name, reason: notice })
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error"
      result.failures.push({ name, reason })
      options.log.error("Order failed to import", { name, reason })
    }

    await options.onProgress(index + 1, orders.length)
  }

  return result
}

/**
 * Raised for an order that cannot be imported correctly. Counted as a failure
 * and reported by name, never imported in part.
 */
export class UnimportableOrderError extends Error {}

/** Platform money strings ("10.98") to numbers. A blank is 0; garbage throws. */
export function toAmount(value: string | null | undefined, field: string, orderName: string): number {
  const trimmed = value?.trim() ?? ""
  if (trimmed === "") return 0
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new UnimportableOrderError(`${orderName}: ${field} is not a number (${JSON.stringify(value)})`)
  }
  return parsed
}

/** Trimmed, or null when blank. */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Narrows the untyped RPC return value. */
export function asImportOutcome(data: Json): ImportOutcome {
  return data as unknown as ImportOutcome
}
