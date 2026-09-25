# MindAuth 开发文档

MindAuth 是 Mindustry 社区的 OAuth 2.0 SSO 认证服务（Express + React/Vite + MySQL/Redis）。本目录是面向开发者的中文文档体系；面向 AI 编码助手的紧凑上下文见仓库根的 [CLAUDE.md](../CLAUDE.md)。

## 文档地图

| 你是谁 | 从这里开始 |
|--------|-----------|
| 第一次接触本仓库 | [getting-started.md](getting-started.md) — 环境准备、首次启动、日常开发工作流 |
| 后端开发者 | [architecture/overview.md](architecture/overview.md) → [architecture/backend.md](architecture/backend.md) → [architecture/database.md](architecture/database.md) |
| 前端开发者 | [architecture/frontend.md](architecture/frontend.md) |
| 调用 API / 排查接口问题 | [api/README.md](api/README.md)（通用约定 + 全端点索引），再进入对应域文档 |
| 第三方应用接入方 | [third-party-integration.md](third-party-integration.md)（对外接入文档：OIDC Discovery、注册应用、接入示例） |
| 维护旧版设备授权实现 | [DEVICE_AUTH.md](DEVICE_AUTH.md)（内部参考，当前不属于第三方公开 API 契约） |
| 运维 / 部署 | [operations/deployment.md](operations/deployment.md) → [operations/configuration.md](operations/configuration.md) → [operations/runbook.md](operations/runbook.md) |
| 安全审计 | [architecture/security.md](architecture/security.md) |
| AI 编码助手 | [../CLAUDE.md](../CLAUDE.md)（英文权威索引），按其 Documentation Map 深入本目录 |

## 目录说明

```
docs/
├── getting-started.md          新人上手指南
├── architecture/               架构设计（总览 / 后端模块 / 前端 / 数据模型 / 安全）
├── api/                        API 参考（通用约定 + 按业务域分组的端点文档）
├── operations/                 部署、配置参考、运维手册
├── third-party-integration.md  对外：第三方系统接入文档
├── DEVICE_AUTH.md              RFC 8628 设备授权旧版内部实现参考（未纳入公开契约）
├── release/                    发布说明归档
└── superpowers/                历史实施计划归档（superpowers 工作流约定路径，勿动）
```

## 文档维护约定

每份文档头部有一行「维护提示」，注明改动哪些代码需要同步该文档。总表如下：

| 改动的代码路径 | 必须同步的文档 |
|----------------|----------------|
| `src/routes/auth.js` `challenge.js` `password.js` `email-verification.js` | [api/auth.md](api/auth.md) + [api/README.md](api/README.md) 索引 + CLAUDE.md |
| `src/routes/oauth.js` | [api/oauth.md](api/oauth.md) + [third-party-integration.md](third-party-integration.md) + CLAUDE.md |
| `src/routes/account.js` `sessions.js` `sms.js` `notifications.js` | [api/account.md](api/account.md) + api/README.md 索引 + CLAUDE.md |
| `src/routes/admin/**` | [api/admin.md](api/admin.md) + CLAUDE.md |
| `src/db/migrations/**`、`src/db/*` | [architecture/database.md](architecture/database.md) + CLAUDE.md |
| `src/modules/**` | [architecture/backend.md](architecture/backend.md) + CLAUDE.md |
| `src/middleware/*` | [architecture/backend.md](architecture/backend.md) + [architecture/security.md](architecture/security.md) + CLAUDE.md |
| `src/config/index.js`、`.env` 变量增删 | [operations/configuration.md](operations/configuration.md) + [operations/deployment.md](operations/deployment.md) |
| `frontend/src/**`、`vite.config.ts` | [architecture/frontend.md](architecture/frontend.md) |
| `scripts/*` | [getting-started.md](getting-started.md) + [operations/runbook.md](operations/runbook.md) |
| `src/app.js`（中间件顺序 / 路由挂载 / LEGACY_FILES） | [architecture/overview.md](architecture/overview.md) + api/README.md |

根仓库 `scripts/doc-sync/` 工具会根据代码改动提示待更新的文档（`npm run docs:check` / `docs:status`，在 monorepo 根目录执行）。
