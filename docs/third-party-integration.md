# 第三方系统接入文档

## 概述

用户中心提供单点登录（SSO）服务，支持第三方系统接入。用户在用户中心登录后，访问第三方系统时可实现无感登录。

---

## 1. 注册应用

联系管理员在 `http://your-auth-server/admin.html` 创建应用，获取：

| 参数 | 说明 |
|------|------|
| `client_id` | 应用标识，公开可见 |
| `client_secret` | 应用密钥，**仅后端使用，禁止前端暴露** |
| `redirect_uri` | 回调地址，需严格匹配 |

---

## 2. API 接口

### 2.1 授权端点

用户未登录时，跳转到此端点：

```
GET /api/authorize?redirect_uri={redirect_uri}&client_id={client_id}
```

**参数：**
| 参数 | 必填 | 说明 |
|------|------|------|
| `redirect_uri` | 是 | 注册时配置的回调地址 |
| `client_id` | 是 | 应用标识 |

**响应：**
- 用户已登录：重定向到 `redirect_uri?code={code}`
- 用户未登录：重定向到登录页面，登录成功后自动跳回

---

### 2.2 Token 端点

第三方后端用 code 换取用户信息：

```
POST /api/token
Content-Type: application/json

{
  "code": "授权码",
  "client_id": "应用标识",
  "client_secret": "应用密钥"
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
    "created_at": "注册时间"
  }
}
```

**响应失败：**
```json
{
  "success": false,
  "message": "错误信息"
}
```

**错误码：**
| message | 说明 |
|---------|------|
| 缺少参数 | code/client_id/client_secret 未提供 |
| 无效的 client_id 或 client_secret | 应用未注册或密钥错误 |
| 无效或已使用的 code | code 过期、已使用或不存在 |

---

### 2.3 Session 验证端点（同域场景）

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
    "created_at": "注册时间"
  }
}
```

---

## 3. 接入示例

### 3.1 前端跳转

```javascript
// 检测用户未登录时，跳转到认证中心
const authServer = 'http://your-auth-server';
const clientId = 'YOUR_CLIENT_ID';
const redirectUri = 'http://your-app/callback';

window.location.href = `${authServer}/api/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}`;
```

### 3.2 后端处理回调（Node.js Express）

```javascript
// 回调路由处理
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('缺少授权码');
  }

  // 调用认证中心换取用户信息
  const response = await fetch('http://your-auth-server/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: 'YOUR_CLIENT_ID',
      client_secret: 'YOUR_CLIENT_SECRET' // 从环境变量读取
    })
  });

  const result = await response.json();

  if (result.success) {
    // 用户信息
    const user = result.user;
    // { id, username, email, created_at }

    // 创建本地会话
    req.session.user = user;
    res.redirect('/dashboard');
  } else {
    res.status(401).send(result.message);
  }
});
```

### 3.3 后端处理回调（Python Flask）

```python
from flask import Flask, request, redirect, session
import requests

app = Flask(__name__)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    if not code:
        return '缺少授权码', 400

    # 调用认证中心换取用户信息
    response = requests.post('http://your-auth-server/api/token', json={
        'code': code,
        'client_id': 'YOUR_CLIENT_ID',
        'client_secret': 'YOUR_CLIENT_SECRET'
    })

    result = response.json()

    if result.get('success'):
        user = result['user']
        session['user'] = user
        return redirect('/dashboard')
    else:
        return result.get('message'), 401
```

### 3.4 同域场景（前端直接调用）

```javascript
// 从 Cookie 获取 session token（同域情况下 Cookie 共享）
const sessionToken = getCookie('session'); // 需自己实现获取 cookie

// 验证并获取用户信息
async function getUserInfo() {
  const response = await fetch('http://your-auth-server/api/verify', {
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

## 4. 接入流程图

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   用户      │    │  第三方系统  │    │  用户中心   │
└─────────────┘    └─────────────┘    └─────────────┘
       │                 │                   │
       │  1.访问第三方   │                   │
       │────────────────>│                   │
       │                 │                   │
       │                 │ 2.检测未登录      │
       │                 │ 跳转 /authorize  │
       │                 │──────────────────>│
       │                 │                   │
       │                 │                   │ 3.检查登录状态
       │                 │                   │    已登录→生成code
       │                 │                   │    未登录→显示登录页
       │                 │                   │
       │  4.如未登录     │                   │
       │    用户登录     │                   │
       │────────────────────────────────────>│
       │                 │                   │
       │                 │ 5.重定向回调      │
       │                 │   带 code 参数    │
       │                 │<──────────────────│
       │                 │                   │
       │                 │ 6.后端用 code     │
       │                 │   换取用户信息    │
       │                 │──────────────────>│
       │                 │                   │
       │                 │ 7.返回用户信息    │
       │                 │<──────────────────│
       │                 │                   │
       │  8.登录成功     │                   │
       │<────────────────│                   │
       │                 │                   │
```

---

## 5. 安全注意事项

| 项目 | 说明 |
|------|------|
| **client_secret** | 仅在第三方后端使用，**禁止暴露给前端** |
| **code 有效期** | 5分钟，一次性使用，用后即失效 |
| **redirect_uri** | 必须与注册时配置的完全匹配 |
| **HTTPS** | 生产环境必须使用 HTTPS |
| **state 参数** | 建议添加 state 参数防止 CSRF（待实现） |

---

## 6. 测试示例

### 测试用例

```bash
# 1. 登录用户
curl -X POST http://localhost:4001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}' \
  -c cookies.txt

# 2. 获取授权码
curl -L -b cookies.txt \
  "http://localhost:4001/api/authorize?redirect_uri=http://localhost:4001/callback&client_id=YOUR_CLIENT_ID"

# 3. 用 code 换取用户信息
curl -X POST http://localhost:4001/api/token \
  -H "Content-Type: application/json" \
  -d '{"code":"获得的code","client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET"}'
```

---

## 7. 常见问题

**Q: code 可以重复使用吗？**
A: 不可以，code 只能使用一次，使用后立即失效。

**Q: code 有效期多久？**
A: 5分钟，超后无法使用。

**Q: 同域和跨域有什么区别？**
A:
- 同域：可直接通过 Cookie 共享 session，调用 `/api/verify`
- 跨域：必须通过 OAuth 流程，使用 code 换取用户信息

**Q: 如何处理用户退出登录？**
A: 第三方系统需自行处理本地会话清理，用户中心的退出不会自动通知第三方。

---

## 8. 联系方式

如有问题请联系管理员。