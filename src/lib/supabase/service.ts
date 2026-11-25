import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

/**
 * A service-role client for Trigger.dev tasks, which run with no user session.
 * It bypasses RLS, so it must never be imported from a "use server" file or
 * anything the browser can reach.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for this task"
    )
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
