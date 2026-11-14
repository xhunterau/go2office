import { describe, expect, it } from "vitest"

import {
  mapShopifyOrder,
  numericIdFromGid,
  postageServiceFor,
  toAmount,
  UnimportableOrderError,
} from "@/lib/shopify/order-mapper"
import { ordersFilter, type ShopifyOrder } from "@/lib/shopify/orders"

// Shaped after #G2B24707, the newest unshipped order on 2026-11-11, with the
// personal details replaced.
function order(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    legacyResourceId: "7930453721225",
    name: "#G2B24707",
    createdAt: "2026-11-11T03:08:30Z",
    processedAt: "2026-11-11T03:08:31Z",
    cancelledAt: null,
    test: false,
    email: "buyer@example.com",
    phone: null,
    note: null,
    shippingLine: { title: "Rate Table" },
    totalShippingPriceSet: { shopMoney: { amount: "10.98" } },
    totalDiscountsSet: { shopMoney: { amount: "0.0" } },
    shippingAddress: {
      firstName: " Jane ",
      lastName: "Citizen",
      company: "",
      address1: "1 Example St ",
      address2: null,
      city: "Hallett Cove",
      provinceCode: "SA",
      zip: "5158",
      countryCodeV2: "AU",
      phone: "+61400000000",
    },
    lineItems: {
      pageInfo: { hasNextPage: false },
      edges: [
        {
          node: {
            id: "gid://shopify/LineItem/18738962825353",
            sku: " GB01448AF|FG ",
            name: "AQUA-X Stretch Long Sleeves - Fingerless Green",
            currentQuantity: 2,
            originalUnitPriceSet: { shopMoney: { amount: "18.50" } },
          },
        },
      ],
    },
    ...overrides,
  }
}

function payloadOf(input: ShopifyOrder) {
  const result = mapShopifyOrder(input)
  if (result.kind !== "import") throw new Error(`expected import, got skip: ${result.reason}`)
  return result.payload
}

describe("mapShopifyOrder", () => {
  it("maps the ids the legacy Shopify rows use", () => {
    const payload = payloadOf(order())
    // order_id_ebay / web_order_id hold the numeric order id, the name goes to
    // sales_record_number -- that is how the 25,567 historical lines are keyed,
    // and the duplicate check depends on it.
    expect(payload.shopify_order_id).toBe("7930453721225")
    expect(payload.name).toBe("#G2B24707")
    expect(payload.lines[0].line_id).toBe("18738962825353")
  })

  it("keeps a variant SKU verbatim apart from surrounding space", () => {
    expect(payloadOf(order()).lines[0].sku).toBe("GB01448AF|FG")
  })

  it("uses the purchase time, not the import time", () => {
    const payload = payloadOf(order())
    expect(payload.created_at).toBe("2026-11-11T03:08:30Z")
    expect(payload.processed_at).toBe("2026-11-11T03:08:31Z")
  })

  it("parses money and quantities", () => {
    const payload = payloadOf(order())
    expect(payload.postage).toBe(10.98)
    expect(payload.discount).toBe(0)
    expect(payload.lines[0]).toMatchObject({ quantity: 2, unit_price: 18.5 })
  })

  it("builds the customer from the shipping address, trimmed", () => {
    expect(payloadOf(order()).customer).toEqual({
      full_name: "Jane Citizen",
      email: "buyer@example.com",
      phone: "+61400000000",
      company_name: null,
      address_line1: "1 Example St",
      address_line2: null,
      city: "Hallett Cove",
      state: "SA",
      postcode: "5158",
      country: "AU",
    })
  })

  it("falls back to the order phone when the address has none", () => {
    const base = order()
    const payload = payloadOf(
      order({
        phone: "0411111111",
        shippingAddress: { ...base.shippingAddress!, phone: null },
      })
    )
    expect(payload.customer.phone).toBe("0411111111")
  })

  it("skips cancelled and test orders", () => {
    expect(mapShopifyOrder(order({ cancelledAt: "2026-11-11T04:00:00Z" }))).toEqual({
      kind: "skip",
      reason: "cancelled",
    })
    expect(mapShopifyOrder(order({ test: true }))).toEqual({ kind: "skip", reason: "test" })
  })

  it("drops lines edited down to nothing, and skips an order left with none", () => {
    const base = order()
    const removed = {
      node: { ...base.lineItems.edges[0].node, id: "gid://shopify/LineItem/1", currentQuantity: 0 },
    }

    const mixed = payloadOf(
      order({ lineItems: { pageInfo: { hasNextPage: false }, edges: [...base.lineItems.edges, removed] } })
    )
    expect(mixed.lines).toHaveLength(1)

    expect(
      mapShopifyOrder(order({ lineItems: { pageInfo: { hasNextPage: false }, edges: [removed] } }))
    ).toEqual({ kind: "skip", reason: "no_lines" })
  })

  it("refuses an order whose lines run past one page instead of truncating it", () => {
    const base = order()
    expect(() =>
      mapShopifyOrder(order({ lineItems: { ...base.lineItems, pageInfo: { hasNextPage: true } } }))
    ).toThrow(UnimportableOrderError)
  })

  it("refuses an order with no shipping address", () => {
    expect(() => mapShopifyOrder(order({ shippingAddress: null }))).toThrow(/no shipping address/)
  })
})

describe("postageServiceFor", () => {
  it("is Express only when the title says so", () => {
    expect(postageServiceFor("Express Post")).toBe("Express")
    expect(postageServiceFor("express")).toBe("Express")
    expect(postageServiceFor("Rate Table")).toBe("Standard")
    expect(postageServiceFor("Standard")).toBe("Standard")
    expect(postageServiceFor(null)).toBe("Standard")
  })
})

describe("toAmount", () => {
  it("reads blanks as 0 and rejects garbage", () => {
    expect(toAmount("", "x", "#1")).toBe(0)
    expect(toAmount(null, "x", "#1")).toBe(0)
    expect(toAmount("12.30", "x", "#1")).toBe(12.3)
    expect(() => toAmount("AU $8.95", "x", "#1")).toThrow(UnimportableOrderError)
  })
})

describe("numericIdFromGid", () => {
  it("takes the numeric tail and rejects anything else", () => {
    expect(numericIdFromGid("gid://shopify/LineItem/18738962825353")).toBe("18738962825353")
    expect(() => numericIdFromGid("gid://shopify/LineItem/abc")).toThrow(UnimportableOrderError)
  })
})

describe("ordersFilter", () => {
  it("pulls every unshipped order by default", () => {
    expect(ordersFilter()).toBe("fulfillment_status:unshipped")
  })

  it("narrows a test run to one order, with or without the #", () => {
    expect(ordersFilter("G2B24707")).toBe('name:"#G2B24707"')
    expect(ordersFilter("#G2B24707")).toBe('name:"#G2B24707"')
  })
})
