# MindAuth

OAuth 2.0 SSO 认证服务，为 Mindustry 社区应用提供统一登录。

## 功能

- 用户注册/登录（邮箱 + 密码）
- 邮箱验证
- 密码重置
- 手机短信验证（阿里云 SMS）
- 挑战问题验证
- OAuth 2.0 授权码模式（支持 PKCE S256）
- OIDC Discovery (`/.well-known/openid-configuration`)
- 管理后台（用户管理、OAuth 客户端、审计日志）
- IP 封禁管理（支持 CIDR）
- 用户通知（站内 + 邮件）
- 自定义用户字段
- 登录日志记录
- 会话管理（多设备登录，Token 哈希存储）

## 架构

MindAuth 是单进程 Express 服务，同时承载 React 前端和 API：

```
Browser
  │
  ├── /admin, /admin/*  →  Admin React SPA (dist/client/admin.html)
  ├── /*                →  User React SPA  (dist/client/index.html)
  ├── /assets/*         →  Vite hashed static assets (1y cache)
  ├── /uploads/*        →  User uploads (avatars, banners)
  ├── /api/*            →  Express API routes
  └── /api/health       →  Health check (MySQL + Redis)
```

### 后端模块 (`src/modules/`)

| Module | File | Purpose |
|--------|------|---------|
| `sessionManager` | `sessions/sessionManager.js` | Session lifecycle: create, authenticate, touch, revoke (user + admin) |
| `oauthIssuer` | `oauth/oauthIssuer.js` | OAuth 2.0 business logic: authorize, exchange, refresh, introspect, revoke, userinfo |
| `tokenStore` | `oauth/tokenStore.js` | Redis-backed auth codes and access tokens |
| `clientRegistry` | `admin/clientRegistry.js` | OAuth client CRUD, redirect URI validation (SSRF protection) |
| `challengeManager` | `challenges/challengeManager.js` | Challenge question bank + session-based verification |
| `notificationCenter` | `notifications/notificationCenter.js` | In-app notification CRUD |
| `smsBinding` | `sms/smsBinding.js` | SMS code send/verify with rate limiting |
| `ipBanMatcher` | `security/ipBanMatcher.js` | IP ban matching with CIDR support |
| `auditWriter` | `audit/auditWriter.js` | Admin and user audit log writing |
| `runtimeConfig` | `config/runtimeConfig.js` | Cached runtime configuration from `system_config` table |

### 前端

React 18 + Vite 构建，输出到 `dist/client/`。两个入口：
- `frontend/index.html` → 用户中心 SPA
- `frontend/admin.html` → 管理后台 SPA

## 快速开始

### 环境要求

- Node.js 18+
- MySQL 8.0+
- Redis 7.0+

### 安装

```bash
npm install
```

### 配置

复制 `.env.example` 到 `.env`：

```bash
cp .env.example .env
```

修改关键配置：
- `ADMIN_SECRET` - 管理员创建密钥（必须修改，32+ 字符）
- `BASE_URL` - 系统 URL（生产环境使用实际域名）
- `MYSQL_*` - MySQL 数据库配置
- `REDIS_*` - Redis 配置
- `SMTP_*` - 邮件配置（也可在管理后台配置）

### 构建

```bash
npm run build          # 构建 React 前端 (vite build → dist/client/)
npm run verify         # TypeCheck + Build
```

### 启动

```bash
npm start              # 生产模式 (node src/server.js)
npm run dev            # 开发模式 (node --watch src/server.js，自动重启)
```

启动时自动执行数据库迁移（`runMigrations`）。开发环境自动 seed 测试账户。

### 访问

- 用户中心: http://localhost:4001
- 管理后台: http://localhost:4001/admin
- OAuth 文档: http://localhost:4001/docs.html
- Health check: http://localhost:4001/api/health

### 开发环境测试账户

开发环境自动 seed 以下账户：

| 用户名 | 密码 | 角色 |
|--------|------|------|
| `testadmin` | `AdminPass123` | `super_admin` |

### 测试

```bash
npm run test:unit      # Unit tests (node --test)
npm run test:e2e       # E2E tests (Playwright)
npm run typecheck      # TypeScript type checking
```

## OAuth 接入

详见 `/docs.html` 或 [OAuth 接入文档](docs/third-party-integration.md)

### 快速接入步骤

1. 管理后台创建 OAuth 应用，获取 `client_id` 和 `client_secret`
2. 用户授权：重定向到 `/api/authorize?client_id=xxx&redirect_uri=xxx&state=xxx`
3. 获取 Token：POST `/api/token` with `code`, `client_id`, `client_secret`
4. 刷新 Token：POST `/api/refresh` with `refresh_token`, `client_id`, `client_secret`

### OIDC Discovery

```
GET /.well-known/openid-configuration
```

返回所有 OAuth 端点 URL 和支持的 grant types / response types。

### Token 验证

```http
POST /api/verify
Content-Type: application/json

{ "session_token": "xxx" }
```

## API 端点

### 用户认证
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/register` | POST | 用户注册 |
| `/api/login` | POST | 用户登录 |
| `/api/logout` | POST | 用户登出 |
| `/api/me` | GET | 当前用户信息 |
| `/api/login-logs` | GET | 登录历史 |

### OAuth 2.0
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/authorize` | GET | 授权端点 |
| `/api/token` | POST | Token 交换 |
| `/api/refresh` | POST | Token 刷新 |
| `/api/userinfo` | GET | 用户信息 (OIDC) |
| `/api/introspect` | POST | Token 验证 (RFC 7662) |
| `/api/revoke` | POST | Token 撤销 (RFC 7009) |
| `/api/verify` | POST | Session 验证 |

### 账户管理
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/account/change-password` | POST | 修改密码 |
| `/api/account/change-email` | POST | 修改邮箱 |
| `/api/account/avatar` | POST/DELETE | 头像管理 |
| `/api/account/banner` | POST/DELETE | 横幅管理 |
| `/api/account/` | DELETE | 删除账户 |
| `/api/account/privacy` | GET/PUT | 隐私设置 |
| `/api/account/fields` | GET/PUT | 自定义字段值 |

### 其他
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/password/reset-request` | POST | 请求密码重置 |
| `/api/password/reset` | POST | 执行密码重置 |
| `/api/email-verification/send` | POST | 发送验证邮件 |
| `/api/email-verification/verify` | POST | 验证邮箱 |
| `/api/sms/send` | POST | 发送短信验证码 |
| `/api/sms/verify` | POST | 验证短信并绑定手机 |
| `/api/challenge/random` | GET | 获取随机挑战问题 |
| `/api/challenge/verify` | POST | 验证挑战答案 |
| `/api/sessions` | GET | 活跃会话列表 |
| `/api/notifications` | GET | 通知列表 |
| `/api/health` | GET | 健康检查 |

### Admin Panel (`/api/admin`)
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/admin/create` | POST | 创建管理员 (ADMIN_SECRET) |
| `/api/admin/login` | POST | 管理员登录 |
| `/api/admin/users` | GET/PUT/DELETE | 用户管理 |
| `/api/admin/clients` | GET/POST/PUT/DELETE | OAuth 客户端管理 |
| `/api/admin/stats` | GET | 系统统计 |
| `/api/admin/email-config` | GET/PUT | SMTP 配置 |
| `/api/admin/login-logs` | GET | 登录日志 |
| `/api/admin/ip-bans` | GET/POST/PUT/DELETE | IP 封禁 (CIDR) |
| `/api/admin/challenges` | GET/POST/PUT/DELETE | 挑战问题管理 |
| `/api/admin/user-fields` | GET/POST/PUT/DELETE/PATCH | 自定义字段定义 |
| `/api/admin/audit-logs` | GET | 审计日志 |
| `/api/admin/users/:id/ban` | POST/DELETE | 封禁/解封用户 |
| `/api/admin/users/:id/mute` | POST | 禁言用户 |
| `/api/admin/users/:id/unlock` | POST | 解锁账户 |

## 生产部署

### 环境变量

```bash
NODE_ENV=production
ADMIN_SECRET=<强随机密钥，32+字符>
BASE_URL=https://your-domain.com
MYSQL_HOST=localhost
MYSQL_DATABASE=mindauth
REDIS_HOST=localhost
```

生成 ADMIN_SECRET：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 构建与启动

```bash
npm install --production=false   # 需要 devDependencies 来构建前端
npm run build                    # 构建 React 前端
NODE_ENV=production npm start    # 启动生产服务
```

### 安全检查清单

- 设置强 `ADMIN_SECRET`（32+ 字符）
- 启用 HTTPS
- 配置 SMTP 邮件服务
- 配置 IP 封禁策略
- 定期备份 MySQL 数据库
- 限制管理后台访问 IP（可选）
- 配置 `ALLOWED_ORIGINS` 为实际域名

### 上传目录持久化

`public/uploads/` 存储用户上传的头像和横幅。部署时必须保留此目录：
- 不要删除或覆盖 `public/uploads/`
- 如果使用 rsync/scp 部署，排除 `public/uploads/` 或使用增量同步
- 如果使用 Docker，将 `public/uploads/` 挂载为 volume

## 数据库

| 表 | 描述 |
|----|------|
| `users` | 用户账户 |
| `clients` | OAuth 应用 |
| `authorizations` | 用户-应用授权记录 |
| `refresh_tokens` | 长期 Token |
| `login_logs` | 登录历史 |
| `user_sessions` | 活跃会话（Token 哈希存储） |
| `email_config` | SMTP 配置 |
| `system_config` | 运行时配置 |
| `ip_bans` | IP 封禁列表 |
| `challenge_questions` | 挑战问题库 |
| `user_notifications` | 用户通知 |
| `user_fields` | 自定义字段定义 |
| `user_field_values` | 自定义字段值 |
| `admin_audit_logs` | 管理员审计日志 |
| `sms_audit_logs` | 短信审计日志 |

## 技术栈

- **Backend:** Express.js, MySQL 8, Redis 7
- **Frontend:** React 18, Vite, TypeScript
- **Security:** bcrypt, Helmet CSP, CSRF double-submit, rate limiting
- **SMS:** 阿里云 SMS (dysmsapi)
- **Email:** nodemailer (SMTP)

## 许可证

MIT
