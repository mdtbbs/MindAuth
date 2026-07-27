# MindAuth 安全设计

MindAuth 是面向公网的 OAuth 2.0 SSO 认证服务，本文档面向后端开发者与安全审计，系统描述其安全机制、实现位置与已知遗留。

> **维护提示**：修改 src/middleware/*、src/utils/request.js、认证/令牌相关模块时需同步更新本文档。

## 威胁模型概述

作为集中式认证服务，MindAuth 一旦失守将波及所有接入应用。重点防护面：

| 威胁 | 主要对策 | 实现位置 |
|------|----------|----------|
| 凭据窃取（拖库） | bcrypt 密码哈希；token 哈希至 rest | [auth.js](../../src/routes/auth.js)、[sessionManager.js](../../src/modules/sessions/sessionManager.js) |
| 会话劫持 | session token 仅存 SHA-256 哈希；httpOnly Cookie | sessionManager、requireAuth |
| CSRF | 签名双提交 Cookie | [csrf.js](../../src/middleware/csrf.js) |
| 暴力破解 | 分端点限流 + 递进式临时锁定 | [rateLimit.js](../../src/middleware/rateLimit.js)、auth.js |
| IP 伪造 | `trust proxy=false` + 显式可信代理白名单 | [request.js](../../src/utils/request.js) |
| SSRF（redirect_uri） | 私网地址拦截 | [clientRegistry.js](../../src/modules/admin/clientRegistry.js) |
| 令牌泄漏/重放 | 授权码原子单次消费、refresh token 轮换 + 重放检测、PKCE S256 | [oauthIssuer.js](../../src/modules/oauth/oauthIssuer.js)、[tokenStore.js](../../src/modules/oauth/tokenStore.js) |

## 密码与凭据

- 注册与改密使用 `bcrypt.hash(password, 12)`（cost=12）；登录用 `bcrypt.compare` 验证，天然兼容旧 cost=10 哈希。
- 所有 secret 比较（`client_secret`、CSRF token 等）走 [crypto.js](../../src/utils/crypto.js) 的 `timingSafeCompare`——基于 `crypto.timingSafeEqual`，长度不等直接返回 false，防时序侧信道。
- OAuth 客户端认证仅按 `client_id` 查询，再对 `client_secret` 做常量时间比较，避免把 secret 放进 SQL 条件（同时 migration 002 已删除内嵌 secret 的复合索引）。
- 登录/注册对"用户不存在""密码错误""用户名/邮箱已占用"统一返回模糊消息，防用户名枚举。

## 会话安全

实现集中在 [sessionManager.js](../../src/modules/sessions/sessionManager.js)（唯一 seam，其他代码不得直接读写会话存储）：

- **哈希入库**：raw token（32 字节随机 hex）只存在于 Cookie；MySQL `user_sessions.session_token` 与 Redis key `session:{hash}` 均为 SHA-256 哈希。migration 002 为该列加 UNIQUE 索引并删除了废弃的 `users.session_token` 列。
- **双层存储**：MySQL 为持久层（绝对过期 `expires_at`，30 天，用 DB 时间 `NOW()` 计算）；Redis 为 24h 缓存，缓存载荷内携带 `session_expires_at`，缓存命中时仍强制校验绝对生命周期。
- **Redis 故障降级**：`authenticateUserSession` 对 Redis 命令抛错做 try/catch，按缓存未命中处理并降级走 MySQL 查询（缓存回填 best-effort，失败仅告警）——Redis 断连不会让全部已登录请求 500。管理员会话仅存 Redis，无持久层可回退，故障时 **fail-closed** 返回 null（401）而非未捕获异常。
- **会话管理**：`sessions_by_user:{userId}` 索引集合支持免 SCAN 的批量注销；用户可通过 `/api/sessions` 列出活动会话（IP、设备）并远程注销单个/全部会话。`last_active_at` 更新经 `session_active:{sessionId}` 键 5 分钟节流。
- **管理员会话**：仅存 Redis（24h），**每次请求都回 DB 复查 role 与 ban_status**——降权或封禁即时生效并删除会话（[requireAdmin.js](../../src/middleware/requireAdmin.js) 委托 `authenticateAdminSession`）。

Cookie 属性：用户 `session` httpOnly + 生产 secure + SameSite=Lax；`csrf_token` 非 httpOnly（需 JS 读取）+ SameSite=Strict。

## 令牌安全

- **哈希至 rest**：access token 存 Redis 键 `accesstoken:{sha256}`；refresh token 在 MySQL 中存 SHA-256（migration 002 对存量数据执行 `SHA2(token,256)` 一次性哈希）；密码重置/邮箱验证 token 存 `reset:{sha256}` / `verify:{sha256}`，raw 值仅出现在邮件链接中（见 [token.js](../../src/utils/token.js) `hashToken`）。
- **授权码单次消费**：`consumeAuthCode` 用 Redis `GETDEL` 原子读删，5 分钟 TTL，杜绝并发重放。
- **PKCE**：仅支持 S256（`plain` 拒绝）；客户端可配置 `require_pkce` 强制要求。
- **refresh token 重放检测**：refresh 在事务 + 行锁中轮换；若检测到已被消费的 token 被重用，撤销该 user+client 的**全部** refresh token（视为泄漏）。
- **客户端绑定**：`/introspect` 与 `/revoke` 校验 token 归属请求方 `client_id`，一个客户端无法探测或撤销他人的令牌；`exchangeCode` 校验授权码与 `client_id` 匹配。
- 撤销授权时经 `accesstokens_by_userclient:{userId}:{clientId}` 索引集合精准清除 access token，无需 SCAN。

## CSRF 防护

[csrf.js](../../src/middleware/csrf.js) 采用**签名双提交 Cookie**：token 格式为 `random.HMAC-SHA256(random)`，HMAC 密钥由 `ADMIN_SECRET` 派生。校验 POST/PUT/PATCH/DELETE 时要求 `X-CSRF-Token` 头与 `csrf_token` Cookie 相等（timingSafeCompare）**且**签名有效——即使攻击者能种植 Cookie（如兄弟子域），也无法伪造服务端签发的值。非法/旧格式 Cookie 会被自动重签。

豁免路径（精确匹配集合，共 15 项）及理由：

| 路径 | 豁免理由 |
|------|----------|
| `/api/token` `/api/refresh` `/api/introspect` `/api/revoke` | 服务端到服务端，凭 `client_secret` 认证，不依赖浏览器 Cookie |
| `/api/verify` | 会话校验接口，凭请求体 token |
| `/api/login` `/api/register` `/api/admin/login` | 尚无会话可劫持；有独立限流 |
| `/api/challenge/random` `/api/challenge/verify` | 注册前置问答，无会话 |
| `/api/email-verification/verify` | 凭一次性邮件 token |
| `/api/admin/test/*`（4 项） | 测试端点，非生产环境使用且受 ADMIN_SECRET 保护 |

## 限流与账户锁定

[rateLimit.js](../../src/middleware/rateLimit.js) 为 Redis 固定窗口计数器 + 内存回退（Map 超 1000 条时清理过期项；计数器 TTL 设置失败会删键，绝不留下永不过期的 429）。**每个 limiter 必须传唯一 `keyPrefix`**（构造时强制校验），否则不同端点会互相消耗/重置配额——登录成功时也只按 `config.rateLimit.login.keyPrefix` 精准重置。

| 端点 | 限额 | keyPrefix |
|------|------|-----------|
| 登录 | 5 / 5min | `ratelimit:login` |
| 注册 | 5 / 1h | `ratelimit:register` |
| 管理员登录 | 3 / 15min | `ratelimit:admin_login` |
| 管理员创建 | 3 / 1h | `ratelimit:admin_create` |
| OAuth `/authorize` `/token` `/refresh` `/introspect` `/revoke` | 各 60 / min | `ratelimit:oauth_*` |
| `/verify` | — | `ratelimit:verify_api` |
| 密码重置请求 / 执行 | 3 / 10 每小时 | `ratelimit:password_reset_request` / `_exec` |
| 邮箱验证发送 | 1 / min | `ratelimit:email_verify_send` |
| 问答获取 / 校验 | 30/min、15/5min | `ratelimit:challenge_random` / `_verify` |
| 管理操作（删用户/重置密码/建客户端/测试邮件短信） | 见 config | `ratelimit:admin_*` |

**登录失败锁定**（[auth.js](../../src/routes/auth.js)）：失败计数键为 `login_fail:{username}:{ip}`（**同时含用户名与 IP**，TTL 5min）——仅知用户名的远程攻击者无法替真实用户攒失败次数。同一 IP 5 次失败后按 `lock_level` 递进锁定：15min → 1h → 2h 封顶，**始终自动过期，绝无永久锁定**；无限期封禁只能由管理员通过 `ban_status` 施加。锁定时发通知 + 邮件并写用户审计；登录成功清零 `lock_level` 与失败计数。

## IP 处理与封禁

- **可信代理模型**（[request.js](../../src/utils/request.js)）：`app.set('trust proxy', false)`，默认不信任任何代理头。仅当 `TRUSTED_PROXY_ENABLED=true` 且 TCP 对端在显式白名单（`TRUSTED_PROXY_IPS`，支持 IPv4/IPv6 与 CIDR）、Aliyun ESA 自动拉取的 origin-protection 白名单（`ALIYUN_ESA_AUTO_TRUST=true`）或（开启 `TRUST_CLOUDFLARE` 时）Cloudflare IPv4/IPv6 网段内，才采信 ESA 注入的 `ali-real-client-ip`；其缺失时才回退到 `X-Forwarded-For` 首项。头值经 `normalizeIpCandidate` 校验归一化后才使用——**IPv4 与 IPv6 均接受**，自动剥离端口与 IPv6 方括号（`[2001:db8::1]:1234`），`::ffff:` 映射地址还原为 IPv4；非法值回退 socket 地址。ESA 白名单在启动时预热，并按固定间隔后台刷新。这使限流、锁定、封禁、审计所用 IP 不可被普通客户端伪造。
- **IP 封禁**（[ipBanMatcher.js](../../src/modules/security/ipBanMatcher.js) + [ipBan.js](../../src/middleware/ipBan.js)）：`ip_bans` 表支持精确与 CIDR 匹配，**IPv4/IPv6 均支持**（BigInt 128 位运算，含 `::` 压缩、内嵌 IPv4、zone id 处理）；管理端录入路由（`POST /api/admin/ip-bans`）同样接受 IPv4/IPv6——`net.isIP` 判族，CIDR 前缀按族限制（IPv4 0–32 / IPv6 0–128）；跨地址族永不匹配；过期封禁在匹配时跳过。封禁列表缓存于 Redis `ip_bans_cache`（5min TTL），管理端增删改后调用 `refreshCache` 失效。检查失败时**fail open**（记录日志放行），保证封禁子系统故障不影响可用性。中间件在 CSRF 之前挂载，封禁 IP 在到达 API 前即被 403。

## 管理端 RBAC

[requireAdmin.js](../../src/middleware/requireAdmin.js) 定义 `ROLE_PERMISSIONS`：

| 角色 | 权限 |
|------|------|
| `super_admin`（旧值 `admin` 自动归一化） | `*` |
| `user_admin` | 用户读写/重置密码/删除/封禁/解锁、授权与登录日志读 |
| `security_admin` | 用户读+封禁/解锁、审计/短信审计读、IP 封禁读写 |
| `config_admin` | 系统/客户端/短信/邮件配置读写 |
| `readonly_admin` | 各资源只读 |

路由用 `requireAdminPermission('xxx')` 声明所需权限。保护机制（`src/routes/admin/users.js`）：删除、封禁、改角色均禁止**对自己操作**；且当目标是最后一个 `super_admin`/`admin` 时拒绝移除或降级——系统永远保有至少一名超管，且管理员无法自降级。

## 审计三条线

| 线 | 表 | 入口 | 记录内容 |
|----|-----|------|----------|
| 管理审计 | `admin_audit_logs` | `auditWriter.writeAdminAudit` → `utils/auditLog.js` | admin_id、action（如 `user.ban`、`client.create`）、target_type/target_id、details(JSON)、ip_address；覆盖全部管理端变更 |
| 用户审计 | `user_audit_logs` | `auditWriter.writeUserAudit` → `utils/userAudit.js` | user_id、白名单 action（`login_failed`、`account_locked`、`password_changed`、`email_changed`、`session_terminated` 等 10 种）、IP、UA、details；刻意低频——登录成功等高频事件放 `login_logs` |
| 短信审计 | `sms_audit_logs` | `utils/smsAudit.js` | user_id、action、脱敏手机号（`maskPhone`）、success、code、IP、UA |

三者均**只记不抛**：审计写入失败仅告警，绝不中断主请求流。

## HTTP 安全头与生产校验

[app.js](../../src/app.js) Helmet 配置：生产启用 HSTS（1 年、includeSubDomains、preload）；CSP 关键指令 `default-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'`（防点击劫持）、`connect-src` 限定 ALLOWED_ORIGINS。**注意 `script-src` 仍允许 `'unsafe-inline'`**：public/ 下遗留的静态 error/docs 页面含内联脚本，收紧前需先将其外置。配置 `CDN_URL` 时自动加入 script/style/img/font 源。

CORS 策略（app.js，`credentials: true`）：**同源请求（Origin host 与请求 Host 一致）始终放行**——浏览器对 fetch/crossorigin 资源在同站下也会附带 Origin 头，拒绝它们会打挂站点自身；跨域来源按 `ALLOWED_ORIGINS` 白名单放行；白名单外来源返回**不带 CORS 头的正常响应**（由浏览器阻止跨域读取），而非服务端 500。

[validate.js](../../src/config/validate.js) 启动强校验（生产环境命中即抛错拒绝启动）：

- `BASE_URL` 必填且不得指向 localhost/127.0.0.1
- `ADMIN_SECRET` 必填且 ≥32 字符（可经 `ADMIN_SECRET_MIN_LENGTH` 调整）
- `ALLOWED_ORIGINS` 禁止 `*`（credentials 模式下等于放开）
- 禁止 `USE_MEMORY_REDIS`（内存 Redis 会把会话/令牌/限流放进程内存）
- `MYSQL_HOST/DATABASE`、`REDIS_HOST` 必填；上传目录必须可写

## 已知遗留（Known deferred）

| 项 | 现状缓解 | 全面修复的前置条件 |
|----|----------|--------------------|
| `client_secret` 明文存储于 `clients` 表 | 比较走 `timingSafeCompare`；migration 002 已删除内嵌 secret 的凭据索引，避免索引页泄漏 | 哈希化后无法回显原文，需向所有第三方接入方**重新签发** client_secret 并协调切换窗口 |
| SMTP 密码 / 阿里云 AccessKeySecret 明文存于 `email_config` / 配置 | 管理端回显已脱敏 | 静态加密需要应用层密钥管理（密钥从何而来、如何轮换）；单靠 DB 内加密而密钥同库存放并无实质收益 |
| CSP `script-src 'unsafe-inline'` | 见上节 | 先将 `public/error.html` 等遗留页面的内联脚本外置 |
