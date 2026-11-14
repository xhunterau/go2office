// The platform order number: order_transactions.sales_record_number.
//
// Shopify orders carry the order name ("#G2B24769"), eBay orders the sales
// record number ("324563"). It lives on each line, not on the order, because an
// order merged from two Shopify orders (docs/shopify-order-import.md §3) holds
// lines from both. 1,357 migrated lines hold an empty string.

/** The distinct, non-blank numbers on an order's lines, in first-seen order. */
export function platformOrderNumbers(
  lines: { sales_record_number: string | null }[]
): string[] {
  const seen = new Set<string>()
  for (const line of lines) {
    const value = line.sales_record_number?.trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

/**
 * The stored values a search term may stand for. People type a Shopify name
 * with or without its "#" and in any case; the stored form is "#G2B24769".
 * eBay numbers have no "#" and no letters, so the extra candidates simply
 * match nothing there. Exact matches only, against the btree index on the
 * column (migration 20261114110000).
 */
export function orderNumberCandidates(term: string): string[] {
  const bare = term.trim().replace(/^#+/, "").toUpperCase()
  if (!bare) return []
  return [bare, `#${bare}`]
}
