# 每日提示分级解锁与广告未开通时的分享替代

> 状态：客户端代码与回归已实施，默认启用每日分级规则、关闭提示广告；正式广告与真机验收待执行。实际验证记录见第 13 节。
>
> 编写与官方资料核对日期：2026-09-03。
>
> 已提交代码基线：`main@cdd3dc7`；实现分支 `codex/hint-tiered-unlock`，当前工作区配置为 `hintMode: 'tiered'`、`hintRewardedEnabled: false`。
>
> 本文承接 [`hint-access-and-sharing.md`](hint-access-and-sharing.md)。原文的分享口径、关卡身份、当日存档和提示预览规则继续有效。
>
> 实施时工作区已有主页头像改动；本需求保留了这些改动，独立差异与验证记录见第 13 节。

## 1. 目标与交付范围

实现一套所有关卡共用的当日提示资格规则：

1. 当天首次解锁一个新关卡的提示，免费。
2. 当天第二次解锁一个新关卡的提示，需要发起分享。
3. 当天第三次及以后解锁新关卡，观看广告并达到平台发奖条件后解锁。
4. 广告尚未开通时，第 3 项使用分享替代；第 1、2 项保持不变。
5. 当天已经解锁的关卡可以无限次查看提示，不再分享、看广告或推进次数。

一次实现分级判断、分享替代和广告分支，先以广告关闭配置交付。以后开通广告只切换发布配置与正式广告位，不重写业务流程。

本期不新增独立后端、UV 统计、广告平台申请自动化、远程配置、账号级提示权益或跨设备同步。广告收入、每日挑战进入额度和邀请奖励继续使用各自原有边界。

## 2. UV、普通分享与广告准入

### 2.1 普通分享是否需要 UV 门槛

核对[微信官方《转发》指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/share/share.html)及[普通主动分享接口](https://developers.weixin.qq.com/minigame/dev/api/share/wx.shareAppMessage.html)，公开说明未将 UV 数量或流量主开通作为普通好友／群聊分享的前置条件。

本项目继续使用 `wx.shareAppMessage` 对应的普通卡片分享作为广告未开通时的替代入口，客户端不设置“分享需要达到 500 UV”的判断。当前提示分享不传自定义分享图，沿用现有平台截图行为。自定义素材审核与具体账号的分享能力限制，不能与 UV 门槛混为一谈；本次没有检查该 AppID 的私有后台权限。

普通分享仍采用已经接受的产品口径：**发起分享流程后解锁，取消分享也可能解锁**。不能把 `initiated`、回到前台、停留时长写成“已真实发送成功”。

### 2.2 广告不是只由一个本地数字决定

[微信官方《广告》指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/ad/ad.html)列出多种开通途径，包括累计独立访客超过 500 的途径，以及符合条件的游戏圈运营、同公司主体既有变现项目等途径；还规定了对应的正常运营条件。UV 是累计口径，不是每天 500，官方说明资格会在次日刷新。

因此不得在代码中加入 `uv >= 500`、伪造访客计数、用分析事件数量推断准入，或达到某个数字就自动启用广告。

发布人员以后台实际确认的流量主资格、广告位状态和设备联调结果为准，再显式启用本项目的提示广告开关。SDK 中存在广告接口也不能证明该 AppID 已获得广告准入。

## 3. 次数定义和适用范围

令 `N` 为今天已经成功保存的不同提示解锁关卡数，即现有 `unlockedLevelKeys` 去重集合的长度。

| 当前关卡状态 | N | 广告未启用 | 广告已启用且可请求 |
| --- | --- | --- | --- |
| 今日已解锁 | 任意 | 直接查看 | 直接查看 |
| 今日未解锁 | 0 | 免费解锁 | 免费解锁 |
| 今日未解锁 | 1 | 分享解锁 | 分享解锁 |
| 今日未解锁 | ≥ 2 | 分享解锁 | 广告解锁 |

次数不是提示按钮点击数、分享次数、广告请求数、通关数、广告 attemptId 序号或每日挑战进入次数。

- A 关免费解锁后反复查看，N 始终为 1；再解锁 B 关才进入第二次。
- 解锁后立即离开、未实际查看路径，也已经拥有该关许可，仍计入 N。
- 分享接口明确失败、广告未满足发奖条件、保存失败，均不增加 N。
- 免费资格也必须先成功保存许可，才能显示路径并计入 N。
- 普通与主线 Portal 共享同一套 catalog 身份；Portal 机制不另开次数池。
- 每日挑战的两个小关分别使用各自 dayId/challengeId 身份，与主线共同累计 N。
- 当日重置、重玩、返回首页和重启不清除已经保存的许可。
- 日期按现有 `Asia/Shanghai` 计算，不依赖当天是否配置每日挑战内容。
- 本地时钟和本地存档不承担服务器防刷职责；本期不声称支持跨设备共享次数。

## 4. 广告开关与分享替代

### 4.1 当前配置

仅扩展现有 `src/config/ads.js`，当前配置如下：

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

- `hintMode` 决定提示资格策略；新增 `tiered`，仍是唯一策略入口。
- `hintRewardedEnabled` 仅表示发布配置允许尝试提示广告，不代表 UV 统计结果或实时库存。
- 初次交付保持 `hintRewardedEnabled: false`、提示广告位为空；N ≥ 2 时直接显示分享入口。
- 只有开关严格为 true、提示广告位有效配置且平台支持激励视频接口时，N ≥ 2 才选择广告。
- 开关缺失按 false 处理。空／无效广告位、明确不支持接口的平台均使用分享保护。
- 原菜单、结果分享、后端、账号、事件上传和每日增次开关不随提示广告开启。
- 保留 `free`、`share`、`rewarded` 旧模式及其已有用途；旧 `free` 是全免费回滚模式，不是每日分级的“第一次免费”。
- 未识别模式应返回配置错误或既定安全回退，不可继续沿用“所有非 free/share 值都当 rewarded”的隐式分派。

`hintRewardedEnabled` 与广告位在发布／重新启动时生效。本期不实现运行中的远程运营配置。已展示的按钮状态和点击时的决定都必须来自同一个策略查询，不能各写一套判断。

这里的“有效配置”只要求客户端能确认的非空字符串且无首尾空白，不凭空规定广告位的编码格式。字符串配置合法不代表广告位已通过平台审核或真实可投放；这类平台拒绝按运行失败处理，不归入预先分享替代。

### 4.2 必须区分预先分享替代与广告运行失败

| 情况 | 行为 | 是否解锁／计数 |
| --- | --- | --- |
| 广告未开通，发布开关 false | N ≥ 2 直接提供分享；不创建或请求广告 | 分享发起且许可保存成功后才计数 |
| 开关 true，但广告位为空或无效格式 | 提供分享保护；同时属于发布配置待修正项 | 同上 |
| 平台没有激励视频接口 | 提供分享保护 | 同上 |
| 广告可请求 | 提供“广告解锁”，点击后才请求广告 | 达到平台发奖条件且保存成功后计数 |
| 原生结果 `isEnded === true` | 接受平台发奖资格，包括允许跳过后仍返回 true 的情况 | 计数一次 |
| 提前关闭且 `isEnded === false`，或关闭结果缺失 | 结束本次尝试，恢复广告入口 | 不解锁、不计数、不转为分享 |
| 无库存、加载失败、展示失败或其他错误 | 返回可理解的失败反馈，允许重试广告 | 不解锁、不计数、不自动拉起分享 |
| 另一广告或提示解锁请求仍在进行 | busy，保持原请求 | 不再拉广告／分享、不计数 |
| 广告单例的广告位不一致 | 保留 unit-mismatch 错误，修正配置 | 不解锁、不用分享掩盖配置错误 |
| 许可已确认但保存失败 | 显示“重试保存” | 不计数，重试不得再分享或看广告 |

本期只增加**已知广告未启用／未配置／接口不支持时的预先替代**。临时库存不足时的备用分享入口不属于本期；若以后增加，需要单独定义用户主动点击、失败范围和有效期，不能从任意失败回调自动弹分享。

禁止把 `busy`、`closed` 或所有 `rewarded:false` 统一解释为“广告未开通”。也不能为了获得替代入口而主动请求一个空广告位、等待失败后再分享。

## 5. 广告完成、展示时机与按钮

统一使用用户确认的表述：**观看广告并达到平台发奖条件后解锁**。标准见[微信官方激励视频说明](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/ad/rewarded-video-ad.html)。

AdsService 继续根据 `onClose.isEnded === true` 产生 `rewarded:true`。上层只消费它的标准结果和有效 attemptId；不自己观察跳过按钮、不按 15/30/60 秒计时、不用 onHide/onShow、加载成功或 `ad.show()` Promise 成功代替发奖条件。

| 状态 | 按钮文案 | 点击结果 |
| --- | --- | --- |
| 第一个新关，N = 0 | 免费提示 | 校验解答、保存许可后立即显示路径 |
| 需要分享，包括广告未开通时的替代 | 分享解锁 | 同步发起分享；保存成功后等待再次点击 |
| 需要广告 | 广告解锁 | 请求广告；资格确认并保存后等待再次点击 |
| 分享／广告请求进行中 | 处理中 | 禁用新解锁请求 |
| 存储失败，有待保存资格 | 重试保存 | 仅重试已有资格的保存 |
| 本关今日已解锁 | 查看提示 | 显示原有完整路径 |
| 路径预览显示中 | 隐藏提示 | 立即关闭预览，不推进 N |

分享与广告完成后都只解锁，不在外部界面或后台启动 10 秒预览。用户再次点击“查看提示”才开始计时。免费成功可以同一次点击显示，因为没有外部界面；保存重试成功统一只刷新状态，避免误展示其他关卡的路径。

2026-09-07 新增主线冰封教学 `4:105`，提示资格与当天计数仍遵守上述规则；仅展示方式为 9 步手动预览，左右滑动或点击箭头切步，不自动推进/超时，点“隐藏提示”退出，局内计时不暂停。试玩来源仍免费、不占每日计数，不能将其例外扩散到主线冰封。其他题的 10 秒预览不变，下一次请求仍重新校验当日资格。详见 [冰封教学](ice-trial.md)。

无库存／加载失败可以显示“重试广告”，但不展示 UV、流量主资质、广告位 ID 等实现信息。失败后的显示不改变资格策略。

按钮位置、44/50 像素等既有控件尺寸、安全区、图标和棋盘布局不因本需求重做。Renderer 只消费文案与 enabled 状态。

## 6. 单一策略查询与服务合同

### 6.1 上下文与状态

沿用纯上下文 `{ scene, dateKey, levelKey }`；不把 Runner、Canvas、平台对象或业务回调交给提示访问记录。

`EngagementService.hintState(context)` 是策略查询的唯一入口。当前未解锁且 N ≥ 2、广告关闭时的返回示例：

```js
{
  ok: true,
  mode: 'tiered',
  unlocked: false,
  unlockCount: 2,
  requiredAction: 'rewarded',
  action: 'share',
  fallbackReason: 'ads-not-enabled'
}
```

`requiredAction` 表示每日序号对应的要求；`action` 表示当前实际可执行动作。二者的区分用于防止文案显示“广告”，执行时却走“分享”。不把 action 当成存储计数。

动作顺序必须固定：

1. 校验上下文及日期。
2. 本关已解锁：view；即使其他关有待保存资格，也允许查看已解锁关。
3. 存在已确认但未保存的资格：retry-save，先处理它。
4. 其他提示解锁仍在进行：busy。
5. 容量或数据校验不允许新解锁：unavailable，避免先看广告再发现存档装不下。
6. N = 0：free；N = 1：share。
7. N ≥ 2：检查广告发布开关、广告位与平台接口能力，选择 rewarded 或 share。

查询不能创建广告对象、调用 show/load、生成 attemptId、发起分享或增加 N。既有自然日到期清理仍只由 HintAccessService 管理。

### 6.2 解锁请求

`requestHint(context)` 显式分派 tiered；不能直接让 tiered 落进旧 rewarded 分支。可在现有 EngagementService 内提取共用的分享发起／保存辅助方法，但不新增通用策略引擎或回调注册框架。

```text
App 提示入口
  ├─ 当前正在预览 → 隐藏
  ├─ 存在待保存资格 → 只重试它，不验证或解锁新目标
  └─ 预检当前完整解答
       → Engagement 重新查询当前资格并取得全局请求占位
       ├─ view → 直接显示
       ├─ free → 保存本关许可 → 显示
       ├─ share → 发起 shareHint → 保存本关许可 → 等待再次点击
       └─ rewarded → AdsService.showRewarded('hint')
                         → 平台确认可发奖 → 保存本关许可 → 等待再次点击
```

新请求在任何异步操作前复制原日期、关卡键、实际动作并占位。占位维持到资格提交完成或明确失败；页面切换清理的是 UI 请求，不能提前解除服务层的并发保护。

分享替代仍须在用户手势内同步调用现有 `ShareService.shareHint`，不能先 await 登录、网络、广告请求或计时器。保持 `sv=1&scene=home` 普通卡片合同，不增加 share intent、邀请奖励或私人字段。

所有新策略返回值明确携带模式及登记目标：

```js
{
  ok: true,
  mode: 'tiered',
  action: 'rewarded',
  dateKey: '2026-09-03',
  levelKey: 'catalog:0:0',
  granted: false,
  unlocked: true
}
```

- `granted` 只表示本次点击可以立即显示路径；不能仅凭它推断已经保存了当日许可。
- `unlocked` 表示返回目标的许可已成功保存；目标可能是切关前的关卡。
- 新免费许可保存成功可返回 granted:true；新分享／广告许可保存成功返回 granted:false、unlocked:true。
- 已解锁的 view 返回 granted:true。保存重试成功返回 granted:false，即使重试目标恰好是当前关卡。
- 失败返回 ok:false、granted:false 和明确 reason；禁止一边报告解锁失败一边增加 N。
- 不修改 AdsService 原有 `{rewarded, reason, attemptId, ...}` 标准结果，也不把它与本合同的 granted 混用。

## 7. 存储、保存重试与免费次数保护

### 7.1 保留现有磁盘结构

继续使用 `cleared:minigame:hint-access:v1`：

```js
{
  schemaVersion: 1,
  dateKey: '2026-09-03',
  unlockedLevelKeys: ['catalog:0:0']
}
```

不增加平行计数器、独立“免费券”、分享次数、广告次数或第二套解锁列表。不升级普通进度、每日挑战或同步的存储 key。

关卡键、日期算法、去重、1024 个键的单日容量与非法数据过滤沿用现有合同；策略服务不读取或修改可变内部数组。

### 7.2 待保存资格也必须参与全局互斥

只用 `hintPending` 保护网络／广告 Promise 不够。例如 A 关免费资格已经确认，但保存失败，N 仍为 0；若这时允许 B 关再取一次免费，之后又恢复 A，就会得到两次首次免费。

必须保证：**一个已确认资格尚未保存时，不接受另一个新关卡的资格申请。** 重复查看已解锁关不受影响。

HintAccessService 的查询已增加只读 `pendingSaveContext`，返回最早的待保存目标副本，并提供 `retryPendingSave()`。`canUnlock` 在渠道请求前报告容量；保留现有 `pendingSave` 对当前关卡的含义，兼容旧 share 模式；App 和 Engagement 不直接遍历内部 Set。

- 当前关或其他关点击“重试保存”，都保存原资格的日期和关卡，不把资格转移到当前新关卡。
- 保存成功只登记原目标一次、刷新 N 和当前按钮。若当前是 B，不显示 A 的解答，也不顺便解锁 B。
- retry-save 应先于新目标的完整解答预检，因为它只修复已经确认的资格，不为当前目标请求新资格。
- 新 tiered 流程一次最多产生一个待保存资格。若同进程已有旧 share 模式留下的多个资格，按原顺序重试，不能丢弃它们来获得新的免费资格。
- 失败不增加 N、不再看广告／分享，也不在同一调用中改走其他方式。

资格确认后立即同步尝试保存，再处理 UI；不把保存延迟到 onHide 或下一次点击。写入失败回滚访问记录，保留当前进程的待保存资格。

本期仍是本地许可：如果持久存储持续失败后进程被终止，未落盘资格无法恢复；不能把一个“广告曾开始”的标记当作完成证明。若将来要求这种情况下也保证无需再次观看，需要另行设计可靠的权益恢复方案，不能伪造完成结果。本期不为此新增 RewardService 账本、后端或无效的第二个存储队列。

## 8. 生命周期与模式切换

- 回调先处理原目标许可，UI 再检查 scene、runSequence、Runner、dateKey 和 levelKey。
- 切关／重置后，已确认的合法许可可登记给原关卡；不得在新关自动显示提示或把资格改给新关。
- 用户关闭广告但未达到发奖条件，释放占位，不登记待保存资格。
- App 销毁继续复用 AdsService.dispose 结清 pending 的行为；不向已销毁 UI 发消息。
- 普通 onShow 不直接解锁，不推进 N；禁止从后台停留时间推断广告或分享成功。
- 午夜后的新请求使用新自然日。旧日期的迟到资格不写入新日；用户重新请求新日资格。
- 午夜前已开始的 10 秒预览允许自然结束；结束后再次查看必须检查新日许可。
- 将 hintMode 从 share 切到 tiered 时，保留当天已有集合并计入 N，不清档、不补发一次免费、不撤销旧解锁；次日自然进入新规则的首次免费。
- 广告开关从 false 切到 true，或回滚为 false，均不改变 N 和既有许可。需要新的广告资格时才使用新的渠道。
- 只关闭广告时保持 hintMode 为 tiered；不要改回 share，否则第一次免费规则也会被撤回。

## 9. 生产代码边界

### 9.1 允许修改的文件及函数

| 文件 | 必要修改范围 | 禁止扩张 |
| --- | --- | --- |
| `src/config/ads.js` | 新增 tiered 模式及 hintRewardedEnabled，初始 false；保留原广告位字符串结构 | UV 阈值计算、改账号/每日次数开关、填入虚假正式广告位 |
| `src/services/engagement-service.js` | hintState、requestHint、提示专用共用流程、全局 hintPending；依据 N 决定资格和预先分享替代 | Runner/Canvas 依赖、UV 上报、修改 dailyExtraEntry、shareResult 或普通结算流程 |
| `src/services/hint-access-service.js` | status 的只读待保存目标/容量查询，retryPendingSave，现有 unlock 的必要保存协调 | 选择广告/分享策略、引用 AdsService/ShareService、改磁盘 key/schema、增加平行计数 |
| `src/services/ads-service.js` | isRewardedConfigured 的必要字符串校验、无副作用的 isRewardedSupported 查询；复用 showRewarded | 写提示存档、根据失败自己发分享、改插屏频控、multiton 重写或“跳过即成功” |
| `src/platform/wechat.js` | 增加 supportsRewardedVideoAd，只检查原生接口是否存在 | 创建广告作能力探测、猜测 UV/准入、修改资料授权或分享 API 语义 |
| `src/app.js` | hintButtonLabel、requestHint、提示状态字段/必要上下文；统一处理 tiered 返回目标、日期、请求 guard 和重试保存 | 修改主页头像、账号页、resumeOnline、通关结算、每日进入、棋盘或求解规则 |

平台查询链为 `Engagement -> AdsService.isRewardedSupported -> WechatPlatform.supportsRewardedVideoAd`。只有平台适配层可以读取 wx 全局。AdsService 的支持查询与 isRewardedConfigured 不代表广告有库存。

`AdsService.showRewarded/getRewarded/finishRewarded` 原有的单例、busy、加载重试、清理和 isEnded 语义应保持。若实现发现这里确有阻塞本需求的缺陷，先给出复现和最小修复，不借机替换整个广告服务。

### 9.2 优先复用、通常不需要修改

| 文件 | 复用方式／允许的极小例外 |
| --- | --- |
| `src/bootstrap.js` | 已注入 ads/share/hintAccess，并复制 adConfig.rules，新字段可自然到达 Engagement；通常无需修改。若证明缺少参数，只改提示相关构造/注入行 |
| `src/services/share-service.js` | 直接复用 shareHint 与 initiated 口径；通常无需修改，菜单/结果/归因逻辑冻结 |
| `src/ui/canvas-renderer.js` | 已消费 hintLabel 和 hintAvailable，新增文案由 App 提供；只有现有接口不足时，限 drawPlayActions/drawDailyActions 的文案/禁用消费 |
| `src/services/daily-challenge-service.js` | 已导出日期算法，无需再新增或复制时区实现 |
| `src/app.js` 的 resolveCompleteHint/showHint/showDailyHint | 复用预检和展示；只允许必要调用次序调整，不改变解答内容、预览时长、初始棋盘 ViewModel 或真实 Runner |

### 9.3 硬性保护区

以下区域不应出现在本功能差异中：

```text
core/**
data/**
assets/**
src/gameplay/**
src/mechanics/**
src/skins/**
src/effects/**
src/ui/board/**
src/services/hint-service.js
src/services/hints/**
src/services/progress-store.js
src/services/daily-progress-store.js
src/services/auth-service.js
src/services/profile-service.js
src/services/api-client.js
src/services/progress-sync-service.js
src/services/reward-service.js
src/services/behavior-service.js
src/config/backend.js
src/config/engagement.js
src/config/daily.js
game.js / game.json / project.config.json
pages/** / app.js / app.json / app.wxss
```

不新增通用广告路由器、策略注册框架、事件总线、npm 运行依赖、第二套提示权限服务或运行时构建 UI。状态仍归现有服务所有，App 负责编排，Renderer 消费纯模型。

## 10. 测试与文档边界

| 文件 | 当前覆盖或保留的职责 |
| --- | --- |
| `tests/engagement-service.test.js` | 保留旧模式分派回归，新增未知模式拒绝 |
| `tests/hint-access-service.test.js` | 只读待保存目标、原目标重试、计数与既有存储兼容 |
| `tests/hint-tiered.test.js`（新增） | 真实 App action + 实际服务组合；分级与失败矩阵、全局互斥、跨关免费保存恢复、生命周期、共享计数、重启及生产 bootstrap |
| `tests/hint-share.test.js` | 保留显式 share 模式回归；更新当前默认配置相关断言，不能继续宣称生产默认 share |
| `tests/ads-service.test.js` | 能力查询无副作用、平台结果 true/false/缺失、重复回调与标准 attemptId |
| `tests/app-smoke.test.js`（未修改） | 保留原预览和免费回滚回归；新增 tiered 的 guard、预检与展示时机由 hint-tiered 覆盖 |
| `tests/renderer-button.test.js` | 免费提示、广告解锁、重试广告/保存等文案在窄屏中保持原触摸区域 |
| `tests/architecture-boundaries.test.js`（未修改） | 继续执行既有 core/平台/奖励边界断言 |
| `tests/run.js` | 注册新增测试组，保留所有原测试 |
| 本文、`docs/hint-access-and-sharing.md`、`docs/user-account-sharing-ads-integration.md`、README | 实施后同步真实模式、开关、存储、方法合同和验收证据 |

原纯求解器与 Portal 规则测试原则上无需修改。回归必须在错误实现下失败；不能通过删测试、改成全免费或强制旧 share 配置来冒充新生产策略验证。

## 11. 必须通过的验收矩阵

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| T01 | 新日 N=0，后端关闭、无广告位 | 免费保存并显示；分享/广告调用均为 0 |
| T02 | A 已解锁，连续查看/隐藏/重玩 | N 保持 1，不再请求任何渠道 |
| T03 | 第二个新关 B | 发起分享后登记；再次点击才显示 |
| T04 | N≥2、广告开关 false，但意外填了 ID | 显示分享；广告创建/show/attemptId 生成均为 0 |
| T05 | N≥2、开关 true、广告位空或无效 | 分享保护，不空调用广告 |
| T06 | N≥2、开关 true、ID 有效、SDK 不支持 | 分享保护；没有原生广告调用 |
| T07 | N≥2、开关 true、ID 与 SDK 有效 | 只请求激励视频，不发分享 |
| T08 | 视频可跳过且回调 isEnded=true | 本关解锁一次；不要求固定观看秒数 |
| T09 | 提前关闭 false／结果缺失／show Promise 成功但未关闭 | 不解锁、不计数，不自动分享 |
| T10 | 无库存、加载/展示错误、busy、unit-mismatch | 各自返回失败/忙碌；不当成广告未开通 |
| T11 | 重复关闭回调、重复领取、按钮连点 | 单个原目标只登记一次，单个请求只有一个渠道 |
| T12 | N=0 免费保存失败，然后切到 B | B 先重试原资格，不产生第二次首次免费；N 只在保存成功后增加 |
| T13 | 分享/广告达标但保存失败 | 重试保存不再分享/看广告；失败期间不接受另一新资格 |
| T14 | 在 B 点击重试，实际待保存目标是 A | 只保存 A，不显示 A 路径、不解锁 B |
| T15 | 存档未失败，广告达标后立刻离开原关 | 原关当天许可保留，新关没有额外许可或自动预览 |
| T16 | 切关、重置、销毁后迟到结果 | 不更新错误 UI，不把资格转给新关 |
| T17 | 广告/分享中跨越上海午夜 | 旧申请不进入新日计数；新请求按新日规则执行 |
| T18 | 午夜前已经显示的 10 秒预览 | 正常结束；下次查看按新日许可 |
| T19 | 当前关没有有效完整解答，或棋盘正在拖动 | 不申请新资格、不弹分享/广告、不计数；已有保存重试可单独处理 |
| T20 | 普通、主线 Portal、每日两个小关依次解锁 | 共用 N，四个关卡身份互不混淆 |
| T21 | 当天重启，或 share→tiered 模式迁移 | 原许可与 N 保留，不补发免费、不重复收费 |
| T22 | 广告开关开启／回滚 | 新关按当前渠道，旧许可与 N 不变 |
| T23 | 查询状态或重复绘制按钮 | 不拉起渠道、不创建广告、不分配 attemptId、不增加 N |
| T24 | 存档损坏、非法键、容量达到上限 | 保持既有过滤/上限；不先让用户看广告再拒绝保存 |
| T25 | 原普通、Portal、每日流程与主题、存档回归 | 全部保留；提示不改变真实棋盘或每日进入额度 |

代码验证入口：

```sh
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

测试文件须由 tests/run.js 聚合，直接运行一个导出 run 的测试文件不算执行。原 55 组继续保留，本次新增分级集成组后共 56 组；实际运行记录见第 13 节。

## 12. 分阶段交付与广告开通切换

### 阶段 A：本地实现与广告关闭交付

完成完整 tiered 代码、分享替代、免费保存及广告结果处理，用测试替身覆盖有效广告与失败分支。默认启用 tiered，但保持提示广告开关 false。开发者工具验证实际“免费→分享→分享”、已解锁重复查看、窄屏与回流。

### 阶段 B：平台开通后的配置与设备验收

1. 发布人员在微信后台确认准入已经生效，不仅是自行统计满足 UV。
2. 创建并确认正式激励视频广告位，取得 hint 广告位 ID。
3. 在体验环境配置 ID 与 hintRewardedEnabled=true。若同时启用每日增次，两个 placement 继续遵守现有单例同广告位约束。
4. 在 Android/iOS 验证“免费→分享→广告”、平台允许跳过且可发奖、提前关闭、无库存、后台回调、保存重试、跨日与重启。
5. 验证通过后再发布广告开启配置。不因 Node 或模拟器广告替身通过，就声称正式广告已验收。

### 回滚

运营未就绪或需要停止提示广告时，将 hintRewardedEnabled 改回 false，保持 tiered；N≥2 自动使用分享，已有当日许可不撤销。完整策略回滚为旧模式是另一项明确发布决定，不得用删除提示存档来实现。

## 13. 本次实现与验证记录

实现日期：2026-09-03。范围为第 9 节中的 6 个生产文件：ads 配置、EngagementService、HintAccessService、AdsService、WechatPlatform、App 的提示方法。复用 shareHint、bootstrap 注入、原 Renderer 与提示求解／预览；没有新增生产模块或改写存档结构。原主页头像改动完整保留。

新增 `tests/hint-tiered.test.js` 并加入 tests/run.js；更新 5 个已有测试文件，复用 share 测试里的每日小关完成助手。集成测试使用实际 App、平台适配器、访问记录、广告与分享服务，通过原 action 和真实 bootstrap 验证默认配置；原生分享／广告由测试替身提供，不把替身结果作为正式广告证据。

- `node tests/run.js`：56 组通过，日志 `/tmp/cleared-tiered-hint-verified-tests.log`。此前两次运行的原 Portal 测试在 `tests/hint-service-portal.test.js:101` 因 elapsedMs 跨 1 毫秒失败；未修改或放宽该断言，失败日志保留在 `/tmp/cleared-tiered-hint-tests.log`、`/tmp/cleared-tiered-hint-tests-2.log`。
- 包体源码估算：主包 2,723,707 bytes（2.598 MiB），总包 16,014,647 bytes（15.273 MiB），全部预算通过；日志 `/tmp/cleared-tiered-hint-budget.log`。最终上传包仍须由开发者工具分析。
- `git diff --check` 通过。与任务开始前的文件快照逐项比对，本次修改共 17 个文件（6 个生产文件、7 个测试文件、4 个文档）；Renderer、账号 App 测试和 Renderer 测试中的原头像改动字节一致，App 账号方法与文档账号入口段落保留。边界比对记录 `/tmp/cleared-tiered-boundary-check.json`，本次独立差异 `/tmp/cleared-tiered-task.diff`。
- 微信开发者工具 Stable 2.02.2608060、基础库 3.16.2 于 16:06 重新编译，首页与原头像正常显示，Errors: 0、Warnings: 1（平台 HarmonyOS 提示）。截图 `/tmp/cleared-tiered-hint-devtools-home.jpg`，状态 `/tmp/cleared-tiered-hint-devtools-state.txt`。自动点击未能稳定进入关卡，因此此次只记录编译与首页证据；免费／分享按钮的实际触控、窄屏、取消回流和后台恢复仍待设备验收。
- 广告位仍为空、hintRewardedEnabled 为 false；当前真实交付规则是免费→分享→分享。真实流量主准入、正式广告回调和 Android/iOS 验收尚未执行，后续按第 12 节开启。
