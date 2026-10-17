# MDTBBS Public Client OAuth + PKCE

本指南适用于 Android、桌面程序、游戏 Mod、浏览器原生应用和第三方启动器。所有应用使用同一套 MindAuth Authorization Code 流程；应用名不会获得额外权限。Web 服务端可以继续使用 Confidential Client，公开二进制和浏览器代码必须使用 Public Client。

服务端上线前需应用 migration `024_forum_access_scope_capacity.sql`，以存储完整论坛组的兼容 scope；现有授权内容不变。

## 自助创建

登录并完成手机号验证后，打开 `{issuer}/developer`：

1. 创建 Public Client，填写名称、必填简介、可选主页、一个或多个 Redirect URI，以及一个「接入论坛功能」选项。
2. 创建成功后立即获得 `client_id`，应用状态为 `pending`，管理员审核通过后启用。应用数量不限；创建接口按 IP 限流。
3. Public Client 的 `client_secret` 为 `NULL`，必须使用 Authorization Code + PKCE S256。管理员仍可管理 confidential client、停用或删除恶意应用。

注册页面：`{issuer}/register`。密码、验证码、邮件和风控始终在 MindAuth 网站处理。

## Redirect URI 规则

- 面向公网的 Web callback 使用 HTTPS；内网服务或本机开发回调可使用 HTTP。URI 必须完全匹配注册值。
- 原生应用可登记自定义 scheme，例如 `com.example.launcher:/oauth2redirect`；必须用应用专属 scheme，不要使用 `http`、`https`、`javascript`、`file`、`intent` 等保留协议。
- 桌面 loopback 可登记 `http://127.0.0.1:0/oauth/callback`、`http://[::1]:0/oauth/callback` 或 `http://localhost:0/oauth/callback`。运行时绑定随机端口后，request URI 必须保持同一主机、path 和 query。其他 LAN/私网回调也可登记；它们必须与请求中的 URI 完全一致，只有 loopback 注册端口 `0` 支持运行时随机端口匹配。
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
  &scope=openid%20profile%20forum
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

应用接入只有两档：默认 `openid profile`，仅登录和读取基本账户资料；选中「接入论坛功能」并获批后可请求 `openid profile forum`，统一使用论坛、资源、私信、云存档与联机功能。无需逐项申请或审批。`forum_access` 是申请/管理 API 的布尔选项，`forum` 是授权请求中的 scope。

授权页只展示应用身份和一段范围说明，允许或取消即可；旧应用显式请求 `email` 时仍告知邮箱访问。`forum` 会在令牌中包含原有细分 scope，兼容既有资源服务器。旧的局部授权和 refresh token 不自动升级；应用采用完整论坛范围后，用户需重新同意。未申请论坛功能的应用请求任何论坛 scope 都会失败。更改接入范围会撤销已有授权和令牌。

以下细分名称仅用于旧客户端和接口契约兼容，新应用直接使用 `forum`：

| Scope | 用户可见含义 |
|---|---|
| `forum` | 全部公开论坛功能，仍受用户业务权限与站点策略约束 |
| `openid` | 稳定账户标识 |
| `profile` | 基本资料 |
| `email` | 电子邮箱和验证状态 |
| `forum.read` / `forum.write` | 读取论坛 / 创建或修改帖子与回复 |
| `resource.read` / `resource.download` / `resource.upload` | 浏览 / 下载 / 申请上传资源 |
| `notification.read` | 读取和标记通知 |
| `message.read` / `message.write` | 读取 / 发送私信 |
| `friends.read` / `presence.read` / `presence.write` | 查看好友和在线状态 / 更新在线状态 |
| `multiplayer.read` / `multiplayer.write` | 查看联机会话 / 使用联机功能 |
| `game_content.saves.read` | 读取游戏云存档 |
| `game_content.saves.write` | 创建或更新游戏云存档 |
| `game_content.saves.delete` | 删除游戏云存档 |

Cloud Saves 已包含在论坛功能选项中，无需单独申请。`/api/native/*` 是独立的官方登录路径：它不接受用户选择 scope；新 Native 登录会带上固定的三个 Cloud Saves scope，已有会话刷新时继续使用 refresh token 中存储的旧 scope。

邮箱 scope 是可选兼容项。仅登录应用默认不读取邮箱；调用 MDTBBS API 需要论坛范围及 `profile`，无需同时授权 `email`。

论坛仍会检查用户状态、手机号、条款、版块权限、审核队列、封禁、站点开关和资源策略。OAuth scope 不是业务权限绕过。

## Refresh / revoke

Access token 一小时有效；refresh token 轮换并检测重放。新客户端通过标准路径刷新：

```http
POST {issuer}/api/token
Content-Type: application/json
Idempotency-Key: 4d633f08-cc7e-4cb2-9e76-3b7767989ff8

{"grant_type":"refresh_token","client_id":"PUBLIC_CLIENT_ID","refresh_token":"CURRENT_REFRESH_TOKEN"}
```

### 跨启动保持登录

若产品希望用户不必每次打开应用都登录，应持久保存 refresh token，并在应用启动时先静默刷新，再调用需要登录的 API。短期 access token 留在内存中即可。优先使用操作系统提供的凭据存储；如果目标平台没有可用凭据库，只能保存到应用私有的本地数据中，并限制文件访问权限。不得把 token 写入日志、普通诊断信息或可同步的公开配置。

MindAuth 每次刷新都会同时返回新的 access token 和 refresh token，并立即废止旧 refresh token。`Idempotency-Key` 可选，但建议客户端串行刷新，并在发送请求前为这次尝试生成并持久保存唯一 key；成功后原子保存新 refresh token，再清除待处理的 key。若超时或收到服务端错误，结果可能未知：10 分钟内使用**原 refresh token 和同一个 key**重试，不要生成新 key，服务端会恢复同一组令牌，`expires_in` 会更新为 access token 的剩余寿命。不带 key 的旧客户端仍按单次轮换工作，但不能恢复超时前的结果，重放旧令牌会触发原有撤销策略。格式错误的非空 key 会返回 `400 invalid_request`，不会消费 refresh token。用户退出或收到 `invalid_grant` 时清除本地凭据。Refresh token 默认 30 天过期，成功刷新会续期。

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
  scope: 'openid profile forum', state,
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

MindAuth migration `022_expand_official_lanlink_mod_scopes.sql` expands the approved `lanlink-mindustry-mod` public client for the integrated Mindustry Mod. It retains the dynamic loopback callback `http://127.0.0.1:0/oauth/callback` and adds the forum, resource, notification, friends, presence, and multiplayer scopes used by the Mod. The Mod binds an ephemeral port on `127.0.0.1`, opens the system browser, validates the one-time `state`, and exchanges the code with PKCE S256. The client has no secret. The shared client ID also lets LanLink exchange the short-lived MindAuth bearer for its own short-lived control-plane session. Apply the migration before distributing a Mod build that uses this login flow.

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
  .appendQueryParameter("scope", "openid profile forum")
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
