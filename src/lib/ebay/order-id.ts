// Client-safe: the debug settings page validates against it in the browser,
// and src/lib/ebay/orders.ts (server-only) checks it before calling eBay.

/** eBay order numbers: two digits, five, five ("17-15414-28640"). */
export const EBAY_ORDER_ID_PATTERN = /^\d{2}-\d{5}-\d{5}$/
