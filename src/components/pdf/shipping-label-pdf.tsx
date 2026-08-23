import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import { usableAddressLines } from "@/lib/fulfillment/csv"
import type { SenderBlock } from "@/lib/fulfillment/types"
import type { DispatchOrder } from "@/lib/queries/fulfillment"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import type { ShippingMethod } from "@/lib/orders/shipping-method"

export type ShippingLabelItem = {
  order: DispatchOrder
  barcodeDataUrl: string
}

// Australia Post products carry prepaid postage; a store delivery does not, and
// printing "POSTAGE PAID AUSTRALIA" on one would be a false postal marking.
// xpros prints the box unconditionally because its self-print group has no
// non-postal method in it.
const POSTAL_METHODS = new Set<ShippingMethod>([
  "Letter",
  "Register_Letter",
  "Parcel_Post",
  "Express_Post",
])

// A6 is 105mm x 148mm. @react-pdf works in points (1mm ~ 2.835pt), so the
// paddings below are points, sized to leave a ~6mm quiet margin all round.
const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 17,
    paddingVertical: 17,
    backgroundColor: "#FFFFFF",
    fontFamily: "Helvetica",
    flexDirection: "column",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    paddingBottom: 6,
    marginBottom: 6,
  },
  fromBlock: { flexDirection: "column", flex: 1 },
  fromLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#4B5563",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fromText: { fontSize: 9, color: "#374151", lineHeight: 1.4 },
  marking: {
    width: 56,
    height: 56,
    borderWidth: 1.5,
    borderColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    flexShrink: 0,
  },
  markingText: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    lineHeight: 1.4,
  },
  methodRow: {
    borderBottomWidth: 0.75,
    borderBottomColor: "#9CA3AF",
    paddingBottom: 5,
    marginBottom: 6,
  },
  methodText: { fontSize: 14, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  toSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    paddingVertical: 12,
    marginBottom: 6,
  },
  toLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#4B5563",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  toName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 6,
  },
  toCompany: {
    fontSize: 13,
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 4,
  },
  toAddress: { fontSize: 13, textAlign: "center", lineHeight: 1.6, marginBottom: 2 },
  barcodeSection: { alignItems: "center" },
  barcodeImage: { width: 200, height: 44 },
  barcodeCaption: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
    marginTop: 2,
    textAlign: "center",
  },
})

function methodHeading(method: ShippingMethod | null): string {
  if (!method) return "—"
  return SHIPPING_METHOD_LABELS[method].toUpperCase()
}

function ShippingLabelPage({
  item,
  sender,
}: {
  item: ShippingLabelItem
  sender: SenderBlock
}) {
  const { order, barcodeDataUrl } = item
  const customer = order.customer

  // The reference-code filter is the whole reason this goes through
  // usableAddressLines: address_line3 holds an `ebay:...` code on 114,161 rows,
  // and concatenating the columns straight would print it on the parcel.
  const addressLines = customer ? usableAddressLines(customer) : []

  const localityLine = [customer?.city, customer?.state, customer?.postcode]
    .filter((part) => part != null && part !== "")
    .join(" ")

  const isPostal = order.shipping_method != null && POSTAL_METHODS.has(order.shipping_method)

  return (
    <Page size="A6" style={styles.page}>
      <View style={styles.headerRow}>
        <View style={styles.fromBlock}>
          <Text style={styles.fromLabel}>FROM</Text>
          <Text style={styles.fromText}>{sender.name}</Text>
          <Text style={styles.fromText}>{sender.addressLine1}</Text>
          {sender.addressLine2 ? (
            <Text style={styles.fromText}>{sender.addressLine2}</Text>
          ) : null}
          <Text style={styles.fromText}>
            {`${sender.suburb} ${sender.state} ${sender.postcode}`}
          </Text>
        </View>
        <View style={styles.marking}>
          <Text style={styles.markingText}>
            {isPostal ? "POSTAGE\nPAID\nAUSTRALIA" : "STORE\nDELIVERY"}
          </Text>
        </View>
      </View>

      <View style={styles.methodRow}>
        <Text style={styles.methodText}>{methodHeading(order.shipping_method)}</Text>
      </View>

      <View style={styles.toSection}>
        <Text style={styles.toLabel}>TO</Text>
        <Text style={styles.toName}>{customer?.full_name ?? "—"}</Text>
        {customer?.company_name ? (
          <Text style={styles.toCompany}>{customer.company_name}</Text>
        ) : null}
        {addressLines.map((line, index) => (
          <Text key={index} style={styles.toAddress}>
            {line}
          </Text>
        ))}
        {localityLine ? <Text style={styles.toAddress}>{localityLine}</Text> : null}
        {customer?.country && customer.country !== "AU" ? (
          <Text style={styles.toAddress}>{customer.country}</Text>
        ) : null}
      </View>

      <View style={styles.barcodeSection}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's Image
            renders into a PDF and takes no alt prop. */}
        <Image style={styles.barcodeImage} src={barcodeDataUrl} />
        <Text style={styles.barcodeCaption}>INV: {order.invoice_number}</Text>
      </View>
    </Page>
  )
}

export function ShippingLabelPdf({
  items,
  sender,
}: {
  items: ShippingLabelItem[]
  sender: SenderBlock
}) {
  return (
    <Document title="Shipping labels">
      {items.map((item) => (
        <ShippingLabelPage key={item.order.id} item={item} sender={sender} />
      ))}
    </Document>
  )
}
