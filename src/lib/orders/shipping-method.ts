import type { Database } from "@/lib/supabase/database.types"

export type ShippingMethod = Database["public"]["Enums"]["shipping_method"]

// The enum values are PascalCase_Snake because that is the spelling the business
// supplied; the inconsistency with the project's lowercase enums is known and
// accepted (docs/orders-domain-migration.md section 4.1), so the fix is a
// display map rather than a migration.
//
// Keys are typed against the enum, so adding a value to shipping_method without
// a label here is a compile error rather than a raw `Mypost_Reg_S_Box` leaking
// onto the screen.
export const SHIPPING_METHOD_LABELS: Record<ShippingMethod, string> = {
  Letter: "Letter",
  Register_Letter: "Registered Letter",
  Parcel_Post: "Parcel Post",
  Express_Post: "Express Post",
  Eparcel_Regular: "eParcel Regular",
  Eparcel_Express: "eParcel Express",
  Mypost_Regular: "MyPost Regular",
  Mypost_Express: "MyPost Express",
  Mypost_Reg_S_Box: "MyPost Regular S Box",
  Mypost_Reg_M_Box: "MyPost Regular M Box",
  Mypost_Reg_L_Box: "MyPost Regular L Box",
  Mypost_Reg_XL_Box: "MyPost Regular XL Box",
  Mypost_Exp_S_Box: "MyPost Express S Box",
  Mypost_Exp_M_Box: "MyPost Express M Box",
  Mypost_Exp_L_Box: "MyPost Express L Box",
  Mypost_Exp_XL_Box: "MyPost Express XL Box",
  Mypost_Reg_Xs_Satchel: "MyPost Regular XS Satchel",
  Mypost_Reg_S_Satchel: "MyPost Regular S Satchel",
  Mypost_Reg_M_Satchel: "MyPost Regular M Satchel",
  Mypost_Reg_L_Satchel: "MyPost Regular L Satchel",
  Mypost_Reg_XL_Satchel: "MyPost Regular XL Satchel",
  Mypost_Exp_Xs_Satchel: "MyPost Express XS Satchel",
  Mypost_Exp_S_Satchel: "MyPost Express S Satchel",
  Mypost_Exp_M_Satchel: "MyPost Express M Satchel",
  Mypost_Exp_L_Satchel: "MyPost Express L Satchel",
  Mypost_Exp_XL_Satchel: "MyPost Express XL Satchel",
  Store_Delivery: "Store Delivery",
  Direct_Freight: "Direct Freight",
  Click_and_Collect: "Click and Collect",
  Aramex_Parcel: "Aramex Parcel",
  Aramex_Satchel: "Aramex Satchel",
}

// Dropdown options, and the source z.enum validates against. Spelled out as a
// tuple rather than read off Object.keys(SHIPPING_METHOD_LABELS): key order is
// not a language guarantee, and z.enum needs literal types.
//
// The seven retired carriers are absent by design -- they live in
// orders.legacy_shipping_method and must not be selectable.
export const SHIPPING_METHOD_OPTIONS = [
  "Letter",
  "Register_Letter",
  "Parcel_Post",
  "Express_Post",
  "Eparcel_Regular",
  "Eparcel_Express",
  "Mypost_Regular",
  "Mypost_Express",
  "Mypost_Reg_S_Box",
  "Mypost_Reg_M_Box",
  "Mypost_Reg_L_Box",
  "Mypost_Reg_XL_Box",
  "Mypost_Exp_S_Box",
  "Mypost_Exp_M_Box",
  "Mypost_Exp_L_Box",
  "Mypost_Exp_XL_Box",
  "Mypost_Reg_Xs_Satchel",
  "Mypost_Reg_S_Satchel",
  "Mypost_Reg_M_Satchel",
  "Mypost_Reg_L_Satchel",
  "Mypost_Reg_XL_Satchel",
  "Mypost_Exp_Xs_Satchel",
  "Mypost_Exp_S_Satchel",
  "Mypost_Exp_M_Satchel",
  "Mypost_Exp_L_Satchel",
  "Mypost_Exp_XL_Satchel",
  "Store_Delivery",
  "Direct_Freight",
  "Click_and_Collect",
  "Aramex_Parcel",
  "Aramex_Satchel",
] as const satisfies readonly ShippingMethod[]

// How an order's carrier should be displayed. 173797 orders carry an enum
// value, 29143 carry a retired carrier in legacy_shipping_method, and 375 carry
// neither.
export type ShippingMethodDisplay = {
  label: string
  // A retired carrier, shown de-emphasised with a "(retired)" suffix. These
  // seven values are deliberately absent from the dropdown.
  isRetired: boolean
  isEmpty: boolean
}

export function displayShippingMethod(order: {
  shipping_method: ShippingMethod | null
  legacy_shipping_method: string | null
}): ShippingMethodDisplay {
  if (order.shipping_method) {
    return {
      label: SHIPPING_METHOD_LABELS[order.shipping_method],
      isRetired: false,
      isEmpty: false,
    }
  }

  // Note the precedence: once an order is given a current shipping_method the
  // legacy value stops being displayed, but it is never erased (see
  // docs/orders-ui.md section 4.3 decision B). It stays as the only record of
  // which carrier actually took the parcel.
  if (order.legacy_shipping_method) {
    return {
      label: order.legacy_shipping_method,
      isRetired: true,
      isEmpty: false,
    }
  }

  return { label: "—", isRetired: false, isEmpty: true }
}
