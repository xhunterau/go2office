// The two halves of the Aramex API this app uses: quoting (POST
// /api/consignments/quote) and booking (POST /api/consignments).
//
// Neither request carries a sender. Aramex takes the pickup address from the
// account, which is why shipping_settings' sender block is Australia Post's
// only.

export interface AramexAddress {
  StreetAddress: string
  AdditionalDetails?: string
  Locality: string
  StateOrProvince: string
  PostalCode: string
  Country: string
}

export interface AramexContact {
  ContactName: string
  BusinessName?: string
  PhoneNumber: string
  Email: string
  Address: AramexAddress
}

export interface AramexConsignmentRequest {
  To: AramexContact
  Items: [AramexItem]
  /** Printed on the label for the driver. */
  InstructionsPublic?: string
  /** Our reference, echoed back on the Aramex manifest. */
  ExternalRef1?: string
  ExternalRef2?: string
}

/** One booked item inside a consignment. A consignment we book always has one. */
export interface AramexConsignmentItemResult {
  conItemId?: number
  /**
   * The trackable article number printed on the label, e.g. "MS0020719756".
   * This is what a customer can look up -- conId cannot.
   */
  label?: string | null
}

export interface AramexConsignmentResponse {
  data: {
    /**
     * Aramex's internal consignment id, e.g. 171295222. Verified against a live
     * GET /api/consignments/{conId} on 2026-08-23.
     */
    conId?: number
    /**
     * What xpros reads (`response.data.consignmentId`). The live API does not
     * send this key, so xpros' expression evaluates to undefined -- which never
     * showed there because xpros throws the id away instead of storing it. Kept
     * as a fallback in case the field ever appears; see docs/fulfillment-labels.md.
     */
    consignmentId?: number
    items?: AramexConsignmentItemResult[]
  }
}

export type AramexSatchelSize = "300gm" | "A2" | "A3" | "A4" | "A5"

export interface AramexItem {
  Quantity: number
  // P = own packaging (dimensions required), S = Aramex satchel (size required).
  PackageType: "P" | "S"
  SatchelSize?: AramexSatchelSize
  /** Booking only; quotes do not carry a per-item reference. */
  Reference?: string
  WeightDead?: number
  // Centimetres, one decimal place.
  Length?: number
  Width?: number
  Height?: number
}

export interface AramexQuoteRequest {
  To: AramexContact
  Items: [AramexItem]
}

export interface AramexQuoteResponseItem {
  description: string
  price: number
  tax: number
  total: number
}

export interface AramexQuoteResponse {
  price: number
  tax: number
  total: number
  items: AramexQuoteResponseItem[]
}

export interface AramexTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

export class AramexAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AramexAuthError"
  }
}

export class AramexApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message)
    this.name = "AramexApiError"
  }
}
