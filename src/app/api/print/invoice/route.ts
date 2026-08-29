import { createElement, type ReactElement } from "react"
import type { NextRequest } from "next/server"
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"

import { createClient } from "@/lib/supabase/server"
import { parseOrderIds } from "@/lib/print/parse-ids"
import { generateBarcodeDataUrl } from "@/lib/print/barcode"
import { fetchOrdersForInvoices } from "@/lib/queries/invoices"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import { InvoicePdf, type InvoiceItem } from "@/components/pdf/invoice-pdf"

// @react-pdf/renderer and bwip-js are both Node-only.
export const runtime = "nodejs"
export const maxDuration = 60

/** Same ceiling as the shipping-label route, for the same reason. */
const MAX_INVOICES_PER_REQUEST = 250

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Through the request's own client, not the service role: an invoice carries
  // the customer's name, address and email, so the session is required and RLS
  // still applies (rule 24).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response("Authentication required", { status: 401 })
  }

  const ids = parseOrderIds(request.nextUrl.searchParams.get("ids"))
  if (ids.length === 0) {
    return new Response("Missing or invalid ids parameter", { status: 400 })
  }
  if (ids.length > MAX_INVOICES_PER_REQUEST) {
    return new Response(
      `Too many invoices in one request (${ids.length}); the limit is ${MAX_INVOICES_PER_REQUEST}.`,
      { status: 400 }
    )
  }

  // The sender block is the invoice's own postal address as well as the parcel
  // labels'; only the legal name, ABN and bank details are hard-coded
  // (src/lib/print/company.ts).
  const [orders, settings] = await Promise.all([
    fetchOrdersForInvoices(supabase, ids),
    fetchShippingSettings(supabase),
  ])

  if (orders.error) {
    return new Response(`Failed to load orders: ${orders.error}`, { status: 500 })
  }
  if (settings.error || !settings.data) {
    return new Response(
      `Failed to load the business address: ${settings.error ?? "missing"}`,
      { status: 500 }
    )
  }
  if (!orders.data || orders.data.length === 0) {
    return new Response("No orders found", { status: 404 })
  }

  const items: InvoiceItem[] = await Promise.all(
    orders.data.map(async (order) => ({
      order,
      barcodeDataUrl: await generateBarcodeDataUrl(order.invoice_number),
    }))
  )

  const buffer = await renderToBuffer(
    createElement(InvoicePdf, {
      items,
      sender: {
        name: settings.data.sender_name,
        addressLine1: settings.data.sender_address_line1,
        addressLine2: settings.data.sender_address_line2,
        suburb: settings.data.sender_suburb,
        state: settings.data.sender_state,
        postcode: settings.data.sender_postcode,
      },
    }) as ReactElement<DocumentProps>
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      // inline, so the browser's print dialog is one keystroke away rather than
      // the file landing in Downloads.
      "Content-Disposition": 'inline; filename="invoices.pdf"',
      "Cache-Control": "no-store",
    },
  })
}
