"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { loginSchema, type LoginInput } from "@/lib/validations/auth"

type ActionResult = { success: boolean; error?: string }

export async function login(input: LoginInput): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { success: false, error: error.message }
  }

  redirect("/")
}

export async function logout(): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    return { success: false, error: error.message }
  }

  redirect("/login")
}
