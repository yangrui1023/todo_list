# 数据库脚本

线上前端不再直连表，所有读写都走这里的 5 个函数。
以前登录是前端直接 `select app_users` 拿 `password_hash` / `salt` / `session_token`
到浏览器里比对 —— 而 anon key 就写在网页源码里，等于谁都能读走全站凭据。

## 执行顺序（重要）

| 步骤 | 做什么 | 这一步之后 |
|---|---|---|
| 1 | 在 Supabase → SQL Editor 执行 `01_auth_rpc.sql` | 建好函数、加 `fingerprint` 列。旧版前端**照常能用**（它还在直连表） |
| 2 | 把新版 `index.html` 发布上线 | 新版走 RPC，旧版同时也能用 |
| 3 | 用新版登录一次，确认能登录、能同步 | —— |
| 4 | 执行 `02_lockdown.sql` | 表对匿名关闭，从这一刻起只有 RPC 能用 |

顺序反了会怎样：先跑 02 再发前端 → 旧版前端立刻登不上（表关了）。
所以务必按 1 → 2 → 3 → 4 走。

## 01 做了什么

| 函数 | 作用 |
|---|---|
| `app_register(email, password)` | 建账号。密码用 bcrypt（cost 12）哈希，返回会话票 |
| `app_login(email, password)` | 校验密码、换新会话票。老用户的 sha256 哈希第一次登录时自动升级成 bcrypt |
| `app_logout(token)` | 作废这个会话票 |
| `app_read_data(token)` | token 换用户，只返回他自己那一份数据 |
| `app_write_data(token, data, fp, base_fp)` | 带「写入前比对」的写：云端已经变了就拒绝并交回云端那版 |

另外加了一列 `checkin_data.fingerprint`，用来做上面那个比对。

## 02 做了什么

- 给两张表开 RLS
- **删掉所有已有策略** —— 留着任何一条 `using (true)`，后面的 revoke 都白做
- `revoke all on table ... from anon, authenticated`
- 最后给个自检查询，期望返回 0 行

## 怎么验证真的关上了

两种方式，任选一种。**下面的 JS 不能贴到终端里**，`(` `)` `?` `&` 是 shell 的语法，
会报 `sh: parse error near ')'`，请求根本没发出去。

### 方式一：浏览器控制台（最省事）

打开线上页面按 F12 → Console → 粘贴整段回车（key 就是源码里那个，本来公开）：

```js
fetch('https://rmqyyfoncddnfcaqiude.supabase.co/rest/v1/app_users?select=email&limit=1', {
  headers: {
    apikey: 'sb_publishable_tkJEszfUG7UXJxjvRPiuIw_QjpjJ2Ay',
    Authorization: 'Bearer sb_publishable_tkJEszfUG7UXJxjvRPiuIw_QjpjJ2Ay'
  }
}).then(r => r.json()).then(console.log)
```

### 方式二：终端（URL 必须用单引号包住，且写在一行）

```bash
curl -s 'https://rmqyyfoncddnfcaqiude.supabase.co/rest/v1/app_users?select=email&limit=1' -H 'apikey: sb_publishable_tkJEszfUG7UXJxjvRPiuIw_QjpjJ2Ay' -H 'Authorization: Bearer sb_publishable_tkJEszfUG7UXJxjvRPiuIw_QjpjJ2Ay'
```

只想知道「关没关上」而不想看邮箱，把 `select=email` 换成 `select=id`，
返回 `[]` 就是关上了。

### 判定标准

| 时机 | 返回 | 含义 |
|---|---|---|
| 执行 02 之前 | 一串邮箱 / 一串 id | **裸奔**，正常，还没执行第 4 步 |
| 执行 02 之后 | `[]` | 关上了 |
| 执行 02 之后 | 401 / 403 + 错误对象 | 也关上了（网关层就拒了） |

## 将来加功能时注意

- 业务数据要新增读写，**加函数**，不要 `grant select on table` 回去
- 函数一律 `security definer` + `set search_path = public, extensions`
- 返回值里不要塞 `password_hash` / `salt` / 别人的 token
