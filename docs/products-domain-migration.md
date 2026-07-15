# go2_products 关联表迁移 — 开发文档

> 状态：**待确认**（Plan and Execute 流程，需用户回复 "Go" 后方可开始编码）
> 创建日期：2026-07-15

## 1. 目标

将 Laravel 遗留库中的 `go2_products` 及其关联的 3 张查表（`go2brands`、`go2_suppliers`、`go2_origins`）迁移为本项目正式的 Supabase 表（`products` / `brands` / `suppliers` / `origins`），并建立一套**幂等的迁移脚本**，使其在 Laravel 系统停用、最终备份数据导入临时表后，可以重新执行同一脚本完成"数据同步"，无需另外设计同步逻辑。

本文档只覆盖 `go2_products` 及其直接关联的 3 张表，不涉及 `go2_kits`、`go2_orders`、`go2_buyers`、`go2_locations` 等其他遗留表（后续按同样模式逐张迁移）。

## 2. 现状核查（已通过 `supabase db query --db-url` 连接远程库确认）

- 4 张源表均**无任何 DB 级约束**（无主键、外键、唯一约束），完整性完全靠 Laravel 应用层保证。
- 数据质量：
  - `go2_products` 共 3152 条，`brand_id` / `supplier_id` / `sub_supplier_id` / `origin_id` 孤儿引用数均为 0。
  - `sku` 无重复、无空值。
  - 30 条软删除记录（`deleted_at` 非空）。
  - `freight_id` 3102/3152 条非空，但库中**没有任何 `freight` 相关表**，是悬空字段。
  - `is_gst` / `is_ebay` / `is_web` / `is_danger` / `is_kit` / `is_neto` / `is_preorder` / `status` 均为 `integer`，实测只有 0/1 两种取值。
  - `est_arrival_at` 为 `varchar`，但全表 3152 条均为 `NULL`。
  - `currency` 只有 `CNY`（2287）/ `AUD`（865）两种取值。
- `go2brands`（10 条）、`go2_suppliers`（46 条）、`go2_origins`（3 条）均为简单查表，字段无空值无重复。
- `go2_suppliers.nature` 基本为空，仅 6 条为 `"Oversea"`，判定为自由文本字段，不做枚举化。

## 3. 已与用户确认的关键决策

| 决策点 | 结论 |
|---|---|
| 新表主键策略 | **沿用 bigint 自增主键，直接等于旧 Laravel id**（不引入 UUID，也不需要额外的 `legacy_id` 字段——`id` 本身就是新旧映射） |
| 30 条软删除商品 | **本次只迁移未软删除的 3122 条**，软删除数据本次不处理 |
| 悬空字段 `freight_id` | **本次不迁移，丢弃该字段** |

待确认（可在回复 "Go" 时一并给出意见，否则按建议值执行）：
- `status` 是否改名为语义更明确的 `is_active`（当前建议：改名）
- 新表是否保留空的 `deleted_at` 字段供未来软删除功能使用（当前建议：保留，类型为 `timestamptz`，全部为 `NULL`）

## 4. 新表结构设计

迁移顺序（按依赖关系）：`origins` → `brands` → `suppliers` → `products`

- **`origins`**：`id bigint PK`（= 旧 id）、`name text`（原 `origin`）、`abbr text`
- **`brands`**：`id bigint PK`（= 旧 id）、`name text`、`abbr text`
- **`suppliers`**：`id bigint PK`（= 旧 id）、`company_name`、`contact_person`、`email`、`phone`、`address`、`bank_detail`、`comments`、`stock_duration numeric`、`nature text`
- **`products`**：`id bigint PK`（= 旧 id）+ 其余字段，关键改动：
  - `brand_id → brands.id`（FK，可空）、`origin_id → origins.id`（FK，**NOT NULL**）、`supplier_id` / `sub_supplier_id → suppliers.id`（FK，可空）
  - `is_gst / is_ebay / is_web / is_danger / is_kit / is_neto / is_preorder`：`integer` → `boolean`
  - `status`：`integer` → `boolean`，建议改名 `is_active`
  - `est_arrival_at`：`varchar` → `date`（当前全表为空，直接改类型无迁移风险）
  - **丢弃 `freight_id`**
  - **不迁移旧软删除数据**，新表保留空的 `deleted_at timestamptz` 字段（供未来使用）
  - `sku` 加 `UNIQUE` 约束
  - FK 列建索引：`brand_id`、`origin_id`、`supplier_id`、`sub_supplier_id`

- 4 张表均 `ENABLE ROW LEVEL SECURITY`，策略 `TO authenticated USING (true)`（内部后台数据，无需按用户过滤），并显式 `GRANT` 给 `authenticated` 角色（当前 `config.toml` 未开启 `auto_expose_new_tables`，需要手动 grant 才能通过 Data API 访问）。

## 5. 落地文件规划

- **Schema 迁移**：`supabase/migrations/<timestamp>_create_products_domain_tables.sql`
  - 纯 DDL：建表、约束、索引、RLS、GRANT
  - 按规则 15 使用 `BEGIN` / `COMMIT` 事务块
- **数据迁移脚本**：`scripts/migration/001_products_domain_data.sql`
  - 非 schema migration，属于一次性数据搬运
  - 每张表一段 `INSERT ... SELECT ... FROM go2_xxx ON CONFLICT (id) DO UPDATE SET ...`
  - 因新表主键直接复用旧 id，`ON CONFLICT (id)` 天然完成"旧 id ↔ 新 id"映射，无需额外 mapping 表
  - 迁移完成后执行 `SELECT setval(...)` 将各表 id 序列重置到 `max(id)+1`，避免未来新建数据与迁移数据 id 冲突

## 6. 停用 Laravel 后的同步方案

最终 Laravel 备份恢复进 `go2_*` 临时表后，**重新执行同一份 `scripts/migration/001_products_domain_data.sql`** 即可完成同步：upsert 逻辑自动处理新增记录和有变化的记录，不需要额外编写同步代码，也不需要再次演练除幂等性以外的其他逻辑。

## 7. 验证计划

- 迁移后对比行数：4 张新表 vs 源表（`products` 应为 3122，其余应与源表一致）
- 抽查外键孤儿引用（新表应为 0）
- 抽查若干条商品数据，人工核对字段映射及类型转换（尤其是 boolean 转换、`est_arrival_at` 类型变更）是否正确

## 8. 风险与注意事项

- 4 张源表在 DB 层无约束，本次迁移是**第一次**给这批数据加上真正的完整性约束（PK/FK/UNIQUE/NOT NULL），需要以当前实测的"0 孤儿引用、无重复 sku"为前提；若停用前 Laravel 侧又产生了不满足这些约束的新数据，最终同步执行时可能会报约束冲突，需要人工介入处理。
- `is_kit = 1` 的 639 条商品对应 `go2_kits` 表，本次不建立 `products` 与套装组成的关联，留待后续迁移 `go2_kits` 时一并处理。
- `docs/existing_schema.md` 和 `docs/existing_enum.md`（规则 3 要求的架构文档）目前尚不存在，本次迁移完成后应据此建立，供后续其他表迁移和业务开发查阅。

---

**请确认以上方向，回复 "Go" 后开始编写 SQL 文件（schema 迁移 + 数据迁移脚本）。如对 `status` 改名或 `deleted_at` 保留与否有不同意见，请一并说明。**
