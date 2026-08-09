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
//   posted_on_date  -- a record of when the parcel actually left, not a field
//                      anyone should type. It is written by the dispatch action
//                      (not built yet -- docs/orders-ui.md 13) and is read-only
//                      everywhere in the UI. Note that re-adding it here is not
//                      enough on its own to make it editable, and removing it
//                      was not either: see the warning in updateOrder().
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
  // 200, not 100: the field is normally filled by scanning the carrier label,
  // and a raw GS1-128 scan runs to 117 characters here. The column is plain
  // text and normalize_tracking_number() cuts the scan down to the article ID
  // on write, so the only thing a 100-char cap achieved was rejecting the exact
  // input the normalisation exists to handle.
  tracking_number: optionalText(200, "Tracking number"),
  web_order_id: optionalText(100, "Web order ID"),
  comments: optionalText(2000, "Comments"),
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

// A hand-added transaction line.
//
// custom_label is required here, unlike on an edit: a line added by hand must
// point at a product that exists (user decision, 2026-08-08), and the dialog
// only lets one be chosen from the picker. The edit form keeps its free-text
// SKU because that is the only way to repair the 313 migrated lines whose label
// resolves to nothing -- repairing history and inventing new history are
// different jobs. The server re-checks the SKU; this only keeps an empty picker
// from being submitted.
//
// Otherwise the same four fields as an edit, and nothing else on purpose.
// item_number,
// sales_record_number, order_id_ebay, transaction_id_ebay and postage_service
// are what the marketplace reported about a sale it made; a line typed in here
// was not sold by the platform, so letting someone fill them in would put
// invented identifiers in the columns a future eBay/Shopify sync reconciles
// against (docs/orders-ui.md 6.4).
//
// sale_date / paid_on_date are NOT NULL with no default, and are set to now()
// server-side rather than being asked for (user decision, 2026-08-08).
// A refinement rather than a stricter custom_label type, so this stays
// assignable to the same react-hook-form Control as an edit and both dialogs can
// share the field components.
export const transactionCreateSchema = transactionUpdateSchema.superRefine(
  (values, ctx) => {
    if (!values.custom_label?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_label"],
        message: "Select a product",
      })
    }
  }
)

export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>
