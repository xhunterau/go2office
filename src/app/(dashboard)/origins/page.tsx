import { createClient } from "@/lib/supabase/server"
import { OriginsTable } from "./_components/origins-table"

export default async function OriginsPage() {
  const supabase = await createClient()
  const { data: origins, error } = await supabase
    .from("origins")
    .select("*")
    .order("id", { ascending: true })

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load origins: {error.message}
      </div>
    )
  }

  return <OriginsTable origins={origins ?? []} />
}
