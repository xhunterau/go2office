import { z } from "zod"

// Mirrors the DB CHECK constraint `product_kit_items_qty_positive`; the upper
// bound is a sanity guard, not a business rule (legacy data tops out at 100).
export const KIT_ITEM_MAX_QTY = 100_000

const kitItemId = (label: string) =>
  z.coerce.number().int().positive(`${label} is required`)

const kitItemQty = z.coerce
  .number()
  .int("Quantity must be a whole number")
  .positive("Quantity must be greater than 0")
  .max(KIT_ITEM_MAX_QTY, "Quantity is too large")

// Adding a component: both products plus the quantity. The self-reference check
// mirrors `product_kit_items_no_self_reference` so the UI can fail fast.
export const kitItemCreateSchema = z
  .object({
    kit_product_id: kitItemId("Kit"),
    component_product_id: kitItemId("Component"),
    qty: kitItemQty,
  })
  .refine((v) => v.kit_product_id !== v.component_product_id, {
    message: "A kit cannot contain itself",
    path: ["component_product_id"],
  })

export type KitItemCreateInput = z.infer<typeof kitItemCreateSchema>

// Editing a line only ever changes the quantity — swapping the component means
// removing the line and adding another.
export const kitItemQtySchema = z.object({ qty: kitItemQty })

// String-based shape bound to the dialog inputs (HTML inputs produce strings),
// matching the convention in @/lib/validations/product.
export const kitItemFormSchema = z.object({
  component_product_id: z
    .string()
    .min(1, "Component is required")
    .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
      message: "Component is required",
    }),
  qty: z
    .string()
    .min(1, "Quantity is required")
    .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
      message: "Quantity must be a whole number greater than 0",
    })
    .refine((v) => Number(v) <= KIT_ITEM_MAX_QTY, {
      message: "Quantity is too large",
    }),
})

export type KitItemFormValues = z.infer<typeof kitItemFormSchema>
