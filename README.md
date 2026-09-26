# MindAuth

OAuth 2.0 SSO 认证服务，为 Mindustry 社区应用提供统一登录。

## 功能

- 用户注册/登录（邮箱 + 密码）、注册强制邮箱验证码、邮箱验证、密码重置
- 手机短信验证（阿里云 SMS）、挑战问题验证
- OAuth 2.0 授权码模式（支持 PKCE S256）+ OIDC Discovery（`/.well-known/openid-configuration`）
- MDTBBS 官方 Mindustry Mod 原生登录（标准 Bearer access token、设备会话与 refresh rotation）
- 管理后台（用户管理、OAuth 客户端、IP 封禁 CIDR、审计日志、运行时配置）
- 会话管理（多设备登录、Token 哈希存储）、用户通知、自定义用户字段

## 架构一览

单进程 Express 服务（端口 4001），同时承载 React 双 SPA 前端与 API：

```
Browser
  ├── /admin, /admin/*  →  管理后台 SPA (dist/client/admin.html)
  ├── /*                →  用户中心 SPA (dist/client/index.html)
  ├── /api/*            →  Express API（MySQL 8 + Redis 7）
  └── /api/health       →  健康检查
```

详细架构见 [docs/architecture/overview.md](docs/architecture/overview.md)。

## 快速开始

环境要求：Node.js 18+、MySQL 8.0+、Redis 7.0+。

```bash
npm install
cp .env.example .env      # 修改 ADMIN_SECRET（32+ 字符）、MYSQL_*、REDIS_*
mysql -u root -p -e "CREATE DATABASE mindauth"   # 迁移只建表不建库，需先手动建库
npm run build             # 构建 React 前端 → dist/client/
npm run dev               # 开发模式（node --watch，启动时自动执行数据库迁移）
```

访问：用户中心 http://localhost:4001 · 管理后台 http://localhost:4001/admin · 健康检查 http://localhost:4001/api/health

开发环境自动 seed 测试账户 `testadmin` / `AdminPass123`（super_admin）及联调用 OAuth 客户端，详见[新人上手指南](docs/getting-started.md)。

### 测试与检查

```bash
npm run test:unit         # 单元测试（无外部依赖）
npm run test:db:prepare   # 仅准备 test_* / *_test 库，运行真实 migration 与 seed
RUN_INTEGRATION=1 npm run test:integration  # 本机 MySQL-compatible + Redis/Valkey
npm run test:e2e          # 本机 MySQL-compatible + Redis/Valkey Playwright E2E
npm run verify            # lint + typecheck + build
```

## OAuth 接入（3 步）

1. 用户在开发者中心申请 Public Client，管理员批准 Redirect URI 与 scopes，得到 `client_id`（Public Client 没有 secret）
2. 使用系统浏览器访问 `/api/authorize`，每次登录都使用 `state` 和 PKCE S256
3. 回调后将 `code`、`redirect_uri`、`code_verifier` 和 `client_id` POST 到 `/api/token`

Public Client 桌面/移动接入见 [Public Client PKCE 指南](docs/public-client-pkce.md)；服务端 Confidential Client 接入见 [第三方 OAuth 接入指南](docs/third-party-integration.md)。

## 文档

| 文档 | 内容 |
|------|------|
| [docs/README.md](docs/README.md) | 文档导航索引（按角色入门） |
| [docs/getting-started.md](docs/getting-started.md) | 新人上手：环境、首次启动、开发工作流、常见坑 |
| [docs/architecture/](docs/architecture/overview.md) | 架构：总览 / 后端模块 / 前端 / 数据模型 / 安全设计 |
| [docs/api/README.md](docs/api/README.md) | API 参考：通用约定 + 全部约 90 个端点索引 |
| [docs/operations/](docs/operations/deployment.md) | 运维：部署指南 / 配置参考 / 运维手册 |
| [docs/third-party-integration.md](docs/third-party-integration.md) | 对外：第三方系统接入教程 |
| [CLAUDE.md](CLAUDE.md) | AI 编码助手上下文（英文） |

生产部署（反向代理与可信代理配置是最易错点）见 [docs/operations/deployment.md](docs/operations/deployment.md)；环境变量全表见 [docs/operations/configuration.md](docs/operations/configuration.md)。

## 技术栈

- **Backend:** Express.js, MySQL 8, Redis 7
- **Frontend:** React 18, Vite, TypeScript
- **Security:** bcrypt, Helmet CSP, CSRF double-submit, rate limiting
- **SMS / Email:** 阿里云 SMS (dysmsapi) / nodemailer (SMTP)

## 许可证

MIT
