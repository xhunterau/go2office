import { z } from "zod"

import { ORDER_STATUSES, SALES_PLATFORMS } from "@/lib/queries/orders"
import { SHIPPING_METHOD_OPTIONS } from "@/lib/orders/shipping-method"

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .or(z.literal(""))

// Editable order fields.
//
// Deliberately absent:
//   invoice_number  -- globally unique and the primary lookup key; changing it
//                      after the fact orphans every external reference to it.
//   legacy_shipping_method -- retired carriers are a historical record. Saving a
//                      current shipping_method stops it being displayed but must
//                      never erase it (docs/orders-ui.md 4.3 decision B).
//   customer_id     -- moving an order between customers also moves the address
//                      it renders; out of scope for this round.
export const orderUpdateSchema = z.object({
  // z.enum over the same constants the dropdowns iterate, so a value the DB
  // enum does not have cannot reach the cast.
  status: z.enum(ORDER_STATUSES),
  platform: z.enum(SALES_PLATFORMS),
  // Nullable: 375 orders have no carrier at all, and the seven retired ones are
  // not offered as options.
  shipping_method: z.enum(SHIPPING_METHOD_OPTIONS).nullable(),
  postage_and_handling: z
    .number({ message: "Postage must be a number" })
    .min(0, "Postage cannot be negative")
    .max(99999.99, "Postage is too large")
    .multipleOf(0.01, "Postage cannot have more than two decimal places"),
  tracking_number: optionalText(100, "Tracking number"),
  web_order_id: optionalText(100, "Web order ID"),
  comments: optionalText(2000, "Comments"),
  // Null means not dispatched -- 4919 orders are in that state, and it is not
  // the same thing as a status (4497 completed orders have no dispatch date).
  posted_on_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .nullable()
    .or(z.literal("")),
})

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>

// Transaction line edits.
//
// custom_label and quantity are split out from the rest of the order form on
// purpose: both are watched by order_transactions_rebuild_items_update, and
// changing either deletes and regenerates every order_items row under the
// transaction. Manual pick locations and hand-corrected lines are lost in that
// rebuild, so the UI confirms before saving these two (project rule 9).
export const transactionUpdateSchema = z.object({
  quantity: z
    .number({ message: "Quantity must be a number" })
    .int("Quantity must be a whole number")
    // order_items_quantity_positive rejects zero and below; catching it here
    // avoids a 23514 round trip.
    .min(1, "Quantity must be at least 1")
    .max(100000, "Quantity is too large"),
  // Negative prices are legitimate: refund and reversal lines go as low as
  // -640.00 in the migrated data. Do not add .min(0) here.
  sale_price: z
    .number({ message: "Price must be a number" })
    .min(-999999.99, "Price is too small")
    .max(999999.99, "Price is too large")
    .multipleOf(0.01, "Price cannot have more than two decimal places"),
  custom_label: optionalText(255, "Custom label"),
  item_title: optionalText(500, "Item title"),
})

export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>
