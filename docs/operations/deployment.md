# MindAuth 部署指南

本文档覆盖将 MindAuth 作为单个服务部署到生产环境所需的一切：依赖、环境变量、构建启动、数据库迁移、反向代理、静态资源、健康检查与升级回滚。

> **维护提示**：修改 `src/bootstrap.js`、`src/config/validate.js`、构建脚本时需同步更新本文档。

## 与 monorepo 部署文档的分工

- **本文档** = 把 MindAuth 单服务部署起来所需的一切。
- **monorepo 根目录的 `DEPLOYMENT.md`**（位于 MindProject monorepo 根仓库，非本子仓库）= 多服务编排：端口全局分配、nginx 总配置、PM2 全家桶（`ecosystem.config.js`）、MindFourm / MindFileList 联动、OAuth 客户端注册。

以 monorepo 整体部署时先读根仓库 `DEPLOYMENT.md`，本文档作为 MindAuth 的深入补充（尤其[反向代理要求](#反向代理要求重点)一节，根文档未覆盖）；单独 clone 本仓库部署时仅本文档即可。

## 前置依赖

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 18.0.0 | `package.json` 的 `engines` 字段强制要求 |
| MySQL | 8.0+ | 用户、会话、OAuth 客户端等持久化存储 |
| Redis | 7.0+ | 会话缓存、OAuth token、限流计数器 |

数据库需预先创建（`CREATE DATABASE mindauth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` 及独立账号），建库语句见 monorepo 根目录 `DEPLOYMENT.md` 第 2 节；表结构无需手工建立，启动时自动迁移（见下文）。

## 生产环境变量

完整变量表见 [configuration.md](configuration.md)。生产部署最小集：

```bash
NODE_ENV=production
PORT=4001
BASE_URL=https://auth.example.com        # 不能是 localhost
ADMIN_SECRET=<64位随机十六进制>           # 至少 32 字符
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=mindauth
MYSQL_PASSWORD=<db-password>
MYSQL_DATABASE=mindauth
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<redis-password>
ALLOWED_ORIGINS=https://forum.example.com  # CORS 白名单，逗号分隔
```

`ALLOWED_ORIGINS` 只需列出**跨域调用方**（如 MindFourm 前端域名）：同源请求（Origin host 与请求 Host 一致）由 CORS 中间件自动放行，无需把 MindAuth 自身域名写进白名单；白名单外的来源会收到不带 CORS 头的正常响应（浏览器侧拦截跨域读取），不会导致服务端 500。

生成 `ADMIN_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`src/config/validate.js` 在启动时校验配置，**以下情况会直接阻断启动**（`NODE_ENV=production` 时）：

- `BASE_URL` 未设置，或包含 `localhost` / `127.0.0.1`
- `ADMIN_SECRET` 未设置，或长度小于 32 字符
- `ALLOWED_ORIGINS` 含通配符 `*`
- `USE_MEMORY_REDIS=1`（内存 Redis 禁止用于生产）
- `MYSQL_HOST` / `MYSQL_DATABASE` / `REDIS_HOST` 缺失（任何环境都阻断）
- `public/uploads/` 目录不可写（生产阻断，开发仅警告）

## 构建与启动

```bash
npm ci                 # 需要 devDependencies（vite 等）用于构建前端，勿加 --omit=dev
npm run build          # vite build → 前端产物输出到 dist/client/
npm start              # node src/server.js，监听 PORT（默认 4001）
```

生产环境由 Express 直接托管 `dist/client/` 下的前端产物，**启动前必须先执行 `npm run build`**，否则 SPA 页面 404。

### PM2 方式（monorepo 编排）

根仓库 `ecosystem.config.js` 中 `mindauth` 条目的要点：

- `script: 'src/server.js'`，`cwd: './MindAuth'`，单实例 fork 模式，`max_memory_restart: '512M'`，环境变量从 `MindAuth/.env` 读取，日志写入 `../logs/mindauth-*.log`
- **`NODE_ENV: 'production'` 在 `env` 块中硬编码**，而非依赖 `.env`。这是刻意为之：`NODE_ENV` 控制 cookie Secure 标志、HSTS、测试数据 seed 及非生产的 `/admin/test/*` 路由，`.env` 漏配会让进程以开发模式运行并暴露测试端点。改用 systemd 等方式部署时，同样要在服务定义中显式设置 `NODE_ENV=production`。

## 数据库迁移

启动序列（`src/bootstrap.js`）为：校验配置 → 连接 MySQL 并执行迁移 → 连接 Redis → 启动 HTTP 服务。因此：

- **迁移自动执行**：`src/db/migrator.js` 按数字序读取 `src/db/migrations/*.sql`，用 `schema_version` 表跟踪已应用版本，只跑未应用的迁移，重复启动幂等（无新迁移时打印 `Schema is up to date`）。
- **失败时的表现**：任一 SQL 失败会打印 `Migration FAILED: <名称>` 及出错语句片段，进程抛错退出，**不会**带着半新半旧的 schema 对外服务；该版本不被记录，下次启动自动重试。注意 MySQL DDL 隐式提交，失败的迁移可能已部分生效，重试前需人工检查。
- **`scripts/migrate-to-mysql.js`**：历史遗留的一次性脚本，早期从 SQLite（`users.db`）迁移到 MySQL 用。仓库根目录无 `users.db` 时直接跳过；全新部署与常规升级**不需要**运行它（其依赖的 `better-sqlite3` 已不在 dependencies 中）。

## 反向代理要求（重点）

`src/app.js` 显式设置 `app.set('trust proxy', false)`，客户端 IP 提取完全由 `src/utils/request.js` 的 `getClientIp()` 接管：**默认不信任任何代理头**（`X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` 一律忽略），直接取 TCP 连接的对端地址。

这意味着：**如果 MindAuth 前面有 nginx / CDN 而你未配置可信代理，所有请求的"客户端 IP"都会是代理自身的 IP**。后果是 IP 封禁与限流（登录 5 次/5 分钟等）作用在代理 IP 上，一个用户触发限流会误伤全站用户；封禁一个"IP"等于封掉所有人。

### 配置方法

```bash
# 必须先打开总开关（TRUST_CLOUDFLARE 单独设置无效——
# isTrustedProxy() 在 enabled=false 时直接返回 false）
TRUSTED_PROXY_ENABLED=true

# 方式一：显式列出可信代理 IP（nginx 所在机器的地址，逗号分隔）
TRUSTED_PROXY_IPS=127.0.0.1

# 方式二（可叠加）：信任 Cloudflare 内置 IPv4 网段
TRUST_CLOUDFLARE=true
```

仅当请求的 TCP 对端 IP 在可信列表（或 Cloudflare 网段）内，才会按 `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For`（取第一个 IP）的优先级解析真实客户端 IP；头部值须为合法 IPv4 或 IPv6（自动剥离端口与 IPv6 方括号，`::ffff:` 映射地址还原为 IPv4），否则回退到连接地址。

### nginx 最小配置片段

```nginx
server {
    listen 443 ssl http2;
    server_name auth.example.com;

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

完整 nginx 配置（多域名、SSL、certbot）见 monorepo 根目录的 `DEPLOYMENT.md` 第 7 节。注意根文档的 `.env` 示例**未包含** `TRUSTED_PROXY_*` 变量，按其 nginx 拓扑部署时必须补上。

### 验证方法

配置后从外网访问并登录一次，然后检查 `login_logs` 表：

```sql
SELECT ip, created_at FROM login_logs ORDER BY id DESC LIMIT 5;
```

若 `ip` 显示的是你的公网 IP → 配置正确；若显示 `127.0.0.1` 或代理机 IP → 可信代理未生效。

## 静态资源与上传目录

- **`public/uploads/`（头像、横幅）必须持久化**，部署更新时不得清空：rsync/scp 部署需排除该目录，Docker 需挂载为 volume，`git clean -fdx` 会删掉它，慎用。启动时 `validate.js` 自动创建 `avatars/`、`banners/` 子目录并做写入测试，生产环境不可写会阻断启动。
- **`/assets/*`（Vite 构建产物）带一年 `immutable` 缓存**。文件名含内容 hash（如 `index-a1b2c3.js`），每次 `npm run build` 产出新文件名，天然 cache-busting——发布无需清 CDN / 浏览器缓存。HTML 入口不长缓存，用户刷新即拿到新版本引用。`/uploads/*` 为 1 天缓存，`dist/client/` 根文件（favicon 等）为 1 小时。

## 健康检查与监控

`GET /api/health`（无需认证）：

- **生产环境仅返回 `{"status":"ok"}`**（探测 MySQL `SELECT 1` + Redis `PING`；任一失败返回 HTTP 503 与 `{"status":"degraded"}`），不暴露版本号、uptime 等信息。
- 开发环境返回详细信息（services、uptime、version）。

建议的探活配置：

```bash
# 简单 cron / 负载均衡探活：非 200 即异常
curl -fsS -o /dev/null https://auth.example.com/api/health
```

探活间隔建议 ≥ 10s（每次探测都会打 MySQL 和 Redis）。日志经 PM2 落盘于 `logs/mindauth-*.log`，可配合 `pm2 logs mindauth` 查看。

进程支持优雅关停（`SIGINT` / `SIGTERM`）：停止接收新连接，最多等待 5 秒排空存量连接后关闭 MySQL 连接池与 Redis。`pm2 reload` / `systemctl stop` 均安全。

## 升级与回滚

### 升级

```bash
git pull                # 或 git checkout <tag>
npm ci
npm run build
pm2 reload mindauth     # 或 systemctl restart；启动时自动应用新迁移
```

升级前建议备份数据库（迁移是自动且单向的）：

```bash
mysqldump -u mindauth -p mindauth | gzip > mindauth_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 回滚注意事项

- **迁移不可自动回滚**：`migrator.js` 只有 up 没有 down，且 MySQL DDL 隐式提交。回退到旧版本代码时，若新版本已应用过 schema 迁移，旧代码可能与新 schema 不兼容。
- 因此回滚流程是：**恢复升级前的数据库备份 + 回退代码**，两者配套，缺一不可：

```bash
pm2 stop mindauth
git checkout <previous-tag-or-commit>
npm ci && npm run build
gunzip < mindauth_YYYYMMDD_HHMMSS.sql.gz | mysql -u mindauth -p mindauth
pm2 start mindauth
```

- 恢复备份会丢失升级后产生的数据（新注册、会话等），需评估。若新迁移只是加列/加表（向后兼容），可仅回退代码不回滚数据库。
