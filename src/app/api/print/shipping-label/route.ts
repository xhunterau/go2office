import { createElement, type ReactElement } from "react"
import type { NextRequest } from "next/server"
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"

import { createClient } from "@/lib/supabase/server"
import { parseOrderIds } from "@/lib/print/parse-ids"
import { generateBarcodeDataUrl } from "@/lib/print/barcode"
import { fetchOrdersForLabels } from "@/lib/queries/fulfillment"
import { fetchShippingSettings } from "@/lib/queries/shipping-reference"
import {
  ShippingLabelPdf,
  type ShippingLabelItem,
} from "@/components/pdf/shipping-label-pdf"

// @react-pdf/renderer and bwip-js are both Node-only.
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * A ceiling on one request, so a mistyped id list cannot ask for a PDF of every
 * order ever placed. Well above any real dispatch batch -- the queue is single
 * digits today and the largest historical day is nowhere near this.
 */
const MAX_LABELS_PER_REQUEST = 250

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // xpros' equivalent route runs under the service role with no auth check at
  // all, which makes every customer's address readable by anyone who can guess
  // an order id. Reading through the request's own client means the session is
  // required and RLS still applies.
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
  if (ids.length > MAX_LABELS_PER_REQUEST) {
    return new Response(
      `Too many labels in one request (${ids.length}); the limit is ${MAX_LABELS_PER_REQUEST}.`,
      { status: 400 }
    )
  }

  const [orders, settings] = await Promise.all([
    fetchOrdersForLabels(supabase, ids),
    fetchShippingSettings(supabase),
  ])

  if (orders.error) {
    return new Response(`Failed to load orders: ${orders.error}`, { status: 500 })
  }
  if (settings.error || !settings.data) {
    return new Response(
      `Failed to load the sender address: ${settings.error ?? "missing"}`,
      { status: 500 }
    )
  }
  if (!orders.data || orders.data.length === 0) {
    return new Response("No orders found", { status: 404 })
  }

  const items: ShippingLabelItem[] = await Promise.all(
    orders.data.map(async (order) => ({
      order,
      barcodeDataUrl: await generateBarcodeDataUrl(order.invoice_number),
    }))
  )

  const buffer = await renderToBuffer(
    createElement(ShippingLabelPdf, {
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
      "Content-Disposition": 'inline; filename="shipping-labels.pdf"',
      "Cache-Control": "no-store",
    },
  })
}
