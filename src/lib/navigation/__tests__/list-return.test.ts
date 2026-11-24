import { describe, expect, it } from "vitest"

import { detailHref, listHref } from "@/lib/navigation/list-return"

describe("detailHref", () => {
  it("returns the bare path when the list has no query", () => {
    expect(detailHref("/orders/1", "")).toBe("/orders/1")
  })

  it("round-trips the list query through listHref", () => {
    const query = "status=pending&q=G2B%23123&field=order_no&page=3"
    const href = detailHref("/orders/1", query)
    const returned = new URL(href, "http://x").searchParams.get("list") ?? undefined
    expect(listHref("/orders", returned)).toBe(
      "/orders?status=pending&q=G2B%23123&field=order_no&page=3"
    )
  })
})

describe("listHref", () => {
  it("falls back to the list path without a return param", () => {
    expect(listHref("/products", undefined)).toBe("/products")
    expect(listHref("/products", "")).toBe("/products")
  })

  it("takes the first value of a repeated param", () => {
    expect(listHref("/products", ["sku=ABC", "sku=XYZ"])).toBe("/products?sku=ABC")
  })

  it("never leaves the fixed list path", () => {
    expect(listHref("/orders", "//evil.example/x")).toBe(
      "/orders?%2F%2Fevil.example%2Fx="
    )
    expect(listHref("/orders", "https://evil.example")).toMatch(/^\/orders\?/)
  })
})
