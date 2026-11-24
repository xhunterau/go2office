/**
 * Carries a list page's filters into a detail page and back.
 *
 * The /orders and /products filters live only in the URL. A detail page's
 * "back to list" link used to be a bare `/orders` or `/products`, so every
 * round trip through a detail page dropped the search, the filters and the
 * page number. The list's query string now rides along on the detail URL as
 * one encoded param and the back link rebuilds the list URL from it.
 *
 * Only the query string travels, never a path: the list path is fixed by the
 * caller, so a crafted `?list=` cannot send the back link anywhere else.
 */
export const LIST_RETURN_PARAM = "list"

/** `/orders/123` plus the list's current query, when there is one. */
export function detailHref(detailPath: string, listQuery: string): string {
  if (!listQuery) return detailPath
  const params = new URLSearchParams({ [LIST_RETURN_PARAM]: listQuery })
  return `${detailPath}?${params.toString()}`
}

/**
 * The list URL to return to, from the detail page's own search params. Falls
 * back to the bare list path for a detail page opened directly (a new tab, the
 * dashboard, a link from another order).
 */
export function listHref(
  listPath: string,
  returned: string | string[] | undefined
): string {
  const raw = Array.isArray(returned) ? returned[0] : returned
  if (!raw) return listPath
  // Re-serialised rather than pasted back verbatim, so the result is always a
  // well-formed query on the fixed path.
  const query = new URLSearchParams(raw).toString()
  return query ? `${listPath}?${query}` : listPath
}
