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

export interface AramexConsignmentResponse {
  data: {
    consignmentId: number
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
