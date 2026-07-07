# MindAuth

用户认证系统，提供 OAuth 2.0 SSO 认证服务。

## 功能

- 用户注册/登录（邮箱 + 密码）
- 邮箱验证
- 密码重置
- 手机短信验证（阿里云 SMS）
- 挑战问题验证
- OAuth 2.0 授权码模式
- 管理后台（用户管理、OAuth 客户端、审计日志）
- IP 封禁管理（支持 CIDR）
- 用户通知（站内 + 邮件）
- 自定义用户字段
- 登录日志记录
- 会话管理（多设备登录）

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
- `BASE_URL` - 系统 URL
- `MYSQL_*` - MySQL 数据库配置
- `REDIS_*` - Redis 配置
- `SMTP_*` - 邮件配置

### 启动

```bash
npm start           # 生产模式
npm run dev         # 开发模式（自动重启）
```

### 访问

- 用户中心: http://localhost:4001
- 管理后台: http://localhost:4001/admin.html
- OAuth 文档: http://localhost:4001/docs.html

### 开发环境测试账户

开发环境自动 seed 以下账户：

| 用户名 | 密码 | 角色 |
|--------|------|------|
| `testadmin` | `AdminPass123` | `super_admin` |

## OAuth 接入

详见 `/docs.html` 或 [OAuth 接入文档](public/docs.html)

### 快速接入步骤

1. 管理后台创建 OAuth 应用，获取 `client_id` 和 `client_secret`
2. 用户授权：重定向到 `/authorize?client_id=xxx&redirect_uri=xxx&state=xxx`
3. 获取 Token：POST `/token` with `code`, `client_id`, `client_secret`
4. 刷新 Token：POST `/refresh` with `refresh_token`, `client_id`, `client_secret`

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

### OAuth 2.0
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/authorize` | GET | 授权端点 |
| `/api/token` | POST | Token 交换 |
| `/api/refresh` | POST | Token 刷新 |
| `/api/userinfo` | GET | 用户信息 |
| `/api/verify` | POST | Session 验证 |
| `/api/revoke` | POST | Token 撤销 |

### 账户管理
| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/account/change-password` | POST | 修改密码 |
| `/api/account/change-email` | POST | 修改邮箱 |
| `/api/account/avatar` | POST/DELETE | 头像管理 |
| `/api/account/banner` | POST/DELETE | 横幅管理 |

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

### 安全检查清单

- 设置强 `ADMIN_SECRET`
- 启用 HTTPS
- 配置 SMTP 邮件服务
- 配置 IP 封禁策略
- 定期备份 MySQL 数据库
- 限制管理后台访问 IP（可选）

## 数据库

| 表 | 描述 |
|----|------|
| `users` | 用户账户 |
| `clients` | OAuth 应用 |
| `authorizations` | 用户-应用授权记录 |
| `refresh_tokens` | 长期 Token |
| `login_logs` | 登录历史 |
| `user_sessions` | 活跃会话 |
| `ip_bans` | IP 封禁列表 |
| `challenge_questions` | 挑战问题库 |
| `user_notifications` | 用户通知 |
| `user_fields` | 自定义字段定义 |
| `admin_audit_logs` | 管理员审计日志 |

## 技术栈

- Express.js
- MySQL 8
- Redis 7
- bcrypt 密码哈希
- Helmet 安全头
- 阿里云 SMS（短信验证）

## 许可证

MIT
