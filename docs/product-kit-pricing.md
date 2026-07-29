# 商品套装（Kit）成本卷积与派生属性 — 开发文档

> 状态：**已实现**（2026-07-29）—— 2 个迁移已推送远端并用真实数据验证，`npm test` / `npm run build` / `eslint` 通过。实现期间的偏差见 §12。
> 创建日期：2026-07-29
> 前置文档：`docs/product-pricing-view.md`（非 Kit 商品的成本/建议价引擎，§5.1 为本轮留了占位）、`docs/product-kits-migration.md`（`product_kit_items` 的建模与数据）

## 1. 目标

`public.product_pricing` 视图当前带 `WHERE p.is_kit = false`，640 个套装商品完全没有成本、建议价和毛利。本轮补上这一块：**套装的一切定价输入都从它的组件行卷积得到**，而不是靠人工在套装商品上再录一遍采购价和箱规。

需求方给出的规则（原文转述）：

| 派生项 | 规则 |
|---|---|
| `unit_cost` | 所有组件 unit cost 之和 |
| 重量 | 所有组件重量之和 |
| `length` | 所有组件中**最长的一条边** |
| `width` | 所有组件中**第二长的一条边** |
| `height` | 组件体积之和 ÷（length × width） |
| 产地 / 运费方式 | **Local Purchase**（LP） |
| 采购价 | `currency = AUD`、`is_gst = false`、数值 = 卷积出的 unit cost |
| 其余 | 沿用普通商品的自动计算 |

并附问题：「其他的应该就能匹配上普通商品自动计算了，是不是？」

## 2. 先回答那个问题：是的，能完全匹配

把上表代进 `docs/product-pricing-view.md` §3 的既有公式，逐步验证：

| 步骤 | 既有公式 | 代入套装后 |
|---|---|---|
| §3.1 采购价换 AUD | `currency='AUD'` 时 `purchase_price / (is_gst ? 1+gst : 1)` | `is_gst=false` → **除以 1**，`purchase_price_aud` = 卷积成本，原值穿透 ✓ |
| §3.3 运费 | `abbr='LP'` → `0` | 运费 **0** ✓ |
| §3.4 Unit Cost | `purchase_price_aud + freight` | = 卷积成本 ✓ |
| §4.2 倍率档 | 按 `unit_cost_aud` 落档 | 照常 ✓ |
| §4.3 `charm_price` | 作用在建议价上 | 照常 ✓ |
| §3.6 毛利 | 用套装自己的 `products.retail_price` | 照常 ✓ |

所以**不需要为套装写第二套定价公式**，只需要造出四个输入（`unit_cost` / `weight` / `L·W·H` / 运费方式=LP），后面整条链路原样复用。这也正是 §5.1 占位符设计时预期的接法。

**但由此产生一个必须说明的推论：LP 的运费恒为 0，所以卷积出来的重量和三边尺寸对套装成本没有任何影响。** 它们只服务于三件事：详情页展示、未来的出库运费、以及导出/上架时的箱规。别以为改尺寸规则会改价格——不会。

这个「LP」定性本身也是对的：组件在进口时各自已经把海运/空运摊进了自己的 unit cost，套装是在本地组装的，不该再收一次国际运费。

## 3. 现状核查（2026-07-29 连远端库 `nszriuqpumbyigxwtccs` 实测）

### 3.1 结构与数据完整性

| 指标 | 值 | 含义 |
|---|---|---|
| `is_kit = true` 的商品 | **640** | 比 `docs/product-kits-migration.md` 记录的 639 多 1（期间新建过） |
| 有组件行的套装 | **616** | 明细共 699 行 |
| **空套装** | **24** | 有 `is_kit` 标记、无任何组件行 |
| `qty > 1` 的明细行 | **599 / 699** | **绝大多数**，见 §4.1 |
| 组件本身是套装（嵌套） | **0** | DB 层不禁止，当前数据为 0 |
| 组件在 `product_pricing` 里没有 unit cost | **0** | 所有组件都能算出成本 |
| 卷积成本区间 | **$0.00 – $53.88** | 无 NULL |
| 停用套装 | 4 | — |
| `retail_price > 0` 的套装 | **84 / 640** | 其余 556 个毛利列将为 NULL（同 §10.3 的存量问题） |

### 3.2 套装商品当前存的字段是什么（关键）

```
origin  currency  is_gst   套装数   purchase_price 为 0   weight 为 0   有一边为 0
SF      AUD       true      575          575               517           573
SF      CNY       false      61           19                 2            17
LP      AUD       true        3            0                 0             0
LP      AUD       false       1            0                 0             0
```

两类截然不同的存量：

- **575 个 SF/AUD/含税 且采购价、重量、尺寸基本全是 0** —— 旧系统从没填过，纯占位垃圾值。
- **61 个 SF/CNY** —— 其中 42 个有真实 CNY 采购价、59 个有真实重量、44 个有真实箱规。抽样比对后确认：**旧 Laravel 系统已经在做卷积并把结果写回了套装的 `purchase_price`（以 CNY 计）**：

  | SKU | 存的 CNY 价 ÷ 4.4 | 本轮卷积（含组件运费） |
  |---|---|---|
  | BT02952SF_12 | $43.36 | $43.68 |
  | BT02951SF_12 | $34.09 | $34.44 |
  | RE02782SF | $28.41 | $28.40 |
  | GB02566SF | $35.45 | $37.62 |

  差额来自旧系统只加总**采购价**、本轮加总的是**含运费的落地成本**，量级 0%–6%，方向一致。这既验证了规则本身，也说明**写回是旧系统的做法，并且已经开始腐烂**——汇率一改，这些冻结在 `purchase_price` 里的数就错了（详见 §4.2）。

### 3.3 尺寸规则的两种读法，用真实数据判优

「所有产品中最长的长度」有两种理解：

- **A（全局池）**：把所有组件的 3N 条边放一起，取最大 → `length`，次大 → `width`。
- **B（逐件排序）**：每个组件先把自己三边降序排成 `d1 ≥ d2 ≥ d3`，取 `max(d1)` → `length`，`max(d2)` → `width`。

616 个套装实测：`length` **616 个全部相同**；`width` **26 个不同**，且不同时 A 的底面积平均是 B 的 **1.49 倍**。

B 更对：B 保证「每个组件都能平躺进这个底面」，A 会在两条最长边碰巧来自同一个细长件时把底面撑大。反例：A 件 300×20×10、B 件 250×240×5 —— 读法 A 得 300×250（多出 10mm 宽是凭空的），读法 B 得 300×240（刚好装得下两件）。

**已确认采用 B**，它是需求原话在物理上唯一自洽的实现。

### 3.4 派生 height 的健康度

按 `Σ体积 / (L × W)` 实算 616 个套装：

- 取值区间 **1.44mm – 1500mm**，量级正常。
- **0 个**套装的派生 height 小于任一组件的最薄边 —— 也就是说这个「等体积高度」在当前数据上没有出现「盒子比里面的东西还矮」的荒谬结果。
- **26 个套装底面积为 0**（含有三边中至少一边为 0 的组件）→ **除零**。必须挡，见 §4.4。

需要写明的口径：这个 height 是**等体积高度**，不是装箱高度——它假设零空隙、零包装材料。因为 LP 运费为 0，今天它不影响任何金额；将来接出库运费时要重新评估（§9）。

## 4. 需求没覆盖、必须定的六件事

### 4.1 `qty` 必须计入（需求原文没提）

699 行明细里 **599 行 `qty > 1`**。因此：

- **成本、重量、体积按 `qty` 加权求和**：`sum(qty * x)`。
- **尺寸不乘 `qty`**：最大值就是最大值，同一个组件放 5 个不会让它变长。

### 4.2 存回 `products` 还是走视图 —— **建议走视图，一个字段都不写回**

需求描述读起来像是要把这些值写进套装的商品记录（`origin_id` / `currency` / `is_gst` / `purchase_price` / `weight` / `length` / `width` / `height`）。不建议，理由是硬的：

**组件的 `unit_cost_aud` 依赖汇率和运费单价**（`pricing_settings`）。一旦把卷积结果写进 `products.purchase_price`，汇率一改，640 个套装全部变成陈旧值——这正是 `docs/product-pricing-view.md` §1「为什么是视图而不是物化列」的同一条理由，也正是 §3.2 那 61 个 CNY 套装现在的处境（旧系统写回了，现在没人知道那是哪天的汇率算的）。

即便是不依赖汇率的重量和尺寸，写回也要维护两条触发链：组件行增删改要回写、**组件自身的重量/尺寸被编辑也要回写到每一个引用它的套装**。视图零成本地免掉这一切。

代价是 `products` 表里套装行的这 8 个字段仍是历史垃圾值、且永远不会被用到。这个代价的处理见 §4.3。

### 4.3 套装详情页的这 8 个字段怎么呈现（已确认）

既然值来自视图，Overview tab 的表单就不能让人编辑一批「填了也没用」的字段。**已确认：套装商品的 `origin_id` / `currency` / `purchase_price` / `is_gst` / `weight` / `length` / `width` / `height` 在表单中置为只读**，并展示视图算出的派生值 + 一行说明 "Derived from kit components"。

`products` 里的存量垃圾值保持不动（不清洗、不迁移）：清洗它等于承认那批字段还有意义，反而更容易误导。

### 4.4 空套装、除零、NULL 传播 —— 三个必须显式挡的洞

| 情况 | 当前数量 | 不挡会怎样 | 处理 |
|---|---|---|---|
| 空套装（无组件行） | 24 | `sum()` 返回 NULL，但若写成 `coalesce(...,0)` 则 unit cost = 0 → 落进 `[0,2)` 档 ×5.0 → 建议价 **$0.95**，一个看起来正常的假数 | 全部成本列输出 **NULL**，UI 显示 "Add components to calculate cost" |
| 底面积为 0 | 26 | `除零` | `L*W = 0` 时 `height` / `volume_cbm` 输出 NULL（LP 下不影响成本） |
| 某组件算不出 unit cost | 当前 0 | **`sum()` 会静默跳过 NULL 行**，给出一个偏低的、看起来完全正常的总额 | 用 `count(*) = count(pp.unit_cost_aud)` 守卫：只要有一行缺成本，整个套装的成本列输出 NULL |

第三条是本轮最容易踩的坑：`sum(NULL)` 不报错、不返回 NULL，只是少加一项。今天为 0 行不代表明天为 0 行（新建商品可以不填采购价）。

### 4.5 嵌套套装：不递归，但要能发现

`product_kit_items` 只挡了自引用，没挡多层嵌套（`docs/product-kits-migration.md` §10）。本轮的卷积从**非 Kit 成本视图**取组件成本，因此**组件若是套装则查不到行** → 触发 §4.4 第三条守卫 → 整个套装成本为 NULL，UI 提示 "A component is itself a kit, which is not supported."

当前 0 行，属于防御。真要支持递归得先解决循环引用检测，不在本轮。

### 4.6 那 61 个 SF/CNY 套装也强制走 LP（已确认）

它们自带供应商报价和自己的箱规，看起来是**由供应商在中国整套装箱后整体进口**的，不是本地组装。对它们套用「LP + 组件卷积」意味着：

- 丢掉供应商给的整套报价（改用组件成本之和，实测差 0%–6%，量级可接受）；
- 运费按**各组件分别计费**加总，而整体装箱的实际运费通常更低（空隙少）→ 本轮口径**偏保守（略高估）**。

**已确认：统一按需求规则处理，不开特例分支，忽略它们自带的报价与箱规**。理由是特例会把「这个套装到底该按哪套算」变成一个需要人工判断且没有字段承载的隐性状态。它们自带的数据保留在 `products` 里不删，将来若要做「整体装箱运费」再从那里取。

## 5. 计算公式

`ki` = `product_kit_items`，`c` = 组件商品，`bp` = 非 Kit 成本视图。

```
-- 组件三边降序（读法 B）
d1 = GREATEST(c.length, c.width, c.height)
d3 = LEAST(c.length, c.width, c.height)
d2 = c.length + c.width + c.height - d1 - d3

-- 按 kit_product_id 聚合
length_mm   = max(d1)
width_mm    = max(d2)
volume_cbm  = sum(ki.qty * c.length * c.width * c.height) / 1e9
height_mm   = CASE WHEN length_mm * width_mm > 0
                THEN volume_cbm * 1e9 / (length_mm * width_mm) END
weight      = sum(ki.qty * c.weight)

-- §4.4 的守卫：任一组件缺成本 → 整体 NULL
unit_cost_aud = CASE WHEN count(*) = count(bp.unit_cost_aud)
                  THEN sum(ki.qty * bp.unit_cost_aud) END

purchase_price_aud = unit_cost_aud   -- LP，运费 0
freight_cost_aud   = 0
origin_abbr        = 'LP'
chargeable_basis   = 'none'
```

**精度**：卷积必须读组件的**未舍入** unit cost。现有 `product_pricing` 在最外层做了 `round(...,2)`，直接对 616 个套装、699 个组件求和会把每行最多 0.005 的舍入误差累积起来。这与 `docs/product-pricing-view.md` §3.7①「计算层不动精度、只在最外层舍入」是同一条原则——本轮的视图重构（§6）正是为了让这条原则继续成立。

## 6. 视图结构：拆成三层

### 6.1 为什么不能直接给 `product_pricing` 加一个 `UNION ALL`

套装分支需要读**非 Kit 分支的结果**。如果 `product_pricing` 自己就是 `UNION ALL`，套装分支引用 `product_pricing` 就是自引用，Postgres 会拒绝（非 `RECURSIVE` 视图不允许）。所以必须把非 Kit 那段单独命名出来。

### 6.2 目标结构

| 视图 | 内容 | 舍入 |
|---|---|---|
| `public.product_cost_base` | 现 `product_pricing` 的**成本部分**（非 Kit），到 `unit_cost_aud` 为止 | **不舍入** |
| `public.product_cost_kit` | §5 的套装卷积，读 `product_cost_base` | **不舍入** |
| `public.product_pricing` | `base UNION ALL kit` → 档位 LATERAL + `charm_price` + 毛利 + **最外层统一舍入** | 舍入 |
| `public.product_list_pricing` | 不动（定义不变，但语义变了，见 §6.4） |

好处不只是绕开自引用：**档位匹配、建议价、毛利这三段公式现在只写一遍**，两个分支共用（规则 5 DRY）。今天如果照搬一份到套装分支，就等于制造第二个需要同步的 `charm_price` 式陷阱。

三个视图都必须 `WITH (security_invoker = true)`，并 `GRANT SELECT TO authenticated`——中间层视图也要授权，否则调用方读顶层视图时会在中间层被权限挡住。

### 6.3 `product_pricing` 的列变化

保持现有 24 列的**名称、类型、顺序完全不变**，只在**末尾追加**：

| 新列 | 类型 | 说明 |
|---|---|---|
| `is_kit` | `boolean` | 让 UI 不必再回查 `products` |
| `length_mm` / `width_mm` / `height_mm` | `numeric` | 非 Kit = 存的值；Kit = 派生值 |
| `component_count` | `integer` | 非 Kit 为 NULL；Kit 为组件行数（空套装为 0） |

只追加是为了能用 `CREATE OR REPLACE VIEW`——Postgres 允许在末尾加列，不允许改名/改序/改类型。这样 `product_list_pricing` 不会被级联删掉。若实现时发现某处不得不改动已有列，则退回到同一迁移内 `DROP VIEW product_pricing CASCADE` + 依次重建两个视图（都在 `BEGIN`/`COMMIT` 内，规则 14）。

> **实际走了退路**，原因见 §12.1①。

### 6.4 对 `product_list_pricing` 的连带影响（无需改 SQL，但语义变了）

它是 `products LEFT JOIN product_pricing`。套装进入 `product_pricing` 后，**列表页的 Unit Cost / Margin 列会自动对套装生效**，不用改一行查询代码。需要跟着改的只有两处措辞：

- 视图上的 `COMMENT`（现写「NULL for kits」）；
- `src/lib/supabase/database.types.ts` 里 `unit_cost_aud` / `retail_margin_pct` 的注释。

## 7. 应用层改动

### 7.1 取数

- `src/lib/queries/product-pricing.ts`
  - `fetchProductPricing()` 的注释要改：套装**不再**返回空行。
  - 新增 `fetchKitComponentCosts(supabase, kitProductId)`：先取该套装的组件 id 与 qty，再按 id 列表查 `product_pricing` 拿 `unit_cost_aud`。**分两步而不是 PostgREST 内嵌**——`product_kit_items` 到视图没有外键可跟随（同 §10.1① 的原因）。组件数最多 9 个，id 列表塞进 URL 无长度风险。
- `src/app/(dashboard)/products/[id]/page.tsx`：删掉 `product.is_kit ? Promise.resolve({pricing:null}) : fetch...` 这个分支，套装照常取；套装额外并行取组件成本。

### 7.2 组件

- `product-pricing-panel.tsx`：套装走另一套左卡片——**Component roll-up 表格**（Image / SKU / Qty / Unit cost / Line total + 合计行），替代「采购价 + 运费」的拆解；右卡片 Retail & Margin **完全复用**，不改。
- 新增一张 **Derived Attributes** 卡片（仅套装）：重量、`L × W × H`、体积，附说明 "Derived from components; height is the equivalent height at zero void."
- 空套装 / 组件缺成本 / 组件是套装 三种情况各给一条明确文案，不要共用一句 "No pricing available"（§4.4）。
- 删除 `page.tsx` 里那块 `Kit pricing is calculated from its components / coming in the next phase` 的 `ProductPlaceholderPanel`。

### 7.3 表单

- `product-fields.ts` / Overview 表单：套装的 8 个派生字段只读（§4.3）。`retail_price` **保持可编辑**并继续走 `charmPrice()` 失焦收敛——套装的零售价是人定的，不是派生的。

### 7.4 类型

- `src/lib/supabase/database.types.ts`：**手工**补 2 个新视图 + `product_pricing` 的 5 个新列（规则 18，严禁跑 `gen types` 覆盖）。

### 7.5 不需要改的

- `src/lib/pricing.ts` 与 `src/lib/__tests__/pricing.test.ts`：本轮不动 `charm_price`，规则 17 的同步义务不触发。
- `scripts/migration/*.sql`：本轮不改被脚本引用的列，规则 15 的同步义务不触发。
- `CLAUDE.md`：无新规则。

## 8. 落地文件清单

**新增**
- `supabase/migrations/20260730100000_create_product_kit_pricing_views.sql`（三视图重构 + 授权 + 注释，单个 `BEGIN`/`COMMIT`）
- `src/app/(dashboard)/products/[id]/_components/product-kit-cost-table.tsx`

**修改**
- `src/lib/queries/product-pricing.ts`（新增 `fetchKitComponentCosts`、改注释）
- `src/app/(dashboard)/products/[id]/page.tsx`（取消 Kit 跳过分支、去掉占位面板）
- `src/app/(dashboard)/products/[id]/_components/product-pricing-panel.tsx`（Kit 分支 + Derived Attributes 卡片）
- `src/app/(dashboard)/products/[id]/_components/product-fields.ts`（Kit 派生字段只读）
- `src/lib/supabase/database.types.ts`（手工补类型）
- `docs/product-pricing-view.md`（§5.1 占位符与 §9 结项，指向本文）

## 9. 验收要点

- [ ] 一个 9 组件的套装：卷积成本 = 手工按 `Σ qty × 组件 unit cost` 核对一致（组件成本取视图**未舍入**值再求和，最后才舍入）。
- [ ] `qty > 1` 的套装成本/重量/体积确实乘了数量（拿 599 行里的一条验证）。
- [ ] 24 个空套装：成本列全 NULL，页面显示 "Add components…"，**没有出现 $0.95 的建议价**。
- [ ] 26 个含 0 尺寸组件的套装：不报除零，`height` / `volume_cbm` 为 NULL，成本仍算得出（LP 与尺寸无关）。
- [ ] 人为把某个组件的 `purchase_price` 置空 → 该套装成本立刻变 NULL 而**不是变小**（§4.4 守卫）。
- [ ] 人为造一条嵌套套装明细 → 父套装成本 NULL + 明确提示，不静默少算。
- [ ] 尺寸按读法 B：抽 26 个「两种读法不同」的套装之一，确认 `width` 取的是 `max(d2)` 而非全局次大。
- [ ] 套装详情页 Retail & Margin 卡片与非 Kit 商品**完全同款**（复用而非复制）。
- [ ] 列表页：套装行的 Unit Cost 不再是 `—`；`is_kit` 筛选器仍正常。
- [ ] 套装 Overview 表单：8 个派生字段不可编辑，`retail_price` 仍可编辑且失焦收敛到 `.95`。
- [ ] 用 anon key 查 `product_cost_base` / `product_cost_kit` / `product_pricing` 均返回 0 行（`security_invoker` 在三层都生效）。
- [ ] 改一次 `pricing_settings.aud_to_cny`，套装成本随之变化（证明没有写回冻结）。

## 10. 已确认的决策（2026-07-29）

| # | 问题 | 定案 |
|---|---|---|
| 1 | 尺寸读法 | **B —— 逐件三边降序后取 `max(d1)` / `max(d2)`**（§3.3）。影响 26 个套装的 `width`，底面积比全局读法平均紧 1.49 倍 |
| 2 | 61 个自带 CNY 报价与箱规的 SF 套装 | **统一走 LP + 组件卷积，忽略自带数据**（§4.6）。不开特例分支；自带数据保留在 `products` 里不删除、不清洗 |
| 3 | 8 个派生字段的呈现 | **套装表单里置为只读**（§4.3），展示视图算出的派生值。不提供人工覆盖装箱尺寸的入口 |

## 11. 风险与后续

- **等体积高度不是装箱高度**。今天 LP 运费为 0 所以无成本影响；接出库运费时必须重新评估，届时可能需要在套装上引入真实的装箱尺寸字段（与问题 3 相关）。
- **套装成本对组件的改动敏感**。视图保证实时一致，但也意味着改一个常用组件的采购价会同时改变几十个套装的建议价——这是正确行为，只是要有心理预期。
- **556 个套装 `retail_price` 为 0**，毛利列仍会是 NULL，与 `docs/product-pricing-view.md` §10.3 记录的存量问题同源，不在本轮解决。本轮之后这些套装会**首次拥有建议零售价**，可作为批量补价的依据。
- **不支持递归**。若日后业务真要多层套装，需先做循环引用检测，再把 §5 的聚合改成 `WITH RECURSIVE`。

## 12. 实现记录与偏差（2026-07-29）

### 12.1 相对方案的四处偏差

**① `CREATE OR REPLACE VIEW` 用不了，改为 `DROP` + 重建**

§6.3 计划靠「只在末尾追加列」保住 `product_list_pricing`。实际不行：`weight` 在 `product_cost_base` 里是 `numeric(10,3)`（来自 `products.weight`），在 `product_cost_kit` 里是 `sum(...)` 得到的无 typmod `numeric`，`UNION ALL` 后类型收敛为 `numeric`。Postgres 的 `CREATE OR REPLACE VIEW` 连 typmod 变化都拒绝（`cannot change data type of view column`）。

改为在同一事务内先 `DROP VIEW product_list_pricing; DROP VIEW product_pricing;` 再依次建四个视图。`product_list_pricing` 的定义一字未改，只更新了 `COMMENT`（它原先写着「NULL for kits」，现在不再成立）。

**② 多了一个迁移：Kit 合成的 `purchase_price` 需要单独舍入**

`product_pricing` 在最外层不舍入 `purchase_price`——那是「录入的原值」，舍入真实录入价是错的。但 Kit 的 `purchase_price` 不是录入的，是合成的卷积值，于是原样漏出了 `2.27963636363636363636`。补迁移 `20260730110000_round_kit_synthetic_purchase_price.sql`，只在 Kit 分支这一个表达式上 `round(..., 2)`。这不算破坏「只在最外层舍入」：该列不参与任何后续计算（`unit_cost_aud` 走的是另一条表达式），纯展示。

**③ 详情页的组件明细表会「加不起来」，加了脚注**

卷积用未舍入值求和（§5），而表格里每行只能显示到分。实测 GB02503SF：逐行舍入后相加是 **$2.25**，视图的真实合计是 **$2.28**——1.3% 的差，正好反证了 §5 精度决策的必要性，但摆在同一张表里会像 bug。处理：合计行取视图值，并**仅在两者不一致时**追加一行浅色说明。

**④ 「只读」的实现方式：从编辑对话框里隐藏，而非渲染成 disabled**

派生字段在 `products` 行上存的是历史垃圾值（0 或旧汇率下的卷积）。若渲染成 disabled 输入框，框里显示的会是那些垃圾值，而同一页的卡片显示派生值，两个数字互相打脸。所以直接从对话框中移除这批字段，并在对话框顶部写明原因。

`react-hook-form` 的 `defaultValues` 仍包含它们（`shouldUnregister` 默认 `false`），提交时原值照常回传，**因此 section 的 Zod schema 和 Server Action 一行都不用改**——`length`/`width`/`height` 的 `requiredPositive` 校验不会因为字段没渲染而失败。

另外把 `product-overview.tsx` 里私有的 `formatDimensions` 提到 `src/lib/pricing.ts` 共用（规则 5），顺带补上了 `mm` 单位。§8 里预告的 `product-kit-cost-table.tsx` 没有单独建文件——明细表只在定价面板里用，拆出去反而多一层跳转。

### 12.2 真实数据验证结果

| 检查 | 结果 |
|---|---|
| `product_pricing` 行数 | **3122** = 2482 非 Kit + **640 Kit**（此前 2482） |
| `product_list_pricing` 行数 | 3122，其中 616 个 Kit 有成本，列表页无需改代码即生效 |
| 9 组件套装 GB02503SF | 卷积 **$2.28**、重量 0.300kg、体积 0.001103cbm、450×450×5.44mm，与手工按 `Σ qty × 未舍入组件成本` 核对**逐项一致**；倍率 4.0（落 `[2,5)` 档），建议价 `2.2796×4×1.1 = 10.03 → charm → $10.95` ✓ |
| 尺寸读法 B | 616 个套装的 `length_mm`/`width_mm` 与逐件排序算法**零不符**；无一例 `width > length` |
| 24 个空套装 | 成本与建议价**全部 NULL**，`component_count = 0`，**没有出现 $0.95 的假建议价** |
| 26 个含 0 尺寸组件的套装 | `height_mm` 为 NULL，**成本仍算得出**（LP 与尺寸无关）；`height_mm IS NULL` 的 Kit 共 50 = 24 空 + 26 零底面 |
| 全部 640 个 Kit | `origin_abbr` 均为 `LP`、`freight_cost_aud` 均为 0、`currency` 均为 AUD |
| NULL 守卫 | 模拟把一个 3 组件套装的某个组件成本置空：裸 `sum()` 给出 **$0.60**（真实值 $0.80，少算 25% 且不报错），守卫表达式返回 **NULL** ✓ |
| 嵌套套装 | 当前 0 例；组件若是 Kit 则在 `product_cost_base` 里查不到行，走同一条 NULL 守卫 |
| `security_invoker` | anon key 查 `product_pricing` / `product_cost_base` / `product_cost_kit` / `product_list_pricing` **均返回 `[]`** |
| 覆盖率 | 616 个套装**首次拥有建议零售价**；83 个有实际毛利率（其余 `retail_price` 为 0，同 §11） |

### 12.3 实际落地文件

**新增**
- `supabase/migrations/20260730100000_create_product_kit_pricing_views.sql`
- `supabase/migrations/20260730110000_round_kit_synthetic_purchase_price.sql`

**修改**
- `src/lib/pricing.ts`（新增 `formatDimensions`）
- `src/lib/queries/product-pricing.ts`（新增 `fetchKitComponentCosts`）
- `src/lib/supabase/database.types.ts`（手工补 2 视图 + `product_pricing` 5 个新列 + 可空性修正）
- `src/app/(dashboard)/products/[id]/page.tsx`
- `src/app/(dashboard)/products/[id]/_components/product-pricing-panel.tsx`
- `src/app/(dashboard)/products/[id]/_components/product-overview.tsx`
- `src/app/(dashboard)/products/[id]/_components/product-fields.ts`
- `src/app/(dashboard)/products/[id]/_components/product-section-card.tsx`
- `src/app/(dashboard)/products/[id]/_components/product-section-dialog.tsx`
- `docs/product-pricing-view.md` / `docs/product-kits-migration.md`（交叉引用）

`CLAUDE.md` 无新增规则：本轮未改 `charm_price`（规则 17 不触发）、未改被迁移脚本引用的列（规则 15 不触发），规则 18 的手工补类型义务已履行。
