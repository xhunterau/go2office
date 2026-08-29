import { createElement, type ReactElement } from "react"
import { describe, expect, it } from "vitest"
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"

import { generateBarcodeDataUrl } from "@/lib/print/barcode"
import { gstIncludedIn } from "@/lib/print/company"
import { InvoicePdf, type InvoiceItem } from "@/components/pdf/invoice-pdf"
import type { SenderBlock } from "@/lib/fulfillment/types"
import type { InvoiceOrder } from "@/lib/queries/invoices"

// Same reasoning as the shipping-label smoke test: nothing here fails at
// compile time. @react-pdf needs a Node runtime, an Image src that is not a
// data URI renders as a silent blank box, and an unsupported style property is
// ignored rather than raised.

const SENDER: SenderBlock = {
  name: "Go2buy Australia",
  addressLine1: "Parcel Locker 10147 39821",
  addressLine2: "1-7 Venture Way",
  suburb: "Braeside",
  state: "VIC",
  postcode: "3195",
}

function order(overrides: Partial<InvoiceOrder> = {}): InvoiceOrder {
  return {
    id: 1,
    invoice_number: "26032497",
    status: "completed",
    platform: "ebay",
    shipping_method: "Parcel_Post",
    legacy_shipping_method: null,
    postage_and_handling: 9.95,
    discount: 0,
    tracking_number: "33GLH00357170100",
    created_at: "2026-08-01T00:00:00Z",
    posted_on_date: "2026-08-02",
    customer: {
      full_name: "Jane Doe",
      company_name: null,
      address_line1: "12 Smith Street",
      address_line2: "Unit 4",
      // The reference code the billing address must not show.
      address_line3: "ebay:1234567890",
      address_line4: null,
      city: "Cardwell",
      state: "QLD",
      postcode: "4849",
      country: "AU",
      email: "jane@example.com",
      phone: "0431950696",
    },
    lines: [
      {
        id: 1,
        item_title: "Ergonomic Mesh Office Chair",
        custom_label: "CHAIR-001",
        quantity: 2,
        sale_price: 129.95,
      },
    ],
    goods_total: 259.9,
    order_total: 269.85,
    ...overrides,
  }
}

async function render(orders: InvoiceOrder[]): Promise<Buffer> {
  const items: InvoiceItem[] = await Promise.all(
    orders.map(async (o) => ({
      order: o,
      barcodeDataUrl: await generateBarcodeDataUrl(o.invoice_number),
    }))
  )

  return renderToBuffer(
    createElement(InvoicePdf, { items, sender: SENDER }) as ReactElement<DocumentProps>
  )
}

describe("gstIncludedIn", () => {
  // One eleventh of a GST-inclusive total, not 10% of it. Reading it the other
  // way overstates the tax by 10% and nothing on the page would look wrong.
  it("takes one eleventh of a GST-inclusive total", () => {
    expect(gstIncludedIn(110)).toBeCloseTo(10, 10)
    expect(gstIncludedIn(269.85)).toBeCloseTo(24.531818, 5)
  })

  it("returns zero for a zero total", () => {
    expect(gstIncludedIn(0)).toBe(0)
  })
})

describe("InvoicePdf", () => {
  it("renders a PDF", async () => {
    const buffer = await render([order()])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })

  it("renders one document per order in the order given", async () => {
    const one = await render([order()])
    const three = await render([
      order({ id: 1, invoice_number: "26032497" }),
      order({ id: 2, invoice_number: "26032498" }),
      order({ id: 3, invoice_number: "26032499" }),
    ])

    expect(three.byteLength).toBeGreaterThan(one.byteLength)
  })

  it("renders an order with no lines, which 25 migrated orders have", async () => {
    const buffer = await render([
      order({ lines: [], goods_total: 0, order_total: 0 }),
    ])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders an order whose customer row is missing", async () => {
    const buffer = await render([order({ customer: null })])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders a retired carrier, which has no shipping_method value", async () => {
    const buffer = await render([
      order({ shipping_method: null, legacy_shipping_method: "Fastway" }),
    ])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders an unpaid order, which carries the outstanding marker", async () => {
    const buffer = await render([order({ status: "unpaid" })])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders a long line list that overflows onto a second page", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      item_title: `Product number ${index + 1} with a fairly long descriptive name`,
      custom_label: `SKU-${index + 1}`,
      quantity: 1,
      sale_price: 19.95,
    }))
    const buffer = await render([order({ lines })])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
}, 30_000)
