// The health panel on the dashboard: things that are wrong but are not a queue
// anyone works through, so nothing else on screen would surface them.
//
// Pure, so the thresholds and wording are testable without a database. The
// loader in src/lib/queries/dashboard.ts gathers the inputs.

export type AlertTone = "critical" | "warning"

export type DashboardAlert = {
  id: string
  tone: AlertTone
  title: string
  detail?: string
  href?: string
  linkLabel?: string
  /** A few of the affected orders, linked, so the first one is one click away. */
  orders?: OrderRef[]
}

export type OrderRef = { id: number; invoiceNumber: string }

export type AlertInputs = {
  /** Write-backs to Shopify / eBay that ended in `failed`. */
  failedSyncs: number
  failedSyncOrders: OrderRef[]
  /** Write-backs still `pending` past STALE_SYNC_MS: the sweep is not running. */
  stalePendingSyncs: number
  ebayWarning: string | null
  ebayBlocked: boolean
  /** requireFallbacks()'s message, or null when the export can run. */
  fallbackError: string | null
  /** Pending orders outside Australia, which no allocation queue shows. */
  nonAuPending: number
  /** Processing orders whose method no label channel exports. */
  unroutedProcessing: number
  /** Open orders with item lines that resolved to no product. */
  unresolvedOrders: number
  unresolvedSample: OrderRef[]
  /** Queries that failed while building the dashboard. */
  loadErrors: string[]
}

/** The sweep runs every 15 minutes; an hour is four missed runs. */
export const STALE_SYNC_MS = 60 * 60 * 1000

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** Critical first, then warnings, each in the order written here. */
export function buildAlerts(input: AlertInputs): DashboardAlert[] {
  const alerts: DashboardAlert[] = []

  if (input.loadErrors.length > 0) {
    alerts.push({
      id: "load-errors",
      tone: "critical",
      title: "Some figures on this page could not be loaded",
      detail: input.loadErrors.join("; "),
    })
  }

  if (input.ebayWarning) {
    alerts.push({
      id: "ebay-authorization",
      tone: input.ebayBlocked ? "critical" : "warning",
      title: input.ebayWarning,
      detail:
        "eBay order import and tracking write-back both stop when it lapses. Re-run scripts/ebay/authorize.mjs.",
    })
  }

  if (input.fallbackError) {
    alerts.push({
      id: "shipping-fallbacks",
      tone: "critical",
      title: "Label exports are blocked",
      detail: input.fallbackError,
      href: "/settings/shipping/constants",
      linkLabel: "Open Shipping Constants",
    })
  }

  if (input.failedSyncs > 0) {
    alerts.push({
      id: "failed-syncs",
      tone: "critical",
      title: `${plural(input.failedSyncs, "tracking write-back")} failed`,
      detail: "The buyer has not been sent a tracking number for these orders.",
      href: "/fulfillment/dispatch",
      linkLabel: "Review on Dispatch",
      orders: input.failedSyncOrders,
    })
  }

  if (input.stalePendingSyncs > 0) {
    alerts.push({
      id: "stale-syncs",
      tone: "warning",
      title: `${plural(input.stalePendingSyncs, "tracking write-back")} waiting over an hour`,
      detail:
        "The 15-minute sweep should have picked these up. Check that sweep-platform-fulfillment is deployed and running.",
    })
  }

  if (input.unroutedProcessing > 0) {
    alerts.push({
      id: "unrouted-processing",
      tone: "warning",
      title: `${plural(input.unroutedProcessing, "processing order")} with no label channel`,
      detail:
        "Their shipping method is not exported by any card on Export Labels, so they will not appear there.",
      href: "/orders?status=processing",
      linkLabel: "View processing orders",
    })
  }

  if (input.nonAuPending > 0) {
    alerts.push({
      id: "non-au-pending",
      tone: "warning",
      title: `${plural(input.nonAuPending, "pending order")} outside Australia`,
      detail: "Allocation is Australia-only, so these have to be handled by hand.",
      href: "/orders?status=pending",
      linkLabel: "View pending orders",
    })
  }

  if (input.unresolvedOrders > 0) {
    alerts.push({
      id: "unresolved-items",
      tone: "warning",
      title: `${plural(input.unresolvedOrders, "open order")} with unmatched item lines`,
      detail:
        "A line's custom label matched no product SKU, so its weight, size and cost are missing and dispatch cannot pick it.",
      orders: input.unresolvedSample,
    })
  }

  return alerts.sort((a, b) =>
    a.tone === b.tone ? 0 : a.tone === "critical" ? -1 : 1
  )
}
