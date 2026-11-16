import { describe, expect, it } from "vitest"

import {
  carrierFromTrackingNumber,
  EBAY_CARRIER_CODE,
  ebayCarrierCode,
  resolveShipment,
  SHOPIFY_TRACKING_COMPANY,
  UnmappableShipmentError,
} from "@/lib/fulfillment/platform-carriers"

const order = (
  shipping_method: Parameters<typeof resolveShipment>[0]["shipping_method"],
  tracking_number: string | null,
  invoice_number = "2603247F"
) => ({ shipping_method, tracking_number, invoice_number })

describe("carrierFromTrackingNumber", () => {
  it.each([
    ["MS0020074594", "aramex"],
    ["MP0090163399", "aramex"],
    ["33GLH0035717", "australia_post"],
    ["RPP4463700510013301258607", "australia_post"],
    ["TMP4463700510013301258607", "australia_post"],
    ["99721681914001000830906", "australia_post"],
    ["997963254831634098", "australia_post"],
  ] as const)("%s is %s", (tn, carrier) => {
    expect(carrierFromTrackingNumber(tn)).toBe(carrier)
  })

  it.each(["2603247B", "NEXAU1032004715YQ", "63408306856090", "MS", "99"])(
    "%s names no carrier",
    (tn) => {
      expect(carrierFromTrackingNumber(tn)).toBeNull()
    }
  )
})

describe("resolveShipment", () => {
  it("never sends a tracking number for a letter", () => {
    expect(resolveShipment(order("Letter", "99721681914001000830906"))).toEqual({ tracked: false })
  })

  it("treats the invoice number in the tracking field as no number", () => {
    expect(resolveShipment(order("Parcel_Post", "260322d5", "260322D5"))).toEqual({ tracked: false })
  })

  it("treats a missing number as untracked", () => {
    expect(resolveShipment(order("Mypost_Reg_S_Box", "  "))).toEqual({ tracked: false })
  })

  it("takes the carrier from the shipping method", () => {
    expect(resolveShipment(order("Mypost_Reg_S_Box", "99721651340801008320904"))).toEqual({
      tracked: true,
      carrier: "australia_post",
      trackingNumber: "99721651340801008320904",
    })
    expect(resolveShipment(order("Aramex_Satchel", "MS0020719756"))).toMatchObject({ carrier: "aramex" })
  })

  it("keeps the method's carrier for a number in no known format", () => {
    expect(resolveShipment(order("Express_Post", "63408306856090"))).toMatchObject({
      tracked: true,
      carrier: "australia_post",
    })
  })

  it("refuses when the method and the number disagree", () => {
    expect(() => resolveShipment(order("Express_Post", "MS0018757944"))).toThrow(
      UnmappableShipmentError
    )
  })

  it("decides Click and Collect and Store Delivery by the number's format", () => {
    expect(resolveShipment(order("Click_and_Collect", "33GLH0035591"))).toMatchObject({
      carrier: "australia_post",
    })
    expect(resolveShipment(order("Store_Delivery", "MP0079790949"))).toMatchObject({ carrier: "aramex" })
    expect(resolveShipment(order("Store_Delivery", "NEXAU1031475785YQ"))).toEqual({ tracked: false })
    expect(resolveShipment(order(null, "33GLH0035591"))).toMatchObject({ carrier: "australia_post" })
  })
})

describe("platform carrier names", () => {
  it("has a Shopify company for every carrier", () => {
    expect(SHOPIFY_TRACKING_COMPANY).toEqual({
      australia_post: "Australia Post",
      aramex: "Aramex Australia",
    })
  })

  it("sends Australia Post to eBay as AustraliaPost", () => {
    expect(ebayCarrierCode("australia_post")).toBe("AustraliaPost")
  })

  // Remove this test, not the throw, once the user has confirmed the code.
  it("refuses eBay Aramex until its code is confirmed", () => {
    expect(EBAY_CARRIER_CODE.aramex).toBeNull()
    expect(() => ebayCarrierCode("aramex")).toThrow(/not been confirmed/)
  })
})
