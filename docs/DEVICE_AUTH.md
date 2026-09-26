# Device Authorization Flow (RFC 8628) — 内部实现参考

> RFC 8628 Device Flow 保持可用。验证与授权界面由 React `/device` 页面提供，接口路径如下；MindAuth API 请求体使用 JSON。注册应用和可用 scopes 见 [Public Client PKCE 指南](public-client-pkce.md)。

MindAuth 实现了 OAuth 2.0 设备授权流程，允许无浏览器或输入受限的设备（如 Mindustry Mod、CLI 工具、智能电视）通过用户在另一个设备上授权来获取访问令牌。

## 流程概览

```
┌─────────────┐                              ┌──────────────┐
│   Device    │                              │   Browser    │
│  (Mod/CLI)  │                              │  (User)      │
└──────┬──────┘                              └──────┬───────┘
       │                                            │
       │  1. POST /api/device/code                  │
       │  { client_id, scope }                      │
       │ ─────────────────────────────────────────> │
       │                                            │
       │  2. { device_code, user_code,              │
       │      verification_uri, expires_in }        │
       │ <───────────────────────────────────────── │
       │                                            │
       │  3. 显示 user_code 给用户                  │
       │  "请访问 https://... 并输入: LL-XXXX-XXXX" │
       │                                            │
       │                          4. 用户访问 URL   │
       │                                            │
       │                          5. 用户登录并授权 │
       │                                            │
       │  6. POST /api/device/token (轮询)          │
       │  { client_id, device_code, grant_type }    │
       │ ─────────────────────────────────────────> │
       │                                            │
       │  7a. { error: "authorization_pending" }    │
       │  7b. { access_token, refresh_token, ... }  │
       │ <───────────────────────────────────────── │
       │                                            │
```

## 端点

### 1. 请求设备码

**POST** `/api/device/code`

**请求参数** (application/x-www-form-urlencoded 或 JSON):
- `client_id` (必需) — 客户端标识符
- `scope` (可选) — 请求的权限范围，空格分隔（默认: `openid profile email`）

**响应** (200 OK):
```json
{
  "device_code": "a1b2c3d4e5f6...（64位十六进制）",
  "user_code": "LL-ABCD-1234",
  "verification_uri": "https://auth.mdtbbs.cn/device",
  "verification_uri_complete": "https://auth.mdtbbs.cn/device?user_code=LL-ABCD-1234",
  "expires_in": 900,
  "interval": 5
}
```

**字段说明**:
- `device_code` — 设备码，客户端在轮询时使用
- `user_code` — 用户码，显示给用户输入
- `verification_uri` — 用户需要访问的验证 URL
- `verification_uri_complete` — 预填充了 user_code 的完整 URL（可选显示）
- `expires_in` — 设备码有效期（秒）
- `interval` — 客户端轮询间隔（秒）

**限流**: 每 IP 30 次/分钟

### 2. 用户验证页面

**GET** `/device?user_code=LL-XXXX-XXXX`

用户访问 React 验证页。未登录时会先进入 MindAuth 登录页，再返回设备授权。

**页面内容**:
- 显示用户码
- 显示客户端名称
- 显示请求的权限范围
- 提供"授权"和"拒绝"按钮

**错误情况**:
- 用户未登录 → 重定向到登录页
- user_code 无效或过期 → 显示错误页面

### 3. 用户授权/拒绝

**GET** `/api/device/info?user_code=LL-XXXX-XXXX`

需要已登录 session。返回应用名称、类型和中文 scope 描述，供 React 页面展示。

### 3. 用户授权/拒绝

**POST** `/api/device/approve`

**请求参数** (JSON):
- `user_code` (必需) — 用户码
- `action` (必需) — `approve` 或 `deny`

**响应**: JSON 操作结果

**限流**: 每 IP 30 次/分钟

### 4. 轮询令牌

**POST** `/api/device/token`

**请求参数** (application/x-www-form-urlencoded 或 JSON):
- `client_id` (必需) — 客户端标识符
- `device_code` (必需) — 设备码
- `grant_type` (必需) — 必须是 `urn:ietf:params:oauth:grant-type:device_code`

**成功响应** (200 OK):
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "refresh_token": "abc123...",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

**错误响应** (400 Bad Request):

等待用户授权:
```json
{
  "error": "authorization_pending",
  "error_description": "等待用户授权"
}
```

设备码过期:
```json
{
  "error": "expired_token",
  "error_description": "设备码已过期"
}
```

用户拒绝:
```json
{
  "error": "access_denied",
  "error_description": "用户拒绝授权"
}
```

客户端不匹配:
```json
{
  "error": "invalid_grant",
  "error_description": "设备码与 client_id 不匹配"
}
```

**限流**: 每 IP 60 次/分钟

## 客户端集成示例

### Mindustry Mod (Java)

```java
public class DeviceAuthClient {
    private static final String BASE_URL = "https://auth.example.com";
    private static final String CLIENT_ID = "your_client_id";

    public OAuthToken authenticate() throws Exception {
        // 1. 请求设备码
        HttpResponse<String> response = post(BASE_URL + "/api/device/code",
            Map.of("client_id", CLIENT_ID, "scope", "openid profile"));

        JsonObject json = Json.parse(response.body()).asObject();
        String deviceCode = json.getString("device_code");
        String userCode = json.getString("user_code");
        String verificationUri = json.getString("verification_uri");
        int interval = json.getInt("interval", 5);
        int expiresIn = json.getInt("expires_in", 900);

        // 2. 显示给用户
        System.out.println("请访问: " + verificationUri);
        System.out.println("输入用户码: " + userCode);

        // 3. 轮询令牌
        long deadline = System.currentTimeMillis() + (expiresIn * 1000);
        while (System.currentTimeMillis() < deadline) {
            Thread.sleep(interval * 1000L);

            try {
                HttpResponse<String> tokenResponse = post(
                    BASE_URL + "/api/device/token",
                    Map.of(
                        "client_id", CLIENT_ID,
                        "device_code", deviceCode,
                        "grant_type", "urn:ietf:params:oauth:grant-type:device_code"
                    )
                );

                JsonObject tokenJson = Json.parse(tokenResponse.body()).asObject();

                if (tokenJson.containsKey("access_token")) {
                    // 成功！
                    return new OAuthToken(
                        tokenJson.getString("access_token"),
                        tokenJson.getString("refresh_token"),
                        tokenJson.getInt("expires_in", 3600)
                    );
                }

                String error = tokenJson.getString("error");
                if ("authorization_pending".equals(error)) {
                    // 继续轮询
                    continue;
                } else if ("slow_down".equals(error)) {
                    // 增加轮询间隔
                    interval += 5;
                    continue;
                } else {
                    // 其他错误（expired_token, access_denied）
                    throw new RuntimeException("授权失败: " + error);
                }
            } catch (InterruptedException e) {
                throw e;
            } catch (Exception e) {
                // 网络错误，继续重试
                continue;
            }
        }

        throw new RuntimeException("授权超时");
    }

    private HttpResponse<String> post(String url, Map<String, String> params) throws Exception {
        // HTTP POST 实现
        // ...
    }
}
```

### Node.js

```javascript
const axios = require('axios');

const BASE_URL = 'https://auth.example.com';
const CLIENT_ID = 'your_client_id';

async function authenticate() {
  // 1. 请求设备码
  const { data } = await axios.post(`${BASE_URL}/api/device/code`, {
    client_id: CLIENT_ID,
    scope: 'openid profile',
  });

  console.log(`请访问: ${data.verification_uri}`);
  console.log(`输入用户码: ${data.user_code}`);

  // 2. 轮询令牌
  const deadline = Date.now() + (data.expires_in * 1000);
  while (Date.now() < deadline) {
    await sleep(data.interval * 1000);

    try {
      const tokenRes = await axios.post(`${BASE_URL}/api/device/token`, {
        client_id: CLIENT_ID,
        device_code: data.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      // 成功
      return {
        accessToken: tokenRes.data.access_token,
        refreshToken: tokenRes.data.refresh_token,
        expiresIn: tokenRes.data.expires_in,
      };
    } catch (err) {
      if (err.response?.status === 400) {
        const error = err.response.data.error;

        if (error === 'authorization_pending') {
          // 继续轮询
          continue;
        } else if (error === 'slow_down') {
          // 增加间隔
          data.interval += 5;
          continue;
        }
      }

      // 其他错误
      throw err;
    }
  }

  throw new Error('授权超时');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Python

```python
import requests
import time

BASE_URL = 'https://auth.example.com'
CLIENT_ID = 'your_client_id'

def authenticate():
    # 1. 请求设备码
    resp = requests.post(f'{BASE_URL}/api/device/code', data={
        'client_id': CLIENT_ID,
        'scope': 'openid profile',
    })
    data = resp.json()

    print(f"请访问: {data['verification_uri']}")
    print(f"输入用户码: {data['user_code']}")

    # 2. 轮询令牌
    deadline = time.time() + data['expires_in']
    interval = data['interval']

    while time.time() < deadline:
        time.sleep(interval)

        try:
            token_resp = requests.post(f'{BASE_URL}/api/device/token', data={
                'client_id': CLIENT_ID,
                'device_code': data['device_code'],
                'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
            })

            if token_resp.status_code == 200:
                # 成功
                token_data = token_resp.json()
                return {
                    'access_token': token_data['access_token'],
                    'refresh_token': token_data['refresh_token'],
                    'expires_in': token_data['expires_in'],
                }

            error = token_resp.json().get('error')

            if error == 'authorization_pending':
                # 继续轮询
                continue
            elif error == 'slow_down':
                # 增加间隔
                interval += 5
                continue
            else:
                # 其他错误
                raise Exception(f"授权失败: {error}")

        except requests.RequestException:
            # 网络错误，继续重试
            continue

    raise Exception('授权超时')
```

## 错误码表

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| `authorization_pending` | 400 | 用户尚未授权，客户端应继续轮询 |
| `slow_down` | 400 | 客户端轮询过快，应增加轮询间隔 |
| `expired_token` | 400 | 设备码已过期或被使用 |
| `access_denied` | 400 | 用户拒绝授权 |
| `invalid_grant` | 400 | 设备码与 client_id 不匹配 |
| `invalid_client` | 400/401 | 无效的 client_id |
| `invalid_scope` | 400 | 请求的 scope 无效 |
| `unsupported_grant_type` | 400 | grant_type 不正确 |
| `invalid_request` | 400 | 缺少必需参数 |

## 安全考虑

### 设备码存储
- 设备码和用户码映射存储在 Redis 中，TTL 为 15 分钟（可配置）
- 设备码是 32 字节随机 hex（64 字符），碰撞概率极低
- 用户码格式 `LL-XXXX-XXXX`，使用去除混淆字符的 32 字符集

### 重放攻击防护
- 设备码在成功换取令牌后立即删除
- 每次授权请求生成新的设备码和用户码
- 用户码到设备码的映射在授权完成或拒绝后删除

### 限流
- `/api/device/code` — 每 IP 30 次/分钟（防止大量生成）
- `/api/device/token` — 每 IP 60 次/分钟（允许正常轮询）
- `/api/device/approve` — 每 IP 30 次/分钟（防止滥用）

### 用户码格式
- 前缀 `LL-` 便于识别来源
- 字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 字符）
- 去除 `0`, `O`, `1`, `I` 防止视觉混淆
- 8 字符有效载荷，总熵约 40 bit（1 万亿种组合）
- 生成时检查唯一性，碰撞自动重试（最多 10 次）

## 配置

环境变量（在 MindAuth 服务器上设置）：

- `MINDAUTH_VERIFICATION_URI` — 验证页面的基础 URL（默认: `http://localhost:4001` 或 `BASE_URL`）
- `MINDAUTH_DEVICE_CODE_TTL_SECONDS` — 设备码有效期，秒（默认: 900 = 15 分钟）
- `MINDAUTH_DEVICE_POLL_INTERVAL_SECONDS` — 建议的轮询间隔，秒（默认: 5）

## 测试

运行单元测试：

```bash
cd /f/Project/MindProject/MindAuth
node --test tests/unit/device-auth.test.js
```

测试覆盖：
- 用户码格式和字符集
- 设备码生成和存储
- 授权/拒绝流程
- 令牌交换和状态转换
- 重放攻击防护
- 客户端 ID 验证
- Scope 验证

## 参考

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://tools.ietf.org/html/rfc8628)
- [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics)
