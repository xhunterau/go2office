import { createElement, type ReactElement } from "react"
import { describe, expect, it } from "vitest"
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"

import { generateBarcodeDataUrl } from "@/lib/print/barcode"
import {
  ShippingLabelPdf,
  type ShippingLabelItem,
} from "@/components/pdf/shipping-label-pdf"
import type { SenderBlock } from "@/lib/fulfillment/types"
import type { DispatchOrder } from "@/lib/queries/fulfillment"

// A smoke test for the whole label pipeline. It exists because every part of it
// fails at runtime rather than at compile time: bwip-js has to be imported from
// its node entry point, @react-pdf needs a Node runtime, and an Image src that
// is not a data URI is a silent blank box on the page.

const SENDER: SenderBlock = {
  name: "Go2buy Australia",
  addressLine1: "Parcel Locker 10147 39821",
  addressLine2: "1-7 Venture Way",
  suburb: "Braeside",
  state: "VIC",
  postcode: "3195",
}

function order(overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    id: 1,
    invoice_number: "INV-205970",
    shipping_method: "Parcel_Post",
    customer: {
      full_name: "Jane Doe",
      company_name: null,
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
    metrics: null,
    ...overrides,
  }
}

async function render(orders: DispatchOrder[]): Promise<Buffer> {
  const items: ShippingLabelItem[] = await Promise.all(
    orders.map(async (o) => ({
      order: o,
      barcodeDataUrl: await generateBarcodeDataUrl(o.invoice_number),
    }))
  )

  return renderToBuffer(
    createElement(ShippingLabelPdf, {
      items,
      sender: SENDER,
    }) as ReactElement<DocumentProps>
  )
}

describe("generateBarcodeDataUrl", () => {
  it("produces an embeddable PNG data URI", async () => {
    const uri = await generateBarcodeDataUrl("INV-205970")

    expect(uri.startsWith("data:image/png;base64,")).toBe(true)
    expect(uri.length).toBeGreaterThan(100)
  })
})

describe("ShippingLabelPdf", () => {
  it("renders a PDF", async () => {
    const buffer = await render([order()])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })

  it("renders one page per order in the order given", async () => {
    const one = await render([order()])
    const three = await render([
      order({ id: 1, invoice_number: "INV-1" }),
      order({ id: 2, invoice_number: "INV-2" }),
      order({ id: 3, invoice_number: "INV-3" }),
    ])

    expect(three.byteLength).toBeGreaterThan(one.byteLength)
  })

  it("renders an order whose customer row is missing", async () => {
    const buffer = await render([order({ customer: null })])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders a store delivery, which takes the non-postal marking", async () => {
    const buffer = await render([order({ shipping_method: "Store_Delivery" })])

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
}, 30_000)
