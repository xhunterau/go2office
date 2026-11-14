import type { ShopifyOrder } from "@/lib/shopify/orders"

// Shopify order -> the payload public.import_shopify_order(jsonb) takes.
//
// Pure, so every rule below is pinned by src/lib/shopify/__tests__/
// order-mapper.test.ts rather than discovered against the live store. The
// column each value lands in, and why, is in docs/shopify-order-import.md.

export type ShopifyImportLine = {
  /** Numeric tail of the LineItem gid -> order_transactions.transaction_id_ebay */
  line_id: string
  /** Verbatim, trimmed. `GB01448AF|FG` is a real SKU (1,096 of them). */
  sku: string | null
  title: string
  quantity: number
  unit_price: number
  postage_service: "Standard" | "Express"
}

export type ShopifyImportPayload = {
  shopify_order_id: string
  name: string
  created_at: string
  processed_at: string | null
  note: string | null
  postage: number
  discount: number
  customer: {
    full_name: string | null
    email: string | null
    phone: string | null
    company_name: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }
  lines: ShopifyImportLine[]
}

/** Why an order is not handed to the database at all. */
export type ShopifySkipReason = "cancelled" | "test" | "no_lines"

export type MapResult =
  | { kind: "import"; payload: ShopifyImportPayload }
  | { kind: "skip"; reason: ShopifySkipReason }

/**
 * Raised for an order that cannot be imported correctly. Counted as a failure
 * and reported by name, never imported in part.
 */
export class UnimportableOrderError extends Error {}

/** Shopify money strings ("10.98") to numbers. A blank is 0; garbage throws. */
export function toAmount(value: string | null | undefined, field: string, orderName: string): number {
  const trimmed = value?.trim() ?? ""
  if (trimmed === "") return 0
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new UnimportableOrderError(`${orderName}: ${field} is not a number (${JSON.stringify(value)})`)
  }
  return parsed
}

/**
 * Standard unless the shipping line says Express. The store's titles are not
 * consistent ("Standard", "Rate Table" seen on the same day) and all 25,567
 * historical Shopify lines say Standard, so anything not explicitly Express is
 * Standard. Same rule as xpros' mapPostageService.
 */
export function postageServiceFor(title: string | null | undefined): "Standard" | "Express" {
  return title?.toUpperCase().includes("EXPRESS") ? "Express" : "Standard"
}

/** gid://shopify/LineItem/18738962825353 -> "18738962825353" */
export function numericIdFromGid(gid: string): string {
  const tail = gid.split("/").pop() ?? ""
  if (!/^\d+$/.test(tail)) {
    throw new UnimportableOrderError(`Unexpected Shopify id: ${gid}`)
  }
  return tail
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function mapShopifyOrder(order: ShopifyOrder): MapResult {
  // Unshipped and cancelled is still "unshipped" to the search filter.
  if (order.cancelledAt) return { kind: "skip", reason: "cancelled" }
  if (order.test) return { kind: "skip", reason: "test" }

  // Pagination is checked before anything is dropped, so a long order is
  // refused even if its first page happens to be all edited-out lines.
  //
  // Importing the first page and dropping the rest would ship an incomplete
  // order with nothing to say so.
  if (order.lineItems.pageInfo.hasNextPage) {
    throw new UnimportableOrderError(
      `${order.name} has more line items than the import fetches; enter it by hand`
    )
  }

  // Lines edited or refunded down to nothing are not goods to send.
  const lines = order.lineItems.edges
    .map((edge) => edge.node)
    .filter((line) => line.currentQuantity > 0)
  if (lines.length === 0) return { kind: "skip", reason: "no_lines" }

  const address = order.shippingAddress
  if (!address) {
    throw new UnimportableOrderError(`${order.name} has no shipping address`)
  }

  const postageService = postageServiceFor(order.shippingLine?.title)
  const fullName = [address.firstName, address.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")

  return {
    kind: "import",
    payload: {
      shopify_order_id: order.legacyResourceId,
      name: order.name,
      created_at: order.createdAt,
      processed_at: order.processedAt,
      note: clean(order.note),
      postage: toAmount(order.totalShippingPriceSet.shopMoney.amount, "shipping", order.name),
      discount: toAmount(order.totalDiscountsSet.shopMoney.amount, "discount", order.name),
      customer: {
        full_name: fullName || null,
        email: clean(order.email),
        phone: clean(address.phone) ?? clean(order.phone),
        company_name: clean(address.company),
        address_line1: clean(address.address1),
        address_line2: clean(address.address2),
        city: clean(address.city),
        // The code ("SA"), as the legacy data stores it. The
        // customers_standardize_address trigger re-derives it from postcode +
        // suburb anyway; this is only what is kept when that lookup misses.
        state: clean(address.provinceCode),
        postcode: clean(address.zip),
        country: clean(address.countryCodeV2),
      },
      lines: lines.map((line) => ({
        line_id: numericIdFromGid(line.id),
        sku: clean(line.sku),
        title: line.name,
        quantity: line.currentQuantity,
        unit_price: toAmount(line.originalUnitPriceSet.shopMoney.amount, "unit price", order.name),
        postage_service: postageService,
      })),
    },
  }
}
