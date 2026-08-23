import type { Database } from "@/lib/supabase/database.types"

type ShippingSettingsRow = Database["public"]["Tables"]["shipping_settings"]["Row"]

/**
 * The sender as it is printed. Only Australia Post needs one from us: the
 * MyPost CSV's Send From columns and the self-printed A6 label. eParcel takes
 * the sender from the charge account and Aramex from its own account.
 */
export type SenderBlock = {
  name: string
  addressLine1: string
  addressLine2: string
  suburb: string
  state: string
  postcode: string
}

/**
 * Stand-ins for a customer with no email or no usable phone number. Blank means
 * unset, and `requireFallbacks` below is what stops an export in that case --
 * substituting our own contact details onto a customer's parcel is worse than
 * refusing to run.
 */
export type ContactFallbacks = {
  email: string
  phone: string
}

export function senderFrom(settings: ShippingSettingsRow): SenderBlock {
  return {
    name: settings.sender_name,
    addressLine1: settings.sender_address_line1,
    addressLine2: settings.sender_address_line2,
    suburb: settings.sender_suburb,
    state: settings.sender_state,
    postcode: settings.sender_postcode,
  }
}

/**
 * Reads the fallbacks, or explains what to go and set. Returned rather than
 * thrown so the export actions can surface it as an ordinary error message
 * pointing at the page that fixes it.
 */
export function requireFallbacks(
  settings: ShippingSettingsRow
): { fallbacks: ContactFallbacks; error: null } | { fallbacks: null; error: string } {
  const missing: string[] = []
  if (settings.fallback_email.trim() === "") missing.push("email")
  if (settings.fallback_phone.trim() === "") missing.push("phone")

  if (missing.length > 0) {
    return {
      fallbacks: null,
      error:
        `Set a fallback ${missing.join(" and ")} under Settings → Shipping → ` +
        `Shipping Constants first. Australia Post treats both as mandatory, and ` +
        `this export will not invent one.`,
    }
  }

  return {
    fallbacks: { email: settings.fallback_email, phone: settings.fallback_phone },
    error: null,
  }
}

/**
 * Raised by a carrier's row builder when an order cannot be expressed in that
 * carrier's format. Always names the invoice, because the operator's next step
 * is to open that order.
 *
 * Every one of these is a case xpros handles with a `?? default`, which is how
 * a mis-mapped shipping method becomes a parcel booked as the wrong product
 * with nothing logged.
 */
export class UnmappableOrderError extends Error {
  constructor(
    readonly invoiceNumber: string,
    reason: string
  ) {
    super(`${invoiceNumber}: ${reason}`)
    this.name = "UnmappableOrderError"
  }
}
