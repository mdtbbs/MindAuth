# MindAuth

用户认证系统，提供 OAuth 2.0 认证服务。

## 功能

- 用户注册/登录
- 邮箱验证
- 密码重置
- OAuth 2.0 授权码模式
- 管理后台
- 登录日志记录

## 快速开始

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
- `ADMIN_SECRET` - 管理员创建密钥（必须修改）
- `BASE_URL` - 系统URL
- `SMTP_*` - 邮件配置

### 启动

```bash
npm start
```

开发模式（自动重启）：
```bash
npm run dev
```

### 访问

- 用户中心: http://localhost:4001
- 管理后台: http://localhost:4001/admin.html
- OAuth文档: http://localhost:4001/docs.html

## OAuth 接入

详见 `/docs.html` 或 [OAuth接入文档](public/docs.html)

### 快速接入步骤

1. 管理后台创建OAuth应用，获取 `client_id` 和 `client_secret`
2. 用户授权：重定向到 `/authorize?client_id=xxx&redirect_uri=xxx&state=xxx`
3. 获取Token：POST `/token` with `code`, `client_id`, `client_secret`
4. 刷新Token：POST `/refresh` with `refresh_token`, `client_id`, `client_secret`

## 生产部署

### 环境变量

```bash
NODE_ENV=production
ADMIN_SECRET=<强随机密钥，32+字符>
BASE_URL=https://your-domain.com
```

### 安全检查清单

- 设置强 `ADMIN_SECRET`
- 启用 HTTPS
- 配置 SMTP 件服务
- 定期备份 `users.db`
- 限制管理后台访问IP（可选）

### 数据库

SQLite 数据库文件：`users.db`

备份：
```bash
cp users.db users.db.backup
```

## 技术栈

- Express.js
- SQLite (better-sqlite3)
- bcrypt 密码哈希
- Helmet 安全头

## 许可证

MIT