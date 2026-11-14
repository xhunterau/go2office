# Trigger.dev Tasks

本文件记录 `src/trigger/*.ts` 中的全部 Task。**新增或修改任何 Task 时必须同步更新本文件**（CLAUDE.md 规则 4）。

| | |
|---|---|
| 项目 | `go2office`（ref `proj_wwabgtzjdqddykvvvpxx`，Xhunter AU 组织下） |
| SDK | `@trigger.dev/sdk` v4（**导入路径必须是包根，严禁 `@trigger.dev/sdk/v3`**） |
| 配置 | [trigger.config.ts](../trigger.config.ts) —— `runtime: "node-24"`，`dirs: ["./src/trigger"]` |
| 环境 | **staging**（`TRIGGER_SECRET_KEY` 是 `tr_stg_` 前缀）。查 run / deploy 时选 staging，选 dev 会显示 0 条 |
| 本地开发 | `npm run trigger:dev`（CLI 自动读 `.env.local`，无需 `--env-file`）。脚本带 `NODE_OPTIONS=--no-network-family-autoselection`：WSL 下 Node 的 IPv4/IPv6 自动选择会让连 Shopify 的请求 `ETIMEDOUT`（curl 0.19 秒能连上，2026-11-11 实测），去掉这个参数本地导入就会失败 |
| ⚠️ 新 Task 必须先 deploy 才跑得起来 | **`trigger.dev dev` 在 staging key 下不接管 run。**2026-08-29 实测：本地 worker 注册了版本 `20260829.1`，但 staging 的 current worker 仍是部署版 `20260823.1`，于是新 Task 的 run 一直停在 `PENDING_VERSION`，两次触发都是。要让一个新 Task 能跑，得 `npx trigger.dev deploy`。**卡住的 run TTL 默认 14 天**——不取消的话，下次部署会把它们同时放行，同一张订单被灌两批数据 |

---

## `quote-shipping`

对一张订单向所有可用承运商询价，落库成一个报价批次并自动选中最优方案。

| | |
|---|---|
| Job ID | `quote-shipping` |
| 源文件 | [src/trigger/quote-shipping.ts](../src/trigger/quote-shipping.ts) |
| 核心逻辑 | [src/lib/shipping/quote-engine.ts](../src/lib/shipping/quote-engine.ts) 的 `runQuoteEngine()` |
| `maxDuration` | 60 秒（实测一次完整报价约 1.6 秒，含一次 Aramex 线上询价） |
| 触发条件 | 订单详情页的 Re-Quote Shipping 按钮（阶段 5 的 Server Action）。目前只能手工触发 |

### 入参

```ts
{
  orderId: number              // public.orders.id
  triggeredBy: "auto" | "manual"  // 只影响 order_logs 的措辞
  userId?: string | null       // auth.users.id，写进 order_logs.user_id
}
```

### 返回

`QuoteEngineResult`：`{ status: "quoted", quotes, selectedMethod }` 或 `{ status: "manual_required", reason }`。

### 它会写哪些表（**这个 Task 不是只读的**）

| 表 | 写入内容 |
|---|---|
| `order_shipping_quotes` | 每次运行插入一整批报价行（每个可用选项一行，含报不出价的错误行），并把最优项的 `is_selected` 置为 true。**置位前会先清掉上一批的选中项**——`order_shipping_quotes_one_selected_idx` 是 `(order_id) WHERE is_selected` 的唯一索引，不清就会在第二次报价时撞约束 |
| `order_logs` | 每次运行一行；自动升级时也留一行 |
| `orders.status` | **仅在报不出价时**改为 `issued`（邮政地址超出全部邮政承运商能力，或无任何可用承运商）。这是一次无人请求的状态改写，`order_logs` 那行是唯一的痕迹 |

**它不写 `orders.shipping_method`**。自动选中只是建议；把它落到订单上是操作员的动作，属阶段 5 的 Server Action。

### 环境变量

Task 内用 **service role key** 建 Supabase 客户端——9 张运费相关表对 `authenticated` 只有 `SELECT`，而且 Task 里没有用户会话可带 RLS。

| 变量 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `SUPABASE_SERVICE_ROLE_KEY` | 绕过 RLS |
| `ARAMEX_TOKEN_URL` / `ARAMEX_API_BASE_URL` / `ARAMEX_CLIENT_ID` / `ARAMEX_CLIENT_SECRET` | Aramex 实时询价 |

⚠️ 本地由 CLI 从 `.env.local` 读取，**但部署环境读不到该文件**——以上 6 个变量必须在 Trigger.dev 控制台的 Environment Variables 里另配一份。**2026-08-29 确认：已配置好。** 证据是 staging 的部署版 `v20260823.1` 上跑成的那次 `submit-aramex-batch`——它缺任何一个变量都会立刻抛错，而它完成了一次真实下单。（此前本文件记的「截至 2026-08-22 尚未配置」是陈旧信息。）

### 实测

2026-08-22，dev worker `20260822.1`，订单 205970（114g / $10.47 / Cardwell QLD）：1.6 秒完成，11 行报价，选中 `Register_Letter` $5.00。同一订单连跑两次，`order_shipping_quotes` 得到 2 个批次共 22 行，全表仅 1 行 `is_selected` —— 唯一索引未触发冲突。

---

## `submit-aramex-batch`

把当前 `processing` 状态、承运商为 Aramex 的订单逐张提交给 Aramex 建运单，并把运单号写回订单。

| | |
|---|---|
| Job ID | `submit-aramex-batch` |
| 源文件 | [src/trigger/submit-aramex-batch.ts](../src/trigger/submit-aramex-batch.ts) |
| 核心逻辑 | [src/lib/aramex/consignment.ts](../src/lib/aramex/consignment.ts) 的 `mapOrderToConsignment()` / `submitConsignment()` |
| `maxDuration` | 300 秒 |
| `retry` | **`maxAttempts: 1`** —— 见下方「为什么不能重试」 |
| 触发条件 | `/fulfillment/export-labels` 的 Aramex 卡片（`triggerAramexBatch()` Server Action）。只能手工触发 |

### 入参 / 返回

```ts
// 入参
{ userId?: string | null }   // auth.users.id，写进 order_logs.user_id

// 返回
{
  successCount: number        // 已交运的订单数（含运单号没读出来的那些）
  failures: { invoiceNumber: string; reason: string }[]
  consignmentIds: number[]    // Aramex 内部 conId
  trackingNumbers: string[]   // 写进 orders.tracking_number 的可追踪号
  untracked: string[]         // 已下单但响应里读不出号的 invoice，需人工补录
}
```

运行中通过 `metadata.set("progress", { current, total })` 上报进度。**页面不再用 `useRealtimeRun` 订阅**——2026-08-23 实测 run 正常 COMPLETED 而浏览器收不到终态，spinner 永不停止。改由页面每 2 秒调 Server Action `getAramexBatchStatus()`（内部 `runs.retrieve`）读状态与进度，另有 8 分钟硬超时与手动 `Stop waiting`。详见 `docs/fulfillment-labels.md` §3.6b。

### 它会写哪些表

| 表 | 写入内容 |
|---|---|
| `orders.status` | 每张成功的订单改为 `labelled` |
| `orders.tracking_number` | 写入 `data.items[0].label`（面单上的可追踪号，如 `MS0020719756`），读不到时退回 `data.conId`。**字段名不是 `consignmentId`** —— 照抄 xpros 的那个键取不到值，2026-08-23 首次真实下单就把字符串 `"undefined"` 写进了库，详见 `docs/fulfillment-labels.md` §3.6。两者都经 `normalize_tracking_number` 原样通过（规则 20）。**一个都读不到时该列保持不动**，invoice 进 `untracked` |
| `order_logs` | 每张成功的订单一行，`action` 含 consignment id |

### 为什么不能重试

**建运单不是幂等操作。** 一次部分失败后重跑，已成功的订单因为已经变成 `labelled` 会掉出队列，但**在 Aramex 已接受、而写库失败的那一张会被重复下单**。因此：

- Task 级 `retry: { maxAttempts: 1 }`；
- `submitConsignment()` 在 Aramex 返回成功之后若写库失败，会抛出**带 consignment id 的错误**，让这张单进 `failures` 而不是静默丢失；
- 单张失败不中断批次，其余继续。

循环体是**串行**的，不是 `Promise.all`：每次迭代都是一次真实计费的下单，且 Aramex 对该端点限流。

### 前置条件

`shipping_settings.fallback_email` 与 `fallback_phone` 必须非空，否则 Task 直接抛错。Server Action 侧也查一遍，好让这件事显示为页面提示而不是一次失败的 run。

### 环境变量

与 `quote-shipping` 完全相同的 6 个（service role + 4 个 `ARAMEX_*`）。同样的警告：**部署环境读不到 `.env.local`**，必须在 Trigger.dev 控制台另配一份。

### 实测

2026-08-23，**staging** 环境（不是 dev —— 本项目的 Trigger.dev 用 staging），run `run_06g2po1ihq6ev6hld2l8rhdv01`，订单 205971 / invoice 26032493：run COMPLETED，执行 4.5 秒（前面 21 秒冷启动），Aramex 侧运单成立、订单进 `labelled`。

同一次跑暴露了两个 bug，均已修：① 运单号字段名取错，写进了字符串 `"undefined"`（该行已清成 NULL）；② 页面 realtime 订阅收不到终态，loading 不停。

---

## `batch-postage-check`

给 Order Allocation 的 Postage 队列逐张询价：对每张「已确认地址、仍在 `pending`」的订单跑一遍报价引擎，把报价落库。**它不批准任何订单，也不改运送方式**——那是操作员在页面上一张一张点的（用户决策，2026-08-24）。

| | |
|---|---|
| Job ID | `batch-postage-check` |
| 源文件 | [src/trigger/batch-postage-check.ts](../src/trigger/batch-postage-check.ts) |
| 核心逻辑 | [src/lib/shipping/quote-engine.ts](../src/lib/shipping/quote-engine.ts) 的 `runQuoteEngine()`，与 `quote-shipping` 同一个 |
| `maxDuration` | 300 秒（一张约 1.6 秒，够约 150 张；更长的队列跑第二遍即可，仍在 `pending` 的会被重新拾起） |
| `retry` | **`maxAttempts: 1`** —— 见下方「为什么不能重试」 |
| 触发条件 | `/fulfillment/allocation/postage` 的 `Quote all` 按钮（`triggerPostageCheck()` Server Action）。只能手工触发 |

### 入参 / 返回

```ts
// 入参
{ userId?: string | null }   // auth.users.id，写进 order_logs.user_id

// 返回
{
  processed: number         // 队列长度
  quotedCount: number       // 至少报出一个有效价的订单数
  unpricedCount: number     // 引擎跑通但一个价都没报出来（全是错误行）
  escalatedCount: number    // 引擎自己升级成 issued 的订单数 —— 见下
  failures: { invoiceNumber: string; reason: string }[]
}
```

进度同样走 `metadata.set("progress", { current, total })`，页面轮询读（`getPostageCheckStatus()`），共用 [src/hooks/use-batch-run-poll.ts](../src/hooks/use-batch-run-poll.ts) 与 [src/lib/trigger/run-status.ts](../src/lib/trigger/run-status.ts) —— 与 Aramex 卡片同一套三层保护（终态判定 / 8 分钟硬超时 / `Stop waiting`）。

### 它会写哪些表

自己一行都不写。**全部写入都发生在 `runQuoteEngine()` 里面**，与 `quote-shipping` 完全相同：`order_shipping_quotes` 一整批、`order_logs` 一行，以及报不出价时把 `orders.status` 改成 `issued`。

### `escalatedCount` 为什么要单独报

引擎在「没有任何可用承运商」或「邮政地址超出全部邮政承运商能力」时会**自己**把订单改成 `issued`。而 allocation 队列筛的是 `pending`，所以这些订单**当场从队列里消失**。不单独计数并在页面上单独 toast 出来的话，唯一可见的现象就是「队列莫名比预期短了几张」。

### 为什么不能重试

重试会对第一次已经报过价的订单**再插一整批** `order_shipping_quotes` 行。单张失败收进 `failures` 上报，不中断批次。

循环体是**串行**的，不是 `Promise.all`：每次迭代都含一次 Aramex 线上询价，整队一起打过去会被限流，而限流的表现是一批看起来毫无道理的「报不出价」。

### 单张失败不会带走整批

引擎在两种情况下直接 `throw`：客户没有 postcode、订单在 `order_metrics_summary` 里没有行（它不会瞎猜一个重量）。这两种都得人来处理，所以逐张 try/catch，失败的按 invoice 报出来。

### 环境变量

与另外两个 Task 相同的 6 个。同样的警告：**部署环境读不到 `.env.local`**，必须在 Trigger.dev 控制台另配一份。

---

## `import-shopify-orders`

把 go2buy-australia 的 Shopify 店里**所有未发货订单**拉进 go2office，作为 `pending` 进入 Order Allocation。移植自 xpros 的同名 Task，差异见 [docs/shopify-order-import.md](shopify-order-import.md)。

| | |
|---|---|
| Job ID | `import-shopify-orders` |
| 源文件 | [src/trigger/import-shopify-orders.ts](../src/trigger/import-shopify-orders.ts) |
| 核心逻辑 | 拉取：[src/lib/shopify/orders.ts](../src/lib/shopify/orders.ts)；映射：[src/lib/shopify/order-mapper.ts](../src/lib/shopify/order-mapper.ts)；写库：SQL 函数 `public.import_shopify_order(jsonb, uuid)`（迁移 `20261111100000`） |
| `maxDuration` | 600 秒 |
| `queue` | `concurrencyLimit: 1` |
| `retry` | **`maxAttempts: 1`**：重跑本身是安全的（已导入的会被识别为重复），但会把第一次的失败藏起来 |
| 触发条件 | `/orders` 页头的 `Import from Shopify` 按钮（`triggerShopifyImport()` Server Action），只能手工触发。首次对生产跑时，可以在控制台带上 `testOrderName` 只导一张 |

### 入参 / 返回

```ts
// 入参
{ userId?: string | null      // auth.users.id，写进 order_logs.user_id
  testOrderName?: string }    // "#G2B24707"：只导这一张。页面从不传

// 返回
{
  fetched: number             // 从 Shopify 拉到的未发货订单数
  imported: number            // 新建的订单
  merged: number              // 合并进同一客户 pending 订单的 Shopify 单
  mergedInvoices: string[]    // 被合并的 go2office 订单号 —— 它们被打回了 Address 队列
  duplicates: number          // 已在 go2office（本导入或 Laravel 导入的）
  ignored: number             // 已取消 / 测试单 / 数量都被编辑成 0，不送进数据库
  failures: { name: string; reason: string }[]
}
```

进度：`metadata.set("stage", "fetching" | "processing")` 与 `metadata.set("progress", { current, total })`，页面轮询读（`getShopifyImportStatus()`），共用 `use-batch-run-poll.ts` 与 `run-status.ts`。

### 它会写哪些表

Task 自己一行都不写，**全部经 `import_shopify_order()`，每张 Shopify 订单一个事务**：

- `customers`：按「姓名 + 地址第一行 + 邮编」匹配不到时新建（`customers_standardize_address` 触发器改写 state / country）
- `orders`：新建 `pending` / `shopify` 订单；**或者**合并进已有订单：累加 `postage_and_handling` / `discount`，**清空 `address_verified_at`**，备注追加到 `comments`
- `order_shipping_quotes`：合并时**删除**被合并订单的全部旧报价
- `order_transactions`：每个 line item 一行（`order_transactions_rebuild_items_insert` 触发器随之生成 `order_items`，`oms_*` 触发器重算 `order_metrics_summary`）
- `order_logs`：每张一行

### 环境变量

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 函数对 `anon` / `authenticated` 撤销了 EXECUTE，只能用 service role 调 |
| `SHOPIFY_STORE_DOMAIN` | `go2buy-australia.myshopify.com`。**不是** `go2buy.com.au`，换 token 的端点只认 myshopify 域名 |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app「go2office order import」的 Credentials |
| `SHOPIFY_API_VERSION` | 可选，默认 `2026-10` |

**部署环境读不到 `.env.local`**，Shopify 这 3～4 个变量必须在 Trigger.dev 控制台（staging）另配一份。

### 实测（2026-11-11，干跑，全程 ROLLBACK）

拉到 12 张未发货订单（最早 2026-09-14）：10 张新建、1 张合并、1 张已取消被忽略、0 失败；1 行 SKU 解析不到（订单上显示 Unresolved SKU）。

