@AGENTS.md
# 0. Language & Communication (核心沟通规范)
- **语言偏好**：始终使用 **简体中文 (Simplified Chinese)** 进行回复。
- **任务流程**：在生成执行计划 (Plan) 和任务总结 (Summary) 时，必须使用中文。
- **语气风格**：回复语气要专业、直接且简洁，避免冗长的开场白。

# 1. UI & Component Rules
- **语言标准**：所有 UI 文本、占位符和标签必须使用 **英文 (English)**。
- **组件库**：本项目使用 shadcn/ui。如果所需组件未安装在 `src/components/ui`，请先运行 `npx shadcn@latest add [component_name]`。
- **样式工具**：始终使用 `cn()` 工具函数（通常在 `lib/utils`）进行 Tailwind 类合并与条件渲染。
- **图标**：仅使用 `lucide-react`。

# 2. Next.js (App Router) Conventions
- **渲染模式**：默认使用 Server Components。仅在需要交互（Hooks、事件监听）时使用 `"use client"`，且尽可能保持在组件树末端。
- **异步处理 (Next.js 15+)**：`params` 和 `searchParams` 是异步的，在使用其属性前必须先执行 `await`。
- **数据变更**：优先使用 Server Actions 而非 API Routes。
- **路由结构 (REST 惯例)**：URL 必须遵循 RESTful 扁平层级——`/resources` 为集合列表页，`/resources/[id]` 为单条详情页。严禁在列表路由末尾追加 `/overview`、`/list` 等冗余路径段。例：`/products`（列表）、`/products/[id]`（详情）。

# 3. Database & Supabase Rules
- **架构感知**：在编写任何数据库查询前，必须先阅读 `docs/existing_schema.md`和`docs/existing_enum.md` 以了解表结构和关系。
- **服务端操作**：始终使用 Supabase Server Client 进行服务端操作。
- **类型安全**：始终使用生成的 Supabase TypeScript 定义，严禁在数据库负载或响应中使用 `any` 类型。

# 4. Async Tasks (Trigger.dev) Rules
- **异步解耦**：后台任务和重型异步任务（如文件生成、同步）必须卸载至 **Trigger.dev (最新稳定版本)**。
- **主线程保护**：严禁在 Next.js 请求主线程中执行耗时长的处理过程。
- **SDK**：始终使用 `@trigger.dev/sdk` 的 `task()`，严禁使用已废弃的 `client.defineJob()`。
- **Result 对象**：`triggerAndWait()` 返回 `{ ok, output, error }`，访问 `output` 前必须先检查 `result.ok`。
- **禁止并发等待**：严禁将 `triggerAndWait`、`batchTriggerAndWait` 或 `wait.*` 包裹在 `Promise.all` / `Promise.allSettled` 中。
- **文档同步**：每次新增或修改 `src/trigger/*.ts` 中的任何 Task，必须同步更新 `docs/current_tasks.md`，确保 Job ID、触发条件、入参、用途等信息与代码保持一致。

# 5. Architecture & Coding Standards (DRY)
- **代码复用**：严禁编写冗余代码。实现功能时应主动提取可复用逻辑至共享函数或 Hooks。
- **关注点分离**：保持组件小巧。将重型数据转换或业务逻辑移出组件树，放入工具类或 Services 中。

# 6. Forms & Data Validation
- **校验标准**：表单必须使用 `react-hook-form` 配合 `zod` 进行 Schema 校验。
- **双重校验**：在客户端 (Zod) 和服务端 (Server Actions) 同时实现数据验证。

# 7. Error Handling & User Feedback
- **标准响应**：Server Actions 必须返回标准格式：`{ success: boolean, data?: any, error?: string }`。
- **即时反馈**：使用 shadcn 的 Toast 机制（优先使用 `sonner`）反馈操作结果。

# 8. Import Conventions
- **绝对路径**：始终使用以 `@/` 为前缀的绝对路径（如 `@/lib/utils`），严禁使用相对路径。

# 9. Global Confirmation Dialog
- **统一交互**：任何危险或确认类操作（删除、提交等）严禁创建一次性弹窗。
- **共享机制**：必须使用全局共享的确认对话框组件或 `useConfirm` Hook。

# 10. AI Workflow: Plan and Execute
- **强制流程**：对于复杂任务或跨文件修改，必须执行"先计划，后执行"流程。
- **计划确认**：输出简要计划后，必须**停止**并等待用户回复 "Go" 或确认后方可编写代码。

# 11. Compaction Rules
- **上下文保留**：运行 `/compact` 时，必须保留数据库架构焦点、活动测试命令和核心实现逻辑。
- **冗余丢弃**：自动丢弃已解决的样式调试和重复的错误修复记录。

# 12. Dialog / Modal Viewport Safety
- **高度限制**：所有 Dialog / Modal 容器必须设置 `max-h-[85vh]` 并启用 `overflow-y-auto`，确保内容永不超出视口。
- **交付检查**：提交前须在移动端和桌面端各验证一次，确认无内容截断或滚动异常。

# 13. AI / Third-Party Service Recommendations
- **全景扫描**：在推荐任何 AI 模型、搜索 API 或第三方服务之前，必须系统性地列出所有主流候选方，**严禁凭记忆或习惯直接给出单一推荐**。
- **Google 生态优先考虑**：本项目已使用 Google Maps API，Google AI Studio（Gemini）和相关 Google 服务必须纳入候选，尤其在涉及搜索、语言模型、图像识别等场景时。Gemini 2.0 Flash + Google Search Grounding 在产品信息检索场景中具有明显优势（Google 拥有全球最大搜索索引）。
- **已有生态联动**：在推荐新工具前，先检查 `.env.local` 和 `package.json`，识别项目已接入的服务供应商，优先在已有账号体系内扩展，降低管理成本。

# 14. Supabase 数据库结构演进规则
- **迁移优先原则**：严禁直接通过 Supabase Studio (图形界面) 手动修改生产或本地数据库结构。所有变更必须通过编写迁移文件 (`supabase/migrations/*.sql`) 实现。
- **原子事务保障**：所有迁移 SQL 文件必须包含 `BEGIN;` 和 `COMMIT;` 事务块，确保变更执行过程中的数据安全性。

# 15. 遗留数据迁移脚本同步规则
- **适用范围**：`scripts/migration/*.sql` 是 Laravel 遗留表向正式表迁移的一次性数据搬运脚本，脚本内每张目标表的 `INSERT` 语句必须显式列出目标列，严禁使用 `SELECT *`。当前脚本清单：
  - `001_products_domain_data.sql`：`go2_products`/`go2brands`/`go2_suppliers`/`go2_origins` → `products`/`brands`/`suppliers`/`origins`（详见 `docs/products-domain-migration.md`）。**`created_at` / `updated_at` 必须保持 `COALESCE(源值, 目标现有值, now())` 三级回退**：`go2_products` 被重新导入后有 1767 行 `created_at`、1167 行 `updated_at` 为 NULL，直接插入会撞 NOT NULL 让整个事务回滚（2026-08-02 实测）；**第二级不可省**——省掉会把这 1767 个商品的创建日期静默重置为迁移当天
  - `002_product_kits_data.sql`：`go2_kits` → `product_kit_items`（详见 `docs/product-kits-migration.md`）
  - `003_inventory_data.sql`：`go2_locations`/`go2_locations_products` → `locations`/`inventory_levels`（详见 `docs/inventory-migration.md`）。`go2_warehouses` 按决策不迁移；库存行的 `EXISTS` 守卫带 `NOT p.is_kit`（套装不持有自身库存），**该条件不可删除**——删掉会让最终同步把已清除的套装库存搬回来并撞上 `inventory_levels_reject_kit_stock` 触发器
  - `004_orders_data.sql`：`go2_buyers`/`go2_orders`/`go2_transactions`/`go2_transactions_products` → `customers`/`orders`/`order_transactions`/`order_items`（详见 `docs/orders-domain-migration.md`）。依赖 001 与 003 已重跑（`product_id` 与 `location_id` 分别对着 `public.products` 与 `public.locations` 解析）
- **强制同步触发条件**：若正式表（`products`/`brands`/`suppliers`/`origins`/`product_kit_items`/`locations`/`inventory_levels`/`customers`/`orders`/`order_transactions`/`order_items`）中**被脚本引用的列**发生改名、删除，或类型变更导致与脚本映射逻辑不兼容，必须在同一次改动中**同步修改对应脚本的映射/类型转换语句**；与遗留数据无关的新增业务字段（脚本未引用）无需同步。
- **003 脚本的额外风险**：`003` 的 `qty` 映射为 `GREATEST(源值, 0)`，每次执行都会用 Laravel 旧值**覆盖** `inventory_levels.qty`。新系统开始真实出入库后再执行它，会静默抹掉这些操作且不报错。执行前必须暂停库存写入，上线后该脚本立即退休。
- **004 脚本的额外风险（trigger 必须禁用）**：`004` 第 3 段用 `ALTER TABLE ... DISABLE TRIGGER` 关掉 `order_transactions_rebuild_items_insert` / `..._update` 两个触发器，插完 `order_transactions` 与 `order_items` 后再打开。**这两句不可删、不可拆到不同事务**——触发器开着灌 `order_transactions` 会立刻用今天的 BOM 重算全部 25 万行 `order_items`，覆盖历史实际记录、丢掉 3,026 行无法重算的明细和 28,893 行拣货库位，**全程不报错**。脚本尾部诊断 6（`order_items` 中 `is_auto_generated = true` 的行数应为 0）是唯一的事后检验。
- **004 的 `shipping_method` 映射**：`orders.shipping_method` 枚举只覆盖 16 个遗留值，其余 7 个已停用承运商落到 `legacy_shipping_method` 文本列。改动 `public.shipping_method` 枚举时必须同步检查 `004` 的 `CASE` 映射表，否则新值不会被用上、旧值会静默改道进 legacy 列。
- **004 的第 5 段（`order_metrics_summary` 重建）不可省**：第 2 段与第 3 段用 `ALTER TABLE ... DISABLE TRIGGER` 关掉 `order_metrics_summary` 的 8 个 `oms_*` 触发器（`orders` 上 2 个、`order_transactions` 上 3 个、`order_items` 上 3 个），导入完成后由**第 5 段** `SELECT public.recompute_order_metrics(NULL)` 全量重建。这些触发器是**语句级**的，留着它们不是「触发 25 万次」，而是一次触发拿到一个 25 万行的 transition table、再变成一个 25 万元素的 `bigint[]` 交给重算函数，同样跑不动。**跳过第 5 段不会报任何错**——订单列表页与详情页会一直显示导入前的金额、重量与尺寸。诊断 8a（`summary_rows` 应等于 `orders`，且 `oldest_computed_at` 来自本次运行）是唯一的事后检验。详见 `docs/order-metrics.md`
- **001 的商品行不再逐字等于 `go2_products`**：`products_normalize_fields` 触发器（迁移 `20260808140000`）在写入时把 SKU 大写、把长宽高排序成 L ≥ W ≥ H（476 个商品、15% 受影响）。这是 `order_metrics_summary` 装箱估算的前置条件（它沿高度累加），但意味着**对 001 做列对列 diff 校验时这些行会被报成不一致**——要比较排序后的三元组
- **004 的 `order_status` / `sales_platform` 映射（拼写必须逐字对齐）**：这两列不走 `CASE` 映射，而是 `lower(源值)::enum` 直接转换，所以**每个枚举标签必须是 Laravel 值的精确小写形式**。`public.order_status` 现有 **8** 个值（`20260804100000` 补齐了 Laravel 下拉的全部选项，`20260808120000` 删掉了业务不用的 `new`，`20260808130000` 又删掉了同样不用的 `picked`——两者均 0 行在用，且最终备份只产出 `COMPLETED`/`CANCELLED`/`PROCESSING`/`ISSUED` 四个值，故删它们不影响 004），其中 `labelled` 是英式双 L——写成 `labeled` 会让转换无值可解，**在最终同步时炸掉整个 004 事务**，而这个错误在此之前不会以任何形式暴露。新增或改动这两个枚举的值时，必须同步核对 Laravel 侧的原始拼写。
- **执行方式**：一律用 `node scripts/migration/run-all.mjs`（按 001→002→003→004 顺序执行 + 自动验证），**严禁**用 `supabase db query` 跑这些脚本——它不接受多语句文件，而按分号拆开执行会破坏事务边界（`004` 的 `DISABLE TRIGGER` 与 INSERT 必须同事务）。`003` 默认被拦住，需显式加 `--i-have-suspended-inventory-writes`。只验证不导数用 `--checks-only`。
- **远端 `statement_timeout` 是 2 分钟**：首次导入约 50 秒，但最终切换是全量 upsert 重跑，实测 132 秒被杀。`004` 的四个事务块已各自 `SET LOCAL statement_timeout = 0`；新增大数据量脚本时必须照做。
- **`go2_*` 临时表没有任何索引**：针对它们写校验查询时严禁用相关子查询（每行一次全表扫），必须先 `GROUP BY` 聚合再 `JOIN`。
- **脚本退休**：这些脚本仅服务于"Laravel 系统停用 + 最终生产备份导入临时表"这一次性事件，成功执行最后一次导入并清理 `go2_*` 临时表后，脚本即完成使命，可归档、无需继续长期维护。

# 16. 环境变量读取规则（.env.local）
- **严禁 source**：在 shell 中取 `.env.local` 的值时，**严禁**使用 `source .env.local` / `. .env.local`（无论是否配合 `set -a`）。该文件会被当作脚本执行：值里的 `$xxx` 被展开、`$(...)` 被真实执行。
- **背景**：`DATABASE_URL` 的密码含 `$`。实测（2026-07-25）`bash source` 把 `$3` 当位置参数吞掉，`@next/env` 内置的 dotenv-expand 把 `$3195bb` 整段当变量名展开为空。**两者都静默产出一个只是短了几个字符的值**，故障表现为 `password authentication failed`，极易误诊为"密码错误"。**加单引号只能挡住 bash，挡不住 dotenv-expand**。
- **正确取法（二选一）**：
  - 让工具自己读：`npx dotenv-cli -e .env.local -- <command>`
  - 字面解析、不做展开：`VAL=$(grep -m1 '^KEY=' .env.local | cut -d= -f2-)`
- **新增变量约束**：若新变量的值含 `$`，必须在 `.env.local` 中写成 `\$` 转义（这是唯一在 bash 与 dotenv-expand 下均正确的写法），且此时上面的 `grep | cut` 取法需先 unescape，两种取法不可混用。能避开 `$` 时优先选用不含 `$` 的值。

# 17. charm_price 双实现同步规则
- **双实现约束**：`src/lib/pricing.ts` 的 `charmPrice()` 是 `supabase/migrations/20260729120000_create_product_pricing_view.sql` 中 `public.charm_price(numeric)` 的 TypeScript 镜像。SQL 侧算建议零售价，TS 侧在详情页 `Retail Price` 失焦时收敛用户手输的价格。
- **强制同步**：修改任意一侧的取整规则（`floor(x) + 0.95`、非正数直接返回、精度处理）时，必须**同步更新另一侧**，并在 `src/lib/__tests__/pricing.test.ts` 中补充对应用例。两侧漂移的表现是「表单收敛到一个值、视图建议价却是另一个值」，不会报错、只会静默不一致。
- **验证命令**：`npm test`（Vitest 跑 `src/lib/__tests__/pricing.test.ts`）。改动后还需用同一组输入跑一遍 SQL 侧比对，例如 `SELECT v, public.charm_price(v) FROM (VALUES (24.10),(19.99),(19.95),(0.01),(0),(-0.30)) AS t(v);`。

# 18. Supabase 类型定义维护规则
- **手工维护**：`src/lib/supabase/database.types.ts` 由**手工维护**，不是生成产物。`npx supabase gen types` 需要 Docker/Podman 拉 `postgres-meta` 镜像（本机没有），会静默失败并把目标文件清空 —— 严禁用 `> src/lib/supabase/database.types.ts` 重定向直接覆盖。
- **强制同步**：新增或修改表 / 视图 / 枚举 / 函数的迁移，必须在**同一次改动**中手工补齐该文件对应的 `Tables` / `Views` / `Enums` / `Functions` 条目。
- **视图类型**：视图只需 `Row`（无 `Insert` / `Update`），用 `Views<"view_name">` 取用。

# 19. 商品字段归一化触发器（products_normalize_fields）
- **不变量**：`public.products` 上的 `products_normalize_fields` BEFORE INSERT/UPDATE 触发器（迁移 `20260808140000`，移植自 xpros 的 `format_product_fields_logic` 模块 1 与 3）保证三件事：`sku` 必为 `upper(trim(...))`；`length >= width >= height`；`name` / `ebay_title` 在**被写入时**做 `initcap(trim(...))`。
- **两处依赖它，且都是静默失败**：
  - `public.rebuild_order_items` 用 `WHERE sku = upper(trim(v_label))` 匹配 `custom_label`。只归一化 label 一侧才能走 `products_sku_key` 唯一索引；一旦停用触发器导致库里出现非大写 SKU，匹配会失败并**静默生成 `product_id IS NULL` 的占位行**，不报错。
  - `public.order_metrics_summary` 的装箱估算沿**高度**累加（`max(L) × max(W) × sum(H)`），内建「H 是最短边」的假设。尺寸失序会让该商品所在的每张订单计费重虚高。
- **`name` 的 initcap 只对新写入生效**：触发器里的 `NEW.name IS DISTINCT FROM OLD.name` 守卫**不可删**。商品表单保存时提交全部字段，删掉守卫会让「改一次价格」顺带重写商品名，把有意保留的 1,464 行历史命名（47%）在日常编辑中悄悄回填掉。原因见 `docs/order-metrics.md` §5。
- **严禁移植 xpros 的零售价美化**：xpros 同名函数的模块 2 在写入时做 `CEIL(x+0.01) - 0.05`，与本项目的 `floor(x) + 0.95` **不是同一个规则**，且本项目已有规则 17 管理的双实现。加进来会变成三实现，并在用户保存时静默改掉刚输入的价格。

# 20. 运单号归一化（normalize_tracking_number）
- **不变量**：`public.orders` 上的 `orders_normalize_tracking_insert` / `_update` 两个触发器（迁移 `20260808210000`）保证 `tracking_number` 存的是承运商 article ID，而不是条码枪扫出来的 GS1-128 全串。函数 `public.normalize_tracking_number(text)` 幂等，找不到规则时**原样返回**。详见 `docs/order-tracking-number.md`。
- **规则表按前缀而非 `shipping_method` 分支**：`33GLH`（在用）/ `33HKT`（已停用，留着只为修 3,026 行历史）截 12 位，`TMP` / `RPP` 截 25 位，`99` 截 23 位。**新增承运商或换 eParcel charge account 时必须加对应分支**，否则新单的运单号会以 41～74 字符的原始条码串入库——承运商官网不认、订单页读不出，且**不报任何错**。严禁照抄 xpros 的 `S8P` / `33RCA` / `34HA9` / `34HAA` 常量，那是 xpros 自己的账号前缀，在本库 0 命中。
- **`004` 必须关掉它并内联调用（两半都不可删）**：这两个触发器是**行级**的，灌 203,315 行订单就是真触发 203,315 次，所以 `004` 第 2 段 `DISABLE` 它们、在 `SELECT` 里内联 `public.normalize_tracking_number(o.tracking_number)`、段尾再 `ENABLE`。只删 `DISABLE` 是慢；**只删内联调用则会静默导入 27,709 行原始扫码输出**。
- **列对列 diff 必须两侧都套函数**：`004` 诊断 7 与 `run-all.mjs` 的「orders — field-by-field against the source」比对 `tracking_number` 时，源侧要套上同一个函数，否则一次正确的导入会报出五位数 mismatch（与规则 15 里 `001` 的商品行是同一类陷阱）。
- **校验查幂等，不查「还有没有条码串」**：353 行因没有对应规则而合法保留信封，用 `~ '01[0-9]{14}91'` 断言为 0 会让检查永远失败。正确写法是 `tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number)` 计数为 0。

