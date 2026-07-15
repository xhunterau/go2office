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

# 13. SQL-TypeScript Formula Sync Rule
- **双实现约束**：`src/lib/replenishment.ts` 中的 `calcSuggestedOrderQty` 函数是 `supabase/migrations/20260602010000_update_product_stock_summary_suggested_order_qty.sql` 里 `suggested_order_qty` CASE 表达式的 TypeScript 镜像。
- **强制同步**：修改任意一侧的公式（Kill Switch 顺序、阈值、系数）时，必须**同步更新另一侧**，并在 `src/lib/__tests__/replenishment.test.ts` 中补充对应测试用例。
- **验证命令**：`npm test`（使用 Vitest 运行 `src/lib/__tests__/replenishment.test.ts`）。

# 14. AI / Third-Party Service Recommendations
- **全景扫描**：在推荐任何 AI 模型、搜索 API 或第三方服务之前，必须系统性地列出所有主流候选方，**严禁凭记忆或习惯直接给出单一推荐**。
- **Google 生态优先考虑**：本项目已使用 Google Maps API，Google AI Studio（Gemini）和相关 Google 服务必须纳入候选，尤其在涉及搜索、语言模型、图像识别等场景时。Gemini 2.0 Flash + Google Search Grounding 在产品信息检索场景中具有明显优势（Google 拥有全球最大搜索索引）。
- **已有生态联动**：在推荐新工具前，先检查 `.env.local` 和 `package.json`，识别项目已接入的服务供应商，优先在已有账号体系内扩展，降低管理成本。

# 15. Supabase 数据库结构演进规则
- **迁移优先原则**：严禁直接通过 Supabase Studio (图形界面) 手动修改生产或本地数据库结构。所有变更必须通过编写迁移文件 (`supabase/migrations/*.sql`) 实现。
- **原子事务保障**：所有迁移 SQL 文件必须包含 `BEGIN;` 和 `COMMIT;` 事务块，确保变更执行过程中的数据安全性。

