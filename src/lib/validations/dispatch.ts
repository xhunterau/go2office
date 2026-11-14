import { z } from "zod"

// Long enough for a raw GS1-128 scan (up to ~74 characters) before the
// database trims it to the carrier's article id (CLAUDE.md rule 20).
const MAX_TRACKING_LENGTH = 200

const trackingNumber = z
  .string()
  .trim()
  .min(1, "Enter a tracking number")
  .max(MAX_TRACKING_LENGTH, `Tracking number must be ${MAX_TRACKING_LENGTH} characters or fewer`)

const positiveId = z.number().int().positive()

/** The tracking field on /fulfillment/dispatch/[id]. */
export const trackingFormSchema = z.object({ tracking_number: trackingNumber })

export type TrackingFormValues = z.infer<typeof trackingFormSchema>

/** What dispatchOrder() accepts. The database re-checks every part of it. */
export const dispatchOrderSchema = z.object({
  order_id: positiveId,
  tracking_number: trackingNumber,
  picks: z.array(z.object({ order_item_id: positiveId, location_id: positiveId })),
  allow_shared_tracking: z.boolean().default(false),
})

export type DispatchOrderInput = z.input<typeof dispatchOrderSchema>
