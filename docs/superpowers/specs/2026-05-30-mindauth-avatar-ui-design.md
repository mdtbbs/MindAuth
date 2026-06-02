# MindAuth UI 升级设计文档

**日期**: 2026-05-30
**状态**: 待实现

## 概述

本次升级包含两个主要功能：
1. **用户头像上传功能** - 支持头像和个人信息背景图上传，存储在 MindAuth 本地，可被其他项目（MindFourm、EasyManager）通过 API 调用
2. **UI 现代化升级** - 采用极简科技风格（Linear/Vercel 风格），轻量线框按钮，混合动画方案，支持黑白主题切换

## 需求汇总

| 需求项 | 用户选择 |
|--------|----------|
| 头像存储 | MindAuth 本地存储 |
| 按钮风格 | 轻量线框按钮（细边框 + 文字） |
| 动画方案 | 混合方案（首次入场动画 + 微妙交互动画） |
| 头像规格 | 方形圆形头像 (1:1) + 个人信息背景图 |
| 响应式 | 基础响应式（自适应布局） |
| 整体风格 | 极简科技风 (Linear/Vercel) |
| 主题支持 | 黑白主题切换 |

## 架构设计

### 头像功能架构

```
┌─────────────────────────────────────────────────────────────┐
│                      MindAuth                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ /uploads/   │  │ /uploads/   │  │  上传 API            │  │
│  │ avatars/    │  │ banners/    │  │  POST /api/avatar    │  │
│  │ (1:1 头像)  │  │ (横向背景)  │  │  POST /api/banner    │  │
│  └─────────────┘  └─────────────┘  │  DELETE /api/avatar  │  │
│                                    │  DELETE /api/banner  │  │
│                                    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database (users)                          │
│  avatar_url: string | null    (头像 URL)                    │
│  banner_url: string | null    (背景图 URL)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    其他项目调用                               │
│  GET /api/user/:id → 返回 avatar_url, banner_url            │
│  GET /api/me → 返回当前用户头像信息                          │
│                                                              │
│  MindFourm ──→ 显示用户头像                                  │
│  EasyManager ──→ 显示用户头像                                │
└─────────────────────────────────────────────────────────────┘
```

### 头像存储方案

**存储路径**：
- 头像：`public/uploads/avatars/{user_id}_{timestamp}.{ext}`
- 背景：`public/uploads/banners/{user_id}_{timestamp}.{ext}`

**文件命名规则**：
- 使用 `{user_id}_{timestamp}` 确保唯一性
- 支持 jpg, png, gif, webp 格式
- 头像限制 2MB，背景限制 5MB

**API 设计**：
```
POST /api/avatar
  - Body: multipart/form-data (file)
  - Response: { success, avatar_url }

DELETE /api/avatar
  - Response: { success }

POST /api/banner
  - Body: multipart/form-data (file)
  - Response: { success, banner_url }

DELETE /api/banner
  - Response: { success }
```

### 数据库修改

**users 表新增字段**：
```sql
ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN banner_url TEXT DEFAULT NULL;
```

## UI 设计规范

### 按钮风格

**轻量线框按钮** - 无渐变、无阴影、细边框

```css
/* Primary Button */
.btn-outline-primary {
  background: transparent;
  border: 1px solid var(--btn-border-primary);
  color: var(--primary);
  padding: 6px 14px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-outline-primary:hover {
  background: var(--primary);
  color: #fff;
}

/* Secondary Button */
.btn-outline-secondary {
  background: transparent;
  border: 1px solid var(--btn-border);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-outline-secondary:hover {
  border-color: var(--text-muted);
  color: var(--text);
}
```

### 主题变量

```css
/* Light Theme */
[data-theme="light"] {
  --btn-border-primary: rgba(255,107,53,0.3);
  --btn-border: #e5e5e5;
  --card-bg: #fff;
  --card-border: #e5e5e5;
  --input-bg: #fff;
  --input-border: #e5e5e5;
}

/* Dark Theme */
[data-theme="dark"] {
  --btn-border-primary: rgba(255,107,53,0.3);
  --btn-border: rgba(255,255,255,0.15);
  --card-bg: rgba(255,255,255,0.05);
  --card-border: rgba(255,255,255,0.1);
  --input-bg: rgba(255,255,255,0.05);
  --input-border: rgba(255,255,255,0.1);
}
```

### 动画方案

**混合方案**：首次进入有入场动画，后续操作使用微妙动画

```css
/* 入场动画 - 仅首次加载 */
.animate-enter {
  animation: fade-in-up 0.4s ease-out forwards;
  opacity: 0;
}

@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 微妙交互动画 */
.btn-outline {
  transition: all 0.15s ease;
}

.btn-outline:hover {
  transform: translateY(-1px);
}

.card {
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.card:hover {
  border-color: var(--primary);
}
```

### 头像组件设计

**Profile Header 组件**：
- 个人信息背景图（横向 banner，约 3:1 比例）
- 圆形头像（1:1，直径 70-80px）
- 头像位于背景图下方，左对齐
- 更换按钮在头像右下角（相机图标）

**头像上传交互**：
1. 点击头像 → 弹出文件选择器
2. 选择图片 → 本地预览
3. 确认上传 → 显示加载状态
4. 上传成功 → 更新显示
5. 上传失败 → 显示错误提示

## 实现范围

### 需要修改的文件

**后端**：
1. `src/routes/account.js` - 新增头像/背景上传 API
2. `src/db/index.js` - 数据库 schema 添加 avatar_url, banner_url 字段
3. 新增 `src/middleware/upload.js` - 文件上传处理（multer）

**前端**：
1. `public/app.js` - 更新 Dashboard/Settings 视图，添加头像上传组件
2. `public/style.css` - 更新按钮风格、主题变量、动画类
3. `public/index.html` - 添加上传文件需要的组件结构

**测试**：
1. `tests/specs/auth/auth.spec.js` - 新增头像上传测试

### 不需要修改的文件

- `shared-styles/variables.css` - 已有主题变量，无需大改
- `shared-styles/components.css` - 可复用现有组件基础样式
- 其他项目前端 - 仅需调用 API，无需改动

## 验证标准

1. 头像上传功能正常工作（上传、删除、显示）
2. 背景图上传功能正常工作
3. 按钮风格统一（轻量线框，无渐变无阴影）
4. 黑白主题切换正常
5. 入场动画只在首次加载时触发
6. 微妙 hover 动画流畅
7. 响应式适配（手机、桌面端显示正常）
8. 其他项目可通过 API 获取头像 URL
9. Playwright 测试全部通过

## 文件上传安全考虑

1. 文件类型验证 - 仅允许 jpg, png, gif, webp
2. 文件大小限制 - 头像 2MB, 背景 5MB
3. 文件名处理 - 使用 timestamp 避免冲突
4. 存储路径 - 使用 public/uploads/ 目录，可被静态访问
5. CSRF 保护 - 上传请求需要 CSRF token

## 下一步

调用 `writing-plans` skill 创建详细的实现计划。