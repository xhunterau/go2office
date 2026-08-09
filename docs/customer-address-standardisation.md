# 客户地址标准化（standardize_customer_address）

移植自 xpros 的 `fn_standardize_customer_address()` / `trg_customer_standardization`，
连同它依赖的两张参考表一起搬过来。

| 迁移 | 内容 |
| --- | --- |
| `20260809110000_create_postcodes.sql` | `public.postcodes`，16,712 行澳洲邮编对照 |
| `20260809120000_create_countries.sql` | `public.countries`，7 行国家名 → ISO 代码 |
| `20260809130000_standardize_customer_address.sql` | 函数 + 触发器 + 存量回填 |

---

## 1. 它做两件事

写入 `public.customers` 时（INSERT 和 UPDATE 都触发）：

- **规则 A**：`country` 的国家名换成 ISO 代码 —— `Australia` → `AU`
- **规则 B**：用 `postcode` + `city` 反查出 `state` —— `2000` + `SYDNEY` → `NSW`

两条规则都是**查不到就原样不动**。这一点很关键：`customers.country` 里混着电话号码、
邮编、甚至送货备注（`OK to leave at the front porch in the red tub behind the shrubs.`），
它们匹配不上任何国家名，所以一行都不会被碰。

回填时的实际影响（2026-08-09 实测）：

| | 行数 |
| --- | --- |
| `country` 被改写 | 76,373（`Australia` → `AU` 76,363 + `New Zealand` → `NZ` 10） |
| `state` 被改写 | 12,553 |
| 其中：填上原本为空的 | 184 |
| 其中：全称 / 大小写规范化 | 12,353 |
| 其中：真正的跨州纠正 | 16 |

---

## 2. 邮编必须补零到 4 位（这是最容易踩的坑）

`postcodes.postcode` 存的**永远是 4 位**，并由 CHECK 约束强制：

```sql
CONSTRAINT postcodes_postcode_format CHECK (postcode ~ '^[0-9]{4}$')
```

xpros 的源数据里有 389 行丢了前导零：DARWIN 存成 `800`，ANU 存成 `200`，跨州偏远区
存成 `872`。而 go2office 的 `customers.postcode` 有 1,283 行是正确的 4 位形式
（`0800`）。照搬源值的话，这 1,283 个客户永远查不到 state，**且不会报任何错**。

源数据里还留着这个 bug 的现行证据：`CHARLES DARWIN UNIVERSITY` 同时以 `0815` 和 `815`
两行存在，是同一个地方被前导零问题劈成了两条。补零后自动合并（两行 state 一致，无损失）。

函数查询时对客户侧做同样的补零：

```sql
WHERE p.postcode = lpad(btrim(NEW.postcode), 4, '0')
```

**新增邮编行时必须补零**，否则 CHECK 会直接拦下来——这正是加这条约束的目的。

---

## 3. 三处故意不照抄 xpros

### 3.1 用等值匹配，不用 `ILIKE`

xpros 写的是 `locality ILIKE TRIM(NEW.city)` 和 `country_name ILIKE TRIM(NEW.country)`。

`ILIKE` 右侧是**模式**不是字面量。客户 city 里只要含 `%` 或 `_`，就会变成通配符匹配，
可能把另一个郊区的 state 安到这个客户头上。当前库里没有任何一行含这两个字符——
这恰恰是这个 bug 会潜伏很久的原因。

改成对折叠后的列做等值比较，顺带解决性能：`ILIKE` 用不上索引，回填 17.8 万行会变成
每个客户全表扫 16,712 行。

### 3.2 覆盖已有的 state，不只是填空

规则 B 会**改写已经有值的 `state`**，与 xpros 一致。这正是它的意义（历史数据里
`NSW` 和 `New South Wales` 混用），但有个必须说清楚的后果：

> 客户编辑表单提交全部字段，所以**手工填的 state 在保存时会被参考表的答案覆盖**，
> 只要 postcode + suburb 能解析出结果。

`(postcode, locality)` 在参考表里唯一，所以答案是确定的，不存在多候选里瞎猜。如果
真有地址需要一个与澳洲邮政矛盾的 state，正确做法是改 `public.postcodes` 的行，而不是
手工编辑——手工编辑会被下一次保存悄悄撤销。

参考规则 19 里 `name` initcap 的教训：这类"保存时被静默改写"的行为必须写进文档，
否则以后没人能从代码里看出为什么自己的输入没保住。

### 3.3 修掉了源数据里的 `2765 GABLES`

xpros 的表里 `2765 GABLES` 标的是 VIC。Gables 是悉尼西北的郊区，2765 是 NSW 邮编，
同邮编下另外 10 个地区全是 NSW。照搬会在回填时把 **10 个真实 NSW 客户搬到维州**——
那是错的收货地址，不是显示瑕疵。迁移里存成 NSW。

另外三行长得像同一个错误，但**故意不动**：

| 邮编 | 地区 | state | 说明 |
| --- | --- | --- | --- |
| 3691 | LAKE HUME VILLAGE | NSW | 真的在 NSW，用维州邮编 |
| 3707 | BRINGENBRONG | NSW | 同上 |
| 4385 | CAMP CREEK | NSW | 真的在 NSW，用昆州邮编 |

边境小镇确实会这样。所以「state 与本邮编多数派不一致」本身**不构成**错误证据，
不要写个脚本把这类行批量"修正"掉。

`countries` 表同样修了两个值：xpros 的 Japan 是 `JPN`（alpha-3）、South Korea 是
`SKN`（任何 ISO 版本里都不存在这个代码），这里改成 `JP` / `KR`，并由
`CHECK (country_code ~ '^[A-Z]{2}$')` 兜住。

---

## 4. 对 `004` 迁移脚本的影响（CLAUDE.md 规则 15）

`customers_standardize_address` 是**行级**触发器，灌 178,024 行客户就是真触发 17.8 万次。
所以 `004` 第 1 段：

1. `ALTER TABLE public.customers DISABLE TRIGGER customers_standardize_address;`
2. 照常 INSERT
3. 段尾用两条**集合式 UPDATE** 做同样的标准化
4. `ENABLE TRIGGER`，全部在同一事务内

**两半都不可删。** 只删 DISABLE 是慢；**只删那两条 UPDATE 则是静默的**——
76,363 个客户会带着 `Australia` 入库，与另外 101,644 行的 `AU` 并存，之后任何按国家
分组或筛选都会把一个国家算成两个，全程不报错。

诊断 11（`004` 文件尾部）与 `run-all.mjs` 的 `ADDRESS CHECK` 是唯一的事后检验。

### 校验查幂等，不查「是不是都成 ISO 代码了」

和规则 20 里运单号的道理一样。`country` 列里合法地存着电话号码和送货备注，用
「有多少行不是 ISO 代码」去断言为 0，这个检查永远不会通过，然后所有人都学会跳过它。

正确写法是只看参考表能解析的那些行，问它们是否已在不动点上：

```sql
SELECT count(*) FROM public.customers c
JOIN public.countries ct ON lower(ct.country_name) = lower(btrim(c.country))
WHERE c.country IS DISTINCT FROM ct.country_code;
```

### 列对列 diff 不能再比 state / country

`004` 诊断 7 和 `run-all.mjs` 的 customers 地址检查原本逐列比对源表。现在 `state` 与
`country` 被标准化了，**一次正确的导入会报出五位数 mismatch**（与规则 15 里 `001` 的
商品行、规则 20 里的运单号是同一类陷阱）。两处已改为只比对街道行、city 和 postcode，
state / country 交给诊断 11。

---

## 5. 参考表的维护入口：`/settings/postcodes`

侧边栏 `Settings → Postcodes`。`postcodes` 的增删改查页面，`public.postcodes` 上的
RLS（迁移 `20260809110000`）本来就给 `authenticated` 开了全量权限，这个页面只是把入口
补上，没有新迁移。

顺带把侧边栏的 `Settings` 从单条链接改成了折叠组（与 Catalog / Inventory 同构）：
原来的定价设置页 **URL 不变**，仍是 `/settings`，只是降级成组里的 `System Constants`
子项。

关于这个页面，有三件事是从界面上看不出来的：

- **改这里是纠正某个地址 state 的唯一持久手段。** 见 3.2：手工改客户的 `state` 会在
  下一次保存时被参考表覆盖。页面顶部把这句话写出来了。
- **编辑不回溯。** 改完某一行，已有客户不会被重算——`standardize_customer_address`
  是 BEFORE INSERT/UPDATE 触发器，只在那个客户下次被写入时才生效。要立刻铺开就得跑一次
  集合式 UPDATE（`004` 第 1 段段尾那两条就是模板）。
- **删除不会被拦，代价是静默的。** `customers` 没有 FK 指向这张表（地址是普通列），
  所以删任何一行都会成功；之后该地区的客户查不到 state，函数按设计原样放行。确认弹窗里
  写了这个后果，因为数据库不会提供任何提示。

输入侧镜像了表上的三个 CHECK，避免用户看到 23505 / 23514 原始报错：邮编不足 4 位
**自动补零**而不是拒绝（`800` → `0800`，见第 2 节——这正是源数据在 389 行上犯过的错），
locality 自动转大写，state 是 8 个州的下拉框 + `None`（对应 136 行 alias locality 的
NULL，实测全表 state 只有这 9 种取值）。

---

## 6. 尚未移植的部分

xpros 的 `postcodes` 还被它自己的运费分区功能用着（`postcode_carrier_zones`、
`preview_postcode_zones_import()`）。那套东西依赖 go2office 没有的承运商分区模型，
没有一起搬。本项目里这张表目前只服务于地址标准化。
