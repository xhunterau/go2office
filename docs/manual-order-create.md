# 手动创建订单

> 状态：**已实现**（2026-11-18，§4 五项决策均按建议采纳）。迁移 `20261118100000` 已在远端库事务内演练并回滚，**尚未推送**。实现记录见 §6。

## 1. 背景与目标

上线方式已定为一次性切换（Laravel 冻结 → go2office reset → 同步 Laravel 数据）。go2buy 没有门店单、电话单，但仍需要一个**不经过 Shopify / eBay 导入、由人工建立的订单入口**，用于平台外成交、补录、换货发出等场景。

要求：建出来的订单必须走**现有**流程闭环，不另起一条通道：

```
New order（新）→ pending
   → Allocation：Address → Postage → Approve   （现有）
   → processing → Export labels                 （现有）
   → labelled  → Dispatch（扣库存、录运单号）     （现有）
   → completed
```

## 2. 现状调研

**历史上的手工单就是 `platform = store`。** 全库 570 张 `store` 订单（2018–2026），其中 291 张是带 `@` 的 follow-up 单，其余约 280 张是 Laravel 里手工建的单。`Letter` / `Parcel_Post` / `Eparcel_Regular` 是最常见的运送方式。`createFollowUpOrder`（`src/lib/actions/order.ts`）建的单也是 `store`。

**可直接复用的部件：**

| 需要的能力 | 现有部件 |
|---|---|
| 选已有客户 | `CustomerPickerDialog`（`src/components/customers/`，订单页 Replace 在用） |
| 新建客户 | `CustomerFormDialog` + `createCustomer`（地址经 `customers_standardize_address` 触发器标准化，规则 21） |
| 加商品行 | `transaction-create-dialog.tsx` + `createOrderTransaction`（SKU 必须解析到真实商品，套装经 `rebuild_order_items` 展开） |
| 运送方式 / 运费报价 | 订单详情页 `ShippingMethodSelect`、`ShippingQuotesPanel` |
| 审单、出面单、发货 | `/fulfillment/allocation`、`/fulfillment/export-labels`、`/fulfillment/dispatch`，按 `status` 取队列，**不看 platform** |
| 运单号回传 | `dispatch_order()` 只给 `shopify` / `ebay` 写待办行，`store` 单天然跳过 |

**发票号规则**：导入用的是 Laravel 规则「两位年份 + id 的六位大写十六进制」（`26032491`），写在 `import_platform_order()`（迁移 `20261114130000`）里，先 `nextval` 取 id 再插入。xpros 的 `createSalesOrder` 是「先插入、再 update 发票号」，并且用十进制，**不照搬**。

**xpros 的做法**：`create-order-dialog.tsx` 一个弹窗选 / 建客户 + 渠道 + 已收运费 + Web Order ID，建出空订单后跳到详情页加商品行。本设计沿用这个两步结构，因为第二步在 go2office 已经存在。

## 3. 方案

### 3.1 入口

`/orders` 页头，在 `Import from Shopify` / `Import from eBay` 按钮旁加 **`New order`** 按钮。

### 3.2 弹窗（`max-h-[85vh] overflow-y-auto`，规则 12）

| 字段 | 必填 | 说明 |
|---|---|---|
| Customer | 是 | 搜索已有客户（复用 `CustomerPickerDialog` 的搜索），或 `New customer` 就地新建（复用 `CustomerFormDialog`） |
| Postage charged | 否，默认 0 | 写 `orders.postage_and_handling`——**客户付给我们的**运费（规则 25：别与 `postage_paid` 写反） |
| Discount | 否，默认 0 | 写 `orders.discount` |
| Comments | 否 | 写 `orders.comments`。有备注的单在发货页需要先点 `I have read the note` |

不在弹窗里收 `shipping_method`：它在 Allocation 的 Postage 阶段由报价 + 人工批准决定，与导入单一致。

提交 → 新订单 `status = pending`、`platform = store` → 跳转 `/orders/[id]`，toast 提示「Add the items, then it will appear in Allocation」。

### 3.3 写入：一个数据库函数

新函数 `create_manual_order(p_customer_id, p_postage, p_discount, p_comments)`，SECURITY INVOKER：

1. `nextval` 取 id → 用 Laravel 规则算发票号 → 插入订单（一条语句，没有占位值）；
2. 同一事务写 `order_logs`：`Created manually`（`user_id = auth.uid()`，满足 `order_logs` 的 `WITH CHECK`，规则 22）。

Server Action `createManualOrder` 用 zod 校验后调用 RPC，返回 `{ success, data: { orderId, invoiceNumber } }`。

**发票号公式抽成共享函数** `public.format_invoice_number(bigint)`，`import_platform_order()` 改为调用它（需要在同一迁移里整体重建该函数，只改那一行）。否则两处各写一份公式，将来改一处、漏一处，两种订单的编号就会悄悄不一致。

### 3.4 商品行

不新做。在详情页用现有 `Add line`：选商品 → 填数量与单价。`sale_date` / `paid_on_date` 取当天，`order_id_ebay` 留空。

### 3.5 守卫：空订单不能离开 pending

两步建单的代价是会存在「建了没加行」的空订单。现在 `dispatch_order()` 遇到无明细的单会照常发货（只是不扣库存，见迁移 `20261114150000` 第 213 行），所以要在**上游拦下**：

- Allocation 的 `Approve`（含批量）拒绝没有 `order_items` 的订单，提示 `This order has no items`；
- 空订单在 Allocation 列表里显示 `No items` 徽章，免得被当成普通单。

这条守卫对所有平台生效。导入单本来就不会为空（导入时会跳过没有商品行的单）。

### 3.6 非 AU 客户

与导入单一致：照建，停在 `pending`，不进 Allocation 队列（规则 25 的队列口径）。弹窗里选到非 AU 客户时给一行提示。

## 4. 决策（2026-11-18 用户确认，全部按建议）

| # | 问题 | 建议 | 另一选项 |
|---|---|---|---|
| 1 | 订单平台 | **`store`**：与 570 张历史手工单、follow-up 单一致，不用改枚举 | 新增枚举值 `manual`：要换类型重建、全表重写 20 万行（参照 `new` / `picked` 的删除过程），并改动所有按平台分支的地方 |
| 2 | 建单步骤 | **两步**：弹窗建空单 → 详情页加行（复用现有页面） | 一步：弹窗里同时录商品行，要另写一套行编辑器 |
| 3 | 发票号 | **Laravel 规则**（`YY` + 十六进制 id），抽成共享函数 | follow-up 那种 `基号@n`：不适用，手工单没有原单 |
| 4 | 空订单守卫 | **拦在 Approve**（§3.5） | 拦在 `dispatch_order()`：太晚，那时面单已经出了 |
| 5 | 弹窗是否要 `Web order ID` / 外部参考号 | **不要**：`web_order_id` 目前只给 Shopify 用，`store` 单写进去会混淆。外部参考写进 Comments | 加一个字段 |

## 5. 实施顺序（确认后）

1. 迁移 `2026111810xxxx_create_manual_order.sql`（`BEGIN` / `COMMIT`，规则 14）：`format_invoice_number()`、`create_manual_order()`，重建 `import_platform_order()` 改为调用共享函数；同步 `database.types.ts` 的 `Functions`（规则 18）。
2. `src/lib/validations/order.ts` 加 `manualOrderCreateSchema`；`src/lib/actions/order.ts` 加 `createManualOrder`。
3. `src/app/(dashboard)/orders/_components/new-order-button.tsx` + 弹窗（react-hook-form + zod，复用客户选择与新建）。
4. Allocation：Approve 的空订单守卫 + `No items` 徽章，补单测。
5. 测试：`format_invoice_number` 对照历史 id（如 205969 → `26032491`）；`npx vitest run`、`npx tsc --noEmit`。
6. 更新本文档的状态和 `docs/orders-ui.md` §6.8。

## 6. 实现记录（2026-11-18）

| 文件 | 内容 |
|---|---|
| `supabase/migrations/20261118100000_create_manual_order.sql` | `format_invoice_number()`；`import_platform_order()` 取自远端 `pg_get_functiondef`，只把发票号赋值改成调用共享函数；`create_manual_order()`（SECURITY INVOKER，`GO003` 客户不存在，`22023` 负运费） |
| `src/lib/supabase/database.types.ts` | `Functions` 补两项 |
| `src/lib/validations/order.ts` | `nonNegativeMoney()` 抽出共用（编辑表单的 postage 也改用它）；`manualOrderCreateSchema` |
| `src/lib/actions/order.ts` | `createManualOrder`：调用 RPC，客户不在 AU 时返回 warning（订单照建，但不会进 Allocation） |
| `src/app/(dashboard)/orders/_components/new-order-button.tsx`、`new-order-details-dialog.tsx` | 第一步复用 `CustomerPickerDialog`（含新建客户），第二步填运费、折扣、备注，创建后跳转到订单页 |
| `src/lib/actions/allocation.ts` | `requireItems()`：两条批准路径在**任何写入之前**检查订单是否有商品，空单拒绝 |
| `postage-stage-client.tsx` | `total_items = 0` 的订单显示 `No items` 徽章 |
| `src/lib/validations/__tests__/order.test.ts` | schema 用例 |

**远端演练（事务内执行后回滚，2026-11-18）**：`format_invoice_number(205969)` = `26032491`；以 `authenticated` 身份建单得到 `pending` / `store`、备注已去首尾空格、日志 `Created manually` 的作者为当前用户；不存在的客户报 `GO003`；负运费报 `22023`；`anon` 无执行权限；`import_platform_order` 导入一张测试单，发票号仍等于 `format_invoice_number(id)`。

**注意**：演练时 `nextval` 不随回滚撤销，订单 id 序列跳过了几个号。发票号由 id 推出，所以只会让发票号不连续，不会重复。
