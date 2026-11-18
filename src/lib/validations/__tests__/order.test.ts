import { describe, expect, it } from "vitest"

import { manualOrderCreateSchema, orderUpdateSchema } from "@/lib/validations/order"

const valid = { customer_id: 42, postage_and_handling: 12.5, discount: 0, comments: "" }

describe("manualOrderCreateSchema", () => {
  it("accepts a customer with zero postage and no comments", () => {
    expect(manualOrderCreateSchema.safeParse({ ...valid, postage_and_handling: 0 }).success).toBe(true)
  })

  it("requires a picked customer", () => {
    const result = manualOrderCreateSchema.safeParse({ ...valid, customer_id: 0 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe("Select a customer")
  })

  it.each([
    ["postage_and_handling", -1, "Postage cannot be negative"],
    ["postage_and_handling", 1.005, "Postage cannot have more than two decimal places"],
    ["discount", -0.01, "Discount cannot be negative"],
    ["discount", 100000, "Discount is too large"],
  ])("rejects %s = %s", (field, value, message) => {
    const result = manualOrderCreateSchema.safeParse({ ...valid, [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(message)
  })

  it("trims comments", () => {
    expect(manualOrderCreateSchema.parse({ ...valid, comments: "  call first  " }).comments).toBe("call first")
  })
})

// The postage rule is shared with the order edit form; it must not have drifted.
describe("orderUpdateSchema postage", () => {
  it("still rejects negative postage with the same message", () => {
    const result = orderUpdateSchema.shape.postage_and_handling.safeParse(-1)
    expect(result.error?.issues[0]?.message).toBe("Postage cannot be negative")
  })
})
