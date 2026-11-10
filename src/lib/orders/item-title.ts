// eBay listing titles are keyword stuffing with the one distinguishing fact
// bolted onto the end in brackets:
//
//   Wall Stickers Removable Art Vinyl Quote Decal Mural Home Room DIY Decor
//   Windows[Our Kitchen Rules]
//
// 62% of order_transactions rows end in `[...]` (2% sample, 5400 rows), and in
// the Postage queue four separate Beston battery lines share the same first 78
// characters and differ only inside the brackets. So a plain truncate -- CSS
// ellipsis or a head slice -- renders those four lines identically while
// discarding the only part that says which product it is.
//
// Hence: clip the middle, keep both ends.

/** Longest a title with no bracketed variant is allowed to render. */
const PLAIN_MAX = 70
/** Longest the part before the brackets is allowed to render. */
const BODY_MAX = 45
/** Longest the bracketed variant itself is allowed to render. */
const VARIANT_MAX = 30

/**
 * Cuts at a word boundary when one is close enough to the limit, and mid-word
 * otherwise -- a title can be a single unbroken token, and backing off to the
 * previous space would then return almost nothing.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text

  const head = text.slice(0, max)
  const lastSpace = head.lastIndexOf(" ")
  const cut = lastSpace >= max * 0.6 ? lastSpace : max

  return `${text.slice(0, cut).trimEnd()}…`
}

/**
 * A listing title short enough for a table cell, with the variant preserved.
 *
 * Callers show the full string on hover (title attribute) -- this is a display
 * shortening, never a change to the stored value.
 */
export function shortenItemTitle(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? ""
  if (trimmed === "") return ""

  // Greedy on purpose: `A[B][C]` keeps `A[B]` as the body and treats the final
  // group as the variant, which is the one that varies between lines.
  const match = /^(.*)\[([^[\]]*)\]$/.exec(trimmed)
  if (!match) return clip(trimmed, PLAIN_MAX)

  const body = match[1].trim()
  const variant = match[2].trim()

  // `Title[]` carries no variant, so it gets the full plain budget rather than
  // being clipped to BODY_MAX and handed an empty pair of brackets.
  if (variant === "") return clip(body, PLAIN_MAX)

  return `${clip(body, BODY_MAX)}[${clip(variant, VARIANT_MAX)}]`
}
