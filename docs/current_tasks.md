# Trigger.dev Tasks

本文件记录 `src/trigger/*.ts` 中的全部 Task。**新增或修改任何 Task 时必须同步更新本文件**（CLAUDE.md 规则 4）。

| | |
|---|---|
| 项目 | `go2office`（ref `proj_wwabgtzjdqddykvvvpxx`，Xhunter AU 组织下） |
| SDK | `@trigger.dev/sdk` v4（**导入路径必须是包根，严禁 `@trigger.dev/sdk/v3`**） |
| 配置 | [trigger.config.ts](../trigger.config.ts) —— `runtime: "node-24"`，`dirs: ["./src/trigger"]` |
| 本地开发 | `npm run trigger:dev`（CLI 自动读 `.env.local`，无需 `--env-file`） |

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

⚠️ 本地由 CLI 从 `.env.local` 读取，**但部署环境读不到该文件**——以上 6 个变量必须在 Trigger.dev 控制台的 Environment Variables 里另配一份。**截至 2026-08-22 尚未配置**，因此该 Task 目前只在 dev 环境可用。

### 实测

2026-08-22，dev worker `20260822.1`，订单 205970（114g / $10.47 / Cardwell QLD）：1.6 秒完成，11 行报价，选中 `Register_Letter` $5.00。同一订单连跑两次，`order_shipping_quotes` 得到 2 个批次共 22 行，全表仅 1 行 `is_selected` —— 唯一索引未触发冲突。
