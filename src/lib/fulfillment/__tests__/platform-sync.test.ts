import { describe, expect, it } from "vitest"

import type { Shipment } from "@/lib/fulfillment/platform-carriers"
import { MAX_AUTO_ATTEMPTS, shouldPush } from "@/lib/fulfillment/platform-sync"

const tracked: Shipment = { tracked: true, carrier: "australia_post", trackingNumber: "33GLH0035717" }
const row = (status: "pending" | "succeeded" | "failed" | "skipped", attempts = 0, tracking_number: string | null = null) => ({
  status,
  attempts,
  tracking_number,
})

describe("shouldPush", () => {
  it("pushes a pending row, automatically or not", () => {
    expect(shouldPush(row("pending"), tracked, false)).toBe(true)
  })

  it("retries a failure automatically only while tries remain", () => {
    expect(shouldPush(row("failed", MAX_AUTO_ATTEMPTS - 1), tracked, false)).toBe(true)
    expect(shouldPush(row("failed", MAX_AUTO_ATTEMPTS), tracked, false)).toBe(false)
    expect(shouldPush(row("failed", MAX_AUTO_ATTEMPTS), tracked, true)).toBe(true)
  })

  it("re-pushes a skipped row only on Retry", () => {
    expect(shouldPush(row("skipped"), tracked, false)).toBe(false)
    expect(shouldPush(row("skipped"), tracked, true)).toBe(true)
  })

  it("re-pushes a success only on Retry, and only when the number changed", () => {
    expect(shouldPush(row("succeeded", 1, "33GLH0035717"), tracked, true)).toBe(false)
    expect(shouldPush(row("succeeded", 1, "33glh0035717"), tracked, true)).toBe(false)
    expect(shouldPush(row("succeeded", 1, "OLD"), tracked, false)).toBe(false)
    expect(shouldPush(row("succeeded", 1, "OLD"), tracked, true)).toBe(true)
    // A letter marked shipped that now has a real number.
    expect(shouldPush(row("succeeded", 1, null), tracked, true)).toBe(true)
  })

  it("never re-pushes a success for an untracked shipment", () => {
    expect(shouldPush(row("succeeded", 1, null), { tracked: false }, true)).toBe(false)
  })
})
