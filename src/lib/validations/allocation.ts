import { z } from "zod"

import {
  ARAMEX_METHODS,
  EPARCEL_METHODS,
  MYPOST_METHODS,
  SELF_PRINT_METHODS,
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
] as const satisfies readonly ShippingMethod[]

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
