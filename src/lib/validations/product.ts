import { z } from "zod"

// Fallback dimensions when the user leaves length/width/height blank.
export const DEFAULT_DIMENSION = 10

export const CURRENCIES = ["USD", "AUD", "CNY"] as const

// ---------------------------------------------------------------------------
// Field dictionaries
//
// Every editable column is declared exactly once, in two flavours:
//
//   serverFields — used by the Server Actions. Coerces, so it tolerates values
//     arriving as strings (what the form produces) or numbers.
//   formFields   — bound to the dialog inputs. Fields stay plain strings (as
//     HTML inputs / selects produce) and are validated as strings so
//     `z.input` matches `z.output` (no transform), keeping react-hook-form's
//     types clean.
//
// The create form and each detail-page section are then `pick`ed from these
// dictionaries, so adding a column means touching one place, not five.
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

const optionalUrl = (label: string) =>
  z
    .union([
      z.literal(""),
      z.url(`${label} must be a valid URL`).max(2048, `${label} is too long`),
    ])
    .optional()

const serverFields = {
  brand_id: requiredId("Brand"),
  origin_id: requiredId("Origin"),
  supplier_id: requiredId("Supplier"),
  name: z.string().trim().min(1, "Name is required").max(255, "Name is too long"),
  model: optionalText(255, "Model"),
  upc: optionalText(255, "UPC"),
  image_url: optionalUrl("Image URL"),
  currency: z.enum(CURRENCIES),
  purchase_price: requiredPositive("Purchase price"),
  retail_price: optionalPositive("Retail price"),
  is_gst: z.boolean(),
  weight: requiredPositive("Weight"),
  // Optional on create (blank falls back to DEFAULT_DIMENSION); the Logistics
  // section overrides these to required so an edit can never null them out.
  length: optionalPositive("Length"),
  width: optionalPositive("Width"),
  height: optionalPositive("Height"),
  ebay_title: optionalText(255, "eBay title"),
  description: optionalText(5000, "Description"),
  comment: optionalText(2000, "Comment"),
  is_active: z.boolean(),
  is_kit: z.boolean(),
} as const

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

const formFields = {
  brand_id: idField("Brand"),
  origin_id: idField("Origin"),
  supplier_id: idField("Supplier"),
  name: z.string().trim().min(1, "Name is required").max(255, "Name is too long"),
  model: z.string().trim().max(255, "Model is too long"),
  upc: z.string().trim().max(255, "UPC is too long"),
  image_url: z
    .string()
    .trim()
    .max(2048, "Image URL is too long")
    .refine((v) => v === "" || URL.canParse(v), {
      message: "Image URL must be a valid URL",
    }),
  currency: z.enum(CURRENCIES),
  purchase_price: requiredPositiveField("Purchase price"),
  retail_price: optionalPositiveField("Retail price"),
  is_gst: z.boolean(),
  weight: requiredPositiveField("Weight"),
  length: optionalPositiveField("Length"),
  width: optionalPositiveField("Width"),
  height: optionalPositiveField("Height"),
  ebay_title: z.string().trim().max(255, "eBay title is too long"),
  description: z.string().trim().max(5000, "Description is too long"),
  comment: z.string().trim().max(2000, "Comment is too long"),
  is_active: z.boolean(),
  is_kit: z.boolean(),
} as const

export type ProductFieldKey = keyof typeof serverFields

// Build an object schema from a subset of a field dictionary.
function pickSchema<
  TFields extends Record<string, z.ZodTypeAny>,
  TKey extends keyof TFields & string,
>(fields: TFields, keys: readonly TKey[]) {
  return z.object(
    Object.fromEntries(keys.map((key) => [key, fields[key]])) as Pick<
      TFields,
      TKey
    >
  )
}

// ---------------------------------------------------------------------------
// Create schemas — the fields exposed by the "Add Product" dialog.
// ---------------------------------------------------------------------------

const CREATE_FIELDS = [
  "brand_id",
  "origin_id",
  "supplier_id",
  "name",
  "weight",
  "currency",
  "purchase_price",
  "retail_price",
  "length",
  "width",
  "height",
  "model",
  "upc",
  "is_active",
  "is_kit",
] as const

export const productCreateSchema = pickSchema(serverFields, CREATE_FIELDS)
export type ProductCreateInput = z.infer<typeof productCreateSchema>

export const productFormSchema = pickSchema(formFields, CREATE_FIELDS)
// String-based shape bound to the form fields / default values.
export type ProductFormValues = z.infer<typeof productFormSchema>

// Convert validated form strings into the typed Server Action payload. The
// server schema coerces, so parsing the string values is the conversion.
export function formValuesToCreateInput(
  values: ProductFormValues
): ProductCreateInput {
  return productCreateSchema.parse(values)
}

// ---------------------------------------------------------------------------
// Detail-page sections — each card on /products/[id] edits one of these.
// ---------------------------------------------------------------------------

// Two sections, split by what the column *is* rather than by form habit:
// `details` describes the product (identity, relations, outward-facing copy and
// its lifecycle switches), `commercial` holds every number involved in trading
// and shipping it.
export const PRODUCT_SECTION_FIELDS = {
  details: [
    "name",
    "brand_id",
    "origin_id",
    "supplier_id",
    "model",
    "upc",
    "image_url",
    "ebay_title",
    "description",
    "comment",
    "is_active",
    "is_kit",
  ],
  commercial: [
    "currency",
    "purchase_price",
    "retail_price",
    "is_gst",
    "weight",
    "length",
    "width",
    "height",
  ],
} as const satisfies Record<string, readonly ProductFieldKey[]>

export type ProductSection = keyof typeof PRODUCT_SECTION_FIELDS

export const PRODUCT_SECTIONS = Object.keys(
  PRODUCT_SECTION_FIELDS
) as ProductSection[]

// Dimensions are NOT NULL in the database and always populated by create, so
// editing them requires a value — blanking a field must not null the column.
const commercialServerFields = {
  ...serverFields,
  length: requiredPositive("Length"),
  width: requiredPositive("Width"),
  height: requiredPositive("Height"),
}

const commercialFormFields = {
  ...formFields,
  length: requiredPositiveField("Length"),
  width: requiredPositiveField("Width"),
  height: requiredPositiveField("Height"),
}

export const productSectionSchemas = {
  details: pickSchema(serverFields, PRODUCT_SECTION_FIELDS.details),
  commercial: pickSchema(
    commercialServerFields,
    PRODUCT_SECTION_FIELDS.commercial
  ),
} satisfies Record<ProductSection, z.ZodTypeAny>

export const productSectionFormSchemas = {
  details: pickSchema(formFields, PRODUCT_SECTION_FIELDS.details),
  commercial: pickSchema(
    commercialFormFields,
    PRODUCT_SECTION_FIELDS.commercial
  ),
} satisfies Record<ProductSection, z.ZodTypeAny>

// ---------------------------------------------------------------------------
// Retail price — edited on its own, from the Pricing tab
//
// It is the one commercial number that is a decision rather than an input to
// one, so it is set where the cost and the suggested price are visible. Picked
// from the same dictionaries as everything else: the rule lives in one place.
// ---------------------------------------------------------------------------

export const retailPriceSchema = pickSchema(serverFields, ["retail_price"])

export const retailPriceFormSchema = pickSchema(formFields, ["retail_price"])
export type RetailPriceFormValues = z.infer<typeof retailPriceFormSchema>

// The string-based value shape of one section's edit form.
export type ProductSectionFormValues<S extends ProductSection> = z.infer<
  (typeof productSectionFormSchemas)[S]
>

// Which of a section's fields are booleans (Switch) vs strings (Input/Select).
export const BOOLEAN_FIELDS = new Set<ProductFieldKey>([
  "is_gst",
  "is_active",
  "is_kit",
])
