# Products 管理页面 — 开发文档

> 状态：**已实现**（确认点 A=下拉选择、B=每页 20 条，均已采纳）
> 创建日期：2026-07-19

## 1. 目标

在已有的 `/products` 入口（sidebar 已就绪，当前为 `PlaceholderPage` 占位）实现商品列表管理页：

- **服务器端**分页 + 过滤 + 排序（`products` 表 3122 条数据，不能一次性全量拉取，区别于 brands/suppliers/origins 的前端全量过滤模式）。
- 过滤条件全部记录到 **URL query string**，浏览器后退时过滤结果不被重置。
- 支持删除；新建、编辑（新窗口）本次仅预留入口，标记「待开发」。

## 2. 数据结构参照

`products` 表（详见 `docs/products-domain-migration.md` 第 4 节、`src/lib/supabase/database.types.ts`）本页涉及字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `id` | bigint PK | row key、删除定位 |
| `sku` | text (unique) | 过滤 + 列展示 |
| `name` | text \| null | 过滤 + 列展示 |
| `upc` | text \| null | 过滤 |
| `model` | text \| null | 过滤 |
| `brand_id` | bigint \| null → `brands.id` | 过滤（品牌）+ 列展示品牌名 |
| `supplier_id` | bigint \| null → `suppliers.id` | 过滤（供应商） |
| `image_url` | text \| null | 列展示缩略图 |
| `retail_price` | numeric \| null | 列展示 |
| `is_active` | boolean | 过滤 + 列展示 status（注意：迁移时 `status` 已改名为 `is_active`） |
| `is_kit` | boolean | 过滤 |
| `created_at` | timestamptz \| null | 默认排序键（desc） |

关联查表用于过滤下拉与列展示品牌名：`brands`（10 条）、`suppliers`（46 条）。

## 3. 过滤器设计（需确认）

用户要求的过滤项：sku、name、brand name、supplier.company_name、upc、model、status、is kit。

考虑到 `brands`/`suppliers` 基数极小（10 / 46 条），**品牌与供应商采用下拉选择（Select，按 id 过滤，显示名称）而非自由文本**，服务端查询更简洁（直接 `.eq("brand_id", …)`，无需 `!inner` join 过滤关联列）；其余按性质区分：

| 过滤项 | 控件 | URL 参数 | 服务端条件 |
|---|---|---|---|
| SKU | 文本框（debounce 300ms） | `sku` | `.ilike("sku", %v%)` |
| Name | 文本框（debounce） | `name` | `.ilike("name", %v%)` |
| UPC | 文本框（debounce） | `upc` | `.ilike("upc", %v%)` |
| Model | 文本框（debounce） | `model` | `.ilike("model", %v%)` |
| Brand | Select | `brandId` | `.eq("brand_id", v)` |
| Supplier | Select | `supplierId` | `.eq("supplier_id", v)` |
| Status | Select（All / Active / Inactive） | `status` | `.eq("is_active", true/false)` |
| Is Kit | Select（All / Yes / No） | `isKit` | `.eq("is_kit", true/false)` |
| 分页 | — | `page`（默认 1）| `.range(offset, offset+size-1)` |

- `pageSize` 固定 20（暂不暴露到 URL，如需再加）。
- 排序固定 `created_at DESC`（本次不做列排序，如需后续再加 `sort`/`dir` 参数）。
- 空值参数不写入 URL，保持链接干净。

> **待确认点 A**：品牌 / 供应商用「下拉选择」是否符合预期？（备选：自由文本模糊匹配关联表名，需 `!inner` join，实现更重。）

## 4. 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│ Products                                   [ + Add Product ] │  ← 标题栏，按钮 disabled + tooltip「Coming soon」
│ Manage your product catalog.                                 │
├─────────────────────────────────────────────────────────────┤
│ Filter Bar（响应式 grid，flex-wrap）                          │
│  [SKU][Name][UPC][Model] [Brand▾][Supplier▾][Status▾][Kit▾]  │
│  [Clear filters]                                             │
├─────────────────────────────────────────────────────────────┤
│ ┌─Image─┬─SKU───┬─Name────┬─Retail─┬─Brand──┬─Status─┬─Act─┐ │
│ │ [img] │ ABC01 │ Widget  │ $12.00 │ Acme   │ ●Active│ ✎🗑 │ │
│ │  ...                                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
│  Showing 1–20 of 3122          [‹ Prev]  Page 1  [Next ›]    │
└─────────────────────────────────────────────────────────────┘
```

列定义：

| 列 | 内容 | 说明 |
|---|---|---|
| Image | `image_url` 缩略图 | 40×40 rounded；无图显示 lucide `ImageOff` 占位 |
| SKU | `sku` | `font-medium` |
| Name | `name` | 为空显示 `—` |
| Retail Price | `retail_price` | 格式化货币；为空 `—` |
| Brand | `brands.name` | 关联；为空 `—` |
| Status | `is_active` | shadcn `Badge`（Active=default / Inactive=secondary） |
| Actions | Edit / Delete | Edit=新窗口占位（disabled + tooltip「待开发」）；Delete=`useConfirm` + server action |

## 5. 落地文件规划

沿用 brands/suppliers 的目录约定（`page.tsx` + `_components/` + `lib/actions` + `lib/validations`）：

```
src/app/(dashboard)/products/
  page.tsx                       # Server Component：await searchParams → 建查询 → 拉数据+count+品牌/供应商选项 → 渲染
  _components/
    products-filters.tsx         # "use client"：过滤控件，写 URL（router.replace，back 保留）
    products-table.tsx           # "use client"：表格 + 删除交互（useConfirm + toast）
    products-pagination.tsx      # "use client"：分页，更新 URL page 参数
    product-status-badge.tsx     # 纯展示 Badge（可并入 table）
src/lib/
  actions/product.ts             # deleteProduct(id)（create/update 待开发，暂不建）
  queries/products.ts            # buildProductListQuery：集中构造过滤/分页查询，避免 page.tsx 臃肿（DRY，规则 5）
```

### 关键实现要点

- **page.tsx（Server Component）**：
  - `searchParams` 为 async，需 `await`（规则 2）。
  - 用生成的 Supabase 类型，严禁 `any`（规则 3）。
  - 主查询：`.select("id, sku, name, retail_price, image_url, is_active, brand_id, brands(name)", { count: "exact" })` + 逐条件 `if` 拼接 + `.order("created_at", { ascending: false })` + `.range(...)`。
  - 另查 `brands`/`suppliers` 供过滤下拉（小表，全量）。
- **URL 作为唯一状态源**：过滤/分页组件只改 URL（`useSearchParams` + `usePathname` + `router.replace(scroll:false)`），Server Component 依 URL 重新取数 → 天然满足「后退不重置」。
- **过滤联动分页**：任一过滤变化时把 `page` 重置为 1。
- **文本过滤 debounce**：300ms，避免每次击键触发导航。
- **删除**：`deleteProduct` 返回标准 `{ success, error? }`（规则 7），`revalidatePath("/products")`，`sonner` toast 反馈（规则 7），确认走全局 `useConfirm`（规则 9）。
- **Add / Edit 占位**：按钮 `disabled` + tooltip 提示「Coming soon / 待开发」，不建空弹窗。

## 6. 依赖与前置

- 需新增 shadcn 组件：**`select`**（过滤下拉；当前 `src/components/ui` 未安装）。执行 `npx shadcn@latest add select`（规则 1）。
- `badge`、`pagination`、`table`、`input`、`tooltip` 均已存在，直接复用。
- 无需数据库迁移（表结构已就绪）。
- 无 Trigger.dev / 重型异步任务，纯读取 + 单条删除。

## 7. 开发步骤

1. `npx shadcn@latest add select`（安装缺失组件）。
2. `src/lib/queries/products.ts`：定义过滤参数类型 + `buildProductListQuery`（含类型安全的条件拼接）。
3. `src/lib/actions/product.ts`：`deleteProduct(id)`（FK/错误处理复用 `action-result.ts` 工具）。
4. `products/_components/products-filters.tsx`：过滤栏 + URL 同步 + debounce + Clear。
5. `products/_components/products-pagination.tsx`：分页 + URL `page` 同步。
6. `products/_components/products-table.tsx`：表格列渲染 + 删除交互 + Add/Edit 占位。
7. 改写 `products/page.tsx`：Server Component 取数并组装上述组件。
8. 自测：过滤组合、分页边界、后退保留过滤、删除、空结果态；桌面 + 移动端各验一次（规则 12 针对弹窗；此处主要验过滤栏响应式换行）。

## 8. 本次不做（明确边界）

- ~~新建产品~~（见第 9 节，本轮实现）、编辑产品（Edit 新窗口页 `/products/[id]/edit` 或独立路由）——Edit 仍仅留占位入口。
- 列排序、每页条数切换、批量操作、导出。
- 图片放大预览。

---

# 9. Add Product（新建产品弹窗）

> 状态：**已实现**
> 追加日期：2026-07-19

## 9.1 目标

点击列表页标题栏 `+ Add Product` 弹出 Dialog（复用 shadcn `dialog`），填写必要字段后新建一条 `products` 记录。SKU 由系统自动生成，用户不可编辑。

## 9.2 SKU 自动生成规则

`sku = brand.abbr + lpad(id, 5, "0") + origin.abbr`

- `id` 为 `products` 表自增主键，**插入后才产生**，而 `sku` 列为 `NOT NULL` → 存在「鸡生蛋」矛盾。
- **采用方案 A（两步写入，Server Action 内完成）**：
  1. 先 `insert` 一行，`sku` 用唯一临时占位（如 `__PENDING__` + 时间戳/随机串，避开 unique 冲突），`.select("id").single()` 拿回真实 `id`。
  2. 拉取所选 brand / origin 的 `abbr`，拼出正式 sku，对该 `id` 执行 `update`。
  3. 任一步失败：删除刚插入的占位行（补偿回滚）并返回标准错误。
- **唯一性**：`id` 天然唯一 → 拼出的 sku 天然唯一；`sku` 列的 unique 约束作为兜底。`abbr` 缺失时的处理见 9.5。

## 9.3 弹窗字段（用户输入）

| 字段 | 控件 | 必填 | 写入列 | 说明 |
|---|---|---|---|---|
| Brand | Select | ✅ | `brand_id` | 同时取 `abbr` 拼 SKU |
| Origin | Select | ✅ | `origin_id` | 同时取 `abbr` 拼 SKU（NOT NULL） |
| Name | Input | ✅ | `name` | 表列可空，但表单强制必填 |
| Supplier | Select | ✅ | `supplier_id` | 本表单强制必填（列本身可空） |
| Weight | Input(number) | ✅ | `weight` | NOT NULL，无默认，必填实际重量 |
| Currency | Select | ✅ | `currency` | 枚举 USD/AUD/CNY，**默认 CNY** |
| Purchase Price | Input(number) | ✅ | `purchase_price` | 本表单强制必填（列本身可空） |
| Length / Width / Height | Input(number) | ➖ | `length` / `width` / `height` | 列 NOT NULL；**留空则各自兜底 10**（前端占位 + 服务端 `?? 10`） |
| Model | Input | ➖ | `model` | 可选 |
| UPC | Input | ➖ | `upc` | 可选 |
| Retail Price | Input(number) | ➖ | `retail_price` | 可选 |
| Is Active | Switch | — | `is_active` | **默认 true** |
| Is Kit | Switch | — | `is_kit` | **默认 false** |

## 9.4 固定值 / 不入弹窗字段

以下 NOT NULL 或非必要列不在弹窗展示，由 Server Action 写死：

| 列 | 值 | 备注 |
|---|---|---|
| `is_gst` | `false` | 默认不含 GST |
| `sku` | 见 9.2 | 系统生成，不可编辑 |
| `image_url` / `ebay_title` / `description` / `comment` | `null` | 留详情页/编辑页维护 |

## 9.5 校验（规则 6：Zod 客户端 + Server Action 服务端双重）

- Zod schema：Brand/Origin/Supplier 为正整数 id；Name 非空；Weight/Purchase Price 为 `> 0`（或 `>= 0`）数字；Currency ∈ 枚举；Retail Price、Length/Width/Height 可空、正数（L/W/H 留空由服务端 `?? 10` 兜底）。
- 服务端二次校验同一 schema；并校验所选 brand/origin 存在且 `abbr` 非空——`abbr` 缺失时拒绝并返回明确错误（无 abbr 无法拼 SKU）。
- 返回标准 `{ success, error?, data: { id } }`（规则 7）；成功后 `revalidatePath("/products")` + `sonner` toast，并**跳转到新产品详情页 `/products/[id]`**（见第 10 节）。

## 9.6 落地文件（在第 5 节基础上新增）

```
src/app/(dashboard)/products/_components/
  product-form-dialog.tsx        # "use client"：Dialog + react-hook-form + zod，提交调 createProduct
src/lib/
  actions/product.ts             # 新增 createProduct(input)（两步写入 + 补偿回滚）
  validations/product.ts         # productCreateSchema（客户端/服务端共享）
```

- `page.tsx` 已查 brands/suppliers 供过滤下拉；额外查 `origins`（小表，全量）供弹窗 Select，一并传入。
- 复用第 6 节已装的 `select`；新增 shadcn `dialog`、`switch`、`form`、`label`（缺失则 `npx shadcn@latest add ...`，规则 1）。
- 标题栏 `+ Add Product` 由占位改为触发 `product-form-dialog`；Edit 仍为占位。
- Dialog 容器须 `max-h-[85vh]` + `overflow-y-auto`（规则 12）。

## 9.7 开发步骤

> **先做第 10 节的详情页**，再做本节新建功能（创建成功后需跳转到详情页）。

1. 安装缺失 shadcn 组件（dialog / switch / form / label；dialog/form/label 已装，仅补 `switch`）。
2. `src/lib/validations/product.ts`：`productCreateSchema` + 类型导出。
3. `src/lib/actions/product.ts`：`createProduct`（两步 insert→update + 失败补偿删除，返回 `{ success, data: { id } }`）。
4. `product-form-dialog.tsx`：表单 UI + 校验 + 提交 + 成功后 `router.push('/products/' + id)`。
5. `page.tsx`：加查 `origins`，把 brands/suppliers/origins 选项传给 Dialog，接线标题栏按钮。
6. 自测：必填校验、SKU 生成正确性与唯一性、abbr 缺失报错、L/W/H 留空兜底 10、创建后跳转、桌面 + 移动端弹窗滚动（规则 12）。

---

# 10. Product 详情页（`/products/[id]`）

> 状态：**已实现**
> 追加日期：2026-07-19

## 10.1 目标

一个**简单只读**的产品详情页，作为创建产品后的落地页，也可从列表 Edit/行点击进入（本轮仅只读展示，编辑后续再做）。

## 10.2 路由与取数

- 路由：`src/app/(dashboard)/products/[id]/page.tsx`（RESTful 扁平层级，规则 2）。
- `params` 为 async，需 `await`；`id` 解析为整数，非法则 `notFound()`。
- Server Component 用 Supabase Server Client 查单条：
  `.select("*, brands(name, abbr), origins(name, abbr), suppliers(company_name)").eq("id", id).maybeSingle()`；查不到 → `next/navigation` 的 `notFound()`。

## 10.3 页面布局（只读展示）

- 顶部：面包屑/返回 `← Products`（链接回 `/products`）+ 标题（产品 `name`）+ `sku`（`font-mono`）+ Status `Badge`。
- 主体用 shadcn `Card` 分区展示：
  - **Basic**：Name、SKU、Brand（名）、Origin（名）、Supplier（company_name）、Model、UPC。
  - **Pricing**：Currency、Purchase Price、Retail Price、Is GST。
  - **Logistics**：Weight、Length、Width、Height。
  - **Flags/Meta**：Is Active、Is Kit、Created At、Updated At。
- 空值统一显示 `—`；价格按货币格式化；图片有 `image_url` 时展示缩略图，否则 lucide `ImageOff` 占位。
- 复用已装 `card` / `badge` / `separator`，无需新组件。

## 10.4 落地文件

```
src/app/(dashboard)/products/[id]/page.tsx   # Server Component：await params → 查单条(含关联) → notFound / 渲染
```

- 纯读取，无 Server Action；如展示逻辑较多可抽 `_components/product-detail.tsx`（可选，DRY 视情况）。

## 10.5 开发步骤

1. 建 `products/[id]/page.tsx`：解析 id、查单条+关联、`notFound()` 兜底、Card 布局渲染。
2. 自测：有效 id 正常展示、无效/不存在 id → 404、各空值占位、桌面 + 移动端布局。
