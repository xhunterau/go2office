// One-off eBay seller consent: gets a refresh token and stores it in
// public.ebay_accounts. Run again when it nears expiry (18 months) or when the
// scope list below changes. See docs/ebay-integration.md §3.
//
//   Step 1  npx dotenv-cli -e .env.local -- node scripts/ebay/authorize.mjs
//           Prints a link. Open it, sign in as the SELLER account, Agree.
//   Step 2  eBay lands on its "authorization successful" page. Copy the whole
//           address-bar URL (the code in it lives about 5 minutes) and run
//           npx dotenv-cli -e .env.local -- node scripts/ebay/authorize.mjs "<url>"
//
// Never source .env.local (CLAUDE.md rule 16).

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pg = require("pg")

// The only place the scope list is written down. What the seller consents to
// is stored in ebay_accounts.scopes, and src/lib/ebay/client.ts refreshes with
// exactly that, so adding a scope here means running this script again.
const SCOPES = [
  // Read AND write: GET /sell/fulfillment/v1/order for the order import, and
  // POST .../shipping_fulfillment to send tracking numbers back (planned).
  // Asked for up front so the write-back does not need another consent.
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  // GET /commerce/identity/v1/user -- which seller account this token is for.
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
]

const AUTHORIZE_URL = "https://auth.ebay.com/oauth2/authorize"
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
const IDENTITY_URL = "https://apiz.ebay.com/commerce/identity/v1/user/"

function env(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`${name} is not set. Run through: npx dotenv-cli -e .env.local -- node ...`)
    process.exit(1)
  }
  return value
}

const clientId = env("EBAY_CLIENT_ID")
const clientSecret = env("EBAY_CLIENT_SECRET")
const ruName = env("EBAY_RUNAME")

const input = process.argv[2]?.trim()

if (!input) {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", ruName) // the RuName, not a URL
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", SCOPES.join(" "))
  // Always show the sign-in form, so a browser already signed in to a personal
  // eBay account does not silently consent on its behalf.
  url.searchParams.set("prompt", "login")

  console.log("Open this link, sign in as the eBay SELLER account, and click Agree:\n")
  console.log(url.toString())
  console.log("\nThen copy the full address-bar URL from the page eBay lands on and run:")
  console.log('  npx dotenv-cli -e .env.local -- node scripts/ebay/authorize.mjs "<that url>"')
  process.exit(0)
}

// A pasted URL carries the code percent-encoded; URLSearchParams decodes it.
// A bare code may be pasted either way.
let code
if (/^https?:\/\//.test(input)) {
  const params = new URL(input).searchParams
  if (params.get("isAuthSuccessful") === "false") {
    console.error("eBay says the consent was declined. Run step 1 again.")
    process.exit(1)
  }
  code = params.get("code")
  if (!code) {
    console.error("That URL has no code= parameter. Copy the address bar of the page eBay landed on.")
    process.exit(1)
  }
} else {
  code = input.includes("%") ? decodeURIComponent(input) : input
}

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

const tokenResponse = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${basic}`,
  },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ruName }),
})
const tokenBody = await tokenResponse.json().catch(() => ({}))
if (!tokenResponse.ok) {
  // invalid_grant here almost always means the code is older than ~5 minutes
  // or was already used. The body carries no secret.
  console.error(`Token exchange failed: ${tokenResponse.status}`, tokenBody)
  process.exit(1)
}

const { access_token, refresh_token, refresh_token_expires_in } = tokenBody
if (!refresh_token || !refresh_token_expires_in) {
  console.error("eBay returned no refresh token:", Object.keys(tokenBody))
  process.exit(1)
}

const identityResponse = await fetch(IDENTITY_URL, {
  headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
})
const identity = await identityResponse.json().catch(() => ({}))
if (!identityResponse.ok || !identity.userId || !identity.username) {
  console.error(`Identity lookup failed: ${identityResponse.status}`, identity)
  process.exit(1)
}

const expiresAt = new Date(Date.now() + refresh_token_expires_in * 1000)

const client = new pg.Client({ connectionString: env("DATABASE_URL") })
await client.connect()
try {
  await client.query(
    `INSERT INTO public.ebay_accounts
       (ebay_user_id, username, refresh_token, refresh_token_expires_at, scopes, authorized_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (ebay_user_id) DO UPDATE SET
       username = EXCLUDED.username,
       refresh_token = EXCLUDED.refresh_token,
       refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
       scopes = EXCLUDED.scopes,
       authorized_at = now()`,
    [identity.userId, identity.username, refresh_token, expiresAt.toISOString(), SCOPES]
  )
} finally {
  await client.end()
}

console.log(`Authorised eBay account "${identity.username}" (${identity.userId}).`)
console.log(`Refresh token stored; it expires ${expiresAt.toISOString().slice(0, 10)}.`)
