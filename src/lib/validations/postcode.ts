import { z } from "zod"

// The eight values `postcodes.state` actually holds, plus null. Checked against
// the live table (16712 rows) rather than assumed: nothing else occurs, so this
// can be a closed set instead of a free-text box that would let a typo through
// the CHECK constraint and then silently fail to match anything.
export const AU_STATES = [
  "NSW",
  "VIC",
  "QLD",
  "SA",
  "WA",
  "TAS",
  "NT",
  "ACT",
] as const

export type AuState = (typeof AU_STATES)[number]

// The Select's stand-in for null -- shadcn SelectItem forbids an empty value.
// 136 rows are alias localities (DARLING HARBOUR, KINGS CROSS) that Australia
// Post lists without a state; the address standardiser leaves state alone when
// it lands on one, so this is a real choice rather than "not filled in yet".
export const NO_STATE = "none"

export const postcodeSchema = z.object({
  // Padded, not merely validated. The source data lost its leading zeros on 389
  // rows (DARWIN sat under '800') and 1283 go2office customers store the correct
  // four-digit form, so a row typed as '800' here would be permanently
  // unmatchable -- and the CHECK constraint would reject it outright. Accepting
  // 1-4 digits and padding is friendlier than rejecting, and lands on the same
  // value either way. See CLAUDE.md rule 21.
  postcode: z
    .string()
    .trim()
    .regex(/^[0-9]{1,4}$/, "Postcode must be 1-4 digits")
    .transform((value) => value.padStart(4, "0")),
  // Uppercased rather than validated for the same reason the column has a CHECK
  // rather than a convention: the lookup compares upper(customers.city) against
  // this, so a mixed-case row would simply never match.
  locality: z
    .string()
    .trim()
    .min(1, "Locality is required")
    .max(100, "Locality is too long")
    .transform((value) => value.toUpperCase()),
  state: z.enum([...AU_STATES, NO_STATE]),
})

export type PostcodeInput = z.input<typeof postcodeSchema>
export type PostcodeParsed = z.output<typeof postcodeSchema>

// The form works in NO_STATE, the column works in null.
export function toStateColumn(state: PostcodeParsed["state"]): string | null {
  return state === NO_STATE ? null : state
}
