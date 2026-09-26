# MDTBBS Public Client OAuth + PKCE

本指南适用于 Android、桌面程序、游戏 Mod、浏览器原生应用和第三方启动器。所有应用使用同一套 MindAuth Authorization Code 流程；应用名不会获得额外权限。Web 服务端可以继续使用 Confidential Client，公开二进制和浏览器代码必须使用 Public Client。

## 申请与批准

登录 MindAuth 后打开开发者中心，或使用 `{issuer}/developer`：

1. 创建 Public Client 草稿，填写名称、说明、主页、一个或多个 Redirect URI 和申请的 scope。
2. 提交管理员审核。`draft`、`pending`、`rejected`、`suspended` 状态均不能授权；只有 `approved` 可用于 OAuth。
3. 批准后读取 `client_id` 与管理员批准的 scopes。Public Client 没有 `client_secret`，开发者中心不会显示或生成 secret。

注册页面：`{issuer}/register`。密码、验证码、邮件和风控始终在 MindAuth 网站处理。

## Redirect URI 规则

- Web callback 使用 HTTPS，URI 必须完全匹配注册值。
- 原生应用可登记自定义 scheme，例如 `com.example.launcher:/oauth2redirect`；必须用应用专属 scheme，不要使用 `http`、`https`、`javascript`、`file`、`intent` 等保留协议。
- 桌面 loopback 使用 `http://127.0.0.1:0/oauth/callback` 或 `http://[::1]:0/oauth/callback` 注册。运行时绑定随机端口后，request URI 必须保持同一 loopback literal、path 和 query。`localhost`、LAN、私网地址和任意内网目标不属于 loopback callback。
- callback 不允许 userinfo 或 fragment。不得使用 wildcard。

## PKCE 登录

每次登录生成新的 `state` 和 43–128 字符 `code_verifier`，并计算：

```text
code_challenge = BASE64URL(SHA256(UTF8(code_verifier)))
```

使用系统浏览器访问：

```text
{issuer}/api/authorize
  ?response_type=code
  &client_id=PUBLIC_CLIENT_ID
  &redirect_uri=REGISTERED_CALLBACK
  &scope=openid%20profile%20forum.read
  &state=RANDOM_STATE
  &code_challenge=BASE64URL_SHA256
  &code_challenge_method=S256
```

校验回调 `state` 后，把 `code`、原始 `redirect_uri`、`client_id` 和 verifier 发送到 `/api/token`。Public Client 不发送 `client_secret`。

```http
POST {issuer}/api/token
Content-Type: application/json

{"grant_type":"authorization_code","client_id":"PUBLIC_CLIENT_ID","code":"AUTHORIZATION_CODE","redirect_uri":"REGISTERED_CALLBACK","code_verifier":"ORIGINAL_VERIFIER"}
```

授权码五分钟有效、单次消费，并绑定 client、redirect URI 和 PKCE challenge。缺少 PKCE、使用 `plain`、错误 verifier、redirect mismatch、跨 client 兑换、pending 或 suspended app 都会失败。

## Scopes

只有应用已申请且管理员批准的 scopes 才能请求；用户首次授权或新增 scope 时会看到确认页。当前 scope：

| Scope | 用户可见含义 |
|---|---|
| `openid` | 稳定账户标识 |
| `profile` | 基本资料 |
| `email` | 电子邮箱和验证状态 |
| `forum.read` / `forum.write` | 读取论坛 / 创建或修改帖子与回复 |
| `resource.read` / `resource.download` / `resource.upload` | 浏览 / 下载 / 申请上传资源 |
| `notification.read` | 读取和标记通知 |
| `message.read` / `message.write` | 读取 / 发送私信 |

论坛仍会检查用户状态、手机号、条款、版块权限、审核队列、封禁、站点开关和资源策略。OAuth scope 不是业务权限绕过。

## Refresh / revoke

Access token 一小时有效；refresh token 轮换并检测重放。新客户端通过标准路径刷新：

```http
POST {issuer}/api/token
Content-Type: application/json

{"grant_type":"refresh_token","client_id":"PUBLIC_CLIENT_ID","refresh_token":"CURRENT_REFRESH_TOKEN"}
```

旧 `/api/refresh` 保持兼容。Public Client 撤销自身令牌：

```http
POST {issuer}/api/revoke
Content-Type: application/json

{"client_id":"PUBLIC_CLIENT_ID","token":"TOKEN_TO_REVOKE"}
```

用户也可以在 `{issuer}/authorizations` 撤销应用授权；撤销会清除该授权的 refresh token 和 access token。停用自己的应用会把应用设为 suspended、撤销授权并立即阻断该应用的 OAuth token。

## Client integration examples

### curl — 调用已获授权的 MindFourm API

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $MDTBBS_ACCESS_TOKEN" \
  -H 'Accept: application/json' \
  'https://forum.example.com/api/v1/me'
```

### TypeScript — browser/system-browser redirect preparation

```ts
const verifier = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const state = crypto.randomUUID();
sessionStorage.setItem('oauth.pending', JSON.stringify({ verifier, state }));
const authorize = new URL('/api/authorize', issuer);
authorize.search = new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
  scope: 'openid profile forum.read', state,
  code_challenge: challenge, code_challenge_method: 'S256',
}).toString();
window.location.assign(authorize);
```

At the registered callback, compare `state` before exchanging the code. For a native or desktop client, use the operating system browser and keep the verifier in process memory or protected local storage; do not put tokens in a URL.

### Java — PKCE values and code exchange

```java
SecureRandom random = new SecureRandom();
byte[] verifierBytes = new byte[32]; random.nextBytes(verifierBytes);
String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(verifierBytes);
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
String challenge = Base64.getUrlEncoder().withoutPadding()
    .encodeToString(sha256.digest(verifier.getBytes(StandardCharsets.US_ASCII)));
String state = UUID.randomUUID().toString();
// Open the system browser with /api/authorize and the same state/challenge fields.
// After validating state at the registered callback, POST JSON to /api/token:
ObjectMapper mapper = new ObjectMapper();
Map<String, String> tokenRequest = Map.of(
    "grant_type", "authorization_code",
    "client_id", clientId,
    "code", code,
    "redirect_uri", redirectUri,
    "code_verifier", verifier
);
String body = mapper.writeValueAsString(tokenRequest);
HttpRequest request = HttpRequest.newBuilder(URI.create(issuer + "/api/token"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(body)).build();
HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
```

Use a JSON library to serialize the body in production. Desktop apps should bind the callback server only to `127.0.0.1` or `[::1]` and close it after one callback.

### Kotlin — Android external browser callback

MindAuth migration `013_seed_official_android_public_client.sql` registers the official MDTBBS Android app as the approved first-party Public Client `mdtbbs_android_public`, with `mdtbbs://oauth/callback` and the scopes used by the official app. The Android project uses that public ID by default. To use another registered public client in a build, set `mdtbbsOauthClientId` in Gradle properties; never add a client secret. Apply the MindAuth migrations before distributing an Android build that uses this flow. Existing installed Android versions continue to use the legacy compatibility endpoints.

```kotlin
val verifierBytes = ByteArray(32).also(SecureRandom()::nextBytes)
val verifier = Base64.encodeToString(verifierBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
val challenge = Base64.encodeToString(
  MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
  Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
)
val state = UUID.randomUUID().toString()
val authorize = Uri.parse("$issuer/api/authorize").buildUpon()
  .appendQueryParameter("response_type", "code")
  .appendQueryParameter("client_id", clientId)
  .appendQueryParameter("redirect_uri", redirectUri)
  .appendQueryParameter("scope", "openid profile forum.read")
  .appendQueryParameter("state", state)
  .appendQueryParameter("code_challenge", challenge)
  .appendQueryParameter("code_challenge_method", "S256")
  .build()
startActivity(Intent(Intent.ACTION_VIEW, authorize)) // App Link or registered custom scheme callback
// In the callback activity, compare state, then POST code + verifier + redirect_uri to /api/token.
```

Store refresh credentials using Android Keystore-backed storage. Never bundle a service key, External API key, or client secret.

## Discovery and resource-server boundary

Use `GET {issuer}/.well-known/openid-configuration` to find protocol endpoints and scopes. MindAuth currently provides UserInfo but does not issue signed ID tokens/JWKS. `/api/introspect` is restricted to approved Confidential Resource Servers such as MindFourm; Public Clients must not call it. External API keys remain server-only credentials and are not part of this OAuth flow.
