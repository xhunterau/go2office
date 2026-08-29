# 出货标签与承运商导出（Export Labels）

从 xpros 移植「订单导出各承运商 CSV / Aramex API 下单 / 自印 PDF 面单」三块能力。

| | |
|---|---|
| 源实现 | xpros 的 `src/app/fulfillment/export-labels/*`、`src/lib/{mypost,eparcel,direct-freight}-csv.ts`、`src/lib/aramex-*.ts`、`src/app/api/print/shipping-label/route.ts` |
| 落地对象 | 1 个迁移 + `src/lib/fulfillment/*` + `src/lib/print/*` + `src/lib/aramex/consignment.ts` + 1 个 Trigger Task + `/fulfillment/export-labels` + `/api/print/shipping-label`（+ 2026-08-23 追加 `/api/print/invoice`） |
| 迁移文件 | `20260823100000_add_dispatch_sender_settings.sql`（**已推送远端**） |
| 状态 | **代码完成 2026-08-23，`npm test` 261 passed / `tsc` / `eslint` / `next build` 均通过；浏览器交互与 Aramex 真实下单未验证**（见 §6） |

---

## 1. 决策基线（2026-08-23 用户确认）

| # | 决策 | 后果 |
|---|---|---|
| 1 | **拣货分区不做** | xpros 每张 CSV 的 ref 是 `job_id[picking_zone]`，每单一次 `calculate_picking_zone` RPC。go2office 没有 `picking_zones` 表，也不建——整个 N+1 消失 |
| 2 | **参考号复用 `invoice_number`** | 不新增 `orders.job_id` |
| 3 | **`processing` 就是 xpros 的 `Ready`** | 出标签后进 `labelled` |
| 4 | **eParcel charge code：Regular `3D55` / Express `3J55`** | 无 Z6 账号，国际件的 code 未知 |
| 5 | **Direct Freight 不做** | 全库 0 单 |
| 6 | **Click & Collect 不做** | xpros 那块含合单与库存充足度判断，约 400 行 |
| 7 | **自印面单覆盖** `Letter` / `Register_Letter` / `Parcel_Post` / `Express_Post` / `Store_Delivery` | |
| 8 | **澳邮发件人** `Go2buy Australia / Parcel Locker 10147 39821 / 1-7 Venture Way / Braeside VIC 3195` | 进 `shipping_settings`，不硬编码 |
| 9 | **Aramex 的 135 Woodlands Drive 不进代码** | Aramex 的 consignment 请求体没有 From 字段，取件地址在账号上 |

---

## 2. 三个通道

| 通道 | shipping_method | 产物 | 入口 |
|---|---|---|---|
| 自印面单 | `SELF_PRINT_METHODS`（5 个） | A6 PDF，一页一张 | `markSelfPrintLabelsPrinted()` → `/api/print/shipping-label?ids=` |
| MyPost Business | `MYPOST_METHODS`（22 个） | 23 列 CSV | `exportMyPostCsv()` |
| eParcel | `EPARCEL_METHODS`（2 个） | 25 列 CSV + 一行 MANDATORY 注释行 | `exportEParcelCsv()` |
| Aramex | `ARAMEX_METHODS`（2 个） | API 下单，无文件 | `triggerAramexBatch()` → `submit-aramex-batch` Task |

两个 `shipping_method` 不属于任何通道，理由写在 [carrier-groups.ts](../src/lib/fulfillment/carrier-groups.ts) 的 `UNROUTED_METHODS`：`Direct_Freight`（决策 5）、`Click_and_Collect`（决策 6）。

**该文件底部有一处编译期穷尽性检查**：往 `shipping_method` 枚举加值而不决定它归哪个通道，`Unrouted` 会变成一个真实联合类型，那一行随即无法编译并把该值名字打进错误信息。xpros 把这些清单分散在各个 action 里、彼此没有关系，所以一个没被任何清单收录的 method 只是从页面上消失，**没有任何提示**。

## 3. 与 xpros 有意不同的八处

这些是移植的主要内容，每一条对应一个「照搬就会静默出错」的点。

### 3.1 地址行按内容过滤，只取真实地址

`customers.address_line3` 非空的 114,193 行里有 **114,161 行是 `ebay:xxxx`**（99.97%），`address_line4` 全库仅 9 行非空。xpros 的三条路径（MyPost / eParcel / Aramex mapper）都无条件拼接 line1–line4，照搬就是**把 eBay 引用码印到快递面单上**。

[`usableAddressLines()`](../src/lib/fulfillment/csv.ts) 按内容判断（`isReferenceCode`）而不是整列丢弃 line3——这样那 32 行真实的第三行地址仍然用得上，line4 的 9 行也按同一规则处理。CSV、PDF、Aramex 三条路径共用它。

### 3.2 截断规则重写

xpros 有两个互不兼容的版本：MyPost 版溢出时把原 line2/line3 挤压合并进 line3，eParcel 版溢出时**直接丢掉 line4**。经 3.1 过滤后 go2office 通常只剩两行真实地址，「牺牲哪一行」不该取决于在导出哪家承运商。

[`fitAddressLines(lines, slotCount, maxLength)`](../src/lib/fulfillment/csv.ts) 统一装槽：在词边界切分、溢出推进下一槽、槽用完时**返回 `overflow: true` 而不是吞掉**。调用方把受影响的 invoice 收集起来，导出后用 toast 报出来。

`address_line1` 超 40 字符的全库有 363 行（0.2%），不常见但不是理论问题。

### 3.3 映射表缺键抛错，不兜底

| 位置 | xpros | 本项目 |
|---|---|---|
| `mapPackagingType` | `?? 'OWN_PACKAGING'` | 抛 `UnmappableOrderError`，消息带 invoice |
| `mapChargeCode` | `?? '3D55'` | 同上 |

兜底会把澳邮自有箱按自备包装下单并据此计价；charge code 同理，会把快递件按普邮 code 计费——**承运商照样受理，没有任何东西会暴露它**。

两张表现在都是满的（`PACKAGING_CODES` 覆盖 `MYPOST_METHODS` 全部 20 项，`CHARGE_CODES` 覆盖 `EPARCEL_METHODS` 全部 2 项），所以键类型收窄到了各自的通道清单——**新增一个 MyPost / eParcel 方法却没配代码是编译错误**，与 `carrier-groups.ts` 底部的穷尽性检查同一路数。运行时的抛错保留，管的是通道之外的方法。

> 曾经留空的两组键（`Mypost_*_Xs_Box` 的包装代码、`Eparcel_Intl_Express` 的 charge code）已随迁移 `20260823110000` 从枚举里删除：澳邮根本没有 XS 纸箱，go2office 也没有国际 eParcel 合约。

### 3.4 `formatPhone` 认国家

xpros 无条件加 `+61`，海外客户会拿到一个用他们自己号码拼出来的、看起来很像澳洲号的号码。本版只在 country 是合法 ISO 两字母码且不等于 `AU` 时判为国际件（该列合法地存着电话号码和送货备注，见规则 21，所以脏值按澳洲处理）。

### 3.5 兜底联系方式是配置，且空值会拦住导出

xpros 硬编码 `admin@xhunter.com.au` / `+61431950696`。本版是 `shipping_settings.fallback_email` / `fallback_phone`，**默认空字符串**，`requireFallbacks()` 在空值时返回一句指向 `/settings/shipping/constants` 的错误。

理由：这两个值会被印在**别人的**包裹上。宁可导出跑不起来，也不能凭空编一个。

已于 2026-08-23 配置为 `admin@go2buy.com.au` / `0450952227`。兜底号码**和其他号码走同一条归一化**（`normaliseFallbackPhone`），所以设置页填本地格式也会以 `+61450952227` 进 CSV——否则那一行会是几百个 `+61...` 里唯一的本地格式。无法识别为电话号码的值原样透传，好让它在导出里被看见而不是被吞掉。

### 3.6 Aramex 的运单号写回订单

xpros 拿到后只改状态、写日志，**不落库**，事后无法把订单和运单对上。本版写进 `orders.tracking_number`。

**2026-08-23 修正——字段名是 `conId`，不是 `consignmentId`。** 首次真实下单（staging run `run_06g2po1ihq6ev6hld2l8rhdv01`）返回 `consignmentIds: [null]`，订单 205971 的 `tracking_number` 被写成字符串 `"undefined"`。原因是本项目照抄了 xpros 的 `response.data.consignmentId`，而线上 API **不发这个键**——xpros 拿到 id 后直接丢掉，所以它那边永远不会暴露。

对着线上 `GET /api/consignments/{conId}` 核实的真实结构：

| 字段 | 例值 | 用途 |
|---|---|---|
| `data.conId` | `171295222` | Aramex 内部运单 id，**客户拿它查不到件** |
| `data.items[].label` | `MS0020719756` | 面单上的可追踪号，**这才是 tracking number** |

[`readConsignmentIds()`](../src/lib/aramex/consignment.ts) 因此按 `items[0].label` → `conId` → xpros 的 `consignmentId` 三级取值。**取不到时返回 null 而不是占位值**——`String(undefined)` 正是那行脏数据的来源，`tracking_number` 宁可留空。这类订单进 task 结果的 `untracked`，页面单独 toast 提示去 Aramex 后台补录，**不算失败**（包裹已经交运，报失败会诱发重复下单）。

经 `normalize_tracking_number` 触发器安全（规则 20）：`MS…` 开头匹配不到任何前缀规则，纯数字的 `conId` 也不进 MyPost 分支（那要求同时以 `99` 开头**且**长度 > 23）。

> 205971 的运单号已在 2026-08-23 清成 NULL 并在 `order_logs` 留了说明。列表接口 `GET /api/consignments` 翻不到这张（最新一页停在 08-21），只能到 Aramex 后台按收件人 Tony Clark / Grovedale VIC 3216 找回。

### 3.6b 批次状态靠轮询，不靠 realtime 订阅

Aramex 批次是唯一的异步通道，页面要知道它什么时候结束。初版用 `useRealtimeRun` 订阅 + `auth.createPublicToken`，**2026-08-23 实测失效**：run 在 staging 正常 COMPLETED（4.5 秒执行，前面 21 秒冷启动），浏览器却没收到终态，spinner 一直转，而四张卡片都因 `busy != null` 被禁用——除了刷新页面没有出路。

改成页面每 2 秒调一次 [`getAramexBatchStatus()`](../src/lib/actions/fulfillment.ts)（`runs.retrieve`）。理由：**自己发的请求要么有答案要么明确失败；而一条哑掉的订阅和「还在跑」长得一模一样**。订单详情页的报价面板本来就是这么轮询的。三层保护：

1. **终态判定改为「不在进行中集合里就是结束」**。原来的写法是「等于 COMPLETED，或落在一个手写的失败集合里」，而那个集合漏了 `EXPIRED`、还带着 v4 根本不存在的 `INTERRUPTED`。现在 `LIVE_STATUSES` 只列 6 个进行中状态，其余一律释放页面；`UnclassifiedStatus` 那行编译期检查保证 SDK 新增状态时必须表态（与 `carrier-groups.ts` 底部同一路数）。
2. **8 分钟硬超时**（task 的 `maxDuration` 是 300 秒，冷启动实测 21 秒），超时后释放页面并提示刷新。
3. **`Stop waiting` 按钮**，任何时候能手动脱困。

三层都不依赖对方成立。公开 token 随之取消——状态不再经浏览器直连 Trigger.dev。

### 3.7 导出的顺序：先出文件，再改状态

xpros 先 `update` 状态再返回 CSV，且把写日志失败当作整体错误返回——于是可能出现「订单已经改成 Label、操作员手上什么都没有」。

本版顺序是：读队列 → 构建 CSV（映射失败在此中断，零副作用）→ 改状态 → 写日志。且：

- 改状态用 `.select("id")` 读回并**比对行数**。RLS 拒绝 UPDATE 的方式是返回 0 行而不是报错（规则 22），不读回就会把一次被拦下的写入 toast 成成功；比对行数还能抓到读写之间状态被别人改掉的订单。
- 写日志失败**不**让整个调用失败，改为附带 warning 返回。此时状态已经改了，告诉操作员「导出失败」是两个错误答案里更糟的那个。

### 3.8 打印路由要求登录

xpros 的 `/api/print/shipping-label` 用 service role 直连、**没有任何鉴权**，任何人猜到订单 id 就能读到客户地址。本版用请求自己的 Supabase 客户端，会话必需且 RLS 仍然生效，另加 250 张的单次上限。

**`/api/print/invoice`（2026-08-23 新增）与它同构**，同样的鉴权、同样的 250 张上限、同样的 `parseOrderIds` + `bwip-js` 条码 + `@react-pdf/renderer`。入口在订单详情页的 `⋯` 菜单，批量入口暂时没有。抬头的法人名 / ABN / 银行信息写死在 `src/lib/print/company.ts`，通信地址仍读 `shipping_settings.sender_*`——同一个地址已经印在包裹上，抄第二份就要同步两处。设计细节（含"GST 是总额的十一分之一"和"只标未付不标已付"两个反直觉点）见 `docs/orders-ui.md` §6.8.3。**不做 packing slip**（用户决定）。

### 3.9 面单的邮资标记按 method 区分

xpros 无条件印 `POSTAGE PAID AUSTRALIA`，因为它的自印组里没有非邮政方式。go2office 的 `Store_Delivery` 在组内（决策 7），给它印邮资已付标记是一个**不成立的邮政标记**，所以改为 `STORE DELIVERY`。

---

## 4. 数据依赖

| 来源 | 用途 |
|---|---|
| `orders.status = 'processing'` + `shipping_method` | 队列 |
| `orders.invoice_number` | 全部三种格式的参考号、PDF 条码内容 |
| `customers.*` | 收件人。`state` / `country` 已被 `customers_standardize_address` 触发器标准化（规则 21） |
| `order_metrics_summary` | 重量与尺寸。**没有对应行的订单会让导出报错**，不猜一个重量 |

尺寸取 `dominant_*` 而不是 `packed_*`：报价适配器有意用悲观的装箱估算让价格偏高，而下单该申报实际装进箱子的东西。xpros 也是这么分的，[aramex.adapter.ts](../src/lib/shipping/adapters/aramex.adapter.ts) 里那条注释指的就是这件事。

MyPost 的尺寸只有 `Mypost_Regular` / `Mypost_Express`（自备包装）用真实值，其余走 12cm 填充——澳邮自有包装的尺寸由 packaging code 决定，该列必填但被忽略。

## 5. 迁移 `20260823100000`

给 `shipping_settings`（单行表，`CHECK (id = 1)`）加 8 列：发件人 6 列 + 兜底 2 列，并加 `shipping_settings_sender_present` CHECK 保证发件人除第二行外都非空。

该表在 `20260812100000` 已有**表级** UPDATE 策略，且从未被列级 `REVOKE` 收窄过，所以新列一存在就能从 `/settings/shipping/constants` 写。**没有加 GRANT**——按规则 22，加了也挡不住任何东西。

## 6. 未验证 / 未决

| 项 | 说明 |
|---|---|
| **浏览器交互** | CSV 下载、PDF 打印视图、四张卡片的进度条仍需人工点一遍（移动端 + 桌面端，规则 12）。Aramex 卡片已于 2026-08-23 真实跑过一次 |
| **Aramex 真实下单** | 会产生真实费用，需在有真实待发订单时验证。当前队列里 1 张 `Aramex_Satchel` |
| ~~**Trigger.dev 部署环境变量**~~ | **2026-08-29 更正：已配置。** 08-23 那次真实下单就是跑在 staging 部署版 `v20260823.1` 上的——缺任何一个变量它都会立刻抛错 |
| **自印面单是否还要加别的 method** | 用户在选择时另选了「Other」但未填写内容，当前按上述 5 个实现 |
