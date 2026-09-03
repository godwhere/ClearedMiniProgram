# 微信小游戏用户身份、云存档、分享与广告奖励接入方案

> 文档状态：Phase 0—6 客户端已实施；6e7e1b0 交付复核的四项修复见第 36 节，提示分享基础见第 37 节，当前每日分级提示见第 38 节。后端与提示广告默认关闭，后端及设备发布验收待执行
> 目标仓库：`godwhere/ClearedMiniProgram`  
> 设计基线：`main@cdab6c984f5749b7af47560fddd210f01642fce9`  
> 微信 API 基线：`wechat-miniprogram/minigame-api-typings@4cae82af7f3c4339d1f11aea8e672fb16051d24a`（3.8.21）  
> 适用入口：`game.js -> src/bootstrap.js -> src/app.js -> src/ui/canvas-renderer.js`  
> 编写日期：2026-09-03

本文给出 Cleared 微信小游戏接入用户身份、可选头像昵称、云存档、分享归因、广告行为、奖励结算和行为上报的完整实施方案。

本文是实施合同，不是概念性建议。后续代码改动必须遵守以下内容：

1. 每一阶段只能修改该阶段列出的文件。
2. `core/**`、关卡数据、玩法机制和主题 manifest 不得因为账号、分享或广告接入而发生变化。
3. 所有 `wx.*` 调用只能出现在 `src/platform/wechat.js`。
4. 分享和广告只能产生“行为结果”，不能直接修改永久进度、每日次数或货币。
5. 所有耐久奖励必须经过统一、幂等的奖励结算入口。
6. 第一帧、离线游玩和现有本地存档不能依赖后端成功。
7. 每个阶段必须可独立关闭、回滚，并保持当前玩家体验可用。

---

## 1. 最终决策

本项目需要一套轻量接入框架，但不引入第三方运行时框架、全局事件总线、Redux、Webpack、Cocos、npm 运行依赖或 DOM。

目标结构为：

```text
CanvasRenderer / ClearedApp
          │
          │ 只发出业务意图、消费结构化结果
          ▼
┌──────────────────────────────────────────────┐
│ EngagementService   分享/广告业务流程编排     │
│ AuthService         微信身份与业务会话         │
│ ProfileService      可选头像昵称与原生按钮     │
│ ProgressSyncService 普通关卡云存档同步         │
│ ShareService        分享卡片与进入归因         │
│ AdsService          广告对象与展示生命周期     │
│ RewardService       唯一耐久奖励结算入口       │
│ BehaviorService     非权威分析事件队列         │
└──────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
      ApiClient                    WechatPlatform
      自有 HTTPS 后端                唯一 wx.* 边界
```

服务之间的职责必须保持单向：

```text
ClearedApp
  -> EngagementService
       -> AdsService
       -> ShareService
       -> RewardService
       -> BehaviorService

ProgressSyncService
  -> ApiClient
  -> ProgressStore
  -> SyncStore

AuthService
  -> WechatPlatform.login()
  -> ApiClient
  -> SessionStore
```

禁止形成以下依赖：

```text
AdsService -> ProgressStore              禁止
ShareService -> DailyProgressStore       禁止
BehaviorService -> RewardService         禁止
CanvasRenderer -> 任意 service            禁止
ProgressStore -> ApiClient               禁止
core/** -> src/** / wx / Canvas / 网络    禁止
```

---

## 2. 当前仓库事实

### 2.1 现有正确边界

当前项目已经具备以下可复用基础：

- `src/platform/wechat.js` 已封装 Canvas、触摸、生命周期、本地存储、图片、音频、震动、分包和广告对象创建。
- `src/services/ads-service.js` 已实现激励视频单例、重复展示保护、`show -> load -> show` 重试、完整观看判断和插屏频控。
- `src/services/progress-store.js` 使用 `cleared:minigame:progress:v2` 保存普通关卡完成状态和最佳时间。
- `src/services/daily-progress-store.js` 使用 `cleared:minigame:daily:v1` 独立保存每日进入次数和完成记录，并已有幂等 entry key。
- `src/app.js` 已预留 `onDailyRevive` / `requestDailyRevive()` 边界，但当前明确不发放次数。
- `tests/architecture-boundaries.test.js` 已保护 `core/**` 不接触微信、Canvas 和持久化层。

这些设计全部保留并扩展，不建立平行架构。

### 2.2 当前缺口

当前尚缺：

- 微信登录 code 到内部用户 ID 的后端交换。
- 业务会话 token 与过期处理。
- 本地匿名安装 ID。
- 本地普通进度到账号云存档的首次绑定和增量同步。
- 可选头像昵称授权及原生 `UserInfoButton` 生命周期。
- 菜单分享、主动分享、冷启动/热启动 query 处理和邀请归因。
- 广告完成结果与耐久奖励之间的幂等结算层。
- 广告、分享、登录和同步行为的非阻塞事件队列。
- 多账号切换、离线、超时、重复回调和旧版本回滚的处理合同。

### 2.3 当前必须修正的耦合

`src/gameplay/completion-policies.js` 当前在普通关卡落盘后直接调用 `ads.onLevelCompleted()`。

这会把商业化副作用放入“进度域结算策略”，后续不利于：

- 新手保护关不展示插屏。
- 刚看过激励视频时跳过插屏。
- 结果动画结束后再展示。
- 每日挑战和普通关卡使用不同策略。
- 广告失败与进度落盘完全隔离。

实施基础阶段时必须把广告通知移回 App 之后的 Engagement 边界；结算策略只返回结构化完成结果。

---

## 3. 范围

### 3.1 本方案必须完成

- 静默微信身份建立。
- 自有业务会话。
- 本地匿名游玩继续可用。
- 普通关卡完成和最佳时间云同步。
- 可选头像昵称，不授权也可完整游玩。
- 好友菜单分享和结果页主动分享。
- 服务端分享意图和进入归因。
- 激励视频结果标准化。
- 提示广告和每日额外次数的统一业务入口。
- 插屏广告从进度结算解耦。
- 统一奖励幂等账本。
- 本地行为 outbox 与批量上报。
- 严格的文件、方法、存档和测试边界。

### 3.2 第一轮明确不做

- 手机号授权。
- 实名认证、支付、虚拟支付或订单系统。
- 好友排行榜和开放数据域。
- 微信群关系链、群排行或 `shareTicket` 解密。
- 朋友圈奖励。
- 强制头像昵称授权。
- 多平台账号绑定。
- 可交易货币或高价值广告奖励。
- 远程脚本、动态代码或第三方增长 SDK。
- 把后端代码放进当前小游戏仓库。
- 云同步主题、音效、消除特效等设备偏好。
- 用客户端上报事件直接触发服务端发奖。

以上能力需要独立设计评审，不能顺手塞进本次实现。

---

## 4. 硬性信任边界

### 4.1 客户端可以决定

- 当前 Canvas 场景和按钮状态。
- 本地是否展示提示。
- 当前设备音效、主题和消除特效设置。
- 低价值、单局内、不可交易效果的即时表现。
- 离线时继续读取和写入本地普通进度。

### 4.2 客户端不能作为权威

- 用户真实身份。
- `openid` 与业务用户的映射。
- 每日广告奖励是否已领取。
- 邀请是否成立。
- 永久资产数量。
- 同一个广告或分享是否已经发奖。
- 排行榜资格。
- 高价值奖励。

### 4.3 服务端必须作为权威

- `openid -> userId` 映射。
- 业务 token。
- 云存档 revision。
- 分享意图、归因和防自邀。
- 奖励 ledger。
- 每日领取上限。
- 所有耐久 entitlement 的最终状态。

### 4.4 分析事件不是交易凭证

`BehaviorService.track('ad_completed')` 只用于分析。事件可能延迟、重复或丢失，服务端不得监听分析表自动发奖。

奖励必须通过：

```text
用户动作
  -> EngagementService
  -> AdsService / ShareService
  -> RewardService.claim(...)
  -> 服务端 reward_ledger 唯一约束
  -> App 应用服务端返回的 grant
```

---

## 5. 身份模型

“用户账号信息”必须拆成三层，不能混用。

| 层级 | 标识 | 生成方 | 用途 | 是否必须 |
| --- | --- | --- | --- | --- |
| 本地安装身份 | `installId` | 客户端 | 离线事件、幂等序号、首次迁移 | 必须 |
| 内部用户身份 | `userId` | 服务端 | 云存档、奖励、分享归因 | 联网后静默建立 |
| 展示资料 | `nickname`、`avatarUrl` | 用户主动授权 | 账号页和社交展示 | 可选 |

约束：

- `nickname` 不是唯一标识。
- `avatarUrl` 不是身份凭证。
- 客户端不保存或展示 `openid`。
- 服务端不把 `session_key` 返回客户端。
- AppSecret 只存在于服务端密钥环境。
- 用户拒绝头像昵称后仍应拥有 `userId`、云存档和正常玩法。

---

## 6. 启动时序

第一帧不能等待登录或网络。

```text
game.js
  -> bootstrap.start()
       1. new WechatPlatform()
       2. 读取 ProgressStore / DailyProgressStore / SessionStore / SyncStore
       3. 创建全部 service
       4. new ClearedApp(...services)
       5. app.start()                         先显示游戏
       6. share.install(contextProvider)
       7. share.captureEntry(getLaunchOptions())
       8. 异步 auth.ensureSession()
       9. 身份成功后 progressSync.bootstrap()
      10. 处理待归因 shareId
      11. behavior.flush()
```

必须保证：

- 第 8—11 步任一步失败，步骤 1—7 仍可运行。
- 登录错误不能把场景改成错误页。
- 超时后只把账号状态设为 `offline` 或 `error`，不阻断输入。
- 同一次启动并发调用 `ensureSession()` 时只发起一次 `wx.login()`。
- `onShow` 恢复时不能重复创建分享监听或原生用户信息按钮。

---

## 7. 微信登录与业务会话

### 7.1 客户端流程

```text
AuthService.ensureSession()
  ├─ SessionStore 中 token 尚未过期
  │    └─ 返回缓存 session
  └─ token 缺失、过期或服务端返回 401
       ├─ WechatPlatform.login()
       ├─ 获得一次性 code
       ├─ POST /v1/auth/wechat
       ├─ 服务端调用 code2Session
       ├─ 服务端查找或创建 user
       └─ 返回内部 userId + opaque accessToken
```

不把 `wx.checkSession()` 当成业务 token 校验。业务 token 是否有效由自有后端决定；需要重新身份建立时再次调用 `wx.login()`。

### 7.2 SessionStore

新增存储 key：

```text
cleared:minigame:session:v1
```

结构：

```js
{
  schemaVersion: 1,
  userId: 'usr_xxx',
  accessToken: 'opaque_random_token',
  issuedAt: 1780000000000,
  expiresAt: 1780604800000
}
```

严格规则：

- 不保存 `openid`。
- 不保存 AppSecret。
- 不保存 `session_key`。
- `expiresAt <= Date.now() + 30s` 时按已过期处理，避免边界请求失败。
- 解析失败、字段缺失或类型非法时清空整个 session，不尝试部分修复。
- `SessionStore` 只读写本地存储，不发网络请求。

### 7.3 AuthService 公共接口

```js
class AuthService {
  ensureSession(options)       // Promise<SessionResult>
  current()                    // Session | null
  state()                      // anonymous | authenticating | authenticated | offline | error
  clear(reason)                // 仅清业务 session
  onSessionChanged(listener)   // 返回 unsubscribe
}
```

`ensureSession()` 返回统一结果：

```js
{
  ok: true,
  status: 'authenticated',
  user: { id: 'usr_xxx', profileCompleted: false },
  session: { expiresAt: 1780604800000 }
}
```

失败：

```js
{
  ok: false,
  status: 'offline',
  reason: 'network' | 'timeout' | 'wechat-login-failed' |
          'backend-rejected' | 'invalid-response'
}
```

失败结果不得抛到游戏循环；仅编程错误可抛异常。

### 7.4 后端登录接口

```http
POST /v1/auth/wechat
Content-Type: application/json
```

请求：

```json
{
  "code": "wx-login-code",
  "installId": "ins_xxx",
  "clientVersion": "1.0.0"
}
```

响应：

```json
{
  "requestId": "req_xxx",
  "user": {
    "id": "usr_xxx",
    "profileCompleted": false
  },
  "session": {
    "accessToken": "opaque_random_token",
    "issuedAt": 1780000000000,
    "expiresAt": 1780604800000
  }
}
```

服务端要求：

- code 只使用一次。
- `appid + openid` 建唯一约束。
- token 只以 hash 形式持久化。
- 登录接口限流，但不能把正常冷启动误判为攻击。
- 不将微信接口原始错误、AppSecret 或 `session_key` 回传给客户端。
- token 过期后不设置 refresh token；客户端重新静默 `wx.login()`，减少客户端长期凭证数量。

---

## 8. 可选头像昵称与隐私授权

### 8.1 产品入口

首页左上角用 44×44 的圆形玩家头像作为账号入口，沿用原位置、safeTop 和 `home:account` 点击区域。没有资料、加载中或图片失败时使用 Canvas 默认人像，不在冷启动时弹授权：

```text
home:account
  -> account scene
       ├─ 显示：本地游玩 / 正在同步 / 已同步 / 同步失败
       ├─ account:authorizeProfile
       ├─ account:retrySync
       ├─ account:privacy
       └─ account:back
```

头像昵称必须由用户在账号页主动点击。

首页与账号页都消费 `ProfileService.current()` 提供的当前账号资料，并复用 Renderer 中同一个头像图片缓存。头像 URL 变化或资料清空后，旧图片的迟到回调不能覆盖新状态；加载失败不逐帧重复请求。身份就绪后异步刷新已有资料，不等待资料请求完成才进入游戏，也不在首页创建原生授权按钮。profile 默认开关仍关闭，此时显示默认人像。

主页头像改动已通过 55 组 Node 回归，覆盖异步刷新、非正方形图片比例、圆形裁剪、加载失败和旧账号迟到回调；开发者工具已检查默认头像、点击进入账号页和返回。真实授权头像的后端联调及 Android/iOS 显示验收尚未执行。

### 8.2 原生按钮边界

小游戏的用户信息按钮是原生覆盖层，不得由 Renderer 直接创建。

新增纯布局模块：

```text
src/ui/account-layout.js
```

接口：

```js
function accountLayout(metrics) {
  return {
    panel: { x, y, w, h },
    profileButton: { x, y, w, h },
    retryButton: { x, y, w, h },
    privacyButton: { x, y, w, h }
  };
}
```

职责：

- 只根据 `width`、`height`、`safeTop`、`safeBottom` 计算矩形。
- 不引用 Canvas context。
- 不引用平台或 service。
- Renderer 和 App/ProfileService 共用同一布局结果，避免原生按钮与视觉位置错位。

`ProfileService` 负责：

```js
mount({ rect, style, onSuccess, onDenied })
unmount()
handleResize(rect)
isSupported()
```

进入账号页时 mount；离开账号页、`onHide`、销毁或尺寸变化时 unmount/remount。

禁止：

- 全屏透明授权按钮。
- 看不见的原生按钮覆盖 Canvas 其他区域。
- 在首页启动时自动创建授权按钮。
- 授权失败后循环弹窗。
- 把用户拒绝视为登录失败。

### 8.3 隐私策略

第一版不注册自定义 `wx.onNeedPrivacyAuthorization` 监听，使用平台统一隐私授权流程，避免实现不完整的自定义弹窗和遗漏 `resolve()`。

只有以后需要自定义隐私 UI 时，才单独新增设计；一旦注册该监听，每条授权路径都必须调用 `resolve({ event: 'agree' })` 或 `resolve({ event: 'disagree' })`。

账号页可提供“隐私协议”入口，但隐私文案、收集目的和平台后台声明必须在提审前完成。

### 8.4 资料保存

客户端拿到用户资料后：

```http
PATCH /v1/me/profile
Authorization: Bearer <token>
```

请求只允许：

```json
{
  "nickname": "...",
  "avatarUrl": "https://..."
}
```

服务端限制：

- 昵称按 Unicode 字符数截断。
- 去除控制字符。
- 头像 URL 只作为展示数据，不能用作鉴权。
- 行为事件中不得携带昵称和完整头像 URL。

---

## 9. 本地存档与同步元数据

### 9.1 不升级现有普通存档 key

第一轮不把 `cleared:minigame:progress:v2` 改成新的 key，也不把网络状态塞进其 state。

理由：

- 现有存档已经发布。
- 普通进度在后端故障时仍应独立工作。
- 网络元数据不属于玩法存档。
- 单独 SyncStore 更容易回滚，不会让旧版本误删新字段。

### 9.2 新增 SyncStore

存储 key：

```text
cleared:minigame:online:v1
```

结构：

```js
{
  schemaVersion: 1,
  installId: 'ins_xxx',
  boundUserId: null,
  migrationId: 'mig_xxx',
  serverRevision: 0,
  nextOperationSequence: 1,
  pendingOperations: [],
  snapshotRequired: false,
  lastSyncAt: 0,
  lastError: null
}
```

`SyncStore` 只保存同步元数据和待发送操作，不直接保存第二份完整 ProgressStore。

规则：

- `installId` 首次生成后不改变。
- `migrationId` 每个 install 只生成一次。
- operation ID 使用 `installId + sequence`，sequence 必须先持久化再对外返回。
- `pendingOperations` 上限 200。
- 超过上限时设置 `snapshotRequired = true`；不得无限增长本地存储。
- SyncStore 写入失败不能撤销已经落盘的普通关卡完成状态。
- `boundUserId` 必须在首次云快照落盘前成功保存，作为账号归属保护；后续合并或 revision 写入失败不能把它清回匿名。

### 9.3 ProgressStore 只增加两个纯存档能力

允许在 `src/services/progress-store.js` 新增：

```js
exportCloudSnapshot()
mergeCloudSnapshot(snapshot)
```

云快照 v1：

```js
{
  schemaVersion: 1,
  levels: {
    '0:0': { completed: true, bestMs: 12000 },
    '0:1': { completed: true, bestMs: 18000 }
  }
}
```

第一版同步字段只有：

- `completed`
- `bestMs`

明确不同步：

- `settings.skinId`
- `settings.clearEffectId`
- `settings.soundEnabled`
- `lastPlayed`
- `stats.totalClears`
- 每日挑战数据

合并规则：

```text
completed = local.completed OR remote.completed
bestMs    = 两边大于 0 的最小值
未知/非法 level key = 忽略
非法 bestMs         = 忽略
远端 false          = 不能清除本地 true
```

`mergeCloudSnapshot()` 必须：

1. 在内存副本上完成全部校验和合并。
2. 只在合并结束后替换 state 的相关字段。
3. 调用现有 `save()`。
4. 写入失败时恢复原内存状态并返回 `{ ok:false, reason:'persist-failed' }`。
5. 不修改设置、最后游玩位置和本地总通关次数。

### 9.4 首次绑定

```text
Auth userId 已建立
  ├─ boundUserId 为空
  │    ├─ POST /v1/progress/bootstrap
  │    ├─ 带 migrationId + 本地 snapshot
  │    ├─ 服务端幂等合并
  │    ├─ 返回 canonical snapshot + revision
  │    ├─ 先持久化 boundUserId；失败则禁止合并云进度
  │    ├─ 客户端 mergeCloudSnapshot；失败仍保留已保存的账号归属
  │    └─ 合并落盘成功后写入 revision
  │
  ├─ boundUserId == userId
  │    └─ 正常增量同步
  │
  └─ boundUserId != userId
       ├─ 禁止自动上传
       ├─ 禁止自动合并
       ├─ 同步状态设为 account-mismatch
       └─ 保留当前本地存档，等待明确的账号冲突处理
```

第一版不实现自动账号切换解决器。发生 mismatch 时只暂停云同步，防止把前一个微信账号的本地进度上传给新账号。

首次绑定中途退出或写入失败后，磁盘上的云数据必须同时具备已保存的 boundUserId。若只有归属已保存而合并尚未成功，同账号重新 GET 云快照继续合并；revision 不提前推进，migrationId 不改变。归属尚未写成时不允许任何远端数据进入本地存档，原匿名/旧版存档仍按既有 bootstrap 合同处理。

### 9.5 增量操作

普通关卡落盘成功后，App 调用：

```js
progressSync.enqueueCompletion({
  setIndex,
  levelIndex,
  elapsedMs,
  completedAtClient,
  firstClear,
  newBest
});
```

outbox item：

```js
{
  operationId: 'ins_xxx:42',
  type: 'level_completed',
  payload: {
    levelKey: '2:4',
    elapsedMs: 18240,
    completedAtClient: 1780000000000
  }
}
```

服务端按 `operationId` 幂等。最佳时间仅用于个人云存档展示；若以后用于排行榜，必须另建成绩验证流程，不能直接信任客户端 elapsedMs。

### 9.6 同步触发点

- 登录成功后。
- 普通关卡完成后，非阻塞尝试。
- `onShow` 网络恢复后。
- outbox 达到 20 条后。
- `onHide` 时尽力发送，但不能等待或阻止退后台。

ApiClient 不自动重试 POST。只有具备 `operationId` / `migrationId` 的幂等请求，ProgressSyncService 才允许重试一次。

---

## 10. 分享框架

### 10.1 第一版分享范围

首轮只接：

- 微信右上角好友分享。
- 普通通关成功结果页分享。
- 每日挑战成功结果页分享。

暂不接：

- 朋友圈奖励。
- 群关系链。
- 失败结果页分享。
- 分享后立即复活。
- 点击分享按钮即发奖励。

### 10.2 ShareService 接口

```js
class ShareService {
  install(contextProvider)        // 注册一次菜单分享监听
  uninstall()
  share(context)                  // 主动分享，返回 initiated 结果
  captureEntry(options)           // 处理冷启动/热启动 query
  consumePendingAttribution(session)
  buildPayload(context)
}
```

`contextProvider` 返回纯数据：

```js
{
  scene: 'home' | 'ordinary_result' | 'daily_result',
  levelKey: '2:4' | null,
  dailyDateKey: '2026-09-03' | null,
  elapsedMs: 18240 | null,
  completed: true
}
```

ShareService 不读取 App 内部可变字段，也不持有 Runner。

### 10.3 分享 payload

```js
{
  title: '这一关你能解开吗？',
  imageUrl: 'assets/share/ordinary-result.png',
  query: 'sv=1&sid=shr_xxx&scene=ordinary_result'
}
```

规则：

- `sid` 由服务端生成，是不可猜测的 opaque share ID。
- query 不放 `openid`、`userId`、token、昵称或存档。
- query 只用短字段，编码后设客户端上限 256 字符。
- 无网络或未登录仍可普通分享，但不创建奖励型 `sid`。
- 没有自定义图片时允许使用游戏截图；正式分享图必须在包体预算中单独验收。

### 10.4 分享意图

需要奖励归因时：

```http
POST /v1/share-intents
Authorization: Bearer <token>
```

请求：

```json
{
  "scene": "ordinary_result",
  "context": {
    "levelKey": "2:4"
  }
}
```

返回：

```json
{
  "shareId": "shr_xxx",
  "expiresAt": 1780604800000
}
```

若创建意图超时，ShareService 仍可用无 `sid` 的普通卡片发起分享，不能阻塞分享面板。

App action 改变场景后，用当前 shareContext 调用 prepareContext；因此普通结果经选关返回首页、每日结果返回首页都会刷新或复用首页意图。服务仍只保留一个有效缓存，按账号、上下文与过期时间校验；切换上下文时先撤销旧请求的提交资格，即使新上下文复用了缓存，也不允许迟到结果覆盖它。分享点击及菜单回调不等待预取。

### 10.5 冷启动和热启动归因

- 冷启动：`WechatPlatform.getLaunchOptions()`。
- 热启动：`bindLifecycle` 的 `show(options)` 原样传给 `ClearedApp.onShow(options)`，再交给 `ShareService.captureEntry(options)`。

当前 `src/app.js` 使用 `show: () => this.onShow()` 丢弃了 options，实施分享阶段时必须改为：

```js
show: options => this.onShow(options)
```

进入参数暂存在 ShareService 内存和本地 pending key 中；身份建立后调用：

```http
POST /v1/share-attributions
Authorization: Bearer <token>
```

请求：

```json
{
  "shareId": "shr_xxx",
  "entryScene": 1007,
  "attributionId": "ins_xxx:share-entry:42"
}
```

服务端校验：

- share intent 存在且未过期。
- 邀请者和被邀请者不是同一个 user。
- attributionId 未处理。
- 同一 invitee 在同一 campaign 下没有重复归因。
- 若配置为新用户奖励，invitee 满足新用户条件。
- 发奖和 attribution 写入同一事务。

### 10.6 分享不能直接证明成功

客户端只能可靠记录 `share_initiated`，不能把调用 `wx.shareAppMessage()` 或回到前台视为邀请或服务端奖励凭证。当前另有用户明确接受的本地提示许可：发起分享流程后解锁，取消也可能解锁；它不证明发送成功、不调用 reward-claims，见第 37 节。

因此禁止：

```text
点击分享 -> 立即增加每日次数
点击分享 -> onShow 后立即发货币
调用 shareAppMessage -> 直接 RewardService.claim(invite_success)
```

邀请奖励只在被邀请者通过对应 `sid` 进入并经服务端归因后成立。

---

## 11. 广告框架

### 11.1 保留现有 AdsService

不重写 `src/services/ads-service.js`。在现有行为上扩展：

- 保留逻辑 placement 到 adUnitId 的映射。
- 保留全局单例和 busy 保护。
- 保留平台发奖条件 `isEnded === true` 才成功；允许跳过后仍返回 true 的广告也满足，不以按钮文字或本地计时判断。
- 保留 `show()` 失败后 `load()` 再展示一次。
- 保留插屏间隔。
- 增加 attemptId、错误码、行为回调和兼容字段。

### 11.2 标准结果

在保留现有 `rewarded`、`reason` 字段的前提下，扩展为：

```js
{
  placement: 'hint',
  attemptId: 'adatt_ins_xxx_42',
  rewarded: true,
  reason: 'completed',
  errCode: null,
  startedAt: 1780000000000,
  finishedAt: 1780000030000
}
```

失败 reason allowlist：

```text
not-configured
busy
unit-mismatch
not-supported
show-failed
closed
error
```

不把微信原始 error object 整体持久化；只提取非敏感 `errCode` 和归一化 reason。

### 11.3 广告位配置

`src/config/ads.js` 扩展为：

```js
module.exports = {
  rewarded: {
    hint: '',
    dailyExtraEntry: ''
  },
  interstitial: {
    levelComplete: ''
  },
  rules: {
    interstitialEveryClears: 4,
    interstitialMinIntervalMs: 180000,
    hintMode: 'tiered',
    hintRewardedEnabled: false,
    dailyExtraEntryEnabled: false,
    dailyExtraEntryLimit: 1
  }
};
```

当前交付配置：

- Phase 0—6 首次实施时 `hintMode` 为 `free`，第 37 节使用 `share`；当前按第 38 节切为 `tiered`，保留显式旧模式。
- `hintRewardedEnabled` 为 false，第三个及以后新提示使用分享；开通广告后配置有效广告位并显式设为 true。
- `dailyExtraEntryEnabled` 必须为 false。
- 广告 ID 为空时保持 no-op。
- 若 `hint` 和 `dailyExtraEntry` 使用不同 adUnitId，则不得沿用当前单例实现；第一版要求两个 placement 指向同一个激励视频单元。

### 11.4 多例升级触发条件

只有出现以下需求时，才把 `rewarded` 从单个 entry 改为 `Map<adUnitId, entry>`：

- 运营明确要求不同 placement 使用不同广告单元。
- 已验证基础库、真机和广告后台支持 multiton。
- 新测试覆盖跨广告位并发、销毁和回调隔离。

在此之前不提前实现 multiton。

### 11.5 基础库兼容

当前代码无条件传 `disableFallbackSharePage: true`。该可选字段必须由平台适配层按基础库能力过滤；业务 AdsService 不读取 SDKVersion。

`WechatPlatform.createRewardedVideoAd(options)` 负责：

- 复制 options，不能修改调用方对象。
- 不支持的字段直接删除。
- API 缺失时返回 null。
- 兼容判断失败时使用最保守参数 `{ adUnitId }`。

### 11.6 插屏广告解耦

`completion-policies.js` 修改后：

```js
settleOrdinary(context, services)
  -> 只调用 progress.recordCompletion()
  -> 返回 completion
```

`ClearedApp.onPathCompleted()` 在已成功落盘、已生成 result 后调用：

```js
this.engagement.onOrdinaryCompleted({
  levelKey,
  totalClears,
  firstClear,
  newBest,
  resultVisibleAt
});
```

EngagementService 决定是否调用 `ads.showInterstitial('levelComplete')`。

广告失败不得：

- 取消完成记录。
- 阻止进入 result scene。
- 阻止下一关解锁。
- 修改 completion 返回值。

---

## 12. 统一奖励结算

### 12.1 RewardService 是唯一入口

耐久奖励包括：

- 每日额外进入次数。
- 邀请奖励。
- 未来的货币、皮肤 entitlement 或活动次数。

这些能力只能通过：

```js
rewardService.claim(input, ownerUserId)
```

`ownerUserId` 是可选的客户端内部参数。广告完成路径必须传入观看开始时的账号；与原 attemptId 一起写入既有 rewards pending 记录后才发起认证/网络请求。它不进入 HTTP body，后端身份仍由业务 token 决定；不传该参数的原调用继续使用当前账号。已记录的 attemptId 不允许转移到其他账号。

禁止 AdsService、ShareService、BehaviorService、Renderer 或 App 直接修改耐久余额。

### 12.2 请求结构

```js
{
  source: 'rewarded_ad' | 'share_attribution' | 'system',
  action: 'daily_extra_entry',
  placement: 'dailyExtraEntry',
  idempotencyKey: 'adatt_ins_xxx_42',
  context: {
    dateKey: '2026-09-03',
    dayId: 'daily-2026-09-03'
  }
}
```

客户端不能提交：

```json
{
  "amount": 99999,
  "currency": "diamond"
}
```

服务端根据 action allowlist 决定奖励类型和数量。

### 12.3 返回结构

```js
{
  ok: true,
  granted: true,
  alreadyGranted: false,
  grantId: 'grt_xxx',
  action: 'daily_extra_entry',
  stateVersion: 13,
  entitlement: {
    dateKey: '2026-09-03',
    entryLimit: 4,
    entriesUsed: 3,
    entriesRemaining: 1
  }
}
```

重复 idempotencyKey：

```js
{
  ok: true,
  granted: true,
  alreadyGranted: true,
  grantId: 'grt_xxx',
  entitlement: { /* 与首次相同 */ }
}
```

### 12.4 低价值提示访问与预览

提示预览属于低价值、不可交易的本地功能。当前允许四种模式：

```text
tiered     当前默认：每天第一个新关免费、第二个分享、第三个起广告；广告未启用时分享
free       直接展示，保留原免费回滚行为
share      发起分享后保存本关当日许可；再次点击查看
rewarded   观看广告并达到平台发奖条件后解锁，在当前 run 内展示
```

即使是 rewarded hint，也不能增加永久货币。若广告完成后用户已离开当前关卡，迟到回调不得把提示应用到新关卡。

tiered 继续使用本地当日关卡集合，同关重复查看不计数。免费保存成功立即展示；分享／广告新许可与保存重试只更新按钮，下一次点击再预览。持久保存失败时，其他未解锁关先重试原目标，不得重复领取首次免费。

### 12.5 高价值奖励限制

客户端广告回调不是不可伪造证明。第一版广告奖励只允许有上限、不可交易的功能型 entitlement，例如每天一次额外进入次数。

以下能力不能仅凭客户端 `isEnded` 发放：

- 可购买或可交易货币。
- 永久稀有资产。
- 排行榜加分。
- 现金价值权益。

若以后需要，必须增加平台可用的服务端验证、风控和审计方案后再评审。

---

## 13. 每日挑战“复活”语义冻结

当前每日失败后 `dailyFailure:retry` 已允许重试本关，并且不额外消耗进入次数。因此本方案不把广告接到失败重试上。

冻结以下语义：

```text
现有 dailyFailure:retry
  = 当前已开始的 daily run 内重试当前关
  = 免费
  = 不增加进入次数
  = 行为保持不变

新增 daily:extraEntry
  = 当日完整 run 进入额度 +1
  = 每日最多领取配置次数
  = 必须经 RewardService
  = 服务端 entitlement 权威
```

为兼容已有预留 action：

```text
daily:revive
 dailyResult:revive
```

可暂时作为 `daily:extraEntry` 的兼容别名，但新 Renderer 只发出规范 action：

```text
daily:extraEntry
```

不得创建“复活一次”和“增加进入次数”两套共用同一个 action 的模糊行为。App 在 action 分派前把两个旧别名规范化为 daily:extraEntry，统一经过功能开关、有效场景/日期上下文及 pending 校验；关闭时直接返回 false，不进入旧预留回调。有效场景仅为当日题面可用的首页和每日成功结果页；进行中的棋盘及失败结果均不进入增次流程。

### 13.1 DailyProgressStore 改动

保留现有 `requestEntryIncrease()` no-op，避免旧调用路径无授权地增加次数。

新增且只允许新增：

```js
applyAuthorizedEntryGrant(input)
```

输入：

```js
{
  dateKey,
  dayId,
  grantId,
  entryLimit,
  grantedAt
}
```

严格校验：

- `grantId` 非空且未应用。
- dateKey 合法。
- 已有 dayId 不匹配时拒绝。
- 新 entryLimit 只能单调增加，不能降低。
- 写存储失败必须恢复原 state。
- 同一 grantId 重放返回 alreadyApplied，不重复增加。

`applyAuthorizedEntryGrant()` 不发网络请求，也不验证广告；它只缓存 RewardService 已确认的服务端结果。

---

## 14. EngagementService

这是 App 与分享/广告/奖励之间唯一的业务编排层。

公共接口：

```js
class EngagementService {
  requestHint(context)
  requestDailyExtraEntry(context)
  shareResult(context)
  onOrdinaryCompleted(context)
}
```

### 14.1 requestHint

```text
hintMode == tiered
  -> hintState 唯一决策：view / retry-save / busy / unavailable / free / share / rewarded
  -> 第一个新关免费，第二个分享；第三个起按广告开关、有效配置与接口能力选择广告或分享
  -> 分享／广告达标后保存原日期、关卡；保存失败期间全局阻止其他新资格
  -> free 保存成功或 view 返回 granted:true；新分享／广告和 retry-save 返回 granted:false
  -> 结果携带 mode/action/dateKey/levelKey；广告运行失败不自动切换到分享

hintMode == free
  -> 返回 { granted:true, mode:'free' }

hintMode == share
  -> 已有本关当日许可：返回 granted:true
  -> 本次许可保存失败：重试保存，不再分享
  -> 发起 shareHint，不等待网络；initiated:true 后保存原关卡许可
  -> 返回 { granted:false, mode:'share', unlocked:true }，下次点击才显示

hintMode == rewarded
  -> AdsService.showRewarded('hint')
  -> 未达到平台发奖条件：返回 denied
  -> 达到平台发奖条件：返回 { granted:true, mode:'rewarded', attemptId }
```

EngagementService 不调用 HintService。App 收到 granted 且场景、run、Runner 仍匹配后，才调用原有提示展示逻辑；share/tiered 还须匹配原日期和关卡键。未知策略显式拒绝，不隐式转为 rewarded。

### 14.2 requestDailyExtraEntry

```text
检查功能开关和本地 pending
  -> 确保 AuthService session，固定发起 userId
  -> AdsService.showRewarded('dailyExtraEntry')
  -> 达到平台发奖条件（isEnded === true）
  -> RewardService.claim(daily_extra_entry, 发起 userId)
  -> 先持久化原账号 + attemptId 的 pending 请求
  -> 会话过期时重新认证；仅同账号允许发送原幂等请求
  -> 返回服务端 entitlement
```

认证失败、网络失败或重新认证为其他账号时，已达到平台发奖条件的请求保留在原账号的既有 rewards 队列；重启后由原账号恢复，复用同一幂等键，不再要求观看。未达到条件而关闭不创建 pending，也不发奖。

任一步失败只返回结构化 reason，不直接改 App 或 DailyProgressStore。

### 14.3 shareResult

```text
ShareService.share(context)
  -> 返回 initiated
  -> BehaviorService 记录 share_initiated
```

不返回 `shared:true` 或 `rewarded:true` 这类无法可靠证明的字段。

### 14.4 onOrdinaryCompleted

只负责非阻塞插屏策略和行为记录，不影响完成结果。

---

## 15. App 异步竞态边界

广告、登录、分享意图和奖励请求都会跨场景返回。`src/app.js` 必须增加请求 guard，不能只根据当前 scene 猜测。

建议状态：

```js
this.pendingActions = {
  hint: null,
  dailyExtraEntry: null,
  share: null,
  profile: null
};
```

每次动作生成本地 request token：

```js
{
  id: 'req-local-42',
  scene: 'play',
  runKey: 'ordinary:2:4:run-8'
}
```

回调应用条件：

- pending token 仍是同一个对象。
- scene 仍允许该结果。
- runKey 与发起时一致。
- Runner 尚未 terminal，若效果要求进行中。

广告看完后若玩家已经切换关卡：

- durable grant 可保留在账号状态。
- 当前关提示不得应用到新关卡。
- pending 必须清理。

按钮 pending 时 Renderer 只消费布尔状态并禁用 hit；Renderer 不管理 Promise。

---

## 16. 行为事件框架

### 16.1 BehaviorService

```js
class BehaviorService {
  track(name, properties)
  flush(reason)
  identify(userId)
  clearUser()
}
```

本地存储 key：

```text
cleared:minigame:events:v1
```

事件：

```js
{
  eventId: 'evt_ins_xxx_42',
  name: 'ad_completed',
  version: 1,
  occurredAtClient: 1780000000000,
  installId: 'ins_xxx',
  userId: 'usr_xxx',
  sessionId: 'appses_xxx',
  scene: 'play',
  properties: {
    placement: 'hint',
    levelKey: '2:4',
    reason: 'completed'
  }
}
```

### 16.2 事件 allowlist

首轮：

```text
app_launch
auth_started
auth_succeeded
auth_failed
progress_sync_succeeded
progress_sync_failed
profile_authorized
profile_denied
share_initiated
share_entry_detected
share_attributed
ad_requested
ad_completed
ad_closed_early
ad_error
reward_granted
reward_rejected
```

现有玩法埋点不在本次范围；不得顺手给每次触摸和每个格子移动加事件。

### 16.3 禁止字段

事件 properties 中禁止：

- accessToken。
- 微信 code。
- openid / session_key。
- AppSecret。
- 昵称。
- 完整头像 URL。
- 完整启动 query。
- 完整存档 snapshot。
- 微信原始 error object。

### 16.4 Outbox

- 最多 200 条。
- 每批最多 50 条。
- 成功确认后删除。
- 服务端按 eventId 去重。
- 达到上限时优先丢弃最旧的非关键分析事件。
- flush 失败不弹阻塞提示。
- `onHide` 只尽力调用，不等待完成。

---

## 17. ApiClient

新增：

```text
src/services/api-client.js
```

职责只有 HTTP 协议适配：

```js
request({ method, path, body, auth, idempotencyKey, timeoutMs })
```

约束：

- 只允许相对 `/v1/` path；业务调用方不能传任意绝对 URL。
- base URL 来自 `src/config/backend.js`。
- 默认超时 8000ms。
- JSON 请求和响应。
- `auth:true` 时从 SessionStore 读取 token。
- 401 时清 SessionStore 并返回 `unauthorized`，不在 ApiClient 内调用 `wx.login()`。
- 不自动重试 POST。
- 只把 200—299 视为 transport success。
- 解析失败返回 `invalid-json`。
- 日志中不能打印 token、code 或完整 body。

统一结果：

```js
{
  ok: false,
  statusCode: 503,
  requestId: 'req_xxx',
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'service unavailable',
    retryable: true
  }
}
```

`src/config/backend.js` 初始内容：

```js
module.exports = {
  enabled: false,
  baseUrl: '',
  timeoutMs: 8000
};
```

baseUrl 为空或 enabled=false 时所有在线 service 安全返回 `not-configured`，不能调用空 URL。

---

## 18. 后端接口合同

后端不放入当前仓库。当前仓库只保存客户端接口合同；服务端应建立独立仓库和部署流水线。

### 18.1 接口清单

```text
POST   /v1/auth/wechat
GET    /v1/me
PATCH  /v1/me/profile
DELETE /v1/me

POST   /v1/progress/bootstrap
GET    /v1/progress
POST   /v1/progress/operations:batch

POST   /v1/share-intents
POST   /v1/share-attributions

POST   /v1/reward-claims
GET    /v1/daily-entitlements/{dateKey}

POST   /v1/events:batch
```

### 18.2 Progress bootstrap

请求：

```json
{
  "migrationId": "mig_xxx",
  "installId": "ins_xxx",
  "clientRevision": 0,
  "snapshot": {
    "schemaVersion": 1,
    "levels": {
      "0:0": { "completed": true, "bestMs": 12000 }
    }
  }
}
```

响应：

```json
{
  "revision": 12,
  "snapshot": {
    "schemaVersion": 1,
    "levels": {
      "0:0": { "completed": true, "bestMs": 11000 }
    }
  },
  "migration": {
    "alreadyApplied": false
  }
}
```

### 18.3 Progress operations batch

```json
{
  "baseRevision": 12,
  "operations": [
    {
      "operationId": "ins_xxx:42",
      "type": "level_completed",
      "payload": {
        "levelKey": "2:4",
        "elapsedMs": 18240,
        "completedAtClient": 1780000000000
      }
    }
  ]
}
```

服务端响应必须列出已接受 operationId；客户端只删除明确确认的项。

### 18.4 Reward claim

```http
POST /v1/reward-claims
Idempotency-Key: adatt_ins_xxx_42
```

服务端以 `(user_id, idempotency_key)` 建唯一约束。

### 18.5 Error envelope

所有错误统一：

```json
{
  "requestId": "req_xxx",
  "error": {
    "code": "DAILY_REWARD_LIMIT_REACHED",
    "message": "daily reward limit reached",
    "retryable": false
  }
}
```

客户端按 code 映射本地 reason，不直接把服务端 message 当用户文案。

---

## 19. 服务端数据表与唯一约束

逻辑表：

```text
users
  id
  created_at
  deleted_at nullable

wechat_identities
  app_id
  open_id
  union_id nullable
  user_id
  created_at

sessions
  token_hash
  user_id
  issued_at
  expires_at
  revoked_at nullable

user_profiles
  user_id
  nickname
  avatar_url
  updated_at

progress_snapshots
  user_id
  revision
  snapshot_json
  updated_at

progress_migrations
  user_id
  migration_id
  created_at

progress_operations
  user_id
  operation_id
  operation_type
  payload_json
  created_at

share_intents
  id
  inviter_user_id
  scene
  context_json
  expires_at
  created_at

share_attributions
  attribution_id
  share_id
  inviter_user_id
  invitee_user_id
  campaign_id
  created_at

reward_ledger
  id
  user_id
  idempotency_key
  source
  action
  grant_json
  created_at

behavior_events
  event_id
  user_id nullable
  install_id
  event_name
  event_version
  payload_json
  occurred_at_client
  received_at
```

必须的唯一约束：

```text
wechat_identities(app_id, open_id)
sessions(token_hash)
progress_migrations(user_id, migration_id)
progress_operations(user_id, operation_id)
share_attributions(attribution_id)
share_attributions(invitee_user_id, campaign_id)   按活动规则启用
reward_ledger(user_id, idempotency_key)
behavior_events(event_id)
```

分享归因和 reward ledger 必须在同一数据库事务中写入。

---

## 20. 客户端目标文件结构

```text
src/
├── config/
│   ├── ads.js                         现有，扩展 placement/规则
│   ├── backend.js                     新增，API 开关和 base URL
│   └── engagement.js                  新增，功能默认开关
│
├── platform/
│   └── wechat.js                      唯一 wx.* 边界
│
├── services/
│   ├── ads-service.js                 现有，扩展标准结果
│   ├── api-client.js                  新增
│   ├── session-store.js               新增
│   ├── sync-store.js                  新增
│   ├── auth-service.js                新增
│   ├── profile-service.js             新增
│   ├── progress-sync-service.js       新增
│   ├── share-service.js               新增
│   ├── reward-service.js              新增
│   ├── behavior-service.js            新增
│   └── engagement-service.js          新增
│
└── ui/
    ├── account-layout.js              新增纯布局
    └── canvas-renderer.js             只绘制和注册 hit
```

不新增 `framework/`、`store/` 全局容器、通用 EventBus 或第三方 SDK 目录。

---

## 21. 严格代码实施边界

### 21.1 永久禁止修改区

本需求不得修改：

```text
core/**
data/**
src/mechanics/**
src/skins/**
src/effects/**
src/ui/board/**
assets/skins/**
assets/effects/**
pages/**
app.js
app.json
app.wxss
```

也不得修改：

- 普通关卡 ID、setIndex/levelIndex 映射。
- Portal 规则版本、题面和解答。
- `settings.skinId`、`settings.clearEffectId`、`settings.soundEnabled`。
- `cleared:minigame:progress:v2`。
- `cleared:minigame:daily:v1`。
- 主题 ID、特效 ID 和注册顺序。
- `dailyFailure:retry` 的免费重试行为。
- 主包/分包划分，除非新增正式分享图导致包体方案另行评审。

### 21.2 允许修改但职责受限

#### `src/platform/wechat.js`

只允许新增平台原语：

```text
login
request
getLaunchOptions
showShareMenu
onShareAppMessage / offShareAppMessage
shareAppMessage
createUserInfoButton
requirePrivacyAuthorize
openPrivacyContract（能力存在时）
getNetworkType / onNetworkStatusChange
基础库能力判断
```

不得创建业务 token、决定奖励、合并存档或生成分享奖励。

#### `src/bootstrap.js`

只作为 Composition Root：

- 构造 store/service。
- 把 service 注入 App。
- `app.start()` 后启动非阻塞在线 bootstrap。
- 安装一次分享监听。
- 捕获冷启动参数。

不得处理具体奖励规则、存档合并算法或 Canvas 场景细节。

#### `src/app.js`

只允许：

- 接收依赖注入并保留现有 fallback。
- 新增账号场景和 action 编排。
- 传递 `onShow(options)`。
- 建立 pending guard。
- 收到 service 结果后调用原有提示/场景/存档能力。
- 普通完成后通知 ProgressSyncService 和 EngagementService。

不得：

- 直接调用 `wx.*`。
- 拼 HTTP URL。
- 保存 accessToken。
- 解析 openid。
- 根据事件名自行发奖。
- 读取 AdsService 内部广告对象。

#### `src/ui/canvas-renderer.js`

只允许：

- 账号场景绘制。
- 账号/分享/额外次数按钮和 pending/disabled 状态。
- 生成稳定 action/hit ID。

不得：

- 创建 UserInfoButton。
- 调用 share/ad/auth service。
- 保存 Promise。
- 修改 ProgressStore。

#### `src/services/progress-store.js`

只允许新增 `exportCloudSnapshot()` 和 `mergeCloudSnapshot()` 以及必要的纯校验 helper。

不得：

- 改 STORAGE_KEY。
- 请求网络。
- 保存 token/userId。
- 同步设置和 totalClears。

#### `src/services/daily-progress-store.js`

只允许新增 `applyAuthorizedEntryGrant()` 和幂等 grantId 存储字段。

不得让 `requestEntryIncrease()` 自行成功，不得根据广告回调直接增加次数。

#### `src/gameplay/completion-policies.js`

只允许移除广告副作用并保持返回协议；不得加入 Auth、Share、Reward 或网络依赖。

### 21.3 后端边界

当前仓库内禁止新增：

```text
server/**
functions/**
cloudfunctions/**
AppSecret 配置
code2Session 请求实现
数据库迁移
```

后端必须使用独立仓库。当前文档中的 HTTP 与数据表合同是两仓之间的接口边界。

---

## 22. 分阶段文件变更清单

任何 PR 不得跨阶段顺手实现下一阶段。

2026-09-03 用户确认补充：Phase 2/5 允许修改 `src/bootstrap.js`，仅用于对应服务构造和注入；允许同步本方案与相应专题文档。

### Phase 0：纯架构与解耦，不改变用户体验

#### 新增

```text
src/config/backend.js
src/config/engagement.js
src/services/session-store.js
src/services/sync-store.js
src/services/api-client.js
src/services/auth-service.js
src/services/progress-sync-service.js
src/services/behavior-service.js
src/services/engagement-service.js

tests/session-store.test.js
tests/sync-store.test.js
tests/api-client.test.js
tests/auth-service.test.js
tests/progress-sync-service.test.js
tests/behavior-service.test.js
tests/engagement-service.test.js
```

#### 修改

```text
src/platform/wechat.js
src/bootstrap.js
src/app.js                         仅依赖注入和非阻塞启动
src/gameplay/completion-policies.js
src/services/progress-store.js    仅 export/merge cloud snapshot

tests/architecture-boundaries.test.js
tests/run-context.test.js
tests/progress-store.test.js
tests/app-smoke.test.js
tests/run.js
README.md                          只记录架构，在线能力仍标未启用
```

#### 禁止修改

```text
src/ui/canvas-renderer.js
src/services/ads-service.js
src/config/ads.js
src/services/daily-progress-store.js
```

#### 默认配置

```text
backend.enabled = false
progressSync.enabled = false
behavior.uploadEnabled = false
hintMode = free
广告/分享奖励均关闭
```

#### 验收

- 无后端、无网络时所有现有测试通过。
- 现有提示仍免费。
- 不新增任何可见按钮。
- 普通通关仍落盘并解锁下一关。
- completion policy 中不存在 AdsService 调用。
- App 第一帧不等待 Promise。

### Phase 1：静默身份与普通云存档

#### 新增

```text
tests/account-bootstrap.test.js
tests/progress-sync-conflict.test.js
```

#### 修改

```text
src/config/backend.js
src/config/engagement.js
src/bootstrap.js
src/app.js
src/services/auth-service.js
src/services/progress-sync-service.js
src/services/api-client.js
src/services/session-store.js
src/services/sync-store.js
src/services/progress-store.js
src/platform/wechat.js
README.md
tests/run.js
```

#### 禁止修改

```text
src/ui/canvas-renderer.js
src/services/profile-service.js    本阶段尚不存在
src/services/share-service.js
src/services/ads-service.js
src/services/daily-progress-store.js
```

#### 验收

- 登录失败仍能完成普通关卡。
- 同一启动多个 ensureSession 只调用一次 wx.login。
- 首次 migrationId 重试不会重复导入。
- completed 只增不减，bestMs 取最小正数。
- 设置、lastPlayed、totalClears 不被远端覆盖。
- boundUserId 不同时暂停同步且不上传。
- 401 清业务 session，下一次只重新登录一次。

### Phase 2：账号页与可选资料

#### 新增

```text
src/services/profile-service.js
src/ui/account-layout.js

tests/profile-service.test.js
tests/account-layout.test.js
tests/account-app.test.js
```

#### 修改

```text
src/bootstrap.js                  仅对应服务构造与注入
src/app.js
src/ui/canvas-renderer.js
src/platform/wechat.js
tests/renderer.test.js
tests/renderer-button.test.js
tests/app-smoke.test.js
tests/run.js
README.md
```

#### 验收

- 首页账号按钮避开 safeTop 和胶囊区域。
- 拒绝资料授权不影响账号和云存档。
- 离开账号页后原生按钮被 destroy。
- resize 后按钮位置与 Canvas 视觉一致。
- 不支持 createUserInfoButton 时账号页仍可返回。
- 页面不存在透明全屏授权层。

### Phase 3：普通分享与进入参数

#### 新增

```text
src/services/share-service.js
assets/share/ordinary-result.png   只有通过包体预算后才允许加入
assets/share/daily-result.png      同上

tests/share-service.test.js
tests/share-entry.test.js
```

#### 修改

```text
src/config/engagement.js
src/bootstrap.js
src/app.js
src/ui/canvas-renderer.js
src/platform/wechat.js
tests/app-smoke.test.js
tests/renderer-button.test.js
tests/package-budget.test.js       仅新增图片时
tests/run.js
README.md
```

#### 验收

- 分享监听只注册一次。
- 菜单分享能根据当前 scene 返回纯 payload。
- 普通和每日成功结果页有分享按钮。
- 未登录/断网仍能无归因分享。
- 冷启动和热启动均能捕获 sid。
- 自邀、过期和重复 attribution 由后端拒绝。
- 客户端不因调用 shareAppMessage 发放奖励。

### Phase 4：广告标准化与免费提示兼容

#### 修改

```text
src/services/ads-service.js
src/config/ads.js
src/platform/wechat.js
src/services/engagement-service.js
src/app.js
tests/ads-service.test.js
tests/engagement-service.test.js
tests/app-smoke.test.js
tests/run.js
README.md
```

#### 验收

- 返回值保留 rewarded/reason 并新增 attemptId。
- 提前关闭不发提示。
- 连点只出现一个广告。
- 广告库存不足不阻断游戏。
- hintMode 默认 free；打开 rewarded 前需单独发布配置。
- 切换关卡后的迟到广告回调不在新关卡展示提示。
- `disableFallbackSharePage` 在不支持基础库上被平台层移除。

### Phase 5：RewardService 与每日额外次数

#### 新增

```text
src/services/reward-service.js

tests/reward-service.test.js
tests/daily-entry-grant.test.js
```

#### 修改

```text
src/bootstrap.js                  仅对应服务构造与注入
src/services/engagement-service.js
src/services/daily-progress-store.js
src/config/ads.js
src/app.js
src/ui/canvas-renderer.js
tests/daily-progress-store.test.js
tests/daily-app.test.js
tests/renderer-button.test.js
tests/run.js
README.md
```

#### 验收

- dailyFailure:retry 仍免费。
- 只有广告回调确认达到平台发奖条件后才请求 reward claim。
- 同一 attemptId 只能获得一次 grant。
- 同一 grantId 本地只能应用一次。
- 达到每日上限时服务端拒绝且本地不增加。
- RewardService 失败不修改 entryLimit。
- 服务端已发奖但 UI 已离开时，entitlement 下次进入仍可恢复。

### Phase 6：分享奖励

#### 修改

```text
src/services/share-service.js
src/services/reward-service.js
src/services/behavior-service.js
src/config/engagement.js
tests/share-service.test.js
tests/reward-service.test.js
README.md
```

#### 验收

- 邀请者点击分享不立即发奖。
- 被邀请者成功归因后由服务端事务发奖。
- inviter == invitee 必须拒绝。
- 同一 invitee/campaign 只能归因一次。
- attribution 重试返回同一结果。

---

## 23. Action 与 Scene 契约

新增 scene：

```text
account
```

新增规范 action：

```text
home:account
account:back
account:authorizeProfile
account:retrySync
account:privacy
result:share
dailyResult:share
daily:extraEntry
```

兼容别名：

```text
daily:revive       -> daily:extraEntry
dailyResult:revive -> daily:extraEntry
```

禁止重命名或复用现有 action：

```text
home:start
home:levels
home:dailyChallenge
home:corridor
play:hint
play:undo
play:reset
result:next
result:replay
dailyFailure:retry
```

Renderer 只发 action 字符串；App 是唯一 action 分派位置。

---

## 24. 架构自动门禁

扩展 `tests/architecture-boundaries.test.js`：

### 24.1 wx 全局门禁

递归扫描当前运行时源码：

```text
core/**
src/**
game.js
```

仅允许：

```text
src/platform/wechat.js
```

出现以下形式必须失败：

```js
wx.xxx
wx['xxx']
globalThis.wx.xxx
GameGlobal.wx.xxx
```

测试文件、旧 `pages/**` 和根目录旧小程序参考文件不参与当前运行时扫描。

### 24.2 网络边界

除以下文件外不得出现 `/v1/` 接口 path 或 `Authorization`：

```text
src/services/api-client.js
对应 config/接口常量文件
```

业务 service 只传相对 path 常量，App/Renderer 不出现 URL。

### 24.3 奖励边界

静态扫描以下文件不得出现 `entryLimit +=`、`currency +=` 或直接写 reward state：

```text
src/services/ads-service.js
src/services/share-service.js
src/services/behavior-service.js
src/ui/**
```

### 24.4 core 边界

保留现有全部 core 检查，不因在线框架放宽。

---

## 25. 测试矩阵

### 25.1 Node 自动测试

| 场景 | 必测结果 |
| --- | --- |
| 本地 session 非法 JSON | 清空并返回 anonymous |
| ensureSession 并发 | 只 login 一次 |
| 登录超时 | 游戏继续，状态 offline |
| ApiClient 401 | session 清空，不无限重试 |
| 首次 progress bootstrap 重放 | migration 只应用一次 |
| 完成集合冲突 | 取并集 |
| bestMs 冲突 | 取最小正数 |
| 远端非法字段 | 忽略且不污染 prototype |
| account mismatch | 不上传、不合并 |
| share listener install 两次 | 只保留一个监听 |
| 热启动 sid | 捕获并幂等归因 |
| 点击分享 | 只产生 initiated |
| 激励视频完整关闭 | rewarded=true |
| 提前关闭 | rewarded=false |
| 广告并发 | 第二次 busy |
| 不同 adUnitId | 第一版 unit-mismatch |
| reward claim 重放 | grantId 相同，不重复 |
| daily grant 本地重放 | alreadyApplied |
| 迟到 hint 回调 | 不应用到新 run |
| behavior batch 部分确认 | 只删已确认事件 |

### 25.2 微信开发者工具

必须验证：

- 编译无新增全局/基础库错误。
- 开发工具登录 code 能到测试后端。
- request 合法域名配置生效。
- 账号原生按钮坐标正确。
- 分享菜单和主动分享能拉起。
- 冷启动/热启动 query 均可见。
- 广告无配置时安全降级。
- 代码包分析仍满足现有预算。

### 25.3 真机

必须验证至少 iOS 和 Android：

- 弱网、断网和网络恢复。
- 切后台时广告/分享回调。
- 拒绝隐私或用户资料授权。
- 刘海屏、胶囊区和横向尺寸变化。
- 广告完整观看、提前关闭、无库存和加载失败。
- 分享给好友后从卡片冷启动。
- 微信账号切换后的 account-mismatch。

Node 测试和开发者工具不能替代真机验收。

---

## 26. 上线开关与默认值

`src/config/engagement.js` 建议初始：

```js
module.exports = {
  auth: {
    enabled: false
  },
  progressSync: {
    enabled: false
  },
  profile: {
    enabled: false
  },
  share: {
    menuEnabled: false,
    resultEnabled: false,
    attributionEnabled: false,
    rewardsEnabled: false
  },
  behavior: {
    uploadEnabled: false
  },
  rewards: {
    dailyExtraEntryEnabled: false
  }
};
```

启用顺序必须是：

```text
1. backend.enabled
2. auth.enabled
3. progressSync.enabled
4. profile.enabled
5. share.menuEnabled / resultEnabled
6. share.attributionEnabled
7. behavior.uploadEnabled
8. 正式广告位 ID
9. hintMode=rewarded（若产品决定）
10. dailyExtraEntryEnabled
11. share.rewardsEnabled
```

不能在后端表、唯一约束和监控尚未上线时先打开耐久奖励。

后续可增加 `/v1/runtime-config`，但第一版不需要远程配置框架；先使用版本内静态开关降低复杂度。

---

## 27. 发布前平台配置

代码完成不等于可发布，提审前还需：

- 在微信后台配置合法 request 域名和 HTTPS 证书。
- 服务端保存 AppID/AppSecret，不提交仓库。
- 完成隐私收集目的、用户信息和网络请求相关声明。
- 准备并审核分享标题和图片。
- 开通流量主并创建正式广告位。
- 确认体验版与正式版使用不同后端环境或严格环境隔离。
- 关闭测试账号、测试 grant 和调试无限次数。
- 将 `dailyDebugUnlimitedEntries` 在正式包保持 false。
- 检查日志、错误上报和数据库中不包含 code/token/session_key。

`project.config.json` 中开发工具的 `urlCheck:false` 不能替代正式合法域名配置。

---

## 28. 回滚方案

### 28.1 客户端回滚

- 所有在线能力都有静态开关。
- 后端不可用时切回本地模式。
- `ProgressStore` key 不变，旧版本仍可读取普通进度。
- 新增的 session/sync/events key 被旧版本忽略。
- 关闭 rewarded hint 后回到 `free`，不让用户失去现有功能。
- 关闭 daily extra entry 只隐藏入口，不删除已合法发放的服务端记录。

### 28.2 服务端回滚

- 停止新 reward claim，不删除 ledger。
- 停止 attribution，不删除 share intents。
- progress 读取可保持，写入可临时返回 retryable maintenance。
- token 可批量撤销，客户端会重新 `wx.login()`。

### 28.3 数据回滚禁止项

不得：

- 删除 reward ledger 后重新计算。
- 降低已发放 entryLimit。
- 用旧远端 snapshot 覆盖本地完成集合。
- 清理用户本地 ProgressStore 作为故障修复手段。

---

## 29. 安全与隐私检查清单

- [ ] AppSecret 不在当前仓库。
- [ ] 客户端无 openid/session_key。
- [ ] accessToken 不写日志和事件。
- [ ] 所有后端接口 HTTPS。
- [ ] token 服务端只存 hash。
- [ ] 所有 durable claim 有 idempotency key。
- [ ] reward ledger 有唯一约束。
- [ ] 分享 query 不含身份和存档。
- [ ] 自邀、重复邀请和过期邀请被拒绝。
- [ ] profile 授权是用户主动操作。
- [ ] 用户拒绝 profile 后游戏可继续。
- [ ] 行为事件采用字段 allowlist。
- [ ] 用户删除接口能撤销 session 并执行数据删除策略。
- [ ] 服务端有接口级限流和 requestId。
- [ ] 客户端不信任服务端 message 作为直接 UI 文案。

---

## 30. 每阶段完成定义

一个阶段只有同时满足以下条件才算完成：

1. 变更文件严格落在本阶段清单。
2. 新行为有错误实现时会失败的自动测试。
3. `node tests/run.js` 全部通过。
4. `git diff --check` 通过。
5. 无关文件无格式化或重排。
6. 旧存档样本通过升级/读取测试。
7. 在线失败不阻断离线玩法。
8. 文档和 README 与实际开关一致。
9. 涉及微信 UI、分享、广告或生命周期时完成开发者工具验证。
10. 涉及广告、隐私、冷启动归因或账号切换时完成真机验证。

---

## 31. 明确的升级触发条件

以下需求出现时必须新增设计，不得在当前框架中隐式扩张：

| 需求 | 必须新增的设计 |
| --- | --- |
| 排行榜 | 开放数据域或服务端成绩验证、防作弊 |
| 多平台账号 | 账号绑定、解绑、冲突与找回 |
| 永久货币广告奖励 | 服务端验证、风控和审计 |
| 多广告单元并行 | multiton 生命周期和并发测试 |
| 朋友圈奖励 | 单独的传播归因与平台规则评审 |
| 自定义隐私弹窗 | 完整状态机、resolve 兜底和提审文案 |
| 云同步主题设置 | 分包可用性、设备偏好和回退策略 |
| 每日排行/奖励 | 每日进入和成绩全面服务端权威 |
| 远程运营配置 | schema、签名、缓存、过期和回滚 |

---

## 32. 推荐提交拆分

```text
PR 1  refactor: inject online services and isolate post-level engagement
PR 2  feat: add silent auth and ordinary progress sync
PR 3  feat: add optional account profile scene
PR 4  feat: add menu and result sharing
PR 5  refactor: standardize rewarded ad attempts
PR 6  feat: add idempotent daily extra-entry rewards
PR 7  feat: add server-attributed invite rewards
```

每个 PR 独立可回滚，不合并跨阶段大 PR。

---

## 33. 官方接口基线

本方案以微信小游戏官方 API 类型定义 3.8.21 为基线：

- [`wx.login`](https://developers.weixin.qq.com/minigame/dev/api/open-api/login/wx.login.html)：客户端取得短期 code，服务端调用 code2Session。
- [`wx.getLaunchOptionsSync`](https://developers.weixin.qq.com/minigame/dev/api/base/app/life-cycle/wx.getLaunchOptionsSync.html)：冷启动参数。
- [`wx.onShow`](https://developers.weixin.qq.com/minigame/dev/api/base/app/life-cycle/wx.onShow.html)：热启动参数。
- [`wx.shareAppMessage`](https://developers.weixin.qq.com/minigame/dev/api/share/wx.shareAppMessage.html)：主动分享。
- [`wx.onShareAppMessage`](https://developers.weixin.qq.com/minigame/dev/api/share/wx.onShareAppMessage.html)：菜单分享内容。
- [`wx.createUserInfoButton`](https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.createUserInfoButton.html)：原生用户信息按钮。
- [`wx.requirePrivacyAuthorize`](https://developers.weixin.qq.com/minigame/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html)：隐私授权辅助接口。
- [`wx.createRewardedVideoAd`](https://developers.weixin.qq.com/minigame/dev/api/ad/wx.createRewardedVideoAd.html)：激励视频广告。
- [`wechat-miniprogram/minigame-api-typings`](https://github.com/wechat-miniprogram/minigame-api-typings/tree/4cae82af7f3c4339d1f11aea8e672fb16051d24a)：本设计引用的官方类型快照。

实施时若官方基础库或审核规则变化，应更新本文的 API 基线和兼容矩阵，但不得因此绕过本文定义的身份、奖励和存档信任边界。


## 34. 实施验证记录

- Phase 0：`586c3a9`，移除结算广告依赖，独立 online/session/events 存储及非阻塞启动；44 组测试、包体与差异检查通过。
- Phase 1：`5859546`，身份 single-flight、账号冲突、云进度并集与最短时间、部分 ACK 和队列溢出恢复；46 组测试及门禁通过。旧存档缺少 bestMs 时，operation payload 省略 elapsedMs，服务端只合并 completed，禁止伪造最佳用时。
- Phase 2：`1ad228a` 及后续注入提交，账号页、纯布局、原生资料按钮生命周期；49 组测试及门禁通过。开发者工具已编译并验证默认配置下账号页进入、离线重试和返回。真实资料与后端联调、原生授权、隐私、Android/iOS 验证尚未执行。

- Phase 3：菜单/成功结果分享、冷/热启动归因、有限持久队列及纯分享 payload 已接入，51 组测试及门禁通过。意图异步预取，点击时不等待网络；使用游戏截图。归因响应约定 `attributed:true` 或 `alreadyAttributed:true`，仅 ACK 删除对应项。分享和归因默认关闭，真实卡片冷启动与后端拒绝自邀/过期验证仍待执行。

- Phase 4：保留广告单例及加载重试，新增 attemptId、标准结果、销毁时结清 pending、广告间 busy 隔离与当前 run 提示 guard；51 组测试、包体与差异检查通过。官方 typings 的 disableFallbackSharePage 最低版本为 3.7.7，旧版保守过滤。正式广告位、完整观看/早关/无库存和后台回调的真机验证未执行。

- Phase 5：RewardService、持久待结算队列、确认 grant 缓存、每日授权增次和恢复查询已接入。53 组测试与门禁通过；免费失败重试保持原行为。新增 `cleared:minigame:rewards:v1`，待结算上限 20、确认缓存上限 64；超限拒绝新请求，恢复仍以服务端 ledger 为准。GET daily-entitlements/{dateKey} 响应为 `{dayId, grants:[...]}`，grants 最多 50 条，每项沿用第 12.3 节完整 grant 结构。entriesUsed/Remaining 仅校验，不覆盖本地每日消耗；服务端配置更高每日 grant 上限前需升级缓存/分页合同。后端幂等账本和实际广告验收仍属外部发布门禁。

- Phase 6：邀请意图可声明 `rewardAction: daily_extra_entry`，由服务端选定活动及奖励；query 始终仅有 sv/sid/scene。ShareService 不调用 reward-claims，忽略归因响应中的奖励字段；邀请者通过每日 entitlement 查询恢复 grant。明确 SELF_INVITE、SHARE_INTENT_EXPIRED、SHARE_INTENT_NOT_FOUND、INVITEE_INELIGIBLE、CAMPAIGN_CLOSED 错误终止对应归因，网络错误保持原 attributionId 重试。行为队列恢复和发送前均过滤字段，旧账号事件不随新账号 token 上传；分析事件不参与奖励结算。53 组测试及门禁通过，服务端事务/唯一约束与真实邀请闭环未宣称完成。

- 最终身份复核：修复状态监听器同步重入 ensureSession 时重复登录的问题；先发布 single-flight Promise，再通知观察者。回归用例复现修改前 login=2，修改后 login=1 且 Promise 相同；53 组全量测试及包体门禁通过。


## 35. 客户端交付清单与发布边界

以下为 `6e7e1b0` 的初次客户端交付记录，按阶段提交在 `codex/account-engagement-framework`。初次测试未覆盖第 36 节的四个故障场景，不能据此认定这些边界正确；修复后的当前证据以第 36 节为准。“客户端完成”仍不代表第 30 节后端、开发者工具在线能力及真机发布门禁全部完成。代码保持 disabled safe defaults；没有服务器目录、密钥、线上部署或真实发奖。

### 精确文件清单

相对实施前基线 `f62fdbe`，新增 29 个文件：

```text
src/config/backend.js
src/config/engagement.js
src/services/api-client.js
src/services/auth-service.js
src/services/behavior-service.js
src/services/engagement-service.js
src/services/profile-service.js
src/services/progress-sync-service.js
src/services/reward-service.js
src/services/session-store.js
src/services/share-service.js
src/services/sync-store.js
src/ui/account-layout.js
tests/account-app.test.js
tests/account-bootstrap.test.js
tests/account-layout.test.js
tests/api-client.test.js
tests/auth-service.test.js
tests/behavior-service.test.js
tests/daily-entry-grant.test.js
tests/engagement-service.test.js
tests/profile-service.test.js
tests/progress-sync-conflict.test.js
tests/progress-sync-service.test.js
tests/reward-service.test.js
tests/session-store.test.js
tests/share-entry.test.js
tests/share-service.test.js
tests/sync-store.test.js
```

修改 20 个文件：

```text
README.md
docs/daily-challenge-mode.md
docs/user-account-sharing-ads-integration.md
src/app.js
src/bootstrap.js
src/config/ads.js
src/gameplay/completion-policies.js
src/platform/wechat.js
src/services/ads-service.js
src/services/daily-progress-store.js
src/services/progress-store.js
src/ui/canvas-renderer.js
tests/ads-service.test.js
tests/app-smoke.test.js
tests/architecture-boundaries.test.js
tests/progress-store.test.js
tests/renderer-button.test.js
tests/renderer.test.js
tests/run-context.test.js
tests/run.js
```

### 已建立的边界

- `WechatPlatform` 是唯一微信 API 入口；HTTP 路径集中在 ApiClient，业务服务使用命名合同。
- 普通 completion policy 只结算进度。App 确认落盘、生成结果后通知同步和 Engagement；广告失败不改变通关与解锁。
- Auth / Profile / ProgressSync / Share / Ads / Reward / Behavior 各自负责身份、可选展示资料、云进度、分享归因、广告生命周期、确认奖励和非权威事件。
- 额外次数只接受 RewardService 已确认的 entitlement；本地应用 grant 幂等且写入失败回滚。免费失败重试不变。
- 首帧不等待联网；所有开关关闭、网络超时、缺少广告或隐私拒绝时，原本地玩法仍可用。保护区 `core/**`、`data/**`、机制、主题/特效 manifest、棋盘渲染、素材及旧小程序页面的差异均为空。

### 存储合同

保留 `cleared:minigame:progress:v2` 和 `cleared:minigame:daily:v1`；普通 state 不含账号/奖励/事件字段，只新增 export/merge cloud snapshot 能力。每日记录增加 `_grantIds`，不降低额度、不改变原有消耗。

新增 key：

```text
cleared:minigame:session:v1
cleared:minigame:online:v1
cleared:minigame:events:v1
cleared:minigame:share-entry:v1
cleared:minigame:rewards:v1
```

### 已接入 HTTP 调用

```text
POST  /v1/auth/wechat
GET   /v1/me
PATCH /v1/me/profile
POST  /v1/progress/bootstrap
GET   /v1/progress
POST  /v1/progress/operations:batch
POST  /v1/share-intents
POST  /v1/share-attributions
POST  /v1/reward-claims
GET   /v1/daily-entitlements/{dateKey}
POST  /v1/events:batch
```

业务 session 只保留内部 userId/token/时间；一次性登录 code 不落盘。401 每次业务操作最多重新认证一次，ApiClient 不自动重试 POST。普通云快照只合并 completed 并集与有效正 bestMs 的最小值，不同步偏好、lastPlayed、totalClears 或每日进度。

邀请奖励只请求活动意图；服务端必须把 attribution 与 reward ledger 放在同一事务中。客户端不接受 share_initiated 或事件上报作为奖励证明。GET daily-entitlements 的完整响应和容量合同见第 34 节。

### 自动验证

- `node tests/run.js`：53 组通过，含 16 组新增测试。覆盖身份并发及监听器重入、过期 session/401、离线首帧、迁移及队列恢复、存档并集/最短时间/污染字段、账号变化、原生按钮生命周期、分享监听/冷热参数、完整观看/早关/错误/重试/销毁、迟到提示、奖励和本地 grant 幂等、事件容量/字段过滤/部分 ACK；保留全部普通、Portal、每日、主题及包体测试。
- `node scripts/check-package-budget.js`：主包源码 2,704,744 bytes（2.579 MiB），总包 15,995,684 bytes（15.255 MiB）；所有主包/分包/总包预算通过。
- `git diff --check` 与相对基线的差异检查通过，未修改保护区。
- 分阶段完整日志保存在本机 `/tmp/cleared-phase*-tests.log`、`/tmp/cleared-phase*-budget.log`；最终日志为 `/tmp/cleared-final-tests.log` 和 `/tmp/cleared-final-budget.log`。

### 开发者工具与设备证据

已在 Stable 2.02.2608060 编译最终默认配置，模拟器显示首页和账号页；验证账号页进入、关闭后端时的重试回退与返回。调试器界面显示 Errors: 0，Warnings: 1。当前本地包分析约主包 2.54MB、总包 15.22MB，这是工具本地分析，非实际上传报告。

尚未执行：测试后端登录及合法 request 域名联调、真实原生资料授权和隐私流程、菜单/主动分享真实好友链路、正式激励/插屏广告与库存、真实冷启动归因和跨微信账号同步。Android/iOS 的断网/弱网/恢复、后台广告回调、胶囊及安全区、拒绝隐私/资料授权均需实机验收。

### 仍属于外部后端与发布的工作

独立后端需实现 code2Session、AppSecret 管理、内部用户和 session、进度 revision/迁移/operation 去重、资料校验、分享意图与归因防自邀/活动限制、奖励唯一 ledger 及事务、每日 entitlement 查询、事件 ACK 去重、删除用户/撤销 session、合法 HTTPS 域名、监控和限流。当前仓库未创建这些服务器实现或声称其已验证。

真实广告位、隐私后台声明、分享文案审核、体验/生产环境隔离及上传验收尚未执行。保留原有 `daily.debugUnlimitedEntries=true` 开发设置；发布负责人仍需按既有发布要求关闭它。在线能力需按第 26 节顺序启用，当前全部关闭。

### 有意保留的范围

没有增加自定义分享图（使用游戏截图）、独立后端、手机号/支付/排行/多账号冲突解决器、高价值货币、朋友圈奖励、多广告单元 multiton、远程配置或旧小程序页面功能。`DELETE /v1/me` 保留为后端合同，未增加设计范围外的客户端注销操作。首次功能只提供有上限、不可交易的每日额外进入额度。


## 36. 交付复核修复（基于 6e7e1b0）

修复工作位于独立 worktree `/Users/ethan/Projects/ClearedMiniProgram-account-review-fixes`，分支 `codex/account-engagement-review-fixes`，基于交付分支的 `6e7e1b0`。主工作区 main、交付分支和 `/tmp` 中旧审查副本均未修改；不推送、合并或部署。

| 问题 | 最小修复 | 回归证据 |
| --- | --- | --- |
| 首次绑定失败串档 | 先保存 boundUserId，再落盘云快照，最后推进 revision；失败保留归属 | 每个成功写入边界模拟重启、逐次写入失败及持续归属写入失败；B 不收到 A 云进度，A 可恢复；migrationId 和旧本地进度保留 |
| 广告期间会话过期丢请求 | RewardService 接收发起账号，先存既有 pending，再按需认证；原键不能转账号 | 使用真实 SessionStore 与 AdsService：剩 31 秒会话、45 秒观看；认证失败/异常、网络失败、认证为 B、观看中切 B、重复 close、重启回到 A 恢复；提前关闭无 pending/奖励 |
| 返回首页分享缺 sid | App 场景 action 触发预取/缓存复用；过期请求失去覆盖缓存的资格 | 真实首页→通关→选关→首页，及每日成功结果两条返回 action；覆盖账号/过期校验、未完成预取不阻塞分享与迟到结果 |
| 旧增次 action 路由 | 两个 revive 别名在分派前归一化到 extraEntry，共用开关、场景/上下文与 pending 检查 | 开关开/关 × 首页、每日成功结果、每日进行中、选关、账号、失败结果；跨别名并发只请求一次；免费失败重试不扣额外次数、不请求广告 |

四项回归分别扩展在 `tests/progress-sync-conflict.test.js`、`tests/reward-service.test.js`、`tests/share-entry.test.js`、`tests/daily-app.test.js`，均由既有 `tests/run.js` 注册执行；未新增平行复现入口，也未执行固定引用旧副本的脚本来代替验证。

在只加入回归、尚未改实现的实际修复 worktree 中，全量运行恰有上述四组失败，其余 49 组通过（`/tmp/cleared-review-before-tests.log`）。修复后四组通过，最终全量 53 组通过；复跑过程中既有普通/Portal hint 用例分别出现过两次 getViewState 的 elapsedMs 相差 1ms 而失败，代码检查确认该比较包含实时计时字段，未修改这些测试或玩法。失败日志保留在 `/tmp/cleared-review-after-tests.log` 与 `/tmp/cleared-review-portal-clock-failure.log`，最终全量复跑通过。

最终验证：`node tests/run.js` 53 组通过；`node scripts/check-package-budget.js` 全部预算通过，当前 worktree 主包源码 2,666,655 bytes（2.543 MiB）、总包 15,957,595 bytes（15.218 MiB）；`git diff --check` 通过。日志为 `/tmp/cleared-review-final-tests.log` 和 `/tmp/cleared-review-final-budget.log`。此源码统计对应当前 worktree，不把旧工作区统计差异解释为压缩收益。

此次修改不增加存储 key 或字段，不改变 HTTP 请求/响应合同、在线默认关闭配置、核心玩法、关卡、主题、素材或 UI。新增的 claim 第二参数仅存在于客户端服务之间，持久 pending 沿用原 `{userId,input}` 结构。

本次只完成本地客户端修复和 Node 验证。没有对修复版执行后端联调、微信开发者工具在线登录/分享/广告验证、Android/iOS 真机、真实账号切换、流量主库存与发布上传验收。第 35 节开发者工具截图和读数是原交付证据，不是本次修复版的设备证据。

## 37. 提示分享与本地当日许可

在 `f39fee1` 基础上新增提示分享：用户已接受“发起分享流程后解锁，取消也可能解锁”的客户端口径。当时 `hintMode` 为 share，新的 HintAccessService 使用 `cleared:minigame:hint-access:v1` 保存当天已解锁的关卡集合；普通、Portal、每日小关共享记录，同关当天可重复查看。首次分享解锁只更新按钮，再次点击才展示原有完整路径。

提示分享独立于菜单/结果分享开关、认证、share intent、归因和 RewardService。它不发送身份、sid 或存档，不增加每日进入次数。原账号、同步、奖励合同与广告位配置保持不变。

这一步的后续分级策略现已按第 38 节实施。广告条件沿用 `isEnded === true`，包含允许跳过后仍满足条件的情况。

完整规则、原生分享能力限制、存储容量、异步边界、文件清单与回归范围见 [`hint-access-and-sharing.md`](hint-access-and-sharing.md)。本期在既有测试入口新增两组，55 组 Node 测试通过；设备证据与发布检查需单独记录，不能把 Node 结果当成真实发送或正式广告验收。

## 38. 每日分级提示与广告未开通时的分享替代

2026-09-03 基于 `main@cdd3dc7` 实施，工作分支为 `codex/hint-tiered-unlock`。默认 `hintMode: 'tiered'`、`hintRewardedEnabled: false`、广告位留空，实际为每天第一个新关免费，第二个及以后分享；普通、主线 Portal、每日两个小关共用已成功保存的去重关卡数。旧当日许可直接保留，切换策略不额外补发首次免费。

广告发布开关、有效广告位与平台接口同时可用时，第三个及以后新关使用广告。平台达到发奖条件且返回有效 attemptId 才保存本地许可；提前关闭、缺失结果、无库存、加载／展示错误、busy 和广告位不一致不会自动拉起分享。保存失败时保留原目标，任何新关只可先重试该目标，避免重复领取首次免费或重复索取广告。

职责边界保持在配置、平台广告能力查询、AdsService、HintAccessService、EngagementService 和 App 提示编排。未改变关卡／解答、Runner、棋盘输入／渲染、账号／同步、每日额度、RewardService、HTTP 合同或存档 schema；原主页头像改动保留。

完整决策表、代码白名单、存储与方法合同、验收矩阵及广告开通步骤见 [`hint-tiered-unlock-and-ad-fallback.md`](hint-tiered-unlock-and-ad-fallback.md)。本次 56 组 Node 回归和源码包体预算通过；开发者工具与正式广告／真机证据按该文档第 13 节分别记录。
