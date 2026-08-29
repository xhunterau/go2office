// Shared field-level helpers for the carrier CSV exports.
//
// Ported from xpros' src/lib/mypost-csv.ts and eparcel-csv.ts, which each carry
// their own near-copy of this logic. The differences between the two copies
// were not deliberate -- they had drifted -- so this module is the single
// version, and the per-carrier builders keep only their column layouts.

/**
 * RFC 4180 quoting. xpros' MyPost builder quotes only on `"` because it strips
 * commas out of every field first; the eParcel builder quotes on `"` or `,`.
 * Quoting on all three (plus newlines) is correct for both and costs nothing:
 * a field that has already had its commas removed simply never triggers it.
 */
export function escapeCsvField(value: string): string {
  if (/["\r\n,]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * Replaces commas with spaces and trims. Australia Post's upload parsers accept
 * quoted commas in most columns but not all of them, and a rejected batch gives
 * no per-row diagnostics, so the carrier formats drop commas from free-text
 * fields rather than relying on quoting.
 */
export function cleanCommas(value: string | null | undefined): string {
  return (value ?? "").replace(/,/g, " ").trim()
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n")
}

/**
 * Timestamped export filename, e.g. `mypost_export_20260823_142530.csv`.
 * Local time, because the operator matches it against when they clicked.
 */
export function exportFilename(prefix: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `${prefix}_${stamp}.csv`
}

// ── addresses ───────────────────────────────────────────────────────────────

/**
 * True for a marketplace reference code parked in an address column rather than
 * an address line.
 *
 * This is the single most important difference from xpros. `customers` here has
 * 114,161 of its 114,193 non-blank `address_line3` values in the form
 * `ebay:1234...` -- 99.97% of them -- because that is where the legacy import
 * put the eBay buyer reference. xpros' builders concatenate line1..line4
 * unconditionally, so porting them verbatim prints the reference code on the
 * parcel as if it were part of the street address.
 *
 * Filtering by content rather than dropping line3 wholesale keeps the 32 rows
 * that really do hold a third address line, and covers the 9 non-blank line4
 * rows on the same rule.
 */
export function isReferenceCode(value: string): boolean {
  return /^ebay\s*:/i.test(value.trim())
}

/**
 * The address lines that belong on a label, in order: cleaned, blanks and
 * reference codes removed. Suburb, state and postcode are separate CSV columns
 * everywhere and are never part of this.
 */
export function usableAddressLines(customer: {
  address_line1: string | null
  address_line2: string | null
  address_line3: string | null
  address_line4: string | null
}): string[] {
  return [
    customer.address_line1,
    customer.address_line2,
    customer.address_line3,
    customer.address_line4,
  ]
    .map(cleanCommas)
    .filter((line) => line !== "" && !isReferenceCode(line))
}

export type FittedAddress = {
  /** Exactly `slotCount` entries, right-padded with empty strings. */
  lines: string[]
  /** True when content had to be dropped because the slots ran out. */
  overflow: boolean
}

/**
 * Packs address lines into a carrier's fixed number of address columns, each
 * with its own length limit, splitting an over-long line at a word boundary and
 * pushing the remainder into the next column.
 *
 * xpros has two incompatible versions of this. Its MyPost one, on overflow,
 * squeezes the original line2 and line3 together into line3; its eParcel one
 * silently drops line4. Neither can work here, because after the reference-code
 * filter above go2office usually has only two real lines to place, and which
 * one gets sacrificed should not depend on which carrier is being exported.
 *
 * 363 customers (0.2%) have an `address_line1` past 40 characters, so this path
 * is rare but not theoretical. `overflow` is returned rather than swallowed so
 * the export can name the affected orders instead of shipping a truncated
 * address quietly.
 */
export function fitAddressLines(
  lines: readonly string[],
  slotCount: number,
  maxLength: number
): FittedAddress {
  const pending = lines.filter((line) => line !== "")
  const slots: string[] = []

  while (slots.length < slotCount && pending.length > 0) {
    const line = pending.shift() as string

    if (line.length <= maxLength) {
      slots.push(line)
      continue
    }

    // Break at the last space that still fits. A line with no space in the
    // first maxLength characters is cut hard -- a single unbroken token that
    // long is not a word, and leaving it whole would blow the column.
    let cutAt = line.lastIndexOf(" ", maxLength)
    if (cutAt <= 0) cutAt = maxLength

    slots.push(line.slice(0, cutAt).trimEnd())
    pending.unshift(line.slice(cutAt).trimStart())
  }

  while (slots.length < slotCount) slots.push("")

  return { lines: slots, overflow: pending.length > 0 }
}

// ── phone ───────────────────────────────────────────────────────────────────

/**
 * Australia Post wants E.164. An Australian number is the last nine digits
 * behind +61; anything shorter than nine digits is not a phone number and falls
 * back to the value configured in shipping_settings.
 *
 * The country test is what xpros lacks: it applies +61 to every number it is
 * given, so an overseas customer gets a plausible-looking Australian number
 * built from their own. Every method go2office ships on is domestic, but the
 * customer's own address is not guaranteed to be, and a wrong number on a
 * parcel is not something the carrier can report back.
 *
 * `country` has already been normalised to an ISO code by the
 * customers_standardize_address trigger where it could be (CLAUDE.md rule 21);
 * where it could not, the column legitimately holds junk, and treating an
 * unrecognisable value as domestic matches where the business actually ships.
 */
export function formatPhone(
  phone: string | null | undefined,
  country: string | null | undefined,
  fallback: string
): string {
  const digits = (phone ?? "").replace(/\D/g, "")
  const code = (country ?? "").trim().toUpperCase()

  // Only a well-formed ISO code that is not AU proves the address is overseas.
  // Blank, or the junk the column legitimately holds, means treat it as
  // domestic -- which is where the business actually ships.
  if (/^[A-Z]{2}$/.test(code) && code !== "AU") {
    return digits === "" ? normaliseFallbackPhone(fallback) : `+${digits}`
  }

  return auE164(digits) ?? normaliseFallbackPhone(fallback)
}

/** The last nine digits behind +61, or null when that is not a phone number. */
function auE164(digits: string): string | null {
  if (digits.length < 9) return null
  return `+61${digits.slice(-9)}`
}

/**
 * The configured fallback, in the same E.164 shape every other number in the
 * column gets.
 *
 * Without this the fallback lands in the CSV exactly as it was typed, so a
 * settings page entry of `0450952227` produces one row in local format among
 * hundreds of `+61...` ones -- which Australia Post may take or may reject, and
 * either way is not what the rest of the column says.
 *
 * Normalising here rather than in the settings schema keeps phone formatting in
 * one place and leaves the operator's own input on the page untouched. A value
 * that cannot be read as a phone number is passed through unchanged, so it
 * shows up in the export rather than being silently swallowed.
 */
export function normaliseFallbackPhone(fallback: string): string {
  const trimmed = fallback.trim()
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "")
  return auE164(trimmed.replace(/\D/g, "")) ?? trimmed
}
