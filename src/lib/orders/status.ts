import type { Database } from "@/lib/supabase/database.types"
import { NEEDS_ACTION, type StatusTab } from "@/lib/queries/orders"

type OrderStatus = Database["public"]["Enums"]["order_status"]
type SalesPlatform = Database["public"]["Enums"]["sales_platform"]

// The enum labels are lowercase snake; these are what goes on screen. Typed as
// a total Record so adding a status to the enum without a label here fails to
// compile rather than rendering a raw value.
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  unpaid: "Unpaid",
  // "On backorder", not "Backorder": sales_platform has a backorder value too,
  // and two badges reading the same word on one row would mean two different
  // things (docs/orders-ui.md 4.2.2). The platform label keeps the plain form.
  backorder: "On backorder",
  processing: "Processing",
  picked: "Picked",
  labelled: "Labelled",
  issued: "Issued",
  completed: "Completed",
  cancelled: "Cancelled",
}

type BadgeVariant = "info" | "warning" | "inactive" | "outline" | "secondary"

// Colour carries one meaning only: is this order waiting on someone.
//
//   amber   -- blocked, someone has to act before it can move (unpaid, backorder)
//   blue    -- in flight, moving through the pipeline on its own
//   neutral -- finished, nothing to do (docs/orders-ui.md 5.1)
//
// 99.7% of rows are completed, so anything louder than neutral on that value
// would turn the whole table into a colour field and make the 0.3% that
// actually needs attention harder to spot, not easier.
export const ORDER_STATUS_VARIANTS: Record<OrderStatus, BadgeVariant> = {
  pending: "secondary",
  unpaid: "warning",
  backorder: "warning",
  processing: "info",
  picked: "info",
  labelled: "info",
  issued: "info",
  completed: "inactive",
  cancelled: "outline",
}

export const SALES_PLATFORM_LABELS: Record<SalesPlatform, string> = {
  ebay: "eBay",
  shopify: "Shopify",
  // sales_platform.backorder and order_status.backorder are different facts
  // that happen to share a spelling (docs/orders-ui.md 4.2.2): this one means
  // the order was raised internally to cover stock that was not there.
  backorder: "Backorder",
  store: "Store",
}

// The status tabs. Only three statuses get one; every other queue is reached
// through Needs action or the filter bar's full ten-value dropdown, which is
// the only place completed and cancelled can be selected (docs/orders-ui.md
// 5.2).
//
// `null` is All. NEEDS_ACTION already contains unpaid and backorder (see
// NEEDS_ACTION_EXCLUDED), so giving those two their own tabs would put the same
// orders on the row twice. It sits last rather than second: the three stage
// tabs are the ones worked through in order, and the catch-all is where you go
// when none of them is what you are after.
export const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: null, label: "All" },
  { value: "processing", label: ORDER_STATUS_LABELS.processing },
  { value: "labelled", label: ORDER_STATUS_LABELS.labelled },
  { value: "picked", label: ORDER_STATUS_LABELS.picked },
  { value: NEEDS_ACTION, label: "Needs action" },
]
