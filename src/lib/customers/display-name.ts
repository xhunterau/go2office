// A customer is identified by whichever of the three they have: 20347 rows have
// no eBay username, and the deduplication that produced this table keyed on
// username falling back to email (docs/orders-domain-migration.md 4.2).
//
// Lives in lib rather than beside the customers table because the order detail
// page's customer picker needs the same fallback chain, and a second copy of it
// would eventually disagree about which field wins (project rule 5).
export function customerDisplayName(customer: {
  full_name: string | null
  platform_user_id: string | null
  email: string | null
}): string {
  return (
    customer.full_name ?? customer.platform_user_id ?? customer.email ?? "—"
  )
}
