# MindAuth

OAuth 2.0 SSO 认证服务，为 Mindustry 社区应用提供统一登录。

## 功能

- 用户注册/登录（邮箱 + 密码）、注册强制邮箱验证码、邮箱验证、密码重置
- 手机短信验证（阿里云 SMS）、挑战问题验证
- OAuth 2.0 授权码模式（支持 PKCE S256）+ OIDC Discovery（`/.well-known/openid-configuration`）
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
npm run test:integration  # 集成测试（需 MySQL + RUN_INTEGRATION=1，否则跳过）
npm run test:e2e          # Playwright E2E（可 USE_MEMORY_REDIS=1 免真实 Redis）
npm run verify            # lint + typecheck + build
```

## OAuth 接入（3 步）

1. 管理后台创建 OAuth 应用，获取 `client_id` / `client_secret`
2. 重定向用户到 `/api/authorize?client_id=...&redirect_uri=...&state=...`
3. 后端 `POST /api/token`（`grant_type=authorization_code` + `code` + 客户端凭据）换取 `access_token`

完整接入教程（含示例代码与 FAQ）见 [docs/third-party-integration.md](docs/third-party-integration.md)。

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
