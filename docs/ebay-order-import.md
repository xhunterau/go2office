# eBay 订单导入

> **状态（2026-11-14）**：已实现并在生产库端到端验证（Debug 单张导入 `20-15407-95810` → 订单 206029，重跑识别为 duplicate）。入口是 `/orders` 页头的 **Import from eBay**。
> 管道细节（OAuth、账号删除通知、表与权限）见 [ebay-integration.md](ebay-integration.md)。Task 说明见 [current_tasks.md](current_tasks.md#import-ebay-orders)。

把 eBay 未发货订单拉进 go2office，作为 `pending` 进入 Order Allocation，与 [Shopify 导入](shopify-order-import.md) 并列。xpros 没有这个功能，Laravel 的做法未知。

---

## 1. 用户决策（2026-11-14）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 上线方式 | **与 Laravel 并行**。当前库里的订单都是测试数据，上线时会从 Laravel 重新迁移一次真实数据，所以 [shopify-order-import.md §5](shopify-order-import.md) 的 id 冲突 / 重复风险在开发期不处理。**并行期间同一张 eBay 单两边都有，只能从一边发货** |
| 2a | eBay 单之间按客户合并 | **合并**，与 Shopify 同规则（姓名 + 地址第一行 + 邮编） |
| 2b | 跨平台合并（eBay ↔ Shopify） | **不合并**。客户行共用（同一个人两个平台的单挂同一个 `customer_id`），订单不并 |
| 3 | `postage_service` | **按历史写法存**：`AU_StandardDelivery` → `Standard Parcel Delivery`，`AU_ExpressDelivery` → `Express Parcel Delivery`（近两年 eBay 行 14,517 / 14,564 是这两个）。表外的代码**原样存**并在结果的 notices 里列出，不拦订单（报价引擎只看 `/express/i`）。`orders.shipping_method` 导入时**留空**，由 Allocation 决定——历史上同一个 `Standard Parcel Delivery` 落到了 `Letter` / `Mypost_Reg_S_Box` / `Parcel_Post` 等 8 种方式，推不出来 |
| 4 | 触发方式 | **只做手动按钮** |
| 5 | 非 AU 地址 | go2buy 不发海外；万一有，**照导**，停在 pending（不进任何 Allocation 队列，与 Shopify 现状一致） |
| — | `ebay:xxxx` 引用码 | **直接丢掉，不存**（不挪到 line3）。真实街道上移到 line1 |

## 2. 实现

| 件 | 位置 |
|---|---|
| 拉单 | [src/lib/ebay/orders.ts](../src/lib/ebay/orders.ts) `fetchEbayOrders()`：`filter=orderfulfillmentstatus:{NOT_STARTED\|IN_PROGRESS}`，每页 200 按 offset 翻页，按 `creationDate` **升序**（同一买家两单：先下的建单、后下的合并）。Debug 用 `orderIds=`，此时 eBay 忽略其他过滤，已发货的也能拉到（但会被跳过规则丢掉） |
| 映射 | [src/lib/ebay/order-mapper.ts](../src/lib/ebay/order-mapper.ts)（纯函数，单测 [__tests__/order-mapper.test.ts](../src/lib/ebay/__tests__/order-mapper.test.ts) 20 条） |
| 写库 | SQL `public.import_platform_order('ebay', jsonb, uuid)`（迁移 `20261114130000`）。**Shopify 共用同一个函数**：`import_shopify_order` 已改成改名 payload 键的薄包装，行为逐字不变（2026-11-14 事务内对比日志文本与各列） |
| 逐单循环 / 结果类型 | [src/lib/order-import/import-orders.ts](../src/lib/order-import/import-orders.ts)，两个 Task 共用 |
| Task | [src/trigger/import-ebay-orders.ts](../src/trigger/import-ebay-orders.ts) |
| Action | [src/lib/actions/ebay-import.ts](../src/lib/actions/ebay-import.ts)，共用 [src/lib/order-import/start-import.ts](../src/lib/order-import/start-import.ts) |
| 按钮 | `orders/_components/ebay-import-button.tsx` → 共用的 `order-import-button.tsx`（Shopify 按钮同样改成了薄壳） |
| 授权到期提醒 | [src/lib/queries/ebay-authorization.ts](../src/lib/queries/ebay-authorization.ts) 调 `ebay_authorization_status()`（SECURITY DEFINER，只返回 `username` + `refresh_token_expires_at`，**不含 token**）。剩 30 天内按钮下出警告徽章；没有授权 / 多个账号 / 已过期则**禁用按钮** |
| Debug 开关 | `ebay_import_test_order`，值是 eBay 订单号（`17-15414-28640`）。**销售记录号（326100）不行**：getOrders 不能按它查。**只对还没发货的单有用**：已发货的单能拉到，但每行都是 `FULFILLED` 会被丢掉，整单计为 ignored（与 Shopify 开关不同，迁移 `20261114140000` 修正了开关说明）|

### 跳过规则（不进数据库，计入 `ignored`）

- `cancelStatus.cancelState` ≠ `NONE_REQUESTED`（申请取消中或已取消）→ **列入 notices**。申请被拒后再点一次导入即可
- `orderPaymentStatus` 为 `PENDING` / `FAILED` / `FULLY_REFUNDED` → 列入 notices。`PARTIALLY_REFUNDED` 照导
- `lineItemFulfillmentStatus = FULFILLED` 的行丢掉；全丢光则整单跳过
- 没有收货地址、数量 ≤ 0、金额不是数字 → 计为失败，整单不写

### 字段映射

| go2office | eBay Fulfillment API |
|---|---|
| `order_transactions.order_id_ebay`（去重键，限定 `platform='ebay'`） | `orderId`（与 17.8 万行历史同口径，所以 Laravel 导入过的单也会被识别为重复） |
| `order_transactions.sales_record_number` | `salesRecordReference`（缺失时退回 `orderId`） |
| `order_transactions.transaction_id_ebay` | `lineItems[].lineItemId` |
| `order_transactions.item_number` | `lineItems[].legacyItemId` |
| `order_transactions.custom_label` | `lineItems[].sku`，trim |
| `order_transactions.item_title` | `lineItems[].title` |
| `order_transactions.quantity` | `lineItems[].quantity` |
| `order_transactions.sale_price` | `lineItemCost.value / quantity`，四舍五入到分。`lineItemCost` 是**行总额**（API 文档：单价 × 数量，折扣前）；历史数据存单价（15.99 × 2）。2026-11-14 已用真实多件单验证（见 §3） |
| `order_transactions.postage_service` | `shippingServiceCode` 经 §1-3 映射 |
| `sale_date` / `paid_on_date` | `creationDate` / 最早的 `paymentSummary.payments[].paymentDate` |
| `orders.postage_and_handling` | `pricingSummary.deliveryCost − |deliveryDiscount|`（客户付给我们的；规则 25） |
| `orders.discount` | `|pricingSummary.priceDiscount|`（eBay 写负数） |
| `orders.comments` | `buyerCheckoutNotes` |
| `orders.web_order_id` | **NULL**（历史 eBay 单全为 NULL） |
| `customers.*` | `shipTo`：`fullName`、`primaryPhone.phoneNumber`、`email`（`@members.ebay.com` 中转地址，照存，**不参与匹配**）、`contactAddress.*`。`addressLine1/2` 去掉 `ebay:` 引用码后依次填 line1/line2（判断复用 `isReferenceCode()`，与出标签同口径） |

**eBay 上没填 SKU 的款式**：多款式刊登里有的款式没有 SKU，API 就不返回 `sku`，导入后 `custom_label` 为空、订单上显示 Unresolved SKU，需人工确认。这与 Laravel 时期一致（刊登 `114917926815` 历史上就有 453 行空 SKU；近两年 eBay 行中 262 / 14,566 行为空）。根治办法是在 eBay 上给这些款式补 SKU，不是改导入。

**匹配到历史客户时，其旧的 line3 引用码保留不动**（导入不写 line3，也不改已有客户的地址）。出标签时 `usableAddressLines()` 会过滤它。

## 3. 验证

- 单测：`npx vitest run src/lib/ebay src/lib/shopify`
- 函数（2026-11-14，事务内建函数 + 4 张真实单，ROLLBACK）：新建、重复、同买家第二张 eBay 单合并（累加运费、清空 `address_verified_at`）、同买家的 Shopify 单**不并**进 eBay 单但共用客户、Shopify 包装的字段与日志文本不变、去重按平台隔离、`platform='store'` 被拒、`authenticated` 调不了两个导入函数、`ebay_authorization_status()` 对 `authenticated` 可用且不含 token、`anon` 被拒
- 多件（2026-11-14，真实订单，把行状态当作未发货走 mapper + 函数，ROLLBACK）：`02-15438-01972` 一行 3 件，lineItemCost 23.07 → 单价 7.69（与同 SKU 单买 1 件的价格一致，证实 lineItemCost 是行总额）；`17-15383-41231` 两行各 2 件、订单折扣 $10 → 单价 23.70，商品 94.80 − 折扣 10 + 运费 0 = 84.80，与 eBay `total` 一致
- 端到端（2026-11-14，Trigger.dev dev）：Debug 导入 `20-15407-95810` → imported（订单 206029，SKU 已解析）；重跑 → duplicate。Shopify Task 回归：`G2B24769` → duplicate

## 4. 换电脑接着做

refresh token 存在**数据库**里，新电脑**不需要重新授权**。不在 git 里的：

1. **`.env.local`**：eBay 相关 5 个变量 `EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`、`EBAY_RUNAME`、`EBAY_VERIFICATION_TOKEN`、`EBAY_DELETION_ENDPOINT`。后两个同时存在于 Edge Function secrets 和 eBay 门户，**三处必须一致**
2. **Supabase CLI 登录**：只有部署 Edge Function、改 secrets 或 `db push` 时需要，`npx supabase login`
3. 读 `.env.local` 一律按规则 16，**严禁 source**
4. 本地跑脚本时 jiti 不认 `@/`：`JITI_ALIAS='{"@/":"<repo>/src/"}' npx dotenv-cli -e .env.local -- npx jiti <file>.mts`

## 5. 以后要做（已确认，不在本期）

- **运单号回写 eBay**：`POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`。scope 已授权，无需再授权。合并单要对**每个** `order_id_ebay` 各回写一次
- **按删号通知匿名化客户数据**：`ebay_account_deletions.processed_at` 预留；动手前必须向 eBay 核实（endpoint 未校验签名）
