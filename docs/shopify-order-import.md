# Shopify 订单导入

把 go2buy-australia 店里所有未发货订单拉进 go2office，作为 `pending` 进入 Order Allocation。入口是 `/orders` 页头的 **Import from Shopify**。Task 说明见 [current_tasks.md](current_tasks.md#import-shopify-orders)。

移植自 xpros 的 `src/trigger/import-shopify-orders.ts` + `src/lib/shopify-client.ts`。下文 §2 列出所有**有意不照搬**的地方——每一处照搬都不会报错，只会静默写错数据。

---

## 1. 凭证（Dev Dashboard + client credentials）

- app：Shopify 后台 → View Dev Dashboard → `go2office order import`（organization：Go2buy Australia，与店铺同属一个组织，这是 client credentials 能用的前提，否则换 token 报 `shop_not_permitted`）
- 已发布版本 `go2office-order-import-1`，scope：`read_orders, write_products, write_inventory, read_locations, write_merchant_managed_fulfillment_orders`。写权限是为以后的价格库存同步和回填运单号预留的；**导入只用 `shopifyQuery`（只读）**
- 客户信息（姓名、地址、电话、邮箱）属于 protected customer data，2026-11-11 实测能读到
- **没有可复制的 access token**。`src/lib/shopify/client.ts` 每次用 `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` 向 `/admin/oauth/access_token` 换（form-urlencoded，`grant_type=client_credentials`），有效期 86399 秒，提前 5 分钟视为过期并重换。只有 rotate secret 或重建 app 时才需要改环境变量
- `SHOPIFY_STORE_DOMAIN` 必须是 `go2buy-australia.myshopify.com`。填 `go2buy.com.au` 时，客户端会直接拒绝

### WSL 下 Node 连不上 Shopify

本机 curl 0.19 秒就能连上，Node 却报 `ETIMEDOUT`：Node 的 IPv4/IPv6 自动选择（happy eyeballs）给每次尝试的时间太短。本地跑必须加 `--no-network-family-autoselection`，`npm run trigger:dev` 已经带上。Trigger.dev 云端不受影响。

---

## 2. 与 xpros 的差异

| | xpros | go2office | 照搬的后果 |
|---|---|---|---|
| 发票号 | 年份 + **十进制** id | 年份（Australia/Sydney）+ **6 位大写十六进制** id，`205969 → 26032491`。Laravel 的规则，2018–2026 年抽查 6 个 id 全部吻合 | 新单与 20 万张历史单格式不同 |
| 去重键 | 交易行 `web_order_id = order.name` | `order_transactions.order_id_ebay` = Shopify 数字订单 id（`legacyResourceId`），并限定 `orders.platform = 'shopify'`（eBay 单的这一列是 eBay 订单号） | 永远查不到，每次重导一遍 |
| 去重索引 | — | 新建 `order_transactions_order_id_ebay_idx` | 每张单扫 25 万行 |
| 原子性 | 建单、补发票号、逐行插明细、逐行写日志，各是独立请求 | 一个 SQL 函数、一个事务 | 中途失败留下没有明细的空单，下次又建一张 |
| 行级 id | 不存 | `transaction_id_ebay` = line item gid 的数字尾巴（`LineItem` 没有 `legacyResourceId`，API 直接报错） | 与历史数据对不上 |
| 销售日期 | `now()` | Shopify 的 `createdAt` / `processedAt` | 销售日期全部变成导入当天 |
| 数量 | `quantity` | `currentQuantity`，为 0 的行丢掉 | 被编辑掉的商品照发；0 撞 `quantity > 0` CHECK，整单失败 |
| 行数 | `lineItems(first: 50)`，超出静默截断 | 取 100 行，超出直接拒绝该单 | 发出去的单少了东西 |
| 已取消 / 测试单 | 照导 | 忽略 | `fulfillment_status:unshipped` 会把已取消但未发货的单也搜出来 |
| 自提（PICK_UP） | 直接设为 Ready + Click_and_Collect | 不处理（go2office 没有 Click & Collect，用户决策） | — |
| 客户默认地址兜底 | 收货地址为空时读 `customer.defaultAddress` | 去掉。要发货的单一定有收货地址；没有就报失败 | 多要一个 `read_customers` 权限 |
| SDK / 进度 | `@trigger.dev/sdk/v3` + `useRealtimeRun` | 包根 + 轮询 | realtime 收不到终态，页面永久卡住（规则 24） |

**SKU 原样保留**（只 trim）。`GB01448AF|FG` 这种是真实 SKU：`products` 里有 1,096 个，分属 129 个主 SKU，主 SKU 本身也各是一行商品。数据库里**没有**主商品和变体的关系表，关系只存在于 SKU 字符串里（另有 391 个 `_后缀` 写法混在同样的主 SKU 下）。

---

## 3. 客户匹配与合并（用户决策，2026-11-11）

- **同一客户** = 姓名、地址第一行、邮编三项都相同（去首尾空格、忽略大小写，邮编两侧补零到 4 位，与规则 21 同口径）。任一项为空就不匹配，直接新建客户
- `customers` 一行只存一个地址，所以「匹配到同一客户」就等于「同一收货地址」
- 匹配到的客户如果有 **`pending` 的 Shopify 订单**，新明细就并进去：
  - `postage_and_handling` 与 `discount` 累加，Shopify 的 note 追加到 `comments`
  - **`address_verified_at` / `_by` 清空**：订单退回 Address 队列，重新走 allocation
  - **删除该单全部 `order_shipping_quotes`**：报价是按旧箱子报的
  - 写一条 `order_logs`，结果里列出被合并的订单号
- 不合并进 `processing` / `labelled`：那些已经按报价批过运费或出过标签了
- Shopify 订单按 `createdAt` 升序处理，同一客户连下两单时，先下的建单、后下的合并

---

## 4. 字段映射

| go2office | Shopify |
|---|---|
| `orders.web_order_id`、`order_transactions.order_id_ebay` | `legacyResourceId`（`7930453721225`） |
| `order_transactions.sales_record_number` | `name`（`#G2B24707`） |
| `order_transactions.transaction_id_ebay` | line item `id` 的数字尾巴 |
| `order_transactions.custom_label` | `sku`，trim |
| `order_transactions.item_title` | line item `name` |
| `order_transactions.sale_price` | `originalUnitPriceSet`（单价；订单级折扣进 `orders.discount`） |
| `order_transactions.postage_service` | `shippingLine.title` 含 EXPRESS → `Express`，其余一律 `Standard`（店里同一天会出现 `Standard` 和 `Rate Table` 两种标题；历史 25,567 行全是 `Standard`） |
| `orders.postage_and_handling` | `totalShippingPriceSet` |
| `orders.comments` | `note` |
| `customers.*` | `shippingAddress`；电话缺失时用订单的 `phone`；`state` 用 `provinceCode`，`country` 用 `countryCodeV2`（两者都会被地址触发器再标准化一次） |

---

## 5. ⚠️ 首次对生产库导入前：Laravel 最终切换

`go2_*` 临时表仍在，说明 [orders-domain-migration.md §9](orders-domain-migration.md) 的最终切换还没做。`004` 对 `customers` / `orders` / `order_transactions` / `order_items` 都是 `ON CONFLICT (id) DO UPDATE`，由此有两个风险：

1. **id 冲突**：go2office 新建的订单从 `orders_id_seq` 取号（当前 205978 起）。如果 Laravel 的最终备份里也有这个 id 段的订单，`004` 会把 go2office 导入的 Shopify 单**静默覆盖**成 Laravel 的那张。客户和明细同理。
2. **重复**：同一张 Shopify 单，如果 go2office 和 Laravel 都导过，`004` 不会去重，切换后会出现两张。

在确认 Laravel 已不再产生新订单、或者已决定好处理方式之前，**不要在生产库上点 Import from Shopify**。

---

## 6. 验证

- 单测：`npx vitest run src/lib/shopify`（mapper 15 条 + `ordersFilter` 4 条） · `src/lib/validations/__tests__/debug-setting.test.ts`（6 条）
- 函数：2026-11-11 在事务内建函数并跑 7 个场景后 ROLLBACK，覆盖新建、重复、合并（大小写与空格不同）、地址不同不合并、Laravel 已导入的单、`authenticated` 被拒、无明细整单回滚
- 端到端干跑：真实拉取 + 函数调用 + ROLLBACK，结果见 current_tasks.md

---

## 7. 调试模式：只导指定的一张单（2026-11-14）

移植自 xpros 的 `debug_settings` 表 + `/admin/debug-console`。入口是 **Settings → Debug**（`/settings/debug`），开关键为 `shopify_import_test_order`。

- **打开 + 填单号 + Save** 后，`/orders` 的 Import from Shopify 只拉这一张：按钮下方出现 `Debug: only #G2B24707` 徽章，确认框标题变成 `Debug import: only …`，结果框里也会写明。**用完要关**，否则以后每次导入都只拉一张，看上去就像店里没有新单
- **单号两种写法都认**：`#G2B24707` / `G2B24707` 按 `name:` 查；≥10 位纯数字（`7930453721225`，即 `orders.web_order_id` 里存的值）按 `id:` 查。xpros 的开关说明写的是填 legacyResourceId，代码却拿它去查 `name:`，照说明填就什么都查不到、也不报错——这里修掉了
- **会绕过「未发货」过滤**，所以已发货的单也能拉下来；已取消单与测试单照样忽略。**去重照常生效**：已经在库里的单只会被计为 duplicate，要重测同一张得先删掉库里那张。**合并规则也照常生效**
- 这就是 §5 所说「首次对生产库导入」最稳妥的方式：先单张试
- 开关在 Server Action **触发那一刻**重新读取，不信任页面上的徽章（可能是几分钟前渲染的）。两者不一致时弹 warning 并刷新页面。**读开关失败就不触发**——「关」意味着全量导入，不能把读不到当成关

### 表结构与权限（迁移 `20261114100000`）

`debug_settings(key PK, value, enabled, description, updated_by, updated_at)`，与 xpros 同构。go2office 没有 admin 角色，**任何登录用户都能改**。RLS 按规则 22 收窄：

- 无 INSERT / DELETE 策略：**新开关只能由迁移加**
- `REVOKE UPDATE` 再 `GRANT UPDATE (value, enabled, updated_by)`：key 与 description 改不了
- `WITH CHECK (updated_by = auth.uid())`：「最后修改人」冒充不了别人

**新增开关要同时改两处**：迁移插一行，[src/lib/debug/settings.ts](../src/lib/debug/settings.ts) 的 `DEBUG_SETTINGS` 加一项（标签、占位符、值校验）。只有行没有注册项的，页面显示为「No code reads this setting」且不可编辑；只有注册项没有行的，该开关永远是关的。

开着却没填值的保存会被 zod 拒绝（两侧都校验，单测 `src/lib/validations/__tests__/debug-setting.test.ts`）：否则页面显示调试中，导入却按全量走。
