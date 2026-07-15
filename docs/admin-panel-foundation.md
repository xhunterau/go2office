# 后台管理系统基础框架 — 开发文档

> 状态：**待确认**（Plan and Execute 流程，需用户回复 "Go" 后方可开始编码）
> 创建日期：2026-07-15

## 1. 目标

搭建电商产品/订单后台管理系统的基础框架，本阶段范围仅限于：

- 全局 Layout：Header + 可收缩 Sidebar（含菜单）
- 用户登录（Supabase Auth，邮箱+密码）
- 马卡龙（Macaron）风格配色主题，覆盖背景、按钮、Badge、Icon 等所有 UI 元素
- 基于 shadcn/ui 的组件体系

具体业务功能（商品管理、订单管理等页面的实际内容）**不在本阶段实现**，仅搭建路由占位页面。

## 2. 项目现状确认

- Next.js **16.2.10**（App Router），该版本相较训练数据存在破坏性变更，实现前需查阅 `node_modules/next/dist/docs/`。
  - 已验证一处差异：中间件文件为 `src/proxy.ts`（导出 `proxy()` 函数），而非传统的 `middleware.ts` / `export function middleware()`。后续路由保护逻辑需在此文件中扩展。
- 已接入 `@supabase/ssr`，`src/lib/supabase/client.ts`、`server.ts`、`middleware.ts` 均已就绪，`updateSession` 已处理 session 刷新。
- Tailwind v4（CSS-first 配置，无 `tailwind.config.js`），当前 `globals.css` 仅有极简的 `--background` / `--foreground` 两个 token。
- 尚未安装 shadcn/ui（无 `components.json`，无 `src/components/ui`）。
- `docs/` 目录此前不存在，本文档为首个开发文档。

## 3. 技术选型

| 项目 | 选择 | 备注 |
|---|---|---|
| UI 组件库 | **shadcn/ui** | 通过 `npx shadcn@latest init` 初始化，按需 `npx shadcn@latest add [component]` |
| 图标 | `lucide-react` | 项目规范唯一图标库 |
| 样式合并 | `cn()`（`clsx` + `tailwind-merge`），置于 `src/lib/utils.ts` | shadcn init 会自动生成 |
| 表单校验 | `react-hook-form` + `zod` + `@hookform/resolvers` | 登录表单使用，客户端+服务端双重校验 |
| Toast 反馈 | `sonner`（shadcn 官方推荐） | |
| 认证 | Supabase Auth，邮箱+密码 | 用户已确认，暂不做 OAuth / Magic Link |
| 主题模式 | 仅浅色马卡龙主题 | 用户已确认，暂不做 dark mode |

### 需新增依赖

```
react-hook-form zod @hookform/resolvers sonner class-variance-authority clsx tailwind-merge lucide-react
```

（部分会在 `shadcn init` 及 `shadcn add` 过程中自动装好，实施时以 CLI 实际结果为准）

## 4. 马卡龙配色方案

整体基调：低饱和度、高明度的糖果色系，文字颜色使用柔和深灰紫而非纯黑，避免刺眼。

| Token | 用途 | 参考色值 |
|---|---|---|
| `background` | 页面背景 | `#FFF9FB` 极浅奶白粉 |
| `foreground` | 正文文字 | `#4A4453` 柔和深紫灰 |
| `primary` | 主色 / 主按钮 | `#F8AFC6` 樱花粉 |
| `primary-foreground` | 主色上文字 | `#4A2536` |
| `secondary` | 次要色 | `#C9EDE0` 薄荷绿 |
| `accent` | 强调色（hover / 高亮） | `#D9C9F0` 淡紫 |
| `muted` | 弱化背景（表格斑马纹等） | `#F5EEF1` |
| `border` / `input` | 边框 | `#F0DCE4` |
| `success` badge | 成功状态 | `#8FD9BB` 薄荷绿（深） |
| `warning` badge | 警告状态 | `#FFE59A` 奶油黄 |
| `info` badge | 信息状态 | `#AEE1F9` 天空蓝 |
| `destructive` | 危险 / 错误 | `#FF9AA2` 珊瑚红 |
| `sidebar` | 侧边栏背景（区别于主背景，略带薰衣草色调） | `#FBF5FB` |

实施时将以上 token 写入 `src/app/globals.css` 的 `@theme inline` 块（沿用当前项目 Tailwind v4 CSS-first 写法），并覆盖 shadcn 默认的 `--primary`、`--secondary`、`--accent`、`--destructive`、`--sidebar-*` 等变量，确保 Badge / Button / Icon / 背景全局统一取用同一套 token，而非局部硬编码颜色。

Sidebar 相关 token（`--sidebar`、`--sidebar-foreground`、`--sidebar-primary`、`--sidebar-accent`、`--sidebar-border` 等）会一并配置，保证 shadcn `Sidebar` 组件开箱即用马卡龙配色。

> 具体色值在实施阶段可根据实际视觉效果微调，本文档提供的是方向性基准。

## 5. 页面与路由结构（符合 RESTful 扁平层级规范）

```
src/app/
├── login/                      # 登录页（未登录可访问）
│   └── page.tsx
├── (dashboard)/                # 路由组：登录后可访问，共享 Header+Sidebar Layout
│   ├── layout.tsx              # AppSidebar + AppHeader 包裹
│   ├── page.tsx                # 首页 Dashboard 占位
│   ├── products/
│   │   └── page.tsx            # 商品列表占位（Coming soon）
│   ├── orders/
│   │   └── page.tsx            # 订单列表占位
│   ├── customers/
│   │   └── page.tsx            # 客户列表占位
│   └── settings/
│       └── page.tsx            # 设置占位
```

菜单一级项：**Dashboard / 商品 / 订单 / 客户 / 设置**（对应上表路由），当前均为占位页面，仅展示 "功能开发中" 提示。

## 6. 认证与路由保护

- 登录页 `src/app/login/page.tsx`：`react-hook-form` + `zod` 校验邮箱/密码格式，提交调用 Server Action。
- Server Action `src/lib/actions/auth.ts`：
  - `login(formData)`：调用 `supabase.auth.signInWithPassword`，返回 `{ success, error }` 标准格式。
  - `logout()`：调用 `supabase.auth.signOut()`。
- 路由保护逻辑扩展 `src/proxy.ts` / `src/lib/supabase/middleware.ts`：
  - 未登录用户访问 `(dashboard)` 路由组 → 重定向至 `/login`。
  - 已登录用户访问 `/login` → 重定向至 `/`。
- Header 右侧用户头像下拉菜单（shadcn `DropdownMenu` + `Avatar`）展示当前用户邮箱，提供"退出登录"操作，退出为危险操作，需复用全局 `useConfirm` 确认弹窗（规则 9）。

## 7. Layout 组件规划

- `src/components/layout/app-sidebar.tsx`：基于 shadcn `Sidebar` block，支持图标折叠模式（collapsible="icon"），菜单项含 lucide 图标。
- `src/components/layout/app-header.tsx`：Sidebar 折叠触发按钮（`SidebarTrigger`）+ 页面标题 + 用户头像下拉菜单。
- `src/components/layout/user-nav.tsx`：头像 + 下拉菜单（含退出登录）。
- `(dashboard)/layout.tsx`：`SidebarProvider` 包裹 `AppSidebar` + 主内容区（`AppHeader` + `children`），移动端自动切换为 `Sheet` 抽屉模式（shadcn Sidebar 内置能力）。

## 8. 需安装的 shadcn 组件清单

```
sidebar, button, input, label, form, avatar, dropdown-menu,
separator, sheet, tooltip, skeleton, sonner, alert-dialog（用于 useConfirm）
```

## 9. 实施步骤

1. **初始化基础设施**：`npx shadcn@latest init`，配置马卡龙主题 token（globals.css），安装第 8 节组件清单。
2. **认证模块**：登录页 + Server Action + 路由保护（proxy.ts 扩展）。
3. **Layout 框架**：AppSidebar / AppHeader / UserNav + `(dashboard)/layout.tsx`。
4. **占位页面**：Dashboard 首页 + 4 个业务模块占位页 + 菜单联动高亮当前路由。
5. **联调走查**：`npm run dev` 手动验证登录/登出流程、Sidebar 折叠、移动端响应式、配色在所有组件上的一致性。

## 10. 风险与注意事项

- Next.js 16 的 `proxy.ts` 约定与训练数据中的 `middleware.ts` 存在差异，实施前需查阅本地 `node_modules/next/dist/docs/` 确认路由匹配、cookie 处理等细节是否有进一步变化。
- `params` / `searchParams` 异步化规则对本阶段占位页面影响较小，但目录结构预留后续动态路由（如 `products/[id]`）时需注意。
- 本阶段不涉及数据库表结构读写，故未查阅 `docs/existing_schema.md`；后续实现具体业务页面时需按规则 3 执行。

---

**请确认以上方向，回复 "Go" 后开始编码实施。如有需要调整的部分请直接指出。**
