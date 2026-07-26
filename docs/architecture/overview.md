# MindAuth 架构总览

MindAuth 是 Mindustry 社区的 OAuth 2.0 SSO 认证服务：Express 单进程后端 + React/Vite 双 SPA 前端 + MySQL + Redis，监听端口 4001。

> **维护提示**：修改 src/server.js、src/bootstrap.js、src/app.js（中间件顺序/路由挂载/LEGACY_FILES）时需同步更新本文档。

## 系统定位与边界

MindAuth 是社区的**统一身份提供方（OAuth 2.0 SSO Provider）**：

- 为 MindFourm 等社区应用提供 OAuth 2.0 Authorization Code Flow（支持 PKCE S256）第三方登录；
- 提供 OIDC Discovery 端点 `/.well-known/openid-configuration`（`src/app.js`），第三方客户端可自动发现 `/api/authorize`、`/api/token`、`/api/userinfo` 等端点。注意 MindAuth 不签发 RS256 ID Token，用户信息通过 access_token 调 `/api/userinfo` 获取；
- 自身还承载用户注册/登录、邮箱验证、密码重置、账号管理、管理后台等完整账号体系。

本文档只覆盖 MindAuth 单服务视角；MindFourm / MindFileList 等跨服务编排、部署脚本（PM2、tmux）在 monorepo 根仓库（`F:\Project\MindProject`）维护。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 后端 | Express 4 + Node.js ≥ 18 | 单进程；helmet 8（CSP/HSTS）、cors、compression、cookie-parser、multer（上传）、nodemailer（邮件） |
| 前端 | React 18 + Vite 5 + TypeScript 5.5 + react-router-dom 6 | 双入口 SPA（用户端 `index.html` / 管理端 `admin.html`），构建产物在 `dist/client/` |
| 数据库 | MySQL 8（mysql2 连接池）+ Redis 7（redis v5 客户端） | MySQL 存用户/客户端/令牌等持久数据；Redis 做会话缓存、OAuth 令牌、限流计数 |
| 密码/安全 | bcrypt（cost=12） | 令牌 SHA-256 哈希存储 |
| 测试 | `node --test`（unit/integration）+ Playwright（E2E） | 见 `package.json` scripts |

## 运行时拓扑

单个 Node.js 进程同时承担 API 服务和静态资源/SPA 托管，无独立前端服务器：

```
浏览器 / 第三方应用
  │
  ├── /admin, /admin/*   → 管理端 React SPA（dist/client/admin.html）
  ├── /*（兜底）          → 用户端 React SPA（dist/client/index.html）
  ├── /assets/*          → Vite 哈希资源（1 年 immutable 缓存）
  ├── /uploads/*         → 用户上传（头像/横幅，1 天缓存）
  ├── /api/*             → Express API 路由（auth / oauth / admin / account …）
  └── /.well-known/openid-configuration → OIDC Discovery
  ┌─────────────────────────────────────────────────┐
  │ Express 单进程（端口 4001）                       │
  │ src/server.js → src/bootstrap.js → src/app.js    │
  │ （进程入口）    （连库/迁移/监听）  （中间件/路由）   │
  └─────────────────────────────────────────────────┘
            │                        │
            ▼                        ▼
     ┌────────────┐          ┌────────────┐
     │   MySQL    │          │   Redis    │
     │ users /    │          │ 会话缓存 /  │
     │ clients /  │          │ OAuth 令牌 /│
     │ tokens …   │          │ 限流计数    │
     └────────────┘          └────────────┘
```

开发模式下 Vite dev server（端口 5173）代理 `/api` 到 Express；生产模式由 Express 直接托管 `dist/client/`。

## 启动序列

三个文件职责严格分离：

1. **`src/server.js`（进程入口，7 行）**：`dotenv.config()` 加载环境变量，调用 `bootstrap.start()`，启动失败打印后 `process.exit(1)`。
2. **`src/bootstrap.js` 的 `start()`**：**唯一**允许产生进程级副作用（连库、绑端口、注册信号处理器）的模块，顺序为：
   1. `validateConfig(config)` — 配置校验（生产环境严格模式）；
   2. `runMigrations(pool)` — 连接 MySQL 并自动执行 `src/db/migrations/` 迁移；
   3. `seedTestFixtures(pool)` — 仅在 `NODE_ENV` 为 development/test 或 `ENABLE_TEST_SEEDS=true` 时播种测试数据；
   4. `connectRedis()`；
   5. `createApp()` 创建 Express 应用；
   6. `app.listen(PORT)`（默认 4001）；
   7. `startCleanupScheduler()` — 定时清理 MySQL 过期数据；
   8. 注册 SIGINT/SIGTERM 优雅关停：先停清理调度器，`server.close()` 等待在途请求，5 秒超时后 `closeAllConnections()` 强制收尾，最后依次关闭 MySQL 连接池与 Redis。`start()` 返回 `http.Server` 供测试复用。
3. **`src/app.js` 的 `createApp(deps)`**：**纯同步**工厂——不连数据库、不监听端口、不跑迁移，所有 I/O 关注点都留在 bootstrap。接受可选的 `deps.pool` / `deps.client` 依赖注入以便测试替换（当前注入的实例用于 `/api/health` 健康检查；各路由模块仍直接 require `src/db` / `src/redis` 单例）。

## 中间件管线

`src/app.js` 中注册顺序即执行顺序，**不可随意调整**：

| 顺序 | 中间件/路由 | 说明 |
|------|-------------|------|
| 1 | `app.set('trust proxy', false)` | 见「关键设计决策」 |
| 2 | CORS | 白名单校验 `Origin`（`ALLOWED_ORIGINS`），允许携带 Cookie |
| 3 | helmet | CSP（含 CDN_URL 指令）、生产环境 HSTS |
| 4 | compression / express.json / cookieParser | 基础中间件 |
| 5 | LEGACY_FILES 白名单 | 旧静态页放行（见下） |
| 6 | `/uploads` 静态资源 | 用户上传，缓存 1 天、无 immutable（内容可变） |
| 7 | `/assets` 静态资源 | Vite 哈希产物，缓存 1 年 + immutable（文件名自带指纹） |
| 8 | `dist/client` 根文件 | favicon.svg 等，缓存 1 小时；`index: false` 防止 index.html/admin.html 被静态中间件抢先返回 |
| 9 | `ipBanMiddleware` | IP 封禁检查，拦在所有 API 之前 |
| 10 | `setCsrfCookie` → `GET /api/csrf-token` → `validateCsrf` | 签名双提交 Cookie；取 token 端点必须在校验之前挂载 |
| 11 | API 路由 | `/api`（auth、oauth）、`/api/admin`、`/api/password`、`/api/email-verification`、`/api/account`、`/api/sms`、`/api/challenge`、`/api/sessions`、`/api/notifications` |
| 12 | OIDC Discovery + `/api/health` | 内联在 app.js |
| 13 | `/api` 404 | 未匹配的 API 返回 JSON 404，防止落入 SPA fallback 返回 HTML |
| 14 | `/admin`、`/admin/*` | 管理端 SPA（admin.html） |
| 15 | `GET *` | 用户端 SPA 兜底（index.html） |
| 16 | 错误处理器 | 识别 multer 上传错误（大小/类型）返回 400，其余统一 500 |

顺序约束的理由：

- **静态资源刻意在 CSRF/封禁之前**：静态文件是幂等 GET，无需 CSRF 校验，也避免给每个资源请求增加 Redis 封禁查询开销；
- **`/api` 404 必须在 SPA fallback 之前**：否则拼错的 API 路径会拿到 HTML 而非 JSON 错误；
- **`/assets`、`/uploads` 必须在 `*` fallback 之前**：否则资源请求会被兜底成 index.html；
- **`index: false` + LEGACY_FILES 白名单**：防止 `public/` 下遗留的旧版 index.html/admin.html 覆盖 React 构建产物。

**缓存分档**：`/uploads` 1 天 → `dist/client` 根文件 1 小时 → `/assets` 1 年 immutable；非生产环境下两个 SPA 的 HTML 响应额外带 `no-store` 头，保证开发时始终拿到最新页面。

## 关键设计决策

1. **`app.set('trust proxy', false)` 是有意为之**。Express 默认的 `trust proxy` 机制会让任何客户端通过伪造 `X-Forwarded-For` 篡改 `req.ip`，从而绕过按 IP 的限流和封禁。MindAuth 关闭它，IP 提取统一走 `src/utils/request.js` 的 `getClientIp()`，只有 `TRUSTED_PROXY_ENABLED` + `TRUSTED_PROXY_IPS` 显式配置的可信代理（或 Cloudflare 模式）发来的转发头才被采信。
2. **深模块原则**。`src/modules/` 下每个模块（`sessionManager`、`oauthIssuer`、`tokenStore`、`clientRegistry` 等）是其领域的**唯一接缝**：路由只调模块导出的接口，模块内部直接操作 MySQL/Redis，其他代码不得绕过模块直连存储。这使得会话哈希、令牌存储格式等实现细节可以在模块内部演进。
3. **限流 keyPrefix 唯一约束**。`src/middleware/rateLimit.js` 的每个限流器必须使用唯一的 `keyPrefix`（如 `ratelimit:login`、`ratelimit:register`），避免不同端点共享/互相消耗配额，或通过某端点重置另一端点的计数。
4. **旧 vanilla SPA 用白名单隔离**。`public/js/` 时代的遗留静态页仅通过 `src/app.js` 中的 `LEGACY_FILES` 显式白名单（`/error.html`、`/oauth-error.html`、`/robots.txt`、`/docs.html`，仅 GET）对外可见，而不是整目录 `express.static(public/)`，防止遗留文件（尤其旧 index.html/admin.html）遮蔽 React 构建产物或意外暴露。

## 分文档导航

| 文档 | 内容 |
|------|------|
| [backend.md](backend.md) | 后端模块、路由与中间件细节 |
| [frontend.md](frontend.md) | React 双 SPA 结构与构建 |
| [database.md](database.md) | MySQL 表结构与 Redis 键设计 |
| [security.md](security.md) | 安全机制（CSRF、限流、令牌哈希等） |
| [../api/README.md](../api/README.md) | API 端点参考 |
