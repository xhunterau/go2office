import type { SupabaseClient } from "@supabase/supabase-js"

import { REFRESH_TOKEN_WARNING_MS } from "@/lib/ebay/client"
import type { Database } from "@/lib/supabase/database.types"

export type EbayAuthorization = {
  username: string | null
  /** Shown beside Import from eBay; null when all is well. */
  warning: string | null
  /** The import cannot work: no seller authorised, or the token has expired. */
  blocked: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether the eBay seller authorisation is usable, and how soon it runs out.
 *
 * Reads ebay_authorization_status(), which hands out the expiry without the
 * token (ebay_accounts has no policies). The fix in every case is the same:
 * run scripts/ebay/authorize.mjs (docs/ebay-integration.md §3).
 *
 * A failed read only warns. Blocking on it would take the button away over a
 * page-load hiccup, and the task checks the token itself anyway.
 */
export async function fetchEbayAuthorization(
  supabase: SupabaseClient<Database>,
  now: number = Date.now()
): Promise<EbayAuthorization> {
  const { data, error } = await supabase.rpc("ebay_authorization_status")
  if (error) {
    return { username: null, warning: `Could not check the eBay authorisation: ${error.message}`, blocked: false }
  }

  const accounts = data ?? []
  if (accounts.length === 0) {
    return { username: null, warning: "No eBay seller is authorised", blocked: true }
  }
  // The task refuses to guess between several accounts (loadEbayAccount).
  if (accounts.length > 1) {
    return {
      username: null,
      warning: `${accounts.length} eBay sellers are authorised; the import needs exactly one`,
      blocked: true,
    }
  }

  const account = accounts[0]
  const left = new Date(account.refresh_token_expires_at).getTime() - now
  if (left <= 0) {
    return { username: account.username, warning: "eBay authorisation has expired", blocked: true }
  }
  if (left <= REFRESH_TOKEN_WARNING_MS) {
    const days = Math.max(1, Math.ceil(left / DAY_MS))
    return {
      username: account.username,
      warning: `eBay authorisation expires in ${days} day${days === 1 ? "" : "s"}`,
      blocked: false,
    }
  }
  return { username: account.username, warning: null, blocked: false }
}
