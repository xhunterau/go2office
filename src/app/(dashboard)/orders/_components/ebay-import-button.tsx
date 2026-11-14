"use client"

import { getEbayImportStatus, triggerEbayImport } from "@/lib/actions/ebay-import"
import type { EbayAuthorization } from "@/lib/queries/ebay-authorization"

import { OrderImportButton } from "@/app/(dashboard)/orders/_components/order-import-button"

/**
 * Import from eBay. See OrderImportButton and docs/ebay-order-import.md.
 *
 * Disabled when no seller is authorised or the authorisation has run out: the
 * task would only fail with the same message.
 */
export function EbayImportButton({
  testOrder,
  authorization,
}: {
  testOrder: string | null
  authorization: EbayAuthorization
}) {
  return (
    <OrderImportButton
      platform="eBay"
      source={authorization.username ? `eBay seller ${authorization.username}` : "eBay"}
      debugKey="ebay_import_test_order"
      testOrder={testOrder}
      ignoredLabel="cancelled, unpaid or already shipped"
      debugShippedNote="Lines already marked shipped on eBay are left out, so an order that has shipped is ignored."
      trigger={triggerEbayImport}
      read={getEbayImportStatus}
      warning={authorization.warning}
      disabled={authorization.blocked}
    />
  )
}
