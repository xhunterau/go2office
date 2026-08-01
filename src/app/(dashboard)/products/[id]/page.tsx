import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { fetchProductLookupOptions } from "@/lib/queries/products"
import { fetchProductKitItems } from "@/lib/queries/product-kit-items"
import {
  fetchProductMovements,
  fetchProductStockLines,
} from "@/lib/queries/inventory"
import { fetchLocationOptions } from "@/lib/queries/locations"
import {
  fetchKitComponentCosts,
  fetchProductPricing,
} from "@/lib/queries/product-pricing"
import { ProductDetailHeader } from "./_components/product-detail-header"
import { ProductDetailTabs } from "./_components/product-detail-tabs"
import {
  PRODUCT_DETAIL_COLUMNS,
  type ProductDetail,
} from "./_components/product-detail-types"
import { ProductKitPanel } from "./_components/product-kit-panel"
import { ProductOverview } from "./_components/product-overview"
import { ProductPricingPanel } from "./_components/product-pricing-panel"
import { ProductStockPanel } from "./_components/product-stock-panel"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const supabase = await createClient()
  const [{ data, error }, lookups] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_DETAIL_COLUMNS)
      .eq("id", id)
      .maybeSingle(),
    fetchProductLookupOptions(supabase),
  ])

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load product: {error.message}
      </div>
    )
  }

  if (!data) notFound()

  const product = data as ProductDetail

  // Only kits have a Kit Components tab and a per-component cost breakdown, so
  // both of those queries are skipped for regular products. Pricing itself is
  // fetched for everything: the view now covers kits too, rolling their cost up
  // from their components.
  // Kits are barred from holding stock (migration 20260801130000), so the three
  // stock queries are skipped for them — the panel renders an explanation
  // instead of a table.
  const [kit, pricing, componentCosts, stock, movements, locations] =
    await Promise.all([
      product.is_kit
        ? fetchProductKitItems(supabase, product.id)
        : Promise.resolve({ items: [], error: null }),
      fetchProductPricing(supabase, product.id),
      product.is_kit
        ? fetchKitComponentCosts(supabase, product.id)
        : Promise.resolve({ costs: [], error: null }),
      product.is_kit
        ? Promise.resolve({ lines: [], error: null })
        : fetchProductStockLines(supabase, product.id),
      product.is_kit
        ? Promise.resolve({ movements: [], error: null })
        : fetchProductMovements(supabase, product.id),
      product.is_kit
        ? Promise.resolve({ options: [], error: null })
        : fetchLocationOptions(supabase),
    ])

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ProductDetailHeader product={product} />

      <ProductDetailTabs
        showKitTab={product.is_kit}
        overview={
          <ProductOverview
            product={product}
            lookups={lookups}
            pricing={pricing.pricing}
          />
        }
        pricing={
          <ProductPricingPanel
            pricing={pricing.pricing}
            error={pricing.error}
            kitItems={kit.items}
            kitCosts={componentCosts.costs}
            kitCostsError={componentCosts.error}
          />
        }
        stock={
          <ProductStockPanel
            productId={product.id}
            isKit={product.is_kit}
            lines={stock.lines}
            movements={movements.movements}
            locations={locations.options}
            error={stock.error ?? movements.error ?? locations.error}
          />
        }
        kit={
          <ProductKitPanel
            kitProductId={product.id}
            items={kit.items}
            error={kit.error}
          />
        }
      />
    </div>
  )
}
