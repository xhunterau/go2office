// Standard Server Action response shape (project rule 7).
export type ActionResult<T = undefined> = {
  success: boolean
  data?: T
  error?: string
}

// Postgres foreign-key violation error code. Supabase surfaces it on the
// PostgrestError `.code` field when deleting a row still referenced elsewhere.
const FOREIGN_KEY_VIOLATION = "23503"

export function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === FOREIGN_KEY_VIOLATION
}

// Postgres unique-constraint violation. Supabase surfaces it on the
// PostgrestError `.code` field; the offending constraint name (when present)
// is echoed in `.message`, letting callers tailor the feedback per column.
const UNIQUE_VIOLATION = "23505"

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION
}

// Postgres CHECK-constraint violation, e.g. a non-positive kit quantity or a
// kit listing itself as its own component.
const CHECK_VIOLATION = "23514"

export function isCheckViolation(error: { code?: string } | null): boolean {
  return error?.code === CHECK_VIOLATION
}
