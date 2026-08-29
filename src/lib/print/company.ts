/**
 * Who the invoice is from.
 *
 * Hard-coded rather than held in a settings table (user decision, 2026-08-23).
 * These four facts change roughly never, and a settings page for them would be
 * a form nobody opens twice.
 *
 * The postal address is NOT here: it already lives in `shipping_settings`
 * (maintained at /settings/shipping/constants) as the sender block the parcel
 * labels carry, and the same address on an invoice would be a second copy to
 * keep in step. The invoice reads it from there.
 */
export const COMPANY = {
  /** The legal entity, with the trading name it sells under. Both belong on a
   *  tax invoice: the ABN is registered to the first, customers know the second. */
  legalName: "QDD BROS Pty Ltd T/A Go2buy Australia",
  abn: "86 985 850 094",
  bank: {
    name: "Bank",
    bsb: "303-829",
    accountNumber: "0177520",
    accountName: "QDD BROS Pty Ltd",
  },
} as const

/**
 * The GST contained in a GST-inclusive amount.
 *
 * Every price in this system is GST inclusive -- the rate cards, the Aramex
 * totals and the sale prices all are (docs/shipping-quote-engine.md) -- so the
 * tax is one eleventh of the total, not 10% on top of it. Getting this backwards
 * overstates the tax by 10% and nothing in the document would look wrong.
 */
export function gstIncludedIn(total: number): number {
  return total / 11
}
