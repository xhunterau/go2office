// What a platform push reports back, shared by the Shopify and eBay adapters
// and the sync that records it (src/lib/fulfillment/platform-sync.ts).

export type PushOutcome = {
  /**
   * created   -- a new fulfillment on the platform.
   * updated   -- an existing one of ours now carries a new number (Retry after
   *              the tracking number changed).
   * already   -- the platform already holds exactly this; nothing was written.
   *              This is what makes a re-run after a lost response safe.
   * skipped   -- shipped on the platform some other way (e.g. by hand), and
   *              not with this tracking number. Nothing was written.
   */
  result: "created" | "updated" | "already" | "skipped"
  fulfillmentId: string | null
  /** One line for order_logs and the order page. */
  message: string
}

/** The platform refuses the order as it stands (cancelled, on hold); retrying will not help until someone acts. */
export class PlatformRefusalError extends Error {}
