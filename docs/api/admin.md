# 管理端 API

MindAuth 管理端 API（挂载于 `/api/admin`），覆盖管理员账号、用户管理、OAuth 客户端、IP 封禁、挑战题库、自定义字段、系统配置与各类日志查询。通用约定（响应包裹、错误格式、分页等）见 [README.md](README.md)。

> **维护提示**：修改 src/routes/admin/**、src/middleware/requireAdmin.js（权限模型）时需同步更新本文档。

## 认证与权限模型

### 获取 admin_session

1. **创建管理员**：`POST /api/admin/create`，body 携带 `secret`（环境变量 `ADMIN_SECRET`，生产环境要求 ≥32 字符）+ `username` / `email` / `password`。创建的账号角色固定为 `super_admin`。
2. **管理员登录**：`POST /api/admin/login`，body 携带 `username` / `password`。成功后服务端下发 `admin_session` Cookie（httpOnly，24 小时有效），并返回当前角色与权限列表。

除 `create` / `login` / `logout` 与测试端点外，所有端点均要求有效的 `admin_session` Cookie（`requireAdmin` 中间件），多数还叠加 `requireAdminPermission('<permission>')` 权限校验。未登录返回 401，权限不足返回 403。

**CSRF**：管理端写操作（POST/PUT/PATCH/DELETE）同样受签名双提交 CSRF 保护，需携带 `X-CSRF-Token` 请求头（与 `csrf_token` Cookie 匹配）。豁免路径仅有 `/api/admin/login` 和非生产环境的 4 个 `/api/admin/test/*`；注意 **`POST /api/admin/create` 不在豁免列表内**，需先取得 CSRF token。

### ROLE_PERMISSIONS 角色权限表

来源：`src/middleware/requireAdmin.js`。角色 `admin` 为历史遗留别名，规范化为 `super_admin`。

| 角色 | 权限 |
|------|------|
| `super_admin` | `*`（全部权限） |
| `user_admin` | `users.read`, `users.write`, `users.reset_password`, `users.delete`, `users.ban`, `users.unlock`, `authorizations.read`, `login_logs.read` |
| `security_admin` | `users.read`, `users.ban`, `users.unlock`, `audit_logs.read`, `sms_audit.read`, `ip_bans.read`, `ip_bans.write` |
| `config_admin` | `config.read`, `config.write`, `clients.read`, `clients.write`, `sms_config.read`, `sms_config.write`, `email_config.read`, `email_config.write` |
| `readonly_admin` | `users.read`, `authorizations.read`, `login_logs.read`, `audit_logs.read`, `sms_audit.read`, `clients.read`, `config.read`, `sms_config.read`, `email_config.read`, `ip_bans.read` |

额外约束（`users.js` 内实现，权限之上叠加）：

- 对管理员角色账号的操作（改角色/删除/封禁等）仅 `super_admin` 可执行；
- 不能对自己的账号执行删除/封禁/禁言/自降级；
- 不能删除、封禁或降级**最后一个** `super_admin`/`admin`。

## 管理员会话（auth.js）

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| POST | `/api/admin/create` | 无（需 `secret`=ADMIN_SECRET） | 3 次/小时 | `secret`, `username`, `email`, `password` | 创建 `super_admin` 账号；成功 201；密钥错误 401，用户名/邮箱冲突 409 |
| POST | `/api/admin/login` | 无 | 3 次/15 分钟 | `username`, `password` | 仅限管理员角色账号；受封禁/锁定检查（403/423）；成功下发 `admin_session` Cookie，返回 `user`（含 `role`、`permissions`） |
| POST | `/api/admin/logout` | 无（有 Cookie 即注销） | — | — | 删除会话并清除 Cookie |
| GET | `/api/admin/me` | 登录即可 | — | — | 返回当前管理员 `admin`（id/username/email/role/permissions） |

## 用户管理（users.js）

挂载于 `/api/admin/users`。

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/users` | `users.read` | — | query: `search`, `role`, `page`, `limit`(≤100，默认 50) | 用户列表；`role=admin` 时匹配 `admin`+`super_admin`；仅当同时传 `page`+`limit` 才返回 `pagination` |
| GET | `/api/admin/users/:id` | `users.read` | — | — | 用户详情 + 关联活动（`authorizations` / `login_logs` / `sms_logs` / `notifications` / `audit_logs` / `sessions`，各取最近 20 条） |
| PUT | `/api/admin/users/:id` | `users.write` | — | `role`, `email_verified`, `username`（均可选） | 更新用户；涉及管理员角色需 super_admin；降级管理员会吊销其管理会话 |
| DELETE | `/api/admin/users/:id` | `users.delete` | 10 次/小时 | — | 删除用户及其授权/refresh_token/登录日志/会话（事务）；先吊销全部会话 |
| POST | `/api/admin/users/:id/reset-password` | `users.reset_password` | 20 次/小时 | — | 生成 16 位十六进制临时密码并邮件发送；同时吊销全部会话与 refresh_token；**生产环境响应绝不回传临时密码**（开发环境且未配邮件时返回 `tempPassword`） |
| POST | `/api/admin/users/:id/ban` | `users.ban` | — | `reason`, `duration`, `expires_at` | 封禁用户（见下文） |
| POST | `/api/admin/users/:id/mute` | `users.ban` | — | `reason`, `duration`, `expires_at` | 禁言（`ban_status='muted'`），不吊销会话，不发通知 |
| DELETE | `/api/admin/users/:id/ban` | `users.ban` | — | — | 解封/解除禁言（`ban_status` 复位为 `none`），发站内+邮件通知 |
| POST | `/api/admin/users/:id/unlock` | `users.unlock` | — | — | 解锁账号（`lock_level=0`, `locked_until=NULL`），写用户侧审计 |

### 封禁 / 禁言 body 结构

```json
{
  "reason": "刷屏",            // 可选，封禁原因
  "duration": "7d",            // 可选：24h | 7d | 30d | permanent
  "expires_at": "2026-08-01T00:00:00Z"  // 可选，显式到期时间（优先于 duration）
}
```

规则：`expires_at` 存在时直接使用；否则按 `duration` 计算；`duration` 缺省或为 `permanent`（或无法识别）时为**永久**（`ban_expires_at=NULL`）。响应含 `ban_expires_at`。封禁会立即吊销目标用户的全部用户会话与管理会话，并发送站内通知 + 邮件（type `account_banned`）。

## OAuth 客户端管理（clients.js）

挂载于 `/api/admin/clients`。底层为 `src/modules/admin/clientRegistry.js`。

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/clients` | `clients.read` | — | — | 列表：`id, name, client_id, redirect_uri, require_pkce, created_at`（**不含 secret**） |
| POST | `/api/admin/clients` | `clients.write` | 20 次/小时 | `name`*, `redirect_uri`*, `require_pkce` | 创建客户端（见下文） |
| PUT | `/api/admin/clients/:id` | `clients.write` | — | `name`*, `redirect_uri`*, `require_pkce` | 更新；`require_pkce` 省略时不改动该标志；`redirect_uri` 同样过 SSRF 校验 |
| DELETE | `/api/admin/clients/:id` | `clients.write` | — | — | 删除客户端 |

### 创建客户端与 secret 返回时机

`POST /api/admin/clients` 成功返回 201：

```json
{ "success": true, "client_id": "<16字节hex>", "client_secret": "<32字节hex>" }
```

**`client_secret` 仅在创建响应中返回一次**；`GET /clients` 列表不回显 secret，之后无法再次查询。如需更换可调用 `clientRegistry.rotateSecret`（模块已实现，当前未暴露 HTTP 路由）。

`redirect_uri` 校验（`validateRedirectUri`）：必须是合法 URL、协议限 `http`/`https`，且禁止内网/本机地址（localhost、`127.0.0.1`、`*.local`、RFC1918 私网段、链路本地 169.254.x.x、云元数据地址等），否则 400 返回具体原因。所有变更写入 `client.*` 审计记录。

## IP 封禁（ipBans.js）

挂载于 `/api/admin/ip-bans`。变更后自动刷新 `ipBanMatcher` 缓存并写审计。

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/ip-bans` | `ip_bans.read` | — | query: `page`, `limit`(≤100，默认 50) | 分页列表，返回 `bans` + `pagination` |
| POST | `/api/admin/ip-bans` | `ip_bans.write` | — | `ip`*, `cidr_prefix`, `reason`, `expires_at` | 新增封禁（见下文） |
| PUT | `/api/admin/ip-bans/:id` | `ip_bans.write` | — | `reason`, `expires_at` | 仅可更新原因与到期时间（两者省略即置 NULL） |
| DELETE | `/api/admin/ip-bans/:id` | `ip_bans.write` | — | — | 删除封禁记录 |

### 新增 IP 封禁 body

```json
{
  "ip": "203.0.113.0",       // 必填，本路由仅接受 IPv4 点分格式
  "cidr_prefix": 24,          // 可选，0-32；提供后按 CIDR 网段封禁
  "reason": "扫描攻击",       // 可选
  "expires_at": "2026-08-01 00:00:00"  // 可选，MySQL DATETIME 可解析的时间；省略为永久
}
```

响应含新记录 `id`。说明：写入端点校验限 IPv4（`cidr_prefix` 0–32）；匹配引擎 `ipBanMatcher` 本身支持 IPv4/IPv6（BigInt 128 位），IPv6 记录需直接落库。

## 挑战题库（challenges.js）

挂载于 `/api/admin/challenges`。答案以 bcrypt 哈希存储，接口不回显明文答案。

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/challenges` | `config.read` | — | — | 列出全部题目 |
| POST | `/api/admin/challenges` | `config.write` | — | `question`*, `answer`* | 新增题目，返回 `id` |
| PUT | `/api/admin/challenges/:id` | `config.write` | — | `question`, `answer`（至少一项） | 更新题目/答案 |
| DELETE | `/api/admin/challenges/:id` | `config.write` | — | — | 删除题目 |
| PATCH | `/api/admin/challenges/:id/toggle` | `config.write` | — | `enabled`(boolean) | 启用/禁用题目 |

## 自定义用户字段（userFields.js）

挂载于 `/api/admin/user-fields`。

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/user-fields` | `config.read` | — | — | 按 `sort_order` 列出全部字段定义 |
| POST | `/api/admin/user-fields` | `config.write` | — | `field_key`*, `field_label`*, `field_type`, `is_required`, `is_public`, `options` | 创建字段；`field_key` 须匹配 `^[a-z][a-z0-9_]{1,30}$` 且唯一（冲突 409）；`field_type` ∈ `text/textarea/number/select/url`（默认 `text`）；`select` 必须提供 `options.choices` 数组；`is_public` 默认 true |
| PUT | `/api/admin/user-fields/:id` | `config.write` | — | 上述字段（除 `field_key`）任选 | 部分更新 |
| DELETE | `/api/admin/user-fields/:id` | `config.write` | — | — | 删除字段（级联删除用户填写值） |
| PATCH | `/api/admin/user-fields/sort` | `config.write` | — | `orders`: `[{id, sort_order}, ...]` | 批量更新排序 |

## 统计与系统配置（settings.js）

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/stats` | 登录即可（无权限点） | — | — | 仪表盘统计：`stats.users`（total/today/week/month/verified/active）、`stats.logins`（today/week/web/oauth）、`stats.oauth`（clients/authorizations）、`stats.trends`（近 7 天 `userGrowth`/`loginTrend`） |
| GET | `/api/admin/email-config` | `email_config.read` | — | — | SMTP 配置回显（脱敏，见下文） |
| PUT | `/api/admin/email-config` | `email_config.write` | — | `host`*, `port`*, `user`*, `from`*, `password`, `secure` | 保存 SMTP 配置 |
| POST | `/api/admin/test-email` | `email_config.write` | 5 次/10 分钟 | `email`* | 发送测试邮件 |
| GET | `/api/admin/sms-config` | `sms_config.read` | — | — | 阿里云短信配置回显（脱敏） |
| PUT | `/api/admin/sms-config` | `sms_config.write` | — | `enabled`, `access_key_id`, `access_key_secret`, `sign_name`, `template_code` | 保存短信配置；`enabled=true` 时 `access_key_id`/`sign_name`/`template_code` 必填 |
| POST | `/api/admin/test-sms` | `sms_config.write` | 5 次/10 分钟 | `phone`*（11 位大陆手机号） | 发送测试短信；未配置返回 503（`SMS_NOT_CONFIGURED`） |
| GET | `/api/admin/config` | `config.read` | — | — | 返回 `system`（system_config 全表 key/value/description）+ `email`（不含密码） |
| PUT | `/api/admin/config/:key` | `config.write` | — | body: `value` | 更新单个运行时配置（见下文） |

### email-config / sms-config 脱敏回显

- `GET /email-config` **不返回** `password`，以 `hasPassword: true/false` 标示是否已配置；`PUT` 时省略 `password` 字段则保留库中旧密码。
- `GET /sms-config` **不返回** `access_key_secret`，以 `has_access_key_secret` 标示；`PUT` 省略该字段同样沿用旧值。
- 两者保存后均使 `runtimeConfig` 缓存失效并写审计（`config.email` / `config.sms`）。

### PUT /api/admin/config/:key 可用 key

`runtimeConfig.set` 只执行 UPDATE（不新增 key，key 不存在时静默无效果）。初始 seed 的 key（`src/db/migrations/001_initial_schema.sql`）：

| key | 默认值 | 含义 |
|-----|--------|------|
| `session_lifetime_days` | `30` | Session 有效期（天） |
| `password_min_length` | `6` | 密码最小长度 |
| `password_require_complexity` | `0` | 是否要求密码复杂度（0/1） |
| `registration_enabled` | `1` | 是否允许新用户注册（0/1） |
| `sms_audit_retention_days` | `365` | 短信审计日志保留天数 |
| `audit_retention_days` | `365` | 管理审计日志保留天数 |

## 授权与登录日志（logs.js）

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/authorizations` | `authorizations.read` | — | query: `page`, `limit`(默认 50), `user_id` | OAuth 授权记录（联查用户名与客户端名），按 `last_used_at` 倒序 |
| DELETE | `/api/admin/authorizations/:id` | `users.write` | — | — | 撤销一条授权记录 |
| GET | `/api/admin/login-logs` | `login_logs.read` | — | query: `page`, `limit`(默认 100), `user_id`, `login_type`(web/oauth) | 登录日志（含 ip/device/login_type） |

## 管理审计日志（auditLogs.js）

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/audit-logs` | `audit_logs.read` | — | query: `page`, `limit`(≤100，默认 50), `action`, `target_type`, `admin_id`, `start_date`, `end_date` | 管理员操作审计（`admin_audit_logs`），按时间倒序，返回 `logs` + `pagination` |

## 短信审计日志（smsAuditLogs.js）

| 方法 | 路径 | 权限 | 限流 | 参数摘要 | 说明 |
|------|------|------|------|----------|------|
| GET | `/api/admin/sms-audit-logs` | `sms_audit.read` | — | query: `page`, `limit`(≤100，默认 50), `user_id`, `action`(send_code/verify_code), `success`(0/1/true/false), `code`, `ip_address`, `phone_last4`(4 位数字), `start_date`, `end_date` | 短信发送/校验审计；过滤参数非法返回 400 并附错误 `code`（如 `INVALID_ACTION`）；手机号仅存脱敏值 `phone_masked` |

## 测试专用端点

以下 4 个端点定义在 `src/routes/admin/index.js`，**仅在 `NODE_ENV !== 'production'` 时注册**（生产环境不存在这些路由）。均不走 `admin_session`，而是要求 body 携带 `secret` 且与 `ADMIN_SECRET` 时序安全比对，否则 403。CSRF 豁免。

| 方法 | 路径 | 参数摘要 | 说明 |
|------|------|----------|------|
| POST | `/api/admin/test/clear-rate-limits` | `secret`* | 清空 Redis 中全部 `ratelimit:*` 与 `admin:*` key，返回清除数量 `cleared` |
| POST | `/api/admin/test/create-reset-token` | `secret`*, `user_id`* | 向 Redis 写入 1 小时有效的密码重置令牌并**返回原始 token**（供测试调用 `POST /api/password/reset`） |
| POST | `/api/admin/test/verify-email` | `secret`*, `user_id`* | 直接将用户 `email_verified` 置 1 |
| POST | `/api/admin/test/get-user-id` | `secret`*, `username`* | 按用户名查询并返回 `user_id`（不存在 404） |
