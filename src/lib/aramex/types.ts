// Only the quoting half of the Aramex API. Consignment creation (labels,
// manifests, tracking) is a separate job and its types are not ported here.

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

export type AramexSatchelSize = "300gm" | "A2" | "A3" | "A4" | "A5"

export interface AramexItem {
  Quantity: number
  // P = own packaging (dimensions required), S = Aramex satchel (size required).
  PackageType: "P" | "S"
  SatchelSize?: AramexSatchelSize
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
