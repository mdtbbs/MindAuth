# 开发者应用与公开目录 API

本文说明 MindAuth Public Client 自助应用管理及公开应用目录接口。普通开发者只能创建第三方 Public Client；Confidential Client 与 first-party client 仍由管理员在管理后台维护。

> **维护提示**：修改 `src/routes/developerClients.js`、`src/routes/publicApps.js` 或 `src/modules/admin/clientRegistry.js` 时同步更新本文档及 [README.md](README.md)。网页流程见 [Public Client PKCE 指南](../public-client-pkce.md)。

## 使用条件与安全边界

- 开发者 API 使用 MindAuth `session` Cookie。创建应用还要求账号手机号已验证。
- 创建接口按 IP 限制为每小时 10 次；应用数量没有固定上限。
- 新应用立即为 `approved`，类型固定为 `public` / `third_party`，`client_secret` 为 `NULL`，并强制 PKCE S256。
- 应用使用 Authorization Code Flow；Public Client 不支持客户端密钥、implicit flow 或 password grant。
- 新第三方应用只允许 HTTPS、明确的 loopback HTTP（含端口 `0`）或安全自定义 scheme 回调。HTTPS 和回调地址会拒绝用户凭证、fragment、内网地址及危险协议。
- 更新 scopes 会同步更新应用允许的 scopes，并撤销该应用现存的 refresh/access token；用户下次授权时按新增 scope 重新确认。
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
    "client_id": "...",
    "client_type": "public",
    "party_type": "third_party",
    "status": "approved",
    "require_pkce": true,
    "requested_scopes": ["profile", "forum.read"],
    "approved_scopes": ["profile", "forum.read"],
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
  "redirect_uris": ["http://127.0.0.1:0/oauth/callback", "mdtlauncher://oauth/callback"],
  "requested_scopes": ["profile", "forum.read"]
}
```

`website_url` 可省略或为 `null`；如果填写，只接受 HTTPS 或 localhost/loopback HTTP。名称、简介和至少一个 Redirect URI 必填，最多 20 个 URI。scope 必须是系统支持项，且至少选择一个。

成功返回 `201`：

```json
{
  "success": true,
  "application": {
    "id": 12,
    "client_id": "...",
    "client_type": "public",
    "party_type": "third_party",
    "status": "approved",
    "approved_scopes": ["profile", "forum.read"],
    "client_secret": null
  }
}
```

未登录返回 `401`；手机号未验证返回 `403` 与 `PHONE_VERIFICATION_REQUIRED`；字段、URI 或 scope 无效返回 `400`；限流返回 `429`。

## 修改应用

```http
PUT /api/developer/clients/:id
Cookie: session=...
Content-Type: application/json
```

请求字段与创建相同，提交完整应用配置。只允许应用所有者修改自助创建的 Public Client。名称、简介、主页、Redirect URI 和 scopes 安全校验通过后立即生效；修正后的旧 `draft` / `pending` 应用也会立即启用。`rejected` 和 `suspended` 保留原状态。scope 变化会撤销该应用的现有令牌；仅调整资料或 Redirect URI 不会注销用户授权。

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

无需登录。目录只列出已启用的 Public Client，按 first-party 优先排序，最多返回 100 项。详情会返回名称、简介、主页、官方/第三方标识、开发者名称与 MDTBBS 用户主页链接、已授权用户数和中文 scope 说明。

已停用或软删除的 Public Client 详情只返回：

```json
{ "success": true, "application": { "client_id": "...", "available": false } }
```

Confidential Client 和未知 client ID 返回 `404`，不公开管理状态或后台资料。

## 保留的兼容端点

- `POST /api/developer/clients/:id/submit` 保留兼容旧页面；符合旧状态条件时直接切换为 `approved`，不会进入人工审核。
- `POST /api/developer/clients/:id/deactivate` 保留兼容旧页面；停用应用会撤销授权及令牌。重新启用需管理员恢复状态。
