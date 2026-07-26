# MindAuth 运维手册

面向运维与值班开发者的操作手册：巡检脚本、常见故障定位、数据运维与安全事件响应。

> **维护提示**：修改 scripts/*、src/utils/cleanup.js、管理端安全操作端点时需同步更新本文档。

## 巡检脚本

均在 MindAuth 根目录执行 `node scripts/<name>.js`，依赖 `.env`。

| 脚本 | 用途 | 依赖 |
|------|------|------|
| [check-redis.js](../../scripts/check-redis.js) | 列出所有 `ratelimit:*` 限流计数器 | Redis |
| [test-redis.js](../../scripts/test-redis.js) | 三段式 Redis 连接诊断 | Redis |
| [verify-routing.js](../../scripts/verify-routing.js) | 验证 Express 路由/静态资源（无需 DB/Redis） | 无（需先 `npm run build`） |
| [check-servers.js](../../scripts/check-servers.js) | **遗留脚本，已失效** | — |

### check-redis.js
逐个打印 `ratelimit:*` 键的当前计数与剩余 TTL（如 `ratelimit:login:1.2.3.4: value=5, ttl=280s`）。排查"用户被 429 限流"时先跑它，确认哪个 IP 命中了哪个限流前缀。

### test-redis.js
依次尝试：标准连接 → URL 格式连接 → 无密码连接。若 Test3 成功会提示 Redis 实际不需要密码（应修正 `.env`）。注意：脚本会**明文打印 REDIS_PASSWORD**，勿在共享终端/日志中运行。

### verify-routing.js
以 `USE_MEMORY_REDIS=1` + 假 DB 池在端口 14099 启动应用，验证用户 SPA、管理 SPA、`/api/health`、Vite 资源缓存头、OIDC Discovery 等 13 组路由。输出 `✔/✖` 与总计，失败时退出码 1。适合部署后快速验证构建产物完整。

### check-servers.js
查询 `servers` / `user_quotas` 表（属 EasyManager，MindAuth 库中不存在），且 `require('./src/db/mysql')` 路径已不存在。**勿使用**，仅存档。

## 常见故障

### Redis 断连
- **现象**：日志刷 `Redis Client Error:`（[src/redis/index.js](../../src/redis/index.js)）；限流中间件打印 `Rate limit Redis error, using memory fallback:`。
- **定位**：`node scripts/test-redis.js`；`GET /api/health` 会反映 Redis 状态。
- **行为（以源码为准）**：
  - 限流自动退化为**进程内存 Map**（[rateLimit.js](../../src/middleware/rateLimit.js)），窗口逻辑不变，但计数不跨实例、重启即清零。
  - 会话认证（[sessionManager.js](../../src/modules/sessions/sessionManager.js)）的 MySQL 回退**只在缓存未命中（返回 null）时触发**，如缓存被清空/过期，可自动回源 DB 重建。但 Redis 命令**抛错**时没有 try/catch 兜底，请求会 500；node-redis 默认离线队列还可能让请求挂起等待重连。
  - 管理员会话**只存 Redis**：Redis 数据丢失 = 全部管理员被登出（重新登录即可）；用户会话在 MySQL 有持久行，不受影响。
- **处置**：恢复 Redis 后无需重启应用（客户端自动重连）；若长时间不可用，优先恢复 Redis 而非重启应用。

### MySQL 不可达
- **启动期**：`runMigrations` 在连接阶段即失败，[server.js](../../src/server.js) 打印 `Fatal startup error:` 并 `exit(1)`（PM2 会循环重启，见 `pm2 logs mindauth`）。
- **运行期**：登录/注册/会话回源全部 500；每小时的清理任务打印 `Cleanup error:` 但不会导致进程退出。
- **处置**：检查 MySQL 服务与 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`；恢复后连接池自愈。

### 迁移失败导致无法启动
- **现象**：日志出现 `Migration FAILED: <name> (vN)` + 失败语句前 200 字符 + 错误信息，随后 `Fatal startup error`。
- **机制**（[migrator.js](../../src/db/migrator.js)）：失败版本**不会**写入 `schema_version`，下次启动自动重试。但 MySQL DDL 隐式提交，失败的迁移可能已部分生效——重试若报"列已存在"等，需人工比对该迁移 SQL 与实际表结构后手工修复，再重启。
- **配置校验失败**也会同样 exit(1)：生产环境要求 BASE_URL 非 localhost、ADMIN_SECRET ≥32 字符、禁止 `ALLOWED_ORIGINS=*` 与 `USE_MEMORY_REDIS=1`、uploads 目录可写（[validate.js](../../src/config/validate.js)），报错信息逐条列出。

### 限流误伤（全站共享一个 IP）
- **现象**：大量互不相关用户同时被 429/锁定；`node scripts/check-redis.js` 显示某个限流键计数异常高，且该 IP 是 CDN/反代地址。
- **原因**：经反代部署但未配置可信代理，`getClientIp` 默认不信任代理头，所有请求识别为反代 IP。
- **修复**：`.env` 设置 `TRUSTED_PROXY_ENABLED=true` + `TRUSTED_PROXY_IPS=<反代IP列表>`（Cloudflare 用 `TRUST_CLOUDFLARE=true`），重启；用非生产环境的 `POST /api/admin/test/clear-rate-limits`（需 ADMIN_SECRET）或手工 `DEL ratelimit:*` 清残留计数。

### SMTP 发信失败
1. 管理后台「设置」页检查 SMTP 配置：`GET/PUT /api/admin/email-config`（DB `email_config` 表优先于环境变量）。
2. `POST /api/admin/test-email` 发送测试邮件（有独立限流前缀）。
3. 仍失败则看进程日志中 nodemailer 报错（认证/端口/TLS），核对 `SMTP_SECURE` 与端口匹配（465=secure）。

## 数据运维

### 定时清理（[cleanup.js](../../src/utils/cleanup.js)）
启动即执行一次，之后**每 1 小时**运行，日志一行 `Cleanup completed: removed ...`：

| 清理对象 | 条件 | 保留天数配置键（system_config） |
|----------|------|-------------------------------|
| `refresh_tokens` | `expires_at` 已过期 | — |
| `sms_audit_logs` | 超过保留期 | `sms_audit_retention_days`（默认 365） |
| `user_sessions` | 过绝对过期时间；遗留 NULL 行 30 天不活跃 | — |
| `admin_audit_logs` / `user_audit_logs` | 超过保留期 | `audit_retention_days`（默认 365） |
| `email_verification_tokens` | 已过期 | — |

保留天数可在管理后台设置页（`/api/admin/config`）修改，最小 1 天。Redis 中的 auth code、管理员会话、重置/验证令牌靠 TTL 自动过期，无需清理。

### uploads 备份
用户头像/横幅存于 `public/uploads/{avatars,banners}/`，**不在数据库中**，需纳入文件级备份（DB 备份只含 `avatar_url` 路径）。

## 安全事件响应

| 操作 | 路径 | 备注 |
|------|------|------|
| 封禁 IP | 管理后台 Security 页，或 `POST /api/admin/ip-bans` `{ip, cidr_prefix, reason, expires_at}` | 路由校验**仅接受 IPv4**（CIDR 0–32），匹配引擎虽支持 IPv6 但无法经此路由录入；生效即时（自动刷新缓存） |
| 解封 IP | `DELETE /api/admin/ip-bans/:id` | |
| 封禁用户 | `POST /api/admin/users/:id/ban` `{reason, duration, expires_at}` | **自动吊销该用户全部用户+管理员会话**并通知；解封 `DELETE /api/admin/users/:id/ban` |
| 吊销用户全部会话 | 无独立端点 | 随封号 / 删号 / `POST /api/admin/users/:id/reset-password` 自动执行；仅吊销会话需调用模块 `sessionManager.revokeAllUserSessions(userId)`（[sessionManager.js](../../src/modules/sessions/sessionManager.js)） |
| 撤销 OAuth 授权 | `DELETE /api/admin/authorizations/:id` | **仅删除 authorizations 记录**，不联动吊销已发放的 refresh/access token；彻底切断需另删该用户该客户端的 `refresh_tokens` 或直接封号 |
| 轮换客户端 secret | **仅模块层提供** `clientRegistry.rotateSecret(id, actor)`，无 HTTP 路由 | 替代：删除并重建客户端（会换 client_id），或扩展路由暴露 rotateSecret |
| ADMIN_SECRET 泄漏 | 更换 `.env` 中 `ADMIN_SECRET`（≥32 字符）并重启（`pm2 restart mindauth`） | 该密钥可调用 `POST /api/admin/create` 创建管理员及非生产 `/test/*` 端点；事后核查 `admin_audit_logs` 与 users 表中异常管理员账号并清除 |

## 日志去哪看

| 日志 | 入口 |
|------|------|
| `login_logs` | 管理后台 Logs 页 / `GET /api/admin/login-logs`（可按 user_id、login_type 过滤）；用户自查 `GET /api/login-logs` |
| `admin_audit_logs` | 管理后台审计页 / `GET /api/admin/audit-logs`（可过滤） |
| `user_audit_logs` | 仅用户自查 `GET /api/account/audit-logs`；**无管理端查看路由**，管理侧需直接查库 |
| `sms_audit_logs` | `GET /api/admin/sms-audit-logs` |
| 进程日志 | PM2 部署时在 monorepo 根 `../logs/mindauth-{out,error}.log`（见根目录 `ecosystem.config.js`），或 `pm2 logs mindauth` |
