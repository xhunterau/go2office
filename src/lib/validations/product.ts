import { z } from "zod"

// Fallback dimensions when the user leaves length/width/height blank.
export const DEFAULT_DIMENSION = 10

export const CURRENCIES = ["USD", "AUD", "CNY"] as const

// ---------------------------------------------------------------------------
// Server schema — used by the Server Action. Coerces so it tolerates values
// arriving as strings or numbers.
// ---------------------------------------------------------------------------

const requiredId = (label: string) =>
  z.coerce.number().int().positive(`${label} is required`)

const requiredPositive = (label: string) =>
  z.coerce.number().positive(`${label} must be greater than 0`)

const optionalPositive = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().positive(`${label} must be greater than 0`).nullable()
  )

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long`).optional().or(z.literal(""))

export const productCreateSchema = z.object({
  brand_id: requiredId("Brand"),
  origin_id: requiredId("Origin"),
  supplier_id: requiredId("Supplier"),
  name: z.string().trim().min(1, "Name is required").max(255, "Name is too long"),
  weight: requiredPositive("Weight"),
  currency: z.enum(CURRENCIES),
  purchase_price: requiredPositive("Purchase price"),
  retail_price: optionalPositive("Retail price"),
  length: optionalPositive("Length"),
  width: optionalPositive("Width"),
  height: optionalPositive("Height"),
  model: optionalText(255, "Model"),
  upc: optionalText(255, "UPC"),
  is_active: z.boolean(),
  is_kit: z.boolean(),
})

export type ProductCreateInput = z.infer<typeof productCreateSchema>

// ---------------------------------------------------------------------------
// Form schema — bound to the dialog inputs. Fields stay plain strings (as HTML
// inputs / selects produce) and are validated as strings so `z.input` matches
// `z.output` (no transform), keeping react-hook-form's types clean. The dialog
// converts the validated strings to the action payload on submit.
// ---------------------------------------------------------------------------

const idField = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, {
      message: `${label} is required`,
    })

const requiredPositiveField = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => Number(v) > 0, {
      message: `${label} must be greater than 0`,
    })

const optionalPositiveField = (label: string) =>
  z.string().refine((v) => v.trim() === "" || Number(v) > 0, {
    message: `${label} must be greater than 0`,
  })

export const productFormSchema = z.object({
  brand_id: idField("Brand"),
  origin_id: idField("Origin"),
  supplier_id: idField("Supplier"),
  name: z.string().trim().min(1, "Name is required").max(255, "Name is too long"),
  weight: requiredPositiveField("Weight"),
  currency: z.enum(CURRENCIES),
  purchase_price: requiredPositiveField("Purchase price"),
  retail_price: optionalPositiveField("Retail price"),
  length: optionalPositiveField("Length"),
  width: optionalPositiveField("Width"),
  height: optionalPositiveField("Height"),
  model: z.string().trim().max(255, "Model is too long"),
  upc: z.string().trim().max(255, "UPC is too long"),
  is_active: z.boolean(),
  is_kit: z.boolean(),
})

// String-based shape bound to the form fields / default values.
export type ProductFormValues = z.infer<typeof productFormSchema>

// Convert validated form strings into the typed Server Action payload.
export function formValuesToCreateInput(
  values: ProductFormValues
): ProductCreateInput {
  const optionalNumber = (v: string): number | null =>
    v.trim() === "" ? null : Number(v)

  return {
    brand_id: Number(values.brand_id),
    origin_id: Number(values.origin_id),
    supplier_id: Number(values.supplier_id),
    name: values.name,
    weight: Number(values.weight),
    currency: values.currency,
    purchase_price: Number(values.purchase_price),
    retail_price: optionalNumber(values.retail_price),
    length: optionalNumber(values.length),
    width: optionalNumber(values.width),
    height: optionalNumber(values.height),
    model: values.model,
    upc: values.upc,
    is_active: values.is_active,
    is_kit: values.is_kit,
  }
}
