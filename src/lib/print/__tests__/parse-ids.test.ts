import { describe, expect, it } from "vitest"

import { parseOrderIds } from "@/lib/print/parse-ids"

describe("parseOrderIds", () => {
  it("parses a comma-separated list", () => {
    expect(parseOrderIds("1,2,3")).toEqual([1, 2, 3])
  })

  it("keeps first-seen order and drops duplicates", () => {
    expect(parseOrderIds("7,3,7,1,3")).toEqual([7, 3, 1])
  })

  it("tolerates whitespace", () => {
    expect(parseOrderIds(" 4 , 5 ")).toEqual([4, 5])
  })

  it("joins a repeated query parameter", () => {
    expect(parseOrderIds(["1,2", "3"])).toEqual([1, 2, 3])
  })

  // parseInt would take the leading digits of each of these and carry on.
  it.each(["12abc", "1.9", "-4", "0", "", "  ", "abc", "1e3", "0x10"])(
    "drops the unparseable value %j",
    (raw) => {
      expect(parseOrderIds(raw)).toEqual([])
    }
  )

  it("keeps the good ids from a partly broken list", () => {
    expect(parseOrderIds("1,nope,2")).toEqual([1, 2])
  })

  it.each([null, undefined, ""])("returns nothing for %j", (raw) => {
    expect(parseOrderIds(raw)).toEqual([])
  })

  it("rejects an id past the safe integer range", () => {
    expect(parseOrderIds("9007199254740993")).toEqual([])
  })
})
