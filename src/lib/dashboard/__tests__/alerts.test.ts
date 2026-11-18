import { describe, expect, it } from "vitest"

import { buildAlerts, type AlertInputs } from "@/lib/dashboard/alerts"

const healthy: AlertInputs = {
  failedSyncs: 0,
  failedSyncOrders: [],
  stalePendingSyncs: 0,
  ebayWarning: null,
  ebayBlocked: false,
  fallbackError: null,
  nonAuPending: 0,
  unroutedProcessing: 0,
  unresolvedOrders: 0,
  unresolvedSample: [],
  loadErrors: [],
}

describe("buildAlerts", () => {
  it("returns nothing when everything is healthy", () => {
    expect(buildAlerts(healthy)).toEqual([])
  })

  it("puts critical alerts before warnings", () => {
    const alerts = buildAlerts({ ...healthy, nonAuPending: 2, failedSyncs: 1 })
    expect(alerts.map((a) => a.id)).toEqual(["failed-syncs", "non-au-pending"])
    expect(alerts.map((a) => a.tone)).toEqual(["critical", "warning"])
  })

  it("rates the eBay warning by whether the import is blocked", () => {
    const expiring = buildAlerts({ ...healthy, ebayWarning: "expires in 3 days" })
    expect(expiring[0].tone).toBe("warning")
    const expired = buildAlerts({ ...healthy, ebayWarning: "expired", ebayBlocked: true })
    expect(expired[0].tone).toBe("critical")
  })

  it("pluralises counts", () => {
    expect(buildAlerts({ ...healthy, unroutedProcessing: 1 })[0].title).toBe(
      "1 processing order with no label channel"
    )
    expect(buildAlerts({ ...healthy, unroutedProcessing: 3 })[0].title).toBe(
      "3 processing orders with no label channel"
    )
  })

  it("carries the affected orders as links", () => {
    const orders = [{ id: 7, invoiceNumber: "INV-7" }]
    const [alert] = buildAlerts({ ...healthy, unresolvedOrders: 1, unresolvedSample: orders })
    expect(alert.orders).toEqual(orders)
  })

  it("surfaces load failures instead of showing a false all-clear", () => {
    const [alert] = buildAlerts({ ...healthy, loadErrors: ["timeout", "denied"] })
    expect(alert.tone).toBe("critical")
    expect(alert.detail).toBe("timeout; denied")
  })
})
