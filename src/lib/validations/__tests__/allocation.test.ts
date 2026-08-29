import { describe, expect, it } from "vitest"

import {
  allocationAddressSchema,
  manualApprovalSchema,
  MANUAL_APPROVAL_METHODS,
} from "@/lib/validations/allocation"
import { UNROUTED_METHODS } from "@/lib/fulfillment/carrier-groups"
import { normalizePostcode } from "@/lib/shipping/adapters/zone-resolver"

const valid = {
  address_line1: "1 Venture Way",
  address_line2: "",
  city: "Braeside",
  postcode: "3195",
}

describe("allocationAddressSchema", () => {
  it("accepts a complete address", () => {
    expect(allocationAddressSchema.safeParse(valid).success).toBe(true)
  })

  // The whole reason this queue exists: public.postcodes stores four digits
  // under a CHECK, so a three-digit Northern Territory postcode never matches
  // and the address is silently unresolvable. xpros strips leading zeros
  // instead, because ITS reference table lost them (CLAUDE.md rule 21).
  it("pads a three-digit NT postcode rather than stripping zeros", () => {
    const parsed = allocationAddressSchema.parse({ ...valid, postcode: "800" })
    expect(parsed.postcode).toBe("0800")
  })

  it("leaves an already-padded postcode alone", () => {
    expect(allocationAddressSchema.parse({ ...valid, postcode: "0800" }).postcode).toBe(
      "0800"
    )
  })

  it("agrees with the resolver's normalisation on every form it accepts", () => {
    // Both sides of the same rule. If these ever disagree, an address saved
    // here resolves on save and fails at quote time, with nothing to show why.
    for (const input of ["800", "0800", "3195", " 3195 "]) {
      const parsed = allocationAddressSchema.safeParse({ ...valid, postcode: input })
      if (!parsed.success) continue
      expect(parsed.data.postcode).toBe(normalizePostcode(input))
    }
  })

  it("rejects a postcode that is not digits", () => {
    expect(allocationAddressSchema.safeParse({ ...valid, postcode: "3195A" }).success).toBe(
      false
    )
    expect(allocationAddressSchema.safeParse({ ...valid, postcode: "31955" }).success).toBe(
      false
    )
  })

  // Stricter than customerSchema on purpose: this screen's job is to catch an
  // order that cannot be delivered, and a blank street is exactly that.
  it("requires a street and a suburb", () => {
    expect(allocationAddressSchema.safeParse({ ...valid, address_line1: "" }).success).toBe(
      false
    )
    expect(allocationAddressSchema.safeParse({ ...valid, city: "  " }).success).toBe(false)
  })

  // state is derived by customers_standardize_address and country would eject
  // the order from an AU-only queue. Neither may be smuggled through.
  it("drops state and country instead of saving them", () => {
    const parsed = allocationAddressSchema.parse({
      ...valid,
      state: "QLD",
      country: "NZ",
    } as never)
    expect(parsed).not.toHaveProperty("state")
    expect(parsed).not.toHaveProperty("country")
  })
})

describe("manualApprovalSchema", () => {
  it("accepts a routed method and a cost", () => {
    expect(
      manualApprovalSchema.safeParse({ shipping_method: "Parcel_Post", postage_paid: 9.5 })
        .success
    ).toBe(true)
  })

  // An order approved onto a method with no label channel would move to
  // `processing` and then never appear on /fulfillment/export-labels -- it
  // would simply be gone, which is the failure carrier-groups.ts exists to
  // prevent (CLAUDE.md rule 24).
  it("refuses every method that has no label channel", () => {
    for (const method of UNROUTED_METHODS) {
      expect(MANUAL_APPROVAL_METHODS).not.toContain(method)
      expect(
        manualApprovalSchema.safeParse({ shipping_method: method, postage_paid: 0 }).success
      ).toBe(false)
    }
  })

  it("rejects a negative cost and sub-cent precision", () => {
    expect(
      manualApprovalSchema.safeParse({ shipping_method: "Parcel_Post", postage_paid: -1 })
        .success
    ).toBe(false)
    expect(
      manualApprovalSchema.safeParse({
        shipping_method: "Parcel_Post",
        postage_paid: 9.555,
      }).success
    ).toBe(false)
  })

  it("allows zero, for an order whose cost is not known yet", () => {
    expect(
      manualApprovalSchema.safeParse({ shipping_method: "Parcel_Post", postage_paid: 0 })
        .success
    ).toBe(true)
  })
})
