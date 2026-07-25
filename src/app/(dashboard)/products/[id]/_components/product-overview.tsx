import type { Database } from "@/lib/supabase/database.types"
import type { ProductSection } from "@/lib/validations/product"
import { toSectionFormValues } from "./product-fields"
import {
  ProductSectionCard,
  type SectionRow,
} from "./product-section-card"
import type { SectionLookups } from "./product-section-dialog"
import type { ProductDetail } from "./product-detail-types"

type Currency = Database["public"]["Enums"]["currency_code"]

// Render an empty value as an em dash for consistent, readable blanks.
function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

function formatPrice(value: number | null, currency: Currency | null): string {
  if (value === null) return "—"
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency ?? "AUD",
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function yesNo(value: boolean | null): string {
  return value ? "Yes" : "No"
}

function formatDimensions(product: ProductDetail): string {
  const parts = [product.length, product.width, product.height]
  if (parts.some((part) => part === null)) return "—"
  return parts.join(" × ")
}

// The read-only rows of every card. Kept explicit (rather than derived from the
// field metadata) because each column has its own display rules: prices are
// currency-formatted, foreign keys show the joined label, timestamps localize.
function sectionRows(product: ProductDetail): Record<ProductSection, SectionRow[]> {
  return {
    details: [
      { label: "Name", value: display(product.name) },
      {
        label: "SKU",
        value: <span className="font-mono">{product.sku}</span>,
      },
      { label: "Brand", value: display(product.brands?.name) },
      { label: "Origin", value: display(product.origins?.name) },
      { label: "Supplier", value: display(product.suppliers?.company_name) },
      { label: "Model", value: display(product.model) },
      { label: "UPC", value: display(product.upc) },
      {
        label: "eBay Title",
        value: display(product.ebay_title),
        fullWidth: true,
      },
      {
        label: "Description",
        value: display(product.description),
        fullWidth: true,
      },
      { label: "Comment", value: display(product.comment), fullWidth: true },
    ],
    commercial: [
      { label: "Currency", value: display(product.currency) },
      { label: "GST", value: yesNo(product.is_gst) },
      {
        label: "Purchase Price",
        value: formatPrice(product.purchase_price, product.currency),
      },
      {
        label: "Retail Price",
        value: formatPrice(product.retail_price, product.currency),
      },
      { label: "Weight", value: display(product.weight) },
      { label: "Dimensions (L × W × H)", value: formatDimensions(product) },
    ],
  }
}

// Details carries the long-form copy, so it leads and Commercial sits beside it.
const SECTION_ORDER: ProductSection[] = ["details", "commercial"]

export function ProductOverview({
  product,
  lookups,
}: {
  product: ProductDetail
  lookups: SectionLookups
}) {
  const rows = sectionRows(product)

  return (
    <div className="flex flex-col gap-4">
      {/* Cards align to the top so the shorter Commercial card does not stretch
          to match the long-form Details column. */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {SECTION_ORDER.map((section) => (
          <ProductSectionCard
            key={section}
            section={section}
            productId={product.id}
            rows={rows[section]}
            initialValues={toSectionFormValues(product, section)}
            lookups={lookups}
          />
        ))}
      </div>

      {/* Read-only audit trail — too incidental to earn a card of its own. */}
      <p className="text-xs text-muted-foreground">
        Created {formatDate(product.created_at)} · Updated{" "}
        {formatDate(product.updated_at)}
      </p>
    </div>
  )
}
