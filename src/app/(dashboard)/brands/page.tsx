import { createClient } from "@/lib/supabase/server"
import { BrandsTable } from "./_components/brands-table"

export default async function BrandsPage() {
  const supabase = await createClient()
  const { data: brands, error } = await supabase
    .from("brands")
    .select("*")
    .order("id", { ascending: true })

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load brands: {error.message}
      </div>
    )
  }

  return <BrandsTable brands={brands ?? []} />
}
