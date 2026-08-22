// Address lines that mean "there is no street here" -- a post office box, a bag
// or a locker. Carriers that hand a parcel to a driver for a door (Aramex)
// cannot deliver to one; only Australia Post products can.
//
// Every keyword ends in (?![a-z]) rather than xpros's bare match. Without it
// "PO Boxwood Street" reads as a PO box and every non-Australia-Post carrier is
// dropped from that order's quote -- quietly, since a shorter carrier list looks
// exactly like a heavy parcel. The lookahead still admits "PO Box123", where the
// next character is a digit.
const POSTAL_PATTERNS = [
  /\bPO\s*Box(?![a-z])/i,
  /\bGPO\s*Box(?![a-z])/i,
  /\bDPO\s*Box(?![a-z])/i,
  /\bLocked\s*Bag(?![a-z])/i,
  /\bPrivate\s*Bag(?![a-z])/i,
  /\bParcel\s*Locker(?![a-z])/i,
  /\bPMB\s*\d/i,
  /\bRMB\s*\d/i,
  /\bRSD\s*\d/i,
  /\bMS\s*\d/i,
  // Needs the number, so "Box Hill Road" stays a street.
  /\bBox\s+\d+(\s|$)/i,
]

function matchesPostalPattern(line: string): boolean {
  return POSTAL_PATTERNS.some((pattern) => pattern.test(line.trim()))
}

// Variadic because go2office customers carry four address lines, not xpros's
// two. address_line3 holds an `ebay:xxxx` reference on ~129k rows rather than an
// address -- harmless here, since none of the patterns can match one.
export function isPostalOnlyAddress(
  ...lines: (string | null | undefined)[]
): boolean {
  return lines.some((line) => !!line && matchesPostalPattern(line))
}
