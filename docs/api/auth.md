# 认证域 API

本文档覆盖 MindAuth 认证域的全部端点，来源路由文件：`src/routes/auth.js`（挂载于 `/api`）、`src/routes/registerEmailCode.js`（挂载于 `/api/register`）、`src/routes/challenge.js`（挂载于 `/api/challenge`）、`src/routes/password.js`（挂载于 `/api/password`）、`src/routes/email-verification.js`（挂载于 `/api/email-verification`）。通用约定（错误响应格式、CSRF、Cookie 等）见 [README.md](README.md)。

> **维护提示**：修改 src/routes/auth.js、registerEmailCode.js、challenge.js、password.js、email-verification.js 时需同步更新本文档。

## 用户认证（src/routes/auth.js → /api）

### `POST /api/register/send-code`

注册前发送 6 位数字邮箱验证码（挂载于 `src/routes/registerEmailCode.js`）。验证码在 Redis 与 MySQL fallback 表中以 **SHA-256 哈希** 存储，5 分钟 TTL。账号创建发生在后续 `POST /api/register` 中，本端点不创建用户。

- 认证/限流：无需认证；按 IP 3/10 分钟（`ratelimit:register_send_code`）；按 email 1 分钟冷却（`register_email_cooldown:{hash}`）；CSRF 豁免
- 存储：Redis `register_email_code:{sha256(lower(email))}`（payload `{ email, codeHash, failures }`）；MySQL `registration_email_codes` 表（fallback）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | 是 | 合法邮箱格式（大小写不敏感，会自动 trim/lowercase） |

成功响应（`200`）：

```json
{ "success": true, "message": "验证码已发送到您的邮箱" }
```

> 仅在 `NODE_ENV !== 'production'` 时，响应体额外包含 `code` 字段（明文 6 位码），便于 E2E 测试使用；生产环境不会返回。

| 状态码 | code | 触发条件 |
|--------|------|----------|
| 400 | `INVALID_EMAIL` | 邮箱格式不合规 |
| 409 | `EMAIL_ALREADY_REGISTERED` | 该邮箱已在 `users` 表中注册；本端点**故意**暴露此信息以便用户区分"已注册"与"待注册"，代价是邮箱枚举风险 |
| 429 | `EMAIL_COOLDOWN` | 同一邮箱 1 分钟内重复请求 |
| 429 | `ratelimit:register_send_code` | 同一 IP 10 分钟内超过 3 次 |
| 503 | `SMTP_UNAVAILABLE` | 邮件服务未配置（`email_config` 无 host/密码） |
| 503 | `SMTP_SEND_FAILED` | SMTP 发信失败（已清理本次生成的 code 与 cooldown，允许立即重试） |
| 500 | `发送验证码失败` | 服务器错误 |

注记：发信失败会回滚 Redis/MySQL 中已写入的 code 与 cooldown 键，避免下一次重试被 1 分钟冷却阻塞。

### `POST /api/register`

注册新用户。**必须在提交前通过 `POST /api/register/send-code` 获取验证码**；本端点对 code 进行原子校验，通过后创建账号（`email_verified = 1`），不再发送 post-registration 验证链接邮件。

- 认证/限流：无需认证；限流 5/小时（`ratelimit:register`）；CSRF 豁免

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 2–50 字符，仅允许字母、数字、下划线、连字符及中日文字符 |
| `email` | string | 是 | 合法邮箱格式 |
| `password` | string | 是 | 至少 8 字符，须含大写字母、小写字母和数字 |
| `email_code` | string | 是 | 6 位数字验证码，由 `/api/register/send-code` 发送到邮箱 |
| `challenge_id` | number | 条件必填 | 题库中存在启用的问答题时必填（先经 `GET /api/challenge/random` 获取） |
| `challenge_answer` | string | 条件必填 | 问答题答案（比对时 trim + 小写化） |

成功响应（`201`）：

```json
{ "success": true, "message": "注册成功" }
```

| 状态码 | code / 消息 | 触发条件 |
|--------|-------------|----------|
| 400 | `MISSING_FIELD` | username/email/password/email_code 缺失（缺 `email_code` 时提示"请先获取邮箱验证码"） |
| 400 | `EMAIL_CODE_INVALID` | 验证码非 6 位数字、或已过期、或已被消费 |
| 400 | `EMAIL_CODE_MISMATCH` | 验证码不正确（失败计数 +1） |
| 400 | `EMAIL_CODE_MAX_FAILURES` | 同一 email+IP 连续错码 5 次，code 被 DEL |
| 400 | `CHALLENGE_REQUIRED` | 启用了问答题但未携带 `challenge_id` |
| 400 | `CHALLENGE_EXPIRED` / `CHALLENGE_MISMATCH` / `CHALLENGE_NOT_FOUND` / `CHALLENGE_FAILED` | 问答验证失败 |
| 400 | `用户名需2-50字符` 等 | 用户名 / 邮箱 / 密码格式不合规 |
| 409 | `用户名或邮箱已被使用` | 唯一键冲突；刻意不区分是哪个字段，防枚举 |
| 500 | `注册失败` | 服务器错误 |

注记：
- 问答会话绑定 `csrf_token` cookie（无 cookie 时按 `anonymous`）；注册用的 `verifyForRegistration` 答错**不发新题**、直接失败，答对即消费会话。
- **新注册账号直接为 `email_verified=1`**，登录后 `GET /api/me` 返回 `email_verified: true`，无需 post-registration 邮箱验证。
- 老用户（本次变更前注册）的 `email_verified` 不变，仍可通过 `POST /api/email-verification/send` + `/verify` 完成邮箱验证。

### `POST /api/login`

用户名或邮箱登录，成功后签发 `session` httpOnly cookie（30 天，`SameSite=Lax`，生产环境 `Secure`）。邮箱匹配不区分大小写，并会自动去除首尾空格；用户名按原值匹配。

- 认证/限流：无需认证；限流 5/5 分钟（`ratelimit:login`）；CSRF 豁免

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 登录用户名或邮箱地址；邮箱允许大小写和首尾空格，服务端会规范化后匹配 |
| `password` | string | 是 | 密码 |

成功响应：

```json
{ "success": true }
```

| 状态码 | code / 消息 | 触发条件 |
|--------|-------------|----------|
| 400 | `用户名/邮箱和密码必填` | 参数缺失 |
| 401 | `用户名/邮箱或密码错误` | 用户不存在或密码错误（不区分，防枚举） |
| 403 | `USER_BANNED` | 账号被封禁（附 `ban_expires_at`；封禁已过期则自动解封并放行） |
| 423 | `ACCOUNT_LOCKED` | 账号处于失败锁定期（附 `locked_until`、`lock_level`） |
| 500 | `登录失败` | 服务器错误 |

注记：

- **失败锁定递进**：失败计数键为 `login_fail:{userId}:{ip}`（5 分钟窗口）；同账号通过用户名、邮箱或不同大小写提交都会共享计数。Web 与 Native 登录统一调用同一校验服务，同一 IP 连续失败 5 次即锁定账号，时长按 `lock_level` 递进 15 分钟 → 1 小时 → 2 小时封顶，**始终有限时**、到期自动解锁；锁定时发站内通知 + 邮件。永久封禁只能由管理员 `ban_status` 施加。
- 登录成功后重置登录限流计数与失败计数、清零 `lock_level`，写入 `login_logs`（`login_type='web'`）。
- IP 与上次登录不同会触发"新设备登录"通知（含邮件），失败不影响登录。

### 官方 Mindustry Mod Native API

该接口只开放给产品策略指定的 MDTBBS 官方 public client `mdtbbs-mindustry-mod`。客户端没有 `client_secret`，任何第三方不得用此 API 收集用户密码；第三方集成继续使用 OAuth Authorization Code + PKCE。客户端必须固定使用 HTTPS `https://auth.mdtbbs.cn`，不能忽略证书错误或 HTTP fallback。

#### `POST /api/native/login`

请求 JSON：`{ "client_id": "mdtbbs-mindustry-mod", "username": "用户名或邮箱", "password": "…", "device_id": "随机 UUID", "device_name": "Mindustry Linux" }`。`device_id` 必须是客户端首次运行生成并持久化的随机 UUID，不可来自 MAC、硬件序列号或 Android ID；服务端仅把它作为可伪造的会话标识。`device_name` 可选，最多 80 字符，仅展示。

成功响应含标准 Bearer token 字段及 `success: true`：

```json
{ "success": true, "access_token": "…", "refresh_token": "…", "token_type": "Bearer", "expires_in": 3600, "scope": "openid profile game_content" }
```

#### `POST /api/native/refresh`

JSON 请求：`{ "client_id": "mdtbbs-mindustry-mod", "refresh_token": "…", "device_id": "…" }`。每次成功返回新 access/refresh token，旧 refresh token 立即作废；重放已轮换 token 会撤销该设备会话。

#### `POST /api/native/logout`

请求头 `Authorization: Bearer <access_token>`。若 access token 已过期，也可提交 `{ "client_id": "mdtbbs-mindustry-mod", "refresh_token": "…", "device_id": "…" }` 撤销对应设备。只撤销此 Mod 设备会话、其 refresh-token family 和 access token，不影响 Web Cookie 或其他设备。

#### `GET /api/native/me`

请求头 `Authorization: Bearer <access_token>`。返回 `{success:true,user:{id,username,avatar_url,phone_verified,ban_status,is_muted}}`，不会返回邮箱、完整手机号或内部账号字段。

所有 Native POST 路径以完整路径在 CSRF middleware 中精确豁免，使用 Bearer/JSON，不读取浏览器 Cookie。限流为 login 30/IP/5 分钟并叠加 login 标识哈希 10/5 分钟；refresh 60/分钟；logout 30/分钟；me 60/分钟。

### `POST /api/logout`

登出当前会话（撤销 MySQL 记录与 Redis 缓存）并清除 `session` cookie。

- 认证/限流：需要 Session（`session` cookie）；需 `X-CSRF-Token` 头；无专属限流

请求参数：无 body。

成功响应：

```json
{ "success": true }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 500 | `登出失败` | 服务器错误 |

### `GET /logout`（顶层路径，不在 `/api` 下）

SLO（Single Logout）端点：跨域 SPA（如 MindFourm）通过浏览器跳转调用。销毁 MindAuth 会话后，按注册白名单重定向回调用方。

- 认证/限流：无需登录（幂等）；无专属限流
- 实现：`src/routes/sloLogout.js`，在 `src/app.js` 顶层挂载

Query 参数（**两者都必填**，否则跳回本站 `/login`）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `redirect_uri` | string | 必须**严格相等**匹配 `client_id` 注册过的回调地址 |
| `client_id` | string | OAuth 客户端的 public client_id（如 `forum`） |

行为：
1. 若请求带 `session` cookie：尽力撤销会话（MySQL + Redis + cookie），错误被吞掉以保持幂等
2. 校验 `redirect_uri` + `client_id`：查 `clients` 表，严格相等匹配注册的 `redirect_uri`，再做协议校验（仅允许 http/https）
3. 任何校验失败 → 跳本站 `/login`（永不跳不可信 URI，杜绝 open redirect）

示例（成功）：
```
GET /logout?redirect_uri=https%3A%2F%2Fmdtbbs.cn%2Fapi%2Fauth%2Fcallback&client_id=forum
→ 302 Location: https://mdtbbs.cn/api/auth/callback
```

示例（失败：redirect_uri 不匹配注册值）：
```
GET /logout?redirect_uri=https%3A%2F%2Fevil.example.com%2Fsteal&client_id=forum
→ 302 Location: /login
```

注记：MindFourm 当前调用时**不带 `client_id`**，会触发失败回落到 `/login`。MindFourm 侧需要配套加上 `client_id` 参数才能正确返回论坛。

### `GET /api/me`

获取当前登录用户信息。

- 认证/限流：需要 Session；无专属限流

请求参数：无。

成功响应：

```json
{
  "success": true,
  "id": 42,
  "username": "mindplayer",
  "email": "player@example.com",
  "email_verified": 1,
  "role": "user",
  "avatar_url": "/uploads/avatars/42.webp",
  "banner_url": null,
  "phone_masked": "138****5678",
  "phone_verified": true,
  "phone_verified_at": "2026-07-01T08:30:00.000Z",
  "created_at": "2026-01-15T12:00:00.000Z"
}
```

注记：`phone_masked` 由 `maskPhone` 脱敏；`phone_verified` 归一化为布尔值。未认证时由 `requireAuth` 返回通用 401（见 [README.md](README.md)）。

### `GET /api/login-logs`

获取当前用户最近 20 条登录记录（按时间倒序）。

- 认证/限流：需要 Session；无专属限流

请求参数：无。

成功响应：

```json
{
  "success": true,
  "logs": [
    {
      "id": 101,
      "ip": "203.0.113.7",
      "device": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
      "login_type": "web",
      "created_at": "2026-07-25T10:20:00.000Z"
    }
  ]
}
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 500 | `获取登录记录失败` | 服务器错误 |

## 人机验证问答（src/routes/challenge.js → /api/challenge）

问答会话以 `csrf_token` cookie 为键存于 Redis（`challenge_session:{csrf}`，TTL 30 分钟），最多答错 3 次。

### `GET /api/challenge/random`

获取一道随机启用的问答题并开启验证会话（供注册前置验证使用）。

- 认证/限流：无需认证；限流 30/分钟（`ratelimit:challenge_random`）

请求参数：无。

成功响应：

```json
{ "success": true, "challenge_id": 7, "question": "Mindustry 中最基础的采矿钻头叫什么？" }
```

题库为空时仍返回 200：

```json
{ "success": true, "challenge_id": null, "question": null, "message": "暂无问答题" }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 500 | `获取验证问题失败` | 服务器错误 |

### `POST /api/challenge/verify`

校验问答答案；答错时自动换发新题（与注册时的一次性校验不同）。

- 认证/限流：无需认证；限流 15/5 分钟（`ratelimit:challenge_verify`）；CSRF 豁免

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `challenge_id` | number | 是 | 当前会话中的题目 ID |
| `challenge_answer` | string | 是 | 答案（比对时 trim + 小写化，bcrypt 哈希比对） |

答对（`200`）：

```json
{ "success": true, "verified": true }
```

答错但仍有机会（`200`，附新题）：

```json
{
  "success": false,
  "code": "WRONG_ANSWER",
  "message": "答案错误，请重试",
  "attempts_left": 2,
  "new_challenge_id": 12,
  "new_question": "Mindustry 的核心方块名称是什么？"
}
```

| 状态码 | code | 触发条件 |
|--------|------|----------|
| 400 | `MISSING_PARAMS` | 参数缺失 |
| 400 | `CHALLENGE_EXPIRED` | 会话不存在或已过期（30 分钟） |
| 400 | `CHALLENGE_MISMATCH` | 提交的 `challenge_id` 与会话中的题目不符 |
| 400 | `CHALLENGE_NOT_FOUND` | 题目不存在或已被禁用 |
| 400 | `CHALLENGE_FAILED` | 累计答错 3 次，会话销毁，需重新获取新题 |
| 500 | `验证失败` | 服务器错误 |

注记：答对即删除会话（一次性）；答错换题后 `challenge_id` 变更，客户端须用响应中的 `new_challenge_id` 重新提交。

## 密码重置（src/routes/password.js → /api/password）

### `POST /api/password/reset-request`

请求密码重置邮件。重置令牌 SHA-256 哈希存 Redis（`reset:{hash}`，TTL 1 小时），原始令牌仅出现在邮件链接中。

- 认证/限流：无需认证；限流 3/小时（`ratelimit:password_reset_request`）；需 `X-CSRF-Token` 头

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | 是 | 注册邮箱 |

成功响应（无论邮箱是否存在均返回相同结果，防枚举）：

```json
{ "success": true, "message": "如果邮箱存在，重置链接已发送" }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 400 | `请输入有效的邮箱地址` | email 缺失或格式非法 |
| 500 | `发送重置邮件失败` | 邮件发送 / 服务器错误 |

注记：仅当用户存在**且邮箱已验证**才真正发信；否则静默返回成功（消息文案为"如果邮箱存在且已验证，重置链接已发送"）。

### `POST /api/password/reset`

使用邮件中的令牌执行密码重置。

- 认证/限流：无需认证；限流 10/小时（`ratelimit:password_reset_exec`）；需 `X-CSRF-Token` 头

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 是 | 邮件链接中的原始重置令牌 |
| `new_password` | string | 是 | 新密码（至少 8 字符，须含大写、小写字母和数字） |

成功响应：

```json
{ "success": true, "message": "密码已更新，请重新登录" }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 400 | `缺少重置令牌` | token 缺失 |
| 400 | `密码至少需要8个字符` 等 | 新密码不符合规则（消息来自 `getPasswordValidationError`） |
| 400 | `链接无效或已过期` | 令牌不存在 / 已使用 / 超过 1 小时 |
| 400 | `邮箱未验证或用户不存在` | 重置执行时复核发现邮箱未验证或用户已删除（令牌同时作废） |
| 500 | `密码重置失败` | 服务器错误 |

注记：令牌**单次有效**，成功后立即删除；重置成功会级联撤销该用户的**全部登录会话**、全部 OAuth refresh token（删表）及缓存的 access token（尽力而为），所有端都需重新登录。

## 邮箱验证（src/routes/email-verification.js → /api/email-verification）

验证令牌哈希双写：Redis（`verify:{hash}`，TTL 1 小时，主）+ MySQL `email_verification_tokens` 表（Redis 丢数据时的持久回退）。

### `POST /api/email-verification/send`

向当前用户邮箱发送验证邮件。

- 认证/限流：需要 Session；限流 1/分钟（`ratelimit:email_verify_send`）；需 `X-CSRF-Token` 头

请求参数：无 body。

成功响应：

```json
{ "success": true, "message": "验证邮件已发送" }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 400 | `邮箱已验证` | `email_verified` 已为 1 |
| 500 | `发送验证邮件失败` | 邮件发送 / 服务器错误 |

### `POST /api/email-verification/verify`

用邮件链接中的令牌完成邮箱验证（同时用于换绑邮箱的确认：会把令牌记录中的 email 写入用户）。

- 认证/限流：无需认证（凭一次性令牌）；无专属限流；CSRF 豁免

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 是 | 邮件链接中的原始验证令牌 |

成功响应：

```json
{ "success": true, "message": "邮箱验证成功" }
```

| 状态码 | 消息 | 触发条件 |
|--------|------|----------|
| 400 | `缺少验证令牌` | token 缺失 |
| 400 | `验证链接无效或已过期` | Redis 与 MySQL 回退均未命中，或 MySQL 记录已过期 |
| 500 | `验证失败` | 服务器错误 |

注记：令牌**单次有效**，成功后从 Redis 与 MySQL 双端删除；验证成功写用户审计（action `email_changed`）。

### `GET /api/email-verification/status`

查询当前用户邮箱验证状态。

- 认证/限流：需要 Session；无专属限流

请求参数：无。

成功响应：

```json
{ "success": true, "email_verified": true, "email": "player@example.com" }
```
