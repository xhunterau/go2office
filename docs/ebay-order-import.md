# eBay 订单导入（开发中）

> **状态（2026-11-14）**：前置管道已完成并在生产库验证；订单导入本身**尚未开始**，卡在下面 §3 的决策上。
> 管道细节（OAuth、账号删除通知、表与权限）见 [ebay-integration.md](ebay-integration.md)。本文件是**接手开发的入口**。

目标：把 eBay 未发货订单拉进 go2office，作为 `pending` 进入 Order Allocation，与 [Shopify 导入](shopify-order-import.md) 并列。xpros 没有这个功能，Laravel 的做法未知。

---

## 1. 已完成

| 项 | 位置 | 验证 |
|---|---|---|
| 表 `ebay_accounts` / `ebay_account_deletions`（RLS 零策略） | 迁移 `20261114120000`，已推远端；`database.types.ts` 已补 | `SET ROLE authenticated` 实测读改删 0 行、插入被拒 |
| 账号删除通知 endpoint | `supabase/functions/ebay-account-deletion/`，已部署 | eBay 门户 Send Test Notification 已落库（测试行已删） |
| 卖家授权脚本 | `scripts/ebay/authorize.mjs` | 卖家 `go2buy_au`（userId `CsMlJk7dTqS`）已授权，scope = `sell.fulfillment`（读写）+ `commerce.identity.readonly`，refresh token 到期 **2028-05-14** |
| REST 客户端 | `src/lib/ebay/client.ts`（`loadEbayAccount` / `ebayGet`） | 实拉 `GET /sell/fulfillment/v1/order` 成功，返回 2 张未发货单 |

## 2. 换电脑接着做：需要准备的

refresh token 存在**数据库**里，新电脑**不需要重新授权**。但下列东西不在 git 里：

1. **`.env.local`**（被 `.gitignore` 忽略）：从旧电脑安全地拷过去。eBay 相关 5 个变量：
   `EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`（Cert ID）、`EBAY_RUNAME`（`…-teacg`）、`EBAY_VERIFICATION_TOKEN`、`EBAY_DELETION_ENDPOINT`。后两个同时存在于 Edge Function secrets 和 eBay 门户，**三处必须一致**
2. **Supabase CLI 登录**（`~/.supabase/access-token`）：只有重新部署 Edge Function 或改 secrets 时才需要，`npx supabase login`
3. 读 `.env.local` 一律按 CLAUDE.md 规则 16（`npx dotenv-cli -e .env.local -- …` 或 `grep | cut`），**严禁 source**
4. 冒烟测试（确认新机器能连通 eBay）：写一个临时 `.mts`，`loadEbayAccount(serviceRoleClient)` 后 `ebayGet(account, "/sell/fulfillment/v1/order", { filter: "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}", limit: 50 })`，用 `npx dotenv-cli -e .env.local -- npx jiti <file>.mts` 跑（`client.ts` 对 `@/` 只有 type import，jiti 能直接跑）

## 3. 待用户决策（开工前必须有答案）

推荐项已标出，用户尚未回复。

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| 1 | **上线方式** | A：先开发，只用 Debug 单张试导；Laravel 停止拉 eBay 单 + 跑最终切换 `004` 后再正式用 · B：直接与 Laravel 并行 | **A**。并行会导致同一张单两边各发一次，且 `004` 按 id 覆盖，可能静默覆盖 go2office 新建的订单（[shopify-order-import.md §5](shopify-order-import.md)） |
| 1 附 | Shopify 是否已经不在 Laravel 处理？ | — | 需用户回答。go2office 11 月已导入 20 张 Shopify 单，而 `go2_*` 临时表（11 张）仍在，即 `004` 尚未跑 |
| 2a | eBay 单之间按客户合并 | A：合并，与 Shopify 同规则 · B：不合并 | **A**。去年 214 个客户下过 ≥2 单，同日两单仅 9 次 |
| 2b | 跨平台合并（eBay ↔ Shopify） | A：不做 · B：做 | **A**。`orders.platform` 只有一个值，而 Shopify 去重限定 `platform='shopify'`：Shopify 行并进 eBay 单后下次会被**重新导入**。双平台客户仅 106 个 |
| 3 | `postage_service` 存法 | A：原样存 API 的 code（`AU_StandardDelivery`）· B：映射成历史显示名（`Standard Parcel Delivery`） | **A**。报价引擎只看 `/express/i`（`quote-engine.ts`），两种都能命中；B 需要维护映射表 |
| 4 | 触发方式 | A：先只做手动按钮 · B：一开始就定时 | **A** |
| 5 | 非 AU 地址的单 | 照导（会停在 pending、不进任何 Allocation 队列，Shopify 现状如此）· 跳过并在结果里列出 | 未定 |

已撤回的问题：Flat Rate 袋映射——历史 4.8 万行是多年前的，近两年仅 1 张，eBay 单的 `shipping_method` 都由 Allocation 决定，无需特殊处理。

## 4. 已定的实现要点

- **结构照搬 Shopify**：`src/lib/ebay/orders.ts`（分页拉取）+ `src/lib/ebay/order-mapper.ts`（纯函数 + 单测）+ SQL 函数（与 `import_shopify_order` **共用**客户匹配 / 合并 / 发票号 / 日志逻辑，抽内部函数，不复制）+ Trigger Task `import-ebay-orders`（串行、`maxAttempts: 1`、`concurrencyLimit: 1`、轮询进度；**同步更新 `docs/current_tasks.md`**）
- **拉取条件**：`filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`，每页最多 200
- **跳过规则（待用户确认 §3-5，其余默认）**：`cancelStatus.cancelState` ≠ `NONE_REQUESTED` 的单跳过并在结果里列出（申请取消中的不导，免得发出去）；`lineItemFulfillmentStatus` 已完成的行丢弃
- **去重键**：`order_transactions.order_id_ebay` = `orderId`（`22-15404-74231` 格式，与 17.8 万行历史同口径），限定 `orders.platform = 'ebay'`
- **`ebay:xxxx` 引用码在 API 的 `shipTo.contactAddress.addressLine1`**，真实街道在 `addressLine2`。必须挪到 `customers.address_line3`（历史位置），真实街道上移到 line1——line1 是客户匹配三要素之一，不挪则同一客户每次都匹配不上。该引用码 **≠** `buyer.username`
- **邮箱**：`shipTo.email` 是 `@members.ebay.com` 中转地址，照存（历史上 eBay 客户 99% 是这种），**不可用于客户匹配**
- **Debug 单张导入**：新增开关 `ebay_import_test_order`（迁移插行 + `src/lib/debug/settings.ts` 注册，见 shopify-order-import.md §7）
- **授权到期提醒**：Import from eBay 按钮旁，refresh token 剩 30 天内显示警告（常量 `REFRESH_TOKEN_WARNING_MS` 已在 `client.ts`）。读 `ebay_accounts` 须走 service role（表无策略），或加 SELECT 策略并用 REVOKE + 列级 GRANT 挡住 `refresh_token`（规则 22）

### 字段映射（草案，按 2 张真实单的结构）

| go2office | eBay Fulfillment API |
|---|---|
| `order_transactions.order_id_ebay` | `orderId` |
| `order_transactions.sales_record_number` | `salesRecordReference` |
| `order_transactions.transaction_id_ebay` | `lineItems[].lineItemId` |
| `order_transactions.item_number` | `lineItems[].legacyItemId` |
| `order_transactions.custom_label` | `lineItems[].sku`，trim |
| `order_transactions.item_title` | `lineItems[].title` |
| `order_transactions.quantity` | `lineItems[].quantity` |
| `order_transactions.sale_price` | `lineItems[].lineItemCost.value / quantity`（**待核**：lineItemCost 是否为行总额） |
| `order_transactions.postage_service` | `fulfillmentStartInstructions[0].shippingStep.shippingServiceCode`（待 §3-3） |
| `sale_date` / `paid_on_date` | `creationDate` / `paymentSummary.payments[].paymentDate`（待核） |
| `orders.postage_and_handling` | `pricingSummary.deliveryCost` |
| `orders.discount` | `pricingSummary.priceDiscount`（样本里没有该字段，**待核**） |
| `customers.*` | `shippingStep.shipTo`：`fullName`、`primaryPhone.phoneNumber`、`email`、`contactAddress.*`（`stateOrProvince`、`countryCode` 会被规则 21 的触发器再标准化） |

## 5. 以后要做（已确认，不在本期）

- **运单号回写 eBay**：`POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`。scope 已授权，无需再授权。合并单要对**每个** `order_id_ebay` 各回写一次
- **按删号通知匿名化客户数据**：`ebay_account_deletions.processed_at` 预留；动手前必须向 eBay 核实（endpoint 未校验签名）
