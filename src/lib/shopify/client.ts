// Shopify Admin GraphQL client for the go2buy-australia store.
//
// Ported from xpros (src/lib/shopify-client.ts) with three changes:
//   - one store, not two, so no store key;
//   - the token request is form-encoded, as Shopify's client credentials docs
//     specify (xpros posts JSON);
//   - the order query lives in ./orders.ts, so this file is only transport.
//
// Credentials come from a Dev Dashboard app ("go2office order import") via the
// client credentials grant: there is no long-lived token to paste anywhere.
// The token lasts 24 hours and is re-fetched from SHOPIFY_CLIENT_ID and
// SHOPIFY_CLIENT_SECRET whenever it runs out (docs/shopify-order-import.md).

/**
 * Throttle retries. Shopify rate-limits by query cost from a leaky bucket
 * (measured on this store: 2000 points, restoring at 100/s), so a wait always
 * gets through and a handful of retries is plenty.
 */
const MAX_THROTTLE_RETRIES = 5

/** The floor for any wait, so a missing restoreRate cannot become a busy loop. */
const FALLBACK_WAIT_MS = 1000

/** Treat the token as expired this long before it is, so it never dies mid-request. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000

type ShopifyConfig = {
  domain: string
  clientId: string
  clientSecret: string
  apiVersion: string
}

function getConfig(): ShopifyConfig {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim()
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim()
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim()
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || "2026-10"

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set"
    )
  }
  // The token endpoint only answers on the myshopify.com host; the shop's
  // public domain (go2buy.com.au) fails in a way that reads like bad
  // credentials.
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
    throw new Error(
      `SHOPIFY_STORE_DOMAIN must be the xxxx.myshopify.com host, got "${domain}"`
    )
  }

  return { domain, clientId, clientSecret, apiVersion }
}

/**
 * Module-scope token cache. A Trigger.dev worker reuses its process across
 * runs, so a run usually finds a live token; a cold process just fetches one.
 */
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(config: ShopifyConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token

  const response = await fetch(`https://${config.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  if (!response.ok) {
    // The body names the reason (shop_not_permitted, application_cannot_be_found)
    // and carries no secret, so it is worth passing on.
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`Shopify token exchange failed: ${response.status} ${detail}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number }

  // Shopify documents expires_in as always 86399. Defaulting a missing one to an
  // hour means fetching more often, never using a dead token.
  const ttlMs = (data.expires_in ?? 3600) * 1000
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_EXPIRY_MARGIN_MS),
  }
  return data.access_token
}

type GraphQLError = { message: string; extensions?: { code?: string } }

type GraphQLResponse<T> = {
  data?: T
  errors?: GraphQLError[]
  extensions?: {
    cost?: {
      requestedQueryCost: number
      throttleStatus: {
        maximumAvailable: number
        currentlyAvailable: number
        restoreRate: number
      }
    }
  }
}

/**
 * The one way in to the Admin GraphQL API.
 *
 * Why the retry rules are what they are:
 *   - throttling comes back as HTTP 200 with errors[].extensions.code ===
 *     'THROTTLED', so a status-code check would read it as success;
 *   - the wait is computed from the cost bucket, since there is no Retry-After;
 *   - every GraphQL call is a POST, so idempotency cannot be read off the HTTP
 *     method. The caller says which it is by choosing shopifyQuery or
 *     shopifyMutation.
 */
async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  { retryOnTransport }: { retryOnTransport: boolean }
): Promise<T> {
  const config = getConfig()
  const endpoint = `https://${config.domain}/admin/api/${config.apiVersion}/graphql.json`

  for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt++) {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": await getAccessToken(config),
        },
        body: JSON.stringify({ query, variables }),
      })
    } catch (error) {
      // The request may have reached Shopify and taken effect. Only a read is
      // safe to repeat.
      if (retryOnTransport && attempt < MAX_THROTTLE_RETRIES) {
        await sleep(FALLBACK_WAIT_MS * (attempt + 1))
        continue
      }
      throw error
    }

    if (response.status === 401) {
      // A token revoked early (app reinstalled, secret rotated). Drop it so the
      // next attempt fetches a fresh one, once.
      cachedToken = null
      if (attempt === 0) continue
    }

    if (response.status === 429 || response.status >= 500) {
      if (retryOnTransport && attempt < MAX_THROTTLE_RETRIES) {
        await sleep(FALLBACK_WAIT_MS * (attempt + 1))
        continue
      }
    }

    if (!response.ok) {
      throw new Error(`Shopify GraphQL request failed: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as GraphQLResponse<T>

    if (result.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
      // A throttled request was never accepted, so retrying is safe for reads
      // and writes alike.
      if (attempt >= MAX_THROTTLE_RETRIES) {
        throw new Error(`Shopify GraphQL throttled after ${MAX_THROTTLE_RETRIES} retries`)
      }
      await sleep(throttleWaitMs(result))
      continue
    }

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`)
    }
    if (!result.data) throw new Error("Shopify GraphQL response missing data")

    return result.data
  }

  throw new Error("Shopify GraphQL: retries exhausted")
}

/** How long until the bucket holds enough points for this query. */
function throttleWaitMs(result: GraphQLResponse<unknown>): number {
  const cost = result.extensions?.cost
  if (!cost) return FALLBACK_WAIT_MS

  const { currentlyAvailable, restoreRate } = cost.throttleStatus
  const shortfall = cost.requestedQueryCost - currentlyAvailable
  if (shortfall <= 0 || restoreRate <= 0) return FALLBACK_WAIT_MS

  return Math.max(FALLBACK_WAIT_MS, Math.ceil((shortfall / restoreRate) * 1000))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A read. Transport failures are retried. */
export function shopifyQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  return shopifyGraphQL<T>(query, variables, { retryOnTransport: true })
}

/**
 * A write. Transport failures are NOT retried: the request may already have
 * taken effect, and repeating it duplicates the product or the stock movement.
 * Throttling is still retried, because a throttled request was never accepted.
 *
 * Two exports rather than a flag, so a caller cannot forget to decide.
 */
export function shopifyMutation<T>(
  mutation: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  return shopifyGraphQL<T>(mutation, variables, { retryOnTransport: false })
}
