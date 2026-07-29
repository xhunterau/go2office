"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export const PRODUCT_TABS = ["overview", "pricing", "stock", "kit"] as const
export type ProductTab = (typeof PRODUCT_TABS)[number]

// Panels arrive as slots so the Overview stays a Server Component — this
// wrapper only owns tab selection.
export function ProductDetailTabs({
  showKitTab,
  overview,
  pricing,
  stock,
  kit,
}: {
  showKitTab: boolean
  overview: React.ReactNode
  pricing: React.ReactNode
  stock: React.ReactNode
  kit: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const requested = searchParams.get("tab")
  const active: ProductTab =
    requested === "stock" ||
    requested === "pricing" ||
    (requested === "kit" && showKitTab)
      ? requested
      : "overview"

  // Mirror the active tab into the URL so it survives a refresh, can be shared
  // and responds to the browser's back button — same convention as the list
  // page filters.
  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "overview") params.delete("tab")
    else params.set("tab", value)

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Tabs value={active} onValueChange={handleChange} className="gap-4">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="pricing">Pricing</TabsTrigger>
        <TabsTrigger value="stock">Stock</TabsTrigger>
        {showKitTab && <TabsTrigger value="kit">Kit Components</TabsTrigger>}
      </TabsList>

      <TabsContent value="overview">{overview}</TabsContent>
      <TabsContent value="pricing">{pricing}</TabsContent>
      <TabsContent value="stock">{stock}</TabsContent>
      {showKitTab && <TabsContent value="kit">{kit}</TabsContent>}
    </Tabs>
  )
}
