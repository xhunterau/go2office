// Telling a barcode scanner apart from a person at the keyboard.
//
// A USB / Bluetooth scanner is a keyboard that types very fast and ends with
// Enter. The page listens on the document, so it receives a scan without
// anything being focused -- which on a tablet also means no on-screen keyboard
// popping up over the page. The price is that it receives human typing too;
// the gap between keys is what separates the two.

/** A scanner types a character every few ms; people manage ~100ms at best. */
export const MAX_SCAN_KEY_GAP_MS = 50

/** Shorter than any invoice or tracking number, so stray Enter presses are ignored. */
export const MIN_SCAN_LENGTH = 4

export type ScanBuffer = { text: string; lastAt: number }

export const EMPTY_BUFFER: ScanBuffer = { text: "", lastAt: 0 }

export type ScanStep =
  | { kind: "buffer"; buffer: ScanBuffer }
  | { kind: "scan"; value: string; buffer: ScanBuffer }

/**
 * Feed one key. A pause longer than MAX_SCAN_KEY_GAP_MS starts a new buffer,
 * so slow typing never accumulates past one character and never reaches the
 * length a scan needs.
 */
export function feedKey(buffer: ScanBuffer, key: string, at: number): ScanStep {
  const stale = at - buffer.lastAt > MAX_SCAN_KEY_GAP_MS

  if (key === "Enter") {
    const value = stale ? "" : buffer.text.trim()
    return value.length >= MIN_SCAN_LENGTH
      ? { kind: "scan", value, buffer: EMPTY_BUFFER }
      : { kind: "buffer", buffer: EMPTY_BUFFER }
  }

  // Shift, Tab, arrows and the like: not part of a code.
  if (key.length !== 1) return { kind: "buffer", buffer }

  return { kind: "buffer", buffer: { text: (stale ? "" : buffer.text) + key, lastAt: at } }
}
