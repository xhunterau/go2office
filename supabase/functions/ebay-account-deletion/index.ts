// eBay Marketplace Account Deletion endpoint (Deno, Supabase Edge Function).
//
// Every production keyset must receive these or eBay disables it; the
// exemption is only for apps that store no eBay user data, and we store buyers'
// names and addresses. See docs/ebay-integration.md §2.
//
//   GET  ?challenge_code=X  -> {"challengeResponse": sha256hex(X + token + endpoint)}
//                              eBay sends this when the endpoint is saved.
//   POST <notification>     -> stored in public.ebay_account_deletions, then 204.
//
// Deployed with --no-verify-jwt: eBay sends no Supabase credentials.
//
// Secrets (supabase secrets set):
//   EBAY_VERIFICATION_TOKEN   the token typed into the eBay developer portal
//   EBAY_DELETION_ENDPOINT    the exact URL typed there. It is part of the hash,
//                             and req.url behind the gateway is not that URL.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// The X-EBAY-SIGNATURE header is not verified. A forged POST can only add a row
// to a log nobody acts on automatically; whoever processes the log later must
// check the user against eBay before deleting anything.

type DeletionNotification = {
  metadata?: { topic?: string }
  notification?: {
    notificationId?: string
    eventDate?: string
    publishDate?: string
    data?: { username?: string; userId?: string; eiasToken?: string }
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function handleChallenge(challengeCode: string): Promise<Response> {
  // Order is fixed by eBay: challengeCode + verificationToken + endpoint.
  const challengeResponse = await sha256Hex(
    challengeCode + requireEnv("EBAY_VERIFICATION_TOKEN") + requireEnv("EBAY_DELETION_ENDPOINT")
  )
  return Response.json({ challengeResponse })
}

async function handleNotification(req: Request): Promise<Response> {
  let body: DeletionNotification
  try {
    body = await req.json()
  } catch {
    return new Response("Body is not JSON", { status: 400 })
  }

  const n = body.notification
  if (!n?.notificationId) {
    return new Response("Missing notification.notificationId", { status: 400 })
  }

  const response = await fetch(`${requireEnv("SUPABASE_URL")}/rest/v1/ebay_account_deletions`, {
    method: "POST",
    headers: {
      apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      // eBay redelivers until it sees a 2xx; a repeat is not an error.
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify({
      notification_id: n.notificationId,
      ebay_user_id: n.data?.userId ?? null,
      username: n.data?.username ?? null,
      eias_token: n.data?.eiasToken ?? null,
      event_date: n.eventDate ?? null,
      publish_date: n.publishDate ?? null,
      payload: body,
    }),
  })

  if (!response.ok) {
    // Not a 2xx on purpose: eBay retries, so a database hiccup does not lose
    // the notification.
    console.error("Storing deletion notification failed", response.status, await response.text())
    return new Response("Could not store notification", { status: 500 })
  }

  return new Response(null, { status: 204 })
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      const challengeCode = new URL(req.url).searchParams.get("challenge_code")
      if (!challengeCode) return new Response("Missing challenge_code", { status: 400 })
      return await handleChallenge(challengeCode)
    }
    if (req.method === "POST") return await handleNotification(req)
    return new Response("Method not allowed", { status: 405 })
  } catch (error) {
    console.error(error)
    return new Response("Internal error", { status: 500 })
  }
})
