import { z } from "zod"

import {
  ARAMEX_METHODS,
  EPARCEL_METHODS,
  MYPOST_METHODS,
  SELF_PRINT_METHODS,
  UBI_METHODS,
} from "@/lib/fulfillment/carrier-groups"
import type { ShippingMethod } from "@/lib/orders/shipping-method"

/**
 * The delivery address, as the Address stage lets it be edited.
 *
 * Narrower than customerSchema on purpose. Three of the customer's address
 * fields are deliberately absent:
 *
 *   state    Derived, not entered. customers_standardize_address rewrites it
 *            from (postcode, suburb) on every write (CLAUDE.md rule 21), so a
 *            typed value is overwritten the instant it is saved. The form shows
 *            it read-only and this schema will not accept one.
 *   country  Allocation is AU-only; editing it here would eject the order from
 *            the queue mid-edit with no explanation.
 *   line3/4  114,161 of the 114,193 non-empty line3 values are `ebay:xxxx`
 *            reference codes, not address lines (CLAUDE.md rule 24). Exposing
 *            the field invites someone to "fix" one into a real address, and
 *            the label paths filter it by content anyway.
 */
export const allocationAddressSchema = z.object({
  // Required, unlike on the customer form. A customer record with no street is
  // merely incomplete; an order about to have a label printed for it is not
  // shippable, and this is the screen whose whole job is to catch that.
  address_line1: z
    .string()
    .trim()
    .min(1, "Street address is required")
    .max(255, "Street address is too long"),
  address_line2: z
    .string()
    .trim()
    .max(255, "Address line 2 is too long")
    .optional()
    .or(z.literal("")),
  // Labelled "Suburb" in the UI; the column is called city for the reason
  // parseCustomerFilters explains.
  city: z.string().trim().min(1, "Suburb is required").max(120, "Suburb is too long"),
  postcode: z
    .string()
    .trim()
    .regex(/^\d{3,4}$/, "Postcode must be 3 or 4 digits")
    // Stored padded, which is the form public.postcodes holds and the form the
    // standardisation trigger and the zone resolver both pad to before looking
    // anything up. Three digits is a Northern Territory postcode with its
    // leading zero dropped somewhere upstream; keeping it that way is what
    // makes those addresses unresolvable.
    .transform((value) => value.padStart(4, "0")),
})

export type AllocationAddressInput = z.input<typeof allocationAddressSchema>
export type AllocationAddressValues = z.output<typeof allocationAddressSchema>

/**
 * Methods an operator may approve an order onto by hand.
 *
 * Deliberately not the whole shipping_method enum: UNROUTED_METHODS
 * (Direct_Freight, Click_and_Collect) belong to no label channel, so an order
 * approved onto one would move to `processing` and then never appear on
 * /fulfillment/export-labels -- it would simply be gone. That is the exact
 * failure carrier-groups.ts exists to prevent, so the list is built from the
 * routed channels rather than from the enum.
 */
export const MANUAL_APPROVAL_METHODS = [
  ...SELF_PRINT_METHODS,
  ...MYPOST_METHODS,
  ...EPARCEL_METHODS,
  ...ARAMEX_METHODS,
  ...UBI_METHODS,
] as const satisfies readonly ShippingMethod[]

/**
 * One-click approvals offered on every order in the Postage dialog.
 *
 * These methods have no rate table, so the quote engine never returns a row for
 * them and they would otherwise only be reachable through "Approve without a
 * quote". postage_paid is what WE pay the carrier (stamps for a letter; a
 * Parcel Post satchel is bought in advance, so nothing is owed per order) --
 * not what the customer paid, which is postage_and_handling.
 *
 * Typed against MANUAL_APPROVAL_METHODS so a method with no label channel can
 * never be added here (CLAUDE.md rule 25).
 */
export const QUICK_APPROVALS = [
  { shipping_method: "Letter", postage_paid: 2.5 },
  { shipping_method: "Parcel_Post", postage_paid: 0 },
  // Billed by UBI separately rather than per order, like Parcel Post's
  // prepaid satchels (user decision, 2026-11-25).
  { shipping_method: "Ubi", postage_paid: 0 },
] as const satisfies readonly {
  shipping_method: (typeof MANUAL_APPROVAL_METHODS)[number]
  postage_paid: number
}[]

export type QuickApproval = (typeof QUICK_APPROVALS)[number]

const manualMethodSchema = z.enum(
  MANUAL_APPROVAL_METHODS as unknown as [ShippingMethod, ...ShippingMethod[]]
)

/**
 * Approving an order that no carrier could price.
 *
 * The rate is typed rather than chosen, so it is the operator's number and not
 * a quote: it lands in orders.postage_paid, which is what WE expect to pay the
 * carrier, and is not to be confused with postage_and_handling, which is what
 * the customer paid us.
 */
export const manualApprovalSchema = z.object({
  shipping_method: manualMethodSchema,
  postage_paid: z
    .number({ message: "Enter the postage cost" })
    .min(0, "Postage cannot be negative")
    .max(9999.99, "Postage looks wrong")
    .multipleOf(0.01, "Postage cannot have more than two decimal places"),
})

export type ManualApprovalInput = z.infer<typeof manualApprovalSchema>

/**
 * Statuses an operator may move an order to straight from the Postage dialog,
 * instead of approving it: waiting on stock, or something to sort out with the
 * customer. Both take the order out of the `pending` queue; neither touches its
 * shipping method, postage or quotes, so approving it later starts clean.
 */
export const HOLD_STATUSES = ["backorder", "issued"] as const

export const holdStatusSchema = z.enum(HOLD_STATUSES)

export type HoldStatus = z.infer<typeof holdStatusSchema>
