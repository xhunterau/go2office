import type { Database } from "@/lib/supabase/database.types"

// Single product row plus the joined lookup labels used across the detail page.
export type ProductDetail = Database["public"]["Tables"]["products"]["Row"] & {
  brands: { name: string | null; abbr: string | null } | null
  origins: { name: string | null; abbr: string | null } | null
  suppliers: { company_name: string | null } | null
}

// Columns fetched for the detail page: the full row plus lookup labels.
export const PRODUCT_DETAIL_COLUMNS =
  "*, brands(name, abbr), origins(name, abbr), suppliers(company_name)"
