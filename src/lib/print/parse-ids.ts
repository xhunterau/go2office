/**
 * Parses the `?ids=1,2,3` search param the print routes take into a deduped
 * list of positive integer order ids, keeping first-seen order.
 *
 * Order matters: the ids come from a table the operator has just sorted, and
 * the printed stack should come out in that order so it can be matched against
 * the screen. Anything unparseable is dropped rather than raising -- the route
 * decides what an empty result means.
 */
export function parseOrderIds(raw: string | string[] | null | undefined): number[] {
  if (!raw) return []

  const joined = Array.isArray(raw) ? raw.join(",") : raw
  const seen = new Set<number>()
  const ids: number[] = []

  for (const part of joined.split(",")) {
    const trimmed = part.trim()
    // Number.parseInt would accept "12abc" and "1.9"; an id that arrives in
    // either shape is a bug in the caller, not a number to guess at.
    if (!/^\d+$/.test(trimmed)) continue

    const id = Number(trimmed)
    if (id <= 0 || !Number.isSafeInteger(id) || seen.has(id)) continue

    seen.add(id)
    ids.push(id)
  }

  return ids
}
