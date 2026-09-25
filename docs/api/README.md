# MindAuth API 参考

MindAuth 是 Mindustry 社区的 OAuth 2.0 SSO 认证服务（Express，默认端口 4001）。本文档描述所有 API 共享的通用约定，并提供全端点索引；各域端点的请求/响应细节见 [auth.md](auth.md)、[oauth.md](oauth.md)、[account.md](account.md)、[admin.md](admin.md)，整体架构见 [../architecture/overview.md](../architecture/overview.md)。

> **维护提示**：新增/修改任何路由端点时需同步更新本索引及对应域文档。

## Base URL 与前缀

- 默认 Base URL：`http://localhost:4001`（由 `BASE_URL` 环境变量配置）
- 所有 API 挂载在 `/api` 前缀下；管理端为 `/api/admin`
- 唯一的例外是 OIDC Discovery：`GET /.well-known/openid-configuration`
- 请求体为 JSON（`Content-Type: application/json`）；头像/背景上传为 `multipart/form-data`
- 未匹配的 `/api/*` 路径返回 `404`：`{ "success": false, "code": "NOT_FOUND", "message": "接口不存在" }`

## 认证方式

| 方式 | 载体 | 适用端点 |
|------|------|----------|
| 用户会话 | `session` Cookie（httpOnly，30 天） | 账户管理、会话/通知/短信、`/me`、`/authorizations` 等（索引表中标"会话"） |
| 管理会话 | `admin_session` Cookie（httpOnly，24 小时） | 全部 `/api/admin/*`（除 `create`/`login`/`logout` 与测试端点） |
| OAuth Bearer Token | `Authorization: Bearer <access_token>` 头 | `GET /api/userinfo`、`GET /api/user` |
| 客户端凭证 | 请求体中的 `client_id` + `client_secret` | `/api/token`、`/api/refresh`、`/api/introspect`、`/api/revoke` |
| ADMIN_SECRET | 请求体 `secret` 字段 | `POST /api/admin/create`、非生产的 `/api/admin/test/*` |

管理端在 `admin_session` 之上还有 RBAC 权限检查（`requireAdminPermission`），索引表中标注权限名（如 `users.read`）。

## CSRF 约定

采用**签名双提交 Cookie**：服务端下发 `csrf_token` Cookie（值为 `random.HMAC(random)`，仅服务端签发的令牌有效），客户端在 POST/PUT/PATCH/DELETE 请求时以 `X-CSRF-Token` 头原样回传，服务端做时序安全比对 + 签名校验。

- 获取令牌：`GET /api/csrf-token` → `{ "success": true, "csrf_token": "..." }`（同时刷新 Cookie）
- 校验失败返回 `403`：`{ "success": false, "message": "缺少 CSRF token" }` 或 `"CSRF token 无效"`
- GET/HEAD 请求不校验

**豁免路径**（精确匹配，共 15 个：11 个业务端点 + 4 个非生产测试端点，见 `src/middleware/csrf.js`）：

`/api/token`、`/api/refresh`、`/api/introspect`、`/api/revoke`、`/api/verify`、`/api/challenge/random`、`/api/challenge/verify`、`/api/email-verification/verify`、`/api/register`、`/api/login`、`/api/admin/login`，以及非生产环境的 `/api/admin/test/clear-rate-limits`、`/api/admin/test/get-user-id`、`/api/admin/test/verify-email`、`/api/admin/test/create-reset-token`。

## 统一错误格式

绝大多数端点使用统一 JSON 结构（各域文档只写端点特有错误）：

```json
{ "success": false, "message": "人类可读的中文提示" }
```

- 可选 `code` 字段为机器可读错误码（如 `CHALLENGE_REQUIRED`、`USER_BANNED`、`ACCOUNT_LOCKED`、`NOT_FOUND`），部分错误附带附加字段（如 `ban_expires_at`、`locked_until`、`attempts_left`）
- **例外**：OAuth 协议端点（`/token`、`/refresh`、`/introspect`、`/userinfo`、`/user`、`/revoke`、`/verify`）遵循 RFC 6749 格式：`{ "error": "invalid_request", "error_description": "..." }`；`/authorize` 出错时重定向到 `/oauth-error.html`

常见状态码语义：

| 状态码 | 语义 |
|--------|------|
| 400 | 参数缺失/格式无效（OAuth 端为 `invalid_request`/`unsupported_grant_type`） |
| 401 | 未登录、凭证错误、Bearer token 无效（OAuth 端为 `invalid_client`/`invalid_token`） |
| 403 | 无权限、CSRF 失败、账号被封禁、IP 被封禁 |
| 404 | 资源不存在、接口不存在 |
| 409 | 冲突（用户名/邮箱已被使用、field_key 已存在） |
| 423 | 账号已锁定（`ACCOUNT_LOCKED`） |
| 429 | 触发限流 |
| 500 / 503 | 服务器错误 / 依赖服务不可用 |

## 限流

按客户端 IP 的固定窗口计数（Redis，Redis 不可用时内存降级）。命中限流返回 `429`：

```json
{ "success": false, "message": "尝试次数过多，请{N}秒后重试" }
```

主要限额（每 IP）：

| 端点 | 限额 |
|------|------|
| `POST /api/login` | 5 次 / 5 分钟（登录成功后重置） |
| `POST /api/register` | 5 次 / 小时 |
| `POST /api/admin/login` | 3 次 / 15 分钟 |
| `POST /api/admin/create` | 3 次 / 小时 |
| `POST /api/password/reset-request` / `reset` | 3 次 / 小时 与 10 次 / 小时 |
| `POST /api/email-verification/send` | 1 次 / 分钟 |
| `POST /api/register/send-code` | 3 次 / 10 分钟（IP）+ 1 次 / 分钟（email 冷却） |
| `GET /api/challenge/random` / `POST verify` | 30 次 / 分钟 与 15 次 / 5 分钟 |
| OAuth `/authorize` `/token` `/refresh` `/introspect` `/revoke` | 各 60 次 / 分钟 |
| `/userinfo` `/user` `/verify` | 共用 30 次 / 分钟 |
| 管理端 删除用户 / 重置密码 / 创建客户端 | 10、20、20 次 / 小时 |
| 管理端 `test-email` / `test-sms` | 各 5 次 / 10 分钟 |
| `GET /api/public/auth-page-config` | 60 次 / 分钟 |

## 端点总索引

认证列：`无`＝公开；`会话`＝session Cookie；`管理`＝admin_session Cookie（后接 RBAC 权限名）；`Bearer`＝OAuth access_token；`客户端`＝client_id+client_secret。

### 通用（本文档）

| 方法 | 路径 | 认证 | 限流/权限 | 用途 |
|------|------|------|-----------|------|
| GET | `/api/csrf-token` | 无 | — | 获取/刷新 CSRF 令牌 |
| GET | `/api/public/auth-page-config` | 无 | 60/分钟 | 登录页外观公开配置（见下文） |

### Android 与 Mindustry Native Auth

第一方 `mdtbbs_android` 与 `mdtbbs_mindustry` 使用 `/api/v1/native`，不签发 MindAuth Cookie、access token 或 refresh token；成功后只返回 90 秒的一次性 authorization code。两个客户端都必须先创建 transaction 并提供 RFC 7636 `S256` PKCE challenge。`mdtbbs_android` 保留 password/SMS/QQ 方法；`mdtbbs_mindustry` 是独立 public client，只允许 password method，且不配置客户端 secret。`POST /api/v1/native/auth/exchange` 仅供 MindFourm 后端调用，必须携带部署环境配置的 `NATIVE_MINDFOURM_CLIENT_SECRET`（可用 `X-Mindfourm-Client-Secret` 传递），绝不可进入 APK 或 Mod jar。

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/v1/native/auth/transactions` | 创建 10 分钟 AuthTransaction |
| POST | `/api/v1/native/auth/transactions/:id/password` | 密码认证并返回 authorization code |
| POST | `/api/v1/native/auth/transactions/:id/sms/send` | 发送 5 分钟短信 challenge |
| POST | `/api/v1/native/auth/transactions/:id/sms/verify` | 使用同一 canonical phone 验证 challenge 并返回 authorization code |
| POST | `/api/v1/native/auth/transactions/:id/qq` | 使用 QQ SDK authorization code 完成已绑定账号登录 |
| POST | `/api/v1/native/register` | 以已验证 SMS challenge 注册（额外需要 email，匹配现有 users 非空邮箱约束） |
| POST | `/api/v1/native/phone/send` | 使用 MindFourm 签发的 phone-action ticket 发送验证短信 |
| POST | `/api/v1/native/phone/verify` | 使用同一 ticket 消费短信 challenge 并绑定手机号 |
| POST | `/api/v1/native/auth/exchange` | MindFourm 服务端原子消费授权码、校验 PKCE |

Native 错误统一为 `{ "error": { "code", "message", "retryable", "details": [] } }`。敏感值（密码、短信码、QQ token、authorization code、PKCE verifier）不会写日志、审计表或 Redis。

短信 challenge 仅保存手机号的 HMAC，用于 challenge 绑定与限流；验证码校验请求必须再次携带 `phone`。服务先比对 HMAC，再以 canonical phone 精确查询 `users.phone`，从而保持既有账号映射且不把 HMAC 当作数据库身份键。

手机号验证票据格式为 `npa.<base64url-json>.<base64url-hmac>`；MindFourm 使用 `NATIVE_PHONE_ACTION_SECRET` 以 HMAC-SHA-256 签发，claims 必须含整数 `sub`、唯一 `jti`、`aud: "mindauth-native-phone"` 与短期 Unix `exp`。票据只能由 MindFourm 后端签发，Android 仅在 `Authorization: Bearer` 转交。

### MDTBBS Mindustry Mod 原生会话

`/api/native/*` 仅面向 MDTBBS 官方 public client `mdtbbs-mindustry-mod`。客户端不含 `client_secret`；`client_id` 只是可伪造的产品标识，不是信任凭证。**第三方应用禁止使用 Native Password Login**，第三方仍须走 OAuth Authorization Code + PKCE。生产客户端必须仅使用 `https://auth.mdtbbs.cn`，不得忽略证书错误或回退到 HTTP。`device_id` 是本地随机 UUID，不得由硬件标识生成，也不是身份验证因子。

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/native/login` | 使用用户名/邮箱与密码建立一个 Mod 设备会话 |
| POST | `/api/native/refresh` | 轮换当前设备的 refresh token |
| POST | `/api/native/logout` | 用 Bearer access token（或绑定设备的 refresh token）注销当前 Mod 设备会话 |
| GET | `/api/native/me` | 返回当前用户的最小资料 |

登录请求为 `{client_id, username, password, device_id, device_name?}`；刷新为 `{client_id, refresh_token, device_id}`。成功响应沿用 OAuth Token 字段（`access_token`、`refresh_token`、`token_type`、`expires_in`、`scope`），登录额外返回 `success: true`。默认 scope 为 `openid profile game_content`。Native access token 仍是 Redis 中标准 Bearer token，audience client 由 `native_auth_clients.token_audience_client_id` 指向 MindFourm OAuth client（默认 `forum`），可由现有 `/api/introspect`、`/api/userinfo` 验证；不会向 OIDC Discovery 宣称支持 password grant。

Native 错误采用共享 API JSON 结构 `{success:false, code, message}`；常见 code 为 `INVALID_CLIENT`、`INVALID_REQUEST`、`INVALID_CREDENTIALS`、`ACCOUNT_LOCKED`、`USER_BANNED`、`INVALID_REFRESH_TOKEN`、`SESSION_REVOKED`、`RATE_LIMITED`。Native POST 只在 CSRF middleware 中按完整路径精确豁免；授权仍只依赖密码或 Bearer/refresh token、TLS、限流与账号锁定。

**`GET /api/public/auth-page-config`**（`src/routes/public.js`）：返回认证页（登录/注册等）的公开外观配置，当前仅自定义背景图 URL：`{ "success": true, "background_url": "/uploads/backgrounds/..." | null }`（`null` 表示前端使用默认网格背景）。限流前缀 `ratelimit:public_config`（60 次/分钟），响应带 `Cache-Control: public, max-age=60`。背景图由管理端 `POST/DELETE /api/admin/auth-background` 维护，见 [admin.md](admin.md)。

### 认证域 — 详见 [auth.md](auth.md)

| 方法 | 路径 | 认证 | 限流/权限 | 用途 |
|------|------|------|-----------|------|
| POST | `/api/register/send-code` | 无 | 3/10分钟（IP）+ 1/分钟（email 冷却） | 注册前发送 6 位邮箱验证码 |
| POST | `/api/register` | 无 | 5/小时 | 用户注册（需携带 `email_code`，可能要求问答验证） |
| POST | `/api/login` | 无 | 5/5分钟 | 用户名或邮箱登录，下发 session Cookie |
| POST | `/api/logout` | 会话 | — | 登出并吊销当前会话 |
| GET | `/logout` | 无（幂等） | — | SLO 浏览器登出；按注册白名单重定向回调用方（需 `redirect_uri` + `client_id`，详见 [auth.md](auth.md)） |
| GET | `/api/me` | 会话 | — | 当前用户信息 |
| GET | `/api/login-logs` | 会话 | — | 最近 20 条登录记录 |
| GET | `/api/challenge/random` | 无 | 30/分钟 | 获取随机验证问答题 |
| POST | `/api/challenge/verify` | 无 | 15/5分钟 | 校验问答答案 |
| POST | `/api/password/reset-request` | 无 | 3/小时 | 发送密码重置邮件 |
| POST | `/api/password/reset` | 无 | 10/小时 | 用令牌执行密码重置 |
| POST | `/api/email-verification/send` | 会话 | 1/分钟 | 发送邮箱验证邮件 |
| POST | `/api/email-verification/verify` | 无 | — | 用令牌验证邮箱 |
| GET | `/api/email-verification/status` | 会话 | — | 查询邮箱验证状态 |

### OAuth 域 — 详见 [oauth.md](oauth.md)

| 方法 | 路径 | 认证 | 限流/权限 | 用途 |
|------|------|------|-----------|------|
| GET | `/.well-known/openid-configuration` | 无 | — | OIDC Discovery 元数据 |
| GET | `/api/authorize` | 会话(浏览器) | 60/分钟 | 授权端点，签发授权码（PKCE S256） |
| POST | `/api/token` | 客户端 | 60/分钟 | 授权码换取 access/refresh token |
| POST | `/api/refresh` | 客户端 | 60/分钟 | 刷新 access token |
| POST | `/api/introspect` | 客户端 | 60/分钟 | 令牌内省（RFC 7662） |
| POST | `/api/revoke` | 客户端 | 60/分钟 | 令牌吊销（RFC 7009） |
| GET | `/api/userinfo` | Bearer | 30/分钟 | OIDC 用户信息 |
| GET | `/api/user` | Bearer | 30/分钟 | 用户信息（旧版 MindFourm 兼容端点，不供新接入） |
| POST | `/api/verify` | 无 | 30/分钟 | 会话令牌验证（内部同域场景） |
| GET | `/api/authorizations` | 会话 | — | 当前用户已授权应用列表（内部） |
| DELETE | `/api/authorizations/:client_id` | 会话 + CSRF | — | 撤销对某应用的授权（内部） |
| GET | `/api/health` | 无 | — | 健康检查（MySQL + Redis） |

当前代码还包含 RFC 8628 设备授权路由 `/api/device/code`、`/api/device/verify`、`/api/device/approve` 和 `/api/device/token`。它们不属于第三方公开契约；旧版 [DEVICE_AUTH.md](../DEVICE_AUTH.md) 所列路径和流程与运行时代码不一致，详情见 [OAuth API 参考](oauth.md)。

### 账户域 — 详见 [account.md](account.md)

| 方法 | 路径 | 认证 | 限流/权限 | 用途 |
|------|------|------|-----------|------|
| POST | `/api/account/change-password` | 会话 | — | 修改密码（吊销全部会话） |
| POST | `/api/account/change-email` | 会话 | — | 发起邮箱更换（邮件确认） |
| DELETE | `/api/account/` | 会话 | — | 删除账号（需密码确认） |
| POST | `/api/account/avatar` | 会话 | — | 上传头像（≤2MB） |
| DELETE | `/api/account/avatar` | 会话 | — | 删除头像 |
| POST | `/api/account/banner` | 会话 | — | 上传背景图（≤5MB） |
| DELETE | `/api/account/banner` | 会话 | — | 删除背景图 |
| GET | `/api/account/fields` | 会话 | — | 获取自定义字段值 |
| PUT | `/api/account/fields` | 会话 | — | 更新自定义字段值 |
| GET | `/api/account/audit-logs` | 会话 | — | 本人安全审计日志 |
| GET | `/api/sessions` | 会话 | — | 活跃会话列表 |
| DELETE | `/api/sessions/:id` | 会话 | — | 注销指定会话（设备下线） |
| POST | `/api/sms/send` | 会话 | 模块内限流 | 发送短信验证码 |
| POST | `/api/sms/verify` | 会话 | 模块内限流 | 校验验证码并绑定手机 |
| GET | `/api/notifications` | 会话 | — | 通知列表（分页） |
| GET | `/api/notifications/unread-count` | 会话 | — | 未读通知数 |
| PATCH | `/api/notifications/:id/read` | 会话 | — | 标记单条已读 |
| PATCH | `/api/notifications/read-all` | 会话 | — | 全部标记已读 |
| DELETE | `/api/notifications/:id` | 会话 | — | 删除通知 |

### 管理域 — 详见 [admin.md](admin.md)

| 方法 | 路径 | 认证 | 限流/权限 | 用途 |
|------|------|------|-----------|------|
| POST | `/api/admin/create` | ADMIN_SECRET | 3/小时 | 创建超级管理员 |
| POST | `/api/admin/login` | 无 | 3/15分钟 | 管理员登录 |
| POST | `/api/admin/logout` | — | — | 管理员登出 |
| GET | `/api/admin/me` | 管理 | — | 当前管理员信息与权限 |
| GET | `/api/admin/users` | 管理 | `users.read` | 用户列表（搜索/分页） |
| GET | `/api/admin/users/:id` | 管理 | `users.read` | 用户详情及关联活动 |
| PUT | `/api/admin/users/:id` | 管理 | `users.write` | 更新用户（角色/用户名等） |
| DELETE | `/api/admin/users/:id` | 管理 | `users.delete`；10/小时 | 删除用户 |
| POST | `/api/admin/users/:id/reset-password` | 管理 | `users.reset_password`；20/小时 | 重置用户密码 |
| POST | `/api/admin/users/:id/ban` | 管理 | `users.ban` | 封禁用户 |
| POST | `/api/admin/users/:id/mute` | 管理 | `users.ban` | 禁言用户 |
| DELETE | `/api/admin/users/:id/ban` | 管理 | `users.ban` | 解封/解除禁言 |
| POST | `/api/admin/users/:id/unlock` | 管理 | `users.unlock` | 解锁被锁定账号 |
| GET | `/api/admin/clients` | 管理 | `clients.read` | OAuth 客户端列表 |
| POST | `/api/admin/clients` | 管理 | `clients.write`；20/小时 | 创建客户端 |
| PUT | `/api/admin/clients/:id` | 管理 | `clients.write` | 更新客户端 |
| POST | `/api/admin/clients/:id/rotate-secret` | 管理 | `clients.write` | 轮换客户端密钥（新 secret 仅回显一次） |
| DELETE | `/api/admin/clients/:id` | 管理 | `clients.write` | 删除客户端 |
| GET | `/api/admin/stats` | 管理 | — | 仪表盘统计 |
| GET | `/api/admin/email-config` | 管理 | `email_config.read` | 读取 SMTP 配置（脱敏） |
| PUT | `/api/admin/email-config` | 管理 | `email_config.write` | 更新 SMTP 配置 |
| POST | `/api/admin/test-email` | 管理 | `email_config.write`；5/10分钟 | 发送测试邮件 |
| GET | `/api/admin/sms-config` | 管理 | `sms_config.read` | 读取阿里云短信配置（脱敏） |
| PUT | `/api/admin/sms-config` | 管理 | `sms_config.write` | 更新短信配置 |
| POST | `/api/admin/test-sms` | 管理 | `sms_config.write`；5/10分钟 | 发送测试短信 |
| GET | `/api/admin/config` | 管理 | `config.read` | 读取系统配置 |
| PUT | `/api/admin/config/:key` | 管理 | `config.write` | 更新单项系统配置 |
| POST | `/api/admin/auth-background` | 管理 | `config.write` | 上传登录页自定义背景图（≤5MB，JPEG/PNG/WebP） |
| DELETE | `/api/admin/auth-background` | 管理 | `config.write` | 恢复默认登录页背景 |
| GET | `/api/admin/authorizations` | 管理 | `authorizations.read` | 全部授权记录 |
| DELETE | `/api/admin/authorizations/:id` | 管理 | `users.write` | 撤销授权记录并吊销其令牌 |
| GET | `/api/admin/login-logs` | 管理 | `login_logs.read` | 登录日志（可筛选） |
| GET | `/api/admin/ip-bans` | 管理 | `ip_bans.read` | IP 黑名单列表 |
| POST | `/api/admin/ip-bans` | 管理 | `ip_bans.write` | 添加 IP 封禁（IPv4/IPv6，支持 CIDR） |
| PUT | `/api/admin/ip-bans/:id` | 管理 | `ip_bans.write` | 更新封禁原因/期限 |
| DELETE | `/api/admin/ip-bans/:id` | 管理 | `ip_bans.write` | 删除 IP 封禁 |
| GET | `/api/admin/challenges` | 管理 | `config.read` | 问答题库列表 |
| POST | `/api/admin/challenges` | 管理 | `config.write` | 新增题目 |
| PUT | `/api/admin/challenges/:id` | 管理 | `config.write` | 更新题目 |
| DELETE | `/api/admin/challenges/:id` | 管理 | `config.write` | 删除题目 |
| PATCH | `/api/admin/challenges/:id/toggle` | 管理 | `config.write` | 启用/禁用题目 |
| GET | `/api/admin/user-fields` | 管理 | `config.read` | 自定义字段定义列表 |
| POST | `/api/admin/user-fields` | 管理 | `config.write` | 创建字段定义 |
| PUT | `/api/admin/user-fields/:id` | 管理 | `config.write` | 更新字段定义 |
| DELETE | `/api/admin/user-fields/:id` | 管理 | `config.write` | 删除字段定义（级联删值） |
| PATCH | `/api/admin/user-fields/sort` | 管理 | `config.write` | 更新字段排序 |
| GET | `/api/admin/audit-logs` | 管理 | `audit_logs.read` | 管理员审计日志（可筛选） |
| GET | `/api/admin/sms-audit-logs` | 管理 | `sms_audit.read` | 短信审计日志（可筛选） |

## 开发/测试专用端点

以下 4 个端点**仅在 `NODE_ENV !== 'production'` 时注册**（生产环境不存在），均要求请求体 `secret` 字段等于 `ADMIN_SECRET`（时序安全比对，错误返回 403），且全部在 CSRF 豁免清单中：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/admin/test/clear-rate-limits` | 清空所有 `ratelimit:*` / `admin:*` 计数 |
| POST | `/api/admin/test/create-reset-token` | 为指定 `user_id` 生成密码重置令牌并返回原文 |
| POST | `/api/admin/test/verify-email` | 直接将指定用户邮箱置为已验证 |
| POST | `/api/admin/test/get-user-id` | 按 `username` 查询用户 ID |
