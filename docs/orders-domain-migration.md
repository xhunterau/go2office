# Orders 域迁移（go2_buyers / go2_orders / go2_transactions / go2_transactions_products）— 开发文档

> 状态：**已实现并在远端库执行完成**（2026-08-02，见 §12 执行记录）
> **最新结构见 §13**（第四轮评审改动：地址移到 customers、运费上移到订单、删若干列）
> 创建日期：2026-08-02 ｜ 修订：2026-08-02（第二、三、四轮反馈 + 执行结果回写）
> 前置文档：`docs/products-domain-migration.md`、`docs/product-kits-migration.md`、`docs/inventory-migration.md`
> 本轮范围：**仅迁移层**（schema 迁移 + 数据搬运脚本 + `order_items` 自动维护 trigger + 类型定义同步）。订单管理 UI 另开一轮。
> 现状核查数据均为 **2026-08-02 连接远端库 `nszriuqpumbyigxwtccs` 实测**。

---

## 1. 目标

| 遗留表 | 正式表 | 语义 | 行数 |
|---|---|---|---|
| `go2_buyers` | `public.customers` | 客户主档（去重后） | 196,085 → **178,024** |
| `go2_orders` | `public.orders` | 订单头（含收件地址快照） | 203,315 |
| `go2_transactions` | `public.order_transactions` | 平台销售行（一条 eBay/Shopify 交易） | 250,413 |
| `go2_transactions_products` | `public.order_items` | 内部 SKU 履约行，**新系统中由 trigger 自动维护** | 250,687 |

产出：幂等的 `scripts/migration/004_orders_data.sql`；`order_items` 自动展开机制；`database.types.ts` 同步（CLAUDE.md 规则 18）。

**不在本轮范围**：订单列表/详情 UI、订单创建编辑 Server Actions、平台对接、发货面单、财务报表。

---

## 2. 现状核查（实测）

### 2.1 规模与 id 范围

| 表 | 精确行数 | id 范围 |
|---|---|---|
| `go2_buyers` | 196,085 | 1 – 196,085（连续） |
| `go2_orders` | 203,315 | 2,004 – 205,975 |
| `go2_transactions` | 250,413 | 2,383 – 254,845 |
| `go2_transactions_products` | 250,687 | 2,373 – 277,098 |

合计约 90 万行，是目前为止最大的一轮迁移（前三轮合计不到 6,000 行）。

### 2.2 引用完整性（全部干净）

```
go2_orders.buyer_id                      → go2_buyers        孤儿 0
go2_transactions.order_id                → go2_orders        孤儿 0
go2_transactions_products.transaction_id → go2_transactions  孤儿 0
go2_transactions_products.product_id     → go2_products      孤儿 0
tp.order_id ≠ transaction.order_id                           0 行
```

两处结构性空洞（业务事实，非错误）：**25 个订单没有 transaction**；**5,481 个 transaction 没有 order_item**。新表外键方向允许这两类存在。

### 2.3 三层语义（本轮最关键的判断）

三张表不是「订单 → 明细 → 明细的明细」的冗余分层，而是两个坐标系：

```
orders                    一次结账 / 一个包裹
  └── order_transactions  平台卖出的是「什么 listing」：标题、listing id、成交价、运费
        └── order_items   仓库实际拣出的是「哪些内部 SKU、各几件」
```

证据：`order_items.quantity ÷ transaction.quantity` **恒为整数倍**（2× 13,429 组、4× 4,513、10× 3,292、5× 1,969、25× 1,571、100× 1,480、50× 1,328…），3,595 个 transaction 对应多条 item。这就是**套装 / 多件装在拣货时被拆解**的记录。

| 一个 transaction 对应的 item 数 | 出现次数 |
|---|---|
| 1 | 241,337 |
| 2 | 2,787 |
| 3 | 200 |
| 4 | 162 |
| 5 | 346 |
| 6 | 34 |
| 9 | 66 |

**三层必须原样保留。** 这也和 `product_kit_items`（套装 BOM）对得上——`order_items` 就是 BOM 在成交那一刻的展开结果，正因如此它才能由 trigger 自动生成（§5）。

### 2.4 源表逐列实测

`go2_buyers`（14 列，全 `varchar`，仅 `id` NOT NULL）：

| 列 | 实测 |
|---|---|
| `buyer_fullname` | 7 空 |
| `buyer_userid` | **20,347 空**；157,887 个不同值 |
| `buyer_phone_number` | 44 空 |
| `buyer_email` | 45 空；**89,287 行是 `@members.ebay.com` 匿名邮箱**，106,753 行真实 |
| `buyer_address_1` | 7 空 |
| `buyer_address_2` | 14,196 行有值（`Unit 2`、`Unit 4`…） |
| `buyer_address_3` | 129,311 行有值，其中 **129,276 行形如 `ebay:zsqywfc`**（仅 4,899 个不同值、单值最高重复 193 次，是 eBay 导出批次留下的引用码，不是地址也不是买家唯一标识），仅 35 行是真实地址 —— **按决策原样保留**（§3） |
| `buyer_address_4` | 11 行有值 |
| `company_name` | 1,710 行有值 |
| `buyer_city` | 5 空 |
| `buyer_state` | 写法不统一：`NSW` 57,184 / `New South Wales` 5,466；`VIC` 49,296 / `Victoria` 5,729；`QLD` 35,242 / `Queensland` 3,875 等 —— **按决策原样迁移**（§3） |
| `buyer_postcode` | 6 空 |
| `buyer_country` | `AU` 115,413 / `Australia` 80,650 / `New Zealand` 10；4 行脏值（邮编 `2581`/`2790`/`2830`、`Australia Post` 写进国家列）—— **按决策原样迁移** |

`go2_orders`（20 列）：

| 列 | 实测 | 去向 |
|---|---|---|
| `id` | — | 主键，沿用 |
| `buyer_id` | 孤儿 0 | → `customer_id`（经去重映射） |
| `payment_method` | 严重脏：`PayPal` 114,893 / 空串 88,100 / `paypal` 30 / **`AU $8.95` 等金额串 ≈15 行** | **按决策丢弃** |
| `posted_on_date` | 4,919 空；2018-02-20 – 2026-07-15 | 迁移 |
| `invoice_number` | **0 空、203,315 个值全局唯一** | 迁移，业务主键 |
| `transit_cover` | 0 空；3,536 行非 0 | 迁移 |
| `order_status` | `COMPLETED` 202,778 / `CANCELLED` 527 / `PROCESSING` 9 / `ISSUED` 1 | → enum |
| `shipping_method` | 25 个值，见 §2.6 | → enum，**有冲突，见 §10** |
| `tracking_number` | 4,845 空 | 迁移 |
| `comments` | 113,276 空 | 迁移 |
| `logs` | 0 空，1,826,492 行 / 94 MB | **按决策丢弃** |
| `platform` | `EBAY` 178,244 / `SHOPIFY` 20,624 / `BACKORDER` 3,878 / `STORE` 569 | → enum |
| `ebay_user_id` | 142,066 空，其余恒为 `2`；无对应表 | 丢弃（死字段） |
| `is_atl` | **全表恒为 0** | **按决策丢弃** |
| `web_order_id` | 182,551 空；20,763 个不同值，1 组重复 | 迁移 |
| `created_at` | **61,285 空**；2020-03-29 – 2026-07-15 | 迁移 + 回填 |
| `updated_at` | 60,274 空 | 由 DB 维护，不搬 |
| `parcel_zone` | 60,274 空；`N0` 25,928 / `V0` 23,825 / `N2` 10,922… | 迁移 |
| `total_sale` | 0 空；**61,329 行为 0**（见 §2.5） | **按决策丢弃**，改由视图聚合（§4.6） |
| `est_profit` | **全表恒为 0** | **按决策丢弃** |

`go2_transactions`（19 列）：

| 列 | 实测 |
|---|---|
| `order_id` | 孤儿 0 |
| `sales_record_number` | 502 空；210,077 个不同值，**23,019 组重复 → 不唯一** |
| `item_number` | 933 个不同值（eBay listing id） |
| `item_title` | 平台标题快照 |
| `custom_label` | 50 空；3,240 个不同值；**242,406 / 250,413（96.8%）命中 `public.products.sku`**，其中 33,562 行指向 kit |
| `quantity` | 1 – 500 |
| `sale_price` | 0 空；**-640.00 – 250.00**（负数为退款/冲销的真实记录） |
| `postage_and_handling` | 0 空 |
| `sale_date` / `paid_on_date` | NOT NULL；2018-02 – 2026-07 |
| `postage_service` | 19 个不同值（平台侧服务，与 `orders.shipping_method` 是两回事） |
| `order_id_ebay` | 167,703 个不同值 |
| `transaction_id_ebay` | 248,327 个不同值，**77 组重复 → 不唯一** |
| `paypal_transaction_id_number` / `click_and_collect_reference` / `notes_to_yourself` / `private_field` | eBay 导出字段，迁移 |
| `ebay_user_id` | 仅 `2`（147,242）与 `0`（103,171）；无对应表 → 丢弃 |

`go2_transactions_products`（7 列）：

| 列 | 实测 |
|---|---|
| `transaction_id` / `product_id` | 孤儿均为 0；但 **334 行指向 15 个不在 `public.products` 的软删除商品**（§2.7） |
| `quantity` | 履约实发数量 |
| `order_id` | **完全冗余**（与 transaction 的 0 处不一致）→ 丢弃 |
| `pick_location` | 221,794 空；非空的 **28,893 行 100% 匹配 `public.locations.name`** |
| `pack_status` | **全表 NULL** → 丢弃 |

### 2.5 `total_sale` 为什么丢弃是对的

与 `sum(sale_price × quantity + postage_and_handling)` 逐单对账：一致 142,010 单，不一致 61,280 单。不一致的行里 **61,275 行 `total_sale = 0`、61,269 行 `created_at IS NULL`** —— 是 2020-03 从上一代 XOFFICE 导入的历史单，金额头没跟着搬。真实金额差异只有 **5 行**。

即：这一列 30% 的行是假数据，且完全可由下层重算。丢弃 + 视图聚合（§4.6）是正确处理。

### 2.6 `shipping_method` 源值分布（25 个）

| 值 | 行数 | | 值 | 行数 |
|---|---|---|---|---|
| `Letter` | **134,391** | | `Mypost M-Box` | 296 |
| `eParcel Regular` | 15,919 | | `Zone6 Express` | 260 |
| `Zone6 Regular` | 14,893 | | `Express Post` | 259 |
| `Sendle` | 10,783 | | `Mypost Express` | 145 |
| `eParcel 500g` | 9,325 | | `Toll B2C` | 41 |
| `Registered Letter` | 4,249 | | `''`（空串） | 33 |
| `Click&Send` | 3,416 | | `MyExpress S-Box` | 7 |
| `Parcel Post` | 2,298 | | `Mypost L-Box` | 3 |
| `Winit` | 2,080 | | `Register Letter`（typo） | 2 |
| `Mypost S-Box` | 1,796 | | `MyExpress M-Box` | 2 |
| `Store Delivery` | 1,258 | | `Sendle 250g` | 1 |
| `Fast Track` | 1,085 | | `NULL` | 342 |
| `eParcel Express` | 431 | | | |

映射规则见 §10（已定稿）：**173,797 行（85.5%）落进新 enum，29,143 行（14.3%）为已停用承运商、进 `legacy_shipping_method` 列**。

### 2.7 15 个「卖过但已被软删除」的商品

`order_items.product_id` 有 **334 行**指向 15 个商品，它们在 Laravel 侧 `deleted_at IS NOT NULL`，001 脚本按既有决策未迁入 `public.products`：

| product_id | SKU | 名称 | 明细行 | 件数 |
|---|---|---|---|---|
| 1149 | `GB01147SF\|GY` | Large Pure Color Lunch Bag Grey | 79 | 85 |
| 1151 | `GB01147SF\|CF` | Large Pure Color Lunch Bag Coffee | 63 | 69 |
| 1143 | `GB01141SF\|LB` | Pure Color Lunch Bag Light Blue | 46 | 47 |
| 1146 | `GB01141SF\|RR` | Pure Color Lunch Bag Hot Pink | 31 | 34 |
| 1142 | `GB01141SF\|BE` | Pure Color Lunch Bag Beigh | 31 | 33 |
| 3 | `GB00002AF` | Wrist Palm Protection Bracelet Guard | 21 | 58 |
| 360 | `GB00006AF\|BL` | Fitness Gym Gloves … Blue | 16 | 16 |
| 1155 / 1156 / 1154 / 1153 | `GB01152SF\|*` | Plaid Lunch Bag ×4 色 | 33 | 33 |
| 2643 | `GB02643SF` | Go2Buy Aluminium Phone/iPad Stand | 5 | 5 |
| 1145 | `GB01141SF\|GR` | Pure Color Lunch Bag Green | 5 | 5 |
| 361 | `GB00006AF\|PK` | Fitness Gym Gloves … Pink | 3 | 3 |
| 1471 | `GB01013SF\|GR` | Cooler Lunch Bag w/o Handle Green | 1 | 1 |

处理：`order_items.product_id` 可空 + `sku_snapshot` 文本快照（§4.5）。

> **附带发现（与本轮无关，需记录）**：`product_id = 3` 在 `go2_products` 中 `deleted_at IS NULL` 却不在 `public.products`；反向也恰有 1 行。说明 001 执行后 `go2_*` 临时表被重新导入过而 001 未重跑。按 §9 顺序重跑 001 即自愈。

---

## 3. 已确认决策

**第一轮（2026-08-02）**

| # | 决策 |
|---|---|
| 1 | `go2_buyers` 纳入本轮，迁移为 `public.customers` |
| 2 | `go2_orders.logs`（183 万行 / 94 MB）**丢弃** |
| 3 | 本轮**仅迁移层**，订单 UI 另开一轮 |

**第二轮（2026-08-02）**

| # | 决策 | 影响 |
|---|---|---|
| 4 | `payment_method`、`total_sale`、`is_atl`、`est_profit` **四列全部去掉** | `orders` 表少 4 列；订单金额改由 `order_totals` 视图聚合（§4.6） |
| 5 | `buyer_state` / `buyer_country` **原样迁移**，不做格式化 | 取消原方案的州名/国名归一化；`NSW`/`New South Wales` 并存，留待以后处理 |
| 6 | `buyer_address_3` **保留原数据** | 即使 129,276 行是 `ebay:xxxx` 引用码，仍原样存入 `ship_to_line3` |
| 7 | `order_items` 由 **trigger 自动维护** | 新增 §5 整节：transaction 变更后自动重算映射与数量（含 kit 拆解） |
| 8 | `customers` **去重成客户主档** | 196,085 → 178,024 |
| 9 | 历史 `order_items` **照搬 Laravel 实际记录**，trigger 只管新变更 | 保住 3,026 行无法重算的明细、105 行人工事实、28,893 行拣货库位 |
| 10 | `shipping_method` 用 **enum**，值集由用户给定（33 个） | 与历史数据冲突，第三轮已解决 |

**第三轮（2026-08-02）—— `shipping_method` 定稿**

| # | 决策 |
|---|---|
| 11 | enum 追加 `Letter`（历史第一大值，134,391 行），最终 **34 个值** |
| 12 | `Sendle` / `Sendle 250g` / `Winit` / `Toll B2C` / `Zone6 Regular` / `Zone6 Express` / `Fast Track` **业务上已停用**，不进 enum |
| 13 | `Click&Send` → `Click_and_Collect`（用户确认二者在本业务中是同一件事，覆盖 §10 原先提出的语义疑虑） |
| 14 | `eParcel 500g` → `Eparcel_Regular` |
| 15 | `Mypost S/M/L-Box` → `Mypost_Reg_S/M/L_Box`（无档位信息的一律归 Regular 档） |

---

## 4. 目标 schema

> ⚠️ **本节是初版设计，已被第四轮评审改动（2026-08-02）。最终结构见 §13。**
> 主要差异：地址从 `orders` 移到 `customers`；`transit_cover` / `parcel_zone` 删除；运费从交易行上移到订单；`order_transactions` 删 3 列；`order_totals` 删 `postage_total`。

### 4.1 枚举

```sql
CREATE TYPE public.order_status AS ENUM ('processing', 'issued', 'completed', 'cancelled');
CREATE TYPE public.sales_platform AS ENUM ('ebay', 'shopify', 'backorder', 'store');
```

两者源值取值完全封闭（各 4 个，无意外值），适合枚举。顺序按订单生命周期排列，便于 `ORDER BY status`。

```sql
CREATE TYPE public.shipping_method AS ENUM (
  'Letter', 'Register_Letter', 'Parcel_Post', 'Express_Post',
  'Eparcel_Regular', 'Eparcel_Express', 'Eparcel_Intl_Express',
  'Mypost_Regular', 'Mypost_Express',
  'Mypost_Reg_Xs_Box', 'Mypost_Reg_S_Box', 'Mypost_Reg_M_Box', 'Mypost_Reg_L_Box', 'Mypost_Reg_XL_Box',
  'Mypost_Exp_Xs_Box', 'Mypost_Exp_S_Box', 'Mypost_Exp_M_Box', 'Mypost_Exp_L_Box', 'Mypost_Exp_XL_Box',
  'Mypost_Reg_Xs_Satchel', 'Mypost_Reg_S_Satchel', 'Mypost_Reg_M_Satchel', 'Mypost_Reg_L_Satchel', 'Mypost_Reg_XL_Satchel',
  'Mypost_Exp_Xs_Satchel', 'Mypost_Exp_S_Satchel', 'Mypost_Exp_M_Satchel', 'Mypost_Exp_L_Satchel', 'Mypost_Exp_XL_Satchel',
  'Store_Delivery', 'Direct_Freight', 'Click_and_Collect',
  'Aramex_Parcel', 'Aramex_Satchel'
);
```

**34 个值** = 用户给定的 33 个 + 决策 11 追加的 `Letter`。排列顺序按「信件 → 包裹 → eParcel → MyPost 盒 → MyPost satchel → 其他承运商」分组，纯粹为可读性，不影响语义。

> **命名风格不统一（已知，接受）**：`shipping_method` 用 `PascalCase_Snake`（用户给定的字面值），而 `order_status` / `sales_platform` 沿用项目既有小写风格（与 `stock_movement_kind` 的 `receive` / `move_in` 一致）。若要全库统一，改的是 `order_status` / `sales_platform` 这两个还没落地的类型，成本为零——但要在实现前说。

> **枚举的维护成本**（选定 enum 即接受）：Postgres 加值要 `ALTER TYPE … ADD VALUE`，且同一事务内加完不能立即使用；**删值和改名基本不可行**（需重建类型 + 重写所有引用列）。承运商变动时，每次都要走一次迁移文件。

### 4.2 `public.customers`（← `go2_buyers`，去重）

```sql
CREATE TABLE public.customers (
  -- 去重组内最小的 go2_buyers.id，沿用为主键。取 min 而非新发号，是为了让
  -- 004 脚本幂等：最终备份只会追加更大的 id，组内 min 不变，重跑不产生重复客户。
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- eBay 用户名。20,347 行源数据没有，故可空；有值时全局唯一。
  platform_user_id text,
  full_name text,
  email text,
  phone text,
  -- 89,287 行邮箱是 @members.ebay.com 匿名地址，不能用于联系。显式标记，
  -- 避免 UI / 营销把它们当作可达邮箱。
  is_anonymised_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_platform_user_id_unique UNIQUE (platform_user_id)
);

CREATE INDEX customers_email_idx     ON public.customers (lower(email));
CREATE INDEX customers_full_name_idx ON public.customers (full_name);
```

去重键（按优先级回退）：

```
COALESCE(
  NULLIF(lower(btrim(buyer_userid)), ''),             -- 157,887 组
  'email:' || NULLIF(lower(btrim(buyer_email)), ''),  --  20,109 组
  'buyer:' || id::text                                --      28 组（userid 与 email 都空）
)
```

**实测：196,085 行 → 178,024 个客户**（压缩 9.2%）。姓名/邮箱/电话取组内 `id` 最大（最新）的一行。

> 地址不进 `customers`：同一客户在不同订单可能寄往不同地址（实测 5,008 个 userid 就是如此），把地址挂在客户上会让历史订单显示错误的收件信息。地址一律作为下单快照存在 `orders` 上。

### 4.3 `public.orders`

```sql
CREATE TABLE public.orders (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,  -- 沿用 go2_orders.id
  customer_id bigint NOT NULL REFERENCES public.customers (id) ON DELETE RESTRICT,
  -- 203,315 行全局唯一且无空 —— 业务主键，UI 搜索的主入口。
  invoice_number text NOT NULL,
  status public.order_status NOT NULL,
  platform public.sales_platform NOT NULL,
  shipping_method public.shipping_method,
  -- 已停用承运商的历史原值（29,143 行：Zone6 / Sendle / Winit / Fast Track /
  -- Toll B2C）。新 enum 里没有它们，新系统也不再写这一列；存在的意义是不让
  -- 14.3% 的历史订单丢掉运送方式。UI 显示用
  -- COALESCE(shipping_method::text, legacy_shipping_method)。
  legacy_shipping_method text,
  transit_cover numeric(12, 2) NOT NULL DEFAULT 0,
  tracking_number text,
  parcel_zone text,
  web_order_id text,                        -- Shopify / 其他平台订单号
  comments text,
  posted_on_date timestamptz,               -- 发货时间，未发货为 NULL
  -- 收件地址快照：源自下单时的 go2_buyers 行，不随客户资料变更。
  -- 全部按原样迁移，不做州名/国名归一化（决策 5、6）。
  ship_to_name text,
  ship_to_company text,
  ship_to_phone text,
  ship_to_line1 text,
  ship_to_line2 text,
  ship_to_line3 text,   -- 129,276 行是 eBay 引用码 `ebay:xxxx`，按决策 6 原样保留
  ship_to_line4 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postcode text,
  ship_to_country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_invoice_number_unique UNIQUE (invoice_number)
);

CREATE INDEX orders_customer_id_idx     ON public.orders (customer_id);
CREATE INDEX orders_status_idx          ON public.orders (status);
CREATE INDEX orders_platform_idx        ON public.orders (platform);
CREATE INDEX orders_posted_on_date_idx  ON public.orders (posted_on_date DESC NULLS LAST);
CREATE INDEX orders_created_at_idx      ON public.orders (created_at DESC);
CREATE INDEX orders_tracking_number_idx ON public.orders (tracking_number);
```

`created_at` 有 61,285 行为空，新表 NOT NULL，回填顺序：
`COALESCE(created_at, posted_on_date, (该单最早的 sale_date), '2018-01-01')`。

时区：所有时间列都是 naive `timestamp`，与 products/kits 两轮一致，按 `AT TIME ZONE 'Australia/Sydney'` 重解释为 `timestamptz`。

> 索引在 20 万行规模上是必需品：列表页默认按时间倒序 + 按状态/平台筛选，无索引即全表扫。`ship_to_*` / `comments` 的模糊搜索留到 UI 轮评估（大概率需要 `pg_trgm`）。

### 4.4 `public.order_transactions`

```sql
CREATE TABLE public.order_transactions (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,  -- 沿用 go2_transactions.id
  order_id bigint NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  item_title text,            -- 平台标题快照
  item_number text,           -- eBay listing id
  custom_label text,          -- 平台侧 SKU —— trigger 展开 order_items 的输入（§5）
  quantity integer NOT NULL,
  sale_price numeric(12, 2) NOT NULL DEFAULT 0,
  postage_and_handling numeric(12, 2) NOT NULL DEFAULT 0,
  sale_date timestamptz NOT NULL,
  paid_on_date timestamptz NOT NULL,
  postage_service text,
  sales_record_number text,          -- 不唯一（23,019 组重复），不加约束
  order_id_ebay text,
  transaction_id_ebay text,          -- 不唯一（77 组重复），不加约束
  paypal_transaction_id_number text,
  click_and_collect_reference text,
  notes_to_yourself text,
  private_field text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_transactions_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX order_transactions_order_id_idx     ON public.order_transactions (order_id);
CREATE INDEX order_transactions_sale_date_idx    ON public.order_transactions (sale_date DESC);
CREATE INDEX order_transactions_custom_label_idx ON public.order_transactions (custom_label);
```

> **`sale_price` 不加 `CHECK (>= 0)`** —— 实测最低 -640.00，负数是退款/冲销的真实业务记录，加约束会让 004 在这些行上整体回滚。

### 4.5 `public.order_items`（trigger 维护）

```sql
CREATE TABLE public.order_items (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,  -- 历史行沿用遗留 id
  transaction_id bigint NOT NULL REFERENCES public.order_transactions (id) ON DELETE CASCADE,
  -- 可空 + SET NULL：商品被删除时订单历史必须留存。334 行历史明细指向 15 个
  -- 已从 Laravel 软删除的商品（§2.7），靠 sku_snapshot 保住身份。
  product_id bigint REFERENCES public.products (id) ON DELETE SET NULL,
  -- 成交时的 SKU 文本快照。product_id 为空时是唯一线索，也是 trigger
  -- 无法解析 custom_label 时留下的证据。
  sku_snapshot text,
  quantity integer NOT NULL,
  -- 拣货库位。源列是文本，非空的 28,893 行 100% 匹配 locations.name，
  -- 迁移时解析成真外键；trigger 重建时按 product_id 继承（§5.3）。
  location_id bigint REFERENCES public.locations (id) ON DELETE SET NULL,
  -- true = trigger 自动展开；false = 迁移带入或人工调整过。
  -- 让 UI 能区分「系统算的」和「人改过的」，也是 §5.4 保护逻辑的依据。
  is_auto_generated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX order_items_transaction_id_idx ON public.order_items (transaction_id);
CREATE INDEX order_items_product_id_idx     ON public.order_items (product_id);
CREATE INDEX order_items_location_id_idx    ON public.order_items (location_id);
```

不设 `order_id` 冗余列 —— 源表那一列实测 0 处不一致，纯冗余。若 UI 轮发现两跳 JOIN 成瓶颈，再加视图。

### 4.6 `public.order_totals` 视图（替代被删掉的 `total_sale`）

```sql
CREATE VIEW public.order_totals AS
SELECT
  o.id AS order_id,
  COALESCE(sum(t.sale_price * t.quantity), 0)::numeric(12, 2) AS goods_total,
  COALESCE(sum(t.postage_and_handling), 0)::numeric(12, 2)    AS postage_total,
  COALESCE(sum(t.sale_price * t.quantity + t.postage_and_handling), 0)::numeric(12, 2) AS order_total,
  count(t.id) AS transaction_count
FROM public.orders o
LEFT JOIN public.order_transactions t ON t.order_id = o.id
GROUP BY o.id;
```

> **UI 轮必须注意**：20 万订单的列表页**不能**直接 `JOIN order_totals`，那会每次请求全表聚合。正确做法是先分页拿到当页的 `order_id` 集合，再对这批 id 聚合。若之后列表要按金额排序/筛选，这个视图撑不住，届时需要物化视图或在 `orders` 上加由 trigger 维护的冗余合计列——那是 UI 轮的决策，本轮不预置。

### 4.7 RLS / 权限 / 触发器

四张表统一沿用既有约定（见 `20260801100000_create_inventory_tables.sql`）：`moddatetime` 维护 `updated_at`、`ENABLE ROW LEVEL SECURITY` + `authenticated_full_access` 策略、`GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`。

---

## 5. `order_items` 自动维护机制（决策 7）

### 5.1 可行性实证

用「今天的 BOM + `custom_label` → `products.sku`」重算全部 25 万行历史明细，与 Laravel 实际记录逐行对拍：

| 对拍结果 | 行数 | 占比 |
|---|---|---|
| **精确匹配**（transaction + product + qty 三者全同） | **247,556** | **98.75%** |
| 数量不同 | 6 | 0.002% |
| 实际有、重算没有 | 3,125 | 1.25% |
| 重算有、实际没有 | 1,010 | 0.40% |

3,125 行「实际有、重算没有」的构成：**3,026 行是 `custom_label` 匹配不上任何 SKU**（8,007 个 transaction 如此，多为早期数据），只有 **99 行是真正的 BOM 漂移**。

**结论：展开规则与历史事实一致率 98.75%，trigger 方案成立。** 剩余 1.25% 几乎全部是「源数据本身就没有 SKU 可解析」，不是规则错误。

BOM 结构对 trigger 有利：

- **无嵌套** —— 699 条 BOM 中，组件本身是 kit 的有 **0 条**。展开只需一层，不需要递归 CTE。
- 616 个 kit 中 **577 个只含 1 个组件**（即「N 件装」），2–9 个组件的共 39 个。
- **24 个 kit 没有 BOM**，其中 40 个 transaction 卖过它们。

### 5.2 展开规则

```
输入：order_transactions 的一行（custom_label, quantity）

1. 按 custom_label 精确匹配 public.products.sku（sku 全局唯一，3,122 行无重复）
2a. 命中且 NOT is_kit  → 生成 1 行：product_id = 该商品，qty = transaction.quantity
2b. 命中且 is_kit      → 对每条 product_kit_items 生成 1 行：
                          product_id = component_product_id
                          qty = transaction.quantity × kit_item.qty
2c. 命中 is_kit 但无 BOM → 生成 1 行：product_id = NULL，sku_snapshot = custom_label
3.  未命中             → 生成 1 行：product_id = NULL，sku_snapshot = custom_label
```

2c 与 3 都生成「占位行」而非 0 行 —— 有意为之：`transaction` 卖出去了却没有对应 SKU 是**需要人处理的异常**，不能静默消失。UI 可以直接查 `product_id IS NULL` 拉出待处理清单（历史数据里这是 3,026 + 40 行）。

### 5.3 拣货库位的继承

`location_id` 是人工拣货的结果，不能由展开规则产生。重建时按 `product_id` 从旧行继承：

```
重建前：把该 transaction 现有 order_items 的 (product_id → location_id) 存入临时映射
重建后：对新行按 product_id 回填 location_id
```

即：某商品仍在明细中 → 保住它的库位；商品被换掉 → 库位随旧行一起消失（正确，因为拣的不再是那件货）。

### 5.4 触发时机与保护

**必须拆成两个 trigger**：`WHEN` 子句不能引用 `TG_OP`，且 `OLD` 在 INSERT 时不存在，所以
`AFTER INSERT OR UPDATE … WHEN (TG_OP = 'INSERT' OR OLD.x IS DISTINCT FROM NEW.x)` 根本编译不过。拆开才能让 UPDATE 侧带上 `WHEN`。

```sql
CREATE TRIGGER order_transactions_rebuild_items_insert
  AFTER INSERT ON public.order_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_rebuild_order_items();

CREATE TRIGGER order_transactions_rebuild_items_update
  AFTER UPDATE OF custom_label, quantity ON public.order_transactions
  FOR EACH ROW
  WHEN (
    OLD.custom_label IS DISTINCT FROM NEW.custom_label
    OR OLD.quantity  IS DISTINCT FROM NEW.quantity
  )
  EXECUTE FUNCTION public.trg_rebuild_order_items();
```

UPDATE 侧的两层收敛，每层都是刻意的：

1. `UPDATE OF custom_label, quantity` —— 改运单号、改备注不会触发重算。
2. `WHEN … IS DISTINCT FROM` —— 把值写成原样（UI 全字段提交的常见情形）也不触发。**没有这一层，任何一次订单编辑都会把人工调过的明细冲掉。**

`DELETE` 不需要 trigger，由 `order_items.transaction_id` 的 `ON DELETE CASCADE` 处理。

**BOM 变更（`product_kit_items` 改动）不触发任何重算。** 这是有意的：历史订单记录的是「当时实际发了什么」，用今天的 BOM 改写 2019 年的发货事实是错的。需要重算时走 §5.5 的手动函数。

### 5.5 配套函数

```sql
-- 单条重建，trigger 与手动重算共用同一份逻辑
public.rebuild_order_items(p_transaction_id bigint) RETURNS integer   -- 返回生成行数

-- 整单重建，供 UI 的「重新计算明细」按钮调用
public.rebuild_order_items_for_order(p_order_id bigint) RETURNS integer
```

两者均 `SECURITY INVOKER` + `SET search_path = ''`（沿用本项目既有函数写法），全部对象用全限定名引用。

### 5.6 迁移期间必须禁用 trigger

004 脚本插入 `order_transactions` 时，trigger 会立刻自动生成 25 万行明细；随后脚本再插入历史明细就会主键冲突，且即便不冲突也会把决策 9（历史照搬）冲掉。

因此 004 中 `order_transactions` 与 `order_items` 两步必须包在：

```sql
ALTER TABLE public.order_transactions DISABLE TRIGGER order_transactions_rebuild_items_insert;
ALTER TABLE public.order_transactions DISABLE TRIGGER order_transactions_rebuild_items_update;
--  … 插入 order_transactions 与 order_items …
ALTER TABLE public.order_transactions ENABLE  TRIGGER order_transactions_rebuild_items_insert;
ALTER TABLE public.order_transactions ENABLE  TRIGGER order_transactions_rebuild_items_update;
```

四句必须在**同一个事务**内。`DISABLE TRIGGER` 会取 `ACCESS EXCLUSIVE` 锁并随事务回滚，所以只要不拆事务，中途失败不会留下"触发器被关着"的库。

> 这一步漏掉不会报错——只会让历史明细被今天的 BOM 静默改写，且丢掉 28,893 行拣货库位。**属于必须写进脚本注释和 Runbook 的高危项。**

### 5.7 历史行的 `is_auto_generated`

迁移带入的 25 万行一律置 `false`（它们是 Laravel 的实际记录，不是本系统算出来的）。此后 trigger 生成的行为 `true`。UI 因此可以区分：`false` = 历史事实或人工调整，`true` = 系统按当前 BOM 展开。

---

## 6. 迁移文件清单

| 文件 | 内容 |
|---|---|
| `supabase/migrations/20260803100000_create_orders_domain_enums.sql` | `order_status`、`sales_platform`、`shipping_method` 三个枚举 |
| `supabase/migrations/20260803110000_create_customers.sql` | `customers` + 索引 + RLS |
| `supabase/migrations/20260803120000_create_orders.sql` | `orders` + 索引 + RLS |
| `supabase/migrations/20260803130000_create_order_transactions.sql` | `order_transactions` + 索引 + RLS |
| `supabase/migrations/20260803140000_create_order_items.sql` | `order_items` + 索引 + RLS |
| `supabase/migrations/20260803150000_create_order_items_trigger.sql` | `rebuild_order_items()` 系列函数 + trigger |
| `supabase/migrations/20260803160000_create_order_totals_view.sql` | `order_totals` 视图 |
| `scripts/migration/004_orders_data.sql` | 四张表幂等搬运 + 诊断查询 |
| `src/lib/supabase/database.types.ts` | 手工补 4 个 `Tables` + 1 个 `Views` + 3 个 `Enums` + 2 个 `Functions` 条目（规则 18） |
| `CLAUDE.md` 规则 15 | 脚本清单追加 `004_orders_data.sql` 及其同步约束 |

拆成 7 个迁移文件是为了让失败定位与回滚粒度和前几轮一致。每个文件独立 `BEGIN; … COMMIT;`（规则 14）。

---

## 7. `004_orders_data.sql` 设计要点

顺序严格按外键依赖：`customers → orders → order_transactions → order_items`。

**幂等策略**：与 001/002/003 相同 —— 全部 `INSERT … ON CONFLICT (id) DO UPDATE`，主键沿用遗留 id；`customers` 主键取去重组内 `min(go2_buyers.id)`，最终备份只追加更大的 id，该值稳定。

**步骤**：

1. **customers** —— `DISTINCT ON (dedup_key)` 取组内最新一行的姓名/邮箱/电话，`id` 取组内最小，`is_anonymised_email` 按 `email LIKE '%@members.ebay.com'` 置位。
2. **orders** —— `JOIN go2_buyers` 取地址快照（11 个 `ship_to_*` 列全部原样，不归一化）；经 `dedup_key → customer_id` 的 CTE 映射客户；`created_at` 按 §4.3 回填；`status` / `platform` 转 enum（`lower()`）；`shipping_method` 按 §10 结论映射。
3. **禁用 trigger**（§5.6）。
4. **order_transactions** —— 直搬 + 时区转换；`EXISTS` 守卫跳过订单缺失的行（当前 0 行，守卫用于让最终同步降级为「跳过该行」而非整体回滚）。
5. **order_items** —— `transaction_id` 走 `EXISTS` 守卫；`product_id` 用 `LEFT JOIN public.products` 让缺失商品自动落 NULL（**不过滤整行**）；`sku_snapshot` 从 `go2_products.sku` 取（含软删除商品，故 334 行也有 SKU）；`pick_location` 经 `LEFT JOIN public.locations ON name = pick_location` 解析为 `location_id`；`is_auto_generated = false`。
6. **重新启用 trigger**。
7. **`setval` 序列** —— 四张表各推进到 `MAX(id) + 1`。

**性能**：90 万行单事务在 pooler 上有超时风险。脚本按表拆成 4 个独立事务（而非一个大 `BEGIN/COMMIT`），文件头注明「必须按顺序全部执行完，中途中断会留下引用不完整的中间态」。若实测仍超时，退路是 `order_transactions` / `order_items` 按 id 区间分批。**实现时用真实执行时间验证，不做纸上假设。**

---

## 8. 诊断查询（脚本尾部注释，最终同步必跑）

只列会**静默出错**的项（行消失、数字变化），不列会自己报错的项：

1. 被跳过的行数（订单缺失 / transaction 缺失），期望 0
2. `product_id` 落空的 `order_items` 行数与 SKU 清单，期望 **334 行 / 15 个 SKU**（显著上升说明 Laravel 又软删了在售商品）
3. `location_id` 解析失败但 `pick_location` 非空的行数，期望 0
4. `customers` 归并前后行数比，期望 **196,085 → 178,024**（大幅偏离说明 userid/email 质量变了）
5. `shipping_method` 落 NULL 但源值非空的订单数，期望 **29,143 行**，且原值必须全部落在 §10.2 那 7 个值之内 —— 出现第 8 个值说明最终备份里冒出了新的运送方式，需要先决定它进 enum 还是进 legacy 列
6. **trigger 在迁移期间确实处于禁用状态的验证**：`order_items` 中 `is_auto_generated = true` 的行数，期望 **0**
7. 四张表逐字段与源表对拍，期望 0 行差异
8. 关键总量：订单数、交易行数、明细行数、`sum(order_total)`

---

## 9. 上线切换 Runbook

前提：Laravel 停用 → 最终生产备份导入 `go2_*` 临时表。

1. **暂停新系统写入**（尤其库存与订单）。
2. 按顺序重跑 **001 → 002 → 003 → 004**。001 必须重跑：§2.7 已发现 1 行漂移，且 004 的 `product_id` 与 `sku_snapshot` 映射依赖 `public.products` 是最新的。
3. **`003` 的既有警告依然有效**：它会用 Laravel 旧值覆盖 `inventory_levels.qty`，抹掉新系统已记录的真实出入库。执行前确认库存写入已暂停（见 `docs/inventory-migration.md` §8.2）。
4. **确认 004 的 trigger 禁用/启用两句都执行到了**（§5.6）。
5. 跑完 §8 全部诊断，逐条比对期望值。
6. 恢复写入。
7. 无误后清理 `go2_*` 临时表，001–004 归档退休（规则 15）。

---

## 10. `shipping_method` 映射（已定稿）

最终 enum 共 **34 个值**（定义见 §4.1）。历史 25 个源值的处置：

| 类别 | 订单数 | 占比 |
|---|---|---|
| **落进新 enum** | **173,797** | **85.5%** |
| 仅存 `legacy_shipping_method`（已停用承运商） | 29,143 | 14.3% |
| 空值 / 空串 → 两列均 NULL | 375 | 0.2% |
| 合计 | 203,315 | 100% |

### 10.1 映射表（16 个源值 → enum）

| 源值 | 行数 | → enum | 依据 |
|---|---|---|---|
| `Letter` | **134,391** | `Letter` | 决策 11：enum 追加此值 |
| `eParcel Regular` | 15,919 | `Eparcel_Regular` | 直接对应 |
| `eParcel 500g` | 9,325 | `Eparcel_Regular` | 决策 14；新 enum 无重量档，500g 信息丢失 |
| `Registered Letter` | 4,249 | `Register_Letter` | 直接对应 |
| `Click&Send` | 3,416 | `Click_and_Collect` | 决策 13：用户确认二者在本业务中是同一件事 |
| `Parcel Post` | 2,298 | `Parcel_Post` | 直接对应 |
| `Mypost S-Box` | 1,796 | `Mypost_Reg_S_Box` | 决策 15：无档位信息，归 Regular |
| `Store Delivery` | 1,258 | `Store_Delivery` | 直接对应 |
| `eParcel Express` | 431 | `Eparcel_Express` | 直接对应 |
| `Mypost M-Box` | 296 | `Mypost_Reg_M_Box` | 决策 15 |
| `Express Post` | 259 | `Express_Post` | 直接对应 |
| `Mypost Express` | 145 | `Mypost_Express` | 直接对应 |
| `MyExpress S-Box` | 7 | `Mypost_Exp_S_Box` | MyExpress = Express 档 |
| `Mypost L-Box` | 3 | `Mypost_Reg_L_Box` | 决策 15 |
| `Register Letter` | 2 | `Register_Letter` | typo 修正 |
| `MyExpress M-Box` | 2 | `Mypost_Exp_M_Box` | MyExpress = Express 档 |

> 两处**有意的信息损失**，记录在此以免日后被当成 bug：
> - `eParcel 500g` 的重量档并入 `Eparcel_Regular`，9,325 行订单之后无法区分是否 500g 档；
> - `Mypost S/M/L-Box` 一律归 Regular 档，若其中混有 Express 档的实际发货，2,095 行会被记成 Regular。
>
> 两者都不影响已发生的事实（运费已付、包裹已到），只影响回溯统计的精度。

### 10.2 不进 enum 的 7 个源值（29,143 行）

按决策 12，这些承运商业务上已停用，新系统不再提供选项。历史原值存入 `legacy_shipping_method`：

| 源值 | 行数 |
|---|---|
| `Zone6 Regular` | 14,893 |
| `Sendle` | 10,783 |
| `Winit` | 2,080 |
| `Fast Track` | 1,085 |
| `Zone6 Express` | 260 |
| `Toll B2C` | 41 |
| `Sendle 250g` | 1 |

### 10.3 双列落地

```sql
shipping_method        public.shipping_method,  -- 新体系；新订单在此选值
legacy_shipping_method text                     -- 已停用承运商的历史原值；新系统不写
```

- 173,797 行 → `shipping_method` 填映射值，`legacy_shipping_method` 留空
- 29,143 行 → `shipping_method` 为 NULL，`legacy_shipping_method` 存原值
- UI 显示：`COALESCE(shipping_method::text, legacy_shipping_method)`

> **这一列是我替你做的决定**：你说这 7 个承运商「没有用了」，指的是新系统不再提供选项；但没说历史订单的运送方式可以丢。保留一个 text 列的成本接近零，丢失则不可逆，所以按保留处理。**如果你确实要连历史一起丢掉，说一声，删掉这一列即可**，那 29,143 行的运送方式将变为空白。

---

## 11. 风险提示

| 风险 | 影响 | 缓解 |
|---|---|---|
| **004 漏禁用 trigger** | 历史明细被今天的 BOM 静默改写，28,893 行拣货库位丢失，且**不报错** | §5.6 写进脚本注释；§8 诊断 6 专项验证 |
| 最终备份出现第 8 个已停用运送方式 | 该值静默落进 legacy 列，UI 上表现为「运送方式是个没人认识的字符串」 | §8 诊断 5 校验原值白名单 |
| enum 加值成本 | 新承运商上线要走一次迁移文件（`ALTER TYPE … ADD VALUE`），且同事务内加完不能立即使用 | 选定 enum 即接受；§4.1 已注明 |
| 90 万行搬运在 pooler 上超时 | 中断留下引用不完整的中间态 | 按表分事务；实测耗时；必要时按 id 区间分批 |
| trigger 被订单编辑误触发 | 人工调整过的明细被冲掉 | §5.4 三层收敛（限列 + `IS DISTINCT FROM`）；`is_auto_generated` 标记可追溯 |
| `customers` 去重键依赖 `buyer_userid` 质量 | 最终备份中 userid 缺失率上升会让客户数异常膨胀 | §8 诊断 4 监控归并比 |
| `total_sale` 删除后列表页聚合 | 20 万行订单列表若直接 JOIN 视图会全表聚合 | §4.6 已注明：先分页再聚合 |
| `orders.logs` 丢弃不可逆 | 历史操作审计痕迹永久丢失 | 临时表删除前 `go2_orders` 仍持有原文；如需保底可先导出冷备 |
| 004 依赖 001 的执行结果 | 001 未重跑会导致 `product_id` 大面积落空 | §9 Runbook 强制 001→004 顺序 |

---

## 12. 执行记录（2026-08-02）

### 12.1 迁移推送

7 个迁移全部应用到远端库 `nszriuqpumbyigxwtccs`（`supabase db push --db-url`）。验证：4 张表 + `order_totals` 视图创建成功、RLS 全部启用、3 个枚举标签数正确（4 / 4 / **34**）、2 个 rebuild trigger + 3 个函数就位。

### 12.2 trigger 端到端实测（推送后、导数前）

用真实 kit `GBDL00004`（BOM 组件 `JTC00010LP`，qty=6）跑了一次带 `RAISE EXCEPTION` 自动回滚的完整测试，四项全过：

| 场景 | 结果 | 结论 |
|---|---|---|
| INSERT 交易 qty=5 | `product_id=10, qty=30, is_auto_generated=true` | 5×6=30，展开正确 |
| 改 quantity 到 2 | `qty=12`，且 `location_id=1` **被继承保留** | §5.3 库位继承生效 |
| 改 `notes_to_yourself` | 未重算，人工标记保留 | `UPDATE OF` 限列生效 |
| quantity 写成原值 2 | 未重算 | `WHEN … IS DISTINCT FROM` 生效 |

后两项是最关键的保护——缺了它们，任何一次订单编辑都会冲掉人工调整。测试数据随异常全部回滚，无残留。

### 12.3 先修 001（本轮的意外发现）

按 §9 Runbook 重跑 001 时**直接失败**：`null value in column "created_at" violates not-null constraint`。

排查发现：`go2_products` 存活的 3122 行中，**1767 行 `created_at` 为 NULL、1167 行 `updated_at` 为 NULL**，而 `public.products` 现有 3122 行的时间戳全部有值（最早 2020-03-28）。这只能说明**临时表在 001 首次执行后被重新导入过，新导入的数据丢失了时间戳**——与 §2.7 的 `product_id=3` 漂移是同一件事的两个证据。

> **这是既有缺陷，不是本轮引入的，但它意味着最终切换时 001 必然失败。**

修法：两个时间戳改为三级回退 `COALESCE(源值, 目标现有值, now())`。第二级不可省——省掉会把 1767 个商品的创建日期静默重置为迁移当天。

重跑结果：`INSERT 3122`，`product_id=3` 补回、缺失商品归零、`min(created_at)` 仍为 2020-03-28（历史时间戳未被重置），仅 `id=3` 一行落在今天（源无时间戳、目标原本无此行，符合预期）。

执行前另做了一次安全检查：`public.products` 与 `go2_products` **逐字段差异 0 行**，确认新系统里没人编辑过商品数据，全量 upsert 不会覆盖任何改动。另有 1 行反向差异 `id=3210 / BW03210SF / "Test Products"`，是 2026-07-25 在新系统手工建的测试商品，001 只 upsert 不删除，已保留。

### 12.4 004 执行结果

**耗时 50.4 秒**（§7 担心的 pooler 超时未发生，分批退路没用上）。行数与方案预测完全一致：

| 表 | 实际 | 预测 |
|---|---|---|
| `customers` | 178,024 | 178,024 ✓ |
| `orders` | 203,315 | 203,315 ✓ |
| `order_transactions` | 250,413 | 250,413 ✓ |
| `order_items` | 250,687 | 250,687 ✓ |

### 12.5 诊断结果

| # | 检查 | 结果 | 判定 |
|---|---|---|---|
| 1 | 守卫跳过的行 | 0 / 0 | ✓ |
| 2 | `product_id` 落空 | **313 行 / 14 SKU / 331 件** | ✓ 比原survey少 21 行 1 SKU——`id=3` 经 001 重跑已解析 |
| 3 | 库位解析失败 | 0 | ✓ 28,893 行全部解析成外键 |
| 4 | 客户归并比 | 196,085 → 178,024（0.9079） | ✓ |
| 5 | 落 legacy 列的运送方式 | 7 个值、29,143 行 | ✓ 白名单内，无第 8 个值 |
| 6 | **trigger 生成行数** | **0** | ✓✓ 历史明细未被改写，库位未丢 |
| 7 | 逐字段对拍 | 见 §12.6 | 文本/整数/枚举列全 0 |
| 8 | 总量 | 见 §12.4 | ✓ |

`shipping_method` 落地分布 **173,797 / 29,143 / 375**，与 §10 预测逐位吻合。

### 12.6 已知的精度截断（接受）

诊断 7 唯一的非零项，全部集中在两个金额列——源 `numeric(19,4)`，目标 `numeric(12,2)`，第 3、4 位小数被舍入到分：

| 列 | 受影响行 | 最大漂移 | 总漂移 |
|---|---|---|---|
| `orders.transit_cover` | 3,502 | 0.0050 | 8.9031 |
| `order_transactions.sale_price` | 1（`9.8176 → 9.82`） | 0.0024 | 0.0024 |

**全库财务口径对账**：源 `3,209,059.8952` → 新库 `3,209,059.90`，320 万澳元营业额上差 **0.005 元**。

判定为可接受：澳元最小单位是分，这些亚分位是 Laravel 算运费保价的中间精度，不是任何人被收过的钱。诊断注释已写明——若将来某次重跑漂移显著变大，说明源数据开始携带真实的亚分精度，届时需要重新审视列类型。

### 12.7 兜底时间戳被用到 1 次

`created_at` 的最后一级兜底 `2018-01-01` 原注释写的是"不可达"，**实测被 1 行用到**：订单 `18639`（invoice `180048CF`）是一张 CANCELLED 的 eBay 空订单，既无 `created_at`、又无 `posted_on_date`、也没有任何交易行，全库没有任何东西能给它定日期。该值是与其发票号一致的猜测，不是真实时间戳。脚本注释已修正。

---

## 13. 第四轮评审改动（2026-08-02，迁移 `20260803170000`）

用户检查落地后的字段列表，提出五项改动。全部已实施并推送。

### 13.1 决策

| # | 决策 | 影响 |
|---|---|---|
| 16 | **收件地址从 `orders` 移到 `customers`** | `orders` 删 11 个 `ship_to_*` 列；`customers` 加 9 个地址列。**代价见 §13.3** |
| 17 | `orders.transit_cover`、`orders.parcel_zone` 删除 | — |
| 18 | **运费从交易行上移到订单**：`order_transactions.postage_and_handling` → `orders.postage_and_handling`（按订单 `SUM`） | 一个订单多条交易行时运费合并 |
| 19 | `order_transactions` 删除 `paypal_transaction_id_number`、`notes_to_yourself` | 后者 224,548 行非空中有 224,347 行是空串，实际有内容仅 201 行 |
| 20 | `order_totals` 删除 `postage_total` | 运费已是 `orders` 上的普通列，视图再聚合等于把一行读回来；`order_total` 改为 `goods_total + orders.postage_and_handling` |

### 13.2 最终表结构

**`customers`**（178,024 行）
`id` · `platform_user_id`(UNIQUE) · `full_name` · `email` · `phone` · `is_anonymised_email` · **`company_name` · `address_line1~4` · `city` · `state` · `postcode` · `country`** · `created_at` · `updated_at`

**`orders`**（203,315 行）
`id` · `customer_id`(FK RESTRICT) · `invoice_number`(UNIQUE) · `status` · `platform` · `shipping_method` · `legacy_shipping_method` · **`postage_and_handling`** · `tracking_number` · `web_order_id` · `comments` · `posted_on_date` · `created_at` · `updated_at`

**`order_transactions`**（250,413 行）
`id` · `order_id`(FK CASCADE) · `item_title` · `item_number` · `custom_label` · `quantity` · `sale_price` · `sale_date` · `paid_on_date` · `postage_service` · `sales_record_number` · `order_id_ebay` · `transaction_id_ebay` · `click_and_collect_reference` · `private_field` · `created_at` · `updated_at`

**`order_items`**（250,687 行，未改动）
`id` · `transaction_id`(FK CASCADE) · `product_id`(FK SET NULL) · `sku_snapshot` · `quantity` · `location_id`(FK SET NULL) · `is_auto_generated` · `created_at` · `updated_at`

**`order_totals`**（视图）
`order_id` · `goods_total` · `order_total` · `transaction_count`

### 13.3 地址上移的代价（已明确接受）

实测 **8,150 张订单（4%，涉及 5,483 个客户）的实际收件地址与该客户的最新地址不同** —— 这些人换过收件地址。地址只存 `customers` 后，这些历史订单会渲染成客户**现在**的地址，当年真正寄到哪已无处可查。其余 96% 的订单无差别。

这一点在决策前已用数据说明，由用户明确选择「只放 customers」。

### 13.4 回填过程中的一个坑

迁移 `20260803170000` 的地址回填是**从 `orders` 取**（每个客户最近一张订单的 `ship_to_*`），这样迁移在临时表删除后仍可重放。但由此产生缺口：**1,790 个客户没有任何订单**（`go2_buyers` 有 196,085 行，只有 193,517 个被订单引用），他们在 `go2_buyers` 里有地址却回填不到。

修复：`004` 脚本改为**直接从 `go2_buyers` 取地址**（组内 id 最大的那行），重跑 `customers` 段后 178,024 个客户全部有地址。

> 教训：迁移文件里的回填求"可重放"而牺牲了数据源的完整性，数据脚本才是权威。两者数据源不一致时，以 `004` 为准。

### 13.5 验证结果

| 检查 | 结果 |
|---|---|
| `customers` 地址填充 | **178,024 / 178,024**（修复后无缺口） |
| `orders.postage_and_handling` 合计 | **184,775.05**，与源 `go2_transactions` 的 `184,775.0500` 完全一致 |
| `order_totals` | `goods 3,024,284.85 + postage 184,775.05 = order_total 3,209,059.90`，与改造前口径一致 |
| `order_items.is_auto_generated = true` | **0**（trigger 全程未介入历史数据） |
| 四表行数 | 178,024 / 203,315 / 250,413 / 250,687，均未变 |
| `004` 脚本 | 4 条 INSERT 全部通过 `EXPLAIN` 规划（列名、类型、CTE、`ON CONFLICT` 目标均正确） |
| `tsc --noEmit` | 通过 |

> `004` 的验证用的是 `EXPLAIN` 而非完整执行——它校验语法与列引用，**不覆盖** CHECK / FK 这类运行时约束。最终切换重跑时仍需按 §8 跑完整诊断。

### 13.6 顺带修掉的一个隐患

`004` 中有一行行内注释写着 `-- no tier recorded; Regular assumed`，**注释里的分号**会让任何按分号拆语句的工具在此截断 SQL。已改成逗号。其余三个迁移脚本自查无同类问题。

---

## 14. 迁移执行器 `scripts/migration/run-all.mjs`

### 14.1 为什么需要它

前几轮都是手工逐条跑 SQL，最终切换当天不可能这么干。实际障碍有三个：

1. **`supabase db query` 不接受多语句文件** —— 报 `cannot insert multiple commands into a prepared statement`；而按分号拆开执行会**破坏事务边界**，`004` 第 3 段的 `DISABLE TRIGGER` 与 INSERT 必须同事务，拆开就等于放任 trigger 改写历史。
2. **本机没有 psql**，也没有 Docker。
3. **服务端 `statement_timeout = 2 分钟`**。首次导入 50 秒过关，但最终切换是**全量 upsert 重跑**，实测 **132 秒被杀**。`004` 的四个事务块已各自加上 `SET LOCAL statement_timeout = 0`。

### 14.2 用法

```bash
node scripts/migration/run-all.mjs --dry-run        # 只列出将执行的步骤
node scripts/migration/run-all.mjs --checks-only    # 只跑验证，不导数
node scripts/migration/run-all.mjs                  # 001 → 002 → 004（003 被拦）
node scripts/migration/run-all.mjs --i-have-suspended-inventory-writes   # 含 003
```

按 001 → 002 → 003 → 004 顺序执行，每步报耗时与写入行数，**任一步抛错立即中止**；执行前需要输入 `yes` 确认。依赖 `pg`（已加入 `devDependencies`）。

`DATABASE_URL` 按 CLAUDE.md 规则 16 **字面读取**，不经 shell 或 dotenv 展开——密码含 `$`，展开会静默吃掉几个字符，伪装成密码错误。

### 14.3 003 的闸门

`003` 默认**被拦住不跑**，必须显式加 `--i-have-suspended-inventory-writes`。原因是它每次执行都用 Laravel 旧值覆盖 `inventory_levels.qty`，新系统开始真实出入库后再跑会静默抹掉这些操作。这个判断不该自动化——所以做成必须由人主动声明的 flag，而不是一个可以顺手回车过去的提示。

### 14.4 验证项

**硬断言**（不通过则退出码 1）：

| 检查 | 期望 |
|---|---|
| **TRIGGER CHECK：`order_items.is_auto_generated` 为 true 的行数** | **0** —— 非 0 意味着 004 运行时 trigger 是活的，历史明细已被今天的 BOM 改写、拣货库位全丢，**不可原地修复** |
| 守卫跳过的源行 | 0 / 0 |
| 拣货库位解析失败 | 0 |
| 落进 `legacy_shipping_method` 的值 | 只能是那 7 个已停用承运商；出现第 8 个说明最终备份引入了没人决定过的运送方式 |
| `orders` / `order_transactions` / `order_items` 逐字段对拍 | 0 |
| `customers` 地址 = 组内最新 `go2_buyers` 行 | 0 |
| `orders.postage_and_handling` = 源行合计 | 0 |

**信息项**（打印供人判断，不断言）——因为正确值取决于最终备份的内容：未解析商品的行数/SKU 数（2026-08-02 为 313/14）、客户归并比（0.9079）、四表总量与营业额。

### 14.5 一个踩过的性能坑

`postage` 对拍最初写成相关子查询（每个订单一次 `SELECT sum(...) FROM go2_transactions WHERE order_id = n.id`），**跑了 5 分钟没结束**。原因是 `go2_*` 临时表**没有任何索引**，203,315 次子查询各自全表扫 250,413 行。改成先 `GROUP BY` 聚合一次再 `LEFT JOIN` 后瞬间完成。

> 写任何针对 `go2_*` 的校验查询都要记住这一点：那些表连主键索引都没有，相关子查询在它们上面等同于笛卡尔积。

### 14.6 当前状态

`--checks-only` 实测 **9 项硬断言全部 PASS**，3 项信息项数值与 §12/§13 记录一致。

---

## 15. `order_status` 补齐到 10 个值（2026-08-02，迁移 `20260804100000`）

### 15.1 起因：把「数据里有的」当成了「系统能选的」

迁移 `20260803100000` 从 `go2_orders.order_status` 的实测分布（COMPLETED 202,778 / CANCELLED 527 / PROCESSING 9 / ISSUED 1）推出这个枚举，注释里写的是"a closed set with no surprises"。

这句话只对了一半——它是**已被记录下来的**值的闭集，不是**可被选择的**值的闭集。用户提供的 Laravel 状态下拉实际有 10 个选项，缺的 6 个只是恰好没有任何订单在最终备份的那一刻停在那些状态上。

| | 值 |
|---|---|
| 备份里出现过 | `completed` `cancelled` `processing` `issued` |
| **本次补齐** | `new` `pending` `unpaid` `backorder` `picked` `labelled` |

**为什么不等到第一次用上再加**：`004` 的状态映射是 `lower(o.order_status)::public.order_status` —— 一个不带兜底的直接转换（这是 §7 刻意的设计，见该处注释）。枚举里没有的值不会被静默归类，而是**让整个 004 事务回滚**。等到最终生产同步那一次才发现，是这个错误代价最高的时刻。

### 15.2 声明顺序（一次性决策）

枚举的声明顺序即排序顺序，影响 `ORDER BY status` 与所有比较运算；改顺序意味着重建类型并重写 203,315 行。用户选择**按业务生命周期排**，而非照搬 Laravel 下拉原序：

```
new → pending → unpaid → backorder → processing → picked
    → labelled → issued → completed → cancelled
```

两处偏离 Laravel 原序的地方，都是有理由的：

- **`unpaid` / `backorder` 提到 `processing` 之前**——它们是订单卡住的地方，不是处理完之后的状态。
- **`labelled` 插到 `picked` 与 `issued` 之间**——先拣货、再打面单、然后发出。Laravel 下拉里它掉在 `CANCELLED` 后面，那是**后期追加的值被直接塞到列表末尾**的形状，不是它真的属于那里。

### 15.3 实现：`ADD VALUE` 而非重建类型

实测确认了两件让补值变得干净的事：

- `order_status` 全库只被 `public.orders.status` **一列**使用；
- **没有任何视图依赖它**。

配合 PG 17.6（`ALTER TYPE ... ADD VALUE` 自 PG 12 起可进事务块）与 `BEFORE` / `AFTER` 定位子句，六条 `ADD VALUE` 即可，**不需要重建类型、不需要重写 203,315 行、不需要碰历史数据**。

```sql
ALTER TYPE public.order_status ADD VALUE 'new'       BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'pending'   BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'unpaid'    BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'backorder' BEFORE 'processing';
ALTER TYPE public.order_status ADD VALUE 'picked'    AFTER  'processing';
ALTER TYPE public.order_status ADD VALUE 'labelled'  AFTER  'picked';
```

重复 `BEFORE 'processing'` 是正确的、不是复制粘贴失误：每个新标签落到 `processing` 紧前方，也就是已插入的那些之后。

### 15.3.1 预演验证（未提交）

把整个迁移放进一个事务执行、检查结果、再 `ROLLBACK`，实测顺序与设计逐位一致：

```
new -> pending -> unpaid -> backorder -> processing -> picked
    -> labelled -> issued -> completed -> cancelled
```

回滚后枚举标签数恢复为 4，库未被改动。`tsc --noEmit` 通过。

顺带记一个实现细节：`BEFORE` / `AFTER` 定位靠的是**二分 `enumsortorder`**，本次插入后的值是 `0, 0.5, 0.75, 0.875, 1, 1.5, 1.75, 2, 3, 4`。继续往同一个缝里插会一路二分下去，浮点位用尽时 Postgres 会自动给整个类型重新编号（需要一次锁，但无需人工干预）。不影响正确性，只是别指望 `enumsortorder` 是整数。

**该迁移文件只加值、不做别的**：PG 允许在事务里加枚举值，但**加进去的值在同一事务里不能被使用**（会报 `unsafe use of new value of enum type`）。所以没有 UPDATE、没有 CHECK、没有 DEFAULT。

### 15.4 `labelled` 的拼写是硬约束

`004` 用 `lower()` 直转、没有映射表，所以枚举标签必须是 Laravel 值的**精确小写**。Laravel 的值是 `LABELLED`（英式双 L），枚举里写成 `labeled` 就没有任何东西能解析它——**而这个错误只会在最终同步那一次暴露**，此前不会以任何形式报警。

已写入 CLAUDE.md 规则 15，与 `shipping_method` 的 `CASE` 映射条款并列。

### 15.5 不加 `DEFAULT`

`orders.status` 保持 NOT NULL 且无默认值。从 eBay 同步进来的订单可能一进来就是已发货的，默认成 `new` 错的次数会比省事的次数多；无默认值逼调用方明确说出它是 10 个里的哪一个。

### 15.6 `backorder` 现在同时是状态和平台

`public.order_status.backorder`（等补货）与 `public.sales_platform.backorder`（销售渠道，3,878 张历史订单）现在是两个不同枚举里的同名值。Postgres 层面互不干扰，但**界面上会出现两个都写着 Backorder 的徽章指两件事**。处理办法记在 `docs/orders-ui.md` §4.2：状态徽章文案用 `On backorder`，平台徽章保持 `Backorder`。

### 15.7 同步改动清单

| 文件 | 改动 |
|---|---|
| `supabase/migrations/20260804100000_extend_order_status_enum.sql` | 新增，六条 `ADD VALUE` |
| `scripts/migration/004_orders_data.sql` | **映射逻辑未改**（`lower()` 直转本就兼容）；更新第 2 段注释，新增诊断 9（状态分布） |
| `scripts/migration/run-all.mjs` | 新增信息项检查 `order status distribution` |
| `src/lib/supabase/database.types.ts` | `Enums.order_status` 补到 10 个值，按新顺序（规则 18） |
| `CLAUDE.md` | 规则 15 新增 `order_status` / `sales_platform` 拼写对齐条款 |
| `docs/orders-ui.md` | §4.2 状态实况、§5.2 状态筛选器重新定位 |

### 15.8 执行结果（2026-08-02）

`supabase db push --db-url` 推送成功，`supabase_migrations.schema_migrations` 最新一条为 `20260804100000_extend_order_status_enum`。

| 检查 | 结果 |
|---|---|
| 枚举标签数 | 4 → **10** |
| 声明顺序 | `new → pending → unpaid → backorder → processing → picked → labelled → issued → completed → cancelled`，与设计逐位一致 |
| 历史数据 | **未变动**（completed 202,778 / cancelled 527 / processing 9 / issued 1） |
| 新标签可用性 | `'labelled'::order_status` 等转换全部通过（事务已提交，不再受"同事务内不可用"限制） |
| **`004` 映射全量对拍** | Laravel 下拉 10 个值逐个跑 `lower(src)::public.order_status`，**10/10 全部解析成功** |
| `run-all.mjs --checks-only` | 9 项硬断言 PASS，4 项信息项正常；新增的 `order status distribution` 输出 `completed 202778, cancelled 527, processing 9, issued 1` |
| `tsc --noEmit` | 通过 |

倒数第三行是本次最有价值的一项验证：`LABELLED` 的英式拼写风险（§15.4）不是靠读代码确认的，而是把 10 个 Laravel 原值真的过了一遍 `004` 所用的那条转换表达式。

> 顺带修掉一个 `run-all.mjs` 的既有限制：`runChecks` 只打印 `rows[0]`，此前所有检查都只返回一行所以没暴露。新增的状态分布若写成 `GROUP BY`，只会显示最大的那一个状态、读起来像"只有 completed"。已改为 `string_agg` 聚合成单行。
