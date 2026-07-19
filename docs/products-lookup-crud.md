# Brands / Suppliers / Origins 前端 CRUD — 开发文档

> 状态：**已实现**（2026-07-19 编码完成，typecheck + lint 通过，路由/中间件守卫验证通过）
> 创建日期：2026-07-19

## 1. 目标

为商品域的 3 张查表 `brands` / `suppliers` / `origins` 实现完整的前端 CRUD（增删改查），入口统一挂在 Sidebar 的 **Products** 折叠分组下。本阶段**不涉及** `products` 主表本身的 CRUD（后续单独开发）。

## 2. 现状核查

- **数据表已就绪**（`supabase/migrations/20260719033830_create_products_domain_tables.sql`）：3 张表均已建表、`ENABLE ROW LEVEL SECURITY`、`authenticated` 全权限策略 + `GRANT`，前端可直接通过 Data API 读写。

  | 表 | 字段 |
  |---|---|
  | `origins` | `id`、`name text`、`abbr text` |
  | `brands` | `id`、`name text`、`abbr text` |
  | `suppliers` | `id`、`company_name text`、`contact_person text`、`email text`、`phone text`、`comments text` |

  > 注意：除 `id` 外所有列在 DB 层**均可空**（源表无约束）。前端将按业务需要在 Zod 层追加必填校验（详见第 6 节）。

- **已有可复用基建**：
  - Server Action 标准返回 `{ success, error }`（`src/lib/actions/auth.ts` 为范式）。
  - Zod 校验集中在 `src/lib/validations/`。
  - 全局确认弹窗 `useConfirm`（`src/components/providers/confirm-provider.tsx`）——删除操作复用它（规则 9）。
  - `sonner` toast 反馈。
  - Sidebar 已具备 `SidebarMenuSub*` 嵌套能力。

- **缺口（需在本次补齐）**：
  1. **无 Supabase 生成类型**（规则 3 强制要求类型安全，禁止 `any`）。需生成 `src/lib/supabase/database.types.ts` 并让 client/server 泛型化。
  2. shadcn 尚缺 CRUD 必需组件：`table`、`dialog`、`form`、`textarea`、`collapsible`（折叠子菜单用）。需 `npx shadcn@latest add` 补装。

## 3. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| CRUD 交互形态 | **列表页 + Dialog 弹窗**：每个资源一个列表页，新增/编辑走模态弹窗，删除走全局 `useConfirm`。不生成 `/[id]` 详情页 |
| Sidebar 结构 | **Products 可折叠分组**：`▸ Products` 展开后含子项 `Products / Brands / Suppliers / Origins`（`Collapsible` + `SidebarMenuSub`） |
| 路由路径 | **顶级 `/brands`、`/suppliers`、`/origins`**（符合规则 2 RESTful 扁平层级）；侧边栏归组仅为视觉，不影响 URL |
| 类型生成方式 | 项目为**远程托管 Supabase**（无本地 Docker）。用 `.env.local` 的 `DATABASE_URL` **直连远程库生成**类型，无需 Docker/登录 |
| FK 删除兜底 | supabase-js 删除被 `products` 引用的记录会返回 Postgres 错误码 **`23503`**，Server Action 判该码返回中文友好提示 |

## 4. 路由与文件结构

```
src/app/(dashboard)/
├── brands/
│   ├── page.tsx                 # Server Component：拉取列表 + 渲染表格
│   └── _components/
│       ├── brands-table.tsx     # "use client" 表格 + 行操作（编辑/删除）
│       └── brand-form-dialog.tsx# "use client" 新增/编辑共用弹窗
├── suppliers/
│   ├── page.tsx
│   └── _components/
│       ├── suppliers-table.tsx
│       └── supplier-form-dialog.tsx
└── origins/
    ├── page.tsx
    └── _components/
        ├── origins-table.tsx
        └── origin-form-dialog.tsx

src/lib/
├── validations/
│   ├── brand.ts                 # brandSchema（Zod）
│   ├── supplier.ts
│   └── origin.ts
└── actions/
    ├── brand.ts                 # createBrand / updateBrand / deleteBrand
    ├── supplier.ts
    └── origin.ts
```

> 三张表结构、交互高度同构。会先落地 `brands` 一条完整链路作为模板，其余两张按同一模式复制，避免冗余（规则 5 DRY）。表格列渲染、弹窗骨架等可复用部分尽量抽取。

## 5. 数据流设计

- **读取（List）**：列表页为 Server Component，用 `createClient()`（server）`.from('brands').select('*').order('id')` 拉取，作为 props 传给客户端表格组件。
- **写入（Create / Update / Delete）**：一律通过 Server Action：
  - 客户端弹窗用 `react-hook-form` + `zodResolver` 提交 → 调用对应 Server Action。
  - Server Action 内二次 `safeParse`（客户端+服务端双重校验，规则 6）→ Supabase upsert/delete → `revalidatePath('/brands')` 刷新列表 → 返回 `{ success, error }`。
  - 客户端根据返回值 `sonner` toast 反馈，成功后关闭弹窗。
- **删除的外键保护**：`brands.id` / `suppliers.id` / `origins.id` 被 `products` 引用（`origin_id` 还是 `NOT NULL`）。删除被引用记录会触发 FK `RESTRICT` 报错。Server Action 需捕获 Postgres 外键错误码（`23503`），返回友好中文提示（如"该品牌已被商品引用，无法删除"），而非抛原始错误。

## 6. 校验规则（Zod）

DB 列可空，但前端按业务合理性设必填，客户端与服务端共用同一 schema：

- **brand / origin**：`name` 必填（trim、非空）；`abbr` 选填。
- **supplier**：`company_name` 必填；`email` 选填但填了需通过 email 格式校验；`contact_person` / `phone` / `comments` 选填。

所有 UI 文本、label、placeholder 使用**英文**（规则 1）；文档与计划用中文。

## 7. Sidebar 改造

将 `app-sidebar.tsx` 中的 `Products` 单项改造为可折叠分组：

```
▸ Products                (Collapsible 触发)
   ├─ Products   → /products
   ├─ Brands     → /brands
   ├─ Suppliers  → /suppliers
   └─ Origins    → /origins
```

- 使用 shadcn `Collapsible` 包裹 `SidebarMenuButton`（父）+ `SidebarMenuSub`（子项）。
- 保留 `collapsible="icon"` 图标折叠模式的兼容处理。
- 当前路由命中任一子项时，父分组默认展开 + 子项高亮（沿用现有 `usePathname` 逻辑）。

## 8. 实施步骤

1. **基建补齐**
   - 生成 Supabase 类型（远程直连，无需 Docker/登录）：
     ```
     npx supabase gen types typescript --db-url "$DATABASE_URL" --schema public > src/lib/supabase/database.types.ts
     ```
     再给 `client.ts` / `server.ts` 的 `createServerClient<Database>` 加泛型。
   - 补装 shadcn 组件：`table dialog form textarea collapsible`。
2. **Sidebar 折叠分组改造**（第 7 节）。
3. **Brands 完整链路**（作为模板）：validation → actions → 列表页 → 表格组件 → 表单弹窗，跑通增删改查 + FK 删除保护。
4. **Suppliers / Origins**：按 Brands 模板复制实现，抽取可复用部分。
5. **联调走查**：`npm run dev` 手动验证三张表的增删改查、Dialog 视口安全（规则 12：`max-h-[85vh]` + `overflow-y-auto`）、删除确认弹窗、FK 保护提示、toast、移动端响应式。

## 9. 风险与注意事项

- **Supabase 环境**：本项目为远程托管实例（`nszriuqpumbyigxwtccs.supabase.co`），无本地 Docker stack。类型生成与读写均走远程（类型用 `DATABASE_URL` 直连，读写用 anon key 走 Data API）。
- **FK 错误码兜底**：实施时实测确认 `products` 对三张表的外键约束在删除被引用记录时返回 `23503`，确保 Server Action 兜底文案生效。
- **`origins` 数据量极小**（源表仅 3 条），但 CRUD 能力仍完整实现，不做特殊化处理。
- Next.js 16 破坏性变更：新增页面涉及的 `params`/`searchParams` 异步化、组件约定等，编码前按 AGENTS.md 查阅 `node_modules/next/dist/docs/`。

---

## 10. 增强迭代（2026-07-19）

在基础 CRUD 之上，按业务需要补充以下能力（typecheck + lint 通过）：

### 10.1 Brands — name / abbr 唯一性
- **DB 层（根本保障）**：迁移 `supabase/migrations/20260719142554_add_brands_unique_constraints.sql` 为 `brands` 增加 **大小写敏感** 的 `UNIQUE(name)`、`UNIQUE(abbr)`。`abbr` 选填——Postgres 对多个 `NULL` 不判重，无 abbr 的品牌不受影响。已 `supabase db push` 至远程库（迁移前查得 0 条数据、无冲突）。
- **后端兜底**：`action-result.ts` 新增 `isUniqueViolation`（Postgres 错误码 `23505`）；`brand.ts` 的 `createBrand` / `updateBrand` 捕获后按约束名（`brands_abbr_key` / `brands_name_key`）返回列级英文提示。不做前端预检查询（竞态不可靠），统一依赖 DB 约束 + `23505`。

### 10.2 Suppliers — 服务端分页（15 条/页）+ 过滤
- 改为**服务端分页**（与过滤天然配合，避免"只过滤当前页"）：`suppliers/page.tsx` 读取异步 `searchParams` 的 `page` / `q`，用 `.select("*", { count: "exact" }).range(from, to)` 拉取当前页与总数。
- 过滤对 `company_name / contact_person / email / phone` 做 `.or(ilike)`（对 `,()` 做转义防止破坏 `.or()` 表达式）。
- 补装 shadcn `pagination` 组件；表格顶部搜索框防抖（350ms）改写 URL `?q=` 并回到第 1 页，底部 `Pagination` 控件改写 `?page=`。

### 10.3 Origins — 纯只读
- 业务定性为只读查表：`origins-table.tsx` 退化为无交互展示组件（去掉 `"use client"` 与所有增删改逻辑）。
- 删除 `origin-form-dialog.tsx`、`src/lib/actions/origin.ts`、`src/lib/validations/origin.ts`（无外部引用）。

### 10.4 三表统一隐藏 ID 列
- Brands / Suppliers / Origins 表格移除 `ID` 表头与单元格，同步调整空状态 `colSpan`；`key={row.id}` 仅内部保留，不对用户展示。

### 10.5 Brands 过滤（客户端）
- 无分页需求且数据量小，采用 `React.useMemo` 客户端即时过滤 `name / abbr`，零往返，体验最佳。

> 待办：遗留数据经 `scripts/migration/001_products_domain_data.sql` 导入后，需在登录态下手动走查——Brands 重名/重 abbr 的 toast、Suppliers 翻页与搜索联动、Dialog 视口安全（规则 12）。

---

**请确认以上方案，回复 "Go" 后开始编码实施。如需调整请直接指出。**
