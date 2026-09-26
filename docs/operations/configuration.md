# MindAuth 配置参考

本文档是 MindAuth 全部配置项的权威参考，覆盖环境变量、运行时常量与数据库动态配置三层。

> **维护提示**：修改 src/config/index.js、validate.js、system_config 种子键时需同步更新本文档。

## 配置分层

| 层级 | 来源 | 修改方式 | 生效时机 | 适用场景 |
|------|------|----------|----------|----------|
| 环境变量 | `.env` → `src/config/index.js` 读取 | 编辑 `.env` 后重启进程 | 重启后 | 静态基础设施配置（端口、数据库凭据、代理信任等） |
| 运行时常量 | `src/config/index.js` 内硬编码 | 改代码后重启 | 重启后 | 会话/令牌 TTL、限流窗口等安全基线 |
| 数据库动态配置 | `system_config` 表，经 `src/modules/config/runtimeConfig.js` 缓存 | 管理后台或 API | 最长 5 分钟延迟 | 运营策略（注册开关、密码规则、日志保留期） |

优先级原则：环境变量是静态配置的唯一权威；`system_config` 只管理动态运营配置，两者管辖的键不重叠。

## 环境变量全表

按 `src/config/index.js` 中 config 对象分组。**加粗**为生产环境必填（缺失或非法会阻断启动，见下一节）。

### server

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4001` | 服务监听端口 |
| **`BASE_URL`** | `http://localhost:4001` | 服务基础 URL（邮件链接使用）；生产不得为 localhost |
| `MINDFOURM_BASE_URL` | `https://mdtbbs.cn` | MDTBBS 论坛主页；开发者资料链接使用该地址拼接 `/users/{id}` |
| `CDN_URL` | 空 | CDN 基础 URL，配置后自动加入 CSP |
| `NODE_ENV` | `development` | `production` 启用严格校验与安全 Cookie |
| **`ALLOWED_ORIGINS`** | `http://localhost:3000,4000,4001` | CORS 允许来源（逗号分隔），只需列跨域调用方——同源自动放行；生产禁止 `*` |

### mysql

| 变量 | 默认值 | 说明 |
|------|--------|------|
| **`MYSQL_HOST`** | 无 | MySQL 主机；未设置时必须提供 `MYSQL_SOCKET_PATH` |
| `MYSQL_SOCKET_PATH` | 无 | 本机 Unix socket 路径；仅适合受限本地开发/测试，生产仍建议 TCP + 独立凭据 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| **`MYSQL_USER`** | 无 | MySQL 用户（所有环境必填） |
| **`MYSQL_PASSWORD`** | 空 | MySQL 密码（生产环境必填；开发环境可按本机 MySQL 配置留空） |
| **`MYSQL_DATABASE`** | 无 | 数据库名（所有环境必填） |
| `MYSQL_POOL_SIZE` | `10` | 连接池大小 |

### redis

| 变量 | 默认值 | 说明 |
|------|--------|------|
| **`REDIS_HOST`** | `localhost` | Redis 主机（所有环境必填，有默认值） |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | 无 | Redis 密码 |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `USE_MEMORY_REDIS` | 未设置 | `1`/`true` 时用进程内存模拟 Redis，仅限本地/CI；**生产禁用** |

### smtp（环境变量回退，见下方"SMTP 与短信配置"）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SMTP_HOST` | 无 | SMTP 主机 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_USER` | 无 | SMTP 用户名 |
| `SMTP_PASS` | 无 | SMTP 密码 |
| `SMTP_FROM` | 无 | 发件人地址 |
| `SMTP_SECURE` | `false` | `true` 启用 TLS 直连 |

### admin / adminSecurity

| 变量 | 默认值 | 说明 |
|------|--------|------|
| **`ADMIN_SECRET`** | 无 | 管理员创建密钥；生产必填且 ≥32 字符 |
| `ADMIN_SECRET_MIN_LENGTH` | `32` | 生产环境 ADMIN_SECRET 最小长度阈值（未收录进 .env.example，一般无需修改） |

### 阿里云短信（`src/utils/aliyunSms.js` 读取，不在 config 对象内）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 无 | 阿里云 AccessKey |
| `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE` | 无 | 短信签名与模板（模板变量 `${code}`） |

## 生产环境强校验

`src/config/validate.js` 在启动时（`src/bootstrap.js` 第一步）执行。`NODE_ENV=production` 下以下任一不满足即抛错阻断启动：

1. `BASE_URL` 必须设置，且不含 `localhost` / `127.0.0.1`
2. `ADMIN_SECRET` 必须设置，且长度 ≥ `ADMIN_SECRET_MIN_LENGTH`（默认 32）
3. `ALLOWED_ORIGINS` 不得包含 `*`（凭据模式下的通配 CORS）
4. `USE_MEMORY_REDIS` 不得为 `1`/`true`（内存 Redis 会在重启时丢失会话、OAuth 令牌与限流数据）
5. 上传目录不可写视为致命错误（开发环境仅告警）

所有环境均要求 `MYSQL_HOST` 或 `MYSQL_SOCKET_PATH`、`MYSQL_DATABASE`、`REDIS_HOST` 非空。生产环境额外要求 `MYSQL_USER` 与 `MYSQL_PASSWORD` 非空。测试环境若不提供 `MYSQL_USER`，必须显式提供 `MYSQL_SOCKET_PATH`，且数据库名必须是 `test_*` 或 `*_test`；这样会在连接池创建前给出缺失配置的明确错误，避免 MySQL 返回含混的匿名用户或“using password: NO”报错。

上传目录处理：自动创建 `public/uploads/` 及 `avatars/`、`banners/` 子目录，并通过写入/删除 `.write-test` 临时文件验证可写性（登录页背景目录 `backgrounds/` 由 `src/middleware/upload.js` 加载时创建，不在 validate.js 校验范围内）。

## 运行时常量

硬编码于 `src/config/index.js`，修改需改代码并重启：

| 常量 | 值 | 说明 |
|------|-----|------|
| `session.maxAge` | 30 天 | 用户会话有效期 |
| `session.cacheTtl` | 1800 秒（30 分钟） | 会话 Redis 缓存 TTL |
| `admin.sessionMaxAge` | 24 小时 | 管理员会话有效期 |
| `tokenTtl.accessToken` | 3600 秒（1 小时） | OAuth access token |
| `tokenTtl.refreshToken` | 30 天 | OAuth refresh token |
| `tokenTtl.authCode` | 300 秒（5 分钟） | OAuth 授权码 |
| `tokenTtl.emailVerification` | 3600 秒（1 小时） | 邮箱验证令牌 |
| `tokenTtl.passwordReset` | 3600 秒（1 小时） | 密码重置令牌 |

限流常量（每个限流器有独立 `keyPrefix`，互不干扰）：

| 限流器 | 限额 | keyPrefix |
|--------|------|-----------|
| 登录 | 5 次 / 5 分钟 | `ratelimit:login` |
| 注册 | 5 次 / 1 小时 | `ratelimit:register` |
| 管理员登录 | 3 次 / 15 分钟 | `ratelimit:admin_login` |
| 管理端删除用户 | 10 次 / 1 小时 | `ratelimit:admin_user_delete` |
| 管理端重置密码 | 20 次 / 1 小时 | `ratelimit:admin_password_reset` |
| 管理端创建客户端 | 20 次 / 1 小时 | `ratelimit:admin_client_create` |

## runtimeConfig 动态配置

`system_config` 表由迁移播种 7 个键（`001_initial_schema.sql` 6 个 + `003_auth_background_config.sql` 1 个）：

| 键 | 默认值 | 含义 |
|----|--------|------|
| `session_lifetime_days` | `30` | Session 有效期（天） |
| `password_min_length` | `6` | 密码最小长度 |
| `password_require_complexity` | `0` | 是否要求密码复杂度（0/1） |
| `registration_enabled` | `1` | 是否允许新用户注册（0/1） |
| `sms_audit_retention_days` | `365` | 短信审计日志保留天数 |
| `audit_retention_days` | `365` | 管理审计日志保留天数 |
| `auth_background_url` | 空 | 登录页自定义背景图 URL（空 = 默认网格背景）。由管理后台系统配置页「登录页外观」tab 上传维护（`POST/DELETE /api/admin/auth-background`，含旧文件清理），**勿在通用配置列表里手改** |

**缓存行为**：`runtimeConfig` 使用进程内 Map 缓存，TTL 5 分钟（`CACHE_TTL_MS`）。`set()` 写库后仅使**本进程**缓存失效——单实例部署下管理端修改立即生效；多实例部署下其他实例最长 5 分钟后才读到新值。

**修改入口**：管理后台系统设置页，或 `GET /api/admin/config` / `PUT /api/admin/config/:key`（需 `config.read` / `config.write` 权限，见 `src/routes/admin/settings.js`）。`set()` 只 UPDATE 已存在的键，不会插入新键。

**例外**：`src/utils/cleanup.js`（每小时执行）读取 `sms_audit_retention_days` 与 `audit_retention_days` 时**直接查库**、不经 runtimeConfig 缓存，修改后下一轮清理即按新值执行（下限强制为 1 天，非法值回退 365）。`audit_retention_days` 同时作用于 `admin_audit_logs` 与 `user_audit_logs`。

## SMTP 与短信配置

两者均支持"数据库配置 + 环境变量"双来源，但**优先级方向相反**：

| 服务 | 数据源 | 优先级（源码依据） |
|------|--------|--------------------|
| SMTP 邮件 | `email_config` 表（id=1，管理后台可改）与 `SMTP_*` 环境变量 | **数据库优先**：`email_config` 的 host/user/password 齐全即用数据库；否则回退环境变量（`src/utils/email.js` `getEmailConfig`） |
| 阿里云短信 | `ALIYUN_*` 环境变量与 `sms_config` 表（id=1） | **环境变量优先**：四个 `ALIYUN_*` 齐全即用环境变量；否则回退数据库（需 `enabled=1` 且字段齐全）（`src/utils/aliyunSms.js` `getSmsConfig`） |

注意：非生产环境（`NODE_ENV !== 'production'`）下邮件不实际发送，仅打印到控制台。

已知遗留：SMTP 密码与阿里云 AccessKeySecret 目前在数据库中明文存储（管理端回显已脱敏），静态加密需应用级密钥管理，详见 [安全架构文档](../architecture/security.md)。
> 敏感配置说明：数据库中的 SMTP 密码和阿里云 `AccessKeySecret` 使用
> AES-256-GCM 加密，密钥由 `SECRETS_ENCRYPTION_KEY` 提供。升级时启动迁移会
> 转换旧明文值，生产环境必须配置该密钥。
