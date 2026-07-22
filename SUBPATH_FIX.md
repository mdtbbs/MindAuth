# 子路径部署问题修复说明

## 问题描述

当 MindAuth 部署在子路径下（如 `/oauth/`）时，浏览器无法正确加载静态资源。

### 错误示例

```
Refused to apply style from 'https://auth.mdtbbs.cn/oauth/style.css' 
because its MIME type ('text/html') is not a supported stylesheet MIME type

GET https://auth.mdtbbs.cn/oauth/js/main.js?v=2 net::ERR_ABORTED 500

Refused to execute script from 'https://auth.mdtbbs.cn/oauth/js/common.js?v=2' 
because its MIME type ('text/html') is not executable
```

## 根本原因

HTML 文件中使用了相对路径引用静态资源：

```html
<!-- 错误示例 -->
<link rel="stylesheet" href="style.css">
<script src="js/common.js"></script>
<script src="js/main.js"></script>
```

当用户访问 `https://auth.mdtbbs.cn/oauth/authorize` 时：
- 浏览器将相对路径解析为 `https://auth.mdtbbs.cn/oauth/style.css`
- 但实际资源位于 `https://auth.mdtbbs.cn/style.css`
- 反向代理（如 nginx）未配置 `/oauth/*` 的静态文件转发
- 导致 404 或返回 HTML 错误页面，引发 MIME 类型错误

## 解决方案

将所有相对路径改为绝对路径：

```html
<!-- 修复后 -->
<link rel="stylesheet" href="/style.css">
<script src="/js/common.js"></script>
<script src="/js/main.js"></script>
```

绝对路径以 `/` 开头，始终从域名根路径开始解析，不受当前 URL 路径影响。

## 修改的文件

1. **public/index.html**
   - `style.css` → `/style.css`
   - `js/common.js` → `/js/common.js`
   - `js/shared-loader.js` → `/js/shared-loader.js`
   - `js/main.js` → `/js/main.js`

2. **public/admin.html**
   - `style.css` → `/style.css`
   - `js/common.js` → `/js/common.js`
   - `js/admin.js` → `/js/admin.js`

3. **public/docs.html**
   - `style.css` → `/style.css`

4. **public/error.html**
   - `style.css` → `/style.css`

5. **public/oauth-error.html**
   - `style.css` → `/style.css`

## 验证

修复后，无论 MindAuth 部署在：
- 根路径：`https://auth.example.com/`
- 子路径：`https://auth.example.com/oauth/`
- 深层子路径：`https://example.com/auth/mind/`

所有静态资源都能正确加载，因为绝对路径始终指向域名根路径。

## 部署注意事项

如果使用反向代理（nginx、Apache 等）将 MindAuth 部署在子路径下：

### nginx 配置示例

```nginx
location /oauth/ {
    proxy_pass http://localhost:4001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 静态资源也需要代理
location /js/ {
    proxy_pass http://localhost:4001/js/;
}

location /style.css {
    proxy_pass http://localhost:4001/style.css;
}

location /shared-styles/ {
    proxy_pass http://localhost:4001/shared-styles/;
}
```

### 关键要点

1. **绝对路径**：HTML 中的资源路径必须以 `/` 开头
2. **代理配置**：确保反向代理正确转发所有静态资源路径
3. **缓存清理**：部署后清理浏览器缓存或增加版本号参数

## 提交信息

- **Commit**: `6e210b2`
- **日期**: 2026-07-21
- **说明**: fix: 使用绝对路径修复子路径部署问题
