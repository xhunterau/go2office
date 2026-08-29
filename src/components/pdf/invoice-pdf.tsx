import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import { usableAddressLines } from "@/lib/fulfillment/csv"
import type { SenderBlock } from "@/lib/fulfillment/types"
import type { InvoiceOrder } from "@/lib/queries/invoices"
import { COMPANY, gstIncludedIn } from "@/lib/print/company"
import { displayShippingMethod } from "@/lib/orders/shipping-method"

export type InvoiceItem = {
  order: InvoiceOrder
  barcodeDataUrl: string
}

// @react-pdf works in points. A4 is 595 x 842pt; 34pt is a ~12mm margin.
const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 34,
    paddingVertical: 34,
    backgroundColor: "#FFFFFF",
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111827",
  },

  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  sellerBlock: { flex: 1, paddingRight: 20 },
  sellerName: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  sellerLine: { fontSize: 8, color: "#4B5563", lineHeight: 1.5 },
  unpaid: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#B91C1C",
    letterSpacing: 0.6,
    marginTop: 6,
  },

  invoiceBlock: { width: 190, alignItems: "flex-end" },
  invoiceLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6B7280",
    letterSpacing: 1,
  },
  invoiceNumber: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  barcodeImage: { width: 170, height: 34, marginVertical: 5 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  metaLabel: { fontSize: 8, color: "#6B7280" },
  metaValue: { fontSize: 8, fontFamily: "Helvetica-Bold", width: 76, textAlign: "right" },

  panels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  panel: { width: "48%" },
  panelTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    borderBottomWidth: 0.75,
    borderBottomColor: "#D1D5DB",
    paddingBottom: 3,
    marginBottom: 4,
  },
  panelStrong: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  panelLine: { fontSize: 9, lineHeight: 1.5 },
  fieldLabel: { fontSize: 7.5, color: "#6B7280", marginTop: 4 },

  table: { marginBottom: 10 },
  tableHead: { flexDirection: "row", backgroundColor: "#1F2937" },
  th: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },
  trAlt: { backgroundColor: "#F9FAFB" },
  td: { fontSize: 9, paddingVertical: 4, paddingHorizontal: 5 },
  colQty: { width: 38, textAlign: "center" },
  colItem: { flex: 1 },
  colPrice: { width: 74, textAlign: "right" },
  colTotal: { width: 74, textAlign: "right" },
  sku: { fontSize: 7.5, color: "#6B7280", marginTop: 1 },

  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  bankBox: {
    width: "44%",
    borderWidth: 0.75,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
    padding: 8,
  },
  bankTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  bankLine: { fontSize: 8, color: "#4B5563", lineHeight: 1.5 },

  totalsBox: { width: "50%", borderWidth: 0.75, borderColor: "#D1D5DB", padding: 8 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  totalsLabel: { fontSize: 9, color: "#4B5563" },
  totalsValue: { fontSize: 9 },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.25,
    borderTopColor: "#1F2937",
    paddingTop: 5,
    marginTop: 4,
  },
  grandText: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  gstNote: { fontSize: 7.5, color: "#6B7280", textAlign: "right", marginTop: 3 },

  pageNote: {
    position: "absolute",
    bottom: 18,
    left: 34,
    right: 34,
    fontSize: 7.5,
    color: "#9CA3AF",
    textAlign: "center",
  },
})

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" })
const date = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" })

function aud(value: number): string {
  return money.format(value)
}

function day(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed)
}

function InvoicePage({ item, sender }: { item: InvoiceItem; sender: SenderBlock }) {
  const { order, barcodeDataUrl } = item
  const customer = order.customer

  // Same reason as the shipping label: address_line3 holds an `ebay:...`
  // reference code on 114,161 customers, and concatenating the four columns
  // straight would print it as part of the billing address (rule 24).
  const addressLines = customer ? usableAddressLines(customer) : []
  const localityLine = [customer?.city, customer?.state, customer?.postcode]
    .filter((part) => part != null && part !== "")
    .join(" ")

  const shipping = displayShippingMethod(order)
  const gst = gstIncludedIn(order.order_total)

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.headerRow}>
        <View style={styles.sellerBlock}>
          <Text style={styles.sellerName}>{COMPANY.legalName}</Text>
          <Text style={styles.sellerLine}>ABN {COMPANY.abn}</Text>
          <Text style={styles.sellerLine}>{sender.addressLine1}</Text>
          {sender.addressLine2 ? (
            <Text style={styles.sellerLine}>{sender.addressLine2}</Text>
          ) : null}
          <Text style={styles.sellerLine}>
            {`${sender.suburb} ${sender.state} ${sender.postcode}`}
          </Text>
          {/* Marked when unpaid, not when paid. `unpaid` is an explicit status
              here, whereas "paid" would have to be inferred from the absence of
              it -- and an invoice that wrongly says PAID is the expensive
              mistake of the two. */}
          {order.status === "unpaid" ? (
            <Text style={styles.unpaid}>PAYMENT OUTSTANDING</Text>
          ) : null}
        </View>

        <View style={styles.invoiceBlock}>
          <Text style={styles.invoiceLabel}>TAX INVOICE</Text>
          <Text style={styles.invoiceNumber}>{order.invoice_number}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's Image
              renders into a PDF and takes no alt prop. */}
          <Image style={styles.barcodeImage} src={barcodeDataUrl} />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>{day(order.created_at)}</Text>
          </View>
          {order.posted_on_date ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Dispatched</Text>
              <Text style={styles.metaValue}>{day(order.posted_on_date)}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.panels}>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Bill To</Text>
          <Text style={styles.panelStrong}>{customer?.full_name ?? "—"}</Text>
          {customer?.company_name ? (
            <Text style={styles.panelLine}>{customer.company_name}</Text>
          ) : null}
          {addressLines.map((line, index) => (
            <Text key={index} style={styles.panelLine}>
              {line}
            </Text>
          ))}
          {localityLine ? <Text style={styles.panelLine}>{localityLine}</Text> : null}
          {customer?.country && customer.country !== "AU" ? (
            <Text style={styles.panelLine}>{customer.country}</Text>
          ) : null}
          {customer?.email ? (
            <Text style={styles.panelLine}>{customer.email}</Text>
          ) : null}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Order Details</Text>
          <Text style={styles.fieldLabel}>Shipping Method</Text>
          <Text style={styles.panelLine}>{shipping.label}</Text>
          {order.tracking_number ? (
            <>
              <Text style={styles.fieldLabel}>Tracking Number</Text>
              <Text style={styles.panelLine}>{order.tracking_number}</Text>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHead} fixed>
          <Text style={[styles.th, styles.colQty]}>Qty</Text>
          <Text style={[styles.th, styles.colItem]}>Product</Text>
          <Text style={[styles.th, styles.colPrice]}>Price</Text>
          <Text style={[styles.th, styles.colTotal]}>Subtotal</Text>
        </View>

        {order.lines.length === 0 ? (
          <View style={styles.tr}>
            {/* 25 migrated orders genuinely have no lines. */}
            <Text style={[styles.td, styles.colItem]}>No items on this order.</Text>
          </View>
        ) : (
          order.lines.map((line, index) => (
            <View
              key={line.id}
              style={index % 2 === 1 ? [styles.tr, styles.trAlt] : styles.tr}
              wrap={false}
            >
              <Text style={[styles.td, styles.colQty]}>{line.quantity}</Text>
              <View style={[styles.td, styles.colItem]}>
                <Text>{line.item_title ?? "—"}</Text>
                {line.custom_label ? (
                  <Text style={styles.sku}>SKU: {line.custom_label}</Text>
                ) : null}
              </View>
              <Text style={[styles.td, styles.colPrice]}>{aud(line.sale_price)}</Text>
              <Text style={[styles.td, styles.colTotal]}>
                {aud(line.sale_price * line.quantity)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.footerRow}>
        <View style={styles.bankBox}>
          <Text style={styles.bankTitle}>Bank Details</Text>
          <Text style={styles.bankLine}>Account Name: {COMPANY.bank.accountName}</Text>
          <Text style={styles.bankLine}>BSB: {COMPANY.bank.bsb}</Text>
          <Text style={styles.bankLine}>Account: {COMPANY.bank.accountNumber}</Text>
          <Text style={styles.bankLine}>Reference: {order.invoice_number}</Text>
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Sub Total</Text>
            <Text style={styles.totalsValue}>{aud(order.goods_total)}</Text>
          </View>
          {order.postage_and_handling > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Postage</Text>
              <Text style={styles.totalsValue}>{aud(order.postage_and_handling)}</Text>
            </View>
          ) : null}
          {order.discount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Discount</Text>
              <Text style={styles.totalsValue}>−{aud(order.discount)}</Text>
            </View>
          ) : null}
          <View style={styles.grandRow}>
            <Text style={styles.grandText}>TOTAL</Text>
            <Text style={styles.grandText}>{aud(order.order_total)}</Text>
          </View>
          {/* One eleventh, because every price in this system is GST inclusive.
              See gstIncludedIn(). */}
          <Text style={styles.gstNote}>Includes GST {aud(gst)}</Text>
        </View>
      </View>

      {/* Repeated on every page of this invoice, so a line list that runs over
          onto a second sheet still says which invoice it belongs to. No page
          numbers: @react-pdf counts them across the whole document, and a batch
          of invoices would number them 1..n through all of them. */}
      <Text style={styles.pageNote} fixed>
        {order.invoice_number}
      </Text>
    </Page>
  )
}

export function InvoicePdf({
  items,
  sender,
}: {
  items: InvoiceItem[]
  sender: SenderBlock
}) {
  return (
    <Document title="Invoices">
      {items.map((item) => (
        <InvoicePage key={item.order.id} item={item} sender={sender} />
      ))}
    </Document>
  )
}
