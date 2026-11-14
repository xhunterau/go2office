# eBay 接入（OAuth 与账号删除通知）

eBay 订单导入的前置管道。订单导入本身（进度、待决策、实现要点）见 [ebay-order-import.md](ebay-order-import.md)。

xpros 没有 eBay 集成，Laravel 的拉单方式未知；这里的一切都是从 eBay 官方流程新建的。

---

## 1. 开发者账号与 keyset

- 开发者门户 developer.ebay.com，Production keyset 名为 `mwayne`
- `EBAY_CLIENT_ID` = App ID（`FiveOcea-mwayne-PRD-…`），`EBAY_CLIENT_SECRET` = Cert ID。Dev ID 用不到
- **RuName**：keyset 下有两条。`…-doksxw` 是早先就存在的（无 Display Title、未开 OAuth），**不要动它**——不确定 Laravel 是否在用。go2office 用的是新建的 `Five_Oceans_Pty-FiveOcea-mwayne-teacg`（Display Title `go2office`，OAuth Enabled），即 `EBAY_RUNAME`
- RuName 的 accepted / declined URL 留空，用 eBay 默认页：授权成功后地址栏带着 `code=`，复制即可，**不需要我们自己的回调页**
- 隐私政策 URL 用的是 Shopify 店自带的 `https://go2buy.com.au/policies/privacy-policy`（内容是给网店顾客写的，eBay 不审内容）

## 2. Marketplace Account Deletion（不可省）

每个 Production keyset 必须**订阅**账号删除通知，否则 eBay 会停用 keyset。豁免只适用于「不存储 eBay 用户数据」的应用，而我们存买家姓名与地址，**不可申请豁免**。

- endpoint：Supabase Edge Function `ebay-account-deletion`（`supabase/functions/ebay-account-deletion/index.ts`），地址 `https://nszriuqpumbyigxwtccs.supabase.co/functions/v1/ebay-account-deletion`。go2office 尚未部署公网，Edge Function 是唯一现成的公网 HTTPS 入口
- `verify_jwt = false`（`supabase/config.toml`）：eBay 不带 Supabase 凭证
- **GET** `?challenge_code=X` → `{"challengeResponse": sha256hex(X + token + endpoint)}`，顺序是 eBay 定的
- **POST** → 写 `public.ebay_account_deletions`（`notification_id` 主键，重投递被忽略），返回 204。写库失败返回 500，让 eBay 重试，不丢通知
- 函数 secrets：`EBAY_VERIFICATION_TOKEN`、`EBAY_DELETION_ENDPOINT`。**endpoint 必须显式配置**：它是哈希的一部分，而网关后面的 `req.url` 不是门户里填的那个地址。token、endpoint 在 `.env.local`、函数 secrets、eBay 门户三处必须一致，改一处 challenge 就失败
- **未校验 `X-EBAY-SIGNATURE`**：伪造的 POST 只能往一张没人自动处理的日志表里加行。以后真正按这张表去匿名化客户数据时，**必须先向 eBay 核实**，不可直接信任表内容
- 按通知删除 / 匿名化客户数据**尚未实现**（`processed_at` 留给它）

部署：

```bash
npx supabase functions deploy ebay-account-deletion --project-ref nszriuqpumbyigxwtccs --use-api --no-verify-jwt
```

`--use-api` 在服务端打包，本机无 Docker 也能部署（2026-11-14 实测）。同日验证：challenge 哈希与本地 `sha256sum` 一致；POST 写入一行、同 `notification_id` 重投仍返回 204 且不重复；测试行已删除。

## 3. 卖家授权（refresh token）

读订单需要**用户 token**（Authorization Code Grant），不是 Shopify 那种 client credentials：

```bash
npx dotenv-cli -e .env.local -- node scripts/ebay/authorize.mjs            # 打印授权链接
npx dotenv-cli -e .env.local -- node scripts/ebay/authorize.mjs "<落地页完整URL>"
```

- 用**卖家账号**登录并同意。链接带 `prompt=login`，防止浏览器里登着的私人账号被静默授权
- code 约 5 分钟过期；`invalid_grant` 基本就是过期或已用过
- 脚本用 Identity API 取 `userId` / `username`，upsert 进 `public.ebay_accounts`（按 `userId`，用户名可改）
- refresh token 有效 **18 个月**，到期时间存在 `refresh_token_expires_at`。go2office 的授权与 Laravel 的互相独立，不会顶掉对方

**scope 清单只写在 `scripts/ebay/authorize.mjs` 里**，授权时存进 `ebay_accounts.scopes`；`src/lib/ebay/client.ts` 刷新时原样用这份。刷新请求的 scope 超出已同意范围会直接失败，所以**加 scope = 改脚本 + 重新授权**。当前：`sell.fulfillment`（读写；读订单 + 以后回写运单号，用户确认一定会做，故提前申请，免得再授权一次）、`commerce.identity.readonly`。

**何时需要重新授权**：refresh token 18 个月到期；卖家改密码或在 eBay 撤销 app 授权会提前失效；scope 清单变化。失效时 `client.ts` 抛 `EbayReauthorizationRequired`，导入报错而不是静默少导。**到期提醒**（`REFRESH_TOKEN_WARNING_MS`，30 天）尚无界面，计划随 Import from eBay 按钮一起做。

**当前状态（2026-11-14）**：已授权卖家账号 `go2buy_au`（userId `CsMlJk7dTqS`），refresh token 到期 **2028-05-14**。eBay 门户的 Send Test Notification 已打通，测试行（`test_user`）已删除。

## 4. 客户端 `src/lib/ebay/client.ts`

2026-11-14 实测：`GET /sell/fulfillment/v1/order?filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}` 返回 2 张未发货单（`salesRecordReference` 326094、326098）。给订单导入的观察：

- **`ebay:xxxx` 引用码在 `shipTo.contactAddress.addressLine1`**，真实街道在 `addressLine2`。历史数据里它在 `customers.address_line3`（Laravel 挪过位置）。导入时必须照历史挪到 line3，否则 line1 存的是引用码——而 line1 是客户匹配三要素之一（`shopify-order-import.md` §3）
- 历史 `sales_record_number` 截止 324567，现在已到 326098：Laravel 期间约 1,500 张 eBay 单不在 go2office


- `loadEbayAccount(supabase, ebayUserId?)`：必须是 service role 客户端。多账号时不指定就拒绝，不随便挑一行
- `ebayGet(account, path, params)`：access token（2 小时）按账号缓存、提前 5 分钟过期；401 换一次 token；429 / 5xx / 网络错误指数退避重试（只有 GET，可安全重放）
- refresh token 过期或被撤销时抛 `EbayReauthorizationRequired`，信息里写明要跑授权脚本

## 5. 表与权限（迁移 `20261114120000`）

`ebay_accounts`、`ebay_account_deletions` 都是 **RLS 开、零策略**：只有 service role 能读写。2026-11-14 用 `SET ROLE authenticated` 在已有行上实测：SELECT / UPDATE / DELETE 均 0 行，INSERT 报 RLS 违规（规则 22）。以后要在页面上显示 token 到期时间，需要加 SELECT 策略**并**用 REVOKE + 列级 GRANT 挡住 `refresh_token` 列。
