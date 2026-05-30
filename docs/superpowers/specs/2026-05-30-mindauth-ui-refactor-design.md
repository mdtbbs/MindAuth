# MindAuth UI 重构设计文档

**日期**: 2026-05-30
**状态**: 待实现

## 概述

MindAuth 存在两个 UI 问题需要修复：
1. 登录页面 (#login) 显示白屏 - 动画未正确触发
2. Dashboard 页面布局错位 - 类名与 shared-styles 冲突

本设计文档描述如何通过统一使用 shared-styles 组件系统和 MagicUI 动画风格来解决这些问题。

## 问题分析

### 登录页面白屏问题

**根本原因**: 模板 HTML 中所有元素设置了 `opacity:0` 作为动画初始状态，但缺少正确的 CSS 动画触发。

```html
<!-- 模板中的初始状态 -->
<div class="login-brand" style="opacity:0; transform:translateX(-50px)">
<div class="login-form" style="opacity:0; transform:translateX(50px)">
<div class="login-brand-logo" style="opacity:0; transform:translateY(20px)">
```

元素保持在 `opacity:0` 状态，用户看到白屏。

### Dashboard 布局错位问题

**根本原因**: `.user-card` 类名与 shared-styles 中定义的样式冲突。

- MindAuth 定义: 全宽卡片容器，用于 PROFILE、STATUS 等区块
- shared-styles 定义: 固定宽度 140px 的用户头像卡片

这导致 Dashboard 卡片被错误地渲染为 140px 宽度的小卡片，布局错位。

## 设计方案

### 方案一：登录页面动画修复

**修改文件**: `public/style.css`

添加 CSS 动画让元素从初始状态过渡到可见状态：

```css
/* 入场动画 - 使用 forwards 保持最终状态 */
.login-split .login-brand {
  animation: login-brand-enter 0.6s ease-out forwards;
}

.login-split .login-form {
  animation: login-form-enter 0.6s ease-out forwards;
  animation-delay: 0.1s;
}

.login-split .login-brand-logo {
  animation: login-logo-enter 0.5s ease-out forwards;
  animation-delay: 0.2s;
}

.login-split .login-brand-desc {
  animation: login-desc-enter 0.5s ease-out forwards;
  animation-delay: 0.3s;
}

.login-split .login-form-title {
  animation: login-title-enter 0.4s ease-out forwards;
  animation-delay: 0.2s;
}

.login-split [data-form-content] {
  animation: login-content-enter 0.4s ease-out forwards;
  animation-delay: 0.3s;
}

/* 关键帧定义 */
@keyframes login-brand-enter {
  from { opacity: 0; transform: translateX(-50px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes login-form-enter {
  from { opacity: 0; transform: translateX(50px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes login-logo-enter {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes login-desc-enter {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes login-title-enter {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes login-content-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**动画时序**:
- 品牌区域 (左侧): 立即开始，0.6s
- 表单区域 (右侧): 0.1s 延迟，0.6s
- Logo/标题: 0.2s 延迟
- 内容区域: 0.3s 延迟

### 方案二：Dashboard 布局重构

**修改文件**: `public/app.js` (views.dashboard)

**类名映射**:
| 原类名 | 新类名 | 说明 |
|--------|--------|------|
| `.dashboard-container` | 移除，使用默认布局 | 不需要自定义容器 |
| `.dashboard-header` | `.admin-header` | 使用 shared-styles 定义 |
| `.dashboard-main` | `.admin-content` | 使用 shared-styles 定义 |
| `.user-card` (冲突) | `.card.card-lg` | 使用 shared-styles 卡片 |
| `.card-header` | `.card-header-title` | 自定义标题样式 |
| `.profile-avatar` | `.user-card-avatar` | 使用 shared-styles 头像 |
| `.profile-name` | `.user-card-name` | 使用 shared-styles 名字 |
| `.profile-email` | `.user-card-title` | 使用 shared-styles 副标题 |

**新 HTML 结构**:

```html
<div class="admin-content">
  <div class="admin-header">
    <div class="admin-title">账户</div>
    <button id="logout-btn" class="btn-secondary btn-sm">退出</button>
  </div>

  <!-- PROFILE 卡片 -->
  <div class="card card-lg animate-fade-in-up" style="animation-delay: 0s">
    <div class="card-header-title">PROFILE</div>
    <div class="profile-section">
      <div class="user-card-avatar" id="avatar-display">U</div>
      <div>
        <div class="user-card-name" id="username-display"></div>
        <div class="user-card-title" id="email-display"></div>
      </div>
    </div>
  </div>

  <!-- STATUS 卡片 -->
  <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.1s">
    <div class="card-header-title">STATUS</div>
    <div class="status-section">
      <div class="status-row">
        <span class="status-label">邮箱验证</span>
        <span id="verified-badge"></span>
      </div>
      <div class="status-row">
        <span class="status-label">注册时间</span>
        <span class="status-value" id="created-display"></span>
      </div>
    </div>
    <div id="verification-actions" class="action-row" style="display: none;">
      <button id="send-verify-btn" class="btn-outline">发送验证邮件</button>
    </div>
  </div>

  <!-- LOGIN HISTORY 卡片 -->
  <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.2s">
    <div class="card-header-title">LOGIN HISTORY</div>
    <div id="login-logs-container">
      <div class="empty-state">加载中...</div>
    </div>
  </div>

  <!-- AUTHORIZED APPS 卡片 -->
  <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.3s">
    <div class="card-header-title">AUTHORIZED APPS</div>
    <div id="authorizations-container">
      <div class="empty-state">加载中...</div>
    </div>
  </div>

  <!-- ACCOUNT 卡片 -->
  <div class="card card-lg animate-fade-in-up" style="animation-delay: 0.4s">
    <div class="card-header-title">ACCOUNT</div>
    <div class="action-row">
      <a href="#account-settings" class="btn-outline">账户设置</a>
    </div>
  </div>
</div>
```

### 方案三：MagicUI 动画效果

**修改文件**: `public/style.css`

添加入场动画和状态动画：

```css
/* 卡片入场动画 */
.animate-fade-in-up {
  animation: fade-in-up 0.4s ease-out forwards;
  opacity: 0;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 状态徽章脉冲 */
.badge-pulse {
  animation: badge-soft-pulse 2s ease-in-out infinite;
}

@keyframes badge-soft-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* 按钮微光效果 */
.btn-shimmer {
  background: linear-gradient(
    90deg,
    var(--primary) 0%,
    var(--primary-light) 50%,
    var(--primary) 100%
  );
  background-size: 200% 100%;
  animation: shimmer-slide 2s ease-in-out infinite;
}

@keyframes shimmer-slide {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## 实现范围

### 需要修改的文件

1. `public/app.js`
   - 重构 `views.dashboard` HTML 结构
   - 重构 `views.accountSettings` HTML 结构（可选）
   - 使用 shared-styles 类名

2. `public/style.css`
   - 删除冲突的自定义样式（`.user-card` 等）
   - 添加登录页面入场动画
   - 添加 Dashboard 卡片入场动画
   - 添加 MagicUI 动画效果类

### 不需要修改的文件

- `shared-styles/` 目录 - 已有样式足够使用
- 后端代码 - 无需修改
- 测试文件 - 可能在重构后需要更新选择器

## 验证标准

1. 登录页面 `http://localhost:4001/#login` 正常显示，有入场动画
2. Dashboard 页面 `http://localhost:4001/#dashboard` 布局正确，卡片全宽显示
3. 深色模式切换正常工作
4. 卡片依次入场动画效果
5. Playwright 测试全部通过

## 风险和注意事项

1. **类名变更**: 需要同时更新 JavaScript 中操作 DOM 的选择器
2. **测试兼容**: 现有测试可能依赖旧的类名选择器，需要检查
3. **向后兼容**: accountSettings 页面也需要同步重构以保持一致

## 下一步

调用 `writing-plans` skill 创建详细的实现计划。