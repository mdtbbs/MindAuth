# MindAuth 第三方 OAuth API 接入指南

本文保留服务端 Confidential Client 的接入说明。Android、桌面、游戏 Mod、纯浏览器应用和第三方启动器应阅读 [Public Client PKCE 指南](public-client-pkce.md)：它们通过系统浏览器登录，不持有 `client_secret`。

> **维护提示：** 修改 `src/routes/oauth.js`、`src/modules/oauth/*` 或 OIDC Discovery 元数据时，需同步更新本文和 [API 参考](api/oauth.md)。

## 接入前先确认

- 服务端网站可使用 Confidential Client + PKCE S256，`client_secret` 只留在后端。
- 公开二进制或浏览器 bundle 使用开发者中心批准的 Public Client。Public Client 直接以 `client_id` + authorization code + verifier 调 `/api/token`，无 `client_secret`。
- MindAuth 发布 OIDC Discovery 元数据和 UserInfo，但**不签发 ID Token，也不提供 JWKS**。需要验证签名 ID Token 的 OIDC 客户端不能直接使用当前契约；登录后应由后端调用 UserInfo，并以 `issuer + sub` 作为外部用户标识。
- `/api/native/*` 与 `/api/v1/native/*` 是预先登记的第一方客户端接口，不是第三方 OAuth 接口。其他应用不得收集 MindAuth 密码或调用 Native Password Login。
- RFC 8628 设备授权端点虽存在于当前服务，但未纳入本次公开契约；仓库中的 [设备授权实现说明](DEVICE_AUTH.md) 是旧版内部参考，暂勿依赖其中示例集成。

## 1. 注册 OAuth 应用

Confidential Client 由 MindAuth 管理员创建。Public Client 在 MindAuth 开发者中心自助申请，管理员审核 Redirect URI 和 scopes。Public Client 支持 HTTPS、自定义 scheme 和显式 loopback literal；详见 [PKCE 指南](public-client-pkce.md)。

取得以下配置后，将密钥放在服务端密钥管理或环境变量中：

| 配置 | 用途 |
|---|---|
| `client_id` | 客户端公开标识 |
| `client_secret` | 仅 Confidential Client 的服务端凭证；Public Client 不存在该字段 |
| `redirect_uri` | 注册过的回调地址 |
| MindAuth issuer | 部署方提供的认证服务根地址，例如 `https://auth.example.com` |

Confidential Client 可配置 `require_pkce`。Public Client 强制要求 PKCE。MindAuth 只接受 `S256`，不接受 `plain`。

## 2. 发现端点

向 `{issuer}/.well-known/openid-configuration` 发起 GET 请求，可读取授权、token、userinfo、撤销和内省端点。使用返回的端点 URL，避免在应用中散落硬编码地址。

当前实现有两个需要适配的地方：

1. 新客户端在 Discovery 返回的 `/api/token` 使用 `authorization_code` 和 `refresh_token` grant；旧 `/api/refresh` 暂时兼容。
2. MindAuth 不返回 `id_token` 或 `jwks_uri`。用户资料需通过 UserInfo 获取。

## 3. 登录流程

1. 客户端创建不可预测的 `state` 和 PKCE `code_verifier`。服务端应用可把它们保存在与浏览器会话绑定的服务端 session；Public Client 应在客户端内存或受保护存储中保管 verifier。
2. 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`，将浏览器重定向到 `/api/authorize`。
3. MindAuth 要求用户登录后，把浏览器重定向到注册的回调地址，并附上一次性 `code` 和原样返回的 `state`。回调地址已有的查询参数会保留。
4. 客户端校验 `state`，然后把 `code`、`client_id`、`redirect_uri` 和 `code_verifier` POST 到 `/api/token`。只有 Confidential Client 同时提交后端 secret。
5. 客户端用返回的 `access_token` 调用 MindFourm `/api/v1/*`；服务端网站可继续调用 `/api/userinfo` 并建立本地 session。

授权码有效期为 5 分钟且只能兑换一次。`state` 应当随机、单次使用，并在回调时与发起登录的服务端会话比对。

## 4. Node.js / Express Confidential Client 示例

以下示例只演示持有服务端密钥的网站。公开桌面或移动应用不要复制 `client_secret` 代码，改用 [Public Client PKCE 指南](public-client-pkce.md)。示例假设 Express 已配置**服务端 session 存储**和 HTTPS 安全 Cookie。

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
        redirect_uri: REDIRECT_URI,
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

下面的请求体演示 Confidential Client。Public Client 不发送 `client_secret`，并必须额外发送发起登录时保存的 `redirect_uri`；具体字段见 [Public Client 指南](public-client-pkce.md)。

```json
{
  "grant_type": "authorization_code",
  "code": "callback 中的一次性授权码",
  "client_id": "客户端标识",
  "client_secret": "仅服务端持有的客户端密钥",
  "redirect_uri": "https://app.example.com/oauth/callback",
  "code_verifier": "发起授权时暂存的原始 verifier"
}
```

成功返回 `access_token`、`token_type`、`refresh_token`、`expires_in` 和 `scope`，不含用户对象。授权码使用 PKCE 时 `code_verifier` 必填。

### 读取 UserInfo

调用 `GET {issuer}/api/userinfo` 并发送 `Authorization: Bearer {access_token}`。响应字段由授权 scope 决定：`sub` 始终存在；`profile` 提供用户资料；`email` 提供 `email` 和 `email_verified`。只申请和保存业务确实需要的 scope 与字段。完整 claim 清单见 [OAuth / OIDC API 参考](api/oauth.md)。

### 刷新与撤销

- access token 默认有效 1 小时；refresh token 默认有效 30 天。新客户端在 `POST {issuer}/api/token` 使用 `grant_type: "refresh_token"`；旧 `POST {issuer}/api/refresh` 保持兼容。Public Client 只发送 `client_id` 与 `refresh_token`，Confidential Client 还发送 `client_secret`。
- 每次刷新都会轮换 refresh token。必须原子替换并保存新 token，旧 token 立即失效；重放旧 token 会返回 `invalid_grant`。若怀疑凭证泄漏，请在 MindAuth 撤销该客户端授权，不要假设重放会自动撤销同一用户的其他令牌。
- Public Client 可用 `client_id` 调用 `POST {issuer}/api/revoke` 撤销属于自己的 token。`/api/introspect` 仅供 Confidential Resource Server 使用。完整请求和响应见 [OAuth / OIDC API 参考](api/oauth.md)。
- MindAuth 的浏览器退出不会自动清除第三方应用的本地 session。第三方需自行结束本地 session；若保存了 OAuth token，也应按产品退出策略撤销它们。

## 6. 常见错误与安全边界

| 情况 | 处理方式 |
|---|---|
| `invalid_redirect` | 确认请求中的 `redirect_uri` 与应用登记规则匹配。授权请求校验失败会显示 MindAuth 自己的错误页，不会把错误重定向到未验证的回调地址。 |
| `invalid_grant` | 授权码可能已过期、已使用、发给另一个客户端，或 PKCE verifier 不匹配；重新发起整个登录流程。 |
| `invalid_client` | 检查应用是否已批准且未停用；Confidential Client 检查服务端 secret。Public Client 不发送 secret。 |
| UserInfo 返回 `invalid_token` | access token 无效或过期；按需使用 refresh token 轮换，失败时重新登录。 |

不要把以下内容当作第三方 OAuth 接入方式：

- `POST /api/verify`：内部 session-token 校验接口，不是跨域登录方案；不要从浏览器读取或转交 MindAuth session Cookie。
- `GET /api/user`：旧版兼容端点。新接入应使用按 scope 过滤的 `/api/userinfo`。
- `/api/native/*` 与 `/api/v1/native/*`：仅预先登记的第一方客户端使用，不得让第三方应用收集 MindAuth 用户密码。

## 相关文档

- [OAuth / OIDC API 参考](api/oauth.md)：稳定外部端点的参数、响应与错误码，并区分内部和旧版端点。
- [Public Client PKCE 指南](public-client-pkce.md)：桌面、移动、Mod 和浏览器原生应用接入。
- [API 总索引](api/README.md)：认证方式、错误格式和全量端点索引。
