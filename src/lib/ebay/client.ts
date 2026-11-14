// eBay REST client (Sell / Commerce APIs) for a seller account authorised via
// scripts/ebay/authorize.mjs. See docs/ebay-integration.md.
//
// Unlike Shopify (client credentials, ../shopify/client.ts), reading orders
// needs a USER token: the seller signs in once, we keep the refresh token
// (18 months) in public.ebay_accounts, and every access token (2 hours) is
// minted from it here. The refresh asks for exactly the scopes stored at
// consent -- asking for more is an error, so the scope list lives only in the
// authorize script.
//
// Server-only: needs EBAY_CLIENT_SECRET and a service-role Supabase client
// (ebay_accounts has RLS with no policies).

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Tables } from "@/lib/supabase/database.types"

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
const API_BASE = "https://api.ebay.com"

/** Treat the token as expired this long before it is, so it never dies mid-request. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000

/** Start warning this long before the refresh token runs out. */
export const REFRESH_TOKEN_WARNING_MS = 30 * 24 * 60 * 60 * 1000

const MAX_RETRIES = 4
const RETRY_BASE_MS = 1000

export type EbayAccount = Pick<
  Tables<"ebay_accounts">,
  "ebay_user_id" | "username" | "refresh_token" | "refresh_token_expires_at" | "scopes"
>

/** The seller must sign in again (scripts/ebay/authorize.mjs). */
export class EbayReauthorizationRequired extends Error {}

function getAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.EBAY_CLIENT_ID?.trim()
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set")
  }
  return { clientId, clientSecret }
}

/**
 * The authorised seller account. With one account (today) no id is needed;
 * once there are several, a caller that does not say which one is refused
 * rather than handed an arbitrary row.
 */
export async function loadEbayAccount(
  supabase: SupabaseClient<Database>,
  ebayUserId?: string
): Promise<EbayAccount> {
  let query = supabase
    .from("ebay_accounts")
    .select("ebay_user_id, username, refresh_token, refresh_token_expires_at, scopes")
  if (ebayUserId) query = query.eq("ebay_user_id", ebayUserId)

  const { data, error } = await query
  if (error) throw new Error(`Reading ebay_accounts failed: ${error.message}`)
  if (!data || data.length === 0) {
    throw new EbayReauthorizationRequired(
      ebayUserId
        ? `eBay account ${ebayUserId} is not authorised`
        : "No eBay account is authorised. Run scripts/ebay/authorize.mjs"
    )
  }
  if (data.length > 1) {
    throw new Error(
      `${data.length} eBay accounts are authorised; say which one (${data
        .map((a) => a.username)
        .join(", ")})`
    )
  }
  return data[0]
}

/** Per-account token cache; a Trigger.dev worker reuses its process across runs. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function getAccessToken(account: EbayAccount): Promise<string> {
  const cached = tokenCache.get(account.ebay_user_id)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  if (new Date(account.refresh_token_expires_at).getTime() <= Date.now()) {
    throw new EbayReauthorizationRequired(
      `The eBay refresh token for ${account.username} expired on ${account.refresh_token_expires_at.slice(0, 10)}. Run scripts/ebay/authorize.mjs`
    )
  }

  const { clientId, clientSecret } = getAppCredentials()
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      scope: account.scopes.join(" "),
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    // invalid_grant: revoked by the seller, password change, or expired.
    if (response.status === 400 && detail.includes("invalid_grant")) {
      throw new EbayReauthorizationRequired(
        `eBay rejected the refresh token for ${account.username} (${detail}). Run scripts/ebay/authorize.mjs`
      )
    }
    throw new Error(`eBay token refresh failed: ${response.status} ${detail}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number }
  const ttlMs = (data.expires_in ?? 3600) * 1000
  tokenCache.set(account.ebay_user_id, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_EXPIRY_MARGIN_MS),
  })
  return data.access_token
}

/**
 * A GET against api.ebay.com (or an absolute URL, for apiz.ebay.com).
 *
 * Only reads exist so far, and a GET is safe to repeat, so transport failures,
 * 429 and 5xx are retried with backoff. A 401 drops the cached token and tries
 * once more with a fresh one.
 */
export async function ebayGet<T>(
  account: EbayAccount,
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let refreshedAfter401 = false
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await getAccessToken(account)}`,
          Accept: "application/json",
        },
      })
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * 2 ** attempt)
        continue
      }
      throw error
    }

    if (response.status === 401 && !refreshedAfter401) {
      tokenCache.delete(account.ebay_user_id)
      refreshedAfter401 = true
      continue
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_MS * 2 ** attempt)
      continue
    }

    if (!response.ok) {
      // eBay error bodies are { errors: [{ errorId, message, ... }] } with no secrets.
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`eBay GET ${url.pathname} failed: ${response.status} ${detail}`)
    }

    return (await response.json()) as T
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
