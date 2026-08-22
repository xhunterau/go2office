import {
  AramexApiError,
  AramexAuthError,
  type AramexTokenResponse,
} from "@/lib/aramex/types"

// Read at call time, not at import time: a module-level `process.env.X!` would
// bake an undefined into the module the first time anything imports it, and the
// failure surfaces later as a 401 rather than as a missing variable.
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new AramexAuthError(`${name} is not set`)
  return value
}

// Renew a little early so a token cannot expire between the check and the
// request landing at Aramex.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

let tokenCache: { accessToken: string; expiresAt: number } | null = null

async function refreshToken(): Promise<string> {
  const response = await fetch(requireEnv("ARAMEX_TOKEN_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requireEnv("ARAMEX_CLIENT_ID"),
      client_secret: requireEnv("ARAMEX_CLIENT_SECRET"),
    }),
  })

  if (!response.ok) {
    throw new AramexAuthError(
      `Token request failed: ${response.status} ${response.statusText}`
    )
  }

  const data = (await response.json()) as AramexTokenResponse
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS,
  }
  return tokenCache.accessToken
}

async function validToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken
  return refreshToken()
}

export async function aramexFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = requireEnv("ARAMEX_API_BASE_URL")

  const send = (accessToken: string) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    })

  let response = await send(await validToken())

  // A cached token can be revoked server-side before it expires. One retry with
  // a fresh token, then the 401 is real.
  if (response.status === 401) {
    tokenCache = null
    response = await send(await refreshToken())
  }

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = await response.text()
    }
    throw new AramexApiError(
      `Aramex API error: ${response.status} ${response.statusText}`,
      response.status,
      body
    )
  }

  return response.json() as Promise<T>
}
