import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { LoginForm } from "@/components/auth/login-form"

export default async function LoginPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-secondary/40 via-background to-accent/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage your store
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
