// Carriers disagree on how a package's dimensions are expressed. Australia Post
// exports want whole centimetres rounded up (never understate a parcel); the
// Aramex API wants one decimal place. This module only converts -- what to send
// when a dimension is missing is each caller's decision, not a default here.
export type MmToCmMode = "ceil" | "round1"

// Returns null for a missing or non-positive measurement so the caller has to
// decide what that means, rather than quoting a 0cm parcel.
export function mmToCm(
  mm: number | null | undefined,
  mode: MmToCmMode
): number | null {
  if (mm == null || mm <= 0) return null
  const cm = mm / 10
  return mode === "ceil" ? Math.ceil(cm) : Math.round(cm * 10) / 10
}
