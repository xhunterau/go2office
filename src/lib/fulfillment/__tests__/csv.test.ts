import { describe, expect, it } from "vitest"

import {
  cleanCommas,
  escapeCsvField,
  exportFilename,
  fitAddressLines,
  formatPhone,
  isReferenceCode,
  normaliseFallbackPhone,
  toCsv,
  usableAddressLines,
} from "@/lib/fulfillment/csv"

describe("escapeCsvField", () => {
  it.each([
    ["plain", "plain"],
    ["with,comma", '"with,comma"'],
    ['say "hi"', '"say ""hi"""'],
    ["line\nbreak", '"line\nbreak"'],
    ["", ""],
  ])("escapes %j", (input, expected) => {
    expect(escapeCsvField(input)).toBe(expected)
  })
})

describe("cleanCommas", () => {
  it("replaces commas with spaces and trims", () => {
    expect(cleanCommas("Unit 3, 220 Collins Street")).toBe("Unit 3  220 Collins Street")
    expect(cleanCommas("  padded  ")).toBe("padded")
  })

  it("maps null and undefined to an empty string", () => {
    expect(cleanCommas(null)).toBe("")
    expect(cleanCommas(undefined)).toBe("")
  })
})

describe("toCsv", () => {
  it("joins with CRLF, which is what the Australia Post parsers expect", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d")
  })
})

describe("exportFilename", () => {
  it("stamps local date and time", () => {
    const at = new Date(2026, 7, 23, 9, 5, 3)
    expect(exportFilename("mypost_export", at)).toBe("mypost_export_20260823_090503.csv")
  })
})

describe("isReferenceCode", () => {
  it.each(["ebay:123456", "eBay: 98765", "  EBAY:1", "ebay :4"])(
    "matches the marketplace reference %j",
    (value) => {
      expect(isReferenceCode(value)).toBe(true)
    }
  )

  it.each(["12 Ebay Court", "eBay House", "Unit 2", ""])(
    "leaves a real address line alone: %j",
    (value) => {
      expect(isReferenceCode(value)).toBe(false)
    }
  )
})

describe("usableAddressLines", () => {
  // The whole point of the module: 114,161 of 114,193 non-blank address_line3
  // values are eBay reference codes, and xpros would print them on the parcel.
  it("drops the eBay reference code sitting in address_line3", () => {
    expect(
      usableAddressLines({
        address_line1: "12 Smith Street",
        address_line2: "Unit 4",
        address_line3: "ebay:1234567890",
        address_line4: null,
      })
    ).toEqual(["12 Smith Street", "Unit 4"])
  })

  it("keeps a genuine third line", () => {
    expect(
      usableAddressLines({
        address_line1: "12 Smith Street",
        address_line2: "Unit 4",
        address_line3: "Rear entrance",
        address_line4: null,
      })
    ).toEqual(["12 Smith Street", "Unit 4", "Rear entrance"])
  })

  it("drops blanks and whitespace-only lines, preserving order", () => {
    expect(
      usableAddressLines({
        address_line1: "",
        address_line2: "  ",
        address_line3: "12 Smith Street",
        address_line4: null,
      })
    ).toEqual(["12 Smith Street"])
  })

  it("strips commas, because the carrier formats do not want them", () => {
    expect(
      usableAddressLines({
        address_line1: "Unit 3, 220 Collins Street",
        address_line2: null,
        address_line3: null,
        address_line4: null,
      })
    ).toEqual(["Unit 3  220 Collins Street"])
  })
})

describe("fitAddressLines", () => {
  it("pads to the slot count and reports no overflow", () => {
    expect(fitAddressLines(["12 Smith Street"], 3, 40)).toEqual({
      lines: ["12 Smith Street", "", ""],
      overflow: false,
    })
  })

  it("splits an over-long line at a word boundary into the next slot", () => {
    const long = "123 Extraordinarily Long Boulevard Northeast Extension"
    const { lines, overflow } = fitAddressLines([long, "Unit 9"], 3, 40)

    expect(lines[0]).toBe("123 Extraordinarily Long Boulevard")
    expect(lines[0].length).toBeLessThanOrEqual(40)
    expect(lines[1]).toBe("Northeast Extension")
    expect(lines[2]).toBe("Unit 9")
    expect(overflow).toBe(false)
  })

  it("cuts hard when a single token is longer than the limit", () => {
    const token = "A".repeat(50)
    const { lines } = fitAddressLines([token], 2, 40)

    expect(lines[0]).toBe("A".repeat(40))
    expect(lines[1]).toBe("A".repeat(10))
  })

  it("flags overflow rather than silently dropping content", () => {
    const long = "123 Extraordinarily Long Boulevard Northeast Extension"
    const { lines, overflow } = fitAddressLines([long, "Unit 9"], 2, 40)

    expect(lines).toHaveLength(2)
    expect(overflow).toBe(true)
  })

  it("returns empty slots for an address with nothing in it", () => {
    expect(fitAddressLines([], 4, 40)).toEqual({
      lines: ["", "", "", ""],
      overflow: false,
    })
  })
})

describe("formatPhone", () => {
  const FALLBACK = "+61300000000"

  it.each([
    ["0431 950 696", "+61431950696"],
    ["+61 431 950 696", "+61431950696"],
    ["(03) 9587 1234", "+61395871234"],
    ["61431950696", "+61431950696"],
  ])("normalises the Australian number %j", (input, expected) => {
    expect(formatPhone(input, "AU", FALLBACK)).toBe(expected)
  })

  it.each([null, undefined, "", "12345", "n/a"])(
    "falls back when %j is not a phone number",
    (input) => {
      expect(formatPhone(input, "AU", FALLBACK)).toBe(FALLBACK)
    }
  )

  // The fallback is typed by hand on the settings page, so it arrives in
  // whatever shape the operator uses. It has to leave in the same E.164 shape
  // as every other number in the column.
  it("normalises a fallback entered in local format", () => {
    expect(formatPhone(null, "AU", "0450952227")).toBe("+61450952227")
    expect(formatPhone("bad", "AU", "(03) 9587 1234")).toBe("+61395871234")
  })

  it("treats a blank country as domestic", () => {
    expect(formatPhone("0431950696", null, FALLBACK)).toBe("+61431950696")
  })

  // The column legitimately holds phone numbers and delivery notes on some
  // rows (CLAUDE.md rule 21), so only a well-formed ISO code counts as proof.
  it("treats an unparseable country as domestic", () => {
    expect(formatPhone("0431950696", "0355 123 456", FALLBACK)).toBe("+61431950696")
  })

  // xpros applies +61 unconditionally, turning an overseas number into a
  // plausible-looking Australian one.
  it("does not put +61 on an overseas number", () => {
    expect(formatPhone("+64 21 555 0199", "NZ", FALLBACK)).toBe("+64215550199")
    expect(formatPhone(null, "NZ", FALLBACK)).toBe(FALLBACK)
  })
})

describe("normaliseFallbackPhone", () => {
  it.each([
    ["0450952227", "+61450952227"],
    ["0450 952 227", "+61450952227"],
    ["+61450952227", "+61450952227"],
    ["+61 450 952 227", "+61450952227"],
    ["61450952227", "+61450952227"],
    ["(03) 9587 1234", "+61395871234"],
    ["+64 21 555 0199", "+64215550199"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normaliseFallbackPhone(input)).toBe(expected)
  })

  // Passed through rather than swallowed: a value that cannot be read as a
  // phone number should show up in the export, where someone will notice it.
  it.each(["", "ask reception", "1234"])("passes %j through unchanged", (input) => {
    expect(normaliseFallbackPhone(input)).toBe(input)
  })
})
