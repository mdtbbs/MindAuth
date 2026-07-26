# 账户域 API

MindAuth 账户自服务域 API 参考，覆盖账户安全、会话管理、手机绑定与通知中心，来源路由文件：`src/routes/account.js`、`src/routes/sessions.js`、`src/routes/sms.js`、`src/routes/notifications.js`。

> **维护提示**：修改 src/routes/account.js、sessions.js、sms.js、notifications.js 时需同步更新本文档。

通用约定（响应包裹结构、CSRF、限流说明）见 [README.md](README.md)。本域所有端点均需登录会话（`session` Cookie，经 `requireAuth` 中间件校验）；所有写操作（POST/PUT/PATCH/DELETE）还需携带 `X-CSRF-Token` 请求头。认证失败统一返回 `401`。

## 账户管理（/api/account · src/routes/account.js）

### POST /api/account/change-password

修改当前用户的登录密码，成功后吊销该用户全部会话（含管理员会话）并要求重新登录。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `old_password` | body | string | 是 | 当前密码 |
| `new_password` | body | string | 是 | 新密码，须通过 `isValidPassword` 校验（8 位以上 + 复杂度） |

成功响应：

```json
{ "success": true, "message": "密码已更新，请重新登录" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | 参数缺失或新密码不符合要求（message 为具体校验错误） |
| 401 | 旧密码错误 |
| 404 | 用户不存在 |
| 500 | 修改密码失败 |

特殊行为：新密码以 bcrypt cost=12 哈希；调用 `revokeAllUserSessions` 与 `revokeAdminSessionsForUser` 吊销全部会话并清除 `session` Cookie；创建 `password_changed` 通知（同时发送邮件）；写入用户审计日志（action=`password_changed`）。

### POST /api/account/change-email

发起邮箱更换：向新邮箱发送验证链接，用户点击链接后才真正完成更换。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `new_email` | body | string | 是 | 新邮箱地址，须通过 `isValidEmail` 校验 |

成功响应：

```json
{ "success": true, "message": "验证邮件已发送到新邮箱，请点击链接完成更换" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | 邮箱格式无效 |
| 409 | 该邮箱已被其他用户使用 |
| 500 | 更换邮箱失败 |

特殊行为：验证 token 存入 Redis `verify:{token}`（TTL 1 小时），并同步写入 MySQL `email_verification_tokens` 作为回退；验证链接形如 `{BASE_URL}/#/verify-email?token=...`；写入审计日志（action=`email_change_requested`，details 含 `new_email`）。

### DELETE /api/account/

删除当前账号及全部关联数据（需密码确认）。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `password` | body | string | 是 | 当前密码，用于确认删除 |

成功响应：

```json
{ "success": true, "message": "账号已删除" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | 未提供密码 |
| 401 | 密码错误 |
| 404 | 用户不存在 |
| 500 | 删除账号失败 |

特殊行为：先吊销全部用户/管理员会话（保证 Redis 缓存可被定位清理），再在单事务中连带删除 `authorizations`、`refresh_tokens`、`login_logs`、`user_notifications`、`user_field_values` 及 `users` 行；清除 `session` Cookie；写入审计日志（action=`account_deleted`）。

### POST /api/account/avatar

上传头像（multipart/form-data），替换并删除旧头像文件。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `file` | form-data | file | 是 | 图片文件，≤ 2MB，仅 JPEG/PNG/GIF/WebP（MIME 与扩展名须匹配） |

成功响应：

```json
{ "success": true, "avatar_url": "/uploads/avatars/1_1753500000000.png" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | 未选择文件，或文件超过 2MB（`LIMIT_FILE_SIZE`） |
| 500 | 上传头像失败 |

特殊行为：文件保存为 `public/uploads/avatars/{userId}_{timestamp}{ext}`；旧头像文件经路径穿越校验后物理删除；写入审计日志（action=`avatar_changed`，details.kind=`avatar`）。

### DELETE /api/account/avatar

删除当前头像（数据库置 NULL 并删除物理文件）。

- 认证：会话 Cookie + CSRF
- 请求参数：无

成功响应：

```json
{ "success": true }
```

| 状态码 | 说明 |
|--------|------|
| 500 | 删除头像失败 |

### POST /api/account/banner

上传个人主页背景图（multipart/form-data），替换并删除旧背景文件。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `file` | form-data | file | 是 | 图片文件，≤ 5MB，仅 JPEG/PNG/GIF/WebP（MIME 与扩展名须匹配） |

成功响应：

```json
{ "success": true, "banner_url": "/uploads/banners/1_1753500000000.jpg" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | 未选择文件，或文件超过 5MB（`LIMIT_FILE_SIZE`） |
| 500 | 上传背景图失败 |

特殊行为：文件保存为 `public/uploads/banners/{userId}_{timestamp}{ext}`；审计日志复用 action=`avatar_changed`，以 details.kind=`banner` 区分。

### DELETE /api/account/banner

删除当前背景图（数据库置 NULL 并删除物理文件）。

- 认证：会话 Cookie + CSRF
- 请求参数：无

成功响应：

```json
{ "success": true }
```

| 状态码 | 说明 |
|--------|------|
| 500 | 删除背景图失败 |

### GET /api/account/fields

获取全部自定义字段定义（按 `sort_order` 排序）及当前用户的填写值。

- 认证：会话 Cookie
- 请求参数：无

成功响应：

```json
{
  "success": true,
  "fields": [
    {
      "field_key": "qq",
      "field_label": "QQ 号",
      "field_type": "text",
      "is_required": false,
      "options": null,
      "value": "123456789"
    }
  ]
}
```

| 状态码 | 说明 |
|--------|------|
| 500 | 获取字段失败 |

说明：字段定义由管理员在 `user_fields` 表维护；`options` 为 JSON（如下拉选项），未填写的字段 `value` 为 `null`。

### PUT /api/account/fields

批量更新当前用户的自定义字段值。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `values` | body | object | 是 | `{ field_key: value }` 键值对；值为 `null` 或空字符串时删除该字段值 |

成功响应：

```json
{ "success": true, "message": "字段已更新" }
```

| 状态码 | 说明 |
|--------|------|
| 400 | `values` 须为对象 |
| 500 | 更新字段失败 |

特殊行为：仅接受 `user_fields` 中已定义的 `field_key`，未定义的键被静默忽略；值统一转为字符串后 upsert 到 `user_field_values`。

### GET /api/account/audit-logs

获取当前用户的安全审计日志（密码修改、会话注销、账号删除等安全事件）。

- 认证：会话 Cookie

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `limit` | query | number | 否 | 返回条数，默认 50，最大 200 |

成功响应：

```json
{
  "success": true,
  "logs": [
    {
      "id": 12,
      "action": "password_changed",
      "ip_address": "1.2.3.4",
      "user_agent": "Mozilla/5.0 ...",
      "details": null,
      "created_at": "2026-07-26T08:00:00.000Z"
    }
  ]
}
```

| 状态码 | 说明 |
|--------|------|
| 500 | 获取安全日志失败 |

说明：`action` 取值来自 `src/utils/userAudit.js` 的 VALID_ACTIONS：`login_failed`、`account_locked`、`account_unlocked`、`password_changed`、`password_reset`、`email_change_requested`、`email_changed`、`session_terminated`、`avatar_changed`、`account_deleted`；`details` 为 JSON 或 `null`。

## 会话管理（/api/sessions · src/routes/sessions.js）

### GET /api/sessions

列出当前用户的全部活跃会话（按 `last_active_at` 倒序），并标记当前会话。

- 认证：会话 Cookie
- 请求参数：无

成功响应：

```json
{
  "success": true,
  "sessions": [
    {
      "id": 3,
      "ip_address": "1.2.3.4",
      "device_info": "Chrome on Windows",
      "is_current": true,
      "created_at": "2026-07-20T10:00:00.000Z",
      "last_active_at": "2026-07-26T08:00:00.000Z"
    }
  ]
}
```

| 状态码 | 说明 |
|--------|------|
| 500 | 获取会话列表失败 |

### DELETE /api/sessions/:id

注销指定会话（登出某台设备）。允许注销当前会话，此时同时清除 `session` Cookie。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `id` | path | number | 是 | 会话 ID（正整数），须属于当前用户 |

成功响应：

```json
{ "success": true, "message": "会话已注销", "terminated_current": false }
```

注销当前会话时 `message` 为 `"当前会话已注销"`、`terminated_current` 为 `true`。

| 状态码 | 说明 |
|--------|------|
| 400 | 无效的会话 ID |
| 404 | 会话不存在（含不属于当前用户的情况） |
| 500 | 注销会话失败 |

特殊行为：通过 `sessionManager.revokeUserSession` 同步清理 MySQL 行、Redis 缓存与索引集合；写入审计日志（action=`session_terminated`，details 含 `terminated_current`、`target_ip`、`target_device`）。

## 手机绑定（/api/sms · src/routes/sms.js）

业务逻辑集中在 `src/modules/sms/smsBinding.js`；仅支持中国大陆手机号（`^1[3-9]\d{9}$`），当前不支持换绑。失败响应统一携带业务错误码字段 `code`。

### POST /api/sms/send

向手机号发送 6 位短信验证码（阿里云 dysmsapi，验证码 Redis TTL 5 分钟）。

- 认证：会话 Cookie + CSRF
- 限流（多级，Redis Lua 原子计数）：同 IP 3 次/小时、同用户 3 次/5 分钟、同手机号 1 次/分钟

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `phone` | body | string | 是 | 大陆手机号 |

成功响应：

```json
{ "success": true, "message": "验证码已发送" }
```

若该手机号已是本账号的已验证手机号，直接返回 `{ "success": true, "code": "PHONE_ALREADY_VERIFIED", "message": "手机号已验证", "phone_verified": true }`，不实际发送。

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PHONE` | 手机号格式错误 |
| 409 | `PHONE_ALREADY_BOUND` | 当前账号已绑定其他手机号，暂不支持换绑 |
| 409 | `PHONE_IN_USE` | 该手机号已被其他用户使用 |
| 429 | `SMS_RATE_LIMITED` | 发送太频繁（message 含剩余等待秒数） |
| 503 | `SMS_NOT_CONFIGURED` | 短信服务未配置 |
| 500 | `SMS_SEND_FAILED` 等 | 发送失败 |

特殊行为：每次调用（无论成败）都写入 `sms_audit_logs` 短信审计。

### POST /api/sms/verify

校验短信验证码并将手机号绑定到当前账号。

- 认证：会话 Cookie + CSRF
- 验证失败限流：同用户+手机号 5 次/5 分钟、同手机号 10 次/小时、同 IP 20 次/小时（达到上限后返回 429，含剩余等待秒数）

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `phone` | body | string | 是 | 大陆手机号（须与收码手机号一致） |
| `code` | body | string | 是 | 6 位数字验证码 |

成功响应：

```json
{ "success": true, "message": "手机号绑定成功", "phone_verified": true }
```

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_SMS_PARAMS` | 手机号或验证码格式错误 |
| 400 | `INVALID_SMS_CODE` | 验证码错误或已过期 |
| 409 | `PHONE_ALREADY_BOUND` | 当前账号已绑定其他手机号 |
| 409 | `PHONE_IN_USE` | 该手机号已被其他用户使用（含唯一索引竞态） |
| 429 | `SMS_VERIFY_RATE_LIMITED` | 验证失败次数过多 |
| 503 | `SMS_NOT_CONFIGURED` | 短信服务未配置 |
| 500 | `SMS_VERIFY_FAILED` 等 | 验证失败 |

特殊行为：绑定成功后更新 `users.phone / phone_verified / phone_verified_at`，失效当前会话缓存（下次请求 `req.user` 即为最新）、清除该用户的验证失败计数、创建 `phone_bound` 通知（内容中手机号脱敏为 `138****8000` 形式），并写入短信审计。

## 通知中心（/api/notifications · src/routes/notifications.js）

数据操作集中在 `src/modules/notifications/notificationCenter.js`，通知存于 `user_notifications` 表。

### GET /api/notifications

分页列出当前用户的通知（按 `created_at` 倒序）。

- 认证：会话 Cookie

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `page` | query | number | 否 | 页码，默认 1，最小 1 |
| `limit` | query | number | 否 | 每页条数，默认 20，范围 1–100 |
| `unread` | query | string | 否 | 传 `"true"` 时仅返回未读 |

成功响应：

```json
{
  "success": true,
  "notifications": [
    {
      "id": 8,
      "type": "password_changed",
      "title": "密码已修改",
      "content": "您的登录密码已被修改，请重新登录。",
      "is_read": 0,
      "ip_address": "1.2.3.4",
      "user_agent": "Mozilla/5.0 ...",
      "created_at": "2026-07-26T08:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
}
```

| 状态码 | 说明 |
|--------|------|
| 500 | 获取通知失败 |

### GET /api/notifications/unread-count

获取当前用户的未读通知数。

- 认证：会话 Cookie
- 请求参数：无

成功响应：

```json
{ "success": true, "count": 3 }
```

| 状态码 | 说明 |
|--------|------|
| 500 | 获取未读数失败 |

### PATCH /api/notifications/:id/read

将指定通知标记为已读。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `id` | path | number | 是 | 通知 ID，须属于当前用户 |

成功响应：

```json
{ "success": true }
```

| 状态码 | 说明 |
|--------|------|
| 404 | 通知不存在（含不属于当前用户的情况） |
| 500 | 操作失败 |

### PATCH /api/notifications/read-all

将当前用户全部未读通知标记为已读。

- 认证：会话 Cookie + CSRF
- 请求参数：无

成功响应：

```json
{ "success": true, "message": "全部已读" }
```

| 状态码 | 说明 |
|--------|------|
| 500 | 操作失败 |

### DELETE /api/notifications/:id

删除指定通知。

- 认证：会话 Cookie + CSRF

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `id` | path | number | 是 | 通知 ID，须属于当前用户 |

成功响应：

```json
{ "success": true, "message": "通知已删除" }
```

| 状态码 | 说明 |
|--------|------|
| 404 | 通知不存在（含不属于当前用户的情况） |
| 500 | 操作失败 |
