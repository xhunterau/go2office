import { z } from "zod"

// Upper bound on any single movement. High enough for a container load, low
// enough that a slipped decimal point is caught rather than recorded.
const MAX_QTY = 100000

const positiveId = z.coerce.number().int().positive()

// Bare product id, for the read-only action that loads a row's ledger on demand.
export const productIdSchema = positiveId

const note = z
  .string()
  .trim()
  .max(500, "Note must be 500 characters or fewer")
  .optional()
  .or(z.literal("").transform(() => undefined))

// Receive / Dispatch: an unsigned amount. The direction comes from which action
// is called, never from the sign of this number.
export const stockMovementSchema = z.object({
  product_id: positiveId,
  location_id: positiveId,
  qty: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0")
    .max(MAX_QTY, `Quantity must be ${MAX_QTY} or fewer`),
  note,
})

// Stocktake: an absolute figure, so 0 is valid (counted nothing) where it would
// be meaningless as a movement.
export const setStockSchema = z.object({
  product_id: positiveId,
  location_id: positiveId,
  new_qty: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .min(0, "Quantity cannot be negative")
    .max(MAX_QTY, `Quantity must be ${MAX_QTY} or fewer`),
  note,
})

export const moveStockSchema = z
  .object({
    product_id: positiveId,
    from_location_id: positiveId,
    to_location_id: positiveId,
    qty: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .positive("Quantity must be greater than 0")
      .max(MAX_QTY, `Quantity must be ${MAX_QTY} or fewer`),
    note,
  })
  .superRefine((value, ctx) => {
    if (value.from_location_id === value.to_location_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source and destination must be different locations",
        path: ["to_location_id"],
      })
    }
  })

// How many of the newest movements "Keep latest" spares. Fixed rather than
// asked for: the point of the control is to clear noise in one click, and a
// number box turns that into a decision nobody wants to make per product.
export const MOVEMENT_KEEP_RECENT = 3

// Pruning is deliberately not a free-form "delete rows where": the only two
// shapes the UI offers are the only two the action accepts.
export const pruneMovementsSchema = z.object({
  product_id: positiveId,
  keep: z.union([z.literal(0), z.literal(MOVEMENT_KEEP_RECENT)]),
})

export type PruneMovementsInput = z.infer<typeof pruneMovementsSchema>

export type StockMovementInput = z.infer<typeof stockMovementSchema>
export type SetStockInput = z.infer<typeof setStockSchema>
export type MoveStockInput = z.infer<typeof moveStockSchema>

export type StockAction = "receive" | "dispatch" | "adjust" | "move"

// String-based shape bound to the dialog inputs (HTML inputs produce strings),
// matching the convention in @/lib/validations/product-kit-item. The Server
// Actions re-validate with the typed schemas above (rule 6).
export type StockFormValues = {
  location_id: string
  to_location_id: string
  qty: string
  note: string
}

// `\d+` already excludes negatives and decimals, so the only thing that varies
// by action is whether zero is allowed: a stocktake of 0 is a real count,
// whereas a movement of 0 is not a movement.
const qtyField = (allowZero: boolean) =>
  z
    .string()
    .min(1, "Quantity is required")
    .refine((v) => /^\d+$/.test(v.trim()), {
      message: "Quantity must be a whole number",
    })
    .refine((v) => (allowZero ? true : Number(v) > 0), {
      message: "Quantity must be greater than 0",
    })
    .refine((v) => Number(v) <= MAX_QTY, { message: "Quantity is too large" })

export function stockFormSchema(action: StockAction) {
  return z
    .object({
      location_id: z.string().min(1, "Select a location"),
      to_location_id: z.string(),
      qty: qtyField(action === "adjust"),
      note: z.string().max(500, "Note is too long"),
    })
    .superRefine((value, ctx) => {
      if (action !== "move") return

      if (!value.to_location_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select a destination",
          path: ["to_location_id"],
        })
      } else if (value.to_location_id === value.location_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Source and destination must be different locations",
          path: ["to_location_id"],
        })
      }
    })
}
