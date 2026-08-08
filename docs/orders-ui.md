# Orders / Customers UI 轮次 — 开发文档

> 状态：**已确认，实施中**（2026-08-08）—— 四项原决策 + 五项实施决策已定案，实测数据见 §3.4
> 修订：2026-08-08（远端实测一轮，推翻 §3.1 / §5.3 / §11.2 三处判断，新增阻塞项处置，见 §3.4 与 §4.3）
> 前置文档：`docs/orders-domain-migration.md`（迁移层已完成并验证，四表已落库）
> 参考前轮：`docs/inventory-ui.md`（列表页 + 行展开 + Dialog 的既有骨架，本轮大量复用）
> 相关规则：CLAUDE.md 规则 2（RESTful 路由）、6（双重校验）、7（ActionResult + sonner）、9（全局 useConfirm）、12（Dialog 视口安全）、18（types 手工维护）

## 1. 目标

在已迁移的 orders 域四表之上落地三处 UI：

1. `/orders` 订单列表页
2. `/orders/[id]` 订单详情页（独立路由，非弹窗）
3. `/customers` 客户 CRUD 与 `/customers/[id]` 客户详情（含订单历史）

侧边栏的 `Orders` 与 `Customers` 两个入口**已存在**，目前指向 `PlaceholderPage`（[orders/page.tsx](src/app/(dashboard)/orders/page.tsx)、[customers/page.tsx](src/app/(dashboard)/customers/page.tsx)），本轮替换掉它们。

## 2. 数据现状（迁移后实测，全部来自 `docs/orders-domain-migration.md` §12–13）

| 表 | 行数 | 说明 |
|---|---|---|
| `customers` | **178,024** | 由 196,085 行 `go2_buyers` 按 eBay 用户名/邮箱去重而来；全部有地址 |
| `orders` | **203,315** | 发票号全局唯一，是主要检索入口 |
| `order_transactions` | **250,413** | 平台卖出的**listing**（标题、listing id、售价） |
| `order_items` | **250,687** | 仓库实际拣的**内部 SKU**，由 trigger 维护 |
| ~~`order_totals`（视图）~~ | — | 已于 `20260808180000` **删除**，由 `order_metrics_summary` 取代，见 `docs/order-metrics.md` |

分布上几个对 UI 设计有直接影响的事实：

- **状态极度倾斜**：completed 202,778 / cancelled 527 / processing 9 / issued 1。但枚举本身有 **8 个值**（迁移 `20260804100000` 补齐了 Laravel 下拉的全部选项，`20260808120000` / `20260808130000` 又删掉了不用的 `new` 与 `picked`），另外 4 个当前为 0 只是因为备份那一刻没订单停在上面。详见 §4.2——这条直接决定了 §5.2 的状态入口怎么做。
- **平台**：ebay 178,244 / shopify 20,624 / backorder 3,878 / store 569。
- **运送方式**：173,797 张落在新枚举（34 个值）、**29,143 张（14.3%）落在 `legacy_shipping_method` 文本列**（7 个已停用承运商）、375 张为空。
- **4,919 张订单 `posted_on_date` 为空**（未发货）。
- **25 张订单没有任何交易行**（`order_metrics_summary` 对它们返回 0）。
- **313 行 `order_items.product_id` 为空**（14 个 SKU、331 件）——`custom_label` 匹配不到任何商品，是需要人工修的工作队列，DB 里已有专门的部分索引 `order_items_unresolved_idx` 支撑它。
- **`sale_price` 可以是负数**（退款/冲正行，最低 -640.00）。金额展示不能假设非负。

## 3. 本轮与前几轮的根本差异：数据规模

products 3,122 行、inventory 2,098 行的写法**不能原样平移到 203,315 行**。三个具体问题：

### 3.1 分页计数

`fetchProductList` / `fetchInventoryList` 用的是 PostgREST 默认的 `count: "exact"`——每次列表请求附带一次完整 `COUNT(*)`。在 3,122 行上无感，在 203,315 行上、再叠加 `ilike` 筛选，就是每翻一页做一次全表扫。

可选：`count: "estimated"`（先取 planner 估算，估算值小于阈值时才退回精确计数）、`count: "planned"`（永远只用估算）、或干脆不显示总数改用游标式翻页。**已定为估算计数**，见 §4 决策 2。

> **2026-08-08 实测修正**：估算计数读的是 `pg_class.reltuples`，而迁移后它一直是陈旧的（orders 记着 246,475，真实 203,315，高 21%）。跑一次 `ANALYZE` 后回到精确值。**因此索引迁移末尾必须带 `ANALYZE`**，见 §8.1。同时实测发现深翻页并不需要游标分页，见 §3.4。

### 3.2 模糊搜索没有可用索引

现有索引全是普通 btree：

| 列 | 现有索引 | `ilike '%x%'` 能用吗 |
|---|---|---|
| `orders.invoice_number` | UNIQUE btree | ❌（等值查询可以） |
| `orders.tracking_number` | btree | ❌ |
| `customers.full_name` | btree | ❌ |
| `customers.email` | btree on `lower(email)` | ❌（`lower()` 等值可以） |
| `order_transactions.custom_label` | btree | ❌ |

非 C collation 下，普通 btree 连 `LIKE 'x%'` 前缀匹配都用不上。要让搜索框可用，需要**新增一个迁移启用 `pg_trgm` 并建 GIN 索引**。这是本轮唯一必需的 schema 改动，见 §8.1。

不加索引的后果不是"慢一点"：178k 行 + 203k 行上的 `ilike '%x%'` 是每次按键都触发一次双表全扫。

### 3.3 `order_totals` 不能 join 进列表查询

> **⚠️ 本节已被 2026-08-08 的订单指标轮次取代。** `order_totals` 视图已删除，`public.order_metrics_summary`（trigger 维护的表，每订单一行）取而代之，**可以**直接 join 进分页查询——这正是把它物化的目的。`fetchOrderList` 现在用一个内嵌读它，不再发第二条查询。
>
> 唯一没变的结论是「列表页不能按金额排序」，但换了理由：不再是聚合代价，而是 **PostgREST 无法按内嵌资源的列给父行排序**。2026-08-08 与业务方确认**不需要该功能**，此事已关闭，详见 `docs/order-metrics.md` §9。
>
> 以下保留原文，记录当时的判断依据。

这条是迁移文件 `20260803160000_create_order_totals_view.sql` 尾部**写死的告诫**：该视图每被引用一次就聚合全部 250,413 行交易，`JOIN` 进分页查询等于"算 203,315 个总额来显示 20 个"。

正确写法是**先分页、再按当页 id 取总额**：

```ts
const { data: rows } = await supabase.from("orders").select(LIST_COLUMNS).range(...)
const { data: totals } = await supabase
  .from("order_totals")
  .select("order_id, goods_total, order_total, transaction_count")
  .in("order_id", rows.map((r) => r.id))
```

**直接后果：列表页不能按金额排序，也不能按金额筛选。** 那需要物化视图或 trigger 维护的存储列，按迁移注释的说法"要做时再决定，现在不要预建"。本轮不做，UI 上也不提供这两个入口。

### 3.4 远端实测（2026-08-08，编码前）

编码前对远端库跑了一轮只读探测，三项结果推翻了本文原有判断，一项确认了阻塞。

**其一，PostgREST 顶层聚合被禁用。** `GET /rest/v1/orders?select=status,count()` 返回：

```
HTTP 400  {"code":"PGRST123","message":"Use of aggregate functions is not allowed"}
```

`db-aggregates-enabled` 是关着的，所以 §5.2 写的"一次 `GROUP BY status` 聚合查询"**发不出去**。注意这与 `/locations` 页在用的 `inventory_levels(count)`（[queries/locations.ts:32](src/lib/queries/locations.ts#L32)）不是同一个特性——那是内嵌资源计数，不受此开关影响，§7.1 的 `orders(count)` 因此仍然可行。处置见 §4.3 决策 A。

**其二，`authenticated` 角色的 `statement_timeout` 是 8 秒**（`anon` 是 3 秒）。这是每个页面查询的真实预算。规则 15 记的"远端 2 分钟"只适用于迁移路径（`postgres` 角色），不要拿它当页面查询的余量。

**其三，统计信息陈旧曾让两个关键查询慢到不可用，`ANALYZE` 后各快两个数量级。** 同一台库、同样的查询：

| 查询 | ANALYZE 前 | ANALYZE 后 |
|---|---|---|
| `pg_class.reltuples`（估算计数的数据源） | orders = 246,475（真实 203,315） | 203,315 精确 |
| `/orders` 第 1 页 | 6 ms | — |
| `/orders` 第 5,000 页（`OFFSET 100000`） | **3,220 ms** | **60 ms** |
| SKU 两跳反查，最热 SKU（`product_id = 11`，7,100 张订单） | **7,385 ms**（逼近 8 秒超时） | **19 ms** |

根因是 planner 把 `order_items_product_id_idx` 的命中行数估低了 50 倍（估 140、实际 7,134），于是选了 nested loop 逐行回查 `order_transactions`。`ANALYZE` 之后同一个查询走 Nested Loop Semi Join，390 倍提速。

**由此产生的三处设计修正：**

1. **§11.2「深翻页超过 1 秒需改游标分页」不再成立**——60 ms。OFFSET 分页保留，省掉整套游标实现（§4.3 决策 C）。
2. **§5.3 的 SKU 两跳"唯一需要实测计划"一项通过**——`!inner` 嵌套过滤按原方案走，不需要 RPC。
3. **`ANALYZE` 必须进迁移**（§8.1 末尾），否则估算计数会显示"约 246,000"这样一个凭空高出 21% 的数。

**其四，`pg_trgm` 确认未安装**（远端 extension 列表只有 `moddatetime` / `pg_stat_statements` / `pgcrypto` / `plpgsql` / `uuid-ossp` / `supabase_vault`），§8.1 的迁移是必需的。`shipping_method` 枚举实测 34 个值，与 §5.4 的数字一致。

## 4. 已确认决策（2026-08-02）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 本轮功能边界 | 基线（订单列表 + 订单详情 + 客户 CRUD）**加**：订单字段编辑、`/customers/[id]` 客户详情页 + 订单历史。**不做**：未解析明细修复队列、发货扣库存联动（均移入 §13 下一轮） |
| 2 | 分页计数 | **估算计数**（`count: "estimated"`）。无筛选时显示"约 203,000"，加筛选把结果缩小后自动变精确 |
| 3 | 搜索维度 | 发票号 + 追踪号；客户名 / 邮箱 / eBay 用户名；**按 SKU 反查订单**；**客户 postcode 与 suburb**；订单 status |
| 4 | 详情页结构 | **交易行表格 + 行内展开拣货明细**，默认收起 |

### 4.1 关于决策 3 的两点澄清

**"suburb" 在库里叫 `city`。** `customers` 表没有 `suburb` 列——第四轮把地址从 `orders` 上移时用的是通用命名（`city` / `state` / `postcode` / `country`），澳洲语境的 suburb 就存在 `city` 里。本轮的处理是**只改 UI 标签不改列名**：界面上写 `Suburb`，查询读 `customers.city`。

改列名不划算：`scripts/migration/004_orders_data.sql` 与迁移 `20260803170000` 都写着 `city`，按规则 15 得同步改，而收益只是一个词。但**这个错位必须写在查询层的注释里**，否则下一个人会去找不存在的 `suburb` 列。

另外注意这批地址是**原样迁移、未做规范化**的（迁移文档 §4.3）：state 列里 `NSW` 和 `New South Wales` 并存，country 里 `AU` 和 `Australia` 并存。suburb 同理会有大小写和拼写差异，所以 suburb 搜索必须是**大小写不敏感的模糊匹配**，不能做等值。

**status 是筛选器不是搜索框。** 订单状态是一个封闭枚举，做成下拉 Select（§5.2）比让人往搜索框里打字合适。实况见 §4.2。

### 4.2 `order_status` 实况（2026-08-02 实测 + 枚举扩展）

**类型**：Postgres 原生枚举 `public.order_status`，`orders.status` 列 `NOT NULL`、**无默认值**。TS 侧用 `Database["public"]["Enums"]["order_status"]`，`z.enum` 直接对齐。

**8 个值，声明顺序即业务生命周期**（迁移 `20260804100000` 在原有 4 个基础上补齐了 Laravel 下拉的全部选项，详见 `docs/orders-domain-migration.md` §15；`20260808120000` 删掉了 `new`，`20260808130000` 删掉了 `picked`）：

| pos | label | 语义 | 当前订单数 |
|---|---|---|---|
| 1 | `pending` | 待处理 | 0 |
| 2 | `unpaid` | 未付款（阻塞） | 0 |
| 3 | `backorder` | 缺货待补（阻塞） | 0 |
| 4 | `processing` | 处理中 | 9 |
| 5 | `labelled` | 已打面单 | 0 |
| 6 | `issued` | 已发出 | 1 |
| 7 | `completed` | 已完成 | **202,778** |
| 8 | `cancelled` | 已取消 | 527 |

那 4 个 0 不代表用不上——它们是 Laravel 一直提供的选项，只是最终备份的那一刻没有订单停在上面。**上线后新订单会真正铺开在这 8 个状态上**，这也是 §5.2 把状态筛选器从配角改成主角的原因。

> **2026-08-08 删除 `new`（用户决定）**：迁移 `20260808120000` 换类型重建了 `public.order_status`。原本 `new` 是随 Laravel 下拉一并补进来的，业务上不存在"刚进来"这个态。三项前置核对：0 行在用；最终备份只产出 `COMPLETED`/`CANCELLED`/`PROCESSING`/`ISSUED`，故 `004` 的 `lower(源值)::enum` 不受影响；全库只有 `orders.status` 与 `order_status_counts` 视图引用该类型，无默认值、无函数、无策略谓词涉及。**Postgres 没有 `DROP VALUE`**，所以该迁移是"重命名旧类型 → 建新类型 → `ALTER COLUMN ... USING status::text::新类型` → 丢弃旧类型"，会全表重写 203,315 行并持 ACCESS EXCLUSIVE 锁——**执行时不能有订单写入**，且结尾必须重跑 `ANALYZE`（重写会作废 `20260808100000` 精心刷新的统计信息）。

> **2026-08-08 删除 `picked`（用户决定）**：迁移 `20260808130000`，做法与上面删 `new` 完全一致（换类型重建 + `USING status::text::新类型` + `ANALYZE`，全表重写 203,315 行、持 ACCESS EXCLUSIVE 锁，执行时不能有订单写入）。业务上订单从 `processing` 直接进 `labelled`，"拣了什么"记在 `order_items` 的拣货库位上，不是订单的一个状态。前置核对同样三项：0 行在用；`go2_orders.order_status` 只有 `COMPLETED`/`CANCELLED`/`PROCESSING`/`ISSUED`，`004` 不受影响；引用该类型的只有 `orders.status`、`orders_status_idx` 与 `order_status_counts` 视图。

枚举遍历顺序就是生命周期顺序，所以下拉菜单直接按 `Database["public"]["Enums"]["order_status"]` 的声明序渲染即可，不要另建一套排序常量（两份顺序必然漂移）。

### 4.2.1 三个实测发现，每个都影响界面

**其一，`completed` ≠ 已发货，而且是持续性的**：

| status | 有 `posted_on_date` | 无 `posted_on_date` |
|---|---|---|
| completed | 198,281 | **4,497** |
| cancelled | **113** | 414 |
| processing | 1 | 8 |
| issued | 1 | 0 |

4,497 张已完成但从未发货，逐年都在发生（2020: 279、2022: 909、2025: 729、2026: 590），不是当年导入的历史残渣；反过来 113 张已取消的订单确实发出去了。**status 与发货状态是两个独立事实**，状态徽章不能代替发货状态——§5.2 的 `Not dispatched` 独立开关因此是必需的，而不是"筛 processing 就行"。

**其二，那 9 张 `processing` 是 Laravel 停机时卡在手上的在途单**：全部创建于 2026-07-11 ~ 07-13，而全库最后一张订单就是 2026-07-13，其中 8 张连追踪号都还没有。上线后运营要做的第一件事就是把它们推下去——这也是"订单字段编辑"（决策 1）的第一个真实用例。

**其三，`issued` 全库只有 1 行**（2025-06-14，已发货且有追踪号），看着像一次误操作。下拉里保留它（枚举删值代价极高，且那一行还在），但不要把它做进任何默认流程或快捷按钮。

### 4.2.2 `backorder` 在两个枚举里都有

`order_status.backorder`（等补货）与 `sales_platform.backorder`（销售渠道，3,878 张历史订单）现在同名。DB 层互不干扰，但界面上会出现两个都写着 Backorder 的徽章指两件事。

**处理**：状态徽章文案写 `On backorder`，平台徽章保持 `Backorder`。两者视觉样式也要分开（状态徽章是阻塞态的琥珀色，平台徽章是中性色）。

### 4.2.3 `updated_at` 目前不携带业务含义

`orders.updated_at` 全部 203,315 行都落在 2026-08-02 那一个半小时内（迁移执行时刻，distinct 天数 = 1）。详情页**不要显示 "Last updated"**——那会让人以为这批订单昨天被人动过。等真有编辑发生后它才开始有意义。

### 4.3 实施决策（2026-08-08，基于 §3.4 实测，取向为最低风险）

| # | 决策点 | 结论 | 为什么这是风险最低的一条 |
|---|---|---|---|
| A | 状态 tab 的计数怎么发 | 新建 `public.order_status_counts` 视图，随 §8.1 的迁移一起建 | 另一条路是打开 PostgREST 的 `db-aggregates-enabled`——那是项目级配置，会让**所有**表都能被匿名发起聚合查询，为一个计数改全局开关不划算。视图只读、无需 `EXECUTE` 授权、不依赖该开关，且按既有 `order_totals` 的写法带 `security_invoker` 后 RLS 照旧生效 |
| B | 保存新运送方式时 `legacy_shipping_method` 怎么处理 | **保留原值**，仅不再作为显示源（`COALESCE` 优先取 `shipping_method`） | 清空是不可逆的，会抹掉 29,143 张订单当年的真实承运商。保留只是多一列冗余数据，代价是零 |
| C | 分页方式 | 保留 OFFSET，不实现游标分页；**不提供"跳到最后一页"** | §3.4 实测第 5,000 页 60 ms。游标分页要重写筛选与 URL 状态，为一个不存在的问题引入的改动面反而更大 |
| D | 未解析明细的可见性 | 除 §6.5 的展开区高亮外，**父交易行上也带 `Unresolved` 徽章** | §6.1 默认全部收起，只在展开区标记等于这 313 行在详情页永远看不见。父行标记是纯展示改动 |
| E | 本轮边界 | 严格执行决策 1：不做修复队列、不做发货扣库存、不做金额排序 | 三项都涉及写库存或写历史明细，是本域风险最高的部分，留给下一轮单独验证 |

## 5. `/orders` 订单列表页

沿用 `/inventory` 的骨架（Server Component 页面 + 客户端筛选栏 + 分页 + 行展开），三个组件近乎 1:1 平移。

### 5.1 列

| 列 | 内容 | 备注 |
|---|---|---|
| （chevron） | 展开显示交易行摘要 | 同 `/inventory` 的单行展开 |
| `Invoice` | `invoice_number` | 链接到 `/orders/[id]` |
| `Date` | `created_at` | 默认排序列（DESC，有索引） |
| `Customer` | `customers.full_name`（回落 `platform_user_id`） | 内嵌 select，链到客户详情 |
| `Platform` | 徽章 | ebay / shopify / backorder / store |
| `Status` | 徽章 | 8 个值（§4.2）。completed / cancelled 用中性色，阻塞态（unpaid / backorder）琥珀色，其余流转态着色 |
| `Items` | `order_metrics_summary.transaction_count` | |
| `Weight` | `order_metrics_summary.chargeable_weight_kg` | 2026-08-08 新增。**计费重**（实重与体积重取大者），不是实重 |
| `Total` | `order_metrics_summary.order_total` | 右对齐 tabular-nums；**不可排序**（理由已变，见 §3.3 的更新说明） |
| `Shipping` | `COALESCE(shipping_method, legacy_shipping_method)` | legacy 值加一个弱化标记，见 §5.4 |
| `Dispatched` | `posted_on_date`，空显示 `—` | |
| （⋯） | `View order` / `Edit` / `Copy invoice number` | |

### 5.2 筛选与搜索

**状态：从筛选项升为页面主结构**

状态不再是"偶尔用来捞异常单"的下拉项——`pending` 待处理、`unpaid` 待催款、`backorder` 待补货、`labelled` 待发出，每一个都是一条日常工作队列。所以状态入口放在**列表顶部的一排 tab**，而不是埋进筛选栏：

```
[ All ]  [ Pending ]  [ Processing ]  [ Labelled ]  [ Needs action ]
```

> **2026-08-08 落地时收窄（用户决定）**：原计划的 8 个 tab 减为 5 个。
> - `Unpaid` / `On backorder` **并入 `Needs action`**——后者本就是 `NOT IN (completed, cancelled)`，这两个状态已经在里面，单独给 tab 等于同一批订单在一行里出现两次；
> - **不要 `Completed` / `Cancelled` tab**：99.7% 的订单落在 completed，做成 tab 是给"不需要处理的东西"占掉主导航；两者仍可从筛选栏的 8 值下拉选到；
> - **`Processing` 单独提出来**（Laravel 停机时卡住的 9 张就在这里，§4.2.1 其二）；
> - **`Needs action` 挪到最后一个**，并收窄口径（见下）。

> **2026-08-08 二次调整（用户决定）**：`Picked` tab 随枚举值一起删除（§4.2），空出来的位置给 **`Pending` 单独一个 tab**——它是新订单进来的第一站，从 `Needs action` 里拆出来单独盯。tab 顺序按作业顺序排：`Pending → Processing → Labelled`，`Needs action` 仍在最后。

**`Needs action` 的口径**（`NEEDS_ACTION_EXCLUDED`，`src/lib/queries/orders.ts`）：排除 `completed` / `cancelled` / `pending` / `processing` / `labelled`，即剩下 `unpaid` / `backorder` / `issued`。前两个是终态，后三个各有自己的 tab——算进来会让同一批订单在同一行里出现两次。**新增枚举值默认落进 `Needs action`**，这是安全的方向：新队列会自己冒出来，而不是无声消失。

- **`Needs action`** 是聚合项：`status NOT IN ('completed','cancelled')`。这是运营每天真正要盯的那一屏，也是唯一一个不随枚举增删而失效的入口。
- tab 上带计数。**但计数必须走单独一次按 status 分组的聚合查询**，不是每个 tab 各发一次 count——`orders_status_idx` 在这上面是一次 Index Only Scan（实测 65 ms、`Heap Fetches: 0`），比 8 次分别 count 便宜得多。
  **发法是查 `public.order_status_counts` 视图**（§4.3 决策 A / §8.1）：PostgREST 的顶层聚合在本项目是禁用的，`.select("status, count()")` 会 400（§3.4）。`Needs action` 的数字在 TS 侧从同一份结果里求和（`total - completed - cancelled`），不额外发查询。
- 历史数据下这排 tab 会显得很空（99.7% 落在 Completed），**这是正常的**，不要因此把它做成动态隐藏空 tab——那样上线后队列有货了反而看不见入口。
- 完整的 8 值下拉仍保留在筛选栏里，覆盖 tab 没铺开的 `unpaid` / `backorder` / `issued` 与两个终态。

**其余下拉 / 开关筛选**

- `Platform`（Select）
- **`Not dispatched`（Switch）**：`posted_on_date IS NULL`，4,919 张。**它与状态 tab 不重复**——§4.2.1 实测有 4,497 张 completed 却没发货、113 张 cancelled 却发了货，状态筛不出这批
- 日期区间（`created_at`），默认不限

**搜索（决策 3，五个维度）**

不做"一个搜索框猜用户想搜什么"。五个维度的解析路径、索引需求、匹配语义都不同，混在一起意味着每次按键跑五路查询、还得猜哪路才是用户要的。改为**一个带维度选择器的搜索框**（`Invoice / Tracking / Customer / Suburb or postcode / SKU`），选中哪个就只跑哪一路。

| 维度 | 目标列 | 匹配 | 解析路径 |
|---|---|---|---|
| Invoice | `orders.invoice_number` | 模糊 | 直接 |
| Tracking | `orders.tracking_number` | 模糊 | 直接 |
| Customer | `customers.full_name` / `email` / `platform_user_id` | 模糊 | 嵌入过滤，§5.3 |
| Suburb / postcode | `customers.city` / `postcode` | suburb 模糊、postcode 前缀 | 嵌入过滤，§5.3 |
| SKU | `products.sku` | **精确** | 两跳，§5.3 |

### 5.3 三条跨表搜索路径的实现

**客户维度与地址维度**走 PostgREST 的内嵌 `!inner` 过滤，让 semi-join 在 DB 里完成、分页仍落在 `orders` 上：

```ts
supabase
  .from("orders")
  .select("id, invoice_number, ..., customers!inner(full_name, city, postcode)",
          { count: "estimated" })
  .ilike("customers.full_name", `%${escaped}%`)
  .order("created_at", { ascending: false })
  .range(from, to)
```

**不要**改成"先查 customers 拿一批 id、再 `.in('customer_id', ids)`"：一个常见姓氏能命中几千个客户，那个 `IN` 列表会先撑爆 URL 长度，再撑爆查询计划。

> **2026-08-08 实测：`!inner` 方案确认采用。** PostgREST 为内嵌过滤生成的是 `INNER JOIN LATERAL`，热态实测（各跑 3 次）：
>
> | 查询 | LATERAL（PostgREST 实际形状） | CTE MATERIALIZED 改写 |
> |---|---|---|
> | `city ~ sydney` | 98–104 ms | 71–404 ms |
> | `city ~ rich` | 83–230 ms | 21–113 ms |
> | `full_name ~ smith` | 31–42 ms | 32–36 ms |
> | `full_name ~ li`（极宽泛） | **20–23 ms** | **506–974 ms** |
> | `email ~ gmail` | 56–57 ms | 226–433 ms |
>
> 曾考虑用 `WITH ... AS MATERIALIZED` 强制从 customers 侧驱动（PostgREST 表达不了，需要 RPC）。**实测否掉了**：它只在中等选择度上略胜，在宽泛词上因为要物化几万个 id 反而慢 25 倍。LATERAL 让 planner 按选择度自行择边，是更稳的那个。
>
> **冷缓存首次命中可能是秒级**（`city ~ sydney` 首跑 3,250 ms、`full_name ~ smith` 首跑 705 ms），第二次起回落到上表。这是预热而不是设计缺陷，但值得知道——首次部署后头几次搜索会明显偏慢。

**SKU 维度是唯一需要两跳的**，因为 `orders → order_transactions → order_items` 隔了两层：

```ts
// 第一跳：SKU 精确解析成 product_id（products.sku 唯一且有索引）
// 第二跳：嵌入过滤，order_items 的 product_id 条件下推到底层
supabase
  .from("orders")
  .select("..., order_transactions!inner(order_items!inner(product_id))")
  .eq("order_transactions.order_items.product_id", productId)
```

**SKU 用精确匹配而不是模糊**，有两个理由：SKU 是标识符不是描述（`GBDL00226` 模糊搜没有语义），而且精确匹配走 `products.sku` 的既有唯一索引，省掉一个 250,687 行上的 GIN 索引。搜不到时给的提示是 `No product matches this SKU.`——把"SKU 不存在"和"这个 SKU 没卖过"区分开，后者才显示空订单列表。

这条路径是本轮**唯一需要实测计划的查询**：热销 SKU 在 `order_items` 里可能有上万行，两层 `!inner` 的执行计划要用 `EXPLAIN ANALYZE` 确认走的是 `order_items_product_id_idx` 而不是 hash join 全表。见 §11 第 1 项。

> **2026-08-08 实测：通过，但结论有条件。** 最热的 SKU（`product_id = 11`，7,100 张订单）在 `ANALYZE` 后是 19 ms，走 Nested Loop Semi Join：`orders_created_at_idx` 驱动 → `order_transactions_order_id_idx` → `order_items_transaction_id_idx`。
> **条件是统计信息必须新鲜**：`ANALYZE` 之前同一个查询是 7,385 ms，planner 把命中行数估低 50 倍后选了从 `order_items` 侧驱动的 nested loop。这个查询是本轮离 8 秒超时最近的一个，统计信息一陈旧它就第一个倒。上线后若报"SKU 搜索很慢"，先查 `pg_stat_user_tables.last_autoanalyze`，不要先去改查询。

### 5.4 运送方式的显示

`shipping_method` 枚举用的是 `PascalCase_Snake` 拼写（`Mypost_Reg_S_Box`），与项目其他枚举的小写风格不一致——这一点在迁移时就是**已知并接受**的（`docs/orders-domain-migration.md` §4.1），不会改。

所以需要一张 34 项的展示映射表 `SHIPPING_METHOD_LABELS`（`Mypost_Reg_S_Box` → `MyPost Regular S Box`），放 `src/lib/orders/shipping-method.ts`，列表页与详情页共用。

`legacy_shipping_method` 的 7 个值（Zone6 Regular/Express、Sendle、Sendle 250g、Winit、Fast Track、Toll B2C）**不进下拉选项**——它们是已停用承运商。显示时以弱化样式加 `(retired)` 后缀。字段编辑已采纳（决策 1），所以编辑器里这 29,143 张订单必须显示"当前值已停用，保存后列表与详情页将改为显示新值"的提示。

**保存时不清空 `legacy_shipping_method`**（§4.3 决策 B）。写入 `shipping_method` 后，显示侧的 `COALESCE(shipping_method, legacy_shipping_method)` 自然优先取新值，legacy 列静静留着当年的承运商记录。清空它是不可逆的，而留着的代价只是一列冗余数据。**因此 `orderUpdateSchema` 不包含 `legacy_shipping_method`，Server Action 也不得 UPDATE 该列。**

## 6. `/orders/[id]` 订单详情页

### 6.1 三层语义必须在界面上分清

这是整个订单域最容易做错的地方。`order_transactions` 与 `order_items` **不是**主从关系的两种写法，它们是两件不同的事：

- `order_transactions` = **平台卖出的 listing**：标题、eBay listing id、`custom_label`、售价、数量。这是买家看到的东西。
- `order_items` = **仓库实际拣的内部 SKU**：一个套装在上面卖成一行，在这里展开成多行组件。这是仓库做的事。

拍平成一张表必然丢掉其中一个。界面必须让人看得出"卖了 1 个套装"和"拣了 5 个 SKU"说的是同一件事。

**按决策 4：交易行一张表，每行 chevron 展开显示该行的拣货明细**（父子关系直接可见），默认全部收起——250 行明细一次铺开会把页面淹掉。交互与 `/inventory` 的行展开一致（同一时刻只展开一行），组件可直接沿用那一轮的骨架。

```
Transactions (2)
┌──┬────────────────────┬─────┬──────┬────────┐
│  │ Item               │ Qty │ Price│ Total  │
├──┼────────────────────┼─────┼──────┼────────┤
│ ▶│ Desk Bundle (KIT)  │  1  │ 89.95│  89.95 │
│ ▼│ A4 Paper Box       │  2  │ 24.95│  49.90 │
│  │   └ Picked items                          │
│  │     PPR-A4-500  ×2   P-1-3                │
└──┴────────────────────┴─────┴──────┴────────┘
```

展开区里每行显示 `sku_snapshot`（有 `product_id` 时链到商品详情）、数量、拣货库位。**明细数据随详情页一次取完**，不做按需加载：`/inventory` 那轮的懒加载是因为列表页有 20 行 × 20 条流水，这里一张订单的明细中位数是个位数（250,687 / 203,315 ≈ 1.2 行/交易），多一次往返不值得。

### 6.2 页面分区

```
┌ Header ─────────────────────────────────────────────┐
│ Invoice 180048CF        [completed] [ebay]          │
│ Created 12 Mar 2026 · Dispatched 14 Mar 2026        │
│                                    [Edit] [⋯]      │
├ 三栏摘要 ───────────────────────────────────────────┤
│ Customer          │ Shipping         │ Totals       │
│ 姓名/邮箱/电话     │ 方式/追踪号      │ Goods        │
│ 收件地址 ⚠         │ Web order id     │ Postage      │
│ → 客户详情         │                  │ Order total  │
├ Transactions ───────────────────────────────────────┤
│ 交易行表格 + 行内展开拣货明细（§6.1）                 │
├ Comments ───────────────────────────────────────────┤
└─────────────────────────────────────────────────────┘
```

### 6.3 收件地址那个 ⚠ 是必需的

第四轮评审把收件地址从 `orders` 移到了 `customers`（`docs/orders-domain-migration.md` §13.3），**代价是明确接受过的**：实测 8,150 张订单（4%，涉及 5,483 个客户）的实际收件地址与该客户现在的地址不同，那些历史地址已经不可查。

所以订单详情页上那块地址**不是"这张订单寄到了哪"，而是"这个客户现在住哪"**。地址块必须带一句说明（`Current customer address — not a snapshot of where this order shipped.`），否则运营查退件、查投诉时会把它当成当年的发货地址用。这是一处纯文案成本、能挡掉真实误判的地方。

### 6.4 交易行的可编辑性与 trigger 的联动（决策 1 已采纳字段编辑）

`order_transactions` 上挂着两个 trigger（`..._rebuild_items_insert` / `..._rebuild_items_update`），**改动 `custom_label` 或 `quantity` 会立即重建该交易行下的全部 `order_items`**。重建时：

- 拣货库位按 product_id 尽量继承，**掉出新展开范围的商品，其库位就丢了**；
- 人工修过的行（`is_auto_generated = false`）会被覆盖成 trigger 生成的行。

trigger 的 `WHEN` 子句已经把"提交全部字段的表单"这条常见坑堵住了（只有值真的变化才触发），但 UI 仍然必须：

1. 把 `custom_label` / `quantity` 的编辑与其他字段的编辑**分开**，不放在同一个"保存全部"按钮下；
2. 修改这两个字段前用全局 `useConfirm`（规则 9）提示会重建拣货明细并可能丢失手工调整。

同理，详情页 `⋯` 菜单里的 `Rebuild picked items`（调 `rebuild_order_items_for_order(order_id)`）是**唯一支持的"把历史订单按当前 BOM 重算"的手段**，也是破坏性的——它会把当年实际发出去的明细替换成今天的 BOM。文案要写死："This replaces what was actually shipped with today's kit contents."

### 6.4.1 新增与删除交易行（2026-08-08 补）

字段编辑之外，详情页还提供交易行的**新增**（`Transactions (N)` 标题旁 `Add line`）与**删除**（行尾 `⋯` 菜单，与 `/orders`、`/inventory` 的行操作同形）。

**新增：拣货明细不用人填。** `order_transactions_rebuild_items_insert` 是**无条件** AFTER INSERT，插入语句一落地，`rebuild_order_items()` 就按 `custom_label` 生成明细——普通商品 1 行、套装按 BOM 展开、SKU 匹配不到则生成 1 行 `product_id IS NULL` 的占位行。所以新增对话框是**单表单单保存键**，不必像编辑那样把 `custom_label` / `quantity` 拆出去：insert 时没有"手工调整"可供丢失，编辑时才有。

**新增只能选系统里已有的商品**（用户决定，2026-08-08）。SKU 输入框换成商品选择器（搜 SKU / 名称，套装与停用商品都在候选里，各自带徽章），选中后 `custom_label` = 该商品 SKU、`item_title` = `name`、`Unit price` = `retail_price`，三个字段仍可改。**编辑对话框的 SKU 自由文本保持不变**——那是修历史遗留的 313 行未解析明细的唯一入口，与"手工新增一条订单行"是两件事。

校验分两层：zod 只保证选择器非空，**真正的把关在 `createOrderTransaction` 里按 `sku` 回查 `products`**，查不到直接报错。这一层不能省——数据库对未知 SKU 不会有任何抱怨，插入照样成功，只是多一行未解析明细。

**但"SKU 存在"不等于"能拣出东西"**：空 BOM 的套装（24 个）同样只展开出一行 `product_id IS NULL` 的占位行。所以 `createOrderTransaction` 插入后仍要**回读一次该交易行的 `order_items`**，用 toast 区分"生成了 N 条明细"与"什么都拣不出来，去看看这个套装的内容"。

**零售价为 0 的套装不预填价格**（用户决定）：640 个套装里 556 个 `retail_price` 是 **0 而非 NULL**（`docs/product-kit-pricing.md` §11），照填等于在真实订单上无声生成一条 $0 的行。这类商品选中后 Unit price **留空**（表单值为 `NaN`），由 zod 逼用户填，并在字段下方提示 `This product has no retail price set`。

**新增表单只开放四个字段**（商品 / 标题 / 数量 / 单价）。`item_number`、`sales_record_number`、`order_id_ebay`、`transaction_id_ebay`、`postage_service` 记录的是"平台报告了什么"，手工补的行根本没有这些标识；开放它们等于允许在将来 eBay/Shopify 同步要拿来对账的列里填入编造值。`sale_date` / `paid_on_date` 是 NOT NULL 无默认值，按用户决定（2026-08-08）一律写 `now()`，不做输入项。

**删除：靠 CASCADE，不做二次清理。** `order_items.transaction_id` 是 `ON DELETE CASCADE`，删交易行即删其下全部拣货明细，不会留下孤儿。目前 `order_items` 上**没有**任何库存联动（发货→库存流水在 §13），所以删除只改这张订单的金额口径。确认文案（规则 9）必须报出连带删除的明细条数——套装行收起时，用户看不到自己在删几行。

删到一条不剩是**允许**的：迁移进来的 25 张订单本来就是零交易行，`order_metrics_summary` 对它们返回 0。

### 6.5 未解析明细的标记

`product_id IS NULL` 的行在详情页要显眼（琥珀色行 + `Unresolved` 徽章），并显示 `sku_snapshot`——那是唯一的线索。

**父交易行上也要带 `Unresolved` 徽章**（§4.3 决策 D）。§6.1 的展开区默认全部收起，只在展开区里做标记等于这 313 行在详情页永远看不见——打开订单的人没有理由去逐行展开找问题。父行标记是让"这张订单里有东西没解析"这件事在收起状态下就成立。

按决策 1，**集中的修复队列本轮不做**（移入 §13）。所以这 313 行在本轮只是"看得见、改不了"：详情页标出来，但没有指派商品的入口。这是有意的取舍，不是遗漏——但要知道它意味着 14 个 SKU 的销售数据在报表里会一直缺着，直到下一轮补上队列。

### 6.6 `is_auto_generated` 的显示

迁移进来的 250,687 行全部是 `false`（= Laravel 的真实记录），trigger 生成的是 `true`。这个区别对运营是有意义的：`false` 意味着"这是当年实际发生的"，`true` 意味着"这是系统按 BOM 算出来的"。用一个安静的图标或 tooltip 表达，不用整列。

## 7. `/customers` 与 `/customers/[id]`

### 7.1 列表页

与 `/orders` 同骨架，同样用估算计数（178,024 行）。

| 列 | 内容 |
|---|---|
| `Customer` | `full_name`，空则回落 `platform_user_id`，再空回落 `email` |
| `eBay user` | `platform_user_id`，20,347 行为空 |
| `Email` | `email` + `is_anonymised_email` 标记（见 §12） |
| `Suburb` | `city` 列（见 §4.1） |
| `State` / `Postcode` | 原样，未规范化 |
| `Orders` | 该客户订单数 |
| （⋯） | Edit / Delete |

**`Orders` 这一列有代价**：178k 客户逐行数订单是 N+1，而 `orders` 上没有现成的按客户聚合。两条路——PostgREST 的 `orders(count)` 内嵌聚合（一次请求、DB 侧做，当页 20 行成本可控），或干脆不要这列。**建议用内嵌聚合并实测**；若 `EXPLAIN` 显示它退化成对全表分组，就砍掉这列，改为只在客户详情页显示订单数。

筛选：姓名 / 邮箱 / eBay 用户名（模糊）、suburb、postcode、`Has orders` 开关（1,790 个客户没有任何订单，见迁移文档 §13.4）。

### 7.2 客户详情页

`/customers/[id]`，两块：

1. **客户资料**：姓名、邮箱（带匿名标记）、电话、eBay 用户名、地址九列。`Edit` 打开与列表页共用的 `customer-form-dialog`。
2. **订单历史**：该客户的订单列表，复用 `/orders` 的表格组件（去掉 Customer 列），按 `created_at DESC` 分页。

这块是 `customers` 表存在的**全部理由**——`go2_buyers` 每导一张订单就插一行，196,085 行里 185,241 行只服务一张订单；去重到 178,024 就是为了让"这个人一共买过什么"这个问题能被问出来（迁移文档 §4.2）。

### 7.3 地址在这里是可编辑的，含义要写清

`customers` 上的地址是**当前地址**，改了它就等于改了这个客户名下**所有**历史订单详情页显示的收件地址（§6.3）。表单里那块地址要带一句 `Used for all of this customer's orders, including past ones.`

这不是设计缺陷，是第四轮决策 16 明确接受的代价（迁移文档 §13.3：8,150 张订单的真实收件地址已不可查）。但改地址的人必须知道自己在改什么。

## 8. Schema 改动

### 8.1 必需：`pg_trgm`、搜索索引与状态计数视图

文件：`supabase/migrations/20260808100000_create_orders_search_indexes.sql`

**三件事在同一个迁移里**：`pg_trgm` + 7 个搜索索引 + `order_status_counts` 视图（§4.3 决策 A）+ 收尾的 `ANALYZE`（§3.4）。

**开头必须 `SET LOCAL statement_timeout = 0`**：7 个 GIN 索引建在 178k + 203k 行上，远端默认超时会把整个事务杀掉。这与规则 15 里 `004` 脚本的做法是同一个理由。

按决策 3 的五个维度倒推，需要建的索引如下——**只建实际要搜的列**：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 维度 1、2：发票号与追踪号
CREATE INDEX orders_invoice_number_trgm_idx
  ON public.orders USING gin (invoice_number extensions.gin_trgm_ops);
CREATE INDEX orders_tracking_number_trgm_idx
  ON public.orders USING gin (tracking_number extensions.gin_trgm_ops);

-- 维度 3：客户名 / 邮箱 / eBay 用户名
CREATE INDEX customers_full_name_trgm_idx
  ON public.customers USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX customers_email_trgm_idx
  ON public.customers USING gin (email extensions.gin_trgm_ops);
CREATE INDEX customers_platform_user_id_trgm_idx
  ON public.customers USING gin (platform_user_id extensions.gin_trgm_ops);

-- 维度 4：suburb（= city 列，见 §4.1）与 postcode
CREATE INDEX customers_city_trgm_idx
  ON public.customers USING gin (city extensions.gin_trgm_ops);
-- postcode 是 4 位数字，用前缀匹配就够，普通 btree 即可；
-- text_pattern_ops 是让 LIKE 'x%' 在非 C collation 下也能走索引的关键。
CREATE INDEX customers_postcode_idx
  ON public.customers (postcode text_pattern_ops);
```

**维度 5（SKU）不建索引**：走 `products.sku` 的既有唯一索引 + `order_items_product_id_idx`，见 §5.3。

`customers.platform_user_id` 已有 UNIQUE btree，但那只服务等值查询，模糊搜索用不上——两个索引各司其职，不冲突。

**状态计数视图**（§4.3 决策 A，替代发不出去的顶层聚合）：

```sql
CREATE VIEW public.order_status_counts AS
  SELECT status, count(*)::bigint AS order_count
  FROM public.orders
  GROUP BY status;

-- 与 order_totals 同样的理由：视图默认以 owner 身份跑，加上 security_invoker
-- 后 orders 上的 RLS 才继续生效。
ALTER VIEW public.order_status_counts SET (security_invoker = on);
GRANT SELECT ON public.order_status_counts TO authenticated;
```

这个视图**可以**直接查，与 §3.3 禁止 join 的 `order_totals` 不同：它是一次 `orders_status_idx` 上的 Index Only Scan（实测 65 ms、`Heap Fetches: 0`），且只在列表页顶部发一次、不参与分页 join。

**收尾 `ANALYZE`**（§3.4，缺了它估算计数会显示一个高出 21% 的数、SKU 反查会慢 390 倍）：

```sql
ANALYZE public.orders;
ANALYZE public.customers;
ANALYZE public.order_transactions;
ANALYZE public.order_items;
```

按规则 14 包 `BEGIN; / COMMIT;`。（`ANALYZE` 可以在事务内执行；`CREATE INDEX CONCURRENTLY` 不行，所以这里用的是普通 `CREATE INDEX`——建索引期间对两张表的写会被阻塞，但本轮执行时还没有写入方。）

按规则 18，视图建完要在 `database.types.ts` 的 `Views` 下补 `order_status_counts` 的 `Row`。

**体积实测（2026-08-08 建完后）**——总计 **53 MB**，没有一个需要降级为前缀匹配：

| 索引 | 体积 |
|---|---|
| `customers_email_trgm_idx` | 16 MB |
| `orders_tracking_number_trgm_idx` | 8,728 kB |
| `customers_platform_user_id_trgm_idx` | 8,680 kB |
| `customers_full_name_trgm_idx` | 8,576 kB |
| `customers_city_trgm_idx` | 6,592 kB |
| `orders_invoice_number_trgm_idx` | 4,016 kB |
| `customers_postcode_idx`（btree） | 1,272 kB |

参照：`orders` 堆表 87 MB、`customers` 堆表 66 MB。`email` 最大是因为平均 29.5 字符、几乎无重复（89,287 个是 eBay 中继地址，前缀各不相同）。

**索引生效性实测**：稀有词全部走 `Bitmap Index Scan`（`%zzqx%` 在 full_name / tracking / email 上均为 0.07–0.28 ms）。常见词（`%smith%` / `%gmail%` / `%99312%`）planner 会选 Seq Scan 提前退出——**这是正确的计划而不是索引失效**，因为 `LIMIT 20` 在高命中率下扫几十行就够了，实测 0.2–76 ms。

### 8.2 可能需要：订单列表用的扁平视图

列表页要显示客户名，而客户名在另一张表。两条路：

- **PostgREST 内嵌 select**（`customers(full_name, platform_user_id)`）——不需要迁移，但每行一次 join；
- **建 `order_list` 视图**把客户名压平进来——查询更干净，但多一个需手工同步 `database.types.ts` 的对象（规则 18）。

**建议先走内嵌 select**：`orders.customer_id` 有索引，一页 20 行的嵌套查询在这个规模上不构成问题，而视图省不掉那个 join、只是把它移到 DB 里。等确实测出慢再建视图。

### 8.3 明确不做

- **不建金额的物化视图/存储列**（§3.3）
- **不动 `shipping_method` 枚举的拼写**（§5.4）
- **发货扣库存本轮不做**（决策 1）。下一轮做时也**不能挂 trigger**，必须走显式的 Server Action + 已有的 `record_stock_movement` RPC：`order_items` 上一挂 trigger，203,315 张历史订单里任何一张被碰到就会开始扣库存，而它们的货十年前就发完了
- **未解析明细的修复队列本轮不做**（决策 1），那 313 行只在详情页可见（§6.5）

## 9. 查询层与 Server Actions

### 9.1 查询（`src/lib/queries/`）

| 文件 | 导出 |
|---|---|
| `orders.ts` | `ORDERS_PAGE_SIZE`、`parseOrderFilters`、`fetchOrderList`（含 §3.3 的两段式取总额、§5.3 的五路搜索分支）、`fetchOrderStatusCounts`（查 `order_status_counts` 视图，§5.2）、`fetchOrderDetail`、`fetchOrderTransactionsWithItems` |
| `customers.ts` | `CUSTOMERS_PAGE_SIZE`、`parseCustomerFilters`、`fetchCustomerList`、`fetchCustomerDetail`、`fetchCustomerOrders` |

沿用 `parseInventoryFilters` 的既有写法：`text()` / `numeric()` 取值 + `escapeLike()` 转义 `%` `_`（[queries/inventory.ts:42](src/lib/queries/inventory.ts#L42)）。

两处与既有查询层不同、必须写进注释的地方：

1. **`count: "estimated"`**（决策 2）。既有的 `fetchProductList` / `fetchInventoryList` 用默认的 exact，照抄会把 20 万行的 COUNT 带进每一次翻页。分页组件要能显示"约 N"——`OrdersPagination` 不能直接复用 `InventoryPagination`，那个组件假设总数是精确的。
2. **`customers.city` 就是 suburb**（§4.1）。查询层是这个错位唯一会被下一个人撞上的地方，注释写在 `parseCustomerFilters` 上。

### 9.2 校验（`src/lib/validations/`，规则 6 双跑）

- `order.ts`：`orderUpdateSchema`（status / platform 用 `z.enum`，与 DB 枚举逐值对齐；`tracking_number` `max(100)`；`comments` `max(2000)`；`postage_and_handling` 非负两位小数）、`transactionUpdateSchema`（`quantity` 正整数；`sale_price` **允许负数**——见 §2）
- `customer.ts`：`customerSchema`（`full_name` / `email` / `phone` / 9 个地址列，全部可选但至少一项非空；`platform_user_id` 唯一性交给 DB）

### 9.3 Server Actions（`src/lib/actions/`，规则 7 返回 `ActionResult`）

| 错误码 | 场景 | 文案 |
|---|---|---|
| `23505` UNIQUE | `customers.platform_user_id` 重复 | `A customer with this platform user ID already exists.` |
| `23505` UNIQUE | `orders.invoice_number` 重复 | `An order with this invoice number already exists.` |
| `23503` FK | 删客户但仍有订单（`ON DELETE RESTRICT`） | `This customer has N orders on file and cannot be deleted.` |
| `23514` CHECK | 交易行数量 ≤ 0 | `Quantity must be at least 1.` |

**删除客户几乎必然失败**：178,024 个客户里绝大多数都有订单，`orders.customer_id` 是 `ON DELETE RESTRICT`。这与 `/locations` 删除库位是同一个形状（`docs/inventory-ui.md` §5.4），**是预期行为不是缺陷**——但错误文案必须带上订单数，否则用户只会看到一句无从下手的报错。

`revalidatePath` 覆盖 `/orders`、`/orders/[id]`、`/customers`、`/customers/[id]`。

## 10. 落地文件清单

**新增（迁移）**
- `supabase/migrations/20260808100000_create_orders_search_indexes.sql`（pg_trgm + 7 个索引 + `order_status_counts` 视图 + `ANALYZE`，见 §8.1）

**新增（应用层）**
- `src/lib/queries/orders.ts`、`src/lib/queries/customers.ts`
- `src/lib/validations/order.ts`、`src/lib/validations/customer.ts`
- `src/lib/actions/order.ts`、`src/lib/actions/customer.ts`
- `src/lib/orders/shipping-method.ts`（34 项 label 映射 + legacy 值处理）
- `src/app/(dashboard)/orders/_components/`：`orders-filters` / `orders-search` / `orders-table` / `orders-pagination` / `order-row-detail`
- `src/app/(dashboard)/orders/[id]/page.tsx` + `_components/`：`order-detail-header` / `order-summary-cards` / `order-transactions-table`（含行内展开）/ `order-edit-dialog` / `transaction-edit-dialog`
- `src/app/(dashboard)/customers/_components/`：`customers-filters` / `customers-table` / `customers-pagination` / `customer-form-dialog`
- `src/app/(dashboard)/customers/[id]/page.tsx` + `_components/`：`customer-detail-header` / `customer-orders-table`

**共享**：`/orders` 与 `/customers/[id]` 的订单表格是同一张（后者少一个 Customer 列），按规则 5 提取到 `src/components/orders/orders-table.tsx`，不要两份。这正是上一轮把库存组件挪进 `src/components/inventory/` 的同一个理由（`docs/inventory-ui.md` §12.1）。

**修改**
- `src/app/(dashboard)/orders/page.tsx`、`customers/page.tsx`（替换占位）
- `src/lib/supabase/database.types.ts`：四表与 `order_totals` **已就位**，本轮需补 `order_status_counts` 的 `Row`（§8.1）。§8.2 的 `order_list` 视图仍不建

### 10.1 实际落地与本节的四处偏差（2026-08-08 UI 轮）

上面的清单写于编码前，以下四处按规则 5 在实现时收敛，**以实际代码为准**：

| 计划 | 实际 | 原因 |
|---|---|---|
| `orders/_components/orders-pagination` + `customers/_components/customers-pagination` | 一个 `src/components/estimated-pagination.tsx`，带 `noun` 参数 | 两个列表的估算分页逻辑逐行相同（"about N"、无跳末页、短页判定末页），差别只有空态那个名词 |
| `customers/[id]/_components/customer-orders-table` | 直接用共享的 `components/orders/orders-table`（`showCustomer={false}`） | 本节"共享"那段的原意，不需要再包一层 |
| `customers/_components/customer-form-dialog` | `src/components/customers/customer-form-dialog.tsx` | 列表页与详情页都要用，与订单表格同理 |
| `queries/customers.ts` 导出 `fetchCustomerOrders`（§9.1） | 未实现，改为 `fetchOrderList(supabase, filters, customerId)` | 与 `/orders` 是同一个查询与同一套筛选解析，另写一份必然漂移 |

另外新增两个计划外的文件与两个 Server Action：

- `src/lib/format.ts`：`formatMoney` / `formatDate`。订单域金额恒为 AUD（与商品零售价不同，那里必须按行取 currency）
- `src/lib/orders/status.ts`：状态/平台的 label 与徽章配色、tab 定义。其中 `order_status.backorder` 的 label 是 **`On backorder`**，与 `sales_platform.backorder` 的 `Backorder` 区分（§4.2.2）
- `loadOrderTransactions(orderId)`（`actions/order.ts`）：列表页行展开按需取交易行，形状同 `loadProductHistory`
- `loadCustomer(id)`（`actions/customer.ts`）：**编辑客户前必须整行读取**。`CustomerListRow` 只带 8 列而 `updateCustomer` 写 13 列，用列表行直接喂表单会把 phone / company / 四行地址静默写成 NULL

**2026-08-08 追加（交易行增删，§6.4.1）**

- `_components/transaction-create-dialog.tsx`（新增行）与 `_components/transaction-fields.tsx`（四个字段的共用实现）。后者是按规则 5 抽出来的：数字输入的空值处理（空串 → `NaN` 而非 `0`，好让 zod 报错而不是静默存 0）本来在编辑对话框里就写了两遍
- `createOrderTransaction` / `deleteOrderTransaction`（`actions/order.ts`）
- 交易行的行尾操作由铅笔按钮改为 `⋯` 菜单（Edit / Delete），与列表页一致
- 拣货明细展开区加了商品缩略图列，走 `order_items → products` 的真实外键内嵌（不同于交易行那张图——那里 `custom_label = sku` 不是外键，只能额外查一次）
- `src/components/products/product-picker.tsx`：异步商品选择器，从 `product-kit-item-dialog` 里那份提取出来，套装组件选择器与订单行选择器共用。里面那套「防抖 + 用关键词标记结果是否陈旧 + 单独记住已选项（否则搜索词一变它就从候选里消失、按钮上的名字跟着没了）」照抄一份必然漂移。**`search` 参数必须由调用方 `useCallback` 稳定**，否则父表单每敲一个字都会重启防抖
- `searchOrderLineProducts`（`queries/products.ts`）+ `searchOrderLineProductsAction`（`actions/product.ts`）：候选集**不排除套装、也不排除停用商品**——套装正是订单行通常卖的那一层，停用商品也仍在清尾货；两者在列表里打徽章而不是滤掉
- `orLikePattern`（`queries/search-params.ts`）：原本是 `product-kit-items.ts` 里的私有函数，两处搜索共用后上提。它比 `escapeLike` 多剥掉逗号/括号/引号/反斜杠——这些是 PostgREST `or()` 自己的语法字符，不剥会让请求**格式错误**，而不是查不到

`order-row-detail`（列表页展开）与 `order-transactions-table`（详情页展开）是两个组件、两种深度：前者只到交易行 + `Unresolved` 徽章，后者才展开到拣货明细。合并会让列表页为收起状态下的内容多取一层 `order_items`。

## 11. 验证计划

1. **索引真的被用上**：对搜索查询跑 `EXPLAIN ANALYZE`，确认走 `Bitmap Index Scan` 而非 `Seq Scan`。这是本轮唯一"看起来能用、实际全表扫"的地方——20 万行上跑得动，但每次都是几百毫秒起（无索引时 `customers.full_name ILIKE '%smith%'` 实测 96 ms Seq Scan）。
2. **首屏耗时**：`/orders` 第 1 页、第 5,000 页各测一次。~~深翻页的 `OFFSET` 在 20 万行上会退化，若超过 1 秒需改游标分页。~~ **已于 2026-08-08 实测：第 1 页 6 ms、第 5,000 页 60 ms，OFFSET 分页保留（§4.3 决策 C）。** 本项复核即可，判据改为「不超过 `authenticated` 的 8 秒预算，且第 5,000 页在 200 ms 内」。
3. **trigger 联动**：改一条交易行的 `quantity`，确认 `order_items` 被重建、库位继承行为符合 §6.4；改订单的 `comments` / `tracking_number` 确认**没有**触发重建。后半句是本轮最重要的一次验证——trigger 的 `WHEN` 子句就是为它写的。
4. **`rebuild_order_items_for_order`**：确认重建后 `is_auto_generated` 变 `true`、行数符合当前 BOM。**只在新建的测试订单上做，禁止碰任何历史订单**——该函数是 `DELETE` + `INSERT`，没有回滚路径，历史明细不可再生。（原文写的"挑一个卖过套装的历史订单……测完要能回滚"是错的，回滚不存在。）
5. **未解析行**：确认 313 行在详情页正确高亮，`sku_snapshot` 有展示。
6. **金额一致性**：抽查几张订单，`order_metrics_summary.order_total` 应等于 `Σ(sale_price × quantity) + orders.postage_and_handling − orders.discount`；至少测一张含负数 `sale_price` 的退款订单。
7. **无交易行订单**：那 25 张应正常渲染为 0，不能白屏或报错。
8. **删除客户被拦**：确认 `23503` 被翻译成带订单数的文案。
9. **五路搜索各测一次**，尤其 SKU 反查（挑一个卖得最多的 SKU）与 suburb 模糊（挑一个大小写混杂的 suburb 名）。
10. **索引体积**：建完索引跑 `pg_relation_size`，把 7 个 GIN 索引的实际大小记回 §8.1。
11. **规则 12**：所有 Dialog 桌面端 + 移动端各验一次。
12. **状态 tab 计数**：确认 `order_status_counts` 能被 `authenticated` 查到（RLS 经 `security_invoker` 生效），且 8 个 tab 的数字只发一次请求。
13. **交易行增删**（§6.4.1）：只在测试订单上做。选一个普通商品（应生成 1 条明细，标题与零售价被带入）、一个有 BOM 的套装（应展开多条）、一个 `retail_price = 0` 的套装（Unit price 应留空且不让提交）；删一条套装行，确认其下明细随 CASCADE 一并消失、`Totals` 与交易行计数同步变化。另外确认套装组件选择器（`/products/[id]` 的 Add kit component）改用共享 `ProductPicker` 后行为未变。
14. **legacy 运送方式保存后不丢**（§4.3 决策 B）：挑一张 `legacy_shipping_method` 非空的订单，改成新枚举值后确认该列**仍保有原值**，且列表/详情显示的是新值。

### 11.1 各场景的实际样本（2026-08-08 从远端取，供逐项验证）

| 场景 | 记录 | 对应验证项 |
|---|---|---|
| 含未解析明细 | `/orders/2383`（`1800094F`） | 5、父行徽章（决策 D） |
| 无交易行 | `/orders/18639`（`180048CF`） | 7 |
| 含负数售价（退款） | `/orders/31481`（`19007AF9`） | 6 |
| legacy 承运商（`Sendle`） | `/orders/63393`（`2000F7A1`） | 13 |
| 停机时卡住的 `processing` | `/orders/205913`（`26032459`） | 3（改 comments 不应重建） |
| 一行拣出多个 SKU（套装） | `/orders/2006`（`180007D6`） | 6.1 两层语义 |
| 订单最多的客户（141 张） | `/customers/99686` | 客户详情页分页 |
| 订单最多的 SKU | `GB00011SF`（`product_id = 11`，7,100 张） | 9（SKU 反查） |

**验证项 4（`rebuild_order_items_for_order`）没有安全的样本**：详情页 `⋯ → Rebuild picked items` 是 `DELETE` + `INSERT`，历史明细不可再生。只能在新建的测试订单上做，**禁止对上表任何一条执行**。

## 12. 风险与注意事项

- **订单录入通道不存在**：Laravel 停用后，eBay / Shopify 的订单**目前没有任何进入新系统的路径**。本轮做的是"管理已有订单"，不是"接单"。同步/导入需要单独一轮（按规则 4，属于 Trigger.dev 的活）。这是整个 orders 域上线前的硬阻塞，本文档只负责记录它。
- **历史订单不能补扣库存**：`inventory_movements` 从迁移那天起账（`docs/inventory-ui.md` §9），203,315 张历史订单没有对应流水。下一轮做发货联动时必须限定为"从此以后新发的货"，且要有明确的界面/文案区分，否则会出现"这张 2019 年的订单为什么不扣库存"的困惑。
- **本轮的订单编辑不影响库存**：改 status、打勾发货，库存数字都不会动（决策 1 把联动推到下一轮）。这件事要让用户知道，否则会以为系统在背后扣了。
- **深翻页**：`OFFSET 100000` 在 Postgres 上是真的把前 10 万行数过去。20 万行、每页 20 条 = 10,164 页。实测 60 ms（§3.4），在预算内，所以保留 OFFSET；但**分页组件仍不提供"跳到最后一页"**——省掉一个一键触发最坏情况的入口，成本为零。
- **每个页面查询的预算是 8 秒**（`authenticated` 角色的 `statement_timeout`，§3.4）。超时的表现是查询直接报错、不是变慢。离这条线最近的是 SKU 反查（§5.3），而它对统计信息的新鲜度敏感。
- **统计信息陈旧是本域的系统性风险**：`ANALYZE` 前后 SKU 反查差 390 倍、深翻页差 54 倍、估算计数差 21%（§3.4）。迁移末尾会跑一次，但上线后大量写入时 autovacuum 未必跟得上。任何"订单页突然变慢"的报障，第一步查 `pg_stat_user_tables.last_autoanalyze`。
- **`order_items` 的手工修改会被 trigger 悄悄吃掉**：§6.4 已述。这是本轮最容易做出"用户改完看起来成功了、刷新后没了"的地方。
- **枚举扩展是单向的**：`shipping_method` 加值要 `ALTER TYPE ... ADD VALUE`（且不能在同一事务里用），删值基本不可能。UI 上不要提供任何"新增运送方式"的入口。
- **`customers` 的去重口径**：按 eBay 用户名（回落邮箱）分组。同一个人用两个 eBay 账号会是两个客户，UI 上没有合并功能，本轮也不做。
- **89,287 个客户的邮箱是 eBay 中继地址**（`@members.ebay.com`，已由 `is_anonymised_email` 标出）。客户列表/详情页展示邮箱时应带标记，否则将来做邮件功能的人会以为这些地址可达。

## 13. 下一轮候选

- **eBay / Shopify 订单同步（Trigger.dev）** —— 见 §12 第一条，这是上线前的硬阻塞，优先级最高
- **发货 → 库存流水联动**（本轮由决策 1 推迟）
- **未解析明细修复队列**（本轮由决策 1 推迟）：313 行 / 14 个 SKU，DB 索引已备好
- 按金额排序/筛选（需物化视图或存储列，见 §3.3）
- 客户合并（同一个人的两个 eBay 账号）
- 订单打印 / 面单导出
