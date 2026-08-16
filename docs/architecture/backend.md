# MindAuth 后端模块

MindAuth 后端（Express + MySQL + Redis）按"深模块"组织：`src/modules/` 下每个模块是其业务域的唯一接缝，路由层只做 HTTP 适配，业务逻辑与数据访问收敛在模块内部。

> **维护提示**：修改 src/modules/**、src/middleware/*、src/utils/* 时需同步更新本文档。

## 模块组织原则

- **深模块**：每个业务域有且只有一个模块入口，对外暴露少量高层函数，内部封装 MySQL/Redis 访问、缓存与并发控制。
- **路由层是薄适配器**：`src/routes/` 只做参数解析、cookie/header 读取与响应格式化。例如 `oauthIssuer` 抛 `OAuthError`，路由层仅负责翻译成 RFC 6749 JSON 错误或错误页重定向。
- **禁止绕过模块接口**：不得直接读写属于某模块的表或 Redis 键。会话缓存键是 token 的 SHA-256 哈希，绕过 `sessionManager` 拼键必然出错。
- **依赖单向**：模块可调用其他模块（如 `oauthIssuer` → `tokenStore`/`sessionManager`）与 utils，不依赖路由层。
- 表结构详见 [database.md](database.md)，HTTP API 详见 [../api/README.md](../api/README.md)。

## 深模块

### sessionManager（`src/modules/sessions/sessionManager.js`）

用户与管理员会话的全生命周期：创建、认证、活跃更新、单个/批量吊销。唯一允许读写会话数据的代码。

| 导出 | 说明 |
|------|------|
| `createUserSession({ userId, ipAddress, userAgent, remember })` | 建会话（MySQL + Redis 缓存），返回 `{ token, expiresAt, sessionId }`，`token` 为 cookie 用原始值 |
| `authenticateUserSession(rawToken)` | 认证；Redis 优先、MySQL 回退并回填（Redis 抛错按缓存未命中处理，降级 MySQL），返回 `{ user, session: { id } }` 或 `null` |
| `touchUserSession(sessionId)` | 节流更新 `last_active_at`（5min 一次），fire-and-forget |
| `revokeUserSession({ token, userId, sessionId })` | 吊销单个会话（token 或 sessionId 定位） |
| `revokeAllUserSessions(userId, { exceptToken })` | 吊销全部会话，可保留当前 |
| `invalidateUserSessionCache(rawToken)` | 只删 Redis 缓存，MySQL 行不动（用户资料变更后用） |
| `listUserSessions(userId, currentTokenHash)` | 会话列表，含 `is_current` |
| `createAdminSession({ adminId, ipAddress, userAgent })` | 管理员会话（仅 Redis，24h） |
| `authenticateAdminSession(rawToken)` | 认证；**每次回 DB 重查 role/ban_status**，返回含 `normalized_role` 的 admin；Redis 故障时 fail-closed 返回 `null` |
| `revokeAdminSessionsForUser(userId)` | 吊销某用户全部管理员会话 |
| `hashToken(rawToken)` | SHA-256 工具（测试/内部用） |

依赖：MySQL `user_sessions`、`users`；Redis `session:{hash}`、`sessions_by_user:{userId}`、`admin_session:{hash}`、`admin_sessions_by_user:{userId}`、`session_active:{id}`；utils `deviceInfo`。

约束：token 仅以 SHA-256 哈希落库，原始值只在 cookie；`users.session_token` 已废弃不读不写；30 天绝对有效期用 DB 时间计算，Redis payload 携带 `session_expires_at`，缓存命中也校验；批量吊销走索引集合，无 SCAN；管理员被撤权或封禁后下次认证即失效。**Redis 故障降级**：用户会话认证在 Redis 命令抛错时按缓存未命中处理，降级 MySQL（缓存回填 best-effort，失败仅告警）；管理员会话仅存 Redis，无回退层，故障时 fail-closed 返回 `null`（401）而非 500。

### oauthIssuer（`src/modules/oauth/oauthIssuer.js`）

OAuth 2.0 / OIDC 全部业务逻辑：授权码签发、令牌交换、刷新轮换、内省、吊销、UserInfo、授权管理、会话校验。

| 导出 | 说明 |
|------|------|
| `OAuthError` | 携带 `status`/`error`/`errorDescription`/`errorPageParams` 的错误类 |
| `authorize({ clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, responseType, sessionToken, ipAddress })` | 校验参数并签发授权码；未登录返回 `{ loginRedirect: true, client }`，成功返回 `{ redirectTo }` |
| `exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier })` | 授权码换令牌：验客户端、原子消费码、PKCE 校验 |
| `refresh({ refreshToken, clientId, clientSecret })` | 刷新令牌轮换（MySQL 事务 + `SELECT FOR UPDATE`） |
| `introspect({ token, clientId, clientSecret })` | RFC 7662；只返回属于请求方 client 的令牌信息 |
| `revoke({ token, tokenTypeHint, clientId, clientSecret })` | RFC 7009；未知令牌也返回 `{ success: true }` |
| `userinfo(accessToken)` | OIDC claims，按 scope 过滤（含公开 `custom_fields`） |
| `userByAccessToken(accessToken)` | `/user` 兼容端点（MindFourm）扁平用户数据 |
| `listAuthorizations(userId)` | 用户已授权客户端列表 |
| `revokeAuthorization({ userId, clientId })` | 删授权记录 + 吊销该 user/client 全部 refresh/access token |
| `verify(sessionToken)` | 校验 session token 返回用户信息（`/api/verify`） |

依赖：`tokenStore`、`sessionManager`；MySQL `clients`、`refresh_tokens`、`authorizations`、`users`、`login_logs`、`user_fields`/`user_field_values`；utils `crypto`、`token`、`datetime`、`phone`。

约束：PKCE 只接受 `S256`；client_secret 先按 `client_id` 取行再 `timingSafeCompare`（避免 SQL 等值比较时序泄漏）；refresh token SHA-256 哈希落库，轮换在事务行锁内完成，重放已吊销令牌会吊销该 user/client **全部** refresh token；scope 白名单 `openid profile email`；授权码 5min、access token 1h、refresh token 30 天。

### tokenStore（`src/modules/oauth/tokenStore.js`）

OAuth 授权码与 access token 的 Redis 存取层（refresh token 在 MySQL，归 `oauthIssuer` 管）。

| 导出 | 说明 |
|------|------|
| `storeAuthCode(code, data, ttlSeconds)` | 存授权码（`authcode:{code}`，典型 300s） |
| `consumeAuthCode(code)` | **原子消费**（Redis `GETDEL`），保证单次使用 |
| `storeAccessToken(token, data, ttlSeconds)` | 存 token 并加入 per-user/client 索引集合 |
| `getAccessToken(token)` / `getAccessTokenTtl(token)` | 查 payload / 剩余 TTL（-2 为不存在） |
| `revokeAccessToken(token)` | 删除单个 |
| `revokeAccessTokensForUserClient(userId, clientId)` | 用索引集合批量吊销，无 SCAN |

依赖：仅 Redis。键：`accesstoken:{sha256}`、`accesstokens_by_userclient:{userId}:{clientId}`（Set，成员为哈希）、`authcode:{code}`。

约束：access token 以 SHA-256 哈希为键存储，调用方始终传原始值——Redis dump 不泄漏可用 bearer token。

### clientRegistry（`src/modules/admin/clientRegistry.js`）

OAuth 客户端 CRUD 与密钥轮换，所有变更写管理员审计。

| 导出 | 说明 |
|------|------|
| `createClient(data, actor)` | 创建（`data`: name/redirect_uri/require_pkce；`actor`: adminId/ipAddress），返回 `{ client_id, client_secret }` |
| `updateClient(id, data, actor)` | 更新；`require_pkce` 仅显式传入时才更新（防部分更新误翻标志） |
| `rotateSecret(id, actor)` | 轮换密钥，返回新 `client_secret` |
| `deleteClient(id, actor)` | 删除 |
| `listClients()` / `getClient(id)` | 列表/单查（不返回 secret） |
| `validateRedirectUri(uri)` | 回调地址校验，返回 `{ valid, error? }` |

依赖：MySQL `clients`；`auditWriter.writeAdminAudit`；utils `token`。

约束：`validateRedirectUri` 含 SSRF 防护——仅 http/https，拒绝 localhost 变体、`.local`/`.localhost`、RFC 1918 私网段、链路本地 169.254/16 与云元数据端点（`metadata.google.internal`、`169.254.169.254`）。

### challengeManager（`src/modules/challenges/challengeManager.js`）

挑战问题（注册人机验证）的选题、会话、答案校验与后台 CRUD。

| 导出 | 说明 |
|------|------|
| `getRandomChallenge(csrfToken)` | 随机取题并建 30min Redis 会话，返回 `{ challenge_id, question }` |
| `verifyChallengeAnswer(csrfToken, challengeId, answer)` | 校验；答错换新题并计次（上限 3），返回 `{ verified }` / `{ verified: false, code, attemptsLeft, newChallenge }` / `{ error }` |
| `verifyForRegistration(csrfToken, challengeId, answer)` | 注册版：失败不换题，成功消费会话，返回 `{ success, code? }` |
| `isChallengeRequired()` | 是否存在启用题目 |
| `listChallenges()` / `createChallenge(question, answer)` / `updateChallenge(id, data)` / `deleteChallenge(id)` | 后台 CRUD（审计由 admin 路由负责） |

依赖：MySQL `challenge_questions`；Redis `challenge_session:{csrfToken}`（30min）。

约束：随机选题用 COUNT + OFFSET（避免 `ORDER BY RAND()`）；答案 trim + 小写后 bcrypt 比较（cost=10）；会话以 `csrf_token` cookie 值为键。

### notificationCenter（`src/modules/notifications/notificationCenter.js`）

用户通知的创建、分页列表、未读计数、已读标记；可选同步发邮件。

| 导出 | 说明 |
|------|------|
| `create({ user_id, type, title, content, ip_address, user_agent, sendEmail })` | 写入通知；`sendEmail: true` 时附发邮件（内容 `escapeHtml` 转义） |
| `list(userId, { page, limit, unreadOnly })` | 分页列表（limit 上限 100） |
| `getUnreadCount(userId)` | 未读数 |
| `markRead(userId, notificationId)` / `markAllRead(userId)` | 标记已读 |
| `remove(userId, notificationId)` | 删除单条 |

依赖：MySQL `user_notifications`、`users`；utils `email`、`validation`。

约束：DB 写入与邮件发送失败均只 warn 不抛出。旧 `utils/notify.js` 保留为薄包装，新代码直接用本模块。

### smsBinding（`src/modules/sms/smsBinding.js`）

短信验证码发送、校验与手机号绑定，含全部限流与审计。

| 导出 | 说明 |
|------|------|
| `sendCode(user, rawPhone, req)` | 发码；校验格式（`/^1[3-9]\d{9}$/`）、重复绑定、三层发送限流 |
| `verifyCode(user, rawPhone, rawCode, req)` | 验码并绑定；失败限流预检、唯一性检查、绑定后失效会话缓存 + 发通知 |
| `getStatus(user)` | 返回 `{ phone_verified, phone_masked }` |

依赖：MySQL `users`；Redis 发送限流 `sms:send:ip/user/phone:*`（IP 3 次/h、用户 3 次/5min、手机号 1 次/min）、失败限流 `sms:verify:fail:*`（user+phone 5/5min、phone 10/h、IP 20/h）；utils `aliyunSms`、`request`、`smsAudit`、`notify`；`sessionManager`。

约束：限流用 Redis Lua 脚本（INCR+EXPIRE 原子）；每个动作恰好写一条 SMS 审计；绑定后必须经 `sessionManager.invalidateUserSessionCache()` 失效缓存；已绑定不支持换绑；对 `phone` 唯一键并发竞态有兜底。

### ipBanMatcher（`src/modules/security/ipBanMatcher.js`）

IP 封禁匹配，精确匹配 + CIDR 网段，IPv4/IPv6 通吃。

| 导出 | 说明 |
|------|------|
| `isBanned(ip)` | 返回 `{ banned, reason? }`；内部错误 fail-open 放行 |
| `refreshCache()` / `clearCache()` | 删 Redis 缓存键（下次 `isBanned` 自动重建），admin 增删改后调用 |

依赖：MySQL `ip_bans`；Redis `ip_bans_cache`（整表 JSON，5min TTL，跨进程共享）。

约束：地址统一转 BigInt（IPv6 128 位）做掩码比较；IPv6 支持 `::` 压缩、zone id 剥离、内嵌 IPv4；跨地址族永不匹配；`expires_at` 过期封禁匹配时跳过；封禁检查绝不 crash 请求管线。

### auditWriter（`src/modules/audit/auditWriter.js`）

管理员与用户审计的统一写入口，底层委托 `utils/auditLog` 与 `utils/userAudit`。

| 导出 | 说明 |
|------|------|
| `writeAdminAudit(adminId, action, targetType, targetId, details, ipAddress)` | 记录管理员操作（如 `'client.create'`、`'user.ban'`） |
| `writeUserAudit(userId, action, ipAddress, details)` | 记录用户安全事件（如 `'account_unlocked'`） |

约束：写入失败只记日志不抛出——宁可丢审计也不打断主请求流。

### runtimeConfig（`src/modules/config/runtimeConfig.js`）

DB 后备的动态配置（`system_config` 表）读写，带进程内缓存。静态配置（端口、DB 凭据）仍归 `src/config/index.js`。

| 导出 | 说明 |
|------|------|
| `get(key)` | 缓存优先、DB 回退并回填，返回 `string \| null` |
| `getMany(keys)` | 批量读；DB 无此键也以 `null` 缓存（负缓存） |
| `set(key, value)` | UPDATE 写 DB 并失效该键缓存（只更新已存在的行） |
| `invalidate(keys?)` | 失效指定键；不传清空全部 |
| `preload()` | 启动时整表预热 |

依赖：MySQL `system_config`。

约束：缓存是**进程内 Map**（TTL 5 分钟），单实例够用；多实例部署时其他实例最长 5 分钟后才见新值（源码注释建议届时加 Redis 发布订阅）。

## 中间件

### csrf.js

导出 `setCsrfCookie`、`validateCsrf`、`csrfTokenEndpoint`、`generateCsrfToken`。签名双提交 cookie：值为 `${random}.${HMAC-SHA256(random)}`，密钥由 `ADMIN_SECRET` 派生——只有本服务签发的 token 通过校验，兄弟子域种 cookie 也无法伪造。`validateCsrf` 只查 POST/PUT/PATCH/DELETE，比较 `csrf_token` cookie 与 `X-CSRF-Token` header（timingSafeCompare + 签名校验）。豁免路径为不依赖会话 cookie 授权的端点：OAuth `/api/token` `/refresh` `/introspect` `/revoke` `/verify`、`/api/login` `/register` `/admin/login`、`/api/challenge/random` `/verify`、`/api/email-verification/verify` 及 4 个非生产 `/api/admin/test/*`。cookie `httpOnly: false`、`sameSite: 'strict'`、24h。

### ipBan.js

导出 `ipBanMiddleware`、`invalidateIpBanCache`（= `ipBanMatcher.refreshCache` 兼容别名）。薄适配器：`getClientIp(req)` → `ipBanMatcher.isBanned()`，命中返回 403 `{ code: 'IP_BANNED' }`；自身错误吞掉放行。挂在 API 路由之前。

### rateLimit.js

导出 `createRateLimiter({ maxAttempts, windowMs, keyPrefix })`、`resetRateLimit(ip, keyPrefix)`、`getRateLimitStatus(ip, keyPrefix)`。Redis 固定窗口（INCR + pExpire）：设 TTL 失败会回删计数键，保证计数器绝不无 TTL 永久 429；Redis 不可用时回退进程内 Map（超 1000 条清理过期项）。**`keyPrefix` 必填且必须唯一**——共享前缀会让端点互相消耗/重置配额，缺失直接抛错。典型：login 5/5min、register 5/h、admin login 3/15min。

### requireAdmin.js

导出 `requireAdmin`、`requireAdminPermission(permission)`、`hasAdminPermission`、`normalizeRole`、`isAdminRole`、`ROLE_PERMISSIONS` 及 legacy 会话适配器（新代码直接用 `sessionManager`）。`requireAdmin` 校验 `admin_session` cookie（委托 `sessionManager.authenticateAdminSession`，含 DB role/ban 重查），注入 `req.adminUser`/`req.admin`/`req.isAdmin`。RBAC 模型 `ROLE_PERMISSIONS`：`super_admin`（`*`，legacy 值 `admin` 归一化为它）、`user_admin`（用户管理 + 授权/登录日志读）、`security_admin`（封禁/解锁 + 审计读 + IP 封禁读写）、`config_admin`（配置/客户端/SMS/邮件配置读写）、`readonly_admin`（全量只读）。`requireAdminPermission('xx.yy')` 生成细粒度检查，挂在 `requireAdmin` 之后。

### requireAuth.js

默认导出 `requireAuth`。校验 `session` cookie（`sessionManager.authenticateUserSession`），注入 `req.user` 与 `req.session`（含 `session.id`），并 fire-and-forget 调 `touchUserSession`。挂在所有需登录的 `/api` 路由上。

### upload.js

导出 `avatarUpload`（2MB）、`bannerUpload`（5MB）、`backgroundUpload`（5MB），基于 multer diskStorage。MIME 与扩展名双重白名单（JPEG/PNG/GIF/WebP，二者必须匹配）；文件名 `{userId}_{timestamp}{ext}`；目录 `public/uploads/{avatars,banners,backgrounds}/` 启动时自动创建。`avatarUpload`/`bannerUpload` 用于 `/api/account/avatar`、`/api/account/banner`；`backgroundUpload` 用于管理端 `POST /api/admin/auth-background`（登录页背景），**不允许 GIF**（避免动图背景），且因管理端无 `req.user`，文件名为 `auth_bg_{timestamp}{ext}`。

## utils 速查表

| 文件 | 导出 | 用途 |
|------|------|------|
| `aliyunSms.js` | `sendSmsCode(phone)`, `checkSmsCode(phone, code)`, `getSmsConfig()` | 阿里云 dysmsapi 发/验短信码，码存 `sms:code:{phone}`（5min） |
| `auditLog.js` | `logAudit({admin_id, action, target_type, target_id, details, ip_address})` | 写 `admin_audit_logs` |
| `cleanup.js` | `cleanupExpiredData()`, `startCleanupScheduler(intervalMs)` | 定时清理过期 `refresh_tokens`、`user_sessions`、超保留期 `sms_audit_logs` |
| `crypto.js` | `timingSafeCompare(a, b)` | 恒定时间字符串比较 |
| `datetime.js` | `formatMySQLDateTime(date)`, `formatMySQLDateTimeFromMs(ms)` | 转 MySQL DATETIME 字符串 |
| `deviceInfo.js` | `parseDeviceInfo(ua)` | User-Agent → 设备描述 |
| `email.js` | `sendEmail`, `sendPasswordResetEmail`, `sendVerificationEmail`, `getEmailConfig` | nodemailer 发信，SMTP 配置读 `email_config` 表 |
| `notify.js` | `createNotification(opts)` | legacy 薄包装 → `notificationCenter.create()` |
| `phone.js` | `maskPhone(phone)` | 手机号脱敏 |
| `publicFiles.js` | `safePublicPath(relative)`, `tryRemovePublicFile(relative)` | `public/` 下文件的路径穿越校验与安全删除（自 account.js 提取；头像/横幅/登录页背景换图时删旧文件用） |
| `request.js` | `getClientIp(req)`, `isValidIpv4(ip)`, `normalizeIpCandidate(value)` | 客户端 IP 提取；无条件按 `ali-real-client-ip` → `x-real-ip` → `cf-connecting-ip` → `x-forwarded-for` 首项 → socket 地址优先级直读，每个候选经 `normalizeIpCandidate` 归一化（去端口/括号/`::ffff:`，`net.isIP` 校验） |
| `smsAudit.js` | `logSmsAudit(data)` | 写 `sms_audit_logs` |
| `token.js` | `generateToken()`（32 字节）, `generateShortToken()`（16 字节）, `hashToken(rawToken)` | 随机令牌生成与 SHA-256 哈希 |
| `userAudit.js` | `logUserAudit({user_id, action, ...})`, `getUserAuditLogs(userId, limit)`, `VALID_ACTIONS` | 用户审计写入/查询，action 白名单 |
| `validation.js` | `isValidEmail`, `isValidPassword`, `getPasswordValidationError`, `isValidUsername`, `getUsernameValidationError`, `escapeHtml` | 输入校验与 HTML 转义 |

## 扩展指引

新增一个业务域时按现有模式建三类文件：

1. **模块文件** `src/modules/<domain>/<domainManager>.js` — 文件头 JSDoc 写清职责与 design invariants（参考 `sessionManager`/`ipBanMatcher`）；只从 `../../db`、`../../redis` 取句柄；对外导出少量高层函数，内部辅助以 `_` 前缀附加导出供测试（如 `challengeManager._pickRandomEnabled`）；需审计调 `auditWriter`，需通知调 `notificationCenter.create()`。
2. **路由文件** `src/routes/` 下薄适配器 — 解析参数 → 调模块 → 翻译响应/错误。需登录挂 `requireAuth`，管理端挂 `requireAdmin` + `requireAdminPermission`，写操作自动受 `validateCsrf` 保护（除非入豁免表），高风险端点用 `createRateLimiter` 并分配**唯一 keyPrefix**。
3. **测试** — 纯逻辑/可 mock Redis 进 `tests/unit/`；依赖 MySQL 进 `tests/integration/`（`RUN_INTEGRATION=1` 门控）；端到端契约进 `tests/specs/`（Playwright）。

引入新表需在 `src/db/migrations/` 添加迁移（启动时 `src/db/migrator.js` 自动执行）；新 Redis 键与新表同步登记到 [database.md](database.md) 与 `MindAuth/CLAUDE.md`。
