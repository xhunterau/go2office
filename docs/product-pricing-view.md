# 商品定价视图（Unit Cost / 运费 / 建议零售价 / 利润）— 开发文档

> 状态：**已实现**（2026-07-29）—— 4 个迁移已推送远端并用真实数据验证，`npm test` / `npm run build` 通过。实现期间的偏差见 §10。
> 创建日期：2026-07-29
> 前置文档：`docs/products-domain-migration.md`（`products` / `origins` 字段与单位定义）、`docs/product-kits-migration.md`（Kit 的建模方式）

## 1. 背景与目标

`public.products` 目前只存**原始录入值**：`currency` + `purchase_price`（供应商报价，币种不一）、`weight`（kg）、`length`/`width`/`height`（mm）、`retail_price`（澳元标价）。真实的经营决策需要的是**换算后的落地成本**和**利润**，这些值今天既没有存也没有算。

本次目标：新增一个 **Postgres 视图 `public.product_pricing`**，对**所有非 Kit 商品**（`is_kit = false`）实时给出：

1. `unit_cost_aud` — 采购价换算成 AUD 后 **+ 从供应商到我方仓库的运费**，**不含 GST**。
2. `freight_cost_aud` — 该商品分摊的国际运费（AUD）。
3. `suggested_retail_price` — 按中澳日用品/礼品市场惯例算法给出的建议零售价（**含 GST 的标价**）。
4. `retail_profit` / `retail_margin_pct` — 用 `products.retail_price` 实算的毛利与毛利率。
5. `suggested_retail_profit` / `suggested_retail_margin_pct` — 建议零售价对应的毛利，用于和实际标价对比。

同时新增一张**系统公共变量表**，承载汇率、运费单价、GST 等全局参数，并在 Settings 页提供维护界面（对齐旧 Laravel 系统的 **System Constants** 页）。

**为什么是视图而不是物化列**：汇率和运费单价是会变的，一旦落库成静态列，改一次汇率就要全表回写 3000+ 行且历史值失去意义。视图保证「改一次参数，全站口径立刻一致」。性能上 `products` 仅 3152 行，视图为纯算术 + 一次单行 `CROSS JOIN`，开销可忽略。

**非目标（本轮不做）**：
- 不处理 Kit 商品的成本卷积（Kit 成本 = 组件成本加总，属于独立需求，见 §9）。
- 不做汇率自动抓取（本期手工维护）。
- 不做历史成本快照 / 定价变更审计。

## 2. 系统公共变量

### 2.1 表设计：`public.pricing_settings`（单行表）

采用**强类型单行表**而非 `key/value` 通用配置表：视图里要做算术，`key/value` 表需要多次 `JOIN` + 类型转换，且失去 TypeScript 生成类型的编译期保护（违反规则 3「严禁 any」）。代价是新增变量需要写迁移，这本身符合规则 14。

字段与默认值**直接对齐旧系统 System Constants 页**（截图，最后更新 2026-06-02），保证同事换到新后台时口径与心智模型不变：

| 列 | 类型 | 种子值 | 旧系统标签 | 说明 |
|---|---|---|---|---|
| `id` | `smallint PK` | `1` | — | `CHECK (id = 1)`，物理保证只有一行 |
| `usd_to_aud` | `numeric(12,6)` | `1.5` | USD to AUD | **1 USD = 1.5 AUD**（乘法方向） |
| `aud_to_cny` | `numeric(12,6)` | `4.4` | AUD to CNY | **1 AUD = 4.4 CNY**（除法方向） |
| `gst_rate` | `numeric(6,4)` | `0.10` | GST Rate | 澳洲 GST |
| `air_freight_aud_per_kg` | `numeric(12,2)` | `15` | Air Freight per kg | 空运每**计费公斤** |
| `sea_freight_aud_per_cbm` | `numeric(12,2)` | `240` | Sea Freight per sqm | 海运每**立方米** |
| `air_volumetric_kg_per_cbm` | `numeric(10,2)` | `167` | （旧系统无） | 空运体积重折算：1 cbm ≈ 167 kg |
| `sea_volumetric_kg_per_cbm` | `numeric(10,2)` | `1000` | （旧系统无） | 海运体积重折算：1 cbm = 1000 kg |
| `updated_at` | `timestamptz` | `now()` | Last updated | 由 `moddatetime` trigger 维护（同 `products`） |

两个**必须注意的方向差异**（照搬旧系统，不要想当然）：

- `usd_to_aud = 1.5` 是**乘**：`USD 价 × 1.5`。
- `aud_to_cny = 4.4` 是**除**：`CNY 价 ÷ 4.4`。两个汇率方向相反，这是旧系统的既成事实，为降低同事的迁移成本予以保留；列名已把方向写清楚，公式里不会搞反。

两处**对旧系统的修正**：

- **空运单价是 AUD/kg，不是 AUD/cbm**。你最初的需求描述里空运也是「每个立方」，但旧系统实际按 `$15/kg` 计。这符合国际空运行业惯例（按计费重量收费）。本文按**旧系统的真实口径**实现，即空运走 per-kg、海运走 per-cbm。若你确实想改成空运也按 cbm，说一声，改动仅限 §3.3 一个分支。
- 旧标签 `Sea Freight per sqm` 里的 **sqm 是笔误**（sqm = 平方米），实为 cbm（立方米），其自身的描述文字 "per cubic metre" 已经说明。新页面标签订正为 **Sea Freight per cbm**。

所有数值列加 `CHECK (... > 0)`（`gst_rate` 为 `>= 0 AND < 1`）。

新增的两个体积重折算系数在旧系统没有 —— 因为旧系统很可能压根没做「体积重 vs 实重取大者」。这是本次相对旧系统的能力增强（见 §3.2），系数做成变量而非硬编码，货代改规则时不用动代码。

### 2.2 运费方式：直接读 `origins`，**不加列**

`origins` 的 3 条记录本身就是运费方式（不是地理产地）：

| id | name | abbr | 运费口径 |
|---|---|---|---|
| ? | Sea Freight | `SF` | 海运，按 cbm |
| ? | Air Freight | `AF` | 空运，按 kg |
| ? | Local Purchase | `LP` | 本地采购，**无国际运费，计 0** |

因此**不需要给 `origins` 加 `freight_mode` 列**（第 1 版的设计作废）—— 那会是同一事实存两份，必然出现「name 是 Sea Freight 但 freight_mode 被改成 air」的自相矛盾。视图直接按 `origins.abbr` 分支：

```sql
CASE upper(trim(o.abbr))
  WHEN 'AF' THEN ...空运...
  WHEN 'LP' THEN 0
  ELSE ...海运...        -- SF 及任何未来未知值都按海运，避免 NULL 污染整条成本
END
```

`ELSE` 兜底到海运而不是 `NULL`：`NULL` 会让 `unit_cost` / 利润全列变 `NULL`，比「按最常见方式估算」更糟。Origins 管理页当前是只读的，`abbr` 不会被随手改。

## 3. 计算公式

以下每一步都是视图中的一个表达式，`s` = `pricing_settings`，`p` = `products`，`o` = `origins`。

### 3.1 采购价 → AUD（不含税）

`is_gst` 的语义已确认：**仅当 `currency = 'AUD'` 时生效**，表示该 AUD 采购价是**含 10% 澳洲 GST 的含税价**，需剥离；`CNY` / `USD` 采购一律忽略该开关。

```
purchase_price_aud =
  CASE p.currency
    WHEN 'AUD' THEN p.purchase_price / (CASE WHEN p.is_gst THEN 1 + s.gst_rate ELSE 1 END)
    WHEN 'CNY' THEN p.purchase_price / s.aud_to_cny          -- 注意是除
    WHEN 'USD' THEN p.purchase_price * s.usd_to_aud          -- 注意是乘
  END
```

`currency` 或 `purchase_price` 为 `NULL` 时整条结果为 `NULL`（NULL 自然传播），下游成本/利润列一并为 `NULL` —— 这是正确行为：缺数据的商品不应伪造一个成本。

### 3.2 体积与计费量

尺寸单位是 **mm**，1 m³ = 1e9 mm³：

```
volume_cbm = p.length * p.width * p.height / 1000000000
```

**计费量按运费方式分别取「体积重 vs 实重孰高」**（已确认）：货代实际就是这么计费的。纯按体积会严重低估五金、陶瓷等重货的成本；纯按重量会低估枕头、纸巾等抛货。

```
海运 chargeable_cbm = GREATEST(volume_cbm, p.weight / s.sea_volumetric_kg_per_cbm)   -- ÷1000
空运 chargeable_kg  = GREATEST(p.weight, volume_cbm * s.air_volumetric_kg_per_cbm)   -- ×167
```

### 3.3 运费

```
freight_cost_aud =
  CASE upper(trim(o.abbr))
    WHEN 'AF' THEN chargeable_kg  * s.air_freight_aud_per_kg
    WHEN 'LP' THEN 0
    ELSE           chargeable_cbm * s.sea_freight_aud_per_cbm
  END
```

按种子值代入，空运折合 `167 × $15 = $2505/cbm`，是海运 `$240/cbm` 的 10.4 倍 —— 与真实市场的空海运价差量级一致，可作为参数录错时的一个快速自检。

### 3.4 Unit Cost

```
unit_cost_aud = purchase_price_aud + freight_cost_aud     -- 不含 GST
```

### 3.5 建议零售价

见 §4。

### 3.6 利润（已确认口径）

`products.retail_price` 视为**含 GST 的货架标价**，先剥离 GST 得到不含税收入，再减不含 GST 的 unit cost：

```
retail_profit      = p.retail_price / (1 + s.gst_rate) - unit_cost_aud
retail_margin_pct  = retail_profit / (p.retail_price / (1 + s.gst_rate)) * 100
```

`suggested_retail_profit` / `suggested_retail_margin_pct` 用同一公式，把 `p.retail_price` 换成 `suggested_retail_price`。

> 注：进口环节实际缴纳的 GST 在澳洲通常可作为**进项税抵扣**，因此不计入成本侧；这与本文采用的口径一致。

### 3.7 数值精度与「体积太小没法看」

一个 60×40×20mm 的小件是 `0.000048 m³`。直接把 `0.000048` 打在页面上没人读得懂，这是真实的展示问题，分三层解决：

**① 计算层不动精度。** 视图内部全程用未舍入的 `numeric` 参与运算，只在**最外层 SELECT** 对金额列 `ROUND(..., 2)`。若中途就舍入，$0.096 的运费会被抹成 $0.10，3000 个 SKU 累计误差不可忽略。

**② 视图输出保留足够小数。** `volume_cbm` / `chargeable_cbm` 输出 `ROUND(..., 6)`（1e-6 m³ = 1 cm³，对最小的商品也够分辨）；`chargeable_kg` 输出 `ROUND(..., 3)`（克级）。

**③ 展示层按量级自适应换算单位。** 新建 `formatVolume(cbm)`（放 `src/lib/pricing.ts`）：

| 量级 | 显示单位 | 示例 |
|---|---|---|
| `>= 0.1 m³` | m³，3 位小数 | `0.352 m³` |
| `[0.001, 0.1) m³` | L（升，×1000），2 位小数 | `4.80 L` |
| `< 0.001 m³` | cm³（×1e6），整数 | `48 cm³` |

同时在详情页把**计费依据**显式写出来，而不是只给一个数字，例如：

- 海运件：`Volume 4.80 L · Weight 1.20 kg → chargeable 0.0048 m³ (by volume) × $240 = $1.15`
- 空运件：`Volume 4.80 L · Weight 1.20 kg → chargeable 1.20 kg (by weight) × $15 = $18.00`

括号里的 `(by volume)` / `(by weight)` 说明这次是哪一边胜出。这比单纯显示一个小数更能解释成本，也让参数录错时一眼能看出来。

## 4. 建议零售价算法

### 4.1 行业依据

澳洲进口日用品 / 礼品（中国采购）的通行定价逻辑不是固定加成，而是**按落地成本分档的倍率（tiered markup）**，原因有三：

1. **固定履约成本不随货值缩放**。拣货、包装、平台上架费、退货处理每单大致恒定（约 $3–6），低值品若用同样倍率会被这笔固定成本吃光利润，所以越便宜的商品倍率必须越高。
2. **价格心理带**。澳洲零售存在明显的价格带（$9.95 / $19.95 / $49.95），落地成本 $2 和 $2.6 的商品往往卖同一个价，倍率天然不连续。
3. **高值品的价格弹性更高**。$150 的商品消费者会跨店比价，倍率必须收敛，否则失去竞争力。

对标参照：Kmart / Target Australia 的自有进口品毛利率普遍在 55–70%，礼品专营店（如 Typo、Smiggle）低值 SKU 可达 75–80%。下表按此区间设定。

### 4.2 倍率档位（已确认直接采用，下阶段再校准）

倍率作用于**不含 GST 的 unit cost**，得到不含 GST 的零售价，再乘 `(1 + gst_rate)` 得到货架标价。

| 落地成本区间（AUD, ex-GST） | 倍率 | 隐含毛利率 |
|---|---|---|
| `[0, 2)` | 5.0 | 80% |
| `[2, 5)` | 4.0 | 75% |
| `[5, 15)` | 3.2 | 69% |
| `[15, 40)` | 2.6 | 62% |
| `[40, 100)` | 2.2 | 55% |
| `[100, ∞)` | 1.9 | 47% |

档位**存表不写死**：新建 `public.pricing_markup_tiers (id, min_cost, max_cost, multiplier)`，视图用 `LEFT JOIN LATERAL` 取匹配档位。这样下阶段校准时在 Settings 页改数即可，不必写迁移。`max_cost` 允许 `NULL` 表示无上界；迁移内种入上表 6 行。

上线后建议立刻跑一次**反算**：`retail_price / (1+gst) / unit_cost_aud` 的分布，看自己历史定价的真实倍率落在哪，再回来调这 6 个数。视图上线后这个查询是一行 SQL。

### 4.3 心理价位取整 `charm_price()`

原始值 `unit_cost × multiplier × (1 + gst_rate)` 会得到 `23.7184` 这类数字，需收敛到澳洲惯用的 `.95` 结尾。

**规则：整数元不动，分位固定为 `.95`。**

```
charm(x) = floor(x) + 0.95
```

没有 step 档位、没有价格网格 —— 之前两版（`ceil` 到 0.5/1/5 元网格、`round` 到最近网格点）都被 `24.10 → 24.95` 与 `19.99 → 19.95` 这两个点否掉了：前者要求向上 0.85，后者要求向下 0.04，任何「就近」或「向上」的单一方向都解释不了。真正的规则是**只改分位、不动元位**。

| 输入 | 输出 | 移动 |
|---|---|---|
| `24.10` | `24.95` | ↑ 0.85 |
| `23.72` | `23.95` | ↑ 0.23 |
| `7.23` | `7.95` | ↑ 0.72 |
| `137.40` | `137.95` | ↑ 0.55 |
| `19.99` | `19.95` | ↓ 0.04 |
| **`19.95`** | **`19.95`** | **0（幂等）** |

三个由此确定的性质：

- **幂等**。`floor(19.95) = 19`，再 `+0.95` 还是 `19.95`，反复失焦不漂移。
- **方向由分位决定**：分位 `< 95` 一律**上抬**（最多 0.95），分位 `> 95`（即 `.96`–`.99`）一律**下压**（最多 0.04）。这正是你给的两个例子。
- **元位绝不跨越**。`$19.xx` 永远留在 19 元档，不会跳到 20 元档，所以不存在「建议价莫名跨了一个价格带」的意外。

对毛利的影响可忽略：最坏情况下压 0.04 元，最低倍率档还有 1.9x，不可能跌破成本，无需保护下限。

> 若之后想让高价商品也落到 `$139.95` / `$149.95` 这类 5 元整档，那是在本函数之外再叠一层「元位取整」，届时单独提；本轮不做，保持规则单一可预测。

### 4.4 手工输入的零售价也自动收敛（已确认）

不只是建议价，用户在**详情页 Pricing 分区手工输入 `Retail Price`** 后，失焦时也走同一个函数：输入 `24.10` → 失焦变 `24.95`，输入 `19.99` → 失焦变 `19.95`，字段下方给一行浅色提示 `Snapped from 24.10`。

这意味着 `charm_price` 需要 **SQL 和 TypeScript 两份实现**：

- SQL：`public.charm_price(numeric) RETURNS numeric`，`IMMUTABLE`，供视图算建议价。
- TS：`charmPrice(value: number): number`，放 `src/lib/pricing.ts`，供表单实时收敛。

两份实现必须永远一致，否则会出现「表单收敛到 24.95、视图建议价却是 23.95」的诡异现象。为此新增 **CLAUDE.md 规则 17**（原规则 13 是从其他项目带来的、引用文件在本仓库并不存在，已按你的确认删除，14–16 顺次上移）：规定改任一侧必须同步另一侧并补测试。

落地规则 17 需要真正把 **Vitest 装起来** —— 项目当前无任何测试框架，`package.json` 没有 `test` 脚本。

浮点数注意：TS 侧用 `Math.floor(x)` 取元位后，结果用 `Math.round(v * 100) / 100` 归一到整数分，避免 `19 + 0.95` 得到 `19.949999999999996`。SQL 侧 `numeric` 是精确十进制，无此问题，但仍显式 `::numeric(12,2)` 输出，保证两侧字面量完全一致。

`floor` 的一个前提：本函数只对**正数**有定义。零售价为 `NULL` 或 `<= 0` 时直接原样返回，不做收敛（`floor(-0.3) = -1` 会得到 `-0.05` 这种无意义结果）。测试用例需覆盖。

## 5. 视图定义

```sql
CREATE VIEW public.product_pricing
WITH (security_invoker = true) AS
SELECT ... FROM public.products p
JOIN public.origins o ON o.id = p.origin_id
CROSS JOIN public.pricing_settings s
LEFT JOIN LATERAL (
  SELECT t.multiplier FROM public.pricing_markup_tiers t
  WHERE unit_cost_aud >= t.min_cost AND (t.max_cost IS NULL OR unit_cost_aud < t.max_cost)
  LIMIT 1
) tier ON true
WHERE p.is_kit = false;
```

要点：

- **`security_invoker = true` 必须加**。Postgres 视图默认以**所有者**权限执行，会绕过底层表的 RLS。本项目 `products` / `origins` 都启用了 RLS 且仅对 `authenticated` 开放，视图若不加这个选项就成了越权读取通道。
- 中间量（`purchase_price_aud`、`volume_cbm`、`chargeable_*`、`unit_cost_aud`）用**嵌套子查询逐层展开**，避免同一表达式在 `suggested_retail_price` / `profit` / `margin` 里重复三遍。
- `WHERE p.is_kit = false` —— Kit 商品的成本是组件卷积，公式完全不同，本视图不覆盖。**下阶段的占位符见 §5.1。**
- 输出列一并带上 `sku` / `name` / `brand_id` / `image_url` / `is_active` / `currency` / `purchase_price` / `retail_price` / `origin_abbr`，让**列表页可直接查视图**，不必再关联 `products`（见 §6.2 的 C 项改造）。
- 额外输出 `chargeable_basis text`（`'volume'` / `'weight'` / `'none'`），供 §3.7 的展示层说明是哪一边胜出。
- `GRANT SELECT ON public.product_pricing TO authenticated;`

### 5.1 Kit 的占位符（已确认：算法不同，下阶段做）

> **后续进展（2026-07-29）**：Kit 卷积方案已单独立文档 —— **`docs/product-kit-pricing.md`**，本节的三处占位在那里被接管。一处需修正的预判见该文 §6.1：Kit 分支不能直接对本视图做 `UNION ALL`（会构成自引用），必须先把非 Kit 那段拆成独立视图。

Kit 成本 = 组件成本卷积，公式与本视图完全不同，本轮不实现。但**留三处占位**，让下阶段接入时不必推翻已有结构：

**① 视图层：`WHERE p.is_kit = false` 集中在最外层一处**，且不在中间子查询里散落该条件。下阶段只需把它改成 `UNION ALL` 一段 Kit 分支（或新建 `product_kit_pricing` 视图再合并），现有非 Kit 分支的表达式一行都不用动。

**② UI 层：详情页 Pricing 面板对 Kit 商品渲染占位卡片**，而不是空白或报错：

```
Kit pricing is calculated from its components.
Component-level cost roll-up is coming in the next phase.
```

判断依据是 `product.is_kit`，不依赖视图返回空行 —— 视图查不到和「这是 Kit」是两回事，前者是数据缺失（该报警），后者是设计如此（该解释）。

**③ 列表层：Kit 行保留、成本列显示 `—`**（见 §6.2 的说明），不能让 Kit 从列表消失。

下阶段真正实现时需要先定的两件事（现在不必回答，记录在此）：**（a）** Kit 运费按整体装箱尺寸还是组件尺寸之和 —— 前者更准但 `products` 上没有 Kit 自己的装箱尺寸；**（b）** 组件本身也是 Kit 时是否递归（当前 `product_kit_items` 的约束只挡了自引用，没挡多层嵌套）。

> 这两问已在 `docs/product-kit-pricing.md` 回答：**（a）** Kit 定性为 Local Purchase，国际运费恒为 0（组件进口时各自已摊过），所以装箱尺寸不参与成本，只用于展示与将来的出库运费；**（b）** 不递归，组件是 Kit 时整个套装成本输出 NULL 并明确提示（当前数据 0 例）。

## 6. 落地文件

### 6.1 迁移（`supabase/migrations/`，均需 `BEGIN;` / `COMMIT;`）

| 文件 | 内容 |
|---|---|
| `2026072910xxxx_create_pricing_settings.sql` | `pricing_settings` 表 + `CHECK` + RLS + `moddatetime` trigger + 种子行（§2.1 的值） |
| `2026072911xxxx_create_pricing_markup_tiers.sql` | 档位表 + `CHECK` + RLS + 种入 6 行 |
| `2026072912xxxx_create_product_pricing_view.sql` | `charm_price()` 函数 + `product_pricing` 视图 + `GRANT` |

比第 1 版少一个迁移 —— `origins` 不再加列。

> **实现时新增了第 4 个迁移** `20260729130000_create_product_list_pricing_view.sql`，原因见 §10.1①。本节及 §7 保留为「计划原文」，实际落地以 §10 为准。

### 6.2 应用层

| 文件 | 动作 |
|---|---|
| `src/lib/supabase/database.types.ts` | 重新生成（新增 2 表 1 视图） |
| `src/lib/pricing.ts` | **新建**，`charmPrice()`（SQL 镜像）+ `formatVolume()` + `formatMoney()` |
| `src/lib/__tests__/pricing.test.ts` | **新建**，覆盖 §4.3 表格全部用例 + 幂等性 + 上抬/下压两个方向 + 非正数原样返回 |
| `vitest.config.ts` / `package.json` | **新增 Vitest**（项目当前无测试框架） |
| `src/lib/validations/pricing-settings.ts` | 新建，`pricing_settings` 的 Zod schema |
| `src/lib/actions/pricing-settings.ts` | 新建，`updatePricingSettings`，返回 `ActionResult` |
| `src/lib/queries/product-pricing.ts` | 新建，`fetchPricingSettings()` / `fetchProductPricing(id)`，并扩展列表查询 |
| `src/app/(dashboard)/settings/page.tsx` | 占位页 → 真实设置页 |
| `src/app/(dashboard)/settings/_components/pricing-settings-form.tsx` | 新建，`react-hook-form` + Zod + `sonner`，标签对齐旧 System Constants |
| `src/app/(dashboard)/products/[id]/_components/product-pricing-panel.tsx` | 新建，成本拆解面板 |
| `src/app/(dashboard)/products/[id]/_components/product-detail-tabs.tsx` | 挂载新面板 |
| `src/app/(dashboard)/products/[id]/_components/product-fields.ts` | `retail_price` 字段接入 §4.4 的失焦收敛 |
| `src/lib/queries/products.ts` | **C 项已确认**：列表页取数改走 `product_pricing` 视图，`LIST_COLUMNS` 增补 `unit_cost_aud` / `retail_margin_pct` |
| `src/app/(dashboard)/products/_components/*` | 列表新增 Unit Cost / Margin 两列 + 「毛利率低于 X%」筛选 |
| `CLAUDE.md` | 新增规则 17（`charm_price` 的 SQL↔TS 同步约束）；规则 13 已按确认删除、14–16 顺次上移 |

**列表页改造的一个副作用需注意**：视图带 `WHERE is_kit = false`，直接换数据源会让 Kit 商品从列表消失，而列表页现有 `isKit` 筛选器依赖它们存在。因此列表查询保持从 `products` 出发，用 `LEFT JOIN` 语义拉视图列（PostgREST 侧即 `select("..., product_pricing(unit_cost_aud, retail_margin_pct)")`，需要给视图配 FK 提示或改为 `products` 左连视图的第二个视图）。这一处的具体实现方式在写代码时敲定，功能上保证：**Kit 仍在列表中，只是成本列为空**。

## 7. 开发步骤

1. 写 3 个迁移文件 → `npx supabase db push --db-url "$DATABASE_URL"` 推送（取值方式见 CLAUDE.md 规则 16，**严禁 `source .env.local`**）。
2. 推送后用真实数据抽查：至少各挑 1 条 SF / AF / LP 商品，以及「体积重 > 实重」和「实重 > 体积重」各一条，手工核对 `freight_cost_aud`、`unit_cost_aud`、`suggested_retail_price`。
3. 重新生成 `database.types.ts`。
4. 建 Vitest + `src/lib/pricing.ts` + 测试；`npm test` 通过后再写 UI。
5. Settings 页 —— System Constants 维护表单（Zod 双重校验、`sonner` 反馈）。
6. 商品详情页 —— Pricing Breakdown 面板 + `Retail Price` 失焦收敛。
7. 商品列表页 —— Unit Cost / Margin 列与低毛利筛选。
8. 补 CLAUDE.md 规则 17。
9. 跑一次倍率反算，把结果贴回本文档 §4.2，供下阶段校准。

## 8. 验收要点

- [ ] LP（Local Purchase）商品运费为 0，`unit_cost` 等于剥税后的采购价。
- [ ] AF 商品的运费 = `max(实重, 体积×167) × $15`，且详情页写明是 by weight 还是 by volume。
- [ ] `currency = 'AUD'` 且 `is_gst = true` 的商品，`purchase_price_aud` = 录入价 ÷ 1.1。
- [ ] CNY 商品用**除以** 4.4，USD 商品用**乘以** 1.5，没搞反。
- [ ] 60×40×20mm 的小件在页面上显示为 `48 cm³` 而不是 `0.000048 m³`。
- [ ] 手工输入 `24.10` 失焦后变 `24.95`（元位不变）；输入 `19.99` 变 `19.95`（**能降**）；再次失焦不再移动（幂等）。
- [ ] Kit 商品仍出现在列表页，成本列显示 `—` 而不是整行消失。
- [ ] Kit 详情页 Pricing 面板显示占位说明文案，而不是空白或报错。
- [ ] 用未登录的 anon key 查 `product_pricing` 返回 0 行（`security_invoker` 生效）。

## 9. 后续（本轮不做）

- ~~**Kit 成本卷积**~~：已立项，见 **`docs/product-kit-pricing.md`**（2026-07-29）。结论与此处原先的设想有一点不同：Kit 按 **Local Purchase** 处理，国际运费为 0，因此「Kit 整体装箱尺寸 vs 组件尺寸之和」不影响成本，只影响展示。
- **汇率自动更新**：可由 Trigger.dev 定时任务拉取汇率写入 `pricing_settings`（规则 4）。
- **成本历史快照**：若需要「按当时汇率」的历史毛利分析，需在订单行上冻结成本，而非依赖本视图。
- **倍率档位校准**：见 §4.2 反算。

## 10. 实现记录与偏差（2026-07-29）

### 10.1 相对计划的三处偏差

**① 多了一个迁移：`product_list_pricing` 视图（共 4 个，非 3 个）**

§6.2 原计划让列表页仍从 `products` 出发、再想办法拉视图列，具体方式「写代码时敲定」。实际写到那一步发现两条路都不通：

- 按 id 两步查：低毛利筛选可能命中两千多个 id，塞进 PostgREST 的 GET URL 会超长。
- PostgREST 内嵌：视图没有外键可供 `products` 内嵌，`brand_name` 也拿不到。

更根本的问题是**筛选必须和分页在同一条查询里**，否则总数和页码都是错的。所以新增 `public.product_list_pricing`：`products LEFT JOIN brands LEFT JOIN product_pricing`。Kit 因为是 LEFT JOIN 而保留、成本列为 `NULL`，正好满足「Kit 不能消失」的约束，且列表查询代码反而比原方案更简单。

**② `supabase gen types` 用不了，类型改为手工补齐**

`gen types` 会拉 `postgres-meta` 容器，本机无 Docker/Podman，命令失败。更危险的是它**失败时仍然退出并输出空内容**，`> database.types.ts` 直接把文件清空了（已 `git checkout` 恢复）。该文件顶部原本就写明是手工维护的，本次按同样方式手工补齐 2 表 2 视图 1 函数。已为此新增 **CLAUDE.md 规则 18**。

**③ 规则编号：`charm_price` 同步规则落在 17，另加了规则 18**

### 10.2 真实数据验证结果

推送后逐条手工验算，四个分支（SF/AF × volume/weight）加 LP、AUD 剥税各取一条样本：

| SKU | 校验路径 | unit cost |
|---|---|---|
| GB01254AF | 0.00018cbm；体积重 0.03006kg > 实重 0.030kg → volume；×$15=$0.45；¥3.2÷4.4=$0.73 | $1.18 ✓ |
| GB00385SF（AF） | 体积重 0.0035kg < 实重 0.010kg → weight；×$15=$0.15 | $0.49 ✓ |
| JTC00004LP | AUD 含税 3.39÷1.1；运费 0 | $3.08 ✓ |
| GB00001SF | 0.00084cbm×$240=$0.20；¥6.5÷4.4=$1.48 | $1.68 ✓ |
| GB00011SF | 8×5×3mm=1.2e-7cbm，实重档 0.00001cbm 胜出，$0.0024→$0.00 | $0.10 ✓ |

- 分布：SF 2004 条、AF 424 条、LP 54 条，共 2482 条非 Kit，`unit_cost_aud` **无一为 NULL**。
- `product_list_pricing` 共 3122 行 = 2482 非 Kit + **640 Kit**，Kit 全部保留且成本列为 NULL。
- `charm_price` SQL 与 TS 对同一组 12 个输入（含 `19.99`/`19.95`/`0`/`-0.30`）**逐值一致**。
- anon key 查 `product_pricing` / `product_list_pricing` / `pricing_settings` / `pricing_markup_tiers` 均返回 **0 行**，`security_invoker` 生效。

### 10.3 一个需要业务侧决定的数据现状

非 Kit 商品中 **`retail_price = 0` 的有 1491 条**（占 60%），`retail_price > 0` 的只有 991 条，无一条为 NULL。这些 0 价商品的 `retail_margin_pct` 为 NULL（视图用 `NULLIF` 挡掉了除零），列表和详情页显示 `—`。

这不是计算问题，是**存量数据问题**：这批商品从未设过零售价，Laravel 时期用 0 代替空值。视图已经给出了它们的 `suggested_retail_price`，可以作为批量补价的依据。是否要批量回填、以及用建议价还是人工定价，属于业务决策，未在本轮处理。

## 11. 修订记录

**2026-07-29 第 4 版**（`charm_price` 定案）

| 项 | 第 3 版 | 第 4 版 |
|---|---|---|
| `charm_price` | `round` 到 0.5 / 1 / 5 元网格的最近点 | **推翻**。`24.10 → 24.95`（↑0.85）与 `19.99 → 19.95`（↓0.04）无法用任何「就近 / 向上」的网格规则同时满足。定案为 **`floor(x) + 0.95`**：元位不动、分位固定 95。取消全部 step 档位，规则更简单也更可预测（详见 §4.3） |

**2026-07-29 第 3 版**（据第二轮反馈修订）

| 项 | 第 2 版 | 第 3 版 |
|---|---|---|
| CLAUDE.md 规则 13 | 指出其引用文件不存在 | **已删除**（确认属其他项目遗留）。原 14/15/16/17 顺次上移为 13/14/15/16，`docs/` 4 个文件 + `scripts/migration/` 2 个脚本共 12 处引用已同步更新。新的 `charm_price` 同步约束将占用规则 17 |
| `charm_price` 取整方向 | `ceil`，只升不降 | **改为 `round`，就近取整可升可降**：`19.99 → 19.95`（原会推到 `20.95`）。幂等性仍成立 |
| Kit | 仅在「后续」章节一句话带过 | **新增 §5.1 占位符**：视图层 `WHERE` 条件集中一处便于日后加 `UNION ALL` 分支、详情页渲染占位卡片、列表页 Kit 行保留成本列显 `—`；并记录下阶段需先定的两个问题 |

**2026-07-29 第 2 版**（据第一轮反馈修订）

| 项 | 第 1 版 | 第 2 版 |
|---|---|---|
| 运费方式来源 | 给 `origins` 加 `freight_mode` 列 | **推翻**。`origins` 的 name 本身就是运费方式（Sea/Air/Local Purchase），加列会造成同一事实两份、可能自相矛盾。改为视图内按 `abbr` 分支 |
| 空运计费单位 | AUD / cbm | **改为 AUD / kg**，对齐旧系统 System Constants 的 `$15/kg` 与空运行业惯例 |
| 汇率字段 | `cny_to_aud` / `usd_to_aud`（同为乘法） | 改为 `aud_to_cny = 4.4`（除） / `usd_to_aud = 1.5`（乘），照搬旧系统方向 |
| 体积展示 | 未涉及 | 新增 §3.7：计算不舍入、输出 6 位小数、展示层按量级自适应 m³ / L / cm³，并显式标注计费依据 |
| `charm_price` 适用范围 | 仅建议零售价 | 扩展到**手工输入的零售价失焦自动收敛**，因此需 SQL + TS 双实现、Vitest 与 CLAUDE.md 规则 17 |
| 倍率档位 | 待定 | **确认直接采用** §4.2 六档，下阶段反算校准 |
| 列表页成本列 | 待定 | **确认加入**，附带 Kit 行不能消失的约束 |
| 种子值 | 待定 | 确认按旧系统 System Constants 截图 |
| 迁移文件数 | 4 | 3（`origins` 不再加列） |
