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
- **只搜出一条时直接跳到详情页**（服务端 `redirect`，2026-11-15 用户决策）：扫发票号几乎总是唯一匹配，扫完即进入，详情页随即等待扫运单号。多条才显示结果表让人选，0 条显示提示。redirect 会替换掉 `?q=` 那条历史记录，详情页的返回链接也不带 `q`，所以后退不会再被弹回详情页。
- 搜索分两条查询再合并：发票号匹配，以及客户名匹配（客户名用 `customers!inner` 过滤）。PostgREST 不能把主表的列和嵌入表的列放在同一个 `or()` 里。
- 只搜 `status = 'labelled'` 的订单，每次最多 20 条。

### 3.2 `/fulfillment/dispatch/[id]`

- 页面上依次是：发票号、平台、承运方式、收货地址（经 `usableAddressLines()`，不显示 `ebay:` 引用码，规则 24）。
- **客户备注**（`orders.comments`）：有备注时以醒目卡片显示，**不需要确认**，不影响 `Dispatch` 与扫码（2026-11-18 用户决策，去掉了原先的 `I have read the note` 关卡）。
- **商品列表**（卡片）：
  - 每行是一个 `order_items` 行（套装已拆成单品）。
  - 库位默认选中「库存最多、且能覆盖整张订单对该商品需求量」的那个，同一商品的多行会合并计算。
  - 只有一个能覆盖需求的库位时直接显示库位名；有多个库位，或没有能覆盖的库位时，显示下拉框让人选。
  - 库存不足的行高亮显示。扳手菜单可以就地 `Count stock` / `Move stock` / `Receive stock`。
  - 页面只记住操作人改过的选择，其余行每次都从当前库存重新推算默认库位。所以盘点之后，原来没有可用库位的行会自动选上。
- **运单号：全局扫码监听，不靠输入框焦点**（2026-11-18 用户决策）。搜索页仍用 autoFocus 输入框；详情页用 `useBarcodeScanner`（`src/hooks/use-barcode-scanner.ts`，机制移植自 xpros POS 的 `product-scanner`）在 document 上收扫码：
  - 靠按键间隔区分扫码枪与人手（`src/lib/scanner/scan-buffer.ts`：间隔 > 50ms 重新开始，至少 4 个字符，以 Enter 结尾），有单测。
  - 焦点在输入框里、或页面上有 dialog / alertdialog / listbox / menu 打开时不接收——确认框弹着时扫码不会落到背后，扫码枪结尾的 Enter 也不会替人点「确认」。识别出的扫码会吞掉结尾的 Enter，避免点中最后一次点过的按钮。
  - 不 autoFocus 输入框的原因：平板上一聚焦就弹出软键盘遮住半页，而且点一下别处扫码就丢了。输入框保留给手输。
  - 扫到的内容分流：形如发票号（8 位十六进制）的不当运单号——是本单就提示已打开，是别的单就给一个 `Open it` 跳转；备注未读时拦下；订单已有运单号且扫到的不包含它时，先确认是否替换。其余写入运单号框并**直接调起 `Dispatch` 确认框**；还有 blocker 时只写入、不提交，toast 提示第一条原因。
  - 订单已有运单号时（Aramex 下单时会写入），输入框只读，旁边有 `Re-enter` 按钮。点了之后才能编辑，并自动全选。
- 点 `Dispatch` 会先弹出 `useConfirm` 确认框（规则 9）。成功后 toast 提示，并回到 `/fulfillment/dispatch`。
- 布局面向平板（2026-11-18）：两页都居中（搜索页 `max-w-xl`、详情页 `max-w-3xl`），商品是卡片而不是表格，运单号与 `Dispatch` 按钮固定在屏幕底部。
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

## 5. 运单号回写 Shopify / eBay（2026-11-15 设计，2026-11-16 实现）

> 状态：**第 1–5 步已实现**（迁移 `20261116100000` 已推送远端）。**第 6 步真实订单测试未做**，Task 还没 deploy 到 staging。实现与本设计稿的差异见 §5.7。

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
- 订单里手工加的明细行没有平台 id → 只要同单还有别的行带着平台 id 就不影响：按 `DISTINCT order_id_ebay` 推整单。**但如果带平台 id 的行全被删了，就一行待办都不写、静默不回传**（2026-11-18：2603314B / 2603314C 已发货未回传，2603315B 同样缺号）。修复：
  - `createOrderTransaction` 在同单只有一个平台订单号时，新行自动继承 `order_id_ebay` 与 `sales_record_number`；多个时不猜。
  - `deleteOrderTransaction` 拒绝删除某个平台订单号的最后一行，提示改 SKU 或先加新行。
  - 发货详情页对缺号的 Shopify / eBay 单显示 `Tracking will not be sent to …` 警告，**只提示、不拦截**（用户决策），由人工去平台后台填。
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

§5.6 决策 1 定为**关闭** `notifyCustomer`，所以 Shopify 单的发货通知邮件要由 go2office 自建（本期不做）；eBay 平台自己会通知买家。`store` / `backorder` 单是否需要邮件，另议。

### 5.6 决策（2026-11-16 用户确认）

| # | 问题 | 决定 |
|---|---|---|
| 1 | Shopify `fulfillmentCreate` 是否 `notifyCustomer` | **关闭**。Shopify 不给买家发邮件，发货通知邮件以后由 go2office 自建（§5.5） |
| 2 | Laravel 并行期间，Laravel 发的单由谁回写 | **Laravel 自己回写**；go2office 只推自己发的单，推前先查平台现状防重复 |
| 3 | 发货后改运单号是否自动更新平台 | **本期不做**，只提供手动 Retry |
| 4 | `store` / `backorder` 平台订单 | **不写待办行，不处理** |

### 5.7 实现说明（2026-11-16）

**补充决策**（2026-11-16 用户确认，设计稿里没有）：

| # | 问题 | 决定 |
|---|---|---|
| 5 | 没有真实运单号的单（Letter；或运单号栏填的是发票号，历史上 Letter / Parcel_Post 都这样） | **只标记已发货、不带运单号**。实测 Laravel 回写 eBay 时就是这样做的（`fulfillmentId: "999"`，无运单号） |
| 6 | `Click_and_Collect` / `Store_Delivery` 的承运商 | **按运单号前缀判断**：`MS`/`MP` → Aramex；`33XXX`/`RPP`/`TMP`/`99…` → 澳邮；认不出 → 只标记已发货 |
| 7 | eBay 的 Aramex 承运商代码 | **`FASTWAYCOURIERS`**（2026-11-18 确认）。eBay 澳洲站承运商列表（Trading API `GeteBayDetails` / `ShippingCarrierDetails`，SiteID 15，共 35 项）里没有 Aramex；Fastway 是 Aramex Australia 2022 年更名前的品牌，fastway.com.au 已跳转到 aramex.com.au/tools/track。全局枚举里的 `ARAMEX` 不在澳洲站列表中，不用 |

**与设计稿的差异**

- `platform_fulfillment_syncs.tracking_number` 记的是「平台上现在挂着的号」，成功后才写入；`dispatch_order()` 插入时为 NULL。运单号的唯一来源是 `orders.tracking_number`，推送时实时读。
- 发货后改运单号的处理（决策 3）：Retry 时，若 succeeded 行的号与订单当前的号不同就重推。Shopify 走 `fulfillmentTrackingInfoUpdate` 改我们建的那个 fulfillment，eBay 新建一个 shipping fulfillment。页面上这类行会显示 `Tracking number changed` 徽章。
- 重复发货（订单被改回 `labelled` 再发一次）：`ON CONFLICT DO NOTHING`，不新增行。如果号变了，在订单页点 Retry。
- 承运商判断（`resolveShipment`）：发货方式和运单号格式**都**指向承运商、且两者矛盾时直接失败，不挑一个用。按近一年的 14,800 张历史单测算，只有 18 张会落到这里（例如方式是 MyPost，单号却是 Aramex 的 `MP…`）。
- 自动重试上限 3 次（`MAX_AUTO_ATTEMPTS`），超过后只能手动 Retry。

**已核实的平台取值**

| | Shopify（`trackingInfo.company`） | eBay（`shippingCarrierCode`） |
|---|---|---|
| 澳邮 | `Australia Post`（官方文档；实测 Laravel 回写 Shopify 也是这个值） | `AustraliaPost`（eBay ShippingCarrierCodeType） |
| Aramex | `Aramex Australia`（官方文档的澳洲列表里只有这个写法，单独的 `Aramex` 不在列表中） | `FASTWAYCOURIERS`（决策 7；买家看到的承运商名是 FASTWAY COURIERS） |

公司名在 Shopify 列表里时，Shopify 会自动生成追踪链接，所以不传 url。eBay 文档站拒绝自动抓取，`AustraliaPost` 起初是通过搜索引擎引用的 eBay 官方枚举页确认的；2026-11-18 用 `GeteBayDetails`（SiteID 15）直接读出澳洲站列表，两个值都以它为准。同日查了 4 张 Laravel 发过的 eBay 单（Aramex 与澳邮各两张），`shippingCarrierCode` 均为空——Laravel 从未给 eBay 回传过运单号，没有现成先例。

**只读预演（2026-11-16）**

对真实订单只调用读接口、打印出计划，没有调用任何写接口：

- Shopify `#G2B24770`：查询字段全部有效。Laravel 已用 `Australia Post` 发过货，计划结果是 `skipped`。
- eBay `17-15414-28640` / `26-14867-27994`：两张都已被 Laravel 标记发货但不带运单号，计划是新建一个带澳邮运单号的 fulfillment。

**新增文件**：

- 迁移 `20261116100000_create_platform_fulfillment_syncs.sql`；
- `src/lib/fulfillment/{platform-carriers,platform-push,platform-sync,queue-platform-fulfillment}.ts`；
- `src/lib/{shopify,ebay}/fulfillment.ts`，eBay 客户端新增 `ebayPost`；
- `src/trigger/push-platform-fulfillment.ts`（两个 Task）；
- `src/lib/actions/platform-fulfillment.ts`、`src/lib/queries/platform-fulfillment.ts`；
- 订单详情页 `platform-sync-panel.tsx`，发货搜索页的失败列表；
- 4 个测试文件。

### 5.8 第 6 步：真实订单测试（未做）

1. `npx trigger.dev deploy` 到 staging（**部署后 sweep 定时任务立即生效**：届时若已有 pending 行，15 分钟内会被真实推送）。
2. 挑一张 Shopify 单和一张 eBay 单，**由用户指定**，在 go2office 发货，然后到 Trigger.dev（staging）看 run、到平台后台看结果。
3. 再点一次 Retry，确认得到 `already`、平台上没有出现第二个 fulfillment（幂等）。
4. eBay Aramex 代码已填为 `FASTWAYCOURIERS`（2026-11-18）。拿一张 eBay Aramex 单实测，确认 eBay 接受该值、订单页的追踪链接能打开 Aramex 的查询结果。

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
| 3 | 有客户备注的订单 | 备注以黄色卡片显示，无需确认，可直接扫运单号发货 |
| 4 | 已有运单号的订单 | 只读显示；点 `Re-enter` 后可编辑且全选 |
| 5 | 扫/输运单号 → Dispatch → 确认 | toast 成功，回到搜索页；`/orders/[id]` 状态 `completed`、日志有出库明细；`/inventory` 库存已扣 |
| 6 | 用另一张单已有的运单号 | 弹「Tracking number already used」，确认后才发货 |
| 7 | 库存不足的订单 | 行高亮、按钮不可用；扳手 → Count stock 改数后页面刷新，库位自动选上 |
| 8 | 手机宽度打开详情页 | 表格可横向滚动，确认框不超出视口（规则 12） |

测出问题时，先看 §2 的错误码表判断是函数拒绝还是页面问题。

**注意**：Laravel 与 go2office 并行期间，同一张单只能在一个系统里发货，否则库存会扣两次。

**下一阶段**：运单号回写已实现到第 5 步，剩第 6 步真实订单测试（§5.8，含一张 eBay Aramex 单）。之后是发货通知邮件（§5.5：Shopify 已关闭 `notifyCustomer`，需自建）。
