import type { Database } from "@/lib/supabase/database.types"
import {
  BOOLEAN_FIELDS,
  editableSectionFields,
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

// Title shown on each overview card / edit dialog.
export const PRODUCT_SECTION_TITLES: Record<ProductSection, string> = {
  details: "Product Details",
  commercial: "Commercial & Logistics",
}

// A section's form values, keyed by field. Booleans map to Switch, everything
// else to a string input/select — matching `productSectionFormSchema`.
export type SectionFormValues = Record<string, string | boolean>

// Project a product row onto the string/boolean shape the edit form binds to.
// Only the fields the section edits for this product: a hidden field must not
// reach the form, or its value is validated where no error can be shown.
export function toSectionFormValues(
  product: ProductRow,
  section: ProductSection
): SectionFormValues {
  const values: SectionFormValues = {}
  for (const key of editableSectionFields(section, product.is_kit)) {
    const raw = product[key]
    values[key] = BOOLEAN_FIELDS.has(key)
      ? Boolean(raw)
      : raw === null || raw === undefined
        ? ""
        : String(raw)
  }
  return values
}
