# MindAuth 新人上手指南

本文档面向第一次接触本仓库的开发者，目标是从 clone 到本地跑起来，并能改代码、跑测试。

> **维护提示**：修改 package.json scripts、scripts/*、.env 必填变量时需同步更新本文档。

## 项目是什么

MindAuth 是 Mindustry 社区的 OAuth 2.0 SSO 认证服务：单进程 Express 后端（端口 4001）同时承载 API 与 React/Vite 构建的两个 SPA（用户中心 + 管理后台），数据存储使用 MySQL 8 + Redis 7。它为 MindFourm 等第三方应用提供授权码模式（支持 PKCE S256）的统一登录。整体架构与模块划分详见 [architecture/overview.md](architecture/overview.md)。

## 环境准备

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 18（`package.json` engines；CI 用 20） | 后端与前端构建共用 |
| MySQL | 8.0+ | 表结构由启动时迁移自动创建，但**数据库本身需手动建**（`CREATE DATABASE mindauth`） |
| Redis | 7.0+ | 会话缓存、OAuth token、限流；本地可用 `USE_MEMORY_REDIS=1` 降级为进程内存（仅 dev/test，生产会被启动校验阻断） |

验证外部服务是否就绪的工具脚本（均读取 `.env`）：

```bash
node scripts/test-redis.js     # 多种方式测试 Redis 连接
node scripts/check-redis.js    # 查看 Redis 中的 ratelimit:* 键（调试限流用）
npm run test:verify-routing    # 不依赖 MySQL/Redis，验证 Express 路由/SPA 静态服务
```

> `scripts/migrate-to-mysql.js` 是一次性 SQLite→MySQL 迁移脚本，新人无需使用。

## 首次启动

1. **Clone 并安装依赖**（devDependencies 包含前端构建工具，勿用 `--production`）：

   ```bash
   git clone <repo-url> && cd MindProject/MindAuth
   npm install
   ```

2. **创建数据库**：

   ```sql
   CREATE DATABASE mindauth CHARACTER SET utf8mb4;
   ```

3. **建 `.env`**：复制 `cp .env.example .env` 后按需修改。最小可运行示例：

   ```bash
   PORT=4001
   NODE_ENV=development
   BASE_URL=http://localhost:4001
   ADMIN_SECRET=dev-only-secret-change-me-32chars-min

   MYSQL_HOST=localhost
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASSWORD=your_mysql_password
   MYSQL_DATABASE=mindauth

   REDIS_HOST=localhost
   REDIS_PORT=6379
   # 没装 Redis 时可临时启用（仅本地/CI）：
   # USE_MEMORY_REDIS=1
   ```

   SMTP / 阿里云短信等均为可选，本地开发可留空（SMTP 也可稍后在管理后台配置）。

4. **无需手动跑迁移**：启动时 `src/bootstrap.js` 会自动执行 `src/db/migrations/` 下的 SQL 迁移，并在 dev/test 环境自动 seed 测试账户与 OAuth 客户端。`public/uploads/{avatars,banners}/` 目录也会在配置校验阶段自动创建。

5. **构建前端**（Express 从 `dist/client/` 提供页面，首次必须构建）：

   ```bash
   npm run build
   ```

6. **启动开发服务**：

   ```bash
   npm run dev        # node --watch，改后端代码自动重启
   ```

7. **验证**：

   - 健康检查：http://localhost:4001/api/health （返回 MySQL + Redis 状态）
   - 用户中心：http://localhost:4001
   - 管理后台：http://localhost:4001/admin

## 开发环境测试账户

`src/db/seeds/testSeeds.js` 仅在 `NODE_ENV` 为 `development`/`test`（或显式 `ENABLE_TEST_SEEDS=true`）时执行，生产环境有硬性守卫直接跳过。

| 类型 | 凭据 | 说明 |
|------|------|------|
| 管理员账户 | 用户名 `testadmin` / 密码 `AdminPass123` | 角色 `super_admin`，E2E 与本地开发共用 |
| OAuth 客户端 | `client_id=forum` / `client_secret=forum_secret_key_for_development` | 供 MindFourm 本地联调，回调 `http://localhost:4000/api/auth/callback` |
| OAuth 客户端（测试） | `client_id=6d875cc521f1c60ba17dd53c7b9edc5a` | E2E 测试用 |

Seed 幂等，可重复启动；已存在的记录不会被覆盖。

## 目录导览

| 路径 | 内容 |
|------|------|
| `src/server.js` → `src/bootstrap.js` → `src/app.js` | 入口 → 启动编排（校验/迁移/seed/连接）→ Express 中间件与路由装配 |
| `src/routes/` | API 路由（auth、oauth、account、admin/* 等），只做参数解析，业务下沉到 modules |
| `src/modules/` | 深模块：sessionManager、oauthIssuer、tokenStore、clientRegistry 等，每个域的唯一入口 |
| `src/middleware/` | requireAuth、requireAdmin、csrf、rateLimit、ipBan、upload |
| `src/db/` | MySQL 连接池、`migrations/`（启动自动执行）、`seeds/` |
| `src/config/` | `index.js` 环境变量集中读取；`validate.js` 启动校验 |
| `src/utils/` | token、validation、email、crypto、cleanup 等工具 |
| `frontend/` | React 18 + Vite + TS，双入口 `index.html`（用户）/ `admin.html`（管理），源码在 `frontend/src/` |
| `public/` | 静态文件与 `uploads/`；`public/js/` 为旧版 SPA 遗留（见下文常见坑） |
| `tests/` | `unit/`、`integration/`、`specs/`（Playwright E2E）、`fixtures/`、`helpers/` |

更完整的架构说明见 [architecture/overview.md](architecture/overview.md)。

## 日常开发工作流

**后端**：`npm run dev`（`node --watch`）改完自动重启，直接访问 4001。

**前端**：改 `frontend/` 时可另开 Vite dev server 获得热更新：

```bash
npx vite       # 端口 5173，/api 自动代理到 http://localhost:4001
```

只验证生产形态时用 `npm run build` 重新构建后访问 4001。

**三层测试**：

| 命令 | 外部依赖 | 说明 |
|------|----------|------|
| `npm run test:unit`（= `npm test`） | 无 | `node --test tests/unit/*.test.js`，纯单测 + mock Redis |
| `npm run test:integration` | MySQL + `RUN_INTEGRATION=1` | 未设置该变量时整体 skip；连的是 `.env` 里的数据库 |
| `npm run test:e2e` | MySQL（Redis 默认降级） | Playwright，自动拉起服务；`playwright.config.js` 默认 `USE_MEMORY_REDIS=1`，串行单 worker 避免 DB 冲突 |

**提交前**：

```bash
npm run verify     # lint + typecheck + build 一条龙
```

**CI**（`.github/workflows/ci.yml`）：push/PR 到 `main` 时，基于 MySQL 8 + Redis 7 服务容器依次跑 lint → typecheck → build → unit → integration（`RUN_INTEGRATION=1`）→ e2e（`USE_MEMORY_REDIS=1`）。本地跑通 `npm run verify` + 三层测试即等价于 CI。

## 常见坑

- **Redis 未启动**：`npm run dev` 在 "MySQL database migrated" 之后卡在 Redis 连接（重试报 `ECONNREFUSED`）。先 `node scripts/test-redis.js` 排查，或临时在 `.env` 加 `USE_MEMORY_REDIS=1`（生产被 `validate.js` 阻断）。
- **数据库不存在**：迁移只建表不建库，`Unknown database 'mindauth'` 说明忘了第 2 步。
- **限流 keyPrefix 必须唯一**：新增 rate limiter 时必须给独立的 `keyPrefix`（见 `src/config/index.js` 的 rateLimit 配置），否则不同端点会互相消耗/重置对方的配额——这是硬性约定。
- **本地反代下 IP 全是代理 IP**：MindAuth 已改为无条件直读 CDN header（`ali-real-client-ip` → `x-real-ip` → `cf-connecting-ip` → `x-forwarded-for[0]` → socket）。本地调试时若仍看到代理 IP，是 nginx 没覆写 header（确保 `proxy_set_header X-Real-IP $remote_addr;` 用覆盖语义），或客户端能绕过反代直连 4001（防火墙需限制为只允许反代 IP）。
- **`public/js/` 是旧版 SPA 遗留**：当前前端在 `frontend/`（Vite 构建到 `dist/client/`）。不要给 `public/js/` 下的旧文件加功能或修 bug。
- **生产环境启动强校验**：`NODE_ENV=production` 时 `src/config/validate.js` 会直接拒绝启动：`ADMIN_SECRET` 少于 32 字符、`BASE_URL` 指向 localhost、`ALLOWED_ORIGINS=*`、`USE_MEMORY_REDIS=1` 均为致命错误。开发环境同类问题只 warn，容易在部署时才暴露。
- **改完前端页面没变化**：Express 服务的是 `dist/client/` 的构建产物，直连 4001 时需重新 `npm run build`；或改用 5173 的 Vite dev server。
