import type { ShippingMethod } from "@/lib/orders/shipping-method"

// Which shipping_method values each label channel handles.
//
// xpros keeps these lists inside the export actions, one per carrier, with no
// relationship between them -- so a shipping_method that belongs to no list
// simply never appears on the export page, and nothing says so. The exhaustive
// check at the bottom of this file is what closes that hole here.

/**
 * Labels we print ourselves, as A6 PDFs. No carrier upload is involved: the
 * postage is already paid (prepaid satchels, stamped letters) or the parcel is
 * being handed over in person.
 */
export const SELF_PRINT_METHODS = [
  "Letter",
  "Register_Letter",
  "Parcel_Post",
  "Express_Post",
  "Store_Delivery",
] as const satisfies readonly ShippingMethod[]

/** Uploaded to the MyPost Business Portal as a 23-column CSV. */
export const MYPOST_METHODS = [
  "Mypost_Regular",
  "Mypost_Express",
  "Mypost_Reg_Xs_Box",
  "Mypost_Reg_S_Box",
  "Mypost_Reg_M_Box",
  "Mypost_Reg_L_Box",
  "Mypost_Reg_XL_Box",
  "Mypost_Exp_Xs_Box",
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
] as const satisfies readonly ShippingMethod[]

/**
 * Uploaded to eParcel as a 25-column CSV.
 *
 * Eparcel_Intl_Express is deliberately absent. It needs its own charge code
 * (xpros uses ECM8 on the xhunter contract) plus the OTHER/SALES OF GOODS
 * customs classification, and go2office has neither the code nor a single order
 * on that method -- the whole table is 0 rows. Adding it to this list without
 * the charge code would export international parcels under the domestic code.
 * When the first one appears, `mapChargeCode` throws rather than guessing.
 */
export const EPARCEL_METHODS = [
  "Eparcel_Regular",
  "Eparcel_Express",
] as const satisfies readonly ShippingMethod[]

/** Submitted to the Aramex API one consignment at a time; no CSV. */
export const ARAMEX_METHODS = [
  "Aramex_Parcel",
  "Aramex_Satchel",
] as const satisfies readonly ShippingMethod[]

/**
 * Methods with no label channel, and why:
 *
 *   Eparcel_Intl_Express  no charge code yet (see EPARCEL_METHODS), 0 orders
 *   Direct_Freight        carrier not carried by go2office, 0 orders
 *   Click_and_Collect     collected in store; xpros prints a label and merges
 *                         sibling orders, which is out of scope here
 *
 * Listing them is what makes the check below meaningful: a new shipping_method
 * has to be routed or explicitly excused, and doing neither fails the build.
 */
export const UNROUTED_METHODS = [
  "Eparcel_Intl_Express",
  "Direct_Freight",
  "Click_and_Collect",
] as const satisfies readonly ShippingMethod[]

type RoutedMethod =
  | (typeof SELF_PRINT_METHODS)[number]
  | (typeof MYPOST_METHODS)[number]
  | (typeof EPARCEL_METHODS)[number]
  | (typeof ARAMEX_METHODS)[number]
  | (typeof UNROUTED_METHODS)[number]

// Compile-time exhaustiveness: adding a value to the shipping_method enum
// without deciding which channel produces its label makes `Unrouted` a real
// union, and this line stops compiling with that value named in the error.
type Unrouted = Exclude<ShippingMethod, RoutedMethod>
const _everyMethodIsRouted: Unrouted extends never ? true : Unrouted = true
void _everyMethodIsRouted
