import { describe, expect, it } from "vitest"

import { shortenItemTitle } from "@/lib/orders/item-title"

describe("shortenItemTitle", () => {
  it("returns an empty string for nothing", () => {
    expect(shortenItemTitle(null)).toBe("")
    expect(shortenItemTitle(undefined)).toBe("")
    expect(shortenItemTitle("   ")).toBe("")
  })

  it("leaves a short title alone", () => {
    expect(shortenItemTitle("Sony SR920 Watch Battery")).toBe(
      "Sony SR920 Watch Battery"
    )
  })

  it("leaves a short title with its variant alone", () => {
    expect(shortenItemTitle("Cooler Lunch Box[Blue]")).toBe("Cooler Lunch Box[Blue]")
  })

  // The reason this module exists.
  it("keeps the bracketed variant when the body is too long", () => {
    const full =
      "Wall Stickers Removable Art Vinyl Quote Decal Mural Home Room DIY Decor Windows[Our Kitchen Rules]"
    const short = shortenItemTitle(full)

    expect(short).toContain("[Our Kitchen Rules]")
    expect(short).toContain("Wall Stickers Removable")
    expect(short.length).toBeLessThan(full.length)
  })

  // Four such lines sit in the Postage queue today, identical for 78
  // characters. A plain truncate makes them indistinguishable.
  it("distinguishes titles that differ only inside the brackets", () => {
    const base =
      "Beston Rechargeable Battery NiMH AA AAA USB Charger 1.2V 3000mAh High Capacity"
    const a = shortenItemTitle(`${base}[2 x AA]`)
    const b = shortenItemTitle(`${base}[4 x AAA]`)

    expect(a).not.toBe(b)
    expect(a).toContain("[2 x AA]")
    expect(b).toContain("[4 x AAA]")
  })

  it("truncates a plain title and marks it with an ellipsis", () => {
    const full = "A ".repeat(60).trim()
    const short = shortenItemTitle(full)

    expect(short.endsWith("…")).toBe(true)
    expect(short.length).toBeLessThanOrEqual(71)
  })

  it("truncates an over-long variant too, so one line cannot run away", () => {
    const short = shortenItemTitle(
      `Short body[${"very long variant text ".repeat(4).trim()}]`
    )

    expect(short.endsWith("…]")).toBe(true)
    expect(short.length).toBeLessThanOrEqual(80)
  })

  it("treats empty brackets as no variant", () => {
    expect(shortenItemTitle("Cooler Lunch Box[]")).toBe("Cooler Lunch Box")
  })

  it("keeps the last group when a title has several bracketed parts", () => {
    expect(shortenItemTitle("Charger[EU][2 Pack]")).toBe("Charger[EU][2 Pack]")
  })

  it("cuts mid-word when the title is one unbroken token", () => {
    const short = shortenItemTitle("X".repeat(120))

    expect(short.endsWith("…")).toBe(true)
    // A word-boundary-only rule would have nothing to back off to and would
    // return the whole token.
    expect(short.length).toBeLessThanOrEqual(71)
  })

  it("does not leave a trailing space before the ellipsis", () => {
    const short = shortenItemTitle(
      "Portable Insulated Thermal Cooler Lunch Box Carry Tote Picnic Case Storage Bag"
    )

    expect(short).not.toContain(" …")
  })
})
