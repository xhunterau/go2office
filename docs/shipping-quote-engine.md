# 运费报价引擎（Re-Quote Shipping）实施计划

从 xpros 移植订单详情页的 **Re-Quote Shipping** 能力：对一张订单向所有可用承运商询价，落库成一个报价批次，自动选中最优方案并回写 `orders.shipping_method`。

| | |
|---|---|
| 源实现 | `xpros` 的 `src/lib/shipping/*` + `src/trigger/quote-shipping.ts` + `src/app/sales-orders/[id]/shipping-quotes-panel.tsx` |
| 落地对象 | 9 张新表 + `src/lib/shipping/*` + 首个 Trigger.dev task + 订单详情页新面板 |
| 迁移文件 | `20260810100000` ~ `20260810150000`（6 个，**已全部推送远端**） |
| 参考数据搬运 | 从 xpros 生产库导出，33,424 行邮编分区 + 194 行费率与选项 |
| 状态 | **阶段 0–3 完成，数据层与报价引擎已就绪；阶段 4 起未开始** —— 见 §0.2 |

---

## 0. 已确认的业务决策（2026-08-15）

这五条是用户明确给出的，本文档其余部分都建立在它们之上：

1. **不移植多仓 eParcel**。`Eparcel_NSW` / `Eparcel_QLD` / `Eparcel_WA` / `Express_NSW` / `Express_QLD` / `Express_WA` 在 go2office 的 `shipping_method` 枚举中不存在，也不需要报价。→ **不建 `warehouses` 表，不要 `origin_warehouse_id` 列。**
2. **不报 Direct Freight 的价**。→ 不建该承运商，`direct_freight_surcharge` 常量列不建。
3. **接入 Trigger.dev**（项目当前完全没有）。
4. **Aramex 凭证列进 `.env.local`**，由用户填写。
5. **eParcel / MyPost 的协议价与 xhunter 相同，可以照搬**；Aramex 走 API，key 不同，由用户提供。**要用 Aramex。**
6. **`Register_Letter` 参与报价，完全仿照 xpros 的做法**（固定价、不查费率卡、不查分区）；**`Letter` 不参与报价**。

---

## 0.1 环境准备（2026-08-15 完成并验证）

`.env.local` 已补齐 7 个新变量并逐项实测通过。**该文件不入库**（`.gitignore` 的 `.env*`），下面只记录验证方法与结论，不记录任何密钥值。

| 变量 | 验证方式 | 结论 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | JWT 解码核对 `ref` / `role`；再用 anon 与 service_role 两把 key 各查一次 `public.products` | ✅ anon 读到 0 行（被 RLS 拦住）、service_role 读到 3,123 行，确认 RLS 绕过生效 |
| `TRIGGER_PROJECT_REF` | 对 Trigger.dev 账号的项目列表核对 | ✅ `proj_wwabgtzjdqddykvvvpxx`。⚠️ **初次填成了 slug（`go2office-7Yzy`）**——slug 是 dashboard URL 里那一段，`trigger.config.ts` 要的是 `proj_` 开头的 ref，两者不通用 |
| `TRIGGER_SECRET_KEY` | `GET https://api.trigger.dev/api/v1/runs` | ✅ HTTP 200。⚠️ **必须是 `tr_dev_` 而非 `tr_prod_`**：prod key 会把本地触发的任务投进生产队列，而 `trigger.dev dev` 起的是 dev worker，两边对不上，表现为面板轮询 30 次超时且日志里没有任何错误 |
| `ARAMEX_*` 四项 | OAuth2 client_credentials 换 token | ✅ HTTP 200，`expires_in = 3600`，scope 为 `ac-api-au` + `fw-fl2-api-au`。两个 URL 是全账号通用的公开端点，已直接写死在文件里；只有 client id / secret 是账号专属 |

Trigger.dev 侧的 **Go2office 项目已创建**（2026-08-15，Xhunter AU 组织下，与 Xpros 同账号），但尚未 `init`、尚未部署任何 task。

## 0.2 进度

| 阶段 | 状态 |
|---|---|
| 0 · 范围与决策（§0 六条）、环境变量（§0.1） | ✅ 完成 2026-08-15 |
| 1 · 6 个迁移 + 抽数脚本 + `database.types.ts` | ✅ 完成 2026-08-16，已推送远端（见 §3.4） |
| 2 · 引擎纯函数 + 适配器 + 单测 | ✅ 完成 2026-08-22（见 §0.3） |
| 3 · Aramex 客户端 | ✅ 完成 2026-08-22，随阶段 2 一并交付（见 §0.3） |
| 4 · Trigger.dev 接入 + task | ⬜ 未开始 ← **下次从这里继续** |
| 5 · Server Actions + 面板 UI | ⬜ 未开始 |
| 6 · 验收（§10） | ⬜ 未开始 |

### 阶段 1 交付清单（2026-08-16）

| 产物 | 位置 |
|---|---|
| 6 个迁移 | `supabase/migrations/20260810100000` ~ `20260810150000` |
| 抽数脚本 | [scripts/reference/export-carrier-zones.mjs](../scripts/reference/export-carrier-zones.mjs) |
| 类型定义 | `src/lib/supabase/database.types.ts` 手工补 9 张表，`npx tsc --noEmit` 通过 |

远端实测：承运商 4 / 服务档 22 / 费率 138 / 报价选项 25 / 袋箱规格 9 / 常量 1 / 分区 33,424（两家各 16,712，与 `postcodes` 全等）。`aramex` 与 `reg_letter` 在三张费率相关表中均 0 行。客户侧 171,968 人两家承运商均可解析分区。

`Register_Letter` 的 `fixed_price_aud` 已确认为 **$5.00**（沿用 xhunter），写进 `20260810120000`（§9.1）。

## 0.3 阶段 2–3 交付清单（2026-08-22）

阶段 3 的 Aramex 客户端与阶段 2 一并交付：报价引擎的 `api` 分支直接调它，拆成两次做会让引擎在中间状态下无法完整运行。

| 产物 | 位置 | 说明 |
|---|---|---|
| 类型 | [src/lib/shipping/types.ts](../src/lib/shipping/types.ts) | 无 `originWarehouseId`（决策 1）。`shippingMethod` 用 `shipping_method` 枚举而非 `string`；`serviceType` 用小写字面量联合 |
| 邮政地址识别 | [src/lib/shipping/postal-address.ts](../src/lib/shipping/postal-address.ts) | 变参，吃四行地址 |
| 承运商能力 + 路由 | [src/lib/shipping/carrier-capabilities.ts](../src/lib/shipping/carrier-capabilities.ts) | `CARRIER_CAPABILITIES` / `canQuote` / `shouldEscalatePostalToManual` / `quoteStrategyFor` / `sortedEdges` |
| 选优（纯函数） | [src/lib/shipping/quote-selection.ts](../src/lib/shipping/quote-selection.ts) | `filterFlatRateGroups` / `selectBestQuote` |
| 单位换算 | [src/lib/shipping/dimensions.ts](../src/lib/shipping/dimensions.ts) | 只留 `mmToCm`；xpros 的 `mmToCmString` 无调用方，未移植 |
| 分区解析 | [src/lib/shipping/adapters/zone-resolver.ts](../src/lib/shipping/adapters/zone-resolver.ts) | §4.2 的三处改写全部落地 |
| 费率卡适配器 | [src/lib/shipping/adapters/rate-card.adapter.ts](../src/lib/shipping/adapters/rate-card.adapter.ts) | |
| 定额适配器 | [src/lib/shipping/adapters/flat-rate.adapter.ts](../src/lib/shipping/adapters/flat-rate.adapter.ts) | 几何判定抽成纯函数 `fitsFlatRatePackage` |
| Aramex 适配器 | [src/lib/shipping/adapters/aramex.adapter.ts](../src/lib/shipping/adapters/aramex.adapter.ts) | `determineSatchelSize` / `buildAramexItem` 可单测 |
| Aramex 客户端 | [src/lib/aramex/client.ts](../src/lib/aramex/client.ts) · [types.ts](../src/lib/aramex/types.ts) | 只保留报价链路 |
| 引擎主流程 | [src/lib/shipping/quote-engine.ts](../src/lib/shipping/quote-engine.ts) | |
| 单测 | `src/lib/shipping/__tests__/`（6 个文件） | `npm test` 104 passed；`npx tsc --noEmit` 与 `npx eslint` 均通过 |

### 与 §4 计划的六处偏离（都是有意的）

1. **`quote-engine.test.ts` 拆成 `quote-selection.test.ts`**。选优与分组是纯函数，已移到独立模块 `quote-selection.ts`，不必为测它们伪造一个 Supabase client。「固定价短路」这条不变量改由 `quoteStrategyFor` 的用例守住——它把「先判 `fixedPriceAud`，再判承运商」的顺序固定下来，而这正是 `reg_letter` 在三张费率表里 0 行仍然正确的原因。另加 `zone-resolver.test.ts`（§4.2 的补零/大写口径）与 `aramex.test.ts`（袋号分档、mm→cm）。
2. **`isPostalOnlyAddress` 的模式加了 `(?![a-z])` 后瞻**。xpros 的 `/PO\s*Box/i` 会把 `PO Boxwood Street` 判成邮政信箱，于是那张订单的 Aramex 被静默剔除——报价少一行，看起来和「包裹太重」毫无区别。后瞻仍放行 `PO Box123`。§4.6 本来就把这条列为必测的假阳性。
3. **引擎不再接 `preloaded` 参数**。xpros 用它做批量报价预热，go2office 的调用方只有单张订单的 task，留着就是死参数。
4. **`selectBestQuote` 不再回查 `eligible` 求 `carrierCode`**，改为 `QuoteResult` 自带 `carrierCode`。同时它接收 `tiebreakThreshold` 而不是读硬编码常量（§4.3 第 8 条）。
5. **`selectBestQuote` 返回 `null` 而非在空列表上崩**。xpros 靠调用方先判空，本版把它做成函数自己的契约。
6. **新增「清掉上一批的 `is_selected`」一步**。`order_shipping_quotes_one_selected_idx` 是 `(order_id) WHERE is_selected` 的唯一索引（§2.7），xpros 没有这个索引也就没有这一步——照抄的话，任何一张订单**第二次**报价都会在写入选中项时撞唯一约束。

### 阶段 4 动手前先读这两条

1. **§6.2** —— 必须 `import { task } from "@trigger.dev/sdk"`，严禁 xpros 全库在用的 `@trigger.dev/sdk/v3`。
2. **§5.1 末尾** —— Trigger.dev 控制台的 Environment Variables 还没配（`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_URL`、四个 `ARAMEX_*`）。部署环境读不到本地 `.env.local`。

`quote-engine.ts` 里有两处留给后续阶段的约定，改动前先看代码注释：**引擎不写 `orders.shipping_method`**（自动选中只是建议，落到订单上是操作员的动作，属阶段 5 的 Server Action）；**Aramex 报价用 `packed_*` 而非 `dominant_*`**（§4.5）。

§9.2 剩余 4 项：第 1、2 项是 seed 里的数值（改一行即可），第 3、4 项属阶段 4–5。

---

## 1. 移植范围裁剪

xpros 的报价引擎支持 6 个承运商，go2office 只保留 3 个。裁剪后的对照表：

| xpros 承运商 | carrier_id | go2office | 说明 |
|---|---:|---|---|
| `eparcel`（Australia Post eParcel **Z6**） | 1 | ❌ | xpros 中已 `is_active = false`，其名下 66,844 行分区数据是死数据 |
| `eparcel_z9`（eParcel Z9） | 4 | ✅ 命名为 **`eparcel`** | go2office 没有 Z6/Z9 之分，代码里不再需要「两个 eparcel」的双分支 |
| `mypost` | 2 | ✅ | |
| `direct_freight` | 3 | ❌ | 决策 2 |
| `reg_letter`（Registered Post 预付标签） | 5 | ✅ | 决策 6，固定价路径，见 §2.5.1 |
| `aramex` | 7 | ✅ | 决策 5，key 由用户提供 |

裁剪后的**报价选项**（`carrier_dispatch_options`）从 32 条降到 **25 条**：

| 承运商 | 选项数 | 明细 |
|---|---:|---|
| `mypost` | 20 | `Mypost_Regular` / `Mypost_Express`，4 种箱（S/M/L/XL）× 2 档，5 种袋（XS/S/M/L/XL）× 2 档 |
| `eparcel` | 2 | `Eparcel_Regular` / `Eparcel_Express` |
| `aramex` | 2 | `Aramex_Parcel` / `Aramex_Satchel`（均带 `max_order_total_aud = 200`） |
| `reg_letter` | 1 | `Register_Letter`（固定价，`max_order_total_aud = 100`） |

`Letter`（134,391 张历史订单，66%）**不配报价选项**——与 xpros 一致。它是无追踪平信，没有可查询的费率结构。

> **注意**：go2office 的 `shipping_method` 枚举里有 `Mypost_Reg_Xs_Box` 和 `Mypost_Exp_Xs_Box`，但 Australia Post **没有 XS 尺寸的纸箱**（`flat_rate_package_specs` 里 box 只有 S/M/L/XL）。这两个枚举值保持不配置报价选项即可，不要为了「凑齐」而造一条查不到规格的选项——那会在报价表里永久显示一行 `No spec for box XS` 的错误。

---

## 2. 数据模型

### 2.1 迁移清单

| 迁移 | 内容 | 体量 |
|---|---|---|
| `20260810100000_create_shipping_domain.sql` | `carriers` / `carrier_services` / `carrier_zone_rates` / `carrier_dispatch_options` / `flat_rate_package_specs` / `shipping_settings` 六张表 + RLS + 授权 | 结构 |
| `20260810110000_create_order_shipping_quotes.sql` | `order_shipping_quotes` 结果表 + 索引 + RLS | 结构 |
| `20260810120000_seed_carrier_reference_data.sql` | 上述六张表的数据：承运商 4 行、服务档 22 行、费率 138 行、报价选项 25 行、袋箱规格 9 行、常量 1 行 | 194 行 |
| `20260810130000_create_postcode_carrier_zones.sql` | `postcode_carrier_zones` 表 + **32,912 行**邮编分区数据（生成文件） | 1.8 MB |
| `20260810140000_create_order_logs.sql` | 极简订单操作日志表（见 §2.7） | 结构 |
| `20260810150000_backfill_missing_carrier_zones.sql` | 补齐 xpros 源表漏掉的分区（eParcel 323 行 + MyPost 189 行，见 §3.4） | 512 行 |

### 2.2 `carriers`

```sql
CREATE TABLE public.carriers (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code text NOT NULL,            -- 'mypost' | 'eparcel' | 'aramex'
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carriers_code_unique UNIQUE (code),
  CONSTRAINT carriers_code_lower CHECK (code = lower(code))
);
```

`code` 是代码侧 `CARRIER_CAPABILITIES` 的键，改它等于改代码，因此加 UNIQUE + 小写 CHECK（对齐 `countries_code_format` 的做法：**该管死的管死**）。

数据：

| id | code | name |
|---:|---|---|
| 1 | `mypost` | Australia Post MyPost Business |
| 2 | `eparcel` | Australia Post eParcel |
| 3 | `aramex` | Aramex |
| 4 | `reg_letter` | Australia Post Registered Post Prepaid Labels |

> 与 xpros 的 id **不一致**（xpros 是 2/4/7/5）。这是有意的：go2office 重新编号，抽数脚本负责映射。

### 2.3 `carrier_services` — 服务档位

按重量分档的价格桶。照搬 xpros 的 22 行（mypost 10、eparcel 12）：

```sql
CREATE TABLE public.carrier_services (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES public.carriers (id) ON DELETE CASCADE,
  service_type text NOT NULL,        -- 'standard' | 'express'
  size_label text NOT NULL,          -- 'up_to_250g' / 'per_kg' / 'small' ...
  -- NULL = 按公斤计价的兜底档（每个 carrier × service_type 至多一行）
  max_weight numeric(10, 3),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_services_unique UNIQUE (carrier_id, service_type, size_label),
  CONSTRAINT carrier_services_type_lower CHECK (service_type = lower(service_type))
);
```

档位结构（两家的重量断点完全一致，只是 `size_label` 命名不同）：

| max_weight | mypost `size_label` | eparcel `size_label` |
|---:|---|---|
| 0.25 | `extra_small` | `up_to_250g` |
| 0.5 | `small` | `up_to_500g` |
| 1 | `medium` | `up_to_1kg` |
| 3 | `large` | `up_to_3kg` |
| 5 | `extra_large` | `up_to_5kg` |
| NULL | — | `per_kg` |

**MyPost 没有 `per_kg` 兜底档**，这不是遗漏：MyPost Business 本身封顶 5kg（`CARRIER_CAPABILITIES.mypost.maxWeightKg = 5`），超过就该由 eParcel 接手。

**`aramex` 与 `reg_letter` 在本表中 0 行**，同样不是遗漏：前者走 API 实时报价，后者走固定价，两条路径都不查费率卡。

### 2.4 `carrier_zone_rates` — 费率卡（138 行）

```sql
CREATE TABLE public.carrier_zone_rates (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  service_id bigint NOT NULL REFERENCES public.carrier_services (id) ON DELETE CASCADE,
  zone text NOT NULL,
  -- 固定档用 rate；per_kg 档用 base_rate + per_kg_rate，再对 min_charge 取大
  rate numeric(10, 2),
  base_rate numeric(10, 2),
  per_kg_rate numeric(10, 2),
  min_charge numeric(10, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_zone_rates_unique UNIQUE (service_id, zone),
  -- xpros 没有这条约束。加上是因为「两种计价方式都没填」的行会静默返回 $0，
  -- 而 $0 会赢下自动选优，把一张订单标成免运费。
  CONSTRAINT carrier_zone_rates_has_pricing CHECK (
    rate IS NOT NULL OR (base_rate IS NOT NULL AND per_kg_rate IS NOT NULL)
  )
);
```

| 承运商 | 分区数 | 档位数 | 费率行数 |
|---|---:|---:|---:|
| `mypost` | 3（`Zone_1/2/3`） | 5 × 2 服务 | 30 |
| `eparcel` | 9 | 6 × 2 服务 | 108 |

eParcel 的 9 个分区：`Local`、`Same State Metro`、`Same State Remote`、`Near State Capital/Metro/Remote`、`Distant State Capital/Metro/Remote`。

### 2.5 `carrier_dispatch_options` — 哪些 shipping_method 参与报价（25 行）

```sql
CREATE TABLE public.carrier_dispatch_options (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  shipping_method public.shipping_method NOT NULL,
  carrier_id bigint NOT NULL REFERENCES public.carriers (id) ON DELETE CASCADE,
  -- 'chargeable'（计费重）或 'actual'（实重）
  billing_weight_mode text NOT NULL DEFAULT 'chargeable',
  service_type text,                    -- 对应 carrier_services.service_type
  fixed_price_aud numeric(10, 2),       -- 非空则跳过一切查表，直接用这个价
  max_order_total_aud numeric(10, 2),   -- 订单金额上限（Aramex 保价限制）
  max_packed_thickness_mm integer,
  max_packed_length_mm integer,
  max_packed_width_mm integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_dispatch_options_method_unique UNIQUE (shipping_method),
  CONSTRAINT carrier_dispatch_options_weight_mode CHECK (
    billing_weight_mode IN ('chargeable', 'actual')
  )
);
```

**`origin_warehouse_id` 整列不建**（决策 1）。这带来两处代码简化：`zone-resolver` 不再需要 `origin_warehouse_id IS NULL` 与 `= ?` 的分支，`postcode_carrier_zones` 的唯一键从三列降到两列。

#### 2.5.1 `Register_Letter` 是唯一一条固定价选项

照搬 xpros 的那一行：

| 字段 | 值 | 含义 |
|---|---|---|
| `shipping_method` | `Register_Letter` | |
| `carrier_id` | 4（`reg_letter`） | |
| `fixed_price_aud` | **`5.00`** | 预付标签单价。✅ 2026-08-16 用户确认沿用 xhunter 的 $5.00（§9.1） |
| `max_order_total_aud` | `100.00` | Registered Post 的保价上限 |
| `max_packed_thickness_mm` | `20` | 信件厚度上限 |
| `max_packed_length_mm` | `297` | A4 长边 |
| `max_packed_width_mm` | `210` | A4 短边 |
| `service_type` | `NULL` | 不查费率卡，无需服务档 |
| `billing_weight_mode` | `chargeable` | 与能力表的 0.5kg 上限配合 |

引擎里它命中的是 `quote-engine.ts` 的**第一条分支**：

```ts
if (opt.fixedPriceAud !== null) {
  return { quotedRate: opt.fixedPriceAud, zone: null, serviceId: null, computationType: 'rate_card' }
}
```

这条分支在任何分区解析之前短路，因此 `reg_letter` 在 `carrier_services` / `carrier_zone_rates` / `postcode_carrier_zones` 三张表里**都是 0 行，这是正确状态**，不要为它补数据。

能力表条目：`reg_letter: { postalDelivery: true, maxWeightKg: 0.5 }`。它同时受四道闸门约束——0.5kg 计费重、$100 订单金额、上面三个尺寸上限、以及邮政承运商共用的 `au_post_max_length_mm`。

### 2.6 `postcode_carrier_zones` — 邮编 → 分区（32,912 行）

```sql
CREATE TABLE public.postcode_carrier_zones (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  postcode_id bigint NOT NULL REFERENCES public.postcodes (id) ON DELETE CASCADE,
  carrier_id bigint NOT NULL REFERENCES public.carriers (id) ON DELETE CASCADE,
  zone text NOT NULL,
  surcharge numeric(10, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postcode_carrier_zones_unique UNIQUE (postcode_id, carrier_id)
);

CREATE INDEX postcode_carrier_zones_carrier_idx
  ON public.postcode_carrier_zones (carrier_id);
```

行数（源自 xpros，已剔除多仓与停用承运商）：

| 承运商 | xpros 来源 | 源行数 | 导入行数 | 分区 |
|---|---|---:|---:|---:|
| `mypost` | `carrier_id = 2, origin_warehouse_id IS NULL` | 16,525 | 16,523 | 3 |
| `eparcel` | `carrier_id = 4, origin_warehouse_id = 2`（主仓） | 16,390 | 16,389 | 9 |
| | **合计** | 32,915 | **32,912** | |

**少的 3 行是对的**，不是丢数据：两个郊区在 xpros 的 `postcodes` 里重复，导入本库时已被合并（16,714 → 16,712，见迁移 `20260809110000`），它们的分区行随之合并。

| 郊区 | 重复形式 | 影响 |
|---|---|---|
| `5211 HAYBOROUGH` | 源表整行重复一次 | 两家承运商各 −1 |
| `0815 CHARLES DARWIN UNIVERSITY` | 同时挂在 `0815` 与 `815` 下 | mypost −1 |

三处合并后 zone 均一致，抽数脚本的冲突断言未触发。

`surcharge` 在 xpros 里全部为 NULL，此处直接建成 `NOT NULL DEFAULT 0`，省掉代码侧的 `?? 0`。

### 2.7 `order_shipping_quotes` + `order_logs`

```sql
CREATE TABLE public.order_shipping_quotes (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  carrier_id bigint NOT NULL REFERENCES public.carriers (id) ON DELETE RESTRICT,
  shipping_method public.shipping_method NOT NULL,
  service_id bigint REFERENCES public.carrier_services (id) ON DELETE SET NULL,
  zone text,
  quoted_rate numeric(10, 2) NOT NULL DEFAULT 0,
  computation_type text NOT NULL,   -- 'rate_card' | 'api'
  is_selected boolean NOT NULL DEFAULT false,
  error_message text,
  -- 同一次报价的所有行共享同一个 quoted_at，前端据此只显示最新批次
  quoted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_shipping_quotes_order_batch_idx
  ON public.order_shipping_quotes (order_id, quoted_at DESC);
-- 每张订单至多一个选中项。xpros 靠代码保证，这里靠索引保证。
CREATE UNIQUE INDEX order_shipping_quotes_one_selected_idx
  ON public.order_shipping_quotes (order_id) WHERE is_selected;
```

**`order_logs` 是必要的，不是可选的**：引擎在「地址只收邮政且超出全部邮政承运商能力」和「无任何可用承运商」两种情况下会**自动改写 `orders.status`**（决策 2：改成 `issued`）。没有日志表，这就是一次静默的状态改写——正是 CLAUDE.md 规则 19 / 21 反复在防的那类问题。表可以极简：

```sql
CREATE TABLE public.order_logs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  action text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_logs_order_id_idx ON public.order_logs (order_id, created_at DESC);
```

### 2.8 `shipping_settings` — 全局常量（1 行）

xpros 叫 `postage_constants`。改名对齐 go2office 已有的 `pricing_settings` 命名，并**剔除 `direct_freight_surcharge`**：

```sql
CREATE TABLE public.shipping_settings (
  id integer PRIMARY KEY DEFAULT 1,
  au_post_max_length_mm numeric(10, 2) NOT NULL DEFAULT 1040,
  au_post_max_weight_kg numeric(10, 3) NOT NULL DEFAULT 22,
  eparcel_oversize_surcharge_aud numeric(10, 2) NOT NULL DEFAULT 9.50,
  eparcel_oversize_threshold_mm integer NOT NULL DEFAULT 1000,
  eparcel_fuel_charge_rate numeric(6, 4) NOT NULL DEFAULT 0.0990,
  -- xpros 把 5% 硬编码成 TIEBREAK_THRESHOLD。提到配置里，理由同
  -- order_metrics_summary 把 xpros 硬编码的 1.1 换成 pricing_settings.gst_rate。
  quote_tiebreak_threshold numeric(5, 4) NOT NULL DEFAULT 0.05,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_settings_singleton CHECK (id = 1)
);
INSERT INTO public.shipping_settings (id) VALUES (1);
```

默认值即 xpros 生产库当前值（2026-07-31 更新）。**`parcel_volumetric_kg_per_cbm` 不搬到这里**——它已经在 `pricing_settings` 上并被 `order_metrics_summary` 使用，挪动会牵动指标表。

---

## 3. 参考数据搬运

### 3.1 抽数脚本

新建 `scripts/reference/export-carrier-zones.mjs`：连 xpros 生产库读取，输出可直接嵌进迁移文件的 SQL。

- 连接串从 xpros 的 `.env.db.local` 读取 `SUPABASE_PROD_DB_URL`（该文件的值已做百分号编码，**不会踩 CLAUDE.md 规则 16 的 `$` 展开坑**）
- 本机没有 `psql`，脚本用 `pg`（go2office 已有该 devDependency）
- 输出到 `supabase/migrations/20260810130000_create_postcode_carrier_zones.sql`

### 3.2 ⚠️ `postcode_id` 必须重新解析，不能照搬

这是整个搬运里唯一会**静默出错**的地方。

xpros 的 `postcode_carrier_zones.postcode_id` 指向的是 **xpros 自己的 `postcodes` 表**，而 go2office 的 [postcodes](../supabase/migrations/20260809110000_create_postcodes.sql) 在导入时做了两件事（见该迁移头部注释与 CLAUDE.md 规则 21）：

1. **补足前导零**：389 行丢了前导零的邮编（DARWIN 存成 `800`）被 `lpad(...,4,'0')` 修回 `0800`；
2. **去重**：16,714 → 16,712。`5211 HAYBOROUGH` 源表重复一次；`0815 CHARLES DARWIN UNIVERSITY` 在源表里同时挂在 `0815` 和 `815` 两个邮编下。

直接搬 `postcode_id` 会指向不存在或错位的行。正确做法是**按 `(lpad(postcode,4,'0'), upper(locality))` 重新解析**：

```sql
-- 脚本内的映射逻辑（在 xpros 侧展开成字面量后再写进迁移）
SELECT lpad(p.postcode, 4, '0') AS postcode,
       upper(btrim(p.locality))  AS locality,
       z.zone,
       COALESCE(z.surcharge, 0)  AS surcharge
FROM postcode_carrier_zones z
JOIN postcodes p ON p.id = z.postcode_id
WHERE (z.carrier_id = 2 AND z.origin_warehouse_id IS NULL)
   OR (z.carrier_id = 4 AND z.origin_warehouse_id = 2);
```

**两个必须处理的后果：**

- **合并冲突**：`815` 与 `0815` 两行合并后会撞上 `postcode_carrier_zones_unique`。脚本必须在导出前 `GROUP BY (postcode, locality, carrier)` 并**断言 zone 一致**；不一致就报错停下，不要 `ON CONFLICT DO NOTHING` 蒙混过去。
- **解析不到的行**：xpros 有而 go2office 没有的 `(postcode, locality)` 组合必须**打印出来**，不能静默丢弃——丢一行的后果是该郊区的客户从此永远报不出价（`No zone for postcode ...`）。

### 3.3 覆盖率校验（导入后必跑）

```sql
-- 1) 每家承运商覆盖了多少个邮编行
SELECT c.code, count(*) AS covered,
       (SELECT count(*) FROM public.postcodes) AS total_postcodes
FROM public.postcode_carrier_zones z JOIN public.carriers c ON c.id = z.carrier_id
GROUP BY c.code;
-- 预期：mypost 16525 / eparcel 16390，均略少于 16712（部分郊区两家都不投递）

-- 2) 真实客户里有多少解析不到分区 —— 这才是业务口径
SELECT c.code, count(*) FILTER (WHERE z.id IS NULL) AS unresolved_customers
FROM public.customers cu
CROSS JOIN public.carriers c
LEFT JOIN public.postcodes p
  ON p.postcode = lpad(btrim(cu.postcode), 4, '0')
 AND p.locality = upper(btrim(cu.city))
LEFT JOIN public.postcode_carrier_zones z
  ON z.postcode_id = p.id AND z.carrier_id = c.id
WHERE cu.postcode IS NOT NULL
GROUP BY c.code;
```

客户侧数据质量已核（2026-08-15）：178,024 个客户中仅 3 个邮编为空，178,001 个是 1–4 位数字形式，因此解析基础是好的。

> 查询二会把 `aramex` 与 `reg_letter` 报成 100% 解析不到 —— 它是 `CROSS JOIN carriers`，而这两家按设计就没有分区行（§2.5.1）。看 `mypost` / `eparcel` 两行即可。

### 3.4 阶段 1 实测结果（2026-08-16）

六个迁移已推送远端。行数全部符合：承运商 4 / 服务档 22 / 费率 138 / 报价选项 25 / 袋箱规格 9 / 常量 1 / 分区 32,912 → 补齐后 **33,424**（两家各 16,712，与 `postcodes` 全等）。`aramex` 与 `reg_letter` 在 `carrier_services`、`carrier_zone_rates`、`postcode_carrier_zones` 三张表中均为 0 行。

抽数脚本报告 **0 行**无法在 `public.postcodes` 中解析，故迁移末尾的行数断言一次通过。

**客户覆盖率**（178,024 个客户），补齐前 → 补齐后：

| 类别 | 补齐前 | 补齐后 |
|---|---:|---:|
| 两家都能解析 | 166,161 | **171,968** |
| 仅 mypost | 5,699 | 0 |
| 仅 eparcel | 107 | 0 |
| 两家都不行 | 1 | 0 |
| 地址在 `postcodes` 中查无此郊区 | 6,056 | 6,056 |

最后一行**不是本次能修的** —— 是客户自己填的 `(postcode, city)` 在澳邮邮编表里不存在（拼写、旧地名、写了州名等），与分区数据无关。这些客户任何承运商都报不出价，属客户数据质量议题。

#### 源表的两处缺口，已由迁移 `20260810150000` 补齐

导入后两家承运商都缺一批郊区。**都不是澳邮不投递，而是 xpros 的源表不全**。补齐后 eParcel 与 mypost 各 **16,712 行**，与 `postcodes` 全等；客户侧 171,968 人全部两家可解析，「仅某一家」归零。

> **寄件地是 Melbourne**，数据里没写但可反推：3000 = `Local`、3350 = `Same State Metro`、3844 = `Same State Remote`、2250/2500 = `Near State Metro`、4000/5000 = `Near State Capital`、6000 = `Distant State Capital` —— 就是澳邮 9 分区矩阵的 Melbourne 列，逐格吻合。

**eParcel 缺 323 行。** 其中 321 行是 **64 个邮编整段缺失**，全部落在澳邮 `NSW Metro` 区内（该区的官方描述就是「Outer Sydney, Gosford, Wollongong, Newcastle, **Canberra**, Albury, Tweed Heads」）：

| 缺失段 | 对应 AP NSW Metro 范围 | 地区 |
|---|---|---|
| `0200` | `200-299` | ANU / ACT 信箱 |
| `2282`–`2310` | `2282-2310` | Newcastle |
| `2485`–`2486` | `2485-2486` | Tweed Heads |
| `2600`–`2620` | `2600-2620` | Canberra |
| `2640`–`2641` | `2640-2641` | Albury |
| `2708` | `2708-2709` | — |
| `2900`–`2914` | `2900-2920` | Tuggeranong / Gungahlin |

> ⚠️ **澳邮没有 ACT 分区，堪培拉归在 NSW Metro 下。** 去找一张单独的 ACT 费率表必然找不到，而由此得出「eParcel 不服务 ACT」是错的 —— 正确的读法是它按 NSW Metro 服务。本文档此前的版本就栽在这一步上。

NSW Metro 自 Melbourne 发出 = **`Near State Metro`**，三条独立证据一致：① 澳邮 9 分区矩阵；② 已导入的 33 个 NSW Metro 邮编（Gosford 2250–2263、Wollongong 2500–2507/2515–2532、Berowra 2080–2084）共 254 个郊区**全部**是该值、零例外；③ xpros 停用的 Z6 账号（carrier 1）**有**这 64 个邮编，标 `Inter State Metro`（6 分区体系的 Metro 类，绝非 remote）—— 只有 Z9 那张表丢了它们。

另 2 行是零散新设郊区，按同邮编兄弟郊区取值（一个邮编只对应一个分区，无可选）：`2763 NIRIMBA FIELDS` → `Near State Capital`，`4702 ARCTURUS` → `Near State Remote`。

**MyPost 缺 189 行**，成因不同。MyPost 是三分区的另一套产品，上面的推理**一条都不适用**；而且它的分区**不按州划分**（每个州都混有 Zone_2 与 Zone_3），所以「NSW 就是 Zone_2」这种捷径也没有。

- **136 行**由同邮编兄弟郊区直接读出（表中无任何邮编对应两个 MyPost 分区，不存在选择问题）
- **53 行**整段邮编缺失，几乎全是 PO Box / 邮件中心邮编（Sydney `1xxx` 占 46 个）—— 这正暴露了 MyPost 那张表是**只按街道投递邮编**建的，同样的 `1xxx` 段 eParcel 一个不缺。除 `MELBOURNE 8107` → `Zone_1` 外全部 → `Zone_2`，依据按序为：45 行由**同名郊区**在街道邮编下的唯一取值确定；8 行（名字有歧义或查无同名）由**相邻邮编**确定，且相邻邮编无一例外都是 Zone_2

抽数脚本重跑会再次产出缺这些行的文件 —— 补齐迁移排在它之后，两者配合才是全量。脚本头部已注明。

---

## 4. 报价引擎移植

### 4.1 文件清单

> 实际落地清单与偏离说明见 **§0.3**。下表是计划时的对照，`✅` 为已交付。

| 新文件 | 源文件 | 说明 |
|---|---|---|
| ✅ `src/lib/shipping/types.ts` | `adapters/types.ts` | |
| ✅ `src/lib/shipping/carrier-capabilities.ts` | 同名 | 承运商能力表 + `canQuote` + 人工升级判定 + 适配器路由 |
| ✅ `src/lib/shipping/postal-address.ts` | 同名 | PO Box / Locked Bag 等模式识别 |
| ✅ `src/lib/shipping/quote-selection.ts` | `quote-engine.ts` 内的私有函数 | 计划外新增：把分组与选优抽成纯函数，便于单测 |
| ✅ `src/lib/shipping/dimensions.ts` | 同名 | mm → cm |
| ✅ `src/lib/shipping/quote-engine.ts` | 同名 | 主流程 |
| ✅ `src/lib/shipping/adapters/zone-resolver.ts` | 同名 | **有改写，见 4.2** |
| ✅ `src/lib/shipping/adapters/rate-card.adapter.ts` | 同名 | |
| ✅ `src/lib/shipping/adapters/flat-rate.adapter.ts` | 同名 | MyPost 定额袋/箱 |
| ✅ `src/lib/shipping/adapters/aramex.adapter.ts` | 同名 | |
| ✅ `src/lib/aramex/client.ts` / `types.ts` | `lib/aramex-client.ts` / `aramex-types.ts` | 只保留报价所需部分 |
| `src/lib/queries/shipping-quotes.ts` | — | 阶段 5。按 go2office 的查询层惯例 |
| `src/lib/actions/shipping-quote.ts` | `shipping-actions.ts` | 阶段 5。按 go2office 的 `src/lib/actions/` 惯例 |
| `src/trigger/quote-shipping.ts` | 同名 | 阶段 4 |

### 4.2 ⚠️ `zone-resolver` 的三处改写（不改就是错的）

xpros 原版：

```ts
function normalizePostcode(postcode: string): string {
  return postcode.trim().replace(/^0+/, '') || '0'   // ← 去掉前导零
}
...
postcodeQuery = postcodeQuery.ilike('locality', destLocality)   // ← ILIKE
```

go2office 必须改成：

1. **补零而不是去零**：`lpad(trim(postcode), 4, '0')`。go2office 的 `postcodes.postcode` 有 `CHECK (postcode ~ '^[0-9]{4}$')`，去掉前导零的值一行都匹配不上。
2. **等值而不是 `ILIKE`**：`.eq('locality', city.trim().toUpperCase())`。CLAUDE.md 规则 21 已记录 `ILIKE` 的问题——右侧是**模式**不是字面量，city 里含 `%` 或 `_` 会变通配符，把别的郊区的分区安到客户头上；且只有等值能走 `postcodes_postcode_locality_unique` 的索引。
3. **`locality` 要 `upper()`**：go2office 的 `postcodes.locality` 有 `CHECK (locality = upper(locality))`，客户的 `city` 是混合大小写。

这三条与 `fn_standardize_customer_address()`（迁移 `20260809130000`）的匹配口径**必须完全一致**——两处用不同口径解析同一对 `(postcode, city)`，会出现「客户的 state 填得出来、运费的 zone 查不到」这种难查的不一致。

### 4.3 其余改写点

| # | xpros | go2office | 理由 |
|---:|---|---|---|
| 1 | `origin_warehouse_id` 参与 zone 查询 | 整列删除 | 决策 1，单仓 |
| 2 | `carrierCode === 'eparcel' \|\| === 'eparcel_z9'`（出现 2 处） | 合并成 `=== 'eparcel'` | Z6 已停用 |
| 3 | `direct_freight` 能力项 + 燃油费率分支 | 删除 | 决策 2 |
| 4 | `applyAmmoOverride`（弹药强制自提） | **整块删除** | 无该业务；`order_metrics_summary` 也没有 `has_ammo`（见 `docs/order-metrics.md` §2.2） |
| 5 | 订单状态改 `'Manual'`，清 `pending_status` | 改 `'issued'`，无 `pending_status` | 决策 2 + go2office 无该列 |
| 6 | `isPostalOnlyAddress(addr1, addr2)` | 传 `address_line1..4` 全部四行 | go2office 的 customers 有 4 行地址 |
| 7 | `CARRIER_PRIORITY = ['eparcel','mypost','direct_freight','aramex']` | `['eparcel','mypost','aramex']` | `reg_letter` **有意不进这张表**（xpros 也没放）。`indexOf` 返回 -1 归一成 99，即平局时排最后——$5 的挂号信只有在**严格比第二名便宜 5% 以上**时才会被自动选中 |
| 8 | `TIEBREAK_THRESHOLD = 0.05` 硬编码 | 读 `shipping_settings.quote_tiebreak_threshold` | §2.8 |
| 9 | metrics 列名 `total_weight` / `packed_l` / … | `total_weight_kg` / `packed_length_mm` / … | 见下表 |
| 10 | 服务等级取自 `postage_service` 枚举 | 取自自由文本，见 4.4 | |
| 11 | `option.serviceType.toLowerCase()`（`rate-card.adapter.ts:42`、`flat-rate.adapter.ts:80`） | **两处 `.toLowerCase()` 都可以去掉** | 见下方「`service_type` 的大小写」 |
| 12 | `calculate-rate.ts` | **整个文件不移植** | 同上：它是死代码，全库无调用方，且带着未修的大小写 bug |

**`service_type` 的大小写（2026-08-16 核实）**：xpros 的 `carrier_dispatch_options.service_type` 存 `'Standard'` / `'Express'`，而 `carrier_services.service_type` 存 `'standard'` / `'express'`，两者用 `=` 直接比较**永远不匹配**。存活的两个适配器各自加了一个 `.toLowerCase()` 抹平；第三个调用方 `calculate-rate.ts` 没加，一旦被调用就会走进 `No service tiers found` —— 它从未被任何地方调用过，这是没人发现的唯一原因。

go2office 两张表**统一存小写**，并各加了一条 `CHECK (... = lower(...))`（迁移 `20260810100000`）。所以移植时这两个 `.toLowerCase()` 是多余的，`calculate-rate.ts` 则连同它的 bug 一起不要。

**metrics 列名映射**（go2office 的 `order_metrics_summary` 已经把引擎要的全部输入准备好了，这是本次移植最省事的一块）：

| 引擎需要 | xpros 列 | go2office 列 |
|---|---|---|
| `pkg.totalWeightKg` | `total_weight` | `total_weight_kg` |
| `pkg.chargeableWeightKg` | `total_chargeable_weight` | `chargeable_weight_kg` |
| `pkg.maxDimensionMm` | `max_dimension` | `max_dimension_mm` |
| `pkg.packedL/W/H` | `packed_l/w/h` | `packed_length_mm` / `packed_width_mm` / `packed_height_mm` |
| `orderTotalAud` | `total_sale` | `goods_total` |
| 服务等级 | `shipping` | ❌ 无此列，见 4.4 |

### 4.4 服务等级（Express / Standard）的来源

引擎用它过滤掉所有非 Express 选项（客户付了加急就不能报普通件的价）。xpros 从 `sales_order_transactions.postage_service`（`Standard`/`Express` 枚举）用 `bool_or` 聚合。

go2office 的 [order_transactions.postage_service](../supabase/migrations/20260803130000_create_order_transactions.sql#L33) 是**平台上报的自由文本**，实测分布（2026-08-15，250,413 行）：

| 值 | 行数 |
|---|---:|
| `Standard Parcel Delivery` | 114,991 |
| `Standard delivery` | 54,989 |
| `eBay Australia Post Flat Rate 500g Satchel` | 48,534 |
| `Standard` | 27,498 |
| …（其余 14 个值） | |
| **匹配 `~* 'express'` 的合计** | **1,048 行 / 980 张订单** |
| 空或空串 | 20 |

**结论：不加列、不改 schema**。引擎在读订单时多带一个子查询即可：

```sql
SELECT bool_or(postage_service ~* 'express') AS is_express
FROM public.order_transactions WHERE order_id = $1
```

`docs/order-metrics.md` §2.2 明确记录了「`shipping` 列不移植」的决定，这个方案与之一致，不去推翻已有结论。980 张订单（0.5%）会被识别为 Express，量级合理。

### 4.5 Aramex 报价用哪组尺寸

xpros 内部存在不一致：`aramex.adapter.ts`（报价）用 `packed_l/w/h`，而 `aramex-mappers.ts`（真实下单）用 `dominant_*`。

**本次移植保持报价侧用 `packed_*`**——装箱估算是刻意悲观的（小件永远不会被算成塞进大件的箱子里），报价宁高勿低。go2office 独有的 `dominant_length/width/height_mm` 三列（xpros 的视图版本没有）留给后续「真实下单」阶段使用，本次不动。这一点写进代码注释，避免下一个人以为是漏用了。

### 4.6 单元测试

新建 `src/lib/shipping/__tests__/`，覆盖纯函数部分（不碰 DB）：

- `postal-address.test.ts`：PO Box / Locked Bag / Parcel Locker / `Box 123` 各模式，以及 `PO Boxwood Street` 这类**不应**命中的假阳性
- `carrier-capabilities.test.ts`：Express 过滤、邮政地址过滤、5kg/22kg 重量上限、`max_packed_*` 三维排序判定
- `flat-rate.test.ts`：袋的 2D 判定 `(L+H) ≤ specL && (W+H) ≤ specW` 与箱的 3D 判定
- `quote-engine.test.ts`：定额组内只保留最小可装尺寸；5% 平局内按承运商→方法优先级；**固定价分支短路**（`Register_Letter` 不触发任何分区/费率查询）；`reg_letter` 在平局中排最后

---

## 5. Aramex 接入

### 5.1 需要写进 `.env.local` 的变量（✅ 已完成，见 §0.1）

```dotenv
# ── Trigger.dev ──────────────────────────────────────────────
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_REF=

# ── Supabase service role（Trigger.dev task 内绕过 RLS 用）─────
SUPABASE_SERVICE_ROLE_KEY=

# ── Aramex ───────────────────────────────────────────────────
ARAMEX_TOKEN_URL=
ARAMEX_API_BASE_URL=
ARAMEX_CLIENT_ID=
ARAMEX_CLIENT_SECRET=
```

> ⚠️ **CLAUDE.md 规则 16**：以上任一值若含 `$`，必须在 `.env.local` 里写成 `\$`。否则 `@next/env` 的 dotenv-expand 会把 `$xxx` 当变量名展开成空，产出一个只是短了几个字符的值，故障表现为「认证失败」，极易误诊为「key 填错了」。
>
> `SUPABASE_SERVICE_ROLE_KEY` 是**新增的**——go2office 目前只有 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `DATABASE_URL` 三个变量。
>
> 同一批变量还要在 **Trigger.dev 控制台的 Environment Variables 里再配一份**（部署环境读不到本地 `.env.local`）：`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_URL`、四个 `ARAMEX_*`。**这一步尚未做**，留到阶段 4。

### 5.2 客户端

`src/lib/aramex/client.ts` 照搬 xpros 的 `aramex-client.ts`：OAuth2 client_credentials 换 token，进程内缓存并留 5 分钟过期缓冲，401 时清缓存重试一次。

`src/lib/aramex/types.ts` 只保留报价链路需要的类型：`AramexAddress`、`AramexContact`、`AramexItem`、`AramexQuoteResponse`（`{ price, tax, total, items[] }`）、`AramexTokenResponse`，以及 `AramexApiError` / `AramexAuthError`。下单相关的 `AramexConsignmentResponse` 等本次不移植。

### 5.3 报价适配器

- `Aramex_Parcel` → `PackageType: 'P'`，带 `WeightDead` 与 L/W/H（**mm ÷ 10 转 cm**，Aramex 要 1 位小数）
- `Aramex_Satchel` → `PackageType: 'S'`，按计费重换算袋号：`<0.3kg → 300gm`、`<0.5 → A5`、`<1 → A4`、`<3 → A3`、`<5 → A2`，**≥5kg 抛错**（该错误会作为一行 `error_message` 落库并显示在面板上，属正常行为）
- 收件人用固定的询价占位联系人（xpros 也是这么做的，报价不需要真实联系人）
- 两个选项都带 `max_order_total_aud = 200`，由 `canQuote` 提前过滤

需要一个 `src/lib/shipping/dimensions.ts`（mm→cm，`ceil` / `round1` 两种模式），照搬 xpros 同名文件。

---

## 6. Trigger.dev 接入

go2office 目前**完全没有** Trigger.dev（无 `@trigger.dev/sdk`、无 `trigger.config.ts`、无 `src/trigger/`），这是首次接入。

### 6.1 步骤

1. `npx trigger.dev@latest init`（会引导创建/关联项目，拿到 project ref）
2. `npm i @trigger.dev/sdk@latest`
3. 新建 `trigger.config.ts`：

```ts
import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  runtime: "node-24",
  dirs: ["./src/trigger"],
  maxDuration: 120,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true },
  },
})
```

4. `package.json` 加 `"trigger:dev": "npx trigger.dev@latest dev"`
5. 新建 `docs/current_tasks.md`（CLAUDE.md 规则 4 要求每次新增 Task 同步该文档；go2office 目前没有这个文件，本次一并创建）

### 6.2 ⚠️ 导入路径

**必须 `import { task } from "@trigger.dev/sdk"`，严禁 `@trigger.dev/sdk/v3`。**

xpros 全库用的是 `/v3` 路径（它接入得早），照抄会引入已废弃的写法。Trigger.dev v4 官方文档明确：*"ALWAYS import from `@trigger.dev/sdk`. NEVER import from `@trigger.dev/sdk/v3`."*

### 6.3 Task

```ts
// src/trigger/quote-shipping.ts
import { task } from "@trigger.dev/sdk"
import { createClient } from "@supabase/supabase-js"
import { runQuoteEngine } from "@/lib/shipping/quote-engine"

export const quoteShippingTask = task({
  id: "quote-shipping",
  maxDuration: 60,
  run: async ({ orderId, triggeredBy, userId }: {
    orderId: number
    triggeredBy: "auto" | "manual"
    userId?: string | null
  }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    return runQuoteEngine(supabase, orderId, triggeredBy, userId)
  },
})
```

Server Action 侧用**类型导入**触发，避免把 task 代码打包进 Next.js bundle：

```ts
import type { quoteShippingTask } from "@/trigger/quote-shipping"
import { tasks } from "@trigger.dev/sdk"

const run = await tasks.trigger<typeof quoteShippingTask>("quote-shipping", { ... })
```

---

## 7. UI

### 7.1 面板

新建 `src/app/(dashboard)/orders/[id]/_components/shipping-quotes-panel.tsx`，挂在 [订单详情页](<../src/app/(dashboard)/orders/[id]/page.tsx>) 的 `OrderSummaryCards` 与 `OrderTransactionsTable` 之间。

行为照搬 xpros：

- 只显示 **`quoted_at` 最大的那一批**报价（历史批次留在库里但不渲染）
- **Re-Quote Shipping** 按钮触发 task，随后每 2 秒轮询一次、最多 30 次；发现新批次即停止轮询、自动选中最便宜的一条并 toast
- **Clear Quotes** 走 `useConfirm`（CLAUDE.md 规则 9，项目已有 `src/components/providers/confirm-provider.tsx`）
- 表格列：Method / Carrier / Zone / Weight（实重 + 计费重）/ Rate / 选中态
- 报价失败的行以半透明显示，`error_message` 占据 Rate 列
- Express 与 Flat Rate 各打一个 Badge
- 所有 UI 文案用英文（CLAUDE.md 第 1 节）

### 7.2 两处 go2office 特有的增强

1. **尺寸估算警告**：`order_metrics_summary.has_estimated_dimensions` 为 true 时，在面板头部显示一行提示——该订单里有商品缺尺寸、按 10mm 兜底，定额袋箱的装箱判定因此是猜的。实测 203,315 张订单里有 **13,695 张（6.7%）** 命中。
2. **未解析明细警告**：`unresolved_item_count > 0` 时提示报价可能偏低（这些明细有数量但不贡献重量和尺寸）。当前 296 张订单命中，最终 Laravel 导入后约 3,026 行明细会落进这一类。

xpros 没有这两个提示，是因为它没有这两个字段——go2office 的指标表是为此专门设计的，不用可惜。

---

## 8. 分阶段交付

| 阶段 | 内容 | 可独立验证 |
|---|---|---|
| **1** | 5 个迁移 + 抽数脚本 + `database.types.ts` 手工补齐（**CLAUDE.md 规则 18：该文件是手工维护的，严禁用 `gen types` 重定向覆盖**） | §3.3 的两条覆盖率查询 |
| **2** | 引擎纯函数 + 适配器 + 单测（不接 Trigger、不接 Aramex，Aramex 适配器先返回 stub 错误） | `npm test` |
| **3** | Aramex 客户端（需用户先填 4 个 env） | 对单张真实订单手工调一次报价 |
| **4** | Trigger.dev 接入 + task | `npm run trigger:dev` 后从控制台手工触发 |
| **5** | Server Actions + 面板 UI | 页面上点按钮跑通全链路 |
| **6** | 验收（§10） | |

阶段 2 可以在阶段 1 完成后立刻开始；阶段 3 被用户提供 Aramex key 阻塞，但**不阻塞其余任何阶段**——Aramex 只是四种报价路径中的一种。

---

## 9. 待确认的业务决策

### 9.1 ~~`Register_Letter` 的固定价是多少？~~（✅ 2026-08-16 已确认）

范围已定（决策 6）：`Register_Letter` 参与、`Letter` 不参与。剩下的那个数字已由用户确认——**`fixed_price_aud` 沿用 xhunter 的 `5.00`**，写进 `20260810120000_seed_carrier_reference_data.sql`。

⚠️ 它不报错、只静默影响自动选优：填高了 `Register_Letter` 永远选不中，填低了它会抢走本该走 MyPost 的订单。日后调价改这一行即可，不涉及任何结构变更。

顺带记录一个**已接受的取舍**：`Letter` 覆盖 134,391 张历史订单（66%），它不参与报价意味着一张本可平信寄出的小订单，引擎给出的最便宜选项是 `Register_Letter` $5 或 MyPost 最低档（约 $6.55）。这与 xpros 的行为一致——平信无追踪、无可查询的费率结构，不适合进报价表。人工仍可在订单上直接选 `Letter`。

### 9.2 其余需确认项

| # | 问题 | 影响 |
|---:|---|---|
| 1 | `shipping_settings` 的五个默认值直接照搬 xpros 生产值（1040mm / 22kg / $9.50 超尺寸费 / 1000mm 阈值 / 9.90% 燃油费）——**燃油附加费率与 xhunter 的 eParcel 合同挂钩**，go2office 是否同一份合同？ | 全部 eParcel 报价等比例偏移 |
| 2 | Aramex 的 `max_order_total_aud = 200` 是 xhunter 的保价上限，go2office 是否相同？ | 高价订单会/不会出现 Aramex 选项 |
| 3 | 「无可用承运商」时自动把订单改成 `issued` —— 确认这是期望行为，还是宁可**不改状态、只在面板上报错**？ | 后者更安全，且省掉 `order_logs`（§2.7） |
| 4 | 报价是否要在订单创建时**自动触发**（xpros 有 `triggeredBy: 'auto'` 这条路径），还是只保留手工按钮？ | 本计划只做手工按钮；自动触发留作后续 |
| 5 | ~~`Mypost_Reg_Xs_Satchel` 的三个尺寸值错位~~ | ✅ 已定：**不搬**，三列留空。依据见 §9.3 |

### 9.3 `Mypost_Reg_Xs_Satchel` 的三个尺寸值为什么不搬（2026-08-16 已定）

这三列不是自由命名的，`canQuote` 把它们各自绑到排序后的某条边（`xpros/src/lib/shipping/carrier-capabilities.ts:89-93`）：

```ts
const [dim0, dim1, dim2] = [pkg.packedL, pkg.packedW, pkg.packedH].sort((a, b) => b - a)
// dim0 = longest, dim1 = middle, dim2 = shortest (thickness)
if (maxPackedThicknessMm !== null && dim2 > maxPackedThicknessMm) return false  // 最短边
if (maxPackedLengthMm    !== null && dim0 > maxPackedLengthMm)    return false  // 最长边
if (maxPackedWidthMm     !== null && dim1 > maxPackedWidthMm)     return false  // 中间边
```

xpros 那行是 `thickness=260 / length=160 / width=90`，代进去是「最短边 ≤ 260、最长边 ≤ 160、中间边 ≤ 90」。**两个独立的矛盾**：

1. **自相矛盾**：恒有 最短 ≤ 中间 ≤ 最长，所以「最长 ≤ 160」已把最短边压到 160 以下，「中间 ≤ 90」又压到 90 以下 —— 那条 260 的厚度限制永远不可能生效。
2. **与袋子自身规格冲突**：XS 袋是 280 × 215mm，这行却拒收长边 > 160mm 的东西，远紧于袋子本身。

把 260/160/90 当成 **L / W / H** 读则完全自洽（最长 ≤ 260、中间 ≤ 160、最短 ≤ 90），且正好卡进 280 × 215 的袋子。xpros 表的物理列序恰是 `thickness, length, width`，按位置填入一组 L/W/H 就会落成这样 —— **这一步是推断**，但同表的 `Register_Letter`（`20 / 297 / 210`，最薄边 20mm + A4 长短边）明显是按列名填对的，一行按名、一行按位，符合两次不同录入。

**后果**：约束比预期紧得多，中间边超过 90mm 的小件会被踢出 XS 袋，而 XS 袋映射到 0.25kg（MyPost 最便宜档，standard Zone_1 $6.12），订单于是静默报到更贵的档。

**留空是安全的**，因为真正的几何判定不在这三列，而在 flat-rate 适配器里按袋子实际规格算（`flat-rate.adapter.ts:53`，袋子按二维折算、厚度从两边各吃一次）：

```ts
fits = (orderL + orderH) <= spec.length_mm && (orderW + orderH) <= spec.width_mm
```

另外四个尺寸的袋子（S/M/L/XL）本来就**只**靠这一步 —— 它们这三列全是 NULL。XS 留空是回到同一条路径，不是放弃校验。

---

## 10. 验收清单

- [x] `postcode_carrier_zones` 行数 = 33,424（导入 32,912 + 补齐 512，§3.4），且 `(postcode_id, carrier_id)` 无重复
- [x] §3.3 查询二：已逐条看过 —— 查出两处源表缺口，均已按澳邮官方分区定义补齐（§3.4），客户侧「仅某一家可解析」归零
- [x] 抽数脚本对「xpros 有、go2office 解析不到」的 `(postcode, locality)` 组合有完整输出：0 行
- [ ] `npm test` 全绿，含新增的 shipping 用例
- [ ] 取 10 张历史订单（覆盖：轻小件 / 5kg 边界 / 超 1040mm / PO Box 地址 / 金额 > $200），在 go2office 与 xpros 各跑一次报价，**同一承运商的价格逐分对齐**
- [ ] 一张 ≤0.5kg、≤$100、厚度 ≤20mm 的订单能报出 `Register_Letter`；把金额抬到 $101 后该选项消失（`max_order_total_aud` 生效）
- [x] `carrier_services` / `carrier_zone_rates` / `postcode_carrier_zones` 中 `reg_letter` 与 `aramex` 的行数**均为 0**（§2.5.1）
- [ ] 一张 PO Box + 超重订单能正确落到 `issued` 并在 `order_logs` 留痕
- [ ] 面板：Re-Quote → 轮询 → 自动选中 → `orders.shipping_method` 被回写；Clear Quotes 走全局确认框
- [ ] Dialog / 面板在移动端与桌面端各验一次（CLAUDE.md 规则 12）
- [ ] `docs/current_tasks.md` 已创建并记录 `quote-shipping`（CLAUDE.md 规则 4）
- [x] `src/lib/supabase/database.types.ts` 已手工补齐 **9** 张新表（CLAUDE.md 规则 18），`npx tsc --noEmit` 通过

---

## 11. 对既有约定的影响

### 11.1 CLAUDE.md 需要新增一条规则

`zone-resolver` 的邮编解析口径与 `fn_standardize_customer_address()` **必须保持一致**（同样的 `lpad(...,4,'0')` + `upper()` + 等值匹配）。这是与规则 17（`charm_price` 双实现）同构的问题：两边漂移不会报错，只会让「地址标准化得出 state、运费查不到 zone」，而这种不一致极难从现象反推原因。建议在规则 21 下补一条子项，而不是新开一条。

### 11.2 对迁移脚本（CLAUDE.md 规则 15）的影响

**无影响**。本次新增的 9 张表都不被 `scripts/migration/001`~`004` 引用，也不改动这些脚本已引用的任何列。`order_shipping_quotes.order_id` 对 `orders` 的外键是 `ON DELETE CASCADE`，`004` 的重跑（upsert，不删行）不会触发它。

### 11.3 不引入的东西

- **不建 `warehouses` 表**（决策 1）。若将来真要开第二个仓，`carrier_dispatch_options` 与 `postcode_carrier_zones` 都需要加回 `origin_warehouse_id`，届时 eParcel 的分区数据要重新从 xpros 抽（那边按仓存了 5 份）。这一点写进迁移注释。
- **不动 `order_metrics_summary`**。引擎所需的全部包裹指标它已经具备，本次一列不加。
- **不做承运商 / 费率的后台 CRUD 页面**。费率是一年调一次的静态数据，改一次写一个迁移即可（与 `postcodes` / `countries` 不同——那两张表用户要日常维护，才配了 `/settings/*` 页面）。若后续确有需求，再按 `/settings/countries` 的模式补。
