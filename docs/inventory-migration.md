# Inventory 域迁移（go2_locations / go2_locations_products / go2_warehouses）— 开发文档

> 状态：**已实现并在远端库执行完成**（2026-08-01，见 §8.1.1）
> 创建日期：2026-08-01
> 前置文档：`docs/products-domain-migration.md`（products/brands/suppliers/origins 已迁移完成）、`docs/product-kits-migration.md`（product_kit_items 已迁移完成）
> 本轮范围：**仅迁移层**（schema 迁移 + 数据搬运脚本）。Inventory 管理页面 UI 另开一轮。

## 1. 目标

1. 将 Laravel 遗留表 `go2_locations` / `go2_locations_products` 迁移为正式表 `public.locations` / `public.inventory_levels`。
2. 提供**幂等**的数据搬运脚本 `scripts/migration/003_inventory_data.sql`，可在最终 Laravel 备份导入 `go2_*` 临时表后重复执行完成同步（详见 §8 上线切换 Runbook）。
3. `go2_warehouses` 按决策**不迁移**（见 §3）。

## 2. 现状核查（2026-08-01 连接远端库 `nszriuqpumbyigxwtccs` 实测）

### 2.1 源表结构（无任何 DB 级约束，与其他 `go2_*` 表一致）

`go2_warehouses`（**1 行**）：

| 列 | 类型 | 可空 | 实测值 |
|---|---|---|---|
| `id` | bigint | NO | `1` |
| `code` | varchar | YES | `Keysborough` |
| `state` | varchar | YES | `VIC` |
| `address` | varchar | YES | `6/110 Indian Dr, Keysborough VIC 3173` |
| `is_primary` | integer | NO | `1` |
| `status` | integer | NO | `1` |
| `created_at` / `updated_at` / `deleted_at` | timestamp | YES | `2020-03-29` / `2020-09-09` / `NULL` |

`go2_locations`（**24 行**，id 1–24）：

| 列 | 类型 | 可空 | 实测 |
|---|---|---|---|
| `id` | integer | NO | 连续 1–24，无空洞 |
| `name` | varchar | YES | **0 个 NULL**，24 个值**全局唯一**：`S-1-1`…`S-4-2`（14 个）、`P-1-1`…`P-1-10`（10 个） |
| `is_flow` | integer | NO | **恒为 1**（死字段） |
| `comments` | varchar | YES | **全部为 NULL** |
| `warehouse_id` | bigint | NO | **全部为 1**（只有一个仓库） |

> **注意：`go2_locations` 与 `go2_locations_products` 都没有 `created_at` / `updated_at` 列**，这是与 products / kits 两轮迁移最大的结构差异——本轮**没有**时区转换问题（products 与 kits 迁移中 `AT TIME ZONE 'Australia/Sydney'` 的处理在这里完全用不上）。

`go2_locations_products`（**2112 行**，id 1–2229）：

| 列 | 类型 | 可空 |
|---|---|---|
| `id` | integer | NO |
| `product_id` | integer | NO |
| `location_id` | integer | NO |
| `qty` | integer | NO |
| `logs` | text | YES（666 行为 NULL） |

### 2.2 引用完整性

- `go2_locations.warehouse_id` 孤儿引用 **0**
- `go2_locations_products.location_id` 孤儿引用 **0**
- `go2_locations_products.product_id` 对 `go2_products` 孤儿引用 **0**，但**有 12 行指向已软删除商品**（`deleted_at IS NOT NULL`），因此这 12 行在 `public.products` 中找不到对应商品：

  ```
  lp=207 prod=1151 qty=0   | lp=208 prod=1149 qty=-1  | lp=259 prod=1143 qty=0
  lp=260 prod=1146 qty=-2  | lp=261 prod=1142 qty=-1  | lp=263 prod=1153 qty=0
  lp=264 prod=1156 qty=-1  | lp=265 prod=1155 qty=0   | lp=266 prod=1471 qty=0
  lp=1257 prod=1154 qty=0  | lp=2178 prod=3149 qty=3  | lp=2217 prod=3193 qty=3
  ```

  其中 **2 行 qty 非零**（`lp=2178` 与 `lp=2217`，各 3 件）。按"只迁移未软删除商品"的既有决策，这 12 行会被跳过——包括那 2 行非零库存。
- `(product_id, location_id)` **无重复组合**。

### 2.3 关键结构性发现

**每个商品恰好只有 1 行库存记录**：2112 行 ↔ 2112 个不同 `product_id`。即**当前不存在"一品多库位"**，`go2_locations_products` 事实上退化成了"商品 → 它唯一的存放库位 + 数量"。

新表仍按 `UNIQUE (product_id, location_id)` 建模（允许一品多库位），因为：
- 这是库存表的正确通用模型，源数据只是碰巧没用到；
- 若反过来建成 `UNIQUE (product_id)`，将来要支持多库位就得做一次结构迁移。

对应的代价是：应用层"查某商品的库存"必须写成 `SUM(qty) GROUP BY product_id` 而非取单行，UI 也要按多行渲染。这一点在下一轮 UI 开发时必须落实，否则会出现"只显示第一个库位"的隐性 bug。

其他分布：
- 24 个库位中 **2 个（`P-1-6`、`P-1-7`）无任何商品**，其余 22 个有 8–276 行不等。
- **2 个 `is_kit = true` 的商品带有库存**：`GBDL00226`（2000 件）、`GBDL00057`（40 件），都在 `S-3-4`。与"套装由组件现场组装、不独立囤货"的假设冲突，见 §9。
- **191 行属于 `is_active = false` 的商品**，其中 147 行 qty 非零。

### 2.4 `qty` 数据质量（本轮最重要的问题）

| 区间 | 行数 |
|---|---|
| `qty < 0` | **488** |
| `qty = 0` | 218 |
| `qty > 0` | 1406 |

- 最低值 **-8390**（`lp=697`，商品 1497，库位 `S-3-4`），另有 `-5450` / `-4475` / `-4260` / `-4072` 等。
- **全表 `sum(qty) = -32455`**；只算正数行则为 `53393`。

结论：Laravel 侧长期"只扣不进"（出库自动扣减、入库未如实录入），账面已严重失真。**负数不是偶发脏数据，而是系统性失真**，不能靠人工挑几行修。

### 2.5 `logs` 字段勘察（结论：丢弃）

`logs` 是纯文本追加式流水，1446 行非空、共 **34332 条**记录，格式高度规整：

```
[IN] 7 [RECEIVE] BY Wayne [2019/02/09 11:23]
[OUT] 1 [AUTO] BY XOFFICE  [2019/03/26 12:17]
```

正则 `^\[(IN|OUT)\]\s+(-?[0-9]+)\s+\[([^\]]*)\]\s+BY\s+(.*?)\s*\[([0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2})\]$` 可解析 34331/34332 条（唯一失败的是一条缺数量的 `[IN]  [RECEIVE] BY Fei [2019/12/06 11:35]`）。

| 维度 | 分布 |
|---|---|
| 方向 | `OUT`=30592，`IN`=3739 |
| 原因 | `AUTO`=30325，`RECEIVE`=3684，`REPLACE`=253，`MOVE`=50，`ADJUST`=19 |
| 操作人 | `XOFFICE`=30325，`Wayne`=2942，`Fei`=1064 |
| 时间范围 | **2019/02/08 – 2020/03/26** |

**判定为无业务价值，不迁移**，依据有二：

1. **时间戳止于 2020-03-26**，而 `go2_warehouses.created_at` 是 2020-03-29 —— 这批流水是**上一代 XOFFICE 系统**的遗留，go2 上线后就再没往里写过。
2. **与当前 `qty` 不对账**：按 `IN − OUT` 累加复算，1446 行中**只有 134 行能对上**，1312 行对不上。它既不是当前库存的推导依据，也无法用来解释 §2.4 的负数是怎么来的。

## 3. 已与用户确认的关键决策

| 决策点 | 结论 |
|---|---|
| **仓库层级** | **不做 `warehouses` 表**。只建 `locations` 单层，且**不保留** `warehouse_id` 列，也不把仓库的 `code`/`state`/`address` 内联进 `locations`。仓库地址视为公司常量而非业务数据。 |
| **负库存** | **`qty < 0` 与 `qty = 0` 一律归零**，新表加 `CHECK (qty >= 0)` 硬约束。 |
| **`logs` 流水** | **不迁移，直接丢弃**（依据见 §2.5）。 |
| **本轮范围** | 仅迁移层：schema 迁移 + 数据脚本。UI 另开一轮。 |
| 主键策略 | 两张表都沿用 bigint 自增主键，**直接等于旧 `go2_*.id`**（与 products / kits 两轮一致，`ON CONFLICT (id)` 天然完成新旧映射，无需 mapping 表）。 |
| 12 行软删除商品 | 按既有决策**跳过**，包括其中 2 行非零库存。脚本输出诊断清单供人工确认。 |

### 3.1 关于"不做 warehouse 层"的代价（明确记录）

按此决策，`go2_warehouses` 的 `code` / `state` / `address` / `is_primary` / `status` **全部丢弃**，`go2_locations.warehouse_id` 也一并丢弃。当前只有 1 个仓库，信息零损失——但要清楚将来开第二个仓库时的补救成本：

1. 新建 `warehouses` 表；
2. 给 `locations` 加 `warehouse_id`（先可空）；
3. 回填现存 24 个库位到默认仓库；
4. 改为 `NOT NULL` 并加 FK；
5. 库位名唯一性从**全局唯一**改为**仓库内唯一**（`UNIQUE (warehouse_id, name)`）——这一步会牵动已写好的所有查询与 UI。

第 5 步是真正的痛点。若半年内有开第二仓的实际可能，建议现在就把两层建起来；否则按当前决策执行。**已按用户决定执行单层方案。**

## 4. 待确认的默认取值（如无异议按此实现）

| 项 | 默认做法 | 理由 |
|---|---|---|
| 库存表命名 | **`public.inventory_levels`** | 源表名 `go2_locations_products` 读起来像连接表，掩盖了它的核心是"数量"。`inventory_levels` 是库存领域的通用叫法（Shopify / NetSuite 同名概念），与项目既有的 `pricing_markup_tiers`、`product_kit_items` 命名风格一致。 |
| 库位表命名 | **`public.locations`** | 与源表对齐，且用户已明确只要这一层。 |
| `locations.name` 约束 | `NOT NULL` + 全局 `UNIQUE` | 实测 24 行无 NULL、无重复。全局唯一是单仓模型下的自然选择（见 §3.1 第 5 点的将来代价）。 |
| `is_flow` | **丢弃** | 恒为 1 的死字段，无任何区分度，凭空搬过来只会让人猜它是什么。 |
| `comments` | **保留**（`text NULL`） | 源表全空，但库位备注是可预期的运营需求，且与 `suppliers.comments` 的既有惯例一致。 |
| `created_at` / `updated_at` | 两张新表都加，默认 `now()` | 源表**没有**这两列，迁移行的时间戳即"迁入时刻"，无法还原真实创建时间。这是可接受的信息损失。`updated_at` 建 `moddatetime` 触发器自动维护（沿用 `20260719150000_add_products_timestamps_trigger.sql` 的既有模式）。 |
| `inventory_levels.product_id` FK 删除行为 | `ON DELETE CASCADE` | 商品被删除时其库存行失去意义，随之清理。 |
| `inventory_levels.location_id` FK 删除行为 | `ON DELETE RESTRICT` | 库位下还挂着商品时禁止删除该库位，由 UI 给出明确报错。与 `product_kit_items.component_product_id` 同理。 |
| `qty` 默认值 | `DEFAULT 0` | 新建库存行时"先占位、后入库"是常见操作。 |
| 归零行是否保留 | **保留行，qty 置 0** | 一行 `qty = 0` 表示"该商品归属此库位、当前无货"，保留了库位归属信息；删行会丢掉这个信息。 |

## 5. Schema 迁移设计

文件：`supabase/migrations/20260801100000_create_inventory_tables.sql`（按规则 14 包 `BEGIN` / `COMMIT`）

```sql
-- 1. 库位
CREATE TABLE public.locations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT locations_name_unique UNIQUE (name)
);

-- 2. 库存
CREATE TABLE public.inventory_levels (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  location_id bigint NOT NULL REFERENCES public.locations (id) ON DELETE RESTRICT,
  qty integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_levels_qty_non_negative CHECK (qty >= 0),
  CONSTRAINT inventory_levels_unique_product_location UNIQUE (product_id, location_id)
);
```

- 索引：`inventory_levels (location_id)` 单列索引（反查"该库位有哪些商品"）。`product_id` 已是 UNIQUE 约束的前导列，无需再建。
- 触发器：`locations_set_updated_at` 与 `inventory_levels_set_updated_at`，均为 `extensions.moddatetime (updated_at)`。
- RLS：两张表都 `ENABLE ROW LEVEL SECURITY` + 策略 `authenticated_full_access`（`FOR ALL TO authenticated USING (true) WITH CHECK (true)`）+ 显式 `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated` —— 与既有 5 张表完全一致（`config.toml` 未开 `auto_expose_new_tables`）。

## 6. 数据搬运脚本设计

文件：`scripts/migration/003_inventory_data.sql`

迁移顺序按 FK 依赖：**`locations` → `inventory_levels`**。

- 两条 `INSERT ... SELECT ... ON CONFLICT (id) DO UPDATE SET ...`，幂等。
- **显式列出目标列**，不使用 `SELECT *`（规则 15）。
- `locations`：`SELECT id, name, comments FROM public.go2_locations WHERE name IS NOT NULL AND btrim(name) <> ''`。当前实测过滤掉 0 行；该过滤是为最终同步兜底——若届时 Laravel 侧出现空名库位，脚本会跳过而非因 `CHECK` 约束整体回滚。
- `inventory_levels`：
  - `qty` 映射为 **`GREATEST(lp.qty, 0)`**，落实"负数归零"决策，同时保证永不违反 `CHECK (qty >= 0)`。
  - 双重 `EXISTS` 防御：只搬运商品存在于 `public.products`、且库位存在于 `public.locations` 的行。当前实测过滤掉 **12 行**（§2.2 的软删除商品）。
- **没有任何时区转换**：源表无时间戳列，`created_at` / `updated_at` 交给列默认值 `now()`，脚本不显式写入。相应地，`ON CONFLICT DO UPDATE` 子句里也**不**更新 `created_at`（这与 001 / 002 脚本不同，因为那两个脚本有旧时间戳可搬）。
- 脚本尾部保留**注释形式的诊断查询**，覆盖三件事：本次被跳过的行、本次被归零的行清单、行数与总量核对。
- 结尾对两张表 `setval` 到 `max(id) + 1`，避免应用新建行与迁移行 id 冲突。

### 6.1 幂等性的一处重要差异

`GREATEST(lp.qty, 0)` 意味着脚本每次重跑都会**把新表的 `qty` 强制拉回源表的值**。所以：

> ⚠️ **一旦新系统开始在 `inventory_levels` 上做真实的出入库操作，就绝不能再跑这个脚本**——它会用 Laravel 的旧数字覆盖掉新系统的账。

这与 001 / 002 脚本的风险等级不同（商品资料被覆盖尚可重新编辑，库存数字被覆盖则直接丢失盘点结果）。§8 的 Runbook 因此把"执行脚本"严格排在"新系统开放库存操作"之前。

### 6.2 需要同步修改的既有文件

- **CLAUDE.md 规则 15**：当前只点名 `001` / `002` 两个脚本。需把 `003_inventory_data.sql` 及 `locations` / `inventory_levels` 两张目标表纳入同步约束范围，并在清单中加一行指向本文档（同一次改动中完成）。
- **`src/lib/supabase/database.types.ts`**：按规则 18 **手工**补齐 `locations` 与 `inventory_levels` 的 `Row` / `Insert` / `Update` / `Relationships`。**严禁**用 `npx supabase gen types > ...` 重定向覆盖（本机无 Docker，会静默清空该文件）。

## 7. 落地文件清单

**新增**
- `supabase/migrations/20260801100000_create_inventory_tables.sql`
- `scripts/migration/003_inventory_data.sql`

**修改**
- `CLAUDE.md`（规则 15 纳入 003 脚本与两张新表）
- `src/lib/supabase/database.types.ts`（手工补齐两张表）

**本轮不涉及**（留给 UI 轮次）
- `src/lib/queries/inventory.ts`、`src/lib/actions/inventory.ts`、`src/lib/validations/inventory.ts`
- `src/app/(dashboard)/inventory/`、`src/app/(dashboard)/locations/`
- `src/components/layout/app-sidebar.tsx`（新增 Inventory 导航分组）
- 商品详情页 `Stock` tab

## 8. 执行与验证

### 8.1 首次执行（当前开发库）

1. 推送 schema 迁移（对外变更，执行前再次确认）：
   ```bash
   DB_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)
   npx supabase db push --db-url "$DB_URL" --dry-run   # 先确认待应用列表
   npx supabase db push --db-url "$DB_URL"
   ```
   （**严禁** `source .env.local`，见 CLAUDE.md 规则 16）

2. 执行数据脚本：
   ```bash
   npx supabase db query --db-url "$DB_URL" --file scripts/migration/003_inventory_data.sql
   ```
   **注意**：`supabase db query` 一次只接受**单条语句**（`cannot insert multiple commands into a prepared statement`），且以 `--` 开头的 SQL 会被当作命令行 flag。若报错，按 002 那轮的做法把脚本拆成单条语句逐条 `--file` 执行；脚本本身保留 `BEGIN` / `COMMIT`（规则 14），供 `psql` 一次性执行。

3. 验证——以下是**当前基线**（2026-08-01，已含套装排除，见下方"基线变更"）：

   | 检查项 | 预期值 |
   |---|---|
   | `SELECT count(*) FROM locations` | **24** |
   | `SELECT count(*) FROM inventory_levels` | **2098**（2112 − 12 行软删除商品 − 2 行套装） |
   | `SELECT count(DISTINCT product_id) FROM inventory_levels` | **2098** |
   | `SELECT count(DISTINCT location_id) FROM inventory_levels` | **22** |
   | `SELECT count(*) FROM inventory_levels WHERE qty = 0` | **696**（原 212 个零 + 484 个负数归零） |
   | `SELECT count(*) FROM inventory_levels WHERE qty > 0` | **1402** |
   | `SELECT sum(qty) FROM inventory_levels` | **51347** |
   | 被跳过的行 | **14** 行（12 软删除商品 + 2 套装），id 见 `003` 脚本诊断 2 |
   | 被归零的行 | **484** 行（源表 488 个负数减去 4 个属软删除商品的），合计核销 **−85843** 件 |
   | `locations` id 序列 | `setval` 到 **25** |
   | `inventory_levels` id 序列 | `setval` 到 **2230** |

   > **基线变更（2026-08-01，UI 轮次）**：初次迁移落地的是 **2100 行 / `sum(qty)` 53387 / 跳过 12 行**。随后按「套装不持有自身库存」的决策（见 `docs/inventory-ui.md` §3），迁移 `20260801130000_purge_kit_stock.sql` 删除了 2 行套装库存（`GBDL00226` 2000 件、`GBDL00057` 40 件），`003` 脚本同步加上 `NOT p.is_kit` 过滤以防最终同步时复活。上表已是变更后的值。

4. 逐字段抽查：随机取 20 行与 `go2_locations_products` 对照，确认 `id` / `product_id` / `location_id` 一致、`qty` 等于 `GREATEST(源 qty, 0)`。

5. 幂等性：**连续执行脚本两次**，上表所有数字不变（除 `updated_at` 会被 `moddatetime` 刷新为 `now()` —— 这是既有 trigger 的固有行为，与 002 那轮一致）。

### 8.1.1 实际执行结果（2026-08-01）

- `20260801100000_create_inventory_tables.sql` 已 push 到远端（结尾的 `failed to cache migrations catalog ... Docker` 是本地缓存警告，不影响远端）。结构核对：2 张表、8 个约束（2 PK / 2 FK / 2 UNIQUE / 2 CHECK）、`inventory_levels_location_id_idx`、2 个 `moddatetime` 触发器、RLS 均已启用、两条 `authenticated_full_access` 策略——与 §5 设计逐项一致。
- 数据脚本已执行：`INSERT 0 24`（locations）、`INSERT 0 2100`（inventory_levels），序列 `setval` 到 25 / 2230。
- 验证：§8.1 第 3 步的 **11 项预期值全部命中**，无一偏差。被跳过的 12 行 id 为 `207,208,259,260,261,263,264,265,266,1257,2178,2217`，与 §2.2 清单逐一吻合；归零 484 行、核销 −85843 件。
- **注**：以上 2100 / 53387 是**当日首次执行**的结果。同日稍晚的 UI 轮次排除了套装库存，当前值为 2098 / 51347，跳过行增至 14（新增 `1573`、`1576`）——见 §8.1 第 3 步下的基线变更说明。
- 逐字段比对 `go2_locations_products` ↔ `inventory_levels`（`product_id` / `location_id` / `qty = GREATEST(源, 0)`）与 `go2_locations` ↔ `locations`（`name` / `comments`）：**0 处不一致**。FK 孤儿引用 0。
- 幂等性：脚本**重跑一次**后仍为 24 / 2100 行，上述数字全部不变。
- **`updated_at` 行为**：重跑后 2100 行与 24 行的 `updated_at` 全部被 `moddatetime` 刷新为 `now()`（`DO UPDATE` 路径必然触发）。与 002 那轮一致，是既有 trigger 的固有行为，不是缺陷；但也意味着 `updated_at` 在最终同步前不具备"最后一次业务变更时间"的语义。
- **执行方式注意**：`supabase db query` 一次只接受**单条语句**（`cannot insert multiple commands into a prepared statement`）。本次是把脚本按语句拆成 4 条逐条 `--file` 执行；脚本本身保留 `BEGIN` / `COMMIT`（规则 14），供 `psql` 一次性执行。拆条执行时**没有事务包裹**，但两条 INSERT 都是幂等 upsert，中途失败重跑即可收敛。

### 8.2 上线切换 Runbook（最终生产数据同步）

这是用户特别关心的场景：Laravel 系统停用后，把最终生产备份导入 `go2_*` 临时表，再同步到正式表。**顺序不可颠倒**：

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | **冻结 Laravel**，停止一切出入库操作 | 之后 `go2_*` 数据不再变化，这是整个流程能成立的前提 |
| 2 | 导出 Laravel 最终备份，导入到 `go2_products` / `go2_kits` / `go2_locations` / `go2_locations_products` 等临时表 | 覆盖式导入，不是追加 |
| 3 | **暂停新系统的库存写入**（下线 Inventory 相关 Server Actions，或全库置为只读） | §6.1 的覆盖风险就发生在这一步没做到位时 |
| 4 | 依次执行 `001_products_domain_data.sql` → `002_product_kits_data.sql` → **`003_inventory_data.sql`** | 顺序即 FK 依赖顺序；三个脚本都幂等，可重复执行 |
| 5 | 跑 `003` 脚本尾部的三组诊断查询 | 见下表——**这一步不能跳过** |
| 6 | 人工裁决诊断结果 | 见下方"人工裁决清单" |
| 7 | 按 §8.1 第 3 步核对行数与总量（预期值需按最终备份重新计算，不再是 2026-08-01 的基线） | |
| 8 | 恢复新系统库存写入 | 此后**永久停用** `003` 脚本 |
| 9 | 全部核对通过后，清理 `go2_*` 临时表，`001`/`002`/`003` 三个脚本一并归档退休 | 规则 15 的脚本退休条款 |

**诊断查询与人工裁决清单**：

| 诊断项 | 预期（2026-08-01 基线） | 若非零怎么办 |
|---|---|---|
| 因商品缺失或为套装被跳过的库存行 | 14 行（12 软删除 + 2 套装） | 逐行确认商品确实该软删除。**若某行 qty 非零**（当前软删除侧有 2 行各 3 件），需决定是恢复该商品还是接受丢弃这批货。套装那 2 行是按决策正确丢弃的，无需处理 |
| 因库位缺失被跳过的库存行 | 0 行 | 说明 Laravel 侧新增了库位却没同步——检查 `go2_locations` 是否完整导入 |
| 因名称为空被跳过的库位 | 0 行 | 人工补名后重跑 |
| 被 `GREATEST` 归零的行 | 484 行 / 核销 −85843 件 | 数量若显著增长，说明冻结前又发生了大量失真扣减，需业务方确认是否要先在 Laravel 侧盘点 |

**关键提醒**：第 3 步和第 8 步是一对。如果切换当天新系统已经在做真实收发货，`003` 脚本会把这些操作的结果一笔抹掉，且**没有任何报错**——表现为库存数字悄悄退回 Laravel 的旧值。这是本次迁移最容易造成实际损失的操作风险。

## 9. 风险与注意事项

- **归零是不可逆的**。484 行负库存归零后，"这个商品曾经欠账 8390 件"这条信息在新库中不复存在（源表 `go2_locations_products` 清理前还留着底）。若日后要追查失真原因，必须在清理 `go2_*` 临时表**之前**做。建议第一次执行前先把 `go2_locations_products` 完整导出一份 CSV 存档。
- **归零掩盖了业务问题，不等于解决了**。`sum(qty)` 从 −32455 变成 53387，账面立刻"变好看"，但 484 个商品的真实库存仍然是未知数。**新系统上线后必须安排一次全仓实盘**，否则 `inventory_levels` 只是把一份失真数据换了个干净的外壳。这一点应在上线计划中单列一项，而不是当作迁移的附带事项。
- **2 个套装商品带库存**（`GBDL00226` 2000 件、`GBDL00057` 40 件）。DB 层不阻止给 `is_kit = true` 的商品记库存，但这与 `docs/product-kit-pricing.md` 里"套装成本由组件卷积得出"的模型冲突：套装既有独立库存、其组件又各自有库存，会导致可售量重复计算。本轮原样迁移，**UI 轮次需要明确套装的可售量口径**（取自身库存、取组件推算的最小可组装数、还是两者相加）。
- **191 行属于已停用商品**（147 行非零）。停用商品仍占着库位、仍有实物，属正常状态，不做特殊处理；但库存报表默认口径要想清楚是否包含它们。
- **一品多库位建模 vs 源数据一品单库位**：§2.3 已说明。UI 轮次必须按多行渲染并聚合求和，不能假设一个商品只有一行。
- **本次是第一次给这批数据加上真正的约束**（PK / FK / UNIQUE / CHECK）。当前数据在归零处理后 100% 满足，但最终同步时若 Laravel 又产生了重复的 `(product_id, location_id)` 组合或空名库位，脚本会报冲突或跳过，需人工介入。
- **`location_id` FK 为 `RESTRICT`**，意味着删除库位时会被库存行挡住——包括 `qty = 0` 的行。UI 轮次做库位删除功能时需给出清晰错误提示（"该库位下仍有 N 个商品，请先清空"）。

## 10. 下一轮（UI）待办

迁移层已完成，以下留给 Inventory 页面轮次：

- `src/lib/queries/inventory.ts` / `actions/inventory.ts` / `validations/inventory.ts`
- `/inventory` 列表页与 `/locations` 库位 CRUD（按规则 2 的 RESTful 扁平层级）
- 商品详情页新增 `Stock` tab（**必须按多行渲染并 `SUM(qty)` 聚合**，见 §2.3）
- `src/components/layout/app-sidebar.tsx` 新增 Inventory 导航分组
- 明确套装商品的可售量口径（见 §9 第三条）
- 库位删除的 `RESTRICT` 报错文案（见 §9 末条）

---

**迁移层已交付并验证通过。UI 轮次另起文档。**
