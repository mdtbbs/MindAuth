# Device Authorization Flow Implementation Summary

## 完成状态
✅ 所有功能已实现并通过测试

## 实现内容

### 1. Redis 存储层 (`src/modules/oauth/tokenStore.js`)
新增了 7 个函数用于设备码存储：
- `storeDeviceCode(deviceCode, data, ttlSeconds)` - 存储设备码
- `getDeviceCode(deviceCode)` - 查询设备码
- `updateDeviceCode(deviceCode, data, ttlSeconds)` - 更新设备码状态
- `deleteDeviceCode(deviceCode)` - 删除设备码
- `storeUserCode(userCode, deviceCode, ttlSeconds)` - 存储用户码映射
- `getDeviceCodeByUserCode(userCode)` - 通过用户码查询设备码
- `deleteUserCode(userCode)` - 删除用户码映射

### 2. 业务逻辑层 (`src/modules/oauth/oauthIssuer.js`)
新增了 5 个函数和配置：

**配置常量**：
- `DEVICE_CODE_TTL_S` - 设备码有效期（默认 900 秒）
- `DEVICE_POLL_INTERVAL_S` - 轮询间隔（默认 5 秒）
- `VERIFICATION_URI` - 验证页面 URI
- `USER_CODE_CHARSET` - 用户码字符集（去除 0, O, 1, I）
- `USER_CODE_MAX_RETRIES` - 碰撞重试次数（10 次）

**业务函数**：
- `generateUserCode()` - 生成 LL-XXXX-XXXX 格式的用户码
- `issueDeviceCode({ clientId, scope })` - 签发设备码和用户码
- `getDeviceCodeByUserCode({ userCode })` - 查询设备码信息
- `approveDeviceCode({ userCode, userId })` - 批准授权
- `denyDeviceCode({ userCode })` - 拒绝授权
- `exchangeDeviceToken({ clientId, deviceCode })` - 换取令牌

### 3. 路由层 (`src/routes/oauth.js`)
新增了 4 个端点和 3 个限流器：

**端点**：
1. `POST /api/oauth/device/code` - 请求设备码
2. `GET /api/oauth/device/verify` - 用户验证页面（需登录）
3. `POST /api/oauth/device/approve` - 批准/拒绝授权（需登录）
4. `POST /api/oauth/device/token` - 轮询换取令牌

**限流器**：
- `deviceCodeLimiter` - 每 IP 30 次/分钟
- `deviceTokenLimiter` - 每 IP 60 次/分钟
- `deviceApproveLimiter` - 每 IP 30 次/分钟

### 4. 测试 (`tests/unit/device-auth.test.js`)
新增了 21 个测试用例，覆盖：
- ✅ 用户码格式和字符集验证
- ✅ 设备码生成和存储
- ✅ 授权/拒绝流程
- ✅ 令牌交换和状态转换
- ✅ 重放攻击防护
- ✅ 客户端 ID 验证
- ✅ Scope 验证
- ✅ 错误处理

### 5. 文档 (`docs/DEVICE_AUTH.md`)
完整的实现文档，包含：
- 流程概览图
- 4 个端点的详细 API 文档
- Java/Node.js/Python 客户端集成示例
- 错误码表
- 安全考虑说明
- 配置说明
- 测试运行指南

## 测试结果
```
✔ 21 个新增测试全部通过
✔ 135 个现有单元测试全部通过（无回归）
✓ oauth.js 语法检查通过
✓ oauthIssuer.js 语法检查通过
```

## 关键设计决策

### 1. 用户码格式
- 格式：`LL-XXXX-XXXX`（12 字符）
- 字符集：`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 字符）
- 去除 `0, O, 1, I` 防止视觉混淆
- 熵：约 40 bit（1 万亿种组合）
- 碰撞重试：最多 10 次

### 2. 设备码格式
- 32 字节随机 hex（64 字符）
- 碰撞概率极低，无需检查唯一性

### 3. 公共客户端支持
- 设备令牌交换不要求 `client_secret`
- 使用 `lookupClient` 而非 `verifyClient`
- 适合 Mod、CLI 等无法安全存储密钥的客户端

### 4. 状态转换
```
创建 → pending (approved=false)
     ↓
用户批准 → approved (approved=true, user_id=设置)
用户拒绝 → 删除记录

轮询检查：
- 不存在 → expired_token
- approved=false → authorization_pending
- approved=true + user_id=null → access_denied
- approved=true + user_id=设置 → 签发令牌 → 删除记录
```

### 5. 安全防护
- 设备码单次使用（换取令牌后立即删除）
- 用户码映射同时删除
- Redis TTL 自动过期（15 分钟）
- 限流防止滥用
- 客户端 ID 严格验证

## 配置项

环境变量（可选）：
- `MINDAUTH_VERIFICATION_URI` - 验证页面 URL（默认: `BASE_URL` 或 `http://localhost:4001`）
- `MINDAUTH_DEVICE_CODE_TTL_SECONDS` - 设备码有效期（默认: 900）
- `MINDAUTH_DEVICE_POLL_INTERVAL_SECONDS` - 轮询间隔（默认: 5）

## 下一步

LanLink Mod 可以开始集成设备授权流：
1. 在 MindAuth 注册客户端（获取 `client_id`）
2. 在 Mod 中实现设备授权客户端（参考文档中的 Java 示例）
3. 替换现有的论坛识别码登录流程

## 文件清单

新增/修改的文件：
- ✅ `src/modules/oauth/tokenStore.js` - 新增 7 个函数
- ✅ `src/modules/oauth/oauthIssuer.js` - 新增 6 个函数 + 配置
- ✅ `src/routes/oauth.js` - 新增 4 个端点 + 3 个限流器
- ✅ `tests/unit/device-auth.test.js` - 新增 21 个测试
- ✅ `docs/DEVICE_AUTH.md` - 新增完整文档
