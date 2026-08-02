import type { Database } from "@/lib/supabase/database.types"
import type { ProductSection } from "@/lib/validations/product"
import type { ProductPricing } from "@/lib/queries/product-pricing"
import { formatDimensions, formatWeight } from "@/lib/pricing"
import { KIT_DERIVED_FIELDS, toSectionFormValues } from "./product-fields"
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

// products.currency describes ONE column: purchase_price. Everything else money
// on this row is AUD, including retail_price -- the pricing view subtracts
// unit_cost_aud from it directly (`retail_ex_gst - unit_cost_aud AS
// retail_profit`, migration 20260729120000), which is arithmetic that only holds
// if both sides are the same currency.
//
// So retail is formatted with a literal "AUD", never with product.currency.
// Passing the row's currency there labelled 2258 products' Australian retail
// prices as CNY -- and read as a yuan price on the 943 of them that have one.
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

// Marks a value the kit derives from its components rather than stores.
function derived(value: string): React.ReactNode {
  return (
    <span className="flex flex-wrap items-baseline gap-1.5">
      {value}
      <span className="text-xs text-muted-foreground">Derived</span>
    </span>
  )
}

// The read-only rows of every card. Kept explicit (rather than derived from the
// field metadata) because each column has its own display rules: prices are
// currency-formatted, foreign keys show the joined label, timestamps localize.
//
// A kit reads its cost inputs off `pricing` instead of off its own row: the
// columns on the row are legacy placeholders (zeros, or a roll-up the old system
// froze at some past exchange rate) that nothing else uses.
function sectionRows(
  product: ProductDetail,
  pricing: ProductPricing | null
): Record<ProductSection, SectionRow[]> {
  const isKit = product.is_kit

  const commercial: SectionRow[] = isKit
    ? [
        { label: "Currency", value: derived("AUD") },
        { label: "GST", value: derived("No") },
        {
          label: "Purchase Price",
          value: derived(formatPrice(pricing?.unit_cost_aud ?? null, "AUD")),
        },
        {
          // Not derived: a kit's retail price is set by hand on its own row,
          // unlike the cost inputs above it.
          label: "Retail Price",
          value: formatPrice(product.retail_price, "AUD"),
        },
        {
          label: "Weight",
          value: derived(formatWeight(pricing?.weight ?? null)),
        },
        {
          label: "Dimensions (L × W × H)",
          value: derived(
            formatDimensions(
              pricing?.length_mm ?? null,
              pricing?.width_mm ?? null,
              pricing?.height_mm ?? null
            )
          ),
        },
      ]
    : [
        { label: "Currency", value: display(product.currency) },
        { label: "GST", value: yesNo(product.is_gst) },
        {
          // Purchase price is the one figure denominated in product.currency.
          label: "Purchase Price",
          value: formatPrice(product.purchase_price, product.currency),
        },
        {
          label: "Retail Price",
          value: formatPrice(product.retail_price, "AUD"),
        },
        { label: "Weight", value: formatWeight(product.weight) },
        {
          label: "Dimensions (L × W × H)",
          value: formatDimensions(
            product.length,
            product.width,
            product.height
          ),
        },
      ]

  return {
    details: [
      { label: "Name", value: display(product.name) },
      {
        label: "SKU",
        value: <span className="font-mono">{product.sku}</span>,
      },
      { label: "Brand", value: display(product.brands?.name) },
      {
        label: "Origin",
        // A kit is assembled here out of stock that already paid its import
        // freight, so it is always a local purchase whatever the row says.
        value: isKit
          ? derived("Local Purchase")
          : display(product.origins?.name),
      },
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
    commercial,
  }
}

// Details carries the long-form copy, so it leads and Commercial sits beside it.
const SECTION_ORDER: ProductSection[] = ["details", "commercial"]

export function ProductOverview({
  product,
  lookups,
  pricing,
}: {
  product: ProductDetail
  lookups: SectionLookups
  pricing: ProductPricing | null
}) {
  const rows = sectionRows(product, pricing)

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
            hiddenFields={product.is_kit ? KIT_DERIVED_FIELDS : undefined}
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
