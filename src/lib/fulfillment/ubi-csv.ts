import type { DispatchOrder } from "@/lib/queries/fulfillment"
import type { BuiltCsv } from "@/lib/fulfillment/eparcel-csv"
import {
  cleanCommas,
  fitAddressLines,
  formatPhone,
  toCsv,
  usableAddressLines,
} from "@/lib/fulfillment/csv"
import {
  UnmappableOrderError,
  type ContactFallbacks,
} from "@/lib/fulfillment/types"

// UBI's 80-column bulk-order template (20251214.xlsx, supplied 2026-11-25), in
// the template's own order and spelling. The headers are Chinese because that
// is what UBI's importer matches on; do not translate them.
//
// Only the receiver block, the parcel weight and one item row are filled. The
// sender columns stay blank, as they do in the template's sample rows: the UBI
// account carries the sender address.
export const UBI_HEADERS = [
  "订单编号",
  "跟踪号",
  "收件人姓名",
  "收件人公司",
  "收件人地址第一行",
  "收件人地址第二行",
  "收件人地址第三行",
  "收件人市/郊区",
  "收件人州",
  "收件人邮编",
  "收件人国家",
  "收件人电话",
  "收件人邮箱",
  "货值总额",
  "货值币种",
  "小包内容中文描述",
  "小包内容英文描述",
  "装运指示",
  "包裹总重量",
  "包裹总重量单位",
  "尺寸",
  "长",
  "宽",
  "高",
  "长宽高之和",
  "拣货清单",
  "服务选项",
  "电池包装类型",
  "电池类型",
  "发件网点",
  "储物柜服务",
  "付税方式",
  "收件人税号",
  "退件选项",
  "退件人姓名",
  "发件人姓名",
  "发件人电话",
  "发件人地址第一行",
  "发件人地址第二行",
  "发件人地址第三行",
  "发件人市/郊区",
  "发件人州",
  "发件人邮编",
  "发件人国家",
  "电子商务平台",
  "物品编号",
  "物品SKU",
  "物品内容中文描述",
  "物品内容英文描述",
  "物品报关编号",
  "物品原产地",
  "物品重量",
  "物品单价",
  "物品单价币种",
  "物品数量",
  "物品描述URL",
  "库位",
  "物品图片",
  "取货",
  "是否投保",
  "被保险人",
  "投保额",
  "投保额币种",
  "imei号码",
  "身份证号",
  "身份证签发日期",
  "身份证持有人姓名",
  "供应商ID",
  "免税码",
  "澳洲生意注册号码",
  "Cod 金额",
  "Cod 币种",
  "分拣码",
  "投保金额(AUD)",
  "物品海关编号",
  "单号",
  "发件人税号",
  "发票编号",
  "平台号",
  "主订单编号",
] as const

type UbiHeader = (typeof UBI_HEADERS)[number]

/** Three receiver address columns. UBI publishes no length limit; 60 is conservative. */
const ADDRESS_SLOTS = 3
const ADDRESS_MAX = 60

// Fixed declarations, as on the template's sample rows and confirmed by the
// user (2026-11-25): every parcel is declared as one toy worth 1 AUD, made in
// China. These are domestic parcels, so nothing here goes through customs.
const DECLARED_VALUE = "1"
const CURRENCY = "AUD"
const CONTENTS_ZH = "玩具"
const CONTENTS_EN = "toy"
const ORIGIN = "CN"

export type UbiBuildOptions = {
  fallbacks: ContactFallbacks
  /**
   * The SKU to declare per order id: the first line's custom_label. One item
   * row per order (user decision), so a multi-line order declares only its
   * first SKU. A missing entry leaves the SKU columns blank.
   */
  firstSkus: ReadonlyMap<number, string>
}

/**
 * Kilograms to three decimals, without trailing zeros. Dead weight
 * (total_weight_kg), the same figure the eParcel export declares.
 */
export function ubiWeight(kg: number): string {
  return String(Math.round(kg * 1000) / 1000)
}

export function buildUbiCsv(
  orders: readonly DispatchOrder[],
  { fallbacks, firstSkus }: UbiBuildOptions
): BuiltCsv {
  const truncated: string[] = []
  const rows: string[][] = [[...UBI_HEADERS]]

  for (const order of orders) {
    if (order.shipping_method !== "Ubi") {
      throw new UnmappableOrderError(
        order.invoice_number,
        `${order.shipping_method ?? "no shipping method"} is not a UBI service`
      )
    }
    if (!order.metrics) {
      throw new UnmappableOrderError(
        order.invoice_number,
        "no computed weight or size is on file for this order"
      )
    }
    // A zero weight means a product on the order has none recorded. Declaring
    // 0 kg would either be rejected by UBI or billed at a weight nobody chose.
    const weightKg = order.metrics.total_weight_kg
    if (!(weightKg > 0)) {
      throw new UnmappableOrderError(
        order.invoice_number,
        "the order has no weight — record the product weights first"
      )
    }

    const customer = order.customer
    const address = fitAddressLines(
      customer ? usableAddressLines(customer) : [],
      ADDRESS_SLOTS,
      ADDRESS_MAX
    )
    if (address.overflow) truncated.push(order.invoice_number)

    const weight = ubiWeight(weightKg)
    const sku = cleanCommas(firstSkus.get(order.id))

    const row: Partial<Record<UbiHeader, string>> = {
      订单编号: cleanCommas(order.invoice_number),
      收件人姓名: cleanCommas(customer?.full_name),
      收件人公司: cleanCommas(customer?.company_name),
      收件人地址第一行: address.lines[0],
      收件人地址第二行: address.lines[1],
      收件人地址第三行: address.lines[2],
      "收件人市/郊区": cleanCommas(customer?.city),
      收件人州: cleanCommas(customer?.state),
      收件人邮编: cleanCommas(customer?.postcode),
      // UBI_METHODS is domestic, so AU by construction rather than read from a
      // column that legitimately holds junk (CLAUDE.md rule 21).
      收件人国家: "AU",
      收件人电话: formatPhone(customer?.phone, customer?.country, fallbacks.phone),
      收件人邮箱: cleanCommas(customer?.email) || fallbacks.email,
      货值总额: DECLARED_VALUE,
      货值币种: CURRENCY,
      小包内容中文描述: CONTENTS_ZH,
      小包内容英文描述: CONTENTS_EN,
      包裹总重量: weight,
      包裹总重量单位: "kg",
      物品编号: sku,
      物品SKU: sku,
      物品内容中文描述: CONTENTS_ZH,
      物品内容英文描述: CONTENTS_EN,
      物品原产地: ORIGIN,
      物品重量: weight,
      物品单价: DECLARED_VALUE,
      物品单价币种: CURRENCY,
      物品数量: "1",
    }

    rows.push(UBI_HEADERS.map((header) => row[header] ?? ""))
  }

  return { csv: toCsv(rows), truncated }
}
