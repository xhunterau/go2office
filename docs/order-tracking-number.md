# 运单号归一化（normalize_tracking_number）

把条码枪扫出来的 GS1-128 全串还原成承运商的 article ID。

| | |
|---|---|
| 源实现 | `xpros` 的 `fn_sales_order_preprocessing()` 模块 2（其前身是 `fn_clean_tracking_number`） |
| 落地对象 | `public.normalize_tracking_number(text)` + `orders_normalize_tracking_insert` / `_update` 两个触发器 |
| 迁移文件 | `20260808210000_normalize_order_tracking_number.sql` |
| 实测回填 | 198,391 个非空运单号中修正 **27,686** 个（14%），79 个空串归一为 NULL |

---

## 1. 问题是什么

仓库用条码枪扫承运商面单。澳邮面单上可扫的是 GS1-128 条码，里面装的是整条数据串，而不是人眼在面单上读到的那个运单号：

```
01 99312650999998 91 33GLH0018038 010009308 08
^^ ^^^^^^^^^^^^^^ ^^ ^^^^^^^^^^^^
|  |              |  article ID —— 唯一有用的部分
|  |              AI(91)，企业内部字段
|  我们的 GTIN-14
AI(01)
```

于是 `orders.tracking_number` 里存的是 41 / 56 / 64 / 74 甚至 117 字符的长串：**承运商官网不认，订单页上人也读不出来**。写这份文档时 198,391 个非空值里有 27,709 个是这个状态。

还有更糟的一类：**479 行被扫了两次**，一个干净的 article ID 后面直接粘了一整条条码串。

## 2. 为什么没有照抄 xpros 的规则表

xpros 的实现是一串 `CASE`，靠硬编码子串（`S8P` / `33RCA` / `34HA9` / `34HAA`）和 `shipping_method` 分支。**机制值得抄（BEFORE 触发器），规则一条都用不了**：

| xpros 规则 | 在 go2office 的实测命中 |
|---|---|
| `33RCA` / `34HA9` / `34HAA` → 取 12 | **0 行**。这是 xpros 自己的 eParcel charge account 前缀 |
| `S8P` → 取 10 | 1,084 行，但**全部已经是干净的 10 位**，规则是 no-op |
| `Direct_Freight` → 取 13 | **0 行** |
| `LIKE '%Mypost%'` → 从 19 取 23 | 2,245 行，而条码内容本身能识别出 **2,920** 行 |
| `Parcel_Post`/`Express_Post` 且 > 22 → 从 19 取 **22** | 368 行；注意其余规则都取 23，这一条疑似少一位 |
| `TMP` / `RPP` → 取 25 | 2,187 行 ✅ 唯一真正能用的两条 |

第 4 行的 675 行差额是关键：**按 `shipping_method` 分支不可靠**——那些订单实际走了 MyPost，但记录在别的运输方式下。go2office 改为**只看条码结构**，与 `shipping_method` 完全解耦。

## 3. 实际规则

先在串中**任意位置**找 `01[0-9]{14}91` 信封（不锚定开头，这正是双扫行能被修好的原因），取其后内容，再按 article 前缀决定截断长度：

| article 前缀 | 截取 | 覆盖 | 说明 |
|---|---|---|---|
| `33GLH` | 12 | ~22,400 | eParcel consignment，**当前在用的 charge account** |
| `33HKT` | 12 | 3,026 | 已停用账号。保留它**只为修历史数据**，新单不会再出现；那 3,026 行不处理就永远是乱码 |
| `TMP` / `RPP` | 25 | ~2,020 | 挂号信 article |
| `99` | 23 | ~2,920 | MyPost article |
| 其它 | **原样返回** | 353 | 见下节 |

各长度取值来自实测：库中已经以短格式存储的行里，对应长度占比均 ≥99%。

找不到信封时原样返回——绝大多数行本来就是干净的。函数**幂等**（实测 0 行不满足 `f(f(x)) = f(x)`），所以对已清洗的值重复调用无害。

空白串归一为 NULL：`tracking_number IS NULL` 才是可靠的「没有运单号」判断。

## 4. 故意不动的 591 行

清洗后仍长于 25 字符的行，**这是已知且接受的结果，不是失败**：

| 类别 | 行数 | 情况 |
|---|---|---|
| `Parcel_Post`，article 以 `030` 开头 | 362 | 有信封，但这个 article 格式没有确认过。干净的 Parcel_Post 是 18 位，而 `030…` 段不符合，套用任何现成长度都是猜 |
| `Letter`，26 字符 | 132 | 无信封。是一个 13 位号**扫了两遍**（`2091938475001` × 2），需要另一条「前半等于后半」的规则 |
| 其它 | ~97 | 零散 |

**取舍**：截错等于毁掉运单号，不截至少还是完整数据。所以没有规则时一律原样返回。

其中 353 行仍然带着 `01…91` 信封。这一点直接影响校验怎么写——见下节。

## 5. 校验为什么查幂等而不查「还有没有条码串」

`004` 的诊断 10 和 `run-all.mjs` 的 TRACKING CHECK 查的是：

```sql
SELECT count(*) FROM public.orders
WHERE tracking_number IS DISTINCT FROM public.normalize_tracking_number(tracking_number);
```

**不是** `WHERE tracking_number ~ '01[0-9]{14}91'`。后者会把上面那 353 行永远报成失败，几轮之后所有人都学会忽略这个检查。幂等检查则能精确区分两件事：

- 「导入时漏了归一化」→ 报警 ✅
- 「这个格式没有规则」→ 通过（这些行已经在函数的不动点上）✅

## 6. 对迁移脚本的影响（CLAUDE.md 规则 15）

两个触发器是**行级**的，不像 `oms_*` 是语句级——留着灌 203,315 行订单就是真的触发 203,315 次。

`004` 第 2 段因此：

1. `DISABLE TRIGGER orders_normalize_tracking_insert` / `_update`；
2. 在 `SELECT` 里**内联调用** `public.normalize_tracking_number(o.tracking_number)`，一趟出结果，`ON CONFLICT` 分支经 `EXCLUDED` 一并带过去；
3. 段尾重新 `ENABLE`。

**两半都不可删**：只删 DISABLE → 慢；只删内联调用 → 触发器是关的，没人补，直接导入 27,709 行原始扫码输出，**全程不报错**。

同时注意 `004` 诊断 7 和 `run-all.mjs` 的「orders — field-by-field against the source」**不能**直接比 `tracking_number`：源侧必须套上同一个函数，否则一次正确的导入会报出五位数的 mismatch。这与规则 15 里 `001` 的商品行不再逐字等于 `go2_products` 是同一类陷阱。

## 7. 尚未移植的部分

xpros 还有一层**显示层**格式化：[`src/lib/email-templates/dispatch-notification.ts`](../../xpros/src/lib/email-templates/dispatch-notification.ts) 按承运商拼追踪链接（AusPost、Direct Freight 各一个 URL 模板，Aramex 无链接），发货通知邮件里把运单号渲染成可点的 `<a>`。

go2office 目前只在订单详情页纯文本显示运单号。**这一层是本次归一化的直接受益者**——链接必须拿 article ID 去拼，41 位条码串拼出来的 URL 是坏的。等有发货通知或订单页追踪链接需求时再做。
