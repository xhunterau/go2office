import { describe, expect, it } from "vitest"

import { debugSettingSchema } from "@/lib/validations/debug-setting"

const key = "shopify_import_test_order"

function issues(input: { key: string; enabled: boolean; value: string }) {
  const result = debugSettingSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe("debugSettingSchema", () => {
  it("accepts an order name or a numeric id", () => {
    expect(issues({ key, enabled: true, value: "#G2B24707" })).toEqual([])
    expect(issues({ key, enabled: true, value: "G2B24707" })).toEqual([])
    expect(issues({ key, enabled: true, value: "7930453721225" })).toEqual([])
  })

  it("refuses on with no value, which would look like debug mode and act normal", () => {
    expect(issues({ key, enabled: true, value: "  " })).toEqual([
      "Enter a value, or turn the switch off",
    ])
  })

  it("allows off with no value", () => {
    expect(issues({ key, enabled: false, value: "" })).toEqual([])
  })

  it("still checks a value kept while off", () => {
    expect(issues({ key, enabled: false, value: 'G2B1" OR x' })).toHaveLength(1)
  })

  it("refuses a key no code reads", () => {
    expect(issues({ key: "nobody_reads_this", enabled: true, value: "x" })).toEqual([
      "No code reads this setting",
    ])
  })

  it("trims the value", () => {
    const result = debugSettingSchema.parse({ key, enabled: true, value: " #G2B24707 " })
    expect(result.value).toBe("#G2B24707")
  })
})
