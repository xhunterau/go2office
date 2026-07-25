import { notFound } from "next/navigation"
import { Warehouse } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { fetchProductLookupOptions } from "@/lib/queries/products"
import { fetchProductKitItems } from "@/lib/queries/product-kit-items"
import { ProductDetailHeader } from "./_components/product-detail-header"
import { ProductDetailTabs } from "./_components/product-detail-tabs"
import {
  PRODUCT_DETAIL_COLUMNS,
  type ProductDetail,
} from "./_components/product-detail-types"
import { ProductKitPanel } from "./_components/product-kit-panel"
import { ProductOverview } from "./_components/product-overview"
import { ProductPlaceholderPanel } from "./_components/product-placeholder-panel"

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

  // Only kits have a Kit Components tab, so the composition query is skipped
  // entirely for regular products.
  const kit = product.is_kit
    ? await fetchProductKitItems(supabase, product.id)
    : { items: [], error: null }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ProductDetailHeader product={product} />

      <ProductDetailTabs
        showKitTab={product.is_kit}
        overview={<ProductOverview product={product} lookups={lookups} />}
        stock={
          <ProductPlaceholderPanel
            icon={Warehouse}
            title="Stock management is coming soon"
            description="On-hand quantities per location, plus stock in and out, will be managed here."
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
