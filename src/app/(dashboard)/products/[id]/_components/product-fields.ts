import type { Database } from "@/lib/supabase/database.types"
import {
  BOOLEAN_FIELDS,
  PRODUCT_SECTION_FIELDS,
  type ProductFieldKey,
  type ProductSection,
} from "@/lib/validations/product"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]

// How each editable column is rendered inside the section edit dialog. Display
// formatting lives in the (server) overview instead, where prices, lookups and
// timestamps each need their own treatment.
type FieldControl =
  | { kind: "text" }
  // `snap: "charm"` routes the field through ProductPriceInput, which rounds the
  // entered value to .95 cents on blur — the same rule the suggested retail
  // price uses, so a hand-typed price lands on the same grid.
  | { kind: "number"; step: string; snap?: "charm" }
  | { kind: "textarea"; rows: number }
  | { kind: "switch" }
  | { kind: "lookup"; source: "brands" | "origins" | "suppliers" }
  | { kind: "currency" }
  | { kind: "image" }

export const PRODUCT_FIELD_META: Record<
  ProductFieldKey,
  { label: string; control: FieldControl; placeholder?: string }
> = {
  name: { label: "Name", control: { kind: "text" }, placeholder: "Product name" },
  brand_id: { label: "Brand", control: { kind: "lookup", source: "brands" } },
  origin_id: { label: "Origin", control: { kind: "lookup", source: "origins" } },
  supplier_id: {
    label: "Supplier",
    control: { kind: "lookup", source: "suppliers" },
  },
  model: { label: "Model", control: { kind: "text" }, placeholder: "Optional" },
  upc: { label: "UPC", control: { kind: "text" }, placeholder: "Optional" },
  image_url: { label: "Image", control: { kind: "image" } },
  currency: { label: "Currency", control: { kind: "currency" } },
  purchase_price: {
    label: "Purchase Price",
    control: { kind: "number", step: "0.01" },
    placeholder: "0.00",
  },
  retail_price: {
    label: "Retail Price",
    control: { kind: "number", step: "0.01", snap: "charm" },
    placeholder: "Optional",
  },
  is_gst: { label: "GST", control: { kind: "switch" } },
  weight: {
    label: "Weight",
    control: { kind: "number", step: "0.001" },
    placeholder: "0.00",
  },
  length: {
    label: "Length",
    control: { kind: "number", step: "0.01" },
    placeholder: "10",
  },
  width: {
    label: "Width",
    control: { kind: "number", step: "0.01" },
    placeholder: "10",
  },
  height: {
    label: "Height",
    control: { kind: "number", step: "0.01" },
    placeholder: "10",
  },
  ebay_title: {
    label: "eBay Title",
    control: { kind: "text" },
    placeholder: "Optional",
  },
  description: {
    label: "Description",
    control: { kind: "textarea", rows: 6 },
    placeholder: "Optional",
  },
  comment: {
    label: "Comment",
    control: { kind: "textarea", rows: 3 },
    placeholder: "Internal notes",
  },
  is_active: { label: "Active", control: { kind: "switch" } },
  is_kit: { label: "Kit", control: { kind: "switch" } },
}

// Columns a kit does not own: they are rolled up from its components by
// public.product_pricing, and the values stored on the kit row itself are legacy
// placeholders nothing reads. Hidden from the edit dialog so nobody fills in a
// number that will never be used; the overview shows the derived value instead.
//
// `retail_price` is absent because it is not derived — see PRICING_OWNED_FIELDS
// for why it is nonetheless kept out of this dialog.
export const KIT_DERIVED_FIELDS: ReadonlySet<ProductFieldKey> = new Set([
  "origin_id",
  "currency",
  "purchase_price",
  "is_gst",
  "weight",
  "length",
  "width",
  "height",
])

// Columns the Pricing tab owns the edit affordance for, on every product —
// stored, not derived, but only decidable next to the landed cost and the
// suggested price. Hidden from the Commercial dialog so there is exactly one
// place to change them; the overview still shows the value.
export const PRICING_OWNED_FIELDS: ReadonlySet<ProductFieldKey> = new Set([
  "retail_price",
])

// The fields the Commercial dialog must not offer for this product. Kits also
// hide everything they derive from their components.
export function hiddenSectionFields(isKit: boolean): ReadonlySet<ProductFieldKey> {
  if (!isKit) return PRICING_OWNED_FIELDS
  return new Set([...KIT_DERIVED_FIELDS, ...PRICING_OWNED_FIELDS])
}

// Title shown on each overview card / edit dialog.
export const PRODUCT_SECTION_TITLES: Record<ProductSection, string> = {
  details: "Product Details",
  commercial: "Commercial & Logistics",
}

// A section's form values, keyed by field. Booleans map to Switch, everything
// else to a string input/select — matching `productSectionFormSchemas`.
export type SectionFormValues = Record<string, string | boolean>

// Project a product row onto the string/boolean shape the edit form binds to.
export function toSectionFormValues(
  product: ProductRow,
  section: ProductSection
): SectionFormValues {
  const values: SectionFormValues = {}
  for (const key of PRODUCT_SECTION_FIELDS[section]) {
    const raw = product[key]
    values[key] = BOOLEAN_FIELDS.has(key)
      ? Boolean(raw)
      : raw === null || raw === undefined
        ? ""
        : String(raw)
  }
  return values
}
