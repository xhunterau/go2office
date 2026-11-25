import { describe, expect, it } from "vitest"

import { buildUbiCsv, UBI_HEADERS, ubiWeight } from "@/lib/fulfillment/ubi-csv"
import { UnmappableOrderError } from "@/lib/fulfillment/types"
import type { DispatchOrder } from "@/lib/queries/fulfillment"

const FALLBACKS = { email: "dispatch@example.com", phone: "+61300000000" }

function order(overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    id: 7,
    invoice_number: "26033178",
    shipping_method: "Ubi",
    customer: {
      full_name: "Jane Doe",
      company_name: null,
      address_line1: "Apt 201 Fl 2 183 High St",
      address_line2: null,
      address_line3: "ebay:1234567890",
      address_line4: null,
      city: "PRESTON",
      state: "VIC",
      postcode: "3072",
      country: "AU",
      email: null,
      phone: "0432447763",
    },
    metrics: {
      total_weight_kg: 0.4567,
      chargeable_weight_kg: 1,
      goods_total: 20,
      total_cost: 5,
      dominant_length_mm: 100,
      dominant_width_mm: 80,
      dominant_height_mm: 50,
    },
    ...overrides,
  }
}

function build(orders: DispatchOrder[], skus: [number, string][] = [[7, "MK02752SF_RG"]]) {
  return buildUbiCsv(orders, { fallbacks: FALLBACKS, firstSkus: new Map(skus) })
}

/** Data rows keyed by header, so the assertions do not depend on column positions. */
function rowsOf(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.split("\r\n").map((line) => line.split(","))
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])))
}

describe("buildUbiCsv", () => {
  it("writes the template's 80 headers in order", () => {
    const { csv } = build([order()])
    const header = csv.split("\r\n")[0].split(",")
    expect(header).toHaveLength(80)
    expect(header[0]).toBe("订单编号")
    expect(header[79]).toBe("主订单编号")
    expect(header).toEqual([...UBI_HEADERS])
  })

  it("fills the receiver, the fixed declaration and one item row", () => {
    const [row] = rowsOf(build([order()]).csv)
    expect(row["订单编号"]).toBe("26033178")
    expect(row["收件人姓名"]).toBe("Jane Doe")
    expect(row["收件人地址第一行"]).toBe("Apt 201 Fl 2 183 High St")
    // The eBay reference code in address_line3 never reaches the label (rule 24).
    expect(row["收件人地址第二行"]).toBe("")
    expect(row["收件人地址第三行"]).toBe("")
    expect(row["收件人市/郊区"]).toBe("PRESTON")
    expect(row["收件人州"]).toBe("VIC")
    expect(row["收件人邮编"]).toBe("3072")
    expect(row["收件人国家"]).toBe("AU")
    expect(row["收件人电话"]).toBe("+61432447763")
    expect(row["收件人邮箱"]).toBe(FALLBACKS.email)
    expect(row["货值总额"]).toBe("1")
    expect(row["货值币种"]).toBe("AUD")
    expect(row["小包内容中文描述"]).toBe("玩具")
    expect(row["小包内容英文描述"]).toBe("toy")
    expect(row["包裹总重量"]).toBe("0.457")
    expect(row["包裹总重量单位"]).toBe("kg")
    expect(row["物品编号"]).toBe("MK02752SF_RG")
    expect(row["物品SKU"]).toBe("MK02752SF_RG")
    expect(row["物品原产地"]).toBe("CN")
    expect(row["物品重量"]).toBe("0.457")
    expect(row["物品单价"]).toBe("1")
    expect(row["物品数量"]).toBe("1")
    // Sender comes from the UBI account.
    expect(row["发件人姓名"]).toBe("")
  })

  it("leaves the SKU blank when the order has no labelled line", () => {
    const [row] = rowsOf(build([order()], []).csv)
    expect(row["物品SKU"]).toBe("")
  })

  it("refuses an order that is not on UBI", () => {
    expect(() => build([order({ shipping_method: "Letter" })])).toThrow(UnmappableOrderError)
  })

  it("refuses an order with no weight rather than declaring 0 kg", () => {
    const base = order()
    expect(() =>
      build([order({ metrics: { ...base.metrics!, total_weight_kg: 0 } })])
    ).toThrow(/no weight/)
    expect(() => build([order({ metrics: null })])).toThrow(UnmappableOrderError)
  })
})

describe("ubiWeight", () => {
  it("rounds to grams and drops trailing zeros", () => {
    expect(ubiWeight(0.5)).toBe("0.5")
    expect(ubiWeight(1.23456)).toBe("1.235")
    expect(ubiWeight(2)).toBe("2")
  })
})
