# OAuth / OIDC API

MindAuth OAuth 2.0 / OIDC 域全部端点的内部参考文档，涵盖协议端点、授权管理端点、发现端点与健康检查。

> **维护提示**：修改 src/routes/oauth.js、src/modules/oauth/* 时需同步更新本文档及 [../third-party-integration.md](../third-party-integration.md)。

> **文档分工**：本文档面向**内部开发者**，参考式覆盖全部端点（含仅内部使用的会话端点）。面向第三方接入方的教程式文档见 [../third-party-integration.md](../third-party-integration.md)。通用约定（错误格式、认证方式）见 [README.md](README.md)。

**通用说明**：

- 路由适配层：`src/routes/oauth.js`（挂载于 `/api`）；业务逻辑：`src/modules/oauth/oauthIssuer.js`。
- 协议端点请求体为 **JSON**（`Content-Type: application/json`），不支持 form-encoded。
- 标准错误格式（RFC 6749）：`{ "error": "<code>", "error_description": "<中文描述>" }`。未捕获异常返回 `500 server_error`。
- CSRF：`/token` `/refresh` `/introspect` `/revoke` `/verify` 在豁免名单中；`DELETE /authorizations/:client_id` **需要** `X-CSRF-Token`。
- 速率限制（按 IP）：`/authorize` `/token` `/refresh` `/introspect` `/revoke` 各 60 次/分钟；`/userinfo` `/user` `/verify` 共享 30 次/分钟（`ratelimit:verify_api`）。

---

## GET /api/authorize

授权端点（RFC 6749 §4.1.1），发起授权码流程。**认证**：浏览器 `session` Cookie（未登录时重定向到登录页）。

| 参数（query） | 必填 | 说明 |
|------|------|------|
| `client_id` | 是 | 应用标识 |
| `redirect_uri` | 是 | 必须与注册值**完全相等** |
| `state` | 否 | 防 CSRF 随机串，原样附加到回调 |
| `scope` | 否 | 空格分隔，仅允许 `openid` `profile` `email`；缺省为三者全部 |
| `response_type` | 否 | 若提供必须为 `code` |
| `code_challenge` | 视客户端 | PKCE challenge = Base64URL(SHA256(code_verifier))；客户端 `require_pkce=1` 时必填 |
| `code_challenge_method` | 否 | 仅接受 `S256`（不接受 plain）；缺省视为 `S256` |

**响应**（均为 302 重定向，无 JSON）：

- 已登录：`{redirect_uri}?code={code}&state={state}`（保留 redirect_uri 原有 query）
- 未登录：`/#/login?redirect_uri=...&client_id=...&client_name=...`（携带原 OAuth 参数，登录后续跳）

**错误形态**：所有校验错误重定向到**本站错误页** `/oauth-error.html?error={code}&description={desc}`，**不会**重定向到 redirect_uri（与 RFC 6749 §4.1.2.1 不同，避免开放重定向）。

| error 码 | 触发条件 |
|------|------|
| `invalid_request` | 缺少 client_id/redirect_uri；客户端要求 PKCE 但缺 code_challenge；method 非 S256 |
| `unsupported_response_type` | response_type 存在且非 `code` |
| `invalid_client` | client_id 未注册 |
| `invalid_redirect` | redirect_uri 与注册值不符（非标准码） |
| `invalid_scope` | 含 openid/profile/email 之外的 scope |
| `server_error` | 未捕获异常 |

**特殊行为**：授权码 Redis 存储，**5 分钟 TTL、单次消费**（GETDEL 原子取出）；同时 upsert `authorizations` 记录并写入 `login_logs`（login_type=oauth）。

---

## POST /api/token

令牌交换端点（RFC 6749 §4.1.3）。**认证**：body 中 `client_id` + `client_secret`（timing-safe 比较）。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | 必须为 `authorization_code` |
| `code` | 是 | 授权码 |
| `client_id` / `client_secret` | 是 | 客户端凭证 |
| `code_verifier` | 视授权码 | 授权码携带 code_challenge 时必填，SHA256 后须与之匹配 |

**成功响应**（注意：**无** `success` 字段、**无** `user` 对象——用户信息请另调 `/api/userinfo`）：

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "refresh_token": "…",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

| error 码 | HTTP | 触发条件 |
|------|------|------|
| `unsupported_grant_type` | 400 | grant_type 缺失或非 `authorization_code`；或存储的 code_challenge_method 非 S256 |
| `invalid_request` | 400 | 缺 code/client_id/client_secret；code 使用了 PKCE 但缺 code_verifier |
| `invalid_client` | 401 | client_id/client_secret 无效 |
| `invalid_grant` | 401 | code 无效/过期/已使用；code 与 client_id 不匹配；redirect_uri 不匹配；code_verifier 校验失败；授权用户不存在 |

**特殊行为**：access_token 存 Redis（1h TTL，带 user/client 索引集）；refresh_token 存 MySQL（SHA-256 哈希，30 天）。

---

## POST /api/refresh

刷新令牌端点（RFC 6749 §6，独立路径而非复用 /token）。**认证**：body `client_id` + `client_secret`。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | 必须为 `refresh_token` |
| `refresh_token` | 是 | 待轮换的刷新令牌 |
| `client_id` / `client_secret` | 是 | 客户端凭证 |

**成功响应**：与 `/token` 相同结构（access_token / token_type / refresh_token / expires_in / scope）。

| error 码 | HTTP | 触发条件 |
|------|------|------|
| `unsupported_grant_type` | 400 | grant_type 缺失或非 `refresh_token` |
| `invalid_request` | 400 | 缺必需参数 |
| `invalid_client` | 401 | 客户端凭证无效 |
| `invalid_grant` | 401 | token 不存在/已撤销/已过期，或用户不存在 |

**特殊行为**：

- **轮换（rotation）**：每次刷新旧 token 立即 `revoked=1` 并签发新 refresh_token，在 MySQL 事务内以 `SELECT … FOR UPDATE` 保证原子性，防并发重复兑换。
- **Replay 检测**：使用已撤销的 refresh_token 会触发告警并**撤销该 user/client 对的全部 refresh_token**（遏制令牌泄漏）。

---

## POST /api/introspect

令牌内省端点（RFC 7662）。**认证**：body `client_id` + `client_secret`。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `token` | 是 | access_token 或 refresh_token |
| `client_id` / `client_secret` | 是 | 客户端凭证 |

**成功响应**（access token → 含 `exp`；refresh token → `token_type: "refresh_token"`、无 `exp`）：

```json
{ "active": true, "token_type": "Bearer", "scope": "openid profile email", "client_id": "forum", "sub": "1", "exp": 1750000000 }
```

不存在/过期/**不属于请求客户端**的 token 一律返回 `{ "active": false }`——客户端无法探测其他客户端的令牌。

错误：缺 token → 400 `invalid_request`；缺凭证或凭证错误 → 401 `invalid_client`。

Native Mod access token 的 introspection `client_id` 是 `native_auth_clients.token_audience_client_id` 配置的资源服务器客户端（当前默认 `forum`），所以 MindFourm 继续用自身已配置的 OAuth client credentials 校验标准 Bearer token。Native refresh token 只能通过 `/api/native/refresh` 使用。Native Password Login 不属于 OAuth grant，`/api/token`、`/api/refresh` 的标准契约和 OIDC Discovery 不变。

---

## GET /api/userinfo

UserInfo 端点（OIDC Core §5.3）。**认证**：`Authorization: Bearer {access_token}`。无请求参数。

**成功响应**（按 token 的 scope 过滤 claims）：

| scope | 返回字段 |
|------|------|
| 恒有 | `sub`（字符串化用户 ID） |
| `profile` | `name` `id` `username` `avatar_url` `phone_verified` `phone_verified_at` `phone_masked` `ban_status` `is_muted` `updated_at`（Unix 秒），另有 `custom_fields`（仅公开自定义字段有值时出现） |
| `email` | `email` `email_verified` |

错误：缺失/格式错误的 Authorization 头、token 无效或过期、用户不存在 → 401 `invalid_token`。

---

## GET /api/user（旧版兼容）

供旧版 MindFourm 使用的扁平用户信息端点，**不做 scope 过滤**。新接入请用 `/api/userinfo`。**认证**：`Authorization: Bearer {access_token}`。

**成功响应**：

```json
{ "id": 1, "username": "…", "email": "…", "avatar_url": null, "phone_masked": "138****0000", "phone_verified": true, "phone_verified_at": "…", "created_at": "…" }
```

错误：401 `invalid_token`（同 /userinfo）。

---

## POST /api/revoke

令牌撤销端点（RFC 7009）。**认证**：body `client_id` + `client_secret`。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 待撤销的 access_token 或 refresh_token |
| `token_type_hint` | 否 | 被接收但当前实现**未使用**（两类都会尝试） |
| `client_id` / `client_secret` | 是 | 客户端凭证 |

**成功响应**：恒为 `{ "success": true }`——token 不存在、或属于其他客户端（拒绝撤销）时也返回成功（RFC 7009 §2.2），防探测。

错误：缺 token → 400 `invalid_request`；凭证缺失/错误 → 401 `invalid_client`。

**特殊行为**：仅撤销**属于请求客户端**的令牌；refresh_token 按 SHA-256 哈希匹配 MySQL 行置 `revoked=1`。

---

## GET /api/authorizations（内部）

列出当前用户已授权的应用。**认证**：`session` Cookie（requireAuth）。非 OAuth 标准端点，供用户 SPA「授权管理」页使用。

**成功响应**：

```json
{ "success": true, "authorizations": [ { "client_id": "forum", "scope": "openid profile email", "last_used_at": "…", "name": "MindFourm" } ] }
```

失败：500 `{ "success": false, "message": "获取授权列表失败" }`。

---

## DELETE /api/authorizations/:client_id（内部）

撤销当前用户对某应用的授权。**认证**：`session` Cookie + `X-CSRF-Token` 头。

**成功响应**：`{ "success": true, "message": "授权已撤销" }`；授权不存在 → 404 `{ "success": false, "message": "授权不存在" }`。

**特殊行为**：删除 `authorizations` 记录、撤销该 user/client 的**全部** refresh_token、并通过 Redis 索引集失效全部 access_token（不用 SCAN）。

---

## POST /api/verify

会话令牌验证端点（自定义，非 OAuth 标准），供**同域**服务直接校验 `session` Cookie 值。**认证**：body 中的 session_token 本身。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `session_token` | 是 | 用户 `session` Cookie 的原始值 |

**成功响应**：

```json
{ "success": true, "user": { "id": 1, "username": "…", "email": "…", "phone_verified": false, "phone_verified_at": null, "created_at": "…" } }
```

错误：缺 session_token → 400 `invalid_request`；会话无效/过期 → 401 `invalid_grant`。

---

## GET /.well-known/openid-configuration

OIDC Discovery 1.0 / RFC 8414 元数据端点（定义于 `src/app.js`）。无认证。注意：MindAuth 不签发 RS256 ID Token，无 `jwks_uri`；用户信息经 `/api/userinfo` 获取。

**响应**（`baseUrl` 取自 `BASE_URL` 配置）：

```json
{
  "issuer": "{baseUrl}",
  "authorization_endpoint": "{baseUrl}/api/authorize",
  "token_endpoint": "{baseUrl}/api/token",
  "userinfo_endpoint": "{baseUrl}/api/userinfo",
  "revocation_endpoint": "{baseUrl}/api/revoke",
  "introspection_endpoint": "{baseUrl}/api/introspect",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "scopes_supported": ["openid", "profile", "email"],
  "token_endpoint_auth_methods_supported": ["client_secret_post"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

---

## GET /api/health

健康检查端点（定义于 `src/app.js`）。无认证。健康返回 200，降级返回 503。

- **生产**（NODE_ENV=production）：仅返回 `{ "status": "ok" | "degraded" }`（检查 MySQL + Redis）。
- **开发**：额外返回 `timestamp` `uptime` `version` 与 `services` 明细：`database`（`connected (MySQL)`/`error`）、`redis`（`connected`/`error`）、`email`（`configured`/`not configured`/`error`）。
