# 第三方系统接入文档

## 概述

MindAuth 提供 OAuth 2.0 单点登录（SSO）服务，支持第三方系统接入。用户在 MindAuth 登录后，访问第三方系统时可实现无感登录。

MindAuth 支持以下标准：
- OAuth 2.0 Authorization Code Flow (RFC 6749)
- PKCE S256 (RFC 7636)
- Token Introspection (RFC 7662)
- Token Revocation (RFC 7009)
- OpenID Connect Discovery 1.0

> **注意：** MindFourm（论坛）已完全切换到 OAuth-only 用户同步模式。不再支持 service-key 方式的直接用户同步。所有第三方系统必须通过 OAuth 2.0 流程接入。

**Native Password API 边界：** `/api/native/*` 仅供 MDTBBS 官方 Mindustry Mod 的 `mdtbbs-mindustry-mod` public client 使用。第三方应用不得收集 MindAuth 密码或调用 Native Password Login；请使用本文档的 Authorization Code + PKCE。Mod 不含 `client_secret`，其 `client_id` 不是可验证身份的秘密。生产 Mod 必须固定访问 `https://auth.mdtbbs.cn` 并执行正常 TLS 证书验证。Native API 不属于 OAuth password grant，也不会加入 OIDC Discovery 的 `grant_types_supported`。

---

## 1. OIDC Discovery

MindAuth 提供 OIDC Discovery 端点，第三方可自动发现所有 OAuth 端点：

```
GET /.well-known/openid-configuration
```

**响应示例：**
```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/api/authorize",
  "token_endpoint": "https://auth.example.com/api/token",
  "userinfo_endpoint": "https://auth.example.com/api/userinfo",
  "revocation_endpoint": "https://auth.example.com/api/revoke",
  "introspection_endpoint": "https://auth.example.com/api/introspect",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "scopes_supported": ["openid", "profile", "email"],
  "token_endpoint_auth_methods_supported": ["client_secret_post"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

---

## 2. 注册应用

联系管理员在 `http://your-auth-server/admin` 创建 OAuth 应用，获取：

| 参数 | 说明 |
|------|------|
| `client_id` | 应用标识，公开可见 |
| `client_secret` | 应用密钥，**仅后端使用，禁止前端暴露** |
| `redirect_uri` | 回调地址，必须严格匹配（不支持通配符） |

> **安全限制：** `redirect_uri` 不允许指向私有 IP 地址（如 `localhost`、`127.0.0.1`、`10.x.x.x`、`192.168.x.x`），以防止 SSRF 攻击。生产环境请使用公网域名。

---

## 3. API 接口

### 3.1 授权端点

用户未登录时，跳转到此端点：

```
GET /api/authorize?redirect_uri={redirect_uri}&client_id={client_id}&state={state}&code_challenge={challenge}&code_challenge_method=S256
```

**参数：**
| 参数 | 必填 | 说明 |
|------|------|------|
| `redirect_uri` | 是 | 注册时配置的回调地址 |
| `client_id` | 是 | 应用标识 |
| `state` | 推荐 | 防 CSRF 随机字符串，回调时原样返回 |
| `code_challenge` | 推荐 | PKCE S256 challenge（Base64URL(SHA256(code_verifier))） |
| `code_challenge_method` | 推荐 | 固定为 `S256` |

**响应：**
- 用户已登录：重定向到 `redirect_uri?code={code}&state={state}`
- 用户未登录：重定向到 React 登录页面，登录成功后自动跳回

---

### 3.2 Token 端点

第三方后端用 code 换取 token：

```
POST /api/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "授权码",
  "client_id": "应用标识",
  "client_secret": "应用密钥",
  "code_verifier": "PKCE code_verifier（如果使用 PKCE）"
}
```

**响应成功：**
```json
{
  "access_token": "xxx",
  "token_type": "Bearer",
  "refresh_token": "xxx",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

> **注意：** 响应中不包含用户信息。请使用 `access_token` 调用 `/api/userinfo` 获取用户信息（见 3.4）。

**响应失败（RFC 6749 格式）：**
```json
{
  "error": "invalid_grant",
  "error_description": "无效、过期或已使用的授权码"
}
```

**错误码：**
| error | HTTP | 说明 |
|-------|------|------|
| `unsupported_grant_type` | 400 | grant_type 缺失或不为 `authorization_code` |
| `invalid_request` | 400 | 缺少必需参数（code/client_id/client_secret），或该授权码使用了 PKCE 但未提供 code_verifier |
| `invalid_client` | 401 | client_id 未注册或 client_secret 错误 |
| `invalid_grant` | 401 | code 无效、过期或已使用；code 与 client_id 不匹配；redirect_uri 不匹配；code_verifier 校验失败 |
| `server_error` | 500 | 服务器内部错误 |

---

### 3.3 Token 刷新

使用 refresh_token 获取新的 access_token：

```
POST /api/refresh
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "xxx",
  "client_id": "应用标识",
  "client_secret": "应用密钥"
}
```

**响应成功：**
```json
{
  "access_token": "新的 access_token",
  "token_type": "Bearer",
  "refresh_token": "新的 refresh_token（rotation）",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

> **注意：** MindAuth 使用 refresh token rotation。每次刷新都会返回新的 refresh_token，旧的立即失效。

---

### 3.4 UserInfo 端点

使用 access_token 获取用户信息（OIDC 标准）：

```
GET /api/userinfo
Authorization: Bearer {access_token}
```

**响应（字段随 token 的 scope 变化）：**
```json
{
  "sub": "1",
  "id": 1,
  "username": "用户名",
  "name": "用户名",
  "avatar_url": "/uploads/avatars/xxx.webp",
  "phone_verified": true,
  "phone_verified_at": "2026-01-01T00:00:00.000Z",
  "phone_masked": "138****8000",
  "ban_status": "none",
  "is_muted": false,
  "updated_at": 1735689600,
  "custom_fields": { "字段key": "值" },
  "email": "邮箱",
  "email_verified": true
}
```

**字段说明：**
- `sub`：始终返回（用户 ID 的字符串形式）
- `profile` scope：返回 `id`、`username`、`name`、`avatar_url`、`phone_verified`、`phone_verified_at`、`phone_masked`、`ban_status`、`is_muted`、`updated_at`，以及 `custom_fields`（仅公开的自定义字段，无值时省略该字段）。例如管理员公开配置的 `qq` 字段会以 `custom_fields.qq` 返回；该字段是用户资料，不是认证凭据，第三方应兼容字段缺失。
- `email` scope：返回 `email`、`email_verified`
- 响应中**不包含** `created_at` 字段

---

### 3.5 Token Introspection (RFC 7662)

验证 access_token 是否有效：

```
POST /api/introspect
Content-Type: application/json

{
  "token": "access_token",
  "client_id": "应用标识",
  "client_secret": "应用密钥"
}
```

---

### 3.6 Token Revocation (RFC 7009)

撤销 access_token 或 refresh_token：

```
POST /api/revoke
Content-Type: application/json

{
  "token": "token_to_revoke",
  "client_id": "应用标识",
  "client_secret": "应用密钥"
}
```

> 即使 token 不存在，也返回 `{ "success": true }`（符合 RFC 7009）。

---

### 3.7 Session 验证端点（同域场景）

同域情况下可直接验证 session token：

```
POST /api/verify
Content-Type: application/json

{
  "session_token": "用户的session token"
}
```

**响应成功：**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "用户名",
    "email": "邮箱",
    "phone_verified": false,
    "phone_verified_at": null,
    "created_at": "注册时间"
  }
}
```

---

## 4. 接入示例

### 4.1 前端跳转

```javascript
// 检测用户未登录时，跳转到认证中心
const authServer = 'https://auth.example.com';
const clientId = 'YOUR_CLIENT_ID';
const redirectUri = 'https://your-app.com/callback';
const state = crypto.randomUUID(); // 防 CSRF

// 可选：PKCE
const codeVerifier = crypto.randomUUID();
const codeChallenge = btoa(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

sessionStorage.setItem('oauth_state', state);
sessionStorage.setItem('code_verifier', codeVerifier);

window.location.href = `${authServer}/api/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
```

### 4.2 后端处理回调（Node.js Express）

```javascript
// 回调路由处理
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  // 验证 state 防 CSRF
  if (state !== req.session.expectedState) {
    return res.status(403).send('Invalid state');
  }

  if (!code) {
    return res.status(400).send('缺少授权码');
  }

  // 调用认证中心换取 token
  const response = await fetch('https://auth.example.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.MINDAUTH_CLIENT_ID,
      client_secret: process.env.MINDAUTH_CLIENT_SECRET,
      code_verifier: req.session.codeVerifier // 如果使用 PKCE
    })
  });

  const result = await response.json();

  if (response.ok) {
    // result = { access_token, token_type, refresh_token, expires_in, scope }

    // 用 access_token 调用 /api/userinfo 获取用户信息
    const userinfoRes = await fetch('https://auth.example.com/api/userinfo', {
      headers: { 'Authorization': `Bearer ${result.access_token}` }
    });
    const user = await userinfoRes.json();
    // { sub, id, username, email, ... }（字段随 scope 变化，见 3.4）

    // 创建本地会话
    req.session.user = user;
    req.session.accessToken = result.access_token;
    req.session.refreshToken = result.refresh_token;
    res.redirect('/dashboard');
  } else {
    res.status(401).send(result.error_description || result.error);
  }
});
```

### 4.3 后端处理回调（Python Flask）

```python
from flask import Flask, request, redirect, session
import requests

app = Flask(__name__)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    state = request.args.get('state')

    if state != session.get('expected_state'):
        return 'Invalid state', 403

    if not code:
        return '缺少授权码', 400

    response = requests.post('https://auth.example.com/api/token', json={
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': 'YOUR_CLIENT_ID',
        'client_secret': 'YOUR_CLIENT_SECRET'
    })

    result = response.json()

    if response.ok:
        # result = { access_token, token_type, refresh_token, expires_in, scope }
        # 用 access_token 调用 /api/userinfo 获取用户信息
        user = requests.get(
            'https://auth.example.com/api/userinfo',
            headers={'Authorization': f"Bearer {result['access_token']}"}
        ).json()
        session['user'] = user
        session['access_token'] = result['access_token']
        session['refresh_token'] = result['refresh_token']
        return redirect('/dashboard')
    else:
        return result.get('error_description') or result.get('error'), 401
```

### 4.4 同域场景（前端直接调用）

```javascript
// 从 Cookie 获取 session token（同域情况下 Cookie 共享）
const sessionToken = getCookie('session'); // 需自己实现获取 cookie

// 验证并获取用户信息
async function getUserInfo() {
  const response = await fetch('https://auth.example.com/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken })
  });

  const result = await response.json();
  if (result.success) {
    return result.user;
  }
  return null;
}
```

---

## 5. 接入流程图

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   用户      │    │  第三方系统  │    │  MindAuth   │
└─────────────┘    └─────────────┘    └─────────────┘
       │                 │                   │
       │  1.访问第三方   │                   │
       │────────────────>│                   │
       │                 │                   │
       │                 │ 2.检测未登录      │
       │                 │ 跳转 /api/authorize│
       │                 │──────────────────>│
       │                 │                   │
       │                 │                   │ 3.检查登录状态
       │                 │                   │    已登录→生成code
       │                 │                   │    未登录→显示React登录页
       │                 │                   │
       │  4.如未登录     │                   │
       │    用户登录     │                   │
       │────────────────────────────────────>│
       │                 │                   │
       │                 │ 5.重定向回调      │
       │                 │   带 code + state │
       │                 │<──────────────────│
       │                 │                   │
       │                 │ 6.后端用 code     │
       │                 │   换取 tokens     │
       │                 │──────────────────>│
       │                 │                   │
       │                 │ 7.返回 tokens     │
       │                 │   (含refresh)     │
       │                 │<──────────────────│
       │                 │                   │
       │  8.登录成功     │                   │
       │<────────────────│                   │
       │                 │                   │
```

---

## 6. 安全注意事项

| 项目 | 说明 |
|------|------|
| **client_secret** | 仅在第三方后端使用，**禁止暴露给前端** |
| **code 有效期** | 5分钟，一次性使用，用后即失效 |
| **redirect_uri** | 必须与注册时配置的完全匹配 |
| **HTTPS** | 生产环境必须使用 HTTPS |
| **state 参数** | 强烈建议使用 state 参数防止 CSRF 攻击 |
| **PKCE** | 推荐使用 PKCE S256 增强安全性 |
| **refresh rotation** | 每次刷新返回新 refresh_token，旧的立即失效 |
| **SSRF 防护** | redirect_uri 不允许指向私有 IP 地址 |

---

## 7. 测试示例

### 测试用例

```bash
# 1. 登录用户
# username 参数也可以传已验证格式的邮箱；邮箱匹配会忽略大小写并去除首尾空格。
curl -X POST http://localhost:4001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}' \
  -c cookies.txt

# 2. 获取授权码
curl -L -b cookies.txt \
  "http://localhost:4001/api/authorize?redirect_uri=http://localhost:4001/callback&client_id=YOUR_CLIENT_ID"

# 3. 用 code 换取 token
curl -X POST http://localhost:4001/api/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"authorization_code","code":"获得的code","client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET"}'

# 4. 用 access_token 获取用户信息
curl http://localhost:4001/api/userinfo \
  -H "Authorization: Bearer 获得的access_token"
```

---

## 8. 常见问题

**Q: code 可以重复使用吗？**
A: 不可以，code 只能使用一次，使用后立即失效。

**Q: code 有效期多久？**
A: 5分钟，超时后无法使用。

**Q: 同域和跨域有什么区别？**
A:
- 同域：可直接通过 Cookie 共享 session，调用 `/api/verify`
- 跨域：必须通过 OAuth 流程，使用 code 换取 token，再调用 `/api/userinfo` 获取用户信息

**Q: 如何处理用户退出登录？**
A: 第三方系统需自行处理本地会话清理，MindAuth 的退出不会自动通知第三方。如需检测用户是否已退出，可在 access_token 过期后调用 `/api/introspect` 检查。

**Q: 支持 PKCE 吗？**
A: 支持。仅支持 S256 方法（不接受 plain）。在 `/api/authorize` 时传 `code_challenge` 和 `code_challenge_method=S256`，在 `/api/token` 时传 `code_verifier`。

**Q: MindFourm 还使用 service-key 同步用户吗？**
A: 不再使用。MindFourm 已完全切换到 OAuth-only 模式，所有用户同步通过 OAuth 2.0 授权码流程完成。

---

## 9. 联系方式

如有问题请联系管理员。
