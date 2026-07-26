# MindAuth 前端架构

MindAuth 前端是基于 React 18 + Vite + TypeScript 的双入口 SPA：用户端负责登录/注册/账户中心/OAuth 授权，管理端负责后台运维，构建产物由 Express 直接托管。

> **维护提示**：修改 frontend/src/**、vite.config.ts 时需同步更新本文档。

## 双入口设计

`vite.config.ts` 以 `frontend/` 为 `root`，通过 `rollupOptions.input` 声明两个 HTML 入口：

| 入口 | 挂载脚本 | 应用 | 路由器 |
|------|----------|------|--------|
| `frontend/index.html` | `frontend/src/main.tsx` | 用户 SPA（`UserApp`） | `BrowserRouter`（路径路由） |
| `frontend/admin.html` | `frontend/src/admin.tsx` | 管理 SPA（`AdminApp`） | `HashRouter`（hash 路由） |

关键构建配置：

- 输出目录 `dist/client/`（`emptyOutDir: true`，`sourcemap: true` 以便生产环境堆栈映射回 TSX）
- `manualChunks` 将 `react` / `react-dom` / `react-router-dom` 拆为独立长缓存 chunk
- 路径别名 `@` → `frontend/src`
- Dev server 端口 5173，`/api` 代理到 `http://localhost:4001`

**为何用户 SPA 用 BrowserRouter、管理 SPA 用 HashRouter**（推断，源码未直述）：`src/app.js` 为用户 SPA 提供了全路径 fallback（所有非 API 路由回退到 `index.html`），路径路由对用户可见 URL（`/login`、`/verify-email?token=...` 邮件链接）更友好，且 `legacyHashRoutes.ts` 已负责把旧 hash 链接迁移到路径路由；管理端则只需 Express 提供 `/admin` 与 `/admin/*` 两条路由，hash 路由让所有页面状态停留在客户端、无需服务端逐页配置，同时延续了旧版 vanilla admin SPA 的 hash 导航习惯。

## 目录结构

```
frontend/src/
├── main.tsx            # 用户 SPA 入口（ErrorBoundary → AuthProvider → ToastProvider → UserApp）
├── admin.tsx           # 管理 SPA 入口（ErrorBoundary → AdminApp）
├── user/               # 用户 SPA：UserApp.tsx 路由表 + pages/（9 个页面）+ components/（AuthShell、AccountShell）
├── admin/              # 管理 SPA：AdminApp.tsx 路由表 + AdminAuthProvider + pages/（7 个页面）+ components/AdminShell.tsx
├── shared/             # 双端共用的通用 UI 组件与 Hook
├── api/                # client.ts（fetch 封装）、types.ts（接口类型）、useResource.ts（数据获取 Hook）
├── auth/               # AuthProvider.tsx — 用户会话上下文
├── design/             # 设计系统 CSS（tokens / components / layout），两个入口均引入
└── routes/             # legacyHashRoutes.ts — 旧 hash 路由兼容重定向
```

## 用户 SPA

`UserApp.tsx` 路由表（`BrowserRouter`）：

| 路径 | 页面组件（`frontend/src/user/pages/`） |
|------|------|
| `/login` | `LoginPage.tsx` |
| `/register` | `RegisterPage.tsx` |
| `/reset-request` | `ResetRequestPage.tsx` |
| `/reset-password` | `ResetPasswordPage.tsx` |
| `/verify-email` | `VerifyEmailPage.tsx` |
| `/authorize` | `OAuthAuthorizePage.tsx`（OAuth 授权确认） |
| `/dashboard` | `DashboardPage.tsx` |
| `/account-settings` | `AccountSettingsPage.tsx` |
| `/` | `Navigate` → `/login` |
| `*` | `ErrorPage.tsx`（status=404） |

布局组件（`user/components/`）：

- **AuthShell** — 认证页外壳（整屏背景 + 居中卡片，仿阿里云）：品牌 header + 单列居中的表单卡片（`max-width: 27.5rem`），用于登录/注册/重置等公开页。背景默认为浅蓝方格网格（`--auth-bg`/`--auth-grid-line`，暗色主题有对应变体）；管理端可上传自定义背景图，AuthShell 经 `GET /api/public/auth-page-config` 获取（**模块级 Promise 缓存**，SPA 生命周期内仅请求一次，失败静默回退默认网格），有图时以 `cover` 铺满并叠加 `--auth-scrim` 可读性遮罩。旧版 hero 双栏布局（eyebrow/heroTitle/heroFeatures）已移除。
- **AccountShell** — 登录后外壳：顶部品牌栏 + 左侧账户侧边栏（头像、`navItems` 导航、`activeNavKey` 高亮）+ 内容区，用于 Dashboard 与账户设置。

**AccountSettingsPage 的分区**：个人资料 / 账号与安全 / 自定义字段 / 危险操作 四个 tab。原「隐私设置」tab 已移除（后端不存在 `/api/account/privacy` 端点，属死 UI）；自定义字段区使用用户端 `GET/PUT /api/account/fields`（按 `field_key` 键控），删除账户携带后端必填的 `password` 确认字段。

**旧 hash 路由兼容**：`main.tsx` 在渲染前调用 `routes/legacyHashRoutes.ts` 的 `normalizeLegacyHashRoutes()`，将 `/#/login`、`/#/reset-password?token=abc` 等 7 条旧 vanilla SPA hash 路由用 `history.replaceState` 重写为等价路径路由（保留 query），使迁移前的书签与邮件链接继续有效。旧 SPA 同时使用过 `#login` 与 `#/login` 两种写法，匹配时前导斜杠可选，两种形式均可归一化。

## 管理 SPA

`AdminApp.tsx`（`HashRouter` → `AdminAuthProvider` → `ToastProvider` → `AdminRouter`）。登录页 `AdminLoginPage` 直接静态引入；其余 6 个页面全部经 `React.lazy` 代码分割，按需加载并以 `Suspense fallback={<LoadingState />}` 兜底：

| Hash 路径 | 页面组件（lazy） |
|-----------|------------------|
| `#/` 与 `#/dashboard` | `AdminDashboardPage` |
| `#/users` | `AdminUsersPage` |
| `#/clients` | `AdminClientsPage` |
| `#/security` | `AdminSecurityPage` |
| `#/settings` | `AdminSettingsPage` |
| `#/logs` | `AdminLogsPage` |
| `*` | `Navigate` → `#/` |

`AdminRouter` 逻辑：`loading` 时显示 `LoadingState`；未登录（`admin === null`）渲染 `AdminLoginPage`；已登录则渲染 `AdminShell` 包裹的路由。

**AdminShell 的 RBAC 导航过滤**：`NAV_ITEMS` 中除仪表盘外每项声明 `permission`，经 `useAdminAuth().hasPermission()` 过滤（`permissions` 含 `*` 或对应权限名才显示）：

| 导航项 | 权限名 |
|--------|--------|
| 仪表盘 | 无（始终显示） |
| 用户管理 | `users.read` |
| OAuth 客户端 | `clients.read` |
| 安全设置 | `ip_bans.read` |
| 系统配置 | `config.read` |
| 日志查看 | `audit_logs.read` |

**AdminSettingsPage 的 tab**：邮件配置 / 短信配置 / 系统配置 / 登录页外观 四个 tab（各自声明所需权限，经 `hasPermission` 过滤）。「登录页外观」tab 提供认证页自定义背景图的预览、上传与恢复默认（调用 `POST/DELETE /api/admin/auth-background`，写操作需 `config.write`）；系统配置 tab 的通用键值列表**隐藏 `auth_background_url`**，避免绕过「登录页外观」的旧文件清理逻辑形成双入口。

## 与后端的契约

**`api/client.ts`** 是唯一的 fetch 封装：

- **ApiError** — 继承 `Error` 的归一化错误（`status` / `code` / `details`），非 2xx 响应统一抛出，message 优先取服务端 `message`/`error` 字段。
- **CSRF 自动附加** — POST/PUT/PATCH/DELETE 前经 `ensureCsrfToken()`：优先用内存缓存 → 读 `csrf_token` cookie → 兜底请求 `GET /api/csrf-token`，随后附加 `X-CSRF-Token` 头。`clearCsrfCache()` 供登出后清缓存。
- **401 统一处理** — `setUnauthorizedHandler(fn)` 注册全局回调，任何请求返回 401 都会触发，**回调携带请求路径**；`AuthProvider` 用它把 `user` 置空，但**忽略 `/api/admin/*` 的 401**（普通用户探测管理端点返回 401 不代表会话过期，避免误登出）。
- **`postForm`** — multipart 上传专用（头像/横幅/管理端登录页背景），不设 `Content-Type`（浏览器自动带 boundary），同样附加 CSRF 头。
- **`del`** — 支持可选请求体（如删除账户时携带 `password` 确认字段）。
- 所有请求 `credentials: 'same-origin'`，支持传入 `AbortSignal` 取消。

**会话 Cookie 机制**：登录后由服务端下发 httpOnly `session` cookie（管理端为 `admin_session`），前端不持有 token。`AuthProvider` 初始化时调用 `/api/me` 恢复会话（登录接口只设 cookie，用户信息需单独加载）；`AdminAuthProvider` 调用 `/api/admin/me`，并额外提供 `hasPermission()`。

**`api/useResource.ts`** — 声明式数据获取 Hook：deps 变化时重跑 fetcher，通过 `AbortController` 中止在途请求（防止慢响应覆盖新数据的竞态），吞掉 AbortError，暴露 `{ data, loading, error, reload }`，支持 `enabled` 开关。

## 共享组件与设计系统

`shared/` 组件清单：

| 文件 | 说明 |
|------|------|
| `Button.tsx` | 按钮（variant/size/fullWidth） |
| `Card.tsx` | 卡片容器 |
| `Dialog.tsx` | 对话框 |
| `ErrorBoundary.tsx` | React 错误边界（两个入口最外层） |
| `LoadingState.tsx` | 加载态占位（含 lazy Suspense fallback） |
| `ResponsiveTable.tsx` | 响应式表格 |
| `Skeleton.tsx` | 骨架屏 |
| `TextField.tsx` | 文本输入框 |
| `ToastProvider.tsx` | Toast 通知上下文 |
| `useDebouncedValue.ts` | 防抖值 Hook |

`design/` 三个 CSS 文件（两个入口均全量引入，不依赖 monorepo 的 `shared-styles/`）：

- `tokens.css` — 设计变量（`--color-primary: #ff6b35` 等品牌色、背景、间距、字体）。圆角令牌已整体收直为方正风格：`--radius-sm/md/lg/xl/2xl` 为 2/3/4/4/6px（`--radius-full` 保留用于头像/徽章类圆形元素）；另含认证页背景变量 `--auth-bg`/`--auth-grid-line`/`--auth-scrim`（默认网格与自定义背景遮罩，均有暗色变体）
- `components.css` — 全局 reset + 组件类样式
- `layout.css` — 布局工具类（`.container`、响应式断点等）

## 旧版 vanilla SPA（勿动）

`public/js/` 下保留着迁移前的 vanilla JS SPA（`main.js`、`admin.js`、`router.js`、`state.js`、`templates.js`、`handlers.js`、`auth.js`、`common.js`、`shared-loader.js`、`utils.js`、`dashboard.js`），**代码未删除但已不参与任何页面**：

- **LEGACY_FILES 白名单隔离**（`src/app.js`）：不再对 `public/` 整体 `express.static`，仅允许 GET 白名单内 4 个文件：`/error.html`、`/oauth-error.html`、`/robots.txt`、`/docs.html`。这防止 `public/index.html` / `public/admin.html` 遮蔽 React 构建产物，也使 `public/js/*` 无法经 HTTP 访问。
- **防回归测试**：`tests/specs/build/no-legacy-deps.spec.js`（Playwright）断言用户/管理页面加载期间不请求 `/js/*.js`、`/shared-styles/*`、`/templates/*` 等旧路径，生产 HTML 源码不含旧引用，同时验证白名单文件仍可访问、`/assets/*` 带 1 年 immutable 缓存头。
- **开发约定**：不得给旧 SPA 新增功能或引用；新功能一律进 `frontend/src/`。

## 构建与开发

| 命令 | 实际行为 |
|------|----------|
| `npm run dev` | `node --watch src/server.js` — 启动 **Express 后端**（4001）并自动重载；**不是** Vite。前端热更新需另行运行 `npx vite`（5173，`/api` 代理到 4001） |
| `npm run build` | 即 `build:client` → `vite build`，输出 `dist/client/`（`index.html`、`admin.html`、`assets/` 哈希文件 + sourcemap） |
| `npm run typecheck` | `tsc --noEmit`，仅检查前端 TS/TSX（后端为纯 JS） |
| `npm run verify` | `lint` + `typecheck` + `build` 三连 |

生产托管（`src/app.js`）：`/assets/*` 以 1 年 immutable 缓存服务；`dist/client` 根文件（favicon 等）1 小时缓存且 `index: false`；`/admin`、`/admin/*` 返回 `admin.html`；其余非 API 路由 fallback 到 `index.html`（非生产环境带 no-store 头）。
