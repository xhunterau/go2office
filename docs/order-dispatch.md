# 发货（Dispatch）：扣库存与录运单号

把 xpros 的「拣货 Picking」和「打包 Packing」两步合并成一步：确认每件商品从哪个库位拿，录入运单号，发货。

| | |
|---|---|
| 源实现 | xpros 的 `src/app/fulfillment/picking/*`、`src/app/fulfillment/packing/*`、数据库函数 `confirm_order_picking` |
| 落地对象 | 1 个迁移 + `src/lib/fulfillment/dispatch.ts` + `src/lib/queries/dispatch.ts` + `src/lib/actions/dispatch.ts` + `src/lib/validations/dispatch.ts` + `/fulfillment/dispatch` 与 `/fulfillment/dispatch/[id]` |
| 迁移文件 | `20261114150000_create_dispatch_order.sql`（**已推送远端**） |
| 状态 | 代码完成并已提交推送（2026-11-14）。`npm test` 359 passed，`tsc` 与 `eslint` 通过；函数场景测试在事务里跑完并回滚；页面已用登录会话 GET 验证能渲染。**真实发货尚未在浏览器里点过，见 §6 待测清单** |

订单状态流：`pending` →（Allocation）→ `processing` →（Export Labels）→ `labelled` →（**Dispatch**）→ `completed`。

---

## 1. 决策（2026-11-14 用户确认）

| # | 决策 | 后果 |
|---|---|---|
| 1 | **拣货和打包合并成一步** | 没有 xpros 的 `Pick` 中间状态。`labelled` 直接到 `completed` |
| 2 | **不逐件扫商品条码核对数量** | xpros 的 `scanBarcode` / `manualCheck` / `checked_quantity` 都不移植 |
| 3 | **已有运单号时默认锁定** | 显示出来但只读；点 `Re-enter` 才能编辑，并自动全选，扫码直接覆盖 |
| 4 | **发货后回到搜索页** | 不自动跳到下一张。下一张要在 `/fulfillment/dispatch` 按发票号或客户名搜出来再进 |
| 5 | **只保留「确认客户备注」这一道检查** | xpros 的选邮编检查（地址在 Allocation 已核过）和补尺寸检查（运费早已报完）不做 |
| 6 | **库存不够就拦住，但就地给修正入口** | 每行的扳手菜单直接打开 `/inventory` 同一个 `StockMovementDialog`（盘点 / 调拨 / 入库），改完自动刷新 |
| 7 | **「调货中」与 Braeside 调货申请不做** | 只有一个仓库 |
| 8 | **发货页不能改订单数量** | 要改去订单详情页改，经 `rebuild_order_items` 重算 |
| 9 | **平台回写与发货邮件本阶段不做** | Shopify 标记发货、eBay 回写运单号、发货通知邮件，下一阶段做 |

## 2. 数据库：`dispatch_order()`

```
dispatch_order(p_order_id bigint, p_tracking_number text, p_picks jsonb,
               p_allow_shared_tracking boolean DEFAULT false) RETURNS text
```

`p_picks` 是 `[{"order_item_id": 1, "location_id": 2}, ...]`，必须覆盖订单的每一个 `order_items` 行、每行恰好一次。返回值是入库后的（已归一化的）运单号。

**一个事务做完全部事情**，任何一步失败都整体回滚：

1. `SELECT … FOR UPDATE` 锁订单，状态必须是 `labelled`。两个人同时发同一张单，第二个人会看到「已不在待发货状态」，库存不会扣两次。
2. 先用 `normalize_tracking_number()` 归一化运单号（规则 20），再查重。只有这样，扫出来的整串 GS1-128 条码才能和库里存的 article id 比对上。
3. 有 Unresolved SKU（`product_id IS NULL`）的订单拒绝发货。
4. `p_picks` 和订单当前的明细不一致时拒绝。改过 SKU 或数量的行会被 `rebuild_order_items` 重新生成，行 id 也会变，所以这说明页面已过期，不能猜。
5. 按「商品 + 库位」汇总后，以固定顺序 `FOR UPDATE` 锁住库存行，再一次列出**所有**短缺。
6. 逐个调用 `record_stock_movement(..., 'dispatch', -qty, 'Order <发票号>')` 扣库存。库存表不允许直接 UPDATE（`docs/inventory-ui.md` §4.2）。
7. 把拣货库位写回 `order_items.location_id`（迁移进来的 28,893 行历史明细也用这一列）。
8. 订单改为 `completed`，写入 `tracking_number` 和 `posted_on_date = now()`。这和 Laravel 已发货订单的形态一致。
9. 在同一事务里写 `order_logs`，内容是运单号加上每笔出库明细。所以这里**没有**规则 24 那种「日志写失败只给 warning」的降级分支：日志行要么存在，要么这次发货根本没发生。

xpros 的 `completePackingAction` 是分开写的（先 update 状态和运单号，再 insert 日志），可能出现订单已发货但没有日志的情况。

**SECURITY INVOKER**：调用者自己的 RLS 生效，`auth.uid()` 满足 `order_logs` 的 `WITH CHECK`。已 `REVOKE` anon，实测 anon 调用返回 `42501`。

| SQLSTATE | 含义 | 页面怎么处理 |
|---|---|---|
| `GO001` | 运单号已在别的订单上，`HINT` 里是那些发票号 | 弹确认框问「是不是同一个包裹」，确认后带 `p_allow_shared_tracking = true` 重试 |
| `GO002` | 库存不足，消息里一次列出所有短缺 | toast 显示，然后刷新页面 |
| `P0001` | 其余情况，消息可以直接展示 | toast 显示，然后刷新页面 |

**为什么重复运单号是「确认」而不是「拦死」**：同一个买家的 Shopify 单和 eBay 单在导入时按决定不合并（`docs/ebay-order-import.md` 决策 2b），但现实中可能装进同一个包裹发出。历史数据里有 147 组重复运单号，大部分是扫错的（例如 `33GLH0009303` 出现了 12 次）。所以默认拦住，确认后放行。

### 2.1 场景测试（2026-11-14，事务内执行后回滚）

| 场景 | 结果 |
|---|---|
| 选了没有库存的库位 | `GO002 Not enough stock: BT01533SF at S-1-1 needs 2, has 0; BT01537SF at S-1-1 needs 1, has 0.` |
| 少传一行或重复传一行 | `The items on this order changed since the page was loaded…` |
| 运单号为空 | `Enter a tracking number.` |
| 正常发货（2603247F） | 库存 378→376、38→37，2 条 `dispatch` 流水（带 `created_by`），`order_items.location_id` 已写入，状态 `completed`，有 `posted_on_date`，日志内容正确 |
| 同一单再发一次 | `Order 2603247F is no longer waiting for dispatch (it is completed).` |
| 用 26032421 已有的运单号 | `GO001`；带 `allow` 参数后成功 |
| 没有明细行的订单 | 成功，日志写「No stock deducted (the order has no items)」 |
| anon 角色 | `42501 permission denied` |

## 3. 页面

### 3.1 `/fulfillment/dispatch`

- 只有一个搜索框，页面加载时自动获得焦点（扫码枪可以直接扫发票号），按发票号或客户名搜索。**默认不列出整条队列**，只显示等待发货的订单数。
- **只搜出一条时直接跳到详情页**（服务端 `redirect`，2026-11-15 用户决策）：扫发票号几乎总是唯一匹配，扫完即进入、焦点落在运单号框。多条才显示结果表让人选，0 条显示提示。redirect 会替换掉 `?q=` 那条历史记录，详情页的返回链接也不带 `q`，所以后退不会再被弹回详情页。
- 搜索分两条查询再合并：发票号匹配，以及客户名匹配（客户名用 `customers!inner` 过滤）。PostgREST 不能把主表的列和嵌入表的列放在同一个 `or()` 里。
- 只搜 `status = 'labelled'` 的订单，每次最多 20 条。

### 3.2 `/fulfillment/dispatch/[id]`

- 页面上依次是：发票号、平台、承运方式、收货地址（经 `usableAddressLines()`，不显示 `ebay:` 引用码，规则 24）。
- **客户备注**（`orders.comments`）：有备注时必须点 `I have read the note`，否则 `Dispatch` 按钮不可用。
- **商品表**：
  - 每行是一个 `order_items` 行（套装已拆成单品）。
  - 库位默认选中「库存最多、且能覆盖整张订单对该商品需求量」的那个，同一商品的多行会合并计算。
  - 只有一个能覆盖需求的库位时直接显示库位名；有多个库位，或没有能覆盖的库位时，显示下拉框让人选。
  - 库存不足的行高亮显示。扳手菜单可以就地 `Count stock` / `Move stock` / `Receive stock`。
  - 页面只记住操作人改过的选择，其余行每次都从当前库存重新推算默认库位。所以盘点之后，原来没有可用库位的行会自动选上。
- **运单号**：
  - 订单已有运单号时（Aramex 下单时会写入），输入框只读，旁边有 `Re-enter` 按钮。点了之后才能编辑，并自动全选。
  - 没有运单号时输入框自动获得焦点；有备注的订单，在确认备注之后才获得焦点。
- 点 `Dispatch` 会先弹出 `useConfirm` 确认框（规则 9）。成功后 toast 提示，并回到 `/fulfillment/dispatch`。
- 订单已不在 `labelled` 状态时（例如从历史记录或另一个标签页打开），不显示表单，只显示它现在的状态。如果已发货，同时显示发货时间和运单号。

前端的短缺计算（`findShortages`）只用来决定页面显示什么、默认选什么。真正的检查在 `dispatch_order()` 里，并且是在行锁下完成的。

## 4. 没有移植的 xpros 部分

| xpros | 为什么不移植 |
|---|---|
| `scanBarcode` / `manualCheck` / `checked_quantity` | 决策 2 |
| `PostcodeStep` / `DimensionsStep` | 决策 5 |
| `set_line_transferring` / `stock_requisitions` | 决策 7 |
| `updateTransactionQuantity`（直接改 `quantity`，不经过重算规则） | 决策 8 |
| `adjustPickInventory` / `transferPickStock`（直接读出再写回 `inventory_levels`，有并发竞态） | 改为复用 `set_stock_level` / `move_stock` 的 `StockMovementDialog` |
| `clearZeroInventory` | `/inventory` 已经有 `purgeZeroStockLevels` |
| `send-dispatch-notification-email` / `update-neto-order-tracking` | 决策 9；也没有 Neto |

## 5. 下一阶段：运单号回写 Shopify / eBay（设计稿，2026-11-15，未动工）

> 状态：**方案已出、代码一行未写**。§5.6 的 4 个决策点用户尚未回复，动工前先确认。

### 5.1 已具备的前提（不用再做）

| 项 | 现状 |
|---|---|
| Shopify 平台订单 id | `order_transactions.order_id_ebay` = `legacyResourceId`；`transaction_id_ebay` = line item gid 数字尾巴（`docs/shopify-order-import.md`） |
| eBay 平台订单 id | 同一列 = eBay 订单号（`17-15414-28640`） |
| 合并单 | 同买家同平台的多张单会并进一张 go2office 订单，所以**一张订单可能对应多个平台订单 id**，每个都要单独回写（取 `DISTINCT order_id_ebay`） |
| Shopify 权限 | app 已有 `write_merchant_managed_fulfillment_orders`（预留给回写的），只是还没实际调用验证过 |
| eBay 权限 | 已授权 `sell.fulfillment`，无需重新授权（`docs/ebay-order-import.md` §5） |
| 客户端 | `src/lib/shopify/client.ts` 的 `shopifyQuery`；`src/lib/ebay/client.ts` 目前只有 `ebayGet`，**要补一个 POST** |

### 5.2 核心设计：发货事务内写待办表 → 后台任务异步推送

1. **新表 `platform_fulfillment_syncs`**：每个「go2office 订单 × 平台订单 id」一行。字段：`order_id`、`platform`、`platform_order_id`、`tracking_number`、`status`（`pending` / `succeeded` / `failed` / `skipped`）、`attempts`、`last_error`、`platform_fulfillment_id`、时间戳。唯一键 `(order_id, platform_order_id)`。
   - **由 `dispatch_order()` 在同一事务里插入**。发货成功就必有待办，不会「发了货忘了回写」；规则 26 的「同一函数、同一事务」继续成立。平台 API 慢或失败不卡发货、不回滚库存。
   - `dispatch_order()` 是 SECURITY INVOKER，要给 `authenticated` 加 **INSERT 策略**（规则 22：只有 SELECT 策略的表写不进去，`order_logs` 吃过这个亏）。Task 用 service role 更新状态。
   - 需同步：迁移（带 `BEGIN/COMMIT`）、`database.types.ts` 手工补条目（规则 18）、`docs/existing_*`。
2. **Trigger.dev Task `push-platform-fulfillment`**（入参：go2office order id）：发货 Server Action 成功后立即 trigger。另加一个 **schedules 定时任务**（约每 15 分钟）扫 `pending` / `failed` 补推，兜住 trigger 调用本身失败的情况。
   - **推送前先查平台现状 → 幂等，可以重试**。这与 Aramex 下单（规则 24，`maxAttempts` 必须为 1）**不同**，不要照抄那边的限制，也不要因为这里能重试就反过来放宽 Aramex。
   - 单张订单内的多个平台订单**串行**处理，不 `Promise.all`。
   - 写完同步更新 `docs/current_tasks.md`。
3. **Shopify**（新文件 `src/lib/shopify/fulfillment.ts`）：查 `order(id).fulfillmentOrders`，取状态 OPEN / IN_PROGRESS 的 → `fulfillmentCreate` 整单发货，带 `trackingInfo { number, company, url }`。已无未发货的 fulfillment order → 记 `skipped`（已在 Laravel / Shopify 后台发过）。
4. **eBay**（新文件 `src/lib/ebay/fulfillment.ts`）：先 `GET /sell/fulfillment/v1/order/{id}/shipping_fulfillment`，已有同运单号 → `skipped`；否则 `POST .../shipping_fulfillment`，带 `lineItems`、`shippedDate`（= `posted_on_date`）、`shippingCarrierCode`、`trackingNumber`。**`lineItems` 实时从 eBay 拉订单取**，不用本地 `order_items`——本地明细可能被 `rebuild_order_items` 重建过，对不上。
5. **承运商映射 `src/lib/fulfillment/platform-carriers.ts`**：`shipping_method` → Shopify company 名 + 追踪 URL、eBay carrier code。照规则 24：键类型收窄 + 穷尽性检查，缺键抛错，**严禁 `?? 默认值`**——否则运单号挂到错误承运商下，买家点开查不到，且不报错。**两个平台接受的承运商取值必须查官方文档核实，不凭记忆写。**
6. **页面**：订单详情页显示每个平台订单的回写状态与错误，带 `Retry`；发货搜索页显示「N failed syncs」入口，否则失败只是一行没人看的记录。

### 5.3 边界情况

- 平台上订单已取消 / 已退款 → 记 `failed` 并展示错误，人工处理，不自动重试到天荒地老（`attempts` 设上限）。
- 订单里手工加的明细行没有平台 id → 不影响：按 `DISTINCT order_id_ebay` 推整单。
- 重复运单号（`GO001` 确认放行的同包裹多单）→ 各自正常回写同一个运单号。
- 迁移进来的 20 万张历史订单**永远不推**：待办行只由 `dispatch_order()` 产生。

### 5.4 实施顺序建议

1. 迁移：建表 + RLS + 改 `dispatch_order()` 插待办 → 事务内场景测试后回滚，再推送。
2. `platform-carriers.ts` + 单测（穷尽性）。
3. Shopify / eBay 两个 `fulfillment.ts` + 单测（mock HTTP，覆盖幂等跳过分支）。
4. Task + 定时任务 + `docs/current_tasks.md`。
5. 页面状态与 Retry。
6. 各拿**一张真实单**在 staging 跑通（Trigger.dev 用 staging 环境查 run）。

### 5.5 发货通知邮件

取决于 §5.6 决策 1：Shopify 打开 `notifyCustomer` 则 Shopify 单由平台发邮件；eBay 平台自己会通知买家。`store` / `backorder` 单是否需要自建邮件，另议。

### 5.6 待用户确认（2026-11-15 提出，未回复）

| # | 问题 | 默认建议 |
|---|---|---|
| 1 | Shopify `fulfillmentCreate` 是否 `notifyCustomer` | 打开（顺便解决 Shopify 单的发货通知邮件） |
| 2 | Laravel 并行期间，Laravel 发的单由谁回写 | Laravel 自己回写；go2office 只推自己发的单（幂等检查防重复，但防不了 Laravel 漏推） |
| 3 | 发货后改运单号是否自动更新平台 | 本期不做，只手动 Retry（eBay 不能改已有 shipping fulfillment，只能新建） |
| 4 | `store` / `backorder` 平台订单 | 不写待办行，不处理 |

## 6. 交接与待测清单（2026-11-14 收工时）

**换机继续开发须知**
- 迁移 `20261114150000` 已推送到远端库，新机器**不需要**再跑 `supabase db push`。
- `.env.local` 不在 git 里，需从旧机器拷过去；读取方式遵守规则 16（严禁 `source`）。
- `npm install` 后先跑 `npx vitest run`（应为 359 passed）和 `npx tsc --noEmit` 确认环境正常。

**明天在浏览器里要过一遍的流程**（用户测试，尚未执行）

| # | 操作 | 期望 |
|---|---|---|
| 1 | 侧边栏 Sales → Dispatch | 只有搜索框且已获得焦点，显示等待发货数 |
| 2 | 搜发票号 `2603247F`，或搜客户名 | 出结果表，点发票号进详情 |
| 3 | 有客户备注的订单 | `Dispatch` 按钮不可用，点 `I have read the note` 后可用，焦点跳到运单号框 |
| 4 | 已有运单号的订单 | 只读显示；点 `Re-enter` 后可编辑且全选 |
| 5 | 扫/输运单号 → Dispatch → 确认 | toast 成功，回到搜索页；`/orders/[id]` 状态 `completed`、日志有出库明细；`/inventory` 库存已扣 |
| 6 | 用另一张单已有的运单号 | 弹「Tracking number already used」，确认后才发货 |
| 7 | 库存不足的订单 | 行高亮、按钮不可用；扳手 → Count stock 改数后页面刷新，库位自动选上 |
| 8 | 手机宽度打开详情页 | 表格可横向滚动，确认框不超出视口（规则 12） |

测出问题时，先看 §2 的错误码表判断是函数拒绝还是页面问题。

**注意**：Laravel 与 go2office 并行期间，同一张单只能在一个系统里发货，否则库存会扣两次。

**下一阶段**：见 §5（Shopify / eBay 运单号回写、发货通知邮件）。2026-11-15 已出设计稿，未写代码；换机后先读 §5.6 的 4 个待确认决策，确认后按 §5.4 顺序动工。
