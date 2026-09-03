# 提示分享与当日关卡解锁

分享基础实现基线：`main@f39fee1`，已合入 `main@cdd3dc7`。2026-09-03 在此基础上实现每日分级规则，当前默认 `tiered`、提示广告关闭。本文记录共用的本地许可与分享合同，分级决策和实现验收见 [`hint-tiered-unlock-and-ad-fallback.md`](hint-tiered-unlock-and-ad-fallback.md)。普通关卡、主线 Portal、每日挑战使用统一入口。

## 1. 已确认的产品口径

- 当天第一个新关免费，第二个新关分享，第三个及以后按广告能力使用广告或分享；默认广告关闭。次数以成功保存的不同关卡数计算。
- 分享继续采用发起流程即满足本地条件的口径，取消分享也可能解锁。
- 分享／广告达标并保存许可后，按钮变为“查看提示”。用户再次点击才展示路径，不在外部界面覆盖游戏时启动预览计时；首次免费保存成功立即展示。
- 当天已解锁的关卡可以无限次查看。每次仍显示 10 秒，点击“隐藏提示”可立即关闭。
- 重置、重玩、退出关卡和当天重启不撤销已保存的许可。普通与每日的求解、初始棋盘预览和 Runner 状态不改变。
- 普通、Portal、每日小关共享同一份本地日记录；每日挑战的两个小关分别解锁。
- 自然日沿用 `Asia/Shanghai`，不依赖当天是否存在每日挑战内容。日期到来后重新解锁。
- 共享范围是同一设备的本地游戏数据。本期不增加账号登录依赖、跨设备同步或服务端提示权益。

微信普通好友分享接口只发起转发，没有可信的发送完成回调。`initiated` 不等于发送成功；普通回前台、停留时长、点击取消均不产生“已成功发送”的证明。接口基线见[微信官方分享类型](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts#L7552-L7570)。

本地提示许可不属于邀请归因、每日增次或货币奖励。它不能调用 reward-claims，也不能作为这些奖励的凭证。

节日主题使用独立 `ShareService.shareReward()` 入口和独立本地奖励存档；它复用原生分享发起能力，但不调用 `shareHint()`，也不读取或推进本节的提示许可／次数。详见 [`reward-unlock-system.md`](reward-unlock-system.md)。

## 2. 当前策略与旧模式

“每日首次免费、第二次分享、第三次起广告，广告未开通时改为分享”已接入运行时。普通分享公开接口未设 UV 前置条件，客户端不统计 UV 或用 UV 自动启用广告；官方准入依据与后续开通步骤见分级文档第 2、12 节。

`src/config/ads.js` 的 `rules.hintMode` 是唯一策略入口：当前 `tiered`。`hintRewardedEnabled` 默认 false，仅控制第三个及以后新关是否允许尝试广告。保留旧 `share`（每个新关分享）、`free`（全免费回滚）和 `rewarded`（原单局广告提示）模式。

| 场景 | 当前默认：广告关闭 | 开关、广告位与接口均可用 |
| --- | --- | --- |
| 当天第一个新解锁关卡 | 免费解锁 | 免费解锁 |
| 当天第二个新解锁关卡 | 发起分享后解锁 | 发起分享后解锁 |
| 当天第三个及后续新关卡 | 发起分享后解锁 | 观看广告并达到平台发奖条件后解锁 |
| 当天已经解锁的关卡 | 无限查看 | 无限查看 |

累计单位是成功保存一个新关卡的解锁。同关重复查看不会推进次数。广告预先替代只适用于开关关闭、ID 未有效配置或接口不支持；实际广告提前关闭、无库存、出错、busy 或 unit-mismatch 不会自动拉起分享。

广告规则统一表述为“观看广告并达到平台发奖条件后解锁”。沿用 AdsService 对 `onClose.isEnded === true` 的判断：即使广告允许跳过，只要回调为 true 就满足；false、报错或缺失结果不满足。不能凭出现“跳过”按钮或本地计时发放许可。[微信官方广告关闭结果](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts#L7061-L7066)

## 3. 存储合同

沿用独立 key `cleared:minigame:hint-access:v1`，分级规则不新增字段：

```js
{
  schemaVersion: 1,
  dateKey: '2026-09-03',
  unlockedLevelKeys: ['catalog:0:0']
}
```

- 普通与主线 Portal 使用 `catalog:<setIndex>:<levelIndex>`，校验现有 catalog 坐标；不使用显示编号、主题或 run 序号。
- 每日使用 `daily:<encoded dayId>:<encoded challengeId>`。两个标识独立 URI 编码，恢复时校验长度、控制字符与规范编码，避免分隔符碰撞。App 只从当前有效每日关卡创建上下文。
- `unlockCount` 从去重集合长度派生，不另存计数字段。查询返回标量与待保存目标副本，不暴露可变集合。
- 仅保留当前自然日；单日最多 1024 个不同键。如果后续内容能在一天提供超过此数量，必须先升级容量合同与测试，再增加内容。
- 损坏格式、非法普通坐标、重复键和不支持的 schema 被过滤或回退为空记录。原普通进度、每日次数、session、同步和奖励存储 key 均不变。
- 新解锁使用内存副本保存；失败回滚，访问权仍未解锁。资格暂留当前进程，可点击“重试保存”，不再重复拉起分享或广告。tiered 在切关后也先保存原目标，阻止第二份首次免费；保存成功只更新状态，不立即展示路径。无法写盘时退出进程，该临时资格无法恢复。
- 跨日旧请求不能写入新日。旧日许可即使因存储异常未能清理磁盘，也不在新日生效。
- 本地日期与本地许可不作为后端防刷或账号权益证明。

## 4. 运行链路与异步边界

```text
play:hint / daily:hint
  -> App 检查场景和 Runner
  -> 已显示预览：隐藏
  -> 已有待保存资格：只重试原目标，不验证新目标解答
  -> 其余情况预检拖动状态和完整解答
  -> EngagementService.requestHint 使用 hintState 的同一策略
       -> view：直接展示
       -> free：HintAccessService.unlock 保存后展示
       -> share：ShareService.shareHint -> initiated:true -> 保存后等待点击
       -> rewarded：AdsService.showRewarded -> rewarded:true -> 保存后等待点击
```

提示分享同步发起原生接口，不在用户手势与接口调用之间等待网络。使用当前游戏截图、通用标题和 `sv=1&scene=home`，不创建 share intent、不携带 sid、身份或存档。菜单与结果分享的开关、成功结果限制和归因行为保持原合同。

`granted` 仅表示本次点击可立即显示路径；新分享／广告解锁返回 `granted:false, unlocked:true`，模式与原 dateKey/levelKey 一起返回。首次免费与已解锁后的点击返回 `granted:true`。保存失败返回 `persist-failed`；重试成功返回原保存目标且 `granted:false`。

全局最多一个提示解锁请求。请求复制日期、关卡键、实际动作与来源场景；登记资格始终属于发起的关卡。切换或重置后可以保存原关卡的许可，但 App 的 scene/run/Runner/dateKey/levelKey guard 禁止迟到结果显示新预览。销毁后不更新 UI，普通 onShow 不登记许可。

## 5. 文件与职责边界

| 文件 | 当前职责 |
| --- | --- |
| `src/services/hint-access-service.js` | 日记录、关卡键、去重保存、错误恢复；不依赖平台全局、网络或求解器 |
| `src/services/engagement-service.js` | 唯一分级决策、广告预先分享替代、全局 pending 与保存重试 |
| `src/services/ads-service.js`、`src/platform/wechat.js` | 无副作用的广告能力查询、既有广告结果与生命周期 |
| `src/services/share-service.js` | 专用 shareHint 与共用原生分享调用适配，结果分享条件不变 |
| `src/app.js` | 统一入口、有效解答预检、上下文、guard、按钮状态和原预览编排 |
| `src/bootstrap.js` | 显式构造、注入 HintAccessService |
| `src/config/ads.js` | hintMode 为 tiered，hintRewardedEnabled 为 false；广告位留空 |
| `src/services/daily-challenge-service.js` | 只导出现有纯日期函数，复用已有时区回退 |
| `src/ui/canvas-renderer.js` | 普通与每日按钮的文案和现有禁用状态，不改位置、尺寸或棋盘 |

不修改 core、关卡与解答数据、HintService/providers、棋盘输入与渲染、机制/主题/特效 manifest、账号同步或每日增次奖励实现。

## 6. 验证与发布边界

- `tests/hint-access-service.test.js`：重复解锁、来源隔离、共享计数、重启、上海午夜、旧请求、保存失败、损坏数据、容量上限。
- `tests/hint-share.test.js`：保留显式 share 模式的真实 App 触摸/action 路由、同步发起、取消可能解锁、二次点击展示、重复查看、重玩、普通/Portal/每日两小关、后台、重启、跨日、迟到和销毁、保存重试。
- `tests/hint-tiered.test.js`：当前生产 bootstrap 默认配置、免费→分享→广告／替代分享、能力查询、失败分类、全局保存恢复、跨日与切关 guard；复用既有每日小关完成助手。
- `tests/renderer-button.test.js`：280/320/390 宽度下各种按钮文案与图标间距；触摸矩形保持一致。
- 原路径和 Runner 回归继续运行；显式 free 回滚仍立即显示。分级实现的当前验证记录见分级文档第 13 节。

本地执行 `node tests/run.js`、`node scripts/check-package-budget.js`、`git diff --check`。微信开发者工具与真机须另行检查原生分享拉起、取消后的状态、后台恢复、窄屏和安全区；Node 测试不能证明真实好友发送或替代设备验收。

## 7. 原分享版本验证记录（历史）

- 分支 `codex/hint-share-unlock`，基于 `f39fee1`；共 17 个任务相关文件（新增 4、修改 13），保护区无变更。
- 最终 `node tests/run.js`：55 组通过，日志 `/tmp/cleared-hint-share-verified-tests.log`。此前一次复跑中，未修改的 `tests/hint-service-portal.test.js:101` 因两次实时状态读取的 elapsedMs 从 0 变为 1 而失败；该既有计时波动的日志保留在 `/tmp/cleared-hint-share-final-tests.log`，没有删除或放宽原断言。
- 包体源码预算通过：当前工作区主包 2,716,205 bytes（2.590 MiB），总包 16,007,145 bytes（15.266 MiB）；日志 `/tmp/cleared-hint-share-final-budget.log`。这是源码估算，不是上传后包体。
- 微信开发者工具 Stable 2.02.2608060、基础库 3.16.2 已重新加载项目，首页和关卡正常，观察到“分享解锁”“查看提示”，并检查了 Portal 完整路径与“隐藏提示”显示。控制台为 Errors: 0、Warnings: 1（平台 HarmonyOS 提示）。截图 `/tmp/cleared-hint-preview-devtools.jpg`。
- 工具自动点击过程中存在交互不稳定，未据此宣称原生好友分享、取消回流和设备重启链路全部验收。该历史记录不作为当前分级策略或整体发布门禁完成的证据。
