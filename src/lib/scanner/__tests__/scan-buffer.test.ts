import { describe, expect, it } from "vitest"

import { EMPTY_BUFFER, feedKey, MAX_SCAN_KEY_GAP_MS, type ScanBuffer, type ScanStep } from "@/lib/scanner/scan-buffer"

/** Types `keys` one after another `gap` ms apart and returns every scan produced. */
function type(keys: string[], gap: number, start = 1000): string[] {
  let buffer: ScanBuffer = EMPTY_BUFFER
  const scans: string[] = []
  keys.forEach((key, i) => {
    const step: ScanStep = feedKey(buffer, key, start + i * gap)
    buffer = step.buffer
    if (step.kind === "scan") scans.push(step.value)
  })
  return scans
}

const chars = (s: string) => [...s]

describe("feedKey", () => {
  it("recognises a fast burst ending in Enter", () => {
    expect(type([...chars("33GLH0035717"), "Enter"], 5)).toEqual(["33GLH0035717"])
  })

  it("ignores slow human typing", () => {
    expect(type([...chars("hello world"), "Enter"], 150)).toEqual([])
  })

  it("ignores a lone Enter and codes shorter than the minimum", () => {
    expect(type(["Enter"], 5)).toEqual([])
    expect(type([...chars("abc"), "Enter"], 5)).toEqual([])
  })

  it("drops an Enter that arrives after a pause", () => {
    expect(type([...chars("ABCDEF"), "Enter"], MAX_SCAN_KEY_GAP_MS + 1)).toEqual([])
  })

  it("starts over when a burst follows stray keys", () => {
    let buffer: ScanBuffer = EMPTY_BUFFER
    buffer = feedKey(buffer, "x", 0).buffer // a stray key long before the scan
    let last: ScanStep = { kind: "buffer", buffer }
    chars("MS0020719756").forEach((key, i) => {
      last = feedKey(buffer, key, 5000 + i * 5)
      buffer = last.buffer
    })
    last = feedKey(buffer, "Enter", 5000 + 12 * 5)
    expect(last).toMatchObject({ kind: "scan", value: "MS0020719756" })
  })

  it("skips non-character keys such as Shift inside a scan", () => {
    expect(type(["Shift", ...chars("AB12"), "Shift", ...chars("CD"), "Enter"], 5)).toEqual(["AB12CD"])
  })

  it("can produce consecutive scans", () => {
    expect(type([...chars("AAAA1111"), "Enter", ...chars("BBBB2222"), "Enter"], 5)).toEqual([
      "AAAA1111",
      "BBBB2222",
    ])
  })
})
