// The debug switches the code actually reads, keyed as in public.debug_settings.
//
// Rows are added by migration and read here by key, so the two lists must agree:
// a row with no entry here is a switch nothing reads (the page says so rather
// than letting it look active), and an entry with no row is a key that is
// always "off". Add both in the same change.
//
// Client-safe: no server imports. The page renders labels from it and the
// validation schema checks values against it on both sides (rule 6).

export type DebugSettingSpec = {
  label: string
  valueLabel: string
  placeholder: string
  /** The value is required while the switch is on; null means it is valid. */
  validate: (value: string) => string | null
}

export const DEBUG_SETTINGS = {
  // Read by triggerShopifyImport() (src/lib/actions/shopify-import.ts) and
  // passed to the task as testOrder; ordersFilter() in src/lib/shopify/orders.ts
  // decides whether it is a name or an id.
  shopify_import_test_order: {
    label: "Shopify Import — Test Order",
    valueLabel: "Order name or id",
    placeholder: "#G2B24707 or 7930453721225",
    validate: (value) =>
      /^#?[A-Za-z0-9-]+$/.test(value)
        ? null
        : "Use the order name (#G2B24707) or its numeric id (7930453721225)",
  },
} satisfies Record<string, DebugSettingSpec>

export type DebugSettingKey = keyof typeof DEBUG_SETTINGS

export function debugSettingSpec(key: string): DebugSettingSpec | null {
  return Object.hasOwn(DEBUG_SETTINGS, key)
    ? DEBUG_SETTINGS[key as DebugSettingKey]
    : null
}
