import { createClient } from "@/lib/supabase/server"
import { SuppliersTable } from "./_components/suppliers-table"

const PAGE_SIZE = 15

// Columns exposed to the free-text filter.
const SEARCH_COLUMNS = ["company_name", "contact_person", "email", "phone"]

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const { page: pageParam, q } = await searchParams
  const query = q?.trim() ?? ""
  const page = Math.max(1, Number(pageParam) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()
  let request = supabase
    .from("suppliers")
    .select("*", { count: "exact" })
    .order("id", { ascending: true })
    .range(from, to)

  if (query) {
    // Escape commas so they don't split the .or() filter expression.
    const term = query.replace(/[,()]/g, " ")
    request = request.or(
      SEARCH_COLUMNS.map((col) => `${col}.ilike.%${term}%`).join(",")
    )
  }

  const { data: suppliers, count, error } = await request

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load suppliers: {error.message}
      </div>
    )
  }

  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <SuppliersTable
      suppliers={suppliers ?? []}
      page={page}
      pageCount={pageCount}
      total={total}
      query={query}
    />
  )
}
