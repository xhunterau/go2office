import { shopifyQuery } from "@/lib/shopify/client"

// The orders query the import runs, and the shape it returns.
//
// Differences from xpros' ORDERS_QUERY, each one a field the go2office data
// needs and xpros never stored:
//   - line items carry `id`. LineItem has no legacyResourceId (the API rejects
//     the field), so the numeric line id that goes into transaction_id_ebay is
//     the tail of the gid;
//   - createdAt / processedAt, because sale_date is when the customer bought,
//     not when the import ran (xpros writes now());
//   - provinceCode / countryCodeV2 instead of the display names;
//   - cancelledAt and test, so neither is imported;
//   - currentQuantity rather than quantity, so lines edited out of the order
//     are not shipped;
//   - lineItems carries pageInfo, so an order with more lines than one page is
//     refused instead of silently truncated.
// Dropped: customer.defaultAddress (needs read_customers, and an order that has
// to ship always has a shipping address) and fulfillmentOrders (only used for
// pickup detection; go2office has no Click & Collect).

/** Lines fetched per order. An order with more is refused, not truncated. */
export const LINE_ITEMS_PER_ORDER = 100

export type ShopifyMoney = { shopMoney: { amount: string } }

export type ShopifyOrderLine = {
  /** gid://shopify/LineItem/18738962825353 */
  id: string
  sku: string | null
  name: string
  /**
   * What is still to ship, after order edits and refunds. `quantity` keeps the
   * original count of a line that was edited out, which would import goods the
   * customer no longer wants -- and a 0 trips order_transactions' quantity > 0
   * CHECK and fails the whole order.
   */
  currentQuantity: number
  originalUnitPriceSet: ShopifyMoney
}

export type ShopifyAddress = {
  firstName: string | null
  lastName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  provinceCode: string | null
  zip: string | null
  countryCodeV2: string | null
  phone: string | null
}

export type ShopifyOrder = {
  legacyResourceId: string
  /** "#G2B24707" */
  name: string
  createdAt: string
  processedAt: string | null
  cancelledAt: string | null
  test: boolean
  email: string | null
  phone: string | null
  note: string | null
  shippingLine: { title: string } | null
  totalShippingPriceSet: ShopifyMoney
  totalDiscountsSet: ShopifyMoney
  shippingAddress: ShopifyAddress | null
  lineItems: {
    pageInfo: { hasNextPage: boolean }
    edges: { node: ShopifyOrderLine }[]
  }
}

const ORDERS_QUERY = `
query ImportOrders($cursor: String, $queryFilter: String!) {
  orders(first: 25, after: $cursor, query: $queryFilter, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        legacyResourceId
        name
        createdAt
        processedAt
        cancelledAt
        test
        email
        phone
        note
        shippingLine { title }
        totalShippingPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        shippingAddress {
          firstName lastName company address1 address2 city
          provinceCode zip countryCodeV2 phone
        }
        lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
          pageInfo { hasNextPage }
          edges {
            node {
              id sku name currentQuantity
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  }
}
`

type OrdersQueryResult = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    edges: { node: ShopifyOrder }[]
  }
}

/**
 * Which orders to pull: everything not yet shipped, as xpros does, relying on
 * the duplicate check to make re-runs harmless. A test run narrows it to one
 * order by its name ("#G2B24707").
 */
export function ordersFilter(testOrderName?: string): string {
  if (testOrderName) {
    const name = testOrderName.trim().replace(/"/g, "")
    return `name:"${name.startsWith("#") ? name : `#${name}`}"`
  }
  return "fulfillment_status:unshipped"
}

export async function fetchShopifyOrdersPage(
  cursor: string | null,
  testOrderName?: string
): Promise<{ orders: ShopifyOrder[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await shopifyQuery<OrdersQueryResult>(ORDERS_QUERY, {
    cursor,
    queryFilter: ordersFilter(testOrderName),
  })

  return {
    orders: data.orders.edges.map((edge) => edge.node),
    hasNextPage: data.orders.pageInfo.hasNextPage,
    endCursor: data.orders.pageInfo.endCursor,
  }
}
