# Dashboard（`/`）

首页回答两个问题：**今天有哪些活、卡在哪一步**；**生意走势如何**。全部只读，不写库。

## 1. 结构

| 区块 | 数据来源 | 渲染 |
|---|---|---|
| Work queues | `fetchAllocationQueueStat`（Address / Postage）、`orders` 按状态计数 + 最老一张 | 首屏同步 |
| Health | `buildAlerts()`（`src/lib/dashboard/alerts.ts`），输入见下 | 首屏同步 |
| Sales（KPI + 两张图） | `dashboard_sales_series()` | Suspense 流式 |
| Running low | `dashboard_low_stock()` | Suspense 流式 |
| Recent activity | `order_logs` 最近 15 条 | 首屏同步 |

查询汇总在 `src/lib/queries/dashboard.ts`，KPI/图表的整形是纯函数 `src/lib/dashboard/sales.ts`，两者都有单测。

## 2. Health 告警口径

- **eBay 授权**：复用 `fetchEbayAuthorization`，blocked 为红、快到期为黄。
- **导出被拦**：`requireFallbacks()` 报错即红（规则 24）。
- **回写失败**：`platform_fulfillment_syncs.status = 'failed'`。**回写滞留**：`pending` 超过 1 小时——sweep 每 15 分钟一次，说明它没在跑。
- **processing 无通道**：processing 总数 − 四个通道之和。典型来源是 `shipping_method` 为空、只有 `legacy_shipping_method` 的同步订单，它们**永远不会出现在 Export Labels 上**。
- **非 AU pending**：pending 总数 − Address − Postage。
- **未解析明细**：pending / processing / labelled 订单里 `unresolved_item_count > 0`。
- **待复测商品**（黄，2026-11-18）：`products.remeasure_requested_at` 非空的数量，链到 `/products?remeasure=1`。在 Postage 弹窗的 Edit weight & size 或商品详情页用 `Flag for re-measure` 标记；重量或长宽高实际改动时由触发器 `products_remeasure_clear` 自动清除，不拦任何订单。见 CLAUDE.md 规则 19。
- 任一查询失败会出红色告警，**不会显示成全绿**。

## 3. 销售口径

- 时间一律按 **Australia/Sydney** 分桶；订单按 `created_at`，发货按 `posted_on_date`；排除 `cancelled`。
- Sales = `order_metrics_summary.order_total`（goods + postage_and_handling − discount）。
- **不显示毛利**（2026-11-18 决定）：所有订单 `postage_paid = 0`，毛利率会虚显约 75%。等新系统积累真实运费后再加，届时只统计 `postage_paid > 0` 的订单。

## 4. 库存提醒口径

按销速而不是固定阈值（2026-11-18 决定）：近 30 天卖出过、`on_hand / (30 天销量 / 30) < 14` 的在售非套装商品。销量取自 `order_items`（套装已展开为组件，与库存扣减一致）。830 个在售商品库存为 0 但多年未卖，固定阈值会被它们淹没。

## 5. 图表配色

不用主题的 `--chart-*`（浅色是粉彩、深色是灰阶）。`_components/chart-palette.ts` 里的颜色经 dataviz 校验器验证过浅、深两套；平台颜色固定跟随平台。浅色模式下有两色对卡片底色对比度 < 3:1，所以图例必须带各系列的合计数字，**不可删**。
