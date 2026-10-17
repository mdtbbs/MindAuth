# 开发者应用与公开目录 API

本文说明 MindAuth Public Client 自助应用管理及公开应用目录接口。普通开发者只能创建第三方 Public Client；Confidential Client 与 first-party client 仍由管理员在管理后台维护。

> **维护提示**：修改 `src/routes/developerClients.js`、`src/routes/publicApps.js` 或 `src/modules/admin/clientRegistry.js` 时同步更新本文档及 [README.md](README.md)。网页流程见 [Public Client PKCE 指南](../public-client-pkce.md)。

## 使用条件与安全边界

- 开发者 API 使用 MindAuth `session` Cookie。所有生态都要求邮箱已验证；`mdtbbs` 生态还要求手机号已验证，`mindustry-club` 与 `global` 不要求手机号。
- 创建接口按 IP 限制为每小时 10 次；应用数量没有固定上限。
- 新应用类型固定为 `public` / `third_party`，`client_secret` 为 `NULL`，并强制 PKCE S256；创建后进入 `pending`，由管理员审核后启用。
- 每个应用有明确的 `ecosystem`：`mdtbbs`、`mindustry-club` 或 `global`。省略时兼容默认 `mdtbbs`。迁移 `018_international_locales_and_ecosystems.sql` 将既有客户端设为 `mdtbbs`，保持旧资格策略。
- 应用使用 Authorization Code Flow；Public Client 不支持客户端密钥、implicit flow 或 password grant。
- 新第三方应用允许 HTTPS、内网或 localhost HTTP、loopback 随机端口和安全自定义 scheme 回调；公网 HTTP 仍不允许。回调地址拒绝用户凭证、fragment 和危险协议，并在授权时与登记值精确匹配。
- 接入选项只有 `forum_access: false/true`：false 为 `openid profile`（仅登录/基本资料）；true 为 `openid profile forum`（论坛、资源、私信、云存档、联机）。省略时默认 false。管理员批准整个应用，不接受逐项批准 scope/capability。
- 兼容旧的 `requested_scopes` 数组；提交任意论坛细分 scope 会按完整论坛范围重新申请。显式 `forum_access` 优先；非布尔值返回 400。旧记录在修改/重新批准前保留原细分范围，不会在刷新时自动扩权。
- 修改应用仍重新审核并撤销已有授权及令牌；审核读取和范围更新使用同一行锁事务。用户下次登录确认完整范围。
- Presence/Multiplayer 随论坛选项启用，无需重复申报和批准。应用名称、图标与开发者身份由目录提供。
- Launcher 可提交 `application_icon_url` 和安全 `launch_uri_template`；模板恰好含一个 `{intent_id}`，作为应用资料一并审核。只有已批准的论坛应用才公开模板。
- 删除是软删除，保留 `client_id` 以避免复用；同时删除授权记录并撤销 refresh/access token。

## 列出本人应用

```http
GET /api/developer/clients
Cookie: session=...
```

成功响应包含每个应用的基本资料、Redirect URI、scope、状态和使用情况：

```json
{
  "success": true,
  "applications": [{
    "id": 12,
    "name": "MDT Launcher",
    "description": "社区启动器",
    "website_url": "https://example.org",
    "application_icon_url": "https://example.org/icon.png",
    "client_id": "...",
    "client_type": "public",
    "party_type": "third_party",
    "ecosystem": "mdtbbs",
    "status": "pending",
    "require_pkce": true,
    "forum_access": true,
    "approved_scopes": [],
    "redirect_uris": [{"redirect_uri": "http://127.0.0.1:0/callback", "redirect_type": "loopback"}],
    "usage": {
      "authorization_count": 3,
      "last_used_at": "2026-09-26T00:00:00.000Z",
      "requests_30d": 42,
      "recent_errors": []
    }
  }]
}
```

计数来源是既有授权和每日 OAuth 客户端指标，不表示每个论坛 API 请求数。

## 创建 Public Client

```http
POST /api/developer/clients
Cookie: session=...
Content-Type: application/json
```

请求体：

```json
{
  "name": "MDT Launcher",
  "description": "用于登录 MDTBBS 并浏览社区内容的启动器。",
  "website_url": "https://example.org",
  "application_icon_url": "https://example.org/icon.png",
  "launch_uri_template": "xenon://join/{intent_id}",
  "ecosystem": "mdtbbs",
  "redirect_uris": ["http://127.0.0.1:0/oauth/callback", "mdtlauncher://oauth/callback"],
  "forum_access": true,
  "supports_join_intent": true
}
```

`website_url` 可省略或为 `null`；如果填写，只接受 HTTPS 或 localhost/loopback HTTP。`application_icon_url` 仅接受公开 HTTPS。`launch_uri_template` 必须只有一个 `{intent_id}` 占位符。论坛应用填写启动 URI 模板后，可作为 Join Intent 的启动目标；Presence/Multiplayer 随论坛选项启用。名称、简介和至少一个 Redirect URI 必填，最多 20 个 URI。内网或 localhost 的 HTTP 回调允许登记，授权请求必须精确匹配登记 URI；`forum_access` 必须是布尔值；旧 `requested_scopes` 必须是有效且无重复的受支持列表。

成功返回 `201`：

```json
{
  "success": true,
  "application": {
    "id": 12,
    "client_id": "...",
    "client_type": "public",
    "party_type": "third_party",
    "ecosystem": "mdtbbs",
    "status": "pending",
    "approved_scopes": [],
    "client_secret": null
  }
}
```

未登录返回 `401`；邮箱未验证返回 `403` 与 `EMAIL_VERIFICATION_REQUIRED`；选择 `mdtbbs` 生态但手机号未验证返回 `403` 与 `PHONE_VERIFICATION_REQUIRED`；字段、URI、接入选项或生态无效返回 `400`；限流返回 `429`。

## 修改应用

```http
PUT /api/developer/clients/:id
Cookie: session=...
Content-Type: application/json
```

请求字段与创建相同，提交完整应用配置。只允许应用所有者修改自助创建的 Public Client。名称、简介、主页、生态、Redirect URI 和接入范围会重新进入管理员审核；已启用应用的授权与令牌会在重新审核期间撤销。scope 变化会要求用户在下次授权时重新确认。

成功：`{ "success": true }`。不属于当前用户或已删除应用返回 `404`；无效配置返回 `400`。

## 删除应用

```http
DELETE /api/developer/clients/:id
Cookie: session=...
```

页面应先向开发者确认。成功：`{ "success": true, "deleted": true }`。服务端将状态置为 `deleted`、删除用户授权并撤销关联的 refresh/access token。Client ID 保留在数据库且不会再次分配；公开详情返回应用不可用，不再返回简介或账户数据。

## 公开应用目录与详情

```http
GET /api/public/apps
GET /api/public/apps/:clientId
```

无需登录。目录只列出已启用的 Public Client，按 first-party 优先排序，最多返回 100 项。详情会返回名称、简介、主页、官方/第三方标识、开发者名称与 MDTBBS 用户主页链接、已授权用户数和中文 scope 说明。已审核的 `application_icon_url` 也会公开。Presence/Multiplayer 随论坛接入启用；`launch_uri_template` 仅在论坛应用批准且已填写模板时返回，否则为 null。每次修改应用都会使应用重新审核。scope 数组保留为协议兼容字段，界面只展示两档接入范围。

已停用或软删除的 Public Client 详情只返回：

```json
{ "success": true, "application": { "client_id": "...", "available": false } }
```

Confidential Client 和未知 client ID 返回 `404`，不公开管理状态或后台资料。

## 保留的兼容端点

- `POST /api/developer/clients/:id/submit` 保留兼容旧页面；符合旧状态条件时切换为 `pending`，等待管理员审核。
- `POST /api/developer/clients/:id/deactivate` 保留兼容旧页面；停用应用会撤销授权及令牌。重新启用需管理员恢复状态。
