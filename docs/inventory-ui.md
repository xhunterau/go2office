# Inventory 功能 UI 轮次 — 开发文档

> 状态：**已实现并在远端库执行完成**（2026-08-01，见 §10）
> 创建日期：2026-08-01
> 前置文档：`docs/inventory-migration.md`（迁移层已完成，`locations` 24 行 / `inventory_levels` 2100 行已落库）
> 相关规则：CLAUDE.md 规则 2（RESTful 路由）、6（双重校验）、7（ActionResult + sonner）、9（全局 useConfirm）、12（Dialog 视口安全）、15（脚本同步）、18（types 手工维护）

## 1. 目标

1. 新增 `inventory_movements` 流水表与配套 RPC，让库存**只能通过记账变动**，杜绝 Laravel"改数不记账"的老路。
2. 清除 2 个套装商品的自身库存，并让这条规则在最终生产同步时依然成立。
3. 落地四处 UI：`/inventory` 列表页、`/locations` 库位 CRUD、商品详情页 `Stock` tab、商品列表页 `On Hand` 列。

## 2. 已与用户确认的关键决策

| 决策点 | 结论 |
|---|---|
| 出入库模型 | **新建 `inventory_movements` 流水表**。每次 Receive / Dispatch / Adjust / Move 都落一条流水，`inventory_levels.qty` 由流水驱动更新 |
| `/inventory` 主视角 | **按商品聚合**：一行一个商品，显示总库存与所在库位 |
| 套装库存 | **套装不应有自身库存**。现存 2 行（`GBDL00226` 2000 件、`GBDL00057` 40 件）**清除**；套装可售量下一轮通过**视图**实现，本轮不做 |
| 本轮范围 | `/inventory` 列表页 + `/locations` CRUD + 详情页 `Stock` tab + 商品列表 `On Hand` 列（四项全做） |

## 3. 套装库存清除：为什么不能只 DELETE

`scripts/migration/003_inventory_data.sql` 是幂等 upsert，**最终生产同步时还要再跑一次**。如果只在当前库 `DELETE` 掉这 2 行，脚本重跑会把它们从 `go2_locations_products` 原样搬回来——静默复活，没有任何报错。

所以要**两处一起改**（规则 15 的强制同步条款）：

1. **改脚本**：`003` 的 `inventory_levels` INSERT 增加过滤，跳过 `is_kit = true` 的商品：
   ```sql
   AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = lp.product_id AND NOT p.is_kit)
   ```
   （即把现有的商品存在性 `EXISTS` 收紧为"存在且不是套装"，不新增子查询）
2. **建迁移清除存量**：`DELETE FROM public.inventory_levels il USING public.products p WHERE p.id = il.product_id AND p.is_kit;`

改动后 `003` 的预期基线随之变化（已实测确认）：

| 指标 | 原基线 | **新基线** |
|---|---|---|
| `inventory_levels` 行数 | 2100 | **2098** |
| distinct `product_id` | 2100 | **2098** |
| `sum(qty)` | 53387 | **51347** |
| 被跳过的源行 | 12 | **14**（12 软删除商品 + 2 套装） |
| `qty = 0` 行数 | 696 | 696（不变，2 行都是正数） |
| distinct `location_id` | 22 | 22（不变） |

`docs/inventory-migration.md` 的 §8.1 验证表与 §8.1.1 执行记录需同步更新为新基线，并注明基线变更的原因与日期。

### 3.1 是否加 DB 级约束禁止套装持有库存（待确认）

**默认做法：加一个 `BEFORE INSERT OR UPDATE` 触发器**，拒绝 `is_kit = true` 的商品写入 `inventory_levels`。

理由：这是一条会**静默漂移**的业务不变量——UI 层拦得住页面操作，拦不住 RPC 直调、脚本或将来别的写入路径，而漂移的表现只是"某个套装莫名有了库存"，不会报错。DB 层堵成本极低。

代价（需要知情）：把一个**已有库存的普通商品**改成套装时，`products` 的更新会被触发器拒绝，用户看到的是一条外键式报错。这其实是期望行为（应当先清库存再转套装），但需要在商品编辑的 Server Action 里翻译成可读文案：`This product still holds stock and cannot be converted to a kit. Clear its stock first.`

> 注意这与 `product_kit_items` 那轮"**不**用触发器强制 `is_kit` 一致性"的决策**不冲突**：那条针对的是"`is_kit` 与明细行是否联动"，属于允许存在中间状态的软规则；本条是"套装不得持有实物库存"，是会导致超卖的硬规则。

若不同意加触发器，回复时说明，改为仅靠 UI 层拦截 + 定期体检查询。

## 4. Schema 设计

### 4.1 枚举与流水表

文件：`supabase/migrations/20260801110000_create_inventory_movements.sql`

```sql
CREATE TYPE public.stock_movement_kind AS ENUM (
  'receive',    -- 入库（采购到货）
  'dispatch',   -- 出库（发货）
  'adjust',     -- 盘点调整（可正可负）
  'move_in',    -- 库位调拨的入方
  'move_out'    -- 库位调拨的出方
);

CREATE TABLE public.inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  location_id bigint NOT NULL REFERENCES public.locations (id) ON DELETE RESTRICT,
  kind public.stock_movement_kind NOT NULL,
  -- 有符号增量：入库为正、出库为负。这样任意区间的净变动就是一次 SUM。
  qty_delta integer NOT NULL,
  -- 变动后的余额快照。冗余，但让审计不必重放整条历史即可核对。
  qty_after integer NOT NULL,
  note text,
  -- 调拨的对手库位，把一对 move_out / move_in 串起来。
  counterpart_location_id bigint REFERENCES public.locations (id),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_delta_not_zero CHECK (qty_delta <> 0),
  CONSTRAINT inventory_movements_qty_after_non_negative CHECK (qty_after >= 0),
  CONSTRAINT inventory_movements_kind_direction CHECK (
    (kind IN ('receive', 'move_in') AND qty_delta > 0)
    OR (kind IN ('dispatch', 'move_out') AND qty_delta < 0)
    OR kind = 'adjust'
  ),
  CONSTRAINT inventory_movements_counterpart CHECK (
    (kind IN ('move_in', 'move_out')) = (counterpart_location_id IS NOT NULL)
  )
);
```

- **没有 `updated_at`，也没有 `moddatetime` 触发器**：流水是 append-only 的，改一条历史流水没有任何合法场景。
- **权限只给 `SELECT` 和 `INSERT`**，不给 `UPDATE` / `DELETE`：
  ```sql
  GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
  ```
  RLS 策略相应拆成 `FOR SELECT` 与 `FOR INSERT` 两条，不用既有的 `FOR ALL` 模板。**这是本表与项目其他表最大的差异**，是刻意的：不可篡改是审计价值的全部来源。
- `id` 用 `GENERATED ALWAYS`（而非既有表的 `BY DEFAULT`），因为没有旧 id 需要沿用，顺手禁掉手工指定。
- 索引：`(product_id, created_at DESC)` 支撑详情页流水时间线；`(location_id)` 支撑按库位追溯。

### 4.2 写入 RPC（并发安全的关键）

**不允许应用层直接 `UPDATE inventory_levels.qty`。** 所有变动走三个 plpgsql 函数，每个都在单个事务里同时写流水和余额：

| 函数 | 语义 | 用途 |
|---|---|---|
| `record_stock_movement(product_id, location_id, kind, qty_delta, note)` | **增量**语义 | Receive / Dispatch |
| `set_stock_level(product_id, location_id, new_qty, note)` | **绝对值**语义，内部算出 delta 落 `adjust` 流水 | 盘点 |
| `move_stock(product_id, from_location_id, to_location_id, qty, note)` | 一次事务两条流水 | 库位调拨 |

核心写法是**原子自增**，而不是"读出来算完再写回去"：

```sql
INSERT INTO public.inventory_levels (product_id, location_id, qty)
VALUES (p_product_id, p_location_id, p_qty_delta)
ON CONFLICT (product_id, location_id)
DO UPDATE SET qty = public.inventory_levels.qty + p_qty_delta
RETURNING qty INTO v_qty_after;
```

这一句同时解决三件事：

1. **并发安全**：`qty = qty + delta` 由 Postgres 行锁保证，两个人同时发货不会丢更新。读-改-写会丢。
2. **自动建行**：某商品第一次入到一个新库位时无需先手工建库存行。
3. **超发拦截**：余额被扣成负数时，`inventory_levels_qty_non_negative` 直接抛 `23514`，Server Action 翻译成 `Not enough stock in this location.` 无需应用层预检查（预检查本身就有 TOCTOU 竞态）。

`set_stock_level` 用绝对值语义而非让前端算 delta，同样是为了避开 TOCTOU：前端读到 10、用户填实盘 8，若期间他人发走 3 件，按 delta = −2 处理会得到错误结果；把"设为 8"整体交给 DB 在一个事务里完成才正确。

函数用 `SECURITY INVOKER`（默认），依赖调用者自身的 RLS 权限，不提权。

### 4.3 聚合视图

文件：`supabase/migrations/20260801120000_create_product_stock_views.sql`

```sql
-- 每个商品的库存汇总。套装恒为 0 行（见 §3），因此 on_hand 为 0。
CREATE VIEW public.product_stock AS
SELECT
  p.id                                   AS product_id,
  COALESCE(SUM(il.qty), 0)::integer      AS on_hand,
  COUNT(il.id) FILTER (WHERE il.qty > 0) AS location_count,
  -- 列表页直接展示，省掉一次 N+1 查询
  string_agg(l.name, ', ' ORDER BY l.name) FILTER (WHERE il.qty > 0) AS location_names
FROM public.products p
LEFT JOIN public.inventory_levels il ON il.product_id = p.id
LEFT JOIN public.locations l ON l.id = il.location_id
GROUP BY p.id;
```

`LEFT JOIN` 保证 1022 个无库存行的商品也出现在视图里（`on_hand = 0`），否则 `/inventory` 会漏掉它们。

同一迁移里给 `product_list_pricing` 增加 `on_hand` 列（`LEFT JOIN public.product_stock`）。加列不破坏现有 `LIST_COLUMNS` 的选取，属向后兼容改动；但按规则 18 必须同步 `database.types.ts` 的 `Views` 条目。

## 5. UI 设计

### 5.1 路由与导航

| 路由 | 内容 |
|---|---|
| `/inventory` | 库存列表（按商品聚合） |
| `/locations` | 库位 CRUD |
| `/products/[id]?tab=stock` | 详情页 Stock tab（**已有占位**，替换即可） |

侧边栏 [app-sidebar.tsx](src/components/layout/app-sidebar.tsx) 新增一个 `Inventory` 折叠分组（`Warehouse` 图标），含 `Inventory` 与 `Locations` 两项——与既有 `Products` 分组同结构，不改动现有分组。

### 5.2 `/inventory` 列表页

沿用 `/products` 的既有骨架（Server Component 页面 + 客户端筛选栏 + 分页），三个组件几乎是 1:1 平移：

- 列：`Image` / `SKU` / `Name` / `On Hand`（右对齐 tabular-nums）/ `Locations` / `Actions`
- 筛选：SKU、Name、库位（Select）、库存状态（`In stock` / `Out of stock` / `Negative`——最后一项恒为空，作为约束生效的哨兵）
- 排序：默认 `on_hand DESC`，可切 SKU
- `On Hand = 0` 的行用 `text-muted-foreground` 弱化；不做红色告警（696 行零库存是正常状态，标红会变成噪声）
- 行内 `Actions`：`Receive` / `Dispatch` 快捷入口，打开与 Stock tab 共用的对话框

查询函数 `fetchInventoryList` 走 `product_stock` 视图 join `products`，与 `fetchProductList` 同样的 `parseXxxFilters` + `range()` 分页写法。

### 5.3 商品详情页 Stock tab

替换 [page.tsx:89-95](src/app/(dashboard)/products/[id]/page.tsx#L89-L95) 现有的 `ProductPlaceholderPanel`。面板分两块：

1. **各库位库存表**：`Location` / `Qty` / `Actions`，底部合计行。空态文案 `No stock recorded for this product.`（复用 kit 面板的空态语义）
2. **流水时间线**：最近 20 条 `inventory_movements`，显示类型徽章、增量（`+7` / `−3`）、变动后余额、操作人、时间。这是丢弃 `logs` 之后**新系统自己的账本起点**。

顶部三个按钮：`Receive` / `Dispatch` / `Move`，外加库位行内的 `Adjust`（盘点）。四者共用一个 `StockMovementDialog`，按 `kind` 切换字段（Move 多一个目标库位选择器）。按规则 12 设 `max-h-[85vh]` + `overflow-y-auto`。

套装商品（`is_kit`）的 Stock tab 显示一条说明而非表格：`Kits do not hold their own stock. Availability is derived from components.`——为下一轮的可组装数视图留好位置。

### 5.4 `/locations` 库位 CRUD

与 `/brands`、`/suppliers` 同模式（`page.tsx` + `locations-table.tsx` + `location-form-dialog.tsx`）：

- 列：`Name` / `Comments` / `Products`（该库位商品数）/ `Actions`
- 删除走全局 `useConfirm`（规则 9）
- **`RESTRICT` 报错必须翻译**：库位下还有库存行（**包括 `qty = 0` 的行**）时删除会抛 `23503`。文案：`This location still holds N products and cannot be deleted. Move or clear its stock first.` 当前 22 个库位都会命中这条，只有 `P-1-6` / `P-1-7` 可删——这是预期行为，不是缺陷
- 重名会抛 `23505` → `A location with this name already exists.`

## 6. 校验与 Server Actions

`src/lib/validations/inventory.ts`（Zod，客户端与服务端双跑，规则 6）：

- `movementSchema`：`product_id` / `location_id` 正整数；`qty` 正整数上限 100000；`note` 可选、`max(500)`
- `setStockSchema`：`new_qty` **非负**整数（含 0，与 `receive` 的正整数不同）
- `moveStockSchema`：`superRefine` 断言 `from_location_id !== to_location_id`
- `locationSchema`：`name` 必填、`trim` 后非空、`max(50)`；`comments` 可选 `max(500)`

`src/lib/actions/inventory.ts` / `location.ts`，全部返回 `ActionResult`（规则 7），通过 `supabase.rpc()` 调用 §4.2 的函数，错误码翻译沿用 [action-result.ts](src/lib/actions/action-result.ts) 的既有 helper：

| 错误码 | 场景 | 文案 |
|---|---|---|
| `23514` CHECK | 余额被扣负 | `Not enough stock in this location.` |
| `23514` CHECK | 套装写库存（若采纳 §3.1 触发器） | `Kits cannot hold stock.` |
| `23505` UNIQUE | 库位重名 | `A location with this name already exists.` |
| `23503` FK | 删库位仍有存货 | `This location still holds products...` |

成功后 `revalidatePath` 覆盖 `/inventory`、`/products`、`/products/[id]`（库存变动同时影响三处）。反馈用 `sonner`（规则 7）。

## 7. 落地文件清单

**新增（迁移与脚本）**
- `supabase/migrations/20260801110000_create_inventory_movements.sql`（枚举 + 表 + 3 个 RPC + RLS）
- `supabase/migrations/20260801120000_create_product_stock_views.sql`（`product_stock` 视图 + `product_list_pricing` 加列）
- `supabase/migrations/20260801130000_purge_kit_stock.sql`（清除存量 + §3.1 触发器）

**新增（应用层）**
- `src/lib/queries/inventory.ts`、`src/lib/queries/locations.ts`
- `src/lib/validations/inventory.ts`、`src/lib/validations/location.ts`
- `src/lib/actions/inventory.ts`、`src/lib/actions/location.ts`
- `src/app/(dashboard)/inventory/page.tsx` + `_components/`（table / filters / pagination）
- `src/app/(dashboard)/locations/page.tsx` + `_components/`（table / form-dialog）
- `src/app/(dashboard)/products/[id]/_components/product-stock-panel.tsx`、`stock-movement-dialog.tsx`、`stock-movements-timeline.tsx`

**修改**
- `scripts/migration/003_inventory_data.sql`（§3：套装过滤 + 诊断与预期值更新）
- `docs/inventory-migration.md`（§8.1 / §8.1.1 基线由 2100 / 53387 改为 2098 / 51347）
- `CLAUDE.md`（规则 15 补记套装过滤规则）
- `src/lib/supabase/database.types.ts`（手工补 `inventory_movements`、`product_stock`、`stock_movement_kind` 枚举、`product_list_pricing.on_hand`、3 个 `Functions` 条目）
- `src/app/(dashboard)/products/[id]/page.tsx`（替换 Stock 占位）
- `src/lib/queries/products.ts`（`LIST_COLUMNS` 加 `on_hand`）
- `src/app/(dashboard)/products/_components/products-table.tsx`（新增列）
- `src/components/layout/app-sidebar.tsx`（Inventory 分组）

## 8. 验证计划

1. **迁移推送**：`db push --dry-run` 确认三个文件，再 push；结构核对表/枚举/函数/视图/RLS/权限。
2. **套装清除**：`inventory_levels` 应从 2100 降至 **2098**，`sum(qty)` 从 53387 降至 **51347**。
3. **`003` 脚本重跑**：改过过滤条件后重跑，行数**仍为 2098**（验证套装不会复活——这是 §3 的核心目的）。
4. **并发安全**：对同一 `(product_id, location_id)` 并发发起 20 次 `record_stock_movement(-1)`，终值应恰好减 20，流水恰好 20 条。这是本轮唯一无法靠单线程点击验证的东西，需写一次性脚本压测。
5. **超发拦截**：对 `qty = 3` 的行发 5 件，应报错且**流水与余额都不变**（验证事务原子性）。
6. **不可篡改**：以 `authenticated` 身份尝试 `UPDATE` / `DELETE` 一条流水，应被权限拒绝。
7. **UI**：桌面端与移动端各验证一次 Dialog（规则 12）；`P-1-6` 可删、`S-3-4` 删除被拦并给出正确文案。

## 10. 实际执行结果（2026-08-01）

### 10.1 迁移与验证

推送了 **5 个**迁移（比计划的 3 个多 2 个，原因见 §10.2）：

| 迁移 | 内容 |
|---|---|
| `20260801110000_create_inventory_movements.sql` | 枚举 + 流水表 + 3 个 RPC + RLS |
| `20260801120000_create_product_stock_views.sql` | `product_stock` 视图 + `product_list_pricing` 加 `on_hand` |
| `20260801130000_purge_kit_stock.sql` | 清除 2 行套装库存 + 两个拦截触发器 |
| `20260801140000_lock_down_movements_ledger.sql` | **补漏**：撤销流水表的 UPDATE/DELETE/TRUNCATE |
| `20260801150000_fix_stock_movement_negative_delta.sql` | **补漏**：修复负增量无法应用的 bug |

验证结果（全部命中）：

| 检查项 | 结果 |
|---|---|
| 套装库存清除 | 2100 → **2098** 行，`sum(qty)` 53387 → **51347**，剩余套装库存行 **0** |
| `product_stock` 视图 | **3122** 行（= 全部商品），`sum(on_hand)` = **51347**，与实表一致 |
| 并发压测（20 路并发扣减） | 14 路成功（6 路撞连接池上限），产生 **14 个互不相同的 `qty_after`**（99→86），终值 86 = 100−14，**零丢更新** |
| 超发拦截 | 从 86 发 200 报错，`qty` 与流水条数**均未变** |
| `move_stock` 原子性 | 超量调拨报错后目标库位余额未变，两条流水一并回滚 |
| 盘点无变化 | `set_stock_level` 计数与账面相同时返回 `null`，**不写流水** |
| 空库位出库 | 报 `No stock recorded at this location` |
| 套装拦截 | 给套装记库存、把有库存的商品改成套装，**双向均被拒** |
| 流水不可篡改 | `authenticated` 仅剩 `INSERT, SELECT`；`anon` 无任何权限 |
| 测试数据清理 | 删除测试商品后基线完全复原（2098 / 51347 / 0 条流水） |

应用层：`tsc --noEmit` 与 `eslint` 均无输出，`vitest` 11 项通过，`next build` 成功（`/inventory`、`/locations` 路由已生成）。PostgREST 的 5 处嵌套查询语法用匿名 key 逐一探测确认有效（对照组正确返回 `PGRST200`）。

### 10.2 验证过程中发现并修复的两个缺陷

**其一：流水表根本不是 append-only。** 计划里写了「权限只给 `SELECT` 和 `INSERT`」，实现也照做了，但漏掉一件事——**Supabase 在 `public` schema 上有默认权限，新建表自动给 `anon` 和 `authenticated` 授予 ALL；`GRANT` 是叠加而非替换**。建表后实测权限是 `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`。

RLS 能挡住 UPDATE / DELETE（没写对应策略即拒绝），但 **TRUNCATE 是表级权限，RLS 完全看不到**——任何已登录会话都能一句话清空整本审计账。所以对 TRUNCATE 而言 `REVOKE` 不是纵深防御，**是唯一防御**。

**其二：所有出库操作都是坏的。** 原设计用一句 `INSERT ... ON CONFLICT DO UPDATE SET qty = qty + delta` 同时承担「建行」和「原子自增」。这在这里行不通：**Postgres 先对拟插入的元组做 CHECK 校验，再检测唯一冲突**，所以 `VALUES (..., -1)` 当场撞上 `inventory_levels_qty_non_negative`，根本走不到 `DO UPDATE` 分支。入库（正数）能过，出库全废。

改为 UPDATE 优先、未命中再 INSERT。原子自增的并发性质由 `UPDATE ... SET qty = qty + delta` 保留（取得行锁后对最新已提交版本重算），超发仍由 CHECK 拦截。

两者的共同点值得记下来：**都不是靠读代码或类型检查能发现的**。第一个要实际查询 `information_schema.role_table_grants`，第二个要真的发一次货。计划里那条"并发压测是唯一无法靠点击验证的东西"说对了一半——真正的价值不在测出竞态，而在于它是第一次真的调用出库路径。

### 10.3 与计划的其他偏差

- **`fetchInventoryList` 多一次查询**：库位名存放在 `product_stock` 而非 `product_list_pricing`。为一个页面的一列去加宽共享视图不值得，改为对当页 20 行补查一次。
- **`/inventory` 排除套装**：套装恒为 0，列出来只是一堵零墙。
- **Stock 对话框用 `useWatch` 而非 `form.watch()`**：后者每次渲染返回新函数，会让整个组件被 React Compiler 跳过 memo（lint 有专门规则）。
- **商品列表页套装的 On Hand 显示 `—` 而非 `0`**：0 会被读成"缺货"，而实际是"不适用"。

## 9. 风险与注意事项

- **`inventory_levels.qty` 与流水之和会不会漂移**：只要所有写入都走 §4.2 的 RPC，两者恒等。风险点是将来有人图省事直接 `UPDATE inventory_levels`。可选的加固是把 `authenticated` 对 `inventory_levels` 的列级 `UPDATE(qty)` 权限 `REVOKE` 掉，物理上只留 RPC 一条路——**本轮不做**（会让将来的数据修复也必须走 RPC），但建议加一个对账查询到运维清单：`SUM(qty_delta) GROUP BY product_id, location_id` 应等于 `inventory_levels.qty`。注意该对账**只对迁移之后发生的变动成立**，迁移搬入的初始余额没有对应流水。
- **初始余额没有流水**：2098 行是脚本直接搬入的，`inventory_movements` 为空。因此详情页流水时间线在第一次操作前都是空的，需给出明确空态文案（`No movements recorded yet. Stock was imported from the legacy system.`），否则会被误读为"数据丢了"。另一个选项是为每行补一条 `adjust` 开账流水，**本轮不做**：2098 条假流水会污染真实审计记录，且开账时间点是迁移时刻而非真实入库时刻。
- **696 行零库存 + 484 行曾被归零**：`/inventory` 默认不过滤零库存，首屏会有大量 0。筛选器默认值建议设为 `In stock`，让运营看到的是有货的东西；但**不要**在查询层硬编码排除 0，否则盘点时找不到需要补录的商品。
- **全仓实盘仍是前提**：`docs/inventory-migration.md` §9 记录的 −85843 件失真尚未解决。本轮做的是"从此以后每一笔都有账"，**不是**"现在的账是对的"。Stock tab 的 `Adjust` 就是实盘的落地工具，建议上线后先用它走一遍全仓。
- **套装可售量下一轮**：`is_kit` 商品在本轮所有库存视图里 `on_hand` 恒为 0。按用户决定，可组装数下一轮通过视图实现（需递归展开组件、取 `MIN(component_on_hand / required_qty)`，并处理 `docs/product-kit-pricing.md` §4.5 已记录的嵌套套装假设）。
- **`created_by` 依赖 auth**：`auth.users` 当前只有登录用户，没有"操作员"概念。若将来仓库工人共用一个账号，流水的 `created_by` 会失去区分度，届时需引入操作员字段而非改这一列。

## 11. 下一轮待办

- **套装可售量视图**：按用户决定通过视图实现。需递归展开组件、取 `MIN(component_on_hand / required_qty)`，并处理 `docs/product-kit-pricing.md` §4.5 已记录的嵌套套装假设。
- **全仓实盘**：`Adjust`（Count）已经是落地工具，建议上线后先走一遍全仓，把 §9 记录的 −85843 件失真真正清掉。
- **移动端与 Dialog 视口验证**（规则 12）：本轮 Dialog 均已设 `max-h-[85vh]` + `overflow-y-auto`，但尚未在真机上各验一次。
- **`created_by` 目前恒为登录用户**：仓库工人共用账号时会失去区分度，届时需引入操作员字段而非改这一列。

## 12. 第二轮（2026-08-02）：列表页行内操作 + 流水裁剪

### 12.1 `/inventory` 每行可直接操作

列表页标题改为 `Stock overview`（与侧边栏菜单项一致）。每行新增：

- **首列 chevron 展开**（同一时刻只展开一行）：展开后显示该商品的库位明细表（每行可 Count）与流水时间线。
- **末列 `⋯` 菜单**：Receive / Dispatch / Move / Count / View history，无库存或库位少于 2 个时对应项禁用。

实现上把详情页 Stock tab 的三个块提取为共享组件（`src/components/inventory/`）：`stock-movement-dialog`、`stock-movements-timeline`、`stock-lines-table`、`movements-history-section`，两处页面共用同一份，避免两套库存表单逐渐漂移。

**数据层**：`InventoryListRow` 新增 `lines: ProductStockLine[]`。§10.3 记录的"为库位名多查一次 `product_stock`"改为查 `inventory_levels + locations(name)`——行内操作要落到具体库位，聚合视图只有拼好的名字串没法用；`location_names` 改由这批明细在 JS 里拼出（保留视图里 `qty > 0` 的过滤语义）。请求次数不变。

**流水按需加载**：列表不预取流水（20 行 × 20 条太重），展开时才调只读 Server Action `loadProductMovements`。客户端按 `product_id` 缓存；任何写操作或裁剪之后由 `invalidateHistory` 丢弃对应条目并重拉——`revalidatePath` 刷得了服务端数据，刷不了这份客户端缓存。为此 `StockMovementDialog` 新增可选 `onSuccess` 回调（详情页不传，行为不变）。

### 12.2 流水裁剪：append-only 的口子怎么开

用户需求：流水积累多了，有些商品的历史没有保留价值，需要"删除全部"或"只保留最近 3 条"。

这与 §4.1 / 迁移 `20260801140000` 的设计直接冲突（那两处专门把 `DELETE`/`TRUNCATE` 从 `authenticated` 上收回）。决策是**收窄而非推翻**，理由有二：

1. **余额不是从流水推出来的**。真身是 `inventory_levels.qty`，`qty_after` 只是快照，删流水不会让任何数字变错——丢的是解释，不是数额。
2. **表权限一点没放开**。`authenticated` 仍然摸不到 ledger 行，只能调用 `prune_product_movements(p_product_id, p_keep)`——一个 `SECURITY DEFINER` 函数，形状固定（单商品、按 `created_at DESC, id DESC` 保留最近 N 条）、且会留痕。

`p_keep = 0` 即全删，`p_keep = 3` 保留最近 3 条（常量 `MOVEMENT_KEEP_RECENT`，Server Action 用 `z.union([literal(0), literal(3)])` 把入参限死在这两个值上，不接受任意 N）。

**审计表 `inventory_movement_prunes`**：每次裁剪写一行，记录 `kept` / `deleted_count` / `qty_in` / `qty_out` / `first_at` / `last_at` / `pruned_by` / `pruned_at`。删除历史这个动作本身若不可见，正好复刻 Laravel 时代查不出所以然的处境。删除与汇总写在同一条语句里（`WITH doomed … removed AS (DELETE … RETURNING …)` 再对 `removed` 聚合），所以统计描述的恰是删掉的那批行，不存在二次扫描被并发插入挪动的可能。表只对 `authenticated` 授 `SELECT`，没有 INSERT 策略——能随手写这张表的客户端也就能伪造它。

**两个容易漏的权限点**（均已在迁移里处理）：

- 新函数默认对 `PUBLIC` 授 `EXECUTE`，`anon` 在 `PUBLIC` 里。`SECURITY INVOKER` 的函数背后还有 RLS 兜底，`SECURITY DEFINER` 没有——必须先 `REVOKE ALL … FROM PUBLIC` 再 `GRANT` 给 `authenticated`。
- 新表同样吃 §10.2 那条 Supabase 默认权限的亏（`anon`/`authenticated` 拿到 ALL），必须先 `REVOKE ALL` 再授 `SELECT`。
- 函数内显式检查 `auth.uid() IS NULL`：`SECURITY DEFINER` 以属主身份运行，调用者身份没有 RLS 替它把关。

**UI**：`movements-history-section` 在「Recent movements」标题右侧放一个 `⋯` 菜单，两项 Keep latest 3 / Delete all history，走全局 `useConfirm`（规则 9），文案点明"库存数量不受影响，仅删除记录，且不可恢复"。成功后 toast 汇总：`Deleted 12 movements — 340 in, 180 out (12 Mar 2026 – 28 Jul 2026)`。

**刻意不报数字的地方**：确认文案不写"删除 N 条"。时间线只取 `MOVEMENT_HISTORY_LIMIT = 20` 条，客户端手里的 `movements.length` 是下界不是总数，写成总数就是撒谎。`Keep latest 3` 在条数 ≤ 3 时禁用，用的是同一个下界——这个方向上它是准的。

### 12.2.1 审计记录的就地展示

审计表最初只写不读。补上的入口是**就地注记**而非独立页面：时间线下方按 `pruned_at` 倒序列出该商品最近 `PRUNE_NOTE_LIMIT = 5` 次裁剪，每条一行——

> ✂ 12 earlier movements deleted on 02 Aug 2026 　340 in, 180 out 　(12 Mar 2026 – 28 Jul 2026)

选它是因为**解释要出现在被解释的东西旁边**：时间线突然变短的地方，紧接着就是变短的原因。放进菜单里的弹窗则要先怀疑、再点开才看得到。

查询上把流水与裁剪记录合成 `fetchProductHistory`，两者一起取——只显示其一会误导：短时间线读起来像"没发生过事"，而真相是"记录被清了"。Server Action `loadProductMovements` 相应改名 `loadProductHistory`，列表页的客户端缓存改存 `ProductHistory`。

**一处必须联动的空态**：`StockMovementsTimeline` 的空态文案把责任推给遗留系统导入（"legacy system kept no usable history"），那只在没删过东西时成立。所以全删之后时间线整个不渲染，由注记独自解释——否则页面会对着自己刚删掉的东西说"当初导入就没有历史"。

### 12.3 本轮遗留

- **裁剪没有权限分级**：任何 `authenticated` 都能清空任意商品的流水。当前系统没有角色概念（§9 的 `created_by` 那条也提到这点），引入角色时应把 `prune_product_movements` 的 EXECUTE 收给管理员角色。
- **审计记录只在商品维度可见**：§12.2.1 的注记按商品显示、且只取最近 5 条，看不到"谁删的"（`pruned_by` 未展示，当前也只会是唯一的登录账号）。跨商品的运维视图（谁在什么时候删过什么、可按人筛）仍待建，数据已在 `inventory_movement_prunes` 里备好。

---

**迁移层与四处 UI 均已交付并验证通过。**
