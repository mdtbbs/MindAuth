# OAuth / OIDC API

MindAuth OAuth 2.0 / OIDC 域的端点参考，涵盖协议端点、授权管理端点、发现端点与健康检查。

> **维护提示**：修改 src/routes/oauth.js、src/modules/oauth/* 时需同步更新本文档及 [../third-party-integration.md](../third-party-integration.md)。

> **文档分工**：第三方接入教程见 [../third-party-integration.md](../third-party-integration.md) 和 [Public Client PKCE 指南](../public-client-pkce.md)。桌面、移动和浏览器原生客户端使用无 secret 的 Public Client + Authorization Code + PKCE S256；服务端集成继续使用 Confidential Client。RFC 8628 设备授权端点暂未纳入稳定外部契约。

**通用说明**：

- 路由适配层：`src/routes/oauth.js`（挂载于 `/api`）；业务逻辑：`src/modules/oauth/oauthIssuer.js`。
- 协议端点请求体为 **JSON**（`Content-Type: application/json`），不支持 form-encoded。
- 对外接入流程和服务端示例见 [第三方 OAuth 接入指南](../third-party-integration.md)。MindAuth 发布 Discovery 和 UserInfo，但不签发 ID Token、也不提供 `jwks_uri`；依赖签名 ID Token 验证的客户端不适用于当前契约。
- 当前公开契约端点：`GET /api/authorize`、`POST /api/token`、`GET /api/userinfo`、`POST /api/introspect`、`POST /api/revoke` 和 `GET /.well-known/openid-configuration`。`/api/token` 同时接收授权码和 refresh grant。旧 `POST /api/refresh` 暂作兼容。
- 当前代码还保留 RFC 8628 设备授权实现，但运行时挂载路径是 `/api/device/*`，旧文档使用的 `/api/oauth/device/*` 与实际路由不符；验证链接和审批表单也尚未与 CSRF/请求体处理对齐，因此不应作为已发布接口使用。细节见 [设备授权内部实现参考](../DEVICE_AUTH.md)。
- 标准错误格式（RFC 6749）：`{ "error": "<code>", "error_description": "<中文描述>" }`。未捕获异常返回 `500 server_error`。
- CSRF：`/token` `/refresh` `/introspect` `/revoke` `/verify` 在豁免名单中；`DELETE /authorizations/:client_id` **需要** `X-CSRF-Token`。
- 速率限制（按 IP）：`/authorize` `/token` `/refresh` `/introspect` `/revoke` 各 60 次/分钟；`/userinfo` `/user` `/verify` 共享 30 次/分钟（`ratelimit:verify_api`）。

---

## GET /api/authorize

授权端点（RFC 6749 §4.1.1），发起授权码流程。**认证**：浏览器 `session` Cookie（未登录时重定向到登录页）。

| 参数（query） | 必填 | 说明 |
|------|------|------|
| `client_id` | 是 | 应用标识 |
| `redirect_uri` | 是 | 必须匹配应用已注册的一个 URI。HTTPS 和自定义 scheme 精确匹配；loopback 只允许 `127.0.0.1` / `[::1]`，注册端口 `0` 时可匹配该 literal 上的随机运行时端口 |
| `state` | Public 必填 | 防 CSRF 随机串，原样附加到回调 |
| `scope` | 否 | 空格分隔，必须同时属于系统 scope 与该应用批准的 scope；缺省使用应用批准的全部 scope |
| `response_type` | 否 | 若提供必须为 `code` |
| `code_challenge` | Public 必填 | PKCE challenge = Base64URL(SHA256(code_verifier)) |
| `code_challenge_method` | Public 必填 | 必须是 `S256`；不接受 `plain` |

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
| `invalid_scope` | scope 不在系统支持列表或不属于该客户端获批范围 |
| `server_error` | 未捕获异常 |

**特殊行为**：Public Client 必须提供不可预测的 `state`。授权码 Redis 存储，**5 分钟 TTL、单次消费**（GETDEL 原子取出）。首次授权或请求此前未授予的 scope 时会显示同意页；缩小到已有 scope 子集可继续授权。批准后的 scope 写回现有 `authorizations` 记录。

---

## POST /api/token

令牌端点。`authorization_code` grant 兼容 RFC 6749 §4.1.3；`refresh_token` grant 也通过此路径完成。Confidential Client 使用 `client_id` + `client_secret`；Public Client 不发送 secret。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | `authorization_code` 或 `refresh_token` |
| `code` | 授权码 grant 必填 | 授权码 |
| `redirect_uri` | 授权码 grant 必填 | 必须与签发授权码时一致 |
| `refresh_token` | refresh grant 必填 | 当前 refresh token |
| `client_id` | 是 | 应用标识 |
| `client_secret` | Confidential 必填 | Public Client 不拥有 secret，也不能伪造形式 secret |
| `code_verifier` | Public 必填 | 必须匹配授权时的 S256 challenge |

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
| `unsupported_grant_type` | 400 | grant_type 不受支持；或存储的 code_challenge_method 非 S256 |
| `invalid_request` | 400 | 缺当前 grant 必需参数；Public Client 缺 code_verifier |
| `invalid_client` | 401 | client_id / Confidential secret 无效，或 Client 未批准/已停用 |
| `invalid_grant` | 401 | code 无效/过期/已使用；code 与 client_id 不匹配；redirect_uri 不匹配；code_verifier 校验失败；授权用户不存在 |

**特殊行为**：access_token 存 Redis（1h TTL，带 user/client 索引集）；refresh_token 存 MySQL（SHA-256 哈希，30 天）。

---

## POST /api/refresh（兼容路径）

旧版刷新端点，仍调用相同的 refresh rotation 实现。新客户端应 POST `/api/token` 并使用 `grant_type=refresh_token`。Confidential Client 提供 secret；Public Client 只需 `client_id`。

> **兼容提示：** `/api/refresh` 不会立即删除，但新 SDK 应使用标准 `/api/token`。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | 必须为 `refresh_token` |
| `refresh_token` | 是 | 待轮换的刷新令牌 |
| `client_id` | 是 | 应用标识 |
| `client_secret` | Confidential 必填 | Public Client 不发送 |

**成功响应**：与 `/token` 相同结构（access_token / token_type / refresh_token / expires_in / scope）。

| error 码 | HTTP | 触发条件 |
|------|------|------|
| `unsupported_grant_type` | 400 | grant_type 缺失或非 `refresh_token` |
| `invalid_request` | 400 | 缺必需参数 |
| `invalid_client` | 401 | 客户端凭证无效 |
| `invalid_grant` | 401 | token 不存在/已撤销/已过期，或用户不存在 |

**特殊行为**：

- **轮换（rotation）**：每次刷新旧 token 立即 `revoked=1` 并签发新 refresh_token，在 MySQL 事务内以 `SELECT … FOR UPDATE` 保证原子性，防并发重复兑换。
- **Replay 检测**：重放已撤销的 refresh_token 会触发告警并返回 `401 invalid_grant`。当前事务在错误时回滚，因此不会联动撤销该 user/client 对的其他 refresh_token；不要依赖重放触发全量吊销。怀疑泄漏时应显式撤销用户对该客户端的授权。

---

## POST /api/introspect

令牌内省端点（RFC 7662），仅供可信 Resource Server 使用。调用方必须是已批准的 Confidential Client，不能使用 Public Client 凭证探测 token。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `token` | 是 | access_token 或 refresh_token |
| `client_id` / `client_secret` | 是 | 已批准 Confidential Resource Server 凭证 |

**成功响应**（access token → 含 `exp`；refresh token → `token_type: "refresh_token"`、无 `exp`）：

```json
{ "active": true, "token_type": "Bearer", "scope": "openid profile forum.read", "client_id": "desktop-app", "client_type": "public", "party_type": "third_party", "sub": "1", "exp": 1750000000 }
```

不存在或过期的 token 返回 `{ "active": false }`。普通 Confidential Client 只能内省自己签发的 token；配置为可信 Resource Server 的 `forum` Confidential Client 还可内省第三方 Public Client token，以便 MindFourm 验证论坛 API scope。响应中的 `client_id`、`client_type`、`party_type` 描述 token 的签发客户端，而不是内省调用方。

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

> 当前 `updated_at` 的实现值取自账号的 `created_at`，不是最近修改时间。第三方不要将其解释为资料更新时间；如需可靠更新时间，应忽略该 claim，等待契约修正。

错误：缺失/格式错误的 Authorization 头、token 无效或过期、用户不存在 → 401 `invalid_token`。

---

## GET /api/user（旧版兼容）

供旧版 MindFourm 使用的扁平用户信息端点，**不做 scope 过滤**。新接入请用 `/api/userinfo`。**认证**：`Authorization: Bearer {access_token}`。该端点不属于新第三方接入契约。

**成功响应**：

```json
{ "id": 1, "username": "…", "email": "…", "avatar_url": null, "phone_masked": "138****0000", "phone_verified": true, "phone_verified_at": "…", "created_at": "…" }
```

错误：401 `invalid_token`（同 /userinfo）。

---

## POST /api/revoke

令牌撤销端点（RFC 7009）。Confidential Client 提供 secret；Public Client 可使用 `client_id` 撤销自己的 token。

| 参数（body） | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 待撤销的 access_token 或 refresh_token |
| `token_type_hint` | 否 | 被接收但当前实现**未使用**（两类都会尝试） |
| `client_id` | 是 | 应用标识 |
| `client_secret` | Confidential 必填 | Public Client 不发送 |

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

## POST /api/verify（内部）

会话令牌验证端点（自定义，非 OAuth 标准），供**同域内部服务**直接校验 `session` Cookie 值。**认证**：body 中的 session_token 本身。此端点不属于第三方接入方式；不要读取、传递或验证 MindAuth 浏览器 session Cookie 来实现跨站登录。

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

新客户端对 Discovery 返回的 `token_endpoint` 使用 `authorization_code` 和 `refresh_token` grants。`/api/refresh` 是向后兼容路径。

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
  "scopes_supported": ["openid", "profile", "email", "forum.read", "forum.write", "resource.read", "resource.download", "resource.upload", "notification.read", "message.read", "message.write"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

---

## GET /api/health

健康检查端点（定义于 `src/app.js`）。无认证。健康返回 200，降级返回 503。

- **生产**（NODE_ENV=production）：仅返回 `{ "status": "ok" | "degraded" }`（检查 MySQL + Redis）。
- **开发**：额外返回 `timestamp` `uptime` `version` 与 `services` 明细：`database`（`connected (MySQL)`/`error`）、`redis`（`connected`/`error`）、`email`（`configured`/`not configured`/`error`）。
