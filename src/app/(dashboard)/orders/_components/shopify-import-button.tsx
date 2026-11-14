"use client"

import { getShopifyImportStatus, triggerShopifyImport } from "@/lib/actions/shopify-import"

import { OrderImportButton } from "@/app/(dashboard)/orders/_components/order-import-button"

/** Import from Shopify. See OrderImportButton and docs/shopify-order-import.md. */
export function ShopifyImportButton({ testOrder }: { testOrder: string | null }) {
  return (
    <OrderImportButton
      platform="Shopify"
      source="go2buy-australia.myshopify.com"
      debugKey="shopify_import_test_order"
      testOrder={testOrder}
      ignoredLabel="cancelled, test or nothing to ship"
      debugShippedNote="It is imported even if it has already shipped."
      trigger={triggerShopifyImport}
      read={getShopifyImportStatus}
    />
  )
}
