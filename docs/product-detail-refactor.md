# Product 详情页重构 — 开发文档

> 状态：**已实现**（§8 三个确认点已定案：A 不重算 SKU / B 接入 Supabase Storage 上传 / C 建 Tab 占位）
> `20260725100000_create_product_images_bucket.sql` 已于 2026-07-25 推送至远端项目并验证：bucket `product-images`（public、5 MiB 上限）+ 4 条 storage policy 均已生效。
> 创建日期：2026-07-25
> 前置文档：`docs/products-management-page.md`（§10 为当前只读详情页的原始设计）、`docs/products-domain-migration.md`

## 1. 背景与目标

当前 `/products/[id]` 是 `docs/products-management-page.md` §10 交付的**纯只读页**，定位为「创建后的落地页」。本次重构把它升级为**商品的唯一编辑中心**，并为后续的**库存管理**与 **Kit 组件关系管理**预留信息架构。

目标：
1. `products` 表的**全部业务字段**在详情页可见、可改（自动生成/审计字段除外）。
2. 建立 `updateProduct` Server Action（当前完全不存在），客户端 + 服务端双重 Zod 校验。
3. 确定一套可扩展的页面骨架，使 Stock、Kit Components 后续接入时**不需要再推翻布局**。

非目标（本轮不做）：
- 不建 `product_stock` / `product_kit_items` 表，不实现库存与 Kit 的业务逻辑（仅预留 Tab 与数据模型草案）。

## 2. 字段缺口盘点

`public.products` 共 24 列（见 `supabase/migrations/20260719033830_create_products_domain_tables.sql`）。逐列比对当前详情页 `src/app/(dashboard)/products/[id]/page.tsx`：

| 字段 | 类型 | 当前详情页 | 当前创建表单 | 本次处理 |
|---|---|---|---|---|
| `id` | bigint PK | 未展示 | — | 保持不展示（URL 已含） |
| `sku` | text NOT NULL UNIQUE | ✅ 展示 | 自动生成 | **只读**，见待确认点 A |
| `name` | text | ✅ 展示 | ✅ | 可改（Basic） |
| `brand_id` | bigint FK | ✅ 展示名 | ✅ | 可改（Basic） |
| `origin_id` | bigint NOT NULL FK | ✅ 展示名 | ✅ | 可改（Basic） |
| `supplier_id` | bigint FK | ✅ 展示名 | ✅ | 可改（Basic） |
| `model` | text | ✅ 展示 | ✅ | 可改（Basic） |
| `upc` | text | ✅ 展示 | ✅ | 可改（Basic） |
| `image_url` | text | 仅头部缩略图 | ❌ **缺** | **新增编辑入口**（Basic），见待确认点 B |
| `currency` | enum | ✅ 展示 | ✅ | 可改（Pricing） |
| `purchase_price` | numeric | ✅ 展示 | ✅ | 可改（Pricing） |
| `retail_price` | numeric | ✅ 展示 | ✅ | 可改（Pricing） |
| `is_gst` | boolean NOT NULL | ✅ 展示 | ❌ **硬编码 `false`**（`src/lib/actions/product.ts:96`） | **新增编辑入口**（Pricing） |
| `weight` | numeric NOT NULL | ✅ 展示 | ✅ | 可改（Logistics） |
| `length` / `width` / `height` | numeric NOT NULL | ✅ 展示 | ✅ | 可改（Logistics） |
| `ebay_title` | text | ❌ **缺** | ❌ **缺** | **新增展示 + 编辑**（Content） |
| `description` | text | ❌ **缺** | ❌ **缺** | **新增展示 + 编辑**（Content） |
| `comment` | text | ❌ **缺** | ❌ **缺** | **新增展示 + 编辑**（Content） |
| `is_active` | boolean NOT NULL | ✅ 展示 | ✅ | 可改（Flags） |
| `is_kit` | boolean NOT NULL | ✅ 展示 | ✅ | 可改（Flags），驱动 Kit Tab 显隐 |
| `created_at` | timestamptz | ✅ 展示 | DB 默认 | 只读 |
| `updated_at` | timestamptz | ✅ 展示 | DB trigger 维护 | 只读 |

**结论**：页面级缺口是 4 个字段（`ebay_title`、`description`、`comment`、`image_url` 编辑入口），但真正的缺口是**整页没有任何编辑能力** —— `src/lib/actions/product.ts` 只有 `createProduct` 与 `deleteProduct`，没有 `updateProduct`。

## 3. 编辑交互方案

### 3.1 方案对比

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 分区 Dialog（**推荐**） | 每张 Card 右上角 `Edit` 按钮 → 打开该分区的表单 Dialog | 粒度小、误改风险低；与现有 `brand-form-dialog` / `product-form-dialog` 模式一致（规则 5 DRY）；Dialog 遵守规则 12（`max-h-[85vh]` + `overflow-y-auto`） |
| B. 整页 Edit 模式 | 顶部一个 `Edit` 把整页切成表单 | 20 个字段一张长表单，移动端体验差；一次提交全字段，diff 不清晰 |
| C. 独立 `/products/[id]/edit` 路由 | 单独编辑页 | 多一次导航；只读页与编辑页两套字段渲染逻辑，违反 DRY |

**采用方案 A**。分区内的长文本（`description`）字段较多时 Dialog 内滚动，符合规则 12。

### 3.2 分区划分

初版切了 5 张卡（Basic / Pricing / Logistics / Content / Flags & Meta），实际使用中 Overview 显得零碎 —— 卡片边框比内容还多。现按**字段属性的本质**收敛为 2 张：

| 卡片 | 字段 | 备注 |
|---|---|---|
| **Product Details**（商品是什么） | `name`、`sku`(只读)、`brand_id`、`origin_id`、`supplier_id`、`model`、`upc`、`image_url`(仅编辑)、`ebay_title`、`description`、`comment`、`is_active`、`is_kit` | 身份标识 + 归属关系 + 对外描述文本 + 生命周期开关；三项长文本在卡内跨两列 |
| **Commercial & Logistics**（商品怎么卖 / 怎么发） | `currency`、`purchase_price`、`retail_price`、`is_gst`、`weight`、`length`、`width`、`height` | 全部交易与物流数值；展示层把三维合并为一行 `Dimensions (L × W × H)` |

不进卡片的字段：

- `is_active` / `is_kit` —— 头部已用 Badge 展示，卡内不重复；**编辑入口并入 Product Details 分区**。
- `created_at` / `updated_at` —— 只读元数据，改为 Overview 底部一行 muted 小字。

## 4. 页面布局（含库存 / Kit 预留）

### 4.1 骨架

```
┌──────────────────────────────────────────────────────────────┐
│ ← Products                                                    │
│ [img] Product Name                        [Active]  [Delete]  │
│       SKU-00042CN                                             │
├──────────────────────────────────────────────────────────────┤
│  Overview  │  Stock  │  Kit Components                        │  ← Tabs
├──────────────────────────────────────────────────────────────┤
│  ┌ Product Details [Edit]┐  ┌ Commercial &     [Edit]┐        │
│  │ Name / SKU / Brand    │  │ Logistics              │        │
│  │ Origin / Supplier     │  │ Currency / GST         │        │
│  │ Model / UPC           │  │ Purchase / Retail      │        │
│  │ eBay Title  ← 跨两列  │  │ Weight / Dimensions    │        │
│  │ Description / Comment │  └────────────────────────┘        │
│  └───────────────────────┘                                    │
│  Created … · Updated …                                        │  ← muted 小字
└──────────────────────────────────────────────────────────────┘
```

- 头部（返回、缩略图、name、sku、status badge、危险操作）在 Tabs **之外**，切 Tab 时保持可见。
- 桌面 `md:grid-cols-2`，移动端单列（沿用现有实现）。

### 4.2 为什么用 Tabs 而不是纵向堆叠

库存与 Kit 是**独立的数据域**（各自的表、各自的增删改），不是 `products` 的附加字段：

- 纵向堆叠 → 页面无限变长，用户为看库存要滚过 20 个只读字段。
- Tabs → 各域内容互不干扰；每个 Tab 是独立组件，后续可各自套 `<Suspense>` 分块取数，Overview 首屏不被库存查询拖慢。
- Tab 状态写入 URL（`?tab=stock`），可分享、可后退 —— 与列表页过滤器写 URL 的既有约定一致（`docs/products-management-page.md` §3）。

### 4.3 Tab 显隐与占位

| Tab | 显隐规则 | 本轮状态 |
|---|---|---|
| Overview | 恒显示，默认 | 本轮实现 |
| Stock | 恒显示 | 占位（见待确认点 C） |
| Kit Components | **仅 `is_kit === true` 时显示** | 占位（见待确认点 C） |

`is_kit` 在 Product Details 分区可改，改后 Kit Tab 即时出现/消失（`revalidatePath` 后 Server Component 重渲染）。

### 4.4 后续数据模型草案（本轮不建表，仅供布局评估）

- **Stock**：`product_stock`（`product_id` + `location_id` + `qty`…）。Tab 内为「按仓位的库存表格 + 调整入库/出库」，是一张列表 + 操作，天然适合独立 Tab。
- **Kit Components**：`product_kit_items`（`kit_product_id` → `component_product_id` + `qty`），对应遗留 `go2_kits` 表（`docs/products-domain-migration.md` §末：`is_kit=1` 有 639 条，关联关系留待后续迁移）。Tab 内为「组件商品列表 + 添加/移除组件」。

两者都是「一对多子表的 CRUD」，形态与 Overview 的「字段展示 + 分区编辑」完全不同 —— 这是选择 Tabs 分隔的核心理由。

## 5. 数据层改造

### 5.1 校验 Schema 复用（`src/lib/validations/product.ts`）

当前 create 的 server schema 与 form schema 是两套手写字段，重构为**共享字段字典 + pick**：

```
productServerFields = { name, brand_id, origin_id, ..., ebay_title, description, comment, image_url, is_gst }
productFormFields   = { ...同名，string 版 }

productCreateSchema      = z.object(pick(server, CREATE_FIELDS))     // 保持现有行为不变
productSectionSchemas = {
  details:    z.object(pick(server, ["name","brand_id","origin_id","supplier_id","model","upc",
                                     "image_url","ebay_title","description","comment","is_active","is_kit"])),
  commercial: z.object(pick(server, ["currency","purchase_price","retail_price","is_gst",
                                     "weight","length","width","height"])),
}
```

新增字段的规则：`ebay_title` / `description` / `comment` 均可空文本，空串写入 DB 前转 `null`（复用现有 `toNullable`）；`image_url` 需 `z.string().url()` 校验（可空）。

### 5.2 Server Action（`src/lib/actions/product.ts`）

新增**单个** `updateProductSection(id, section, payload)`，按 `section` 分派对应 schema，而不是每个分区一个 action（规则 5 DRY）：

```
export async function updateProductSection<S extends ProductSection>(
  id: number, section: S, input: unknown
): Promise<ActionResult>
```

- 服务端 `safeParse` → 失败返回 `{ success:false, error }`（规则 7 标准响应）。
- `updated_at` **不手动设置**，由 migration `20260719150000` 的 moddatetime trigger 维护（沿用 create 的既定做法）。
- 成功后 `revalidatePath("/products")` + `revalidatePath("/products/" + id)`。
- FK 违反 / 唯一冲突复用 `action-result.ts` 的 `isForeignKeyViolation` / `isUniqueViolation`。
- `details` 分区额外做旧图清理：若旧 `image_url` 指向 `product-images` bucket 且与新值不同，尽力 `storage.remove()`（失败忽略）。

### 5.3 详情页取数

`page.tsx` 除现有单条查询外，需并行拉取 brands / origins / suppliers 下拉选项（供 Product Details 编辑 Dialog 使用）。复用列表页已有的选项查询（`src/lib/queries/products.ts`），若无则在该文件补 `getProductLookupOptions()`，列表页与详情页共用。

## 6. 落地文件

```
supabase/migrations/*_create_product_images_bucket.sql        # 新：product-images bucket + storage policies
src/lib/storage/product-images.ts                             # 新：bucket 常量、上传路径构造、public URL ↔ object path 互转
src/app/(dashboard)/products/[id]/page.tsx                    # 改：取数增加 lookup options，渲染骨架 + Tabs
src/app/(dashboard)/products/[id]/_components/
  product-detail-header.tsx                                   # 新：返回/缩略图/name/sku/badge/删除
  product-detail-tabs.tsx                                     # 新："use client"，Tab 切换写 URL ?tab=
  product-overview.tsx                                        # 新：5 张 Card 组合
  product-section-card.tsx                                    # 新：Card + 右上 Edit 按钮 + <dl> 渲染（DRY 复用 Field）
  product-section-dialog.tsx                                  # 新："use client"，按 section 渲染表单字段
  product-image-field.tsx                                     # 新："use client"，Storage 直传 + 预览 + 移除
  product-stock-panel.tsx                                     # 新：占位（Coming soon）
  product-kit-panel.tsx                                       # 新：占位（Coming soon）
src/lib/validations/product.ts                                # 改：字段字典 + section schemas + 新字段
src/lib/actions/product.ts                                    # 改：新增 updateProductSection
src/lib/queries/products.ts                                   # 改：抽出共享的 lookup options 查询
```

依赖安装：`npx shadcn@latest add tabs`（`src/components/ui` 当前无 `tabs`）。`textarea` 已存在。

## 7. 开发步骤

1. `npx shadcn@latest add tabs`。
2. **Storage**：写 bucket 迁移（`product-images`，public read + authenticated 写），本地 `supabase db reset` / `db push` 验证；建 `src/lib/storage/product-images.ts` 工具。
3. **校验层**：重构 `validations/product.ts` 为字段字典 + `productCreateSchema` + `productSectionSchemas`，补 `ebay_title`/`description`/`comment`/`image_url`/`is_gst`。确认 create 行为无回归。
3. **Action 层**：实现 `updateProductSection`，含 schema 分派、空串转 null、错误映射、双路径 revalidate。
4. **查询层**：抽 `getProductLookupOptions()`，列表页与详情页共用。
5. **展示层拆分**：把现有 `page.tsx` 的头部与卡片拆成 `product-detail-header` / `product-overview` / `product-section-card`，保持现有只读渲染不变（纯重构，先不加编辑）。
6. **Content 卡片**：新增 `ebay_title` / `description` / `comment` 展示。
7. **编辑能力**：实现 `product-section-dialog`，5 个分区接线到 action，`sonner` toast 反馈（规则 7）。
8. **Tabs 骨架**：接入 Tabs + `?tab=` URL 同步，加 Stock / Kit 占位面板，`is_kit` 控制 Kit Tab 显隐。
9. **自测**：每个分区改一个字段后值正确落库、`updated_at` 自动更新；空值→`—`；非法 URL / 负数价格被拦；Tab 切换后退正常；Dialog 在移动端不溢出（规则 12）；`npm run build` 通过。

## 8. 已确认决策（2026-07-25）

**A. 改了 brand / origin 之后，SKU 不重算。**
SKU 由 `brandAbbr + 五位 id + originAbbr` 生成（`product.ts:28`），一旦生成即作为对外稳定标识；重算会破坏历史单据 / 平台 listing 的对应关系。UI 上 SKU 只读展示，Basic 编辑 Dialog 内以说明文字提示「SKU 在创建时生成，之后不随品牌/产地变更」。

**B. `image_url` 接入 Supabase Storage 上传。**
遗留数据是外链 URL，因此 `image_url` 仍是 text 列，Storage 只是「新图片的来源之一」，两种 URL 并存：

- **Bucket**：`product-images`，**public read**（渲染简单，且与遗留外链行为一致），写入仅限 `authenticated`。
- **迁移**：新增 `supabase/migrations/*_create_product_images_bucket.sql`，含 `BEGIN/COMMIT`（规则 15），插入 bucket 记录 + 4 条 `storage.objects` policy（public SELECT，authenticated INSERT/UPDATE/DELETE，均限定 `bucket_id = 'product-images'`）。
- **上传路径**：`products/{productId}/{uuid}.{ext}`。
- **上传方式**：**浏览器端直传**（`@/lib/supabase/client` 的 browser client 带认证 cookie），拿到 public URL 后再由 Server Action 落库。不走 Server Action 传文件——Next.js Server Action 默认 body 上限 1MB，商品图会超限，直传同时避开该限制且不占用 Node 进程。
- **校验**：客户端限图片 MIME（`image/*`）+ 5MB 上限；`image_url` 的 Zod 规则为可空 URL 字符串。
- **替换旧图**：更新时若旧 `image_url` 属于本 bucket，尽力删除旧对象（失败仅忽略，不阻断更新）；外链 URL 不处理。

**C. Stock / Kit 两个 Tab 本轮建占位。**
`Coming soon` 空状态，一次性把信息架构定死，避免后续再改布局。
