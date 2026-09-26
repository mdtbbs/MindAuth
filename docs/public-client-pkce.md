# MDTBBS Public Client OAuth + PKCE

本指南适用于 Android、桌面程序、游戏 Mod、浏览器原生应用和第三方启动器。所有应用使用同一套 MindAuth Authorization Code 流程；应用名不会获得额外权限。Web 服务端可以继续使用 Confidential Client，公开二进制和浏览器代码必须使用 Public Client。

## 自助创建

登录并完成手机号验证后，打开 `{issuer}/developer`：

1. 创建 Public Client，填写名称、必填简介、可选主页、一个或多个 Redirect URI 和 scope。
2. 创建成功后立即获得 `client_id`，应用状态为 `approved`，无需测试模式或管理员审核。应用数量不限；创建接口按 IP 限流。
3. Public Client 的 `client_secret` 为 `NULL`，必须使用 Authorization Code + PKCE S256。管理员仍可管理 confidential client、停用或删除恶意应用。

注册页面：`{issuer}/register`。密码、验证码、邮件和风控始终在 MindAuth 网站处理。

## Redirect URI 规则

- Web callback 使用 HTTPS，URI 必须完全匹配注册值。
- 原生应用可登记自定义 scheme，例如 `com.example.launcher:/oauth2redirect`；必须用应用专属 scheme，不要使用 `http`、`https`、`javascript`、`file`、`intent` 等保留协议。
- 桌面 loopback 使用 `http://127.0.0.1:0/oauth/callback`、`http://[::1]:0/oauth/callback` 或 `http://localhost:0/oauth/callback` 注册。运行时绑定随机端口后，request URI 必须保持同一主机、path 和 query。LAN、私网地址和任意内网目标不属于 loopback callback。
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

授权码五分钟有效、单次消费，并绑定 client、redirect URI 和 PKCE challenge。缺少 PKCE、使用 `plain`、错误 verifier、redirect mismatch、跨 client 兑换、未批准或已停用的 app 都会失败。

## Scopes

应用只能请求自己在开发者中心勾选的 scopes；修改权限立即生效，并撤销现有 token 以应用新权限。用户首次授权或新增 scope 时会看到确认页；已授予的相同权限不重复询问。`message.read` 和 `message.write` 会显示“敏感权限”，但不触发人工审核。当前 scope：

| Scope | 用户可见含义 |
|---|---|
| `openid` | 稳定账户标识 |
| `profile` | 基本资料 |
| `email` | 电子邮箱和验证状态 |
| `forum.read` / `forum.write` | 读取论坛 / 创建或修改帖子与回复 |
| `resource.read` / `resource.download` / `resource.upload` | 浏览 / 下载 / 申请上传资源 |
| `notification.read` | 读取和标记通知 |
| `message.read` / `message.write` | 读取 / 发送私信 |

邮箱 scope 是可选兼容项。用户首次通过 Public Client 使用 MDTBBS 时只需授权 `profile`，无需同时授权 `email`。

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

用户也可以在 `{issuer}/authorizations` 撤销应用授权；撤销会清除该授权的 refresh token 和 access token。开发者删除应用会将其软删除、清除授权并撤销令牌；MindFourm 对 introspection 缓存最长保留 30 秒。

## 社区应用与授权

- `{issuer}/apps` 是无需登录的社区应用目录；`{issuer}/apps/{client_id}` 展示简介、开发者、权限和授权人数。停用或删除的应用只返回“当前不可用”。
- `{issuer}/authorize` 的同意页展示应用类型、开发者、主页、中文权限说明和新增权限；技术参数收在“应用详情”中。
- Device Flow 的 `verification_uri` 指向 `{issuer}/device`。用户登录后可输入用户码、查看应用与权限并允许或拒绝。
- 论坛的 API 说明继续由 MindFourm API Docs 提供。

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
