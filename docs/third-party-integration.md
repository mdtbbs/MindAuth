# MindAuth 第三方 OAuth API 接入指南

本文面向需要用 MindAuth 为网站提供登录的第三方开发者。本次对外接口契约覆盖 OAuth 2.0 Authorization Code + PKCE S256；完成客户端注册后，按本指南接入。端点参数、响应与错误码见 [OAuth / OIDC API 参考](api/oauth.md)，其中标记为“内部”或“旧版兼容”的端点不属于第三方接入接口。

> **维护提示：** 修改 `src/routes/oauth.js`、`src/modules/oauth/*` 或 OIDC Discovery 元数据时，需同步更新本文和 [API 参考](api/oauth.md)。

## 接入前先确认

- 使用 **Authorization Code + PKCE S256**。MindAuth 的 `/api/token` 还要求 `client_id` 和 `client_secret`，因此换 token 必须由可信后端完成。浏览器、SPA、桌面或手机客户端不得保存或发送 `client_secret`。
- PKCE 不能代替客户端保密。本流程不支持纯 SPA、桌面或移动端直接换取令牌；若应用没有可信后端，请先与 MindAuth 管理员确认已批准的接入方案，不要把密钥打包进客户端。
- MindAuth 发布 OIDC Discovery 元数据和 UserInfo，但**不签发 ID Token，也不提供 JWKS**。需要验证签名 ID Token 的 OIDC 客户端不能直接使用当前契约；登录后应由后端调用 UserInfo，并以 `issuer + sub` 作为外部用户标识。
- `/api/native/*` 与 `/api/v1/native/*` 是预先登记的第一方客户端接口，不是第三方 OAuth 接口。其他应用不得收集 MindAuth 密码或调用 Native Password Login。
- RFC 8628 设备授权端点虽存在于当前服务，但未纳入本次公开契约；仓库中的 [设备授权实现说明](DEVICE_AUTH.md) 是旧版内部参考，暂勿依赖其中示例集成。

## 1. 注册 OAuth 应用

联系 MindAuth 管理员创建客户端，并提供应用名称和完整回调 URL。生产回调必须使用 HTTPS。回调地址必须与注册值**逐字完全一致**，包括协议、主机、端口、路径和查询部分；不支持通配符。管理端还会拒绝 localhost 和私有/内部网络地址。

取得以下配置后，将密钥放在服务端密钥管理或环境变量中：

| 配置 | 用途 |
|---|---|
| `client_id` | 客户端公开标识 |
| `client_secret` | 仅后端调用 token、refresh、introspect、revoke 时使用 |
| `redirect_uri` | 注册过的回调地址 |
| MindAuth issuer | 部署方提供的认证服务根地址，例如 `https://auth.example.com` |

请让管理员为客户端启用 `require_pkce`。MindAuth 只接受 PKCE `S256`，不接受 `plain`。

## 2. 发现端点

向 `{issuer}/.well-known/openid-configuration` 发起 GET 请求，可读取授权、token、userinfo、撤销和内省端点。使用返回的端点 URL，避免在应用中散落硬编码地址。

当前实现有两个需要适配的地方：

1. Discovery 的 `grant_types_supported` 包含 `refresh_token`，但刷新请求实际发送到单独的 `{issuer}/api/refresh`，而不是 `/api/token`。
2. Discovery 仅用于发现支持的端点和部分元数据；MindAuth 不返回 `id_token` 或 `jwks_uri`。用户资料需通过 UserInfo 获取。

## 3. 登录流程

1. 第三方后端创建不可预测的 `state` 和 PKCE `code_verifier`，暂存在与浏览器会话绑定的服务端 session 中。
2. 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`，将浏览器重定向到 `/api/authorize`。
3. MindAuth 要求用户登录后，把浏览器重定向到注册的回调地址，并附上一次性 `code` 和原样返回的 `state`。回调地址已有的查询参数会保留。
4. 第三方后端校验 `state`，然后把 `code`、客户端凭证和 `code_verifier` POST 到 `/api/token`。
5. 后端用返回的 `access_token` 调用 `/api/userinfo`，再创建本地登录会话。

授权码有效期为 5 分钟且只能兑换一次。`state` 应当随机、单次使用，并在回调时与发起登录的服务端会话比对。

## 4. Node.js / Express 示例

以下示例假设 Express 已配置**服务端 session 存储**和 HTTPS 安全 Cookie。把回调 URL 配成第 1 节登记的同一个值。示例将 verifier 保存在服务端 session，不经过浏览器存储。

```js
import { createHash, randomBytes } from 'node:crypto';

const ISSUER = process.env.MINDAUTH_ISSUER; // 例如 https://auth.example.com
const CLIENT_ID = process.env.MINDAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.MINDAUTH_CLIENT_SECRET; // 仅服务端
const REDIRECT_URI = 'https://app.example.com/oauth/callback';

const discoveryResponse = await fetch(new URL('/.well-known/openid-configuration', ISSUER));
if (!discoveryResponse.ok) throw new Error('MindAuth Discovery 请求失败');
const discovery = await discoveryResponse.json();
if (discovery.issuer !== ISSUER) throw new Error('MindAuth issuer 不匹配');

app.get('/login', (req, res) => {
  const state = randomBytes(32).toString('base64url');
  // 32 随机字节编码后为 43 字符，符合 PKCE verifier 长度要求。
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  req.session.oauth = { state, codeVerifier };

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  res.redirect(authorizeUrl.toString());
});

app.get('/oauth/callback', async (req, res, next) => {
  try {
    const pending = req.session.oauth;
    delete req.session.oauth; // state/verifier 只允许使用一次

    const { code, state } = req.query;
    if (!pending || typeof state !== 'string' || state !== pending.state) {
      return res.status(400).send('OAuth state 校验失败');
    }
    if (typeof code !== 'string') {
      return res.status(400).send('回调缺少授权码');
    }

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: pending.codeVerifier,
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('MindAuth token exchange failed:', tokens.error);
      return res.status(401).send('MindAuth 登录失败，请重新发起登录');
    }

    const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const claims = await userInfoResponse.json();
    if (!userInfoResponse.ok || !claims.sub) {
      return res.status(401).send('无法读取 MindAuth 用户资料');
    }

    // 登录成功后重新生成 session ID，避免 session fixation。
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });

    // 按 issuer + sub 查找/创建本地账号；只保存应用所需资料。
    // 如需保留 token，应使用受保护的服务端存储。
    req.session.user = {
      issuer: ISSUER,
      sub: claims.sub,
      username: claims.username,
      email: claims.email,
    };
    await new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});
```

确保回调 URL 不会记录或转发 `code`、`state` 等查询参数；兑换成功后立即跳转到不带 OAuth 参数的站内页面。实际部署还应配置安全 Cookie 属性。

## 5. 令牌和用户资料

### 兑换授权码

`POST {issuer}/api/token`，请求体为 JSON（不接受 `application/x-www-form-urlencoded`）：

```json
{
  "grant_type": "authorization_code",
  "code": "callback 中的一次性授权码",
  "client_id": "客户端标识",
  "client_secret": "仅服务端持有的客户端密钥",
  "code_verifier": "发起授权时暂存的原始 verifier"
}
```

成功返回 `access_token`、`token_type`、`refresh_token`、`expires_in` 和 `scope`，不含用户对象。授权码使用 PKCE 时 `code_verifier` 必填。

### 读取 UserInfo

调用 `GET {issuer}/api/userinfo` 并发送 `Authorization: Bearer {access_token}`。响应字段由授权 scope 决定：`sub` 始终存在；`profile` 提供用户资料；`email` 提供 `email` 和 `email_verified`。只申请和保存业务确实需要的 scope 与字段。完整 claim 清单见 [OAuth / OIDC API 参考](api/oauth.md)。

### 刷新与撤销

- access token 默认有效 1 小时；refresh token 默认有效 30 天。刷新使用 `POST {issuer}/api/refresh`，请求体包含 `grant_type: "refresh_token"`、当前 `refresh_token`、`client_id` 和 `client_secret`。
- 每次刷新都会轮换 refresh token。必须原子替换并保存新 token，旧 token 立即失效；重放旧 token 会返回 `invalid_grant`。若怀疑凭证泄漏，请在 MindAuth 撤销该客户端授权，不要假设重放会自动撤销同一用户的其他令牌。
- `POST {issuer}/api/revoke` 可撤销当前客户端自己的 access token 或 refresh token。内省使用 `POST {issuer}/api/introspect`；这些端点都需要客户端凭证。完整请求和响应见 [OAuth / OIDC API 参考](api/oauth.md)。
- MindAuth 的浏览器退出不会自动清除第三方应用的本地 session。第三方需自行结束本地 session；若保存了 OAuth token，也应按产品退出策略撤销它们。

## 6. 常见错误与安全边界

| 情况 | 处理方式 |
|---|---|
| `invalid_redirect` | 确认请求中的 `redirect_uri` 与管理端登记值逐字一致。授权请求校验失败会显示 MindAuth 自己的错误页，不会把错误重定向到未验证的回调地址。 |
| `invalid_grant` | 授权码可能已过期、已使用、发给另一个客户端，或 PKCE verifier 不匹配；重新发起整个登录流程。 |
| `invalid_client` | 检查服务端配置的 `client_id` / `client_secret`，不要将 secret 发给浏览器。 |
| UserInfo 返回 `invalid_token` | access token 无效或过期；按需使用 refresh token 轮换，失败时重新登录。 |

不要把以下内容当作第三方 OAuth 接入方式：

- `POST /api/verify`：内部 session-token 校验接口，不是跨域登录方案；不要从浏览器读取或转交 MindAuth session Cookie。
- `GET /api/user`：旧版兼容端点。新接入应使用按 scope 过滤的 `/api/userinfo`。
- `/api/native/*` 与 `/api/v1/native/*`：仅预先登记的第一方客户端使用，不得让第三方应用收集 MindAuth 用户密码。

## 相关文档

- [OAuth / OIDC API 参考](api/oauth.md)：稳定外部端点的参数、响应与错误码，并区分内部和旧版端点。
- [API 总索引](api/README.md)：认证方式、错误格式和全量端点索引。
