# OAuth接入体验优化设计

日期：2026-05-15

## 目标

优化第三方应用接入MindAuth OAuth的体验：
1. 提供清晰的接入文档页面
2. 标准化错误响应格式

## 方案

采用独立静态页面方案，不整合到SPA中。

### 1. 接入文档页面

**文件：** `public/docs.html`

**内容：**
- OAuth 2.0 基础流程说明
- 端点列表与参数表格
  - `/authorize` (GET) - 授权端点
  - `/token` (POST) - Token交换
  - `/refresh` (POST) - Token刷新
  - `/verify` (POST) - Session验证
- 示例代码
  - JavaScript (fetch)
  - Python (requests)
- 返回数据格式说明

**样式：** 复用 `public/style.css`，保持与系统风格统一，支持黑白主题切换

### 2. 标准化错误码

**修改文件：** `src/routes/oauth.js`

**错误格式（RFC6749）：**
```json
{
  "error": "invalid_request",
  "error_description": "缺少必需参数 redirect_uri"
}
```

**错误码定义：**

| 错误码 | 说明 | HTTP状态 |
|--------|------|----------|
| `invalid_request` | 缺少必需参数或参数格式错误 | 400 |
| `unauthorized_client` | client_id 无效或未注册 | 401 |
| `invalid_client` | client_secret 验证失败 | 401 |
| `invalid_grant` | 授权码无效、过期或已使用 | 401 |
| `access_denied` | 用户拒绝授权（预留） | 403 |

**修改端点：**
- `/authorize` - 参数校验错误
- `/token` - client验证、code验证错误
- `/refresh` - token验证错误

### 3. UI错误页面

**文件：** `public/oauth-error.html`

**触发场景：**
- 用户通过浏览器访问 `/authorize` 时遇到错误
- client_id 无效
- redirect_uri 不匹配
- 其他授权流程错误

**页面内容：**
- 错误图标
- 错误标题
- 错误描述（从URL参数获取）
- 返回按钮

**实现方式：**
- 修改 `/authorize` 端点，错误时重定向到 `/oauth-error.html?error=xxx&description=xxx`
- 页面解析URL参数显示错误

**样式：** 复用 `style.css`，支持黑白主题

## 文件变更

| 文件 | 操作 |
|------|------|
| `public/docs.html` | 新建 |
| `public/oauth-error.html` | 新建 |
| `src/routes/oauth.js` | 修改错误响应格式 |

## 不涉及

- 授权确认页面（明确不做）
- PKCE支持
- JWT Token格式
- OpenID Connect