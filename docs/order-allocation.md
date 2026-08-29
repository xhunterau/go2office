# Order Allocation（`/fulfillment/allocation`）

把 xpros 的 Order Allocation 移植过来：`pending` 订单在发货之前要过的两道关——地址能不能送到，运费该收谁的哪一档。

| | |
|---|---|
| 源实现 | xpros 的 `src/app/sales-orders/allocation/*` + `src/trigger/batch-address-check.ts` / `batch-postage-check.ts` |
| 落地对象 | 1 个迁移 + 1 个 SQL 函数 + `src/lib/queries/allocation.ts` + `src/lib/actions/allocation.ts` + 1 个 Trigger Task + 3 个页面 + 4 个组件 |
| 迁移文件 | `20260824100000_add_order_address_verification.sql`（**已推送远端**） |
| 状态 | **代码完成 2026-08-24**；2026-08-29 已部署 staging（`v20260829.1`）并**真实跑通一次批量报价**（见 §9.2）。`npm test` 284 passed / `tsc` / `eslint` / `next build` 均通过；**浏览器交互仍未验证** |

---

## 1. 决策基线（2026-08-24 用户确认）

| # | 决策 | 后果 |
|---|---|---|
| 1 | **不做 backorder 检测** | xpros 三个阶段去掉一个，只剩 Address → Postage。`view_order_transactions_with_stock` 那套库存充足度视图、Split、Mark as Backorder 全部不移植 |
| 2 | **阶段状态用 `orders.address_verified_at` 一列** | 不建 `pending_status` 枚举 —— 去掉 backorder 后只剩两个阶段、也就是一个 bit，而 xpros 枚举里另外五个值会全是死标签 |
| 3 | **接 Google Places Autocomplete，key 与 xpros 共用** | 只新增 `@vis.gl/react-google-maps` 一个依赖（xpros 自己的文档说用 `use-places-autocomplete`，**代码里并没有**） |
| 4 | **非 AU 订单完全排除在 allocation 之外** | 不做 xpros 的「自动打成 `Eparcel_Intl_Express` 并置 Ready」——该枚举值已被 `20260823110000` 删掉（无国际合约）。全库非 AU 客户 17 人 |
| 5 | **全部报价展示，最便宜的只做视觉标记** | 不移植 xpros 的自动放行规则（见 §5.3）。**没有任何订单会被自动批准** |
| 6 | **保留 `Approve without a quote`** | 报价全失败的订单否则没有出路，只能被动掉出队列 |

## 2. 队列口径

只有一个状态、一个新列，两条队列都是它俩的组合：

```
候选 = orders.status = 'pending' AND customers.country = 'AU'

Address 队列 = 候选 ∩ address_verified_at IS NULL
Postage 队列 = 候选 ∩ address_verified_at IS NOT NULL
Approve      → status = 'processing'（/fulfillment/export-labels 读的队列）
```

`ALLOCATION_STATUS` / `APPROVED_STATUS` / `ALLOCATION_COUNTRY` 三个常量在 [src/lib/queries/allocation.ts](../src/lib/queries/allocation.ts) 里，别处不重复写字面量。

**`country` 比的是 ISO 代码 `AU` 而不是 `Australia`**：`customers_standardize_address` 已经把它标准化过了（规则 21）。

## 3. 与 xpros 有意不同的六处

### 3.1 批量地址检查是一条 SQL，不是一个后台任务

xpros 的 `batch-address-check` 是 Trigger.dev task，逐单循环、带进度条，因为它**每单查一次** `postcodes` 表。但这件事本质是一个 JOIN。

本项目做成 SQL 函数 `public.verify_pending_order_addresses()`：一条 `UPDATE … WHERE EXISTS (…)` 加一条 `INSERT … SELECT` 写日志，一次往返，队列多大都一样快。Server Action `runAddressCheck()` 只是 `supabase.rpc()` 一下。

这与规则 21 记的 `004` 导入是同一个取舍——那次行级与集合式的差别是 178,024 次触发器触发。

函数是 **SECURITY INVOKER**：RLS 照常生效，`auth.uid()` 是真实操作员，`order_logs` 的 `WITH CHECK (user_id = auth.uid())` 才过得去。

> 副作用：日志写失败会让整个函数回滚，地址也不会被标记。这与规则 24「写日志失败不整体失败」的方向相反，但成立——这里没有任何对外副作用，整件事幂等可重跑，一次响亮的失败比一半状态好。

### 3.2 邮编补零，不是去零

**这是照抄 xpros 会静默坏掉的地方。** xpros 写的是 `LTRIM(customer.postcode, '0')`，因为**它的**参考表丢了前导零（DARWIN 存成 `800`）。go2office 的 `postcodes.postcode` 有 CHECK 强制四位，而客户侧有 1,283 行是正确的 `0800`。

三处必须逐字一致，比较口径是 `lpad(btrim(postcode), 4, '0')` + `upper(btrim(city))` + **等值**：

| 位置 | 形式 |
|---|---|
| `standardize_customer_address`（规则 21） | SQL |
| `verify_pending_order_addresses()`（本次新增） | SQL |
| `normalizePostcode` / `normalizeLocality`（[zone-resolver.ts](../src/lib/shipping/adapters/zone-resolver.ts)） | TS，**被 allocation 直接 import 复用，不再镜像一份** |

写错的表现是：整个北领地的地址永远解析不到、永远堆在人工队列里，**不报任何错**。

`allocationAddressSchema` 保存时也把邮编补到四位，理由相同。

### 3.3 等值比较，不用 `ILIKE`

xpros 是 `locality ILIKE customer.city`，右侧是**模式**不是字面量——city 里有 `%` 就会匹配到别的郊区。远端探测 C 项验证过：suburb 填 `%` 时本实现命中 0 行，ILIKE 会命中 1 行。与规则 21 同一条。

### 3.4 `state` 是只读推导值，表单不接受它

`customers_standardize_address` 在写入时用 `(postcode, suburb)` 重算 state。表单里做成可编辑框，就是一个「你填了、保存时被悄悄改掉」的字段（规则 19 / 21 那类静默改写）。所以 `allocationAddressSchema` **没有** `state`，卡片上是禁用的只读框，旁边写明去哪儿改。

`country` 同理不可编辑：allocation 是 AU-only，改它等于让订单在编辑途中脱离队列。

`address_line3` / `line4` 也不暴露：114,161 行是 `ebay:xxxx` 引用码而不是地址（规则 24），放出来只会诱人把它「修」成真地址。

### 3.5 不自动批准任何订单

xpros 的 `batch-postage-check` 第 4 步有一套阈值规则：报价 ≤ 收到的邮费就自动 `status = Ready`；只有「超收」或「差额小于 20% 且金额 > $13」才落到人工。

**本项目不移植这一段**（决策 5）。批量任务只负责报价，全部订单等人工批准。页面上会用颜色标出 `报价 − 客户已付` 的盈亏，但那是提示，不拦截、不过滤、不预选。

引擎写的 `is_selected` 仍然保留（它是「引擎按平价带 + 承运商优先级选的那个」），在表里显示为 `Engine pick` 徽章，**不会落到 `orders.shipping_method`**。最便宜的那行另标 `Cheapest`——两者经常不是同一行，这本身就是有信息量的。

唯一保留的过滤是 `filterFlatRateGroups`（同一系列只留最小能装下的尺寸）：更大的尺寸必然更贵且必然也装得下，属去冗余不属替人选择。装不下的那些**整组保留**，因为错误原因写在每一行上。

### 3.6 `Approve without a quote` 的方式列表是收窄的

手工批准只能选 `MANUAL_APPROVAL_METHODS`（四个通道的并集），**不是整个 `shipping_method` 枚举**。`Direct_Freight` 与 `Click_and_Collect` 不属于任何标签通道，批到 `processing` 之后会在 `/fulfillment/export-labels` 上永远不出现——订单就这么没了。这正是 `carrier-groups.ts` 底部那个穷尽性检查要防的事（规则 24），单测里锁住了。

## 4. `postage_paid` 与 `postage_and_handling` 不能搞反

| 列 | 含义 | 谁写 |
|---|---|---|
| `orders.postage_and_handling` | **客户付给我们的**运费 | 订单导入 / 订单编辑 |
| `orders.postage_paid` | **我们要付给承运商的**运费 | 本功能的 Approve |

xpros 的两列叫 `postage_received` / `postage_paid`，命名恰好错位，照着改极易写反。写反的后果是 `order_metrics_summary` 的 gross profit 反向偏移，而票面上看不出异常。

Approve 写 `postage_paid` 会触发 `oms_orders_update` 重算该订单的 metrics —— 这是对的，那三列（`postage_and_handling` / `discount` / `postage_paid`）正是触发器筛的列。改 `address_verified_at` 不会触发重算，同一个筛选保证的。

## 5. Approve 的副作用顺序

```
校验报价（属于本单 / 无 error_message / rate > 0）
  → 清 is_selected → 置 is_selected      ← 顺序不可反
  → orders: shipping_method + postage_paid + status = 'processing'
  → order_logs（失败只降级成 warning）
```

- **清了再置**：`order_shipping_quotes_one_selected_idx` 是 `(order_id) WHERE is_selected` 的唯一索引，反过来第二条语句必然撞约束，结果是一条都没选中。
- **`.select("id").maybeSingle()` 读回**：RLS 拒绝 UPDATE 是返回 0 行不是报错（规则 22）。WHERE 里同时带 `status = 'pending'` 与 `address_verified_at IS NOT NULL`，所以「被别人抢先批准了」和「被 RLS 拦了」都落在同一句人话上。
- **日志失败不算失败**：状态已经改了，这时候报「批准失败」会让操作员再批一次。

`Approve without a quote` 走同一个 `moveToProcessing()`，只是先把 `is_selected` 全清掉——手选的方式未必对应任何报价行，与订单详情页手改运送方式时的处理一致（`docs/orders-ui.md` §6.8）。**报价行本身不动**：它记的是当天报了多少（规则 23）。

## 6. 引擎会把订单从队列里拿走

`runQuoteEngine` 在「无任何可用承运商」或「邮政地址超出全部邮政承运商能力」时会**自己**把 `orders.status` 改成 `issued`。allocation 队列筛 `pending`，所以这些订单当场消失。

Task 因此单独统计 `escalatedCount`，页面单独 toast 一条 20 秒的 warning 指向 `/orders` 的 Needs action。不这么做的话，唯一可见的现象是「队列比预期短了几张」。

## 7. Google Places

- 依赖只有 `@vis.gl/react-google-maps`；组件是 [src/components/orders/address-autocomplete.tsx](../src/components/orders/address-autocomplete.tsx)，用 Places API (New) 的 `AutocompleteSuggestion.fetchAutocompleteSuggestions`，限定 `includedRegionCodes: ['au']`。
- `APIProvider` 包在**列表外层一次**，不是每张卡片一个——它加载的是 Maps JS bundle。
- **Places 选完不等于能解析**。它返回的 `locality` 未必在 `public.postcodes` 里，而 `city` 的取值链退到 `sublocality_level_1` / `administrative_area_level_2` 时尤其可疑。卡片因此在 suburb / postcode 失焦时调 `checkAddressResolution()` 复查，并在保存前对未解析的组合弹确认框（规则 9 的全局 `useConfirm`）。**不拦住保存**——操作员说地址对就是对的，但话要说在前面。
- 未解析时若该邮编在参考表里有别的 locality，直接把它们列成可点的按钮。「邮编不存在」和「郊区名对不上」是两种不同的毛病，修法也不同。
- key 未配置时整块搜索框隐藏，其余字段照常可手填 —— 降级成打字，不是变成一个不能用的页面。

### 7.1 这把 key 没有 referrer 限制

2026-08-24 实测：带 `Referer: http://localhost:3000/`、不带 referer、带一个随便编的域名，Places REST 端点**都返回 200**。它是 `NEXT_PUBLIC_` 前缀，已经明文在 xpros 的浏览器 bundle 里。

不影响本功能运行，是一次 Google Cloud console 的操作：给这把 key 加 HTTP referrer 允许列表（`http://localhost:3000/*` + 两个项目的生产域名）与配额上限。**未做。**

### 7.2 确认框必须在 transition 之外 await（2026-08-29 修的一个 bug）

`Save and pass` / `Pass without changes` 初版把 `await confirm(...)` 写在了 `startTransition` 的 async 回调**里面**：

```tsx
startSave(async () => {
  if (!(await confirmUnresolved())) return   // ✗ 死锁
  ...
})
```

`useConfirm` 是靠给 provider 设状态来开对话框的。**React 会把异步 transition 内部的状态更新推迟到该 action 结束之后再提交**，而这个 action 只有在有人点了那个尚未被提交的对话框时才会结束。结果是：对话框永远不出现，按钮永远转圈，除了刷新页面没有出路。

正确写法（也是项目里其余 22 个调用点一直在用的）是先 await、再进 transition：

```tsx
async function onSubmit(values) {
  if (!(await confirmUnresolved())) return   // ✓ transition 之外
  startSave(async () => { ... })
}
```

**只有解析不出地址的卡片会触发**——`resolution.resolved` 为 true 时 `confirmUnresolved()` 直接返回、根本不碰状态。所以这个 bug 在能正常解析的订单上完全看不出来，正是模拟数据里那两张（Gordon 2905 / Whitlam 2611）把它暴露的。

## 8. 落地清单

| 产物 | 位置 |
|---|---|
| 迁移 + SQL 函数 | `supabase/migrations/20260824100000_add_order_address_verification.sql` |
| 类型 | `src/lib/supabase/database.types.ts`（手工补两列 + 一个 Function，规则 18） |
| 查询层 | [src/lib/queries/allocation.ts](../src/lib/queries/allocation.ts) |
| 校验 | [src/lib/validations/allocation.ts](../src/lib/validations/allocation.ts) |
| Server Actions | [src/lib/actions/allocation.ts](../src/lib/actions/allocation.ts) |
| Task | [src/trigger/batch-postage-check.ts](../src/trigger/batch-postage-check.ts) |
| 轮询（共享） | [src/lib/trigger/run-status.ts](../src/lib/trigger/run-status.ts) · [src/hooks/use-batch-run-poll.ts](../src/hooks/use-batch-run-poll.ts) |
| 地址联想 | [src/components/orders/address-autocomplete.tsx](../src/components/orders/address-autocomplete.tsx) |
| 页面 | `src/app/(dashboard)/fulfillment/allocation/{page,address/page,postage/page}.tsx` |
| 组件 | 同目录 `_components/`：`address-stage-client` · `address-order-card` · `postage-stage-client` · `manual-approval-dialog` |
| 单测 | `src/lib/validations/__tests__/allocation.test.ts`（23 条） |

**顺带的重构**：`/fulfillment/export-labels` 的 Aramex 轮询原本是页面内手写的，已改为共用 `useBatchRunPoll` + `snapshotOf`。状态分类那段（`LIVE_STATUSES` 与编译期穷尽性检查）现在只有一份。

## 9. 远端验证

### 9.1 行为探测（2026-08-24）

用 `SET LOCAL ROLE authenticated` + 注入 `request.jwt.claims` 打真实 RLS，全部在事务里跑完回滚。这是规则 22 说的唯一可靠验证方式——查 `information_schema` 看不出真实效果。

| 项 | 断言 | 结果 |
|---|---|---|
| 基线 | 函数以 `authenticated` 跑通，`order_logs` 落一行且 `user_id` 是操作员 | ✅ moved 1 |
| A | 郊区改成不存在的值 → 不被标记 | ✅ moved 0 |
| B | 邮编 `800` + `DARWIN` → 仍被标记（补零生效） | ✅ moved 1 |
| C | 郊区填 `%` → 不被标记（等值而非 ILIKE） | ✅ moved 0 |
| D | `authenticated` 能执行 Approve 那条 UPDATE | ✅ 1 行 |
| E | `country = 'NZ'` → 不被标记 | ✅ moved 0 |

### 9.2 首次真实跑批（2026-08-29）

对象是订单 **205977**（invoice `26032497@1`，之前测试造的空跟进单：无交易行、重量 0、尺寸 null）。按用户决定**只跑到报价为止，不批准**。

三步都是真实提交的：

1. `verify_pending_order_addresses()` 以 `authenticated` 身份执行 → 该单进 Postage 队列，`order_logs` 落一行。
2. `npx trigger.dev deploy` → staging `v20260829.1`，3 个 Task。**这一步是必须的**，见 §10。
3. `batch-postage-check` run `run_06g4nl4ofqpvgr0opevq0ue401`，12 秒完成。

```json
{ "processed": 1, "quotedCount": 1, "unpricedCount": 0, "escalatedCount": 0, "failures": [] }
```

`metadata.progress` 上报了 `{current: 1, total: 1}`，页面进度条的数据源没问题。

落库 9 行报价、零错误行、1 行 `is_selected`：

| 承运商 | 方式 | 分区 | 价 |
|---|---|---|---:|
| reg_letter | Register_Letter | — | **$5.00**（选中） |
| mypost | Mypost_Regular / Mypost_Reg_Xs_Satchel | Zone_3 | $9.69 |
| eparcel | Eparcel_Regular | Near State Remote | $9.83 |
| mypost | Mypost_Reg_S_Box | Zone_3 | $11.12 |
| mypost | Mypost_Express / Mypost_Exp_Xs_Satchel | Zone_3 | $12.54 |
| eparcel | Eparcel_Express | Near State Remote | $13.33 |
| mypost | Mypost_Exp_S_Box | Zone_3 | $14.44 |

三件事在真实数据上得到验证：

- **`orders.shipping_method` 仍是 `null`，状态仍是 `pending`，`postage_paid` 仍是 0** —— 决策 5 的核心：引擎选中只是建议，不自动落到订单上，也没有任何订单被自动批准。
- **`filterFlatRateGroups` 在起作用**：袋子组只留了 Xs、箱子组只留了 S，而不是把 S/M/L/XL 全列出来。
- **Aramex 两项缺席是正确的，不是故障**：该客户地址是 `PO Box 1726`，`postalDelivery: false` 让它们在 `canQuote` 阶段就被剔除，与 `docs/shipping-quote-engine.md` §0.4 里 205975 那次同一形态。（这张单的 `address_line3` 恰好是 `ebay:zsqywfc`，规则 24 那个引用码问题的活样本。）

订单**现在就停在 Postage 队列里、带着这 9 行报价**，等着在浏览器里被点一次 Approve —— 那正是最需要人工验的一步。

## 10. 未验证 / 未决

| 项 | 说明 |
|---|---|
| **浏览器交互** | 三个页面都没人工点过。移动端 + 桌面端各一遍（规则 12） |
| **Places 实际联想** | key 与端点验证过，但组件在浏览器里没跑过 |
| ~~**`batch-postage-check` 实跑**~~ | **2026-08-29 跑通**，见 §9.2 |
| **新 Task 必须先 deploy** | `trigger.dev dev` 在 staging key 下**不接管 run**——2026-08-29 实测两次触发都停在 `PENDING_VERSION`，直到 `deploy` 之后才跑起来。详见 [current_tasks.md](current_tasks.md) 表头。**环境变量不是障碍，早就配好了** |
| **Places key 的 referrer 限制** | 见 §7.1，未做 |
| **上游没有订单来源** | 全库 `pending` 只有 1 张。真正的入口是 eBay / Shopify 订单同步（`docs/orders-ui.md` §13 列为上线前硬阻塞），尚未开工。在那之前这个功能基本空转 |
| **地址改动不会撤销已有的验证** | 客户地址是共享的，某张订单验证过之后客户地址又被改动，`address_verified_at` 不会重置。已知，接受 |
