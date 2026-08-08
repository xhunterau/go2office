# 订单指标汇总（order_metrics_summary）

从 xpros 移植的订单聚合能力：每张订单的件数、重量、计费重、装箱尺寸、金额与毛利。

| | |
|---|---|
| 源实现 | `xpros` 的 `public.order_metrics_summary` |
| 落地对象 | `public.order_metrics_summary`（**表**，非视图） |
| 迁移文件 | `20260808140000` ~ `20260808190000`（6 个） |
| 实测回填 | 203,315 张订单 / 31 秒 |

---

## 1. 为什么是表而不是视图

xpros 最初就是视图，后来被迫改成物化表（其 `20260727120000` 迁移的注释记录了全过程）：视图内每个 CTE 都跨订单聚合，`order_id` 谓词无法下推，**查 20 张订单也要把全库算一遍**，生产实测 7.3 秒并撞上语句超时。

go2office 的数据规模与当时几乎一致（203,315 订单 / 250,413 交易行 / 250,687 明细行），且 `20260803160000_create_order_totals_view.sql` 尾部已经为 `order_totals` 写下了同一条告诫。先做视图等于明知要返工，因此直接落地为表。

新鲜度由两条路径保证：

1. **语句级触发器**（`orders` / `order_transactions` / `order_items`）同步重算受影响的订单；
2. **pg_cron 定时刷新**兜底触发器看不见的漂移——主要是**商品**的重量、尺寸、采购价变动，它会牵动所有含该商品的历史订单。同步扇出这件事会让「保存一个商品」变成「重写几千张订单」。

---

## 2. 与 xpros 的差异

### 2.1 表结构映射

| xpros | go2office |
|---|---|
| `sales_orders` | `orders` |
| `sales_order_transactions` | `order_transactions` |
| `sales_order_lines` | `order_items` |
| `pricebooks.unit_cost` | `product_cost_base.unit_cost_aud` |

两边 `products` 的尺寸单位都是 mm、重量都是 kg（xpros 的除数 `4000000` 即 mm³ 在 250 kg/m³ 下的换算），因此**装箱算法与主导商品排序可以逐字照搬，无需单位换算**。

### 2.2 列的取舍

| xpros 列 | go2office | 说明 |
|---|---|---|
| `total_sale` | `goods_total` | 改名对齐已有的 `order_totals` |
| `total_amount` | `order_total` | 同上 |
| `website_profit` | `gross_profit` | |
| `packed_l/w/h` | `packed_length_mm` 等 | 单位进列名，对齐 `product_pricing.length_mm` 的既有习惯 |
| `transit_cover` | ❌ 不移植 | 在 xpros 中与 `total_unit_cost` **完全同值**，是冗余列 |
| `has_ammo` | ❌ 不移植 | `products` 无 `is_ammo`，本业务也不适用 |
| `shipping`（Express/Standard） | ❌ 不移植 | 该信息在 go2office 是 `orders.shipping_method` 上的普通列，不是聚合结果，复制一份没有收益 |
| — | ➕ `unresolved_item_count` | 见 §3 |
| — | ➕ `uncosted_item_count` | 见 §3 |
| — | ➕ `has_estimated_dimensions` | 见 §3 |

### 2.3 计算口径的三处改写

**1. `LEFT JOIN products`，不是 `JOIN`**
xpros 用内连接。go2office 的 `order_items.product_id` 可空（当前 313 行，最终 Laravel 导入后约 3,026 行），内连接会把这些行的**件数和重量一起丢掉**——订单显示的件数会少于实际卖出，且没有任何提示。

**2. 成本读 `product_cost_base` 而非 `product_pricing`**
`order_items` 已经展开到组件级（实测 250,374 行中 0 行指向套装），`product_pricing` 的套装 roll-up 分支在这里是死代码，而它要 `CROSS JOIN pricing_settings` 再 UNION，跑 25 万行不划算。

**3. GST 系数取自配置**
xpros 把 `website_profit` 里的成本硬编码为 `× 1.1`。这里改为 `× (1 + pricing_settings.gst_rate)`，GST 变动只需改一处。

### 2.4 缺失字段的补齐（迁移 `20260808160000`）

| 新增列 | 默认 | 说明 |
|---|---|---|
| `orders.postage_paid` | 0 | 实付给承运商。**全部 203,315 张历史订单为 0**——遗留数据没记录过，不是「免费寄出」 |
| `orders.discount` | 0 | 正数存储、做减法 |
| `pricing_settings.parcel_volumetric_kg_per_cbm` | 250 | 出港快递计泡比 |

`parcel_volumetric_kg_per_cbm` **刻意不复用** `air_volumetric_kg_per_cbm` / `sea_volumetric_kg_per_cbm`。那两个是供应商到岸运费口径、喂给 `product_pricing`；这个是国内快递口径。共用一列意味着「重谈一次海运价」会静默改掉全库订单的计费重。

> ⚠️ **读 `gross_profit` 时必须记住**：历史订单的 `postage_paid` 为 0，所以它们的毛利**被高估了大约一个运费**。详情页会就此显示警告。

---

## 3. 三个数据质量标记

物化的代价是数字看起来都很确定。这三列专门用来说明它们什么时候不确定：

| 列 | 当前值 | 含义 |
|---|---|---|
| `unresolved_item_count` | 296 张订单 > 0 | 明细行没匹配上商品。有数量、但**不贡献重量/尺寸/成本**，该订单所有物理指标偏低 |
| `uncosted_item_count` | 0 张订单 | 商品无法推导成本，`total_cost` / `gross_profit` 偏低。它存在的意义就是保持为 0，并在不为 0 时说出来 |
| `has_estimated_dimensions` | 13,695 张订单（6.7%） | 至少一个商品的某条边为 0，回落到 10mm 默认值。**3,123 个商品里有 864 个（28%）处于这个状态**，所以这不是边缘情况——装箱尺寸是猜的，UI 必须说明 |

`packed_*` 为 NULL 的 3,981 张订单构成：25 张无交易行、3,697 张有交易行但无明细行、251 张明细全部未解析。

---

## 4. 装箱算法

对每个明细行的 qty 件商品，比较三种摆法，取**最长边最小**的那个：

| 方案 | 跨度 |
|---|---|
| A 单层 a×b 排布 | `(L, a·W, b·H)` |
| B 单柱堆叠 | `(L, W, qty·H)` |
| C a×b 底面 + 堆叠 | `(a·L, b·W, ceil(qty/(a·b))·H)` |

其中 `a = max(1, round(√qty))`、`b = max(1, ceil(qty/a))`。并列时优先级 A > B > C。

整单取 `max(跨度L) × max(跨度W) × sum(跨度H)`——**沿高度方向累加**。

移植时只做了一处重构：xpros 把同样的 `GREATEST` 表达式重复了 9 次，这里先算出三个候选三元组再选，逻辑逐字等价。

### ⚠️ 尺寸归一化是前置条件

「沿高度累加」内建了「H 是最短边、货物平放叠高」的假设。若某商品录成 10×10×500（把长边填进了 height），它每件就往上叠 500mm，该商品出现在的每张订单的计费重都会虚高。

因此迁移 `20260808140000` 从 xpros 的 `format_product_fields_logic` 移植了尺寸排序，见 §5。

### 主导商品尺寸

`dominant_*` 是订单内「单件计费重最大」那个商品的**单件**尺寸。`packed_*` 刻意保守（从不让小件塞进大件的箱子），`dominant_*` 是「东西都能塞进主导商品原箱」时该报给快递的尺寸。两个都展示，回答的是不同问题。

---

## 5. products 字段归一化（迁移 `20260808140000`）

从 xpros 的 `format_product_fields_logic()` 移植**模块 1 和模块 3**：

| 模块 | 内容 | 是否移植 |
|---|---|---|
| 1 文本 | SKU 大写去空格；`name` / `ebay_title` initcap | ✅ |
| 2 零售价美化 | `CEIL(x+0.01) - 0.05` | ❌ **绝不移植** |
| 3 尺寸排序 | L ≥ W ≥ H | ✅ |
| 4 时间戳 | `updated_at := now()` | ❌ 已有 `products_set_updated_at` |

**模块 2 被排除的原因**：本项目的收敛规则是 `floor(x) + 0.95`，与 xpros 的规则**不是同一个**，且已经在 `public.charm_price` 与 `src/lib/pricing.ts` 两处按 CLAUDE.md 规则 17 同步维护。再加一个写入触发器会变成三实现，并且会在用户保存时静默改掉他刚输入的价格。

### `name` 的 initcap 只对新写入生效

`initcap()` 会把词内非首字母一律转小写，对现有数据是**双向**的：

| 原值 | initcap 后 | |
|---|---|---|
| `2Pcs 40Mm Padlock` | `2pcs 40mm Padlock` | ✅ 改对 |
| `Philips 23A 12V Battery` | `Philips 23a 12v Battery` | ❌ 改坏 |
| `Sony Murata 362 Sr721Sw` | `Sony Murata 362 Sr721sw` | ❌ 改坏 |

3,123 个商品名里 1,464 个（47%）会变，好坏参半。决策是**规则向前生效、历史不动**。

触发器里的 `NEW.name IS DISTINCT FROM OLD.name` 守卫是这个决策能否成立的关键：商品表单保存时会提交所有字段，没有这个守卫，「改一次价格」就会顺带重写商品名，几周的日常编辑下来那 1,464 行会被悄悄回填掉。

### 存量回填

只回填**尺寸（476 行）和 SKU（1 行）**，不动 `name` / `ebay_title`。回填期间临时禁用 `products_set_updated_at`——归一化不是业务编辑，不应表现为一次编辑（CLAUDE.md 规则 15 为保住这些时间戳花了不少力气）。

### 连带修正：`rebuild_order_items` 的 SKU 匹配

`rebuild_order_items` 用 `WHERE sku = v_label` 做**大小写敏感精确匹配**。SKU 一旦被大写，任何其他大小写的 `custom_label` 都会匹配失败——而它**不报错**，只会生成一行 `product_id IS NULL` 的占位记录。

今天的影响面只有 1 行（商品 396，SKU 从 `a` 变成 `A`），但失败方式是静默的。迁移 `20260808150000` 把比较改为 `WHERE sku = upper(trim(v_label))`。

实测 3,240 个不同 label：两侧都归一化后仍匹配同样的 2,757 个，归一化后无 label 相撞。**这是纯修正，不是放宽**。

> 注意：只归一化 label 一侧，不写成 `upper(trim(p.sku))`。因为触发器保证了存储的 sku 必然已是大写，这样比较才能走 `products_sku_key` 唯一索引而不是全表扫。**该触发器因此对这个查找的性能也是必需的，不只是正确性。**

---

## 6. 触发器

8 个，全部**语句级 + transition table**（xpros 用的是行级）。

原因是 `rebuild_order_items` 会把一个交易的所有明细行删掉重插：一个五组件套装在行级触发器下会触发 10 次、把同一张订单重算 10 遍。语句级把它收敛成每条语句一次。

| 表 | 触发器 |
|---|---|
| `orders` | `oms_orders_insert` / `oms_orders_update` |
| `order_transactions` | `oms_transactions_insert` / `_update` / `_delete` |
| `order_items` | `oms_items_insert` / `_update` / `_delete` |

**`orders` 没有 DELETE 触发器**：`order_metrics_summary.order_id` 是真正的外键（`ON DELETE CASCADE`）。xpros 用的是裸 bigint + DELETE 触发器 + 孤儿清理函数，外键把这两件事都免费做了，所以都没移植。

### 两个不显然的实现点

**1. UPDATE 触发器不限定列**
Postgres 不允许 `AFTER UPDATE OF <列>` 与 transition table 共存（`transition tables cannot be specified for triggers with column lists`）。因此列过滤挪进了触发器函数，用 transition table 上的 `IS DISTINCT FROM` 实现。语句级下多出的开销是每条语句一次小 join，不是每行。

**2. 删除订单为什么不会撞外键**
重算语句由 `FROM public.orders o` 驱动。级联删除时触发器执行到这里，订单行在本事务中已不可见，扫描返回空集，不会往一个已无父行的外键下插入。

### 重复重算是可能的

插入一条交易行会先触发 `rebuild_order_items`（它写 `order_items`，进而触发 items 触发器），然后才轮到 `oms_transactions_insert`。**结果永远正确，只是白干一次**。消除它意味着让这两组触发器互相耦合，不值得。

---

## 7. 定时刷新（迁移 `20260808190000`）

xpros 用 Trigger.dev 每天全量刷 3 次。**没有移植**：go2office 完全没有 Trigger.dev（无 `src/trigger/`、无 `trigger.config.ts`），而这件事是一条 SQL、从不经过 Next.js 请求线程，CLAUDE.md 规则 4 不适用。`pg_cron 1.6.4` 在本实例可用。

分成两个作业，因为全量刷新要 upsert 全部 203,315 行，太钝了不能常跑：

| 作业 | 频率 | 内容 |
|---|---|---|
| `order-metrics-refresh-stale` | 每小时（`7 * * * *`） | `refresh_stale_order_metrics('2 hours')`——只重算「含最近编辑过的商品」的订单 |
| `order-metrics-refresh-full` | 每日 17:00 UTC（澳东 03:00） | `recompute_order_metrics(NULL)` 全量 |

增量窗口（2 小时）刻意比调度间隔（1 小时）宽：等宽窗口会漏掉「上一次运行期间发生的编辑」，重叠一点的代价只是少量重复计算。

全量作业兜住增量看不见的情况：`pricing_settings` 变动（一次性移动所有成本）、商品被删而非编辑、以及任何没人想到过的触发器失效。

---

## 8. 授权

`order_metrics_summary` **对应用只读**：无写策略、无写授权。唯一入口是 SECURITY DEFINER 函数，所以不存在手工改过或半新半旧的行。

| 对象 | anon | authenticated | service_role |
|---|---|---|---|
| `order_metrics_summary`（表） | — | `SELECT` | 全部 |
| `recompute_order_metrics(bigint[])` | — | — | ✅ |
| `rebuild_order_metrics(bigint)` | — | ✅ UI 的「重算本单」入口，拿不到 NULL | ✅ |
| `refresh_stale_order_metrics(interval)` | — | — | ✅ |

`service_role` 保留执行权是有意的：那个 key 本来就对数据库有无限权限，在这里撤销只是表演。

### ⚠️ `REVOKE ... FROM PUBLIC` 在 Supabase 上不够（迁移 `20260808200000`）

迁移 `20260808170000` 原本只写了 `REVOKE ALL ... FROM PUBLIC` + `GRANT SELECT ... TO authenticated`，推送后实测发现**完全没生效**：

```
order_metrics_summary  anon           SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
order_metrics_summary  authenticated  SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
recompute_order_metrics   anon EXECUTE ✗
```

原因是 Supabase 为 `public` schema 配了 `ALTER DEFAULT PRIVILEGES`，把所有表权限和函数 EXECUTE **直接授予** `anon` / `authenticated` / `service_role`。这些是直接授权、不经过 `PUBLIC`，所以 `REVOKE ... FROM PUBLIC` 碰不到它们；而 `GRANT SELECT` 加的东西本来就已经在了。

两处后果是真实的：

1. **`recompute_order_metrics(NULL)` 对 `anon` 可执行** —— 全量刷新 203,315 行、自己把 statement_timeout 抬到 10 分钟。经 PostgREST 暴露出去就是一个**不需要任何凭证的 DoS 原语**。
2. **`TRUNCATE` 不受 RLS 管辖** —— RLS 确实挡住了 INSERT/UPDATE/DELETE（没有对应策略），但对 TRUNCATE 无话可说。

**这套宽授权同样存在于 `orders`、`pricing_settings` 等既有表上**，那里靠 RLS 兜底。迁移 `20260808200000` 只收紧了本轮新增的对象，没有去动 schema 级默认——那是一个影响面大得多的独立决策。项目里已有的收紧先例是 `20260801140000`（`inventory_movements`）与 `20260802110000`（`prune_product_movements`）。

**新增需要收紧的对象时，必须按角色逐个 `REVOKE`，不能只 `REVOKE FROM PUBLIC`。**

---

## 9. 按金额排序列表：**已决定不做**（2026-08-08）

> **这是一条已关闭的决策，不是待办。** 请不要把它当成遗留任务捡起来。

`order_totals` 时代「Total 列不可排序」的理由（join 一次就聚合 25 万行）确实已经不成立——现在它是主键上的一行。物化之后曾把「解禁排序」列入计划。

但障碍换了一个：**PostgREST 不支持按内嵌资源的列给父行排序**。当前查询从 `orders` 出发、把 `order_metrics_summary` 内嵌进来，PostgREST 只能按 `orders` 自己的列排序。要按金额排，必须把驱动方向翻过来（从汇总表出发、`orders` 作 `!inner`），随之把状态、平台、日期、五种搜索**全部筛选条件改写成带前缀的形式**。

`src/lib/queries/orders.ts` 的分页查询带着一批实测过的索引行为（SKU 反查 19ms 等，见 `docs/orders-ui.md` §5.3），整体翻面要把这些全部重测。

**2026-08-08 与业务方确认：不需要这个功能。** 列表页保持按日期排序。同一障碍下的「按金额筛选」一并不做。

若将来确有需求，优先考虑**独立报表页直接查汇总表**，而不是改动列表页的分页查询——那条路不碰任何既有索引行为。

---

## 10. 与 `order_totals` 的关系

`order_totals` 视图已在迁移 `20260808180000` 中**删除**，而不是改写成读汇总表的薄视图——两个名字指向同一组数字正是 CLAUDE.md 规则 17 在为 `charm_price` 管理的那类问题，而这里没有必须接受它的理由。

| 旧 | 新 |
|---|---|
| `order_totals.order_id` | `order_metrics_summary.order_id` |
| `order_totals.goods_total` | `order_metrics_summary.goods_total` |
| `order_totals.order_total` | `order_metrics_summary.order_total` |
| `order_totals.transaction_count` | `order_metrics_summary.transaction_count` |

一处**有意的行为变化**：`order_total` 现在会减去 `orders.discount`。所有迁移进来的订单 `discount` 为 0，故没有任何现存数值发生改变。

---

## 11. 对迁移脚本的影响（CLAUDE.md 规则 15）

### `004_orders_data.sql`

- 第 2 段（`orders`）禁用 `oms_orders_insert` / `oms_orders_update`
- 第 3 段（`order_transactions` / `order_items`）禁用另外 6 个
- **新增第 5 段**：`SELECT public.recompute_order_metrics(NULL)`
- 新增诊断 8a：`summary_rows` 应等于 `orders`，且 `oldest_computed_at` 应来自本次运行

这些触发器是语句级的，所以留着它们不是「触发 20 万次」，而是**一次触发、拿到一个 20 万行的 transition table**，然后把它变成一个 20 万元素的 `bigint[]` 交给重算函数。同样跑不动。

**跳过第 5 段不会报错**，订单页只会一直显示导入前的数字。

### `001_products_domain_data.sql`

导入的商品行**不再逐字等于** `go2_products`：SKU 被大写、476 个商品（15%）的三条边被排序。这是想要的效果，但做列对列 diff 校验时会把这些行报成不一致——要比较排序后的三元组。

---

## 12. 验证记录（2026-08-08，事务内跑完回滚）

| 项 | 结果 |
|---|---|
| 6 个迁移全部应用 | ✅ 回填 30.6s |
| 尺寸乱序 / SKU 非大写残留 | 0 / 0 |
| 汇总行数 vs 订单数 | 203,315 = 203,315 |
| 与旧 `order_totals` 三列对账 | 差异 0 / 0 / 0 |
| 件数对账 | 差异 0 |
| `orders` UPDATE 触发器 | discount 5 + postage_paid 8 → `order_total` −5、`gross_profit` −13 ✅ |
| 交易行 DELETE 触发器 | `transaction_count` 2→1，`goods_total` 相应下降 ✅ |
| 整单删除（FK 级联） | 汇总行随之消失，无外键报错 ✅ |
| 交易行 INSERT 触发器 | `goods_total` +29.85、`total_items` +3 ✅ |
| 体积重公式 | 5 个样例与手算完全一致 ✅ |
| `rebuild_order_metrics(单张)` | 返回 1 ✅ |
| pg_cron 作业 | 2 个，`active = true` ✅ |
