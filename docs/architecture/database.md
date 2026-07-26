# MindAuth 数据模型

MindAuth 使用 MySQL（18 张业务表）持久化账号、OAuth 与审计数据，使用 Redis 承载会话缓存、短时令牌与限流计数；schema 由启动时自动执行的版本化迁移管理。

> **维护提示**：修改 src/db/migrations/**、src/db/* 时需同步更新本文档。

## 迁移机制

迁移由 [`src/db/migrator.js`](../../src/db/migrator.js) 实现，在启动序列（`src/bootstrap.js` 连接 MySQL 后）自动运行：

1. **发现**：读取 [`src/db/migrations/`](../../src/db/migrations/) 目录，匹配 `^\d+_.*\.sql$` 的文件，按文件名排序，前缀数字即版本号。
2. **记录**：首次运行创建 `schema_version` 表（`version` PRIMARY KEY、`name`、`applied_at`），已应用的版本不会重复执行——正常启动**从不删数据**，重复调用是 no-op。
3. **执行**：每个待执行文件经 `splitStatements()` 拆成单条语句依次 `pool.query()`。全部成功后才写入 `schema_version`；任一语句失败则抛错且**不记录版本**，下次启动重试。注意 MySQL 的 DDL 会隐式 COMMIT，失败的迁移可能已部分生效，无法真正回滚。

现有三个迁移文件（以 SQL 文件为准）：

| 文件 | 内容边界 |
|------|---------|
| [`001_initial_schema.sql`](../../src/db/migrations/001_initial_schema.sql) | 全量初始 schema：18 张表 + `email_config`/`sms_config` 的单行种子 + `system_config` 的 6 个种子键 |
| [`002_security_hardening.sql`](../../src/db/migrations/002_security_hardening.sql) | 安全加固：`user_sessions` 增加 `expires_at` 列（存量回填 30 天）并将 token 索引改为 UNIQUE（`uniq_sessions_token`）、新增 `idx_sessions_expires`；`refresh_tokens.token` 存量值 `SHA2(token, 256)` 哈希化；删除 `clients` 的 `idx_clients_credentials` 复合索引（含 secret）；删除 `users.session_token` 列及 `idx_users_session`、冗余的 `idx_users_username`/`idx_users_email`；`ip_bans` 新增 `idx_ip_bans_ip` |
| [`003_auth_background_config.sql`](../../src/db/migrations/003_auth_background_config.sql) | `INSERT IGNORE` 种子 `system_config` 的 `auth_background_url` 键（登录页自定义背景图 URL，空 = 默认网格背景）。必须由迁移种子的原因：`runtimeConfig.set()` 只执行 UPDATE 不插入新键，行不存在时管理端无法保存——**新增任何 system_config 配置键都须走迁移种子** |

## MySQL 表

所有表均为 `ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。带 `user_id` 的表除注明外均通过 `FOREIGN KEY ... ON DELETE CASCADE` 关联 `users(id)`，删除用户时级联清理。

### 用户与会话

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `users` | 用户账号主表 | `username`/`email`/`phone` 均 UNIQUE；`password_hash`（bcrypt）；`role`、`email_verified`、`phone_verified(_at)`；头像/横幅 `avatar_url`/`banner_url`；锁定 `lock_level` + `locked_until`；封禁 `ban_status`/`ban_reason`/`banned_by`/`ban_expires_at`。几乎所有表都外键指向它 |
| `user_sessions` | 活跃会话追踪（Web 登录态） | `session_token` 存 SHA-256 哈希（UNIQUE），`ip_address`、`user_agent`、`device_info`、`expires_at`（绝对过期，002 引入）、`last_active_at` |
| `login_logs` | 登录历史 | `ip`、`device`、`login_type`（`web`/`oauth`），供用户端"登录记录"与管理端统计使用 |
| `email_verification_tokens` | 邮箱验证令牌的 MySQL 兜底（Redis 重启丢数据时回查） | `token`（主键，存哈希）、`email`（待验证/待变更邮箱）、`expires_at` |

### OAuth

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `clients` | 第三方 OAuth 应用注册 | `client_id`（UNIQUE）、`client_secret`（明文存储——见 CLAUDE.md 已知遗留项）、`redirect_uri`、`require_pkce`。无外键 |
| `authorizations` | 用户对客户端的授权记录 | `(user_id, client_id)` UNIQUE；`scope`、`last_used_at`。`client_id` 为字符串关联 `clients.client_id`（无外键约束） |
| `refresh_tokens` | 长效刷新令牌 | `token`（UNIQUE，SHA-256 哈希存储）、`scope`、`expires_at`、`revoked`；按 `(user_id, client_id)` 与 `(user_id, client_id, revoked)` 建索引供批量吊销 |

### 审计日志

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `admin_audit_logs` | 管理员操作审计 | `admin_id`（无外键，管理员被删后日志保留）、`action`、`target_type`/`target_id`、`details`（JSON）、`ip_address` |
| `user_audit_logs` | 普通用户安全事件（登录失败、改密、改邮箱等） | `user_id`（外键级联）、`action`、`details`（JSON）、`ip_address`、`user_agent` |

### 配置

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `email_config` | SMTP 配置，单行表（`CHECK (id = 1)`，种子插入 id=1） | `host`/`port`/`user`/`password`/`from`/`secure` |
| `system_config` | 键值型运行时配置 | `key`（主键）、`value`、`description`；见下文 [runtimeConfig](#runtimeconfig-动态配置) |

### 安全

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `ip_bans` | IP 黑名单（支持 CIDR） | `ip_address` + `cidr_prefix`（NULL 表示单 IP）、`reason`、`banned_by`、`expires_at`（NULL 为永久）。被 `ipBanMatcher` 全量加载进 Redis 缓存 |
| `challenge_questions` | 注册挑战问答题库 | `question`、`answer_hash`（bcrypt）、`enabled` |

### 通知与自定义字段

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `user_notifications` | 站内通知 | `type`、`title`、`content`、`is_read`；按 `(user_id, is_read, created_at)` 建索引 |
| `user_fields` | 自定义资料字段定义（管理端配置） | `field_key`（UNIQUE）、`field_label`、`field_type`、`is_required`、`is_public`、`options`（JSON）、`sort_order`。无外键 |
| `user_field_values` | 用户填写的字段值 | `(user_id, field_id)` UNIQUE；双外键级联 `users` 与 `user_fields` |

### 短信

| 表 | 用途 | 关键列与关联 |
|----|------|-------------|
| `sms_config` | 阿里云短信配置，单行表（`CHECK (id = 1)`） | `enabled`、`access_key_id`/`access_key_secret`、`sign_name`、`template_code` |
| `sms_audit_logs` | 短信发送/校验审计 | `user_id` 可为 NULL（无外键）、`action`、`phone_masked`、`success`、`code`、`ip_address` |

## Redis 键空间

以下键均在源码中核实（模块路径相对 `src/`）。带 TTL 的键靠 Redis 自动过期清理，MySQL 侧对应数据由 [`src/utils/cleanup.js`](../../src/utils/cleanup.js) 每小时清理。

| 键模式 | TTL | 用途 | 写入方 |
|--------|-----|------|--------|
| `session:{sha256(token)}` | 24h | 用户会话缓存（payload 内含 `session_expires_at`，命中缓存也强制绝对过期） | `modules/sessions/sessionManager.js` |
| `sessions_by_user:{userId}` | 无 | 用户→会话 id 索引 SET，批量吊销免 SCAN | `modules/sessions/sessionManager.js` |
| `admin_session:{sha256(token)}` | 24h | 管理员会话（仅存 Redis，不落 MySQL） | `modules/sessions/sessionManager.js` |
| `admin_sessions_by_user:{userId}` | 无 | 管理员→会话哈希索引 SET | `modules/sessions/sessionManager.js` |
| `session_active:{sessionId}` | 5min | `last_active_at` 更新节流（注意按会话 id 而非 token 哈希键控） | `modules/sessions/sessionManager.js` |
| `authcode:{code}` | 5min | OAuth 授权码，`GETDEL` 原子消费（单次使用） | `modules/oauth/tokenStore.js` |
| `accesstoken:{sha256(token)}` | 1h | OAuth 访问令牌（哈希存储） | `modules/oauth/tokenStore.js` |
| `accesstokens_by_userclient:{userId}:{clientId}` | 无 | 用户+客户端→访问令牌哈希索引 SET | `modules/oauth/tokenStore.js` |
| `verify:{sha256(token)}` | 1h | 邮箱验证令牌（注册/重发流程哈希存储；MySQL 兜底表同步写入） | `routes/auth.js`、`routes/email-verification.js`、`routes/account.js` |
| `reset:{sha256(token)}` | 1h | 密码重置令牌（哈希存储） | `routes/password.js` |
| `login_fail:{username}:{ip}` | 5min | 登录失败计数（按用户名+IP 键控；满 5 次触发 15min→1h→2h 递增锁定后删除） | `routes/auth.js` |
| `ratelimit:{name}:{ip}` | 随窗口 | 固定窗口限流计数；每个限流器必须有唯一 `keyPrefix`（如 `ratelimit:login` 5/5min、`ratelimit:register` 5/h、`ratelimit:admin_login` 3/15min、`ratelimit:oauth_token` 60/min 等，共约 20 个前缀） | `middleware/rateLimit.js`（前缀定义在 `config/index.js` 与各路由） |
| `sms:code:{phone}` | 5min | 短信验证码 | `utils/aliyunSms.js` |
| `sms:send:ip:{ip}` | 1h | 短信发送限流：同 IP 3 次/时 | `modules/sms/smsBinding.js` |
| `sms:send:user:{userId}` | 5min | 短信发送限流：同用户 3 次/5min | `modules/sms/smsBinding.js` |
| `sms:send:phone:{phone}` | 1min | 短信发送限流：同号码 1 次/min | `modules/sms/smsBinding.js` |
| `sms:verify:fail:user:{userId}:{phone}` / `...:phone:{phone}` / `...:ip:{ip}` | 5min / 1h / 1h | 短信校验失败计数（阈值 5/10/20），校验成功清除 user 维度 | `modules/sms/smsBinding.js` |
| `challenge_session:{csrfToken}` | 30min | 注册挑战问答会话状态 | `modules/challenges/challengeManager.js` |
| `ip_bans_cache` | 5min | `ip_bans` 全表缓存（增删改时主动 DEL） | `modules/security/ipBanMatcher.js` |

## runtimeConfig 动态配置

[`src/modules/config/runtimeConfig.js`](../../src/modules/config/runtimeConfig.js) 是 `system_config` 表的唯一读写封装：环境变量（`src/config/index.js`）管静态配置，本模块管动态配置。

**种子键**（001 迁移种子 6 个 + 003 迁移种子 1 个，均 `INSERT IGNORE` 写入，共 7 个）：

| 键 | 默认值 | 含义 |
|----|--------|------|
| `session_lifetime_days` | `30` | Session 有效期（天） |
| `password_min_length` | `6` | 密码最小长度 |
| `password_require_complexity` | `0` | 是否要求密码复杂度（0/1） |
| `registration_enabled` | `1` | 是否允许新用户注册（0/1） |
| `sms_audit_retention_days` | `365` | 短信审计日志保留天数 |
| `audit_retention_days` | `365` | 管理审计日志保留天数 |
| `auth_background_url` | 空 | 登录页自定义背景图 URL（空 = 默认网格背景；003 迁移种子，经管理端 `auth-background` 端点维护） |

**缓存与写入**：

- 进程内 `Map` 缓存，TTL 5 分钟（`CACHE_TTL_MS`）；`get()`/`getMany()` 缓存优先、miss 回源 DB（DB 中不存在的键缓存为 `null`）。
- 写入口均在管理端（`routes/admin/settings.js`，需 `config.write` 权限）：通用的 `PUT /api/admin/config/:key`，以及专管 `auth_background_url` 的 `POST/DELETE /api/admin/auth-background`（含旧背景文件清理）。内部均调用 `set()`：只 `UPDATE` 已存在的键并使该键缓存失效。缓存是单进程的，多实例部署时其他实例最长 5 分钟后才看到新值。
- **例外**：`cleanup.js` 读取 `sms_audit_retention_days` 与 `audit_retention_days` 时**不经过本模块**，直接 `SELECT ... FROM system_config` 查库，因此保留天数修改对清理任务立即生效。

## 事务与错误处理约定

- **事务**：[`src/db/transactions.js`](../../src/db/transactions.js) 导出 `transaction(callback)`——从连接池取连接、`beginTransaction`，回调收到 `conn` 并须用它执行所有语句；回调正常返回则 `commit`，抛错则 `rollback` 并重新抛出，连接始终 `release`。跨表写入（如 oauthIssuer 的刷新令牌轮换）必须走它，不要手动管理连接。
- **错误判定**：[`src/db/errors.js`](../../src/db/errors.js) 提供三个纯函数，路由层用它们把 MySQL 错误翻译为业务响应：
  - `isDuplicateError(err)` — `ER_DUP_ENTRY`；
  - `getDuplicateField(err)` — 从 `sqlMessage` 解析冲突字段（优先识别 `phone`/`username`/`email`，否则回退正则提取索引名）；
  - `isForeignKeyError(err)` — `ER_NO_REFERENCED_ROW_2` / `ER_ROW_IS_REFERENCED_2`。
- 统一入口为 [`src/db/index.js`](../../src/db/index.js)：`pool`、`closePool`、`runMigrations`、`seedTestFixtures`、`transaction` 与上述错误函数均从这里导出，业务代码不要直接 require `pool.js`。

## 新增迁移的规范

1. **命名**：`src/db/migrations/NNN_slug.sql`，`NNN` 为零填充三位递增版本号（文件按名称字符串排序，不补零会乱序）。版本号取自 `parseInt` 首段数字，不可与已有版本重复。
2. **一经合并不可改**：`schema_version` 只记录版本号，已应用的文件内容修改不会重跑；schema 变更一律新开文件。
3. **书写注意（`splitStatements` 的行为）**：
   - 以 `;` 拆分语句；`--` 行注释与 `/* */` 块注释会被剥离；单引号字符串内的分号/注释符受保护。
   - **反引号内不受保护**：解析器不识别反引号引用，标识符里不要包含 `;` 或 `--`。
   - 不支持 `DELIMITER`，因此不能写存储过程/触发器/多语句体。
4. **失败即部分生效**：DDL 隐式 COMMIT，迁移中途失败不会回滚已执行的 DDL，且版本未记录、下次启动会整文件重跑——尽量让每条语句幂等（`CREATE TABLE IF NOT EXISTS`、`INSERT IGNORE`），或把有风险的 `ALTER` 拆到独立小迁移里。
5. 破坏性重置（drop/重建）不属于正常启动路径，必须作为显式运维步骤写进 release notes。
