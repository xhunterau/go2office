import { describe, expect, it } from "vitest"

import {
  buildConsignmentItem,
  mapOrderToConsignment,
  readConsignmentIds,
} from "@/lib/aramex/consignment"
import { UnmappableOrderError } from "@/lib/fulfillment/types"
import type { DispatchOrder } from "@/lib/queries/fulfillment"

const FALLBACKS = { email: "dispatch@example.com", phone: "+61300000000" }

function order(overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    id: 1,
    invoice_number: "INV-3001",
    shipping_method: "Aramex_Parcel",
    customer: {
      full_name: "Jane Doe",
      company_name: "Doe Supplies",
      address_line1: "12 Smith Street",
      address_line2: "Unit 4",
      address_line3: "ebay:1234567890",
      address_line4: null,
      city: "Cardwell",
      state: "QLD",
      postcode: "4849",
      country: "AU",
      email: "jane@example.com",
      phone: "0431950696",
    },
    metrics: {
      total_weight_kg: 1.4,
      chargeable_weight_kg: 2.2,
      goods_total: 120,
      total_cost: 60,
      dominant_length_mm: 305,
      dominant_width_mm: 210,
      dominant_height_mm: 45,
    },
    ...overrides,
  }
}

describe("buildConsignmentItem", () => {
  it("declares a parcel with its dominant dimensions in centimetres", () => {
    expect(buildConsignmentItem(order())).toEqual({
      Quantity: 1,
      PackageType: "P",
      Reference: "INV-3001",
      WeightDead: 1.4,
      Length: 30.5,
      Width: 21,
      Height: 4.5,
    })
  })

  it("declares a satchel by size rather than by dimensions", () => {
    const item = buildConsignmentItem(order({ shipping_method: "Aramex_Satchel" }))

    expect(item.PackageType).toBe("S")
    // 2.2kg chargeable falls in the A3 band.
    expect(item.SatchelSize).toBe("A3")
    expect(item.Length).toBeUndefined()
  })

  it("omits a dimension that was never recorded", () => {
    const item = buildConsignmentItem(
      order({ metrics: { ...order().metrics!, dominant_width_mm: null } })
    )
    expect(item.Width).toBeUndefined()
  })

  it("refuses a satchel over the 5kg limit, naming the invoice", () => {
    expect(() =>
      buildConsignmentItem(
        order({
          shipping_method: "Aramex_Satchel",
          metrics: { ...order().metrics!, chargeable_weight_kg: 6 },
        })
      )
    ).toThrow(/INV-3001/)
  })

  it("refuses an order with no computed metrics", () => {
    expect(() => buildConsignmentItem(order({ metrics: null }))).toThrow(
      UnmappableOrderError
    )
  })
})

describe("mapOrderToConsignment", () => {
  it("maps the customer onto the To contact", () => {
    const payload = mapOrderToConsignment(order(), FALLBACKS)

    expect(payload.To.ContactName).toBe("Jane Doe")
    expect(payload.To.BusinessName).toBe("Doe Supplies")
    expect(payload.To.PhoneNumber).toBe("+61431950696")
    expect(payload.To.Email).toBe("jane@example.com")
    expect(payload.To.Address).toMatchObject({
      StreetAddress: "12 Smith Street",
      Locality: "Cardwell",
      StateOrProvince: "QLD",
      PostalCode: "4849",
      Country: "AU",
    })
  })

  // xpros joins address lines 2 to 4 into AdditionalDetails with no filter, so
  // the eBay reference lands in the driver's delivery instructions.
  it("keeps the eBay reference code out of AdditionalDetails", () => {
    const payload = mapOrderToConsignment(order(), FALLBACKS)

    expect(payload.To.Address.AdditionalDetails).toBe("Unit 4")
    expect(JSON.stringify(payload)).not.toContain("ebay:")
  })

  it("omits AdditionalDetails when there is only a street line", () => {
    const payload = mapOrderToConsignment(
      order({
        customer: {
          ...order().customer!,
          address_line2: null,
          address_line3: null,
        },
      }),
      FALLBACKS
    )

    expect(payload.To.Address.AdditionalDetails).toBeUndefined()
  })

  it("uses the configured fallbacks when contact details are missing", () => {
    const payload = mapOrderToConsignment(
      order({ customer: { ...order().customer!, email: "  ", phone: null } }),
      FALLBACKS
    )

    expect(payload.To.Email).toBe("dispatch@example.com")
    expect(payload.To.PhoneNumber).toBe("+61300000000")
  })

  it("sends the invoice number as the external reference", () => {
    expect(mapOrderToConsignment(order(), FALLBACKS).ExternalRef1).toBe("INV-3001")
  })

  // Aramex answers an incomplete address with a 400 that names no order, so the
  // batch could not say which one to fix.
  it.each([
    ["address_line1", "street address"],
    ["city", "suburb"],
    ["state", "state"],
    ["postcode", "postcode"],
  ] as const)("refuses an address missing its %s", (column, label) => {
    const broken = order({
      customer: { ...order().customer!, [column]: null },
    })

    expect(() => mapOrderToConsignment(broken, FALLBACKS)).toThrow(label)
    expect(() => mapOrderToConsignment(broken, FALLBACKS)).toThrow(/INV-3001/)
  })

  it("refuses a customer with no name", () => {
    expect(() =>
      mapOrderToConsignment(
        order({ customer: { ...order().customer!, full_name: null } }),
        FALLBACKS
      )
    ).toThrow(UnmappableOrderError)
  })

  it("refuses an order with no customer at all", () => {
    expect(() => mapOrderToConsignment(order({ customer: null }), FALLBACKS)).toThrow(
      UnmappableOrderError
    )
  })
})

describe("readConsignmentIds", () => {
  // The shape a live booking actually returns, confirmed against
  // GET /api/consignments/171295222 on 2026-08-23.
  it("prefers the article label, which is the number a customer can track", () => {
    expect(
      readConsignmentIds({
        conId: 171295222,
        items: [{ conItemId: 1, label: "MS0020719756" }],
      })
    ).toEqual({ consignmentId: 171295222, trackingNumber: "MS0020719756" })
  })

  it("falls back to conId when the response carries no label", () => {
    expect(readConsignmentIds({ conId: 171295222 })).toEqual({
      consignmentId: 171295222,
      trackingNumber: "171295222",
    })
  })

  // xpros' spelling. The live API does not send it, which is why every booking
  // before 2026-08-23 wrote the literal string "undefined" to the order.
  it("still reads xpros' consignmentId if it ever appears", () => {
    expect(readConsignmentIds({ consignmentId: 42 })).toEqual({
      consignmentId: 42,
      trackingNumber: "42",
    })
  })

  it("returns nulls rather than a placeholder when nothing can be read", () => {
    expect(readConsignmentIds({})).toEqual({
      consignmentId: null,
      trackingNumber: null,
    })
    expect(readConsignmentIds({ items: [{ label: "   " }] })).toEqual({
      consignmentId: null,
      trackingNumber: null,
    })
  })
})
