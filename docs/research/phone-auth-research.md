# 手机号注册/登录调研

> 状态：调研结论，供决策参考，**不代表现行实现契约**。实现时以届时更新后的 `docs/api/*` 与迁移文件为准。
> 日期：2026-10-12 ｜ 范围：MindAuth 本体 + 论坛（MindFourm / Mindustry Club）+ 第三方 OAuth 应用 + 官方客户端（Android / Mindustry Mod / LanLink）+ 下载站

## 0. 结论摘要

一句话：**MindAuth 现在没有面向 Web 的手机号注册/登录。** 手机号只作为"登录之后可选绑定"的存在，而全生态真正依赖的是"这个账号手机号已验证"这一个布尔旗标。

现状可以概括为四句：

- Web（论坛登录页、MindAuth 页面）只支持 用户名/邮箱 + 密码 和 QQ/GitHub/Discord 社交登录。注册必须邮箱验证码，且 `users.email` 是 `NOT NULL`。
- 手机号能力只做了一半：登录后可以绑定手机号（`/api/sms/send` + `/api/sms/verify`，需要会话），绑定后各产品通过 `phone_verified` 判断准入。
- 有一条完整的**手机号登录/注册链路，但只对官方 Android 客户端开放**（`/api/v1/native` 的 sms 方法），Web、论坛、Mod 都用不到。
- 全生态的"手机号已验证"来源是同一个：MindAuth 绑定成功 → 通知/接口 → 论坛同步 → LanLink / 云存档读取。入口缺失的只是"用手机号登录或注册"这一步。

建议：把手机号做成**与邮箱并行的第二条登录/注册通道**（不是替换邮箱），分 3~4 期落地。先补风控与合规模块（验证码用途化、反轰炸、换绑/解绑、成本熔断），再上 Web 验证码登录，最后做手机号注册与找回。

不建议做的：给第三方 OAuth 默认开放手机号明文 scope、让第三方应用/Mod 走 Native 收集凭据、静默自动注册（不告知就建号）、把手机号设成唯一账号标识。

## 1. 现状盘点（MindAuth 本体）

### 1.1 账号数据模型

| 字段 | 约束 | 说明 |
|---|---|---|
| `users.email` | `UNIQUE NOT NULL`（001 迁移） | 注册/登录/找回/通知/开发者中心全依赖它 |
| `users.phone` | `UNIQUE`，可空 | 绑定后才写入，全局唯一 |
| `users.phone_verified` / `phone_verified_at` | 默认 0 / NULL | 生态统一的准入旗标 |
| `users.username` | `UNIQUE NOT NULL` | 注册必填 |

来源：`src/db/migrations/001_initial_schema.sql`。

### 1.2 已有的手机号能力（登录后绑定）

- 接口：`POST /api/sms/send`、`POST /api/sms/verify`（`src/routes/sms.js`），**均需会话 Cookie + CSRF**，即只有已登录用户能用。
- 业务：`src/modules/sms/smsBinding.js`，仅支持大陆手机号 `^1[3-9]\d{9}$`，**不支持换绑**（已绑定其他号码时直接 409）。
- 通道：阿里云 dysmsapi（`src/utils/aliyunSms.js`），验证码 6 位、Redis TTL 5 分钟。配置优先环境变量，回退 `sms_config` 表。
- 风控现状（代码值）：同 IP 10 次/小时、同用户 5 次/10 分钟、同号码 1 次/分钟；验证失败 8 次/5 分钟、15 次/小时（号码维度）、30 次/小时（IP 维度）。
- 审计：`sms_audit_logs`（脱敏号码 + action + code + IP + UA）。

### 1.3 已有的手机号登录能力（仅官方 Android）

`/api/v1/native` 下已有一条短信登录/注册链路（`src/modules/nativeAuth/nativeAuthService.js`，14 号及以后的迁移）：

- 客户端能力在 `native_auth_clients.allowed_methods` 控制：`mdtbbs_android` 允许 `password/sms/qq`；`mdtbbs_mindustry`（官方游戏内 Mod）**只允许 `password`**。
- 流程：创建 transaction（PKCE S256）→ `sms/send` → `sms/verify` → 一次性授权码（90 秒）→ MindFourm 服务端兑换。
- SMS 验证码以 HMAC 摘要存库，不存明文；注册接口同时要求邮箱。
- 这条链路**明确不对外开放**：`docs/third-party-integration.md` 写明 `/api/native/*` 是第一方预登记接口，第三方必须走 OAuth+PKCE，不得收集 MindAuth 密码。
- 官方 Android 的"登录后补绑手机号"依赖 MindFourm 签发 phone-action ticket（`NATIVE_PHONE_ACTION_SECRET`），而签发方**尚未部署**——代码注释与 `.env.example` 都标注了这一点，所以 Android 上绑定手机号目前不可用。

### 1.4 对外契约（第三方视角）

- `GET /api/userinfo` 在 `profile` scope 下返回 `phone_verified`、`phone_verified_at`、`phone_masked`（脱敏），**不返回明文号码**（`src/modules/oauth/oauthIssuer.js`）。
- Scope 清单里没有手机号相关项（`src/modules/oauth/scopes.js`）；第三方拿不到号码本身。
- 结论：**新增 Web 手机号登录不需要改第三方契约** —— `sub` 仍是稳定标识，`phone_verified` 语义不变。

## 2. 生态盘点：谁在要手机号、怎么要的

| 产品 | 手机号角色 | 现状证据 |
|---|---|---|
| MindFourm（mdtbbs 站） | **写操作必须 `phone_verified`**；注册/登录跳转 MindAuth；绑定后论坛主动 sync 状态 | `site-profile-data.ts`（`requirePhoneForWrites: true`、`requireEmail: false`）、`phone-write.guard.ts`、`POST /api/auth/sync-phone-status` |
| Mindustry Club（国际站） | 不要求手机号，只要求邮箱 | 同文件（`requireEmail: true / phone false`，`phoneVerification: false`） |
| LanLink（联机中继） | 建房/进房需 `phone_verified`，否则 `phone_verification_required` | `src/control/guestSocket.js`、`src/control/modSocket.js`；OAuth userinfo 取 `phone_verified` |
| 官方 Android 客户端 | Native 短信登录/注册（仅此一家） | `android/.../AuthRepository.kt`；`008_native_auth.sql` 种子 |
| 官方 Mindustry Mod（游戏内容） | Native 密码登录；**无短信方法** | `010_mindustry_public_native_client.sql`（methods 只有 password） |
| 官方 LanLink Mod | OAuth PKCE（loopback 回调）→ 浏览器登录 | `020` / `022` 迁移；`docs/MINDFOURM_INTEGRATION.md` |
| 云存档（BackupSave） | 同步 `phone_verified` 走论坛外部 API | `backend/src/services/userService.js` |
| 下载站 / MDT-Forge | 无手机号依赖 | 代码检索无命中 |
| 第三方 OAuth 应用 | 只拿 `phone_verified` 布尔；开发者应用创建需手机号已验证（mdtbbs 生态） | `DeveloperPolicy.js`、`developer-applications.md` |

生态侧的关键事实：**所有产品的一致体验都建立在"手机号已验证"旗标上，而不是"用户能输入手机号"上。** 换手机号、丢号码、没邮箱的用户，目前全都没有自助出路（只能靠管理员）。

## 3. 为什么值得做

1. **注册入口缺一条腿**：mdtbbs 论坛已经按实名要求收手机号（论坛 `/verify-phone` 页面直接引用了《网络安全法》《互联网用户账号信息管理规定》《互联网跟帖评论服务管理规定》《个人信息保护法》），但注册时偏偏只认邮箱——用户先注册、再登录、再绑定手机号，多一步，且对没有可用邮箱的中国用户是死路。
2. **找回路径缺一条腿**：忘记密码只能走邮箱重置。手机号绑定用户遇到邮箱不可用时无自助找回（Android 端等 ticket 部署，Web 端完全没有）。
3. **成本对称性**：既然已经按短信计费维护了一条短信通道，把它只用于"绑定"这一件事，边际收益低。
4. **对下游零改造**：登录/注册方式变了，但下游只读 `phone_verified`，LanLink、论坛、云存档、第三方全部不用改。

## 4. 方案设计

### 4.1 设计原则

- **并行，不替换**：邮箱通道完整保留；手机号是第二通道。国际站（Mindustry Club）默认不开手机号通道。
- **一个号码一个账号**：沿用 `users.phone` UNIQUE；号码同时只能作为一个人的登录标识。
- **验证码用途化**：登录/注册/换绑/找回各自独立命名空间与挑战记录，**不可跨用途复用**（现状 `sms:code:{phone}` 是全局单键，多用途会互相踩）。
- **反枚举 + 反轰炸优先**：登录/注册用的短信发送将是 MindAuth 第一个**无需登录**的短信入口（现有 `sms/send` 与 Native 链路都有会话或 transaction 门槛），也是全系统最贵、最容易被滥用的动作——先设计风控，再设计功能。
- **合规前置**：签名/模板报备、告知文本、最小化存储（对外只给布尔）。

### 4.2 数据模型（草案）

| 改动 | 内容 | 理由 |
|---|---|---|
| `users.email` → 允许 NULL | `ALTER TABLE users MODIFY email VARCHAR(255) NULL`（UNIQUE 保留，MySQL 允许多个 NULL） | 手机号注册用户没有邮箱 |
| 新增验证码挑战表 | 仿 `registration_email_codes`：`phone_hash`(HMAC) + `purpose` + `code_digest`(HMAC) + `attempt_count` + `expires_at` + `consumed_at`；Redis 为热路径、MySQL 兜底 | 用途隔离、防爆破、防明文 |
| `sms_audit_logs` 增 `purpose` | 复用 `code` 字段也可，但显式列更清晰 | 审计区分登录/注册/换绑 |
| 明文码收敛 | 现有绑定链路把验证码明文写入 Redis（`sms:code:{phone}`），Native 链路存 HMAC；建议统一为 HMAC | 减少泄漏面 |

> `users.email` 改可空会影响所有"给用户发邮件"的路径（通知、管理员重置密码、密码找回）。实施时必须逐处加空值守卫——**论坛侧已有守卫**（通知服务 `if (!user.email) return`），MindAuth 侧 `admin/users.js` 重置密码直接 `sendEmail(user.email, ...)` 需要补。

### 4.3 接口草案

| 方法 | 路径 | 认证 | 用途 |
|---|---|---|---|
| POST | `/api/auth/sms/send` | 无 | 发送验证码；body 带 `phone` + `purpose`(login/register/reset) + 行为验证凭据 |
| POST | `/api/auth/phone-login` | 无 | 手机号 + 验证码登录；已注册 → 建会话；未注册 → 返回一次性 `registration_proof`，不建号 |
| POST | `/api/register/phone` | 无 | 用 `registration_proof` + 用户名/可选邮箱/密码完成注册 |
| POST | `/api/password/reset-by-phone` | 无 | 手机号验证后重置密码（P3） |
| POST/DELETE | `/api/account/phone` | 会话 + CSRF | 换绑 / 解绑，含冷却期与密码验证（P3） |

核心语义决策（需要产品拍板）：

- **未注册手机号在登录时的行为**：推荐"验证码通过后转注册"（不区分、不泄露注册状态，也少一次短信）。备选是显式提示"未注册，去注册"，与现有邮箱注册发送端点的既有产品决策（明确暴露已注册）一致——两种都自洽，但必须二选一，不能混。
- **注册是否必须邮箱**：推荐邮箱可选（可后补），否则"无邮箱用户"的诉求没解决。代价是这部分人暂时用不了开发者中心（`DeveloperPolicy` 要求 email 先行）。
- **Mod / 桌面端**：不扩 Native 短信方法。Mod 与桌面天然有浏览器（LanLink Mod 已是 OAuth loopback），或走 RFC 8628 设备流——手机号登录页在 Web 端做好，这些客户端**零改动**获益。

### 4.4 风控与限流（草案）

| 维度 | 建议阈值（可调） | 备注 |
|---|---|---|
| IP | 10 次/小时 + 动态收紧 | 衔接现有绑定链路的量级 |
| 手机号 | 1 次/分钟、5 次/小时、10 次/天 | 与绑定链路分离命名空间 |
| 验证尝试 | 5 次 / 挑战，超限作废重发 | 复用 native 的 `max_attempts` 模式 |
| 行为验证 | IP 信誉低 / 触发频次时要求（滑块/点选） | 现状全站无 captcha，是新增能力 |
| 预算熔断 | 日/月发送条数上限 + 超限告警 | 防"半夜被刷几万条" |
| 黑名单 | 号段级 + 单号级 + 已知接码平台特征 | 与 `ip_bans` 思路一致，独立存放 |

其他必做项：登录失败计数复用现有 `login_fail` + 锁定/封禁复核（`passwordLogin` / `checkLoginAllowed` 同款逻辑）、每次发送与校验都写审计、登录成功发新设备通知、验证码短信不得夹带营销内容。

### 4.5 合规与隐私

- **实名依据**：沿用论坛 `/verify-phone` 页面的四部法规口径（网安法、账号信息管理规定、跟帖评论管理规定、个保法）——这不是本次新提出的解释，是生态现状的延续。
- **PIPL 最小化**：只存"号码 + 验证时间"；对外接口继续只给 `phone_masked` + 布尔。
- **短信合规**：签名/模板需在运营商侧报备（现有阿里云通道已具备条件）；内容不含营销；按通道要求附退订渠道。
- **未成年人与国际用户**：Mindustry Club 保持邮箱通道；国际短信（+86 以外）成本与可达性单独评估，不随首期上线。

### 4.6 成本

- 结构：成本 = 单价 × 条数；条数由"注册/登录/找回次数 × 重发率"决定。阿里云国内验证码短信为按量付费（阶梯价，实际以合同价为准；本调研未获取到可引用的公开单价，落地前应向通道方确认）。
- 预算熔断的价值：按上限计算最坏情况——例如日上限 3000 条，量级约为"百元/日"，配合告警可控。
- 对账：定期用阿里云账单与 `sms_audit_logs` 交叉核对，防止通道侧被刷而应用侧无感。

## 5. 分期计划（估时供参考）

| 期 | 内容 | 量级 |
|---|---|---|
| P0 底座 | 验证码用途化（独立命名空间 + HMAC + 挑战表）、行为验证、预算熔断、审计加 `purpose`、修文档漂移（见 §7） | 1~2 周 |
| P1 Web 验证码登录 | `/api/auth/sms/send` + `/api/auth/phone-login`；登录页新增"验证码登录"页签；i18n 4 语；单测 + E2E | 约 1 周 |
| P2 手机号注册 | `users.email` 可空迁移 + 空值守卫审计；`/api/register/phone`；注册页双通道；开发者中心策略决策 | 1~2 周 |
| P3 恢复与运维 | 手机号重置密码、换绑/解绑（含冷却）、管理端解绑入口、二次放号专项 | 约 1 周 |

每期的文档契约同步（仓库既有约定）：改 `src/routes/auth.js` → `docs/api/auth.md` + `docs/api/README.md` 索引；改 `src/routes/sms.js` → `docs/api/account.md`；加迁移 → `docs/architecture/database.md`；动 scope/userinfo → `docs/api/oauth.md` + `docs/third-party-integration.md`。

## 6. 风险与反方意见

- **二次放号**：号码注销→运营商回收→新机主可收短信。若手机号成为主登录方式，需"长期未活动 + 新设备"时要求补充验证（邮箱/密码），或接入号码入网时间查询。
- **多账号 / 合号**：手机号唯一约束保证一号一账号，但"同一个人两个账号"（邮箱一个、手机一个）需要人工申诉策略，不建议自动合并。
- **邮箱可空的连锁**：通知、找回、开发者中心、部分审计展示都读过 `email`，需要逐处排查（§4.2 已点出第一处）。
- **反方**：如果目标只是"满足 mdtbbs 写操作的实名要求"，现状（登录后绑定）已经够用；手机号注册的净收益是"省一步、覆盖无邮箱用户"，是否值得短信成本与风控投入，应由产品用注册转化数据拍板。

## 7. 顺带发现（与手机号相关，建议单独处理）

1. **短信限流文档漂移（本次已修正）**：`docs/api/account.md`、`docs/architecture/database.md` 还写着旧阈值（IP 3 次/小时、用户 3 次/5 分钟；验证失败 5/10/20），而代码早已放宽为 IP 10 次/小时、用户 5 次/10 分钟、验证失败 8/15/30（`src/modules/sms/smsBinding.js`）。该纯文档问题已随本 PR 一并修正。
2. **Android 补绑手机号链路"半成品"**：服务端 phone-action ticket 校验已就绪，但签发方（MindFourm）未部署，客户端注释明确写"暂不可用"。
3. **验证码存储不统一**：Native 链路 HMAC 存库，Web 绑定链路 Redis 明文存码——建议随 P0 统一。

## 附录 A：证据索引（关键文件）

- 账号模型：`src/db/migrations/001_initial_schema.sql`
- 短信绑定：`src/routes/sms.js`、`src/modules/sms/smsBinding.js`、`src/utils/aliyunSms.js`
- Native 短信登录：`src/modules/nativeAuth/nativeAuthService.js`、`src/routes/nativeAuth.js`、`008/010` 迁移
- 对外契约：`src/modules/oauth/oauthIssuer.js`（userinfo claims）、`src/modules/oauth/scopes.js`、`docs/third-party-integration.md`、`docs/public-client-pkce.md`
- 生态侧：MindFourm `src/config/site-profile-data.ts`、`src/common/guards/phone-write.guard.ts`、`src/modules/auth/auth.controller.ts`（sync-phone-status）；LanLink `src/control/guestSocket.js`、`src/control/modSocket.js`；Android `AuthRepository.kt`
- 开发者准入：`src/modules/developer/DeveloperPolicy.js`

## 附录 B：本地复现命令

```bash
grep -n "max:" src/modules/sms/smsBinding.js        # 绑定链路的真实限流阈值
grep -n "sms" src/db/migrations/008_native_auth.sql # Android 的 sms 方法白名单
grep -n "allowed_methods" src/db/migrations/010_mindustry_public_native_client.sql
grep -rn "phone_verification_required" ../LanLink/src/control/
```
