# 高难关卡／每日挑战模式设计与实现边界

> 设计记录：2026-08-31  
> 需求状态：已确认每日两关、每日进入次数 3 次；本文是实现契约。  
> 实现状态：每日两关、每日 3 次进入、镂空规则、独立存档和主页入口已接入；棋盘输入、提示与渲染已迁入共享架构。阶段 6 已关闭 checked-in 的无限调试入口；广告/分享增次、复活和货币仍未实现。
> 运行时：微信小游戏单 Canvas 链路 game.js → src/bootstrap.js → src/app.js → src/ui/canvas-renderer.js

## 1. 已确认的产品规则

主页入口和模式标题分开使用：

- 主页按钮文案：**每日挑战（3/3）**，括号内动态显示剩余次数/上限。
- 进入后的页面/玩法标题：**每日挑战**。
- 每个自然日提供 **2 关**，按顺序游玩：
  - 第 1 关：入门关，**3 列 × 3 行、2 种棋子（2 条线）**，目标是非常简单。
  - 第 2 关：极难关，**8 列 × 10 行**，允许配置镂空格，目标难度接近“羊了个羊”式的高门槛。
- 每日默认最多进入 **3 次**。一次“进入”代表开始一轮每日挑战，完成第 1 关后进入第 2 关不再扣次数。
- 自动化测试可显式注入无限次进入，以便反复验证两关流程；checked-in 运行配置不得开启，正式模式默认上限为 3。
- 当前轮次离开后重新进入、结果页重玩，均视为再次进入；次数用尽后不能再开始。
- 后续可通过广告、分享等方式增加进入次数，并增加“复活”按钮；本阶段只预留扩展接口，不接广告、分享、复活或货币。
- 第 2 关通关后产生一次每日完成奖励资格。货币名称、数量、余额、兑换、皮肤解锁和其他消费逻辑暂不实现。

普通关卡统一按 1—137 连续编号，题面最大为 8×8；前 32 关不变，105 个 8×8 按 [难度系统](level-difficulty-system.md) 固定顺序开放，已完成/永久解锁题保留访问。主线普通/Portal 混排，冰块不加入，继续使用独立的普通进度和普通统计。本轮不改每日内容和规则。
8×10 只保留在高难／每日挑战中；每日两关不是 catalog-v2 中的额外普通关卡。

## 2. 附件截图的适用范围

附件只作为现有视觉基线：橙色背景、顶部音效入口、中央 Logo、圆角按钮和按钮层级。截图中的完成数字、按钮尺寸和旧文案不硬编码。

主页主按钮从上到下固定为：

~~~text
高难关卡（进入每日挑战）
回廊（进入主题／特效）
继续游戏／开始游戏
~~~

回廊入口复用原主题按钮的位置；`home:themes` 仍作为兼容 action，但不再注册为首页可见 hit。回廊和消除特效的完整契约见 [`docs/corridor-and-clear-effects.md`](corridor-and-clear-effects.md)。

## 3. 范围与非目标

### 3.1 本阶段支持

- 主页新增稳定命中 ID home:dailyChallenge。
- 独立 daily 棋盘场景和 dailyResult 结果场景。
- 每日包内两个有序 level；第 1 关完成后只在当前轮次内切到第 2 关。
- 每日进入次数、每日完成状态和重复结算幂等。
- 第 1 关 3×3/2 线、第 2 关 8×10/镂空。
- 为未来奖励层保留 onDailyCompleted 完成事件和次数增加接口边界。

### 3.2 明确不做

- 不把每日 level 加入 data/catalog-v2.js、catalog.sets、data/solutions.js 或 ProgressionService。
- 不把每日完成写入普通 ProgressStore.state.completed、bestMs、lastPlayed 或 stats.totalClears。
- 不调用 ProgressStore.recordCompletion() 或普通 AdsService.onLevelCompleted() 结算每日奖励。
- 不接入广告、分享、复活按钮、货币账本、商城、皮肤解锁、排行榜、网络下发或服务端时间。
- 不修改 pages/* 或根目录旧小程序页面；当前发布包不使用这些路径。
- 不在跨午夜时自动替换正在游玩的棋盘；重新进入时才解析新日期。
- 不要求当前阶段恢复每日轮次的中途连线快照。
- v1 不支持传送门每日题；题面声明 `Mechanic: 'portal'` 或显式 `Portals` 时以 `portal-not-supported` 拒绝加载。

## 4. 主页布局契约

实现位置限定为 src/ui/canvas-renderer.js 的 drawHome() 和 src/app.js 的 action 路由。

### 4.1 稳定命中 ID

| 顺序 | 命中 ID | 文案 | enabled 条件 |
| --- | --- | --- | --- |
| 1 | home:dailyChallenge | 每日挑战（剩余次数/上限） | 当日题面可用且仍有进入次数 |
| 2 | home:corridor | 回廊 | 始终可用 |
| 3 | home:start | 继续游戏／开始游戏 | 始终可用 |

home:sound 保持现有顶部音效命中区域；home:levels 可保留为兼容 action，但主页不注册其命中区域。

### 4.2 尺寸与纵向位置

三枚主按钮保持同高、同圆角，并使用 safeBottom。为贴合首页视觉稿，
“高难关卡”和“回廊”位于第一行并列，“继续游戏／开始游戏”位于第二行且占满整行：

~~~text
BUTTON_H = 54
BUTTON_GAP = 12
BUTTON_STACK_H = BUTTON_H * 2 + BUTTON_GAP       // 120
HOME_BOTTOM_INSET = 72                            // 在上一版基础上再上移 20
firstY = safeBottom - BUTTON_STACK_H - HOME_BOTTOM_INSET
buttonWidth = min(width - 56, 360)
columnWidth = (buttonWidth - BUTTON_GAP) / 2

dailyY  = firstY
themesY = firstY
startY  = firstY + BUTTON_H + BUTTON_GAP         // firstY + 66

dailyRect  = { x: buttonX, y: dailyY, w: columnWidth, h: BUTTON_H }
themesRect = { x: buttonX + columnWidth + BUTTON_GAP, y: themesY,
               w: columnWidth, h: BUTTON_H }
startRect  = { x: buttonX, y: startY, w: buttonWidth, h: BUTTON_H }
~~~

Logo 的 logoBottomLimit = firstY - 18，必要时按现有响应式逻辑上移或缩小，不得覆盖按钮或底部手势区。

主页入口由“高难关卡”更名为“每日挑战”。有限次数直接合并进标题（如“每日挑战（3/3）”），不再单独显示“剩余次数”文案；不可用提示仍绘制在按钮行上方。
测试显式注入“次数不限”时，标题为“每日挑战”，该状态文案仍绘制在按钮内部的右下角。

### 4.3 主页模型

buildModel() 至少提供：

~~~js
{
  scene: 'home',
  dailyAvailable: true|false,       // 当日题面存在且有效
  dailyEntryAvailable: true|false,  // 仍可消耗进入次数
  dailyDateKey: 'YYYY-MM-DD'|null,
  dailyCompleted: true|false,
  dailyEntriesUsed: 0,
  dailyEntryLimit: 3,
  dailyEntriesRemaining: 5,
  dailyDebugUnlimited: false
}
~~~

completedCount 和 totalLevels 只统计普通主线 1—137 关；主线 Portal 计入普通总数，每日 8×10 不计入这两个值。

## 5. 每日场景与轮次

### 5.1 场景和 action

~~~text
home
  └─ home:dailyChallenge → daily（从第 1 关开始）
daily
  ├─ daily:home       → home
  ├─ daily:reset      → 重置当前 level，不增加进入次数
  ├─ daily:hint       → 当前 level 的每日提示（若开启）
  ├─ daily:undo       → 撤销
  └─ 第 1 关通关       → daily（levelIndex=1）
  └─ 第 2 关通关       → dailyResult
dailyResult
  ├─ dailyResult:home   → home
  ├─ dailyResult:back   → home（顶部返回图标别名）
  └─ dailyResult:replay → 尝试消耗一次新进入次数后从第 1 关开始
未来扩展（当前不注册 UI hit）：
  └─ daily:revive       → 广告/分享成功后恢复或增加次数
~~~

daily.levelIndex 只能是 0 或 1。每日轮次没有关卡列表、普通 next、普通线性解锁或普通结果 action。

### 5.2 进入次数语义

- 一次 home:dailyChallenge 成功进入，调用一次 recordEntry()，entriesUsed += 1。
- 第 0 关到第 1 关的内部切换不调用 recordEntry()。
- dailyResult:replay 和离开后重新点击主页入口各调用一次 recordEntry()。
- 默认 entryLimit = 3。次数为 0 时按钮绘制为禁用且不注册 hit。
- 进入前先确认题面有效、次数可用和 runner 可创建；这些检查失败不得消耗次数。
- 次数增加的来源（广告、分享、复活）必须在独立奖励/次数服务中记录来源和幂等键；本阶段不实现。

### 5.3 调试无限进入开关

- App 选项名固定为 `dailyDebugUnlimited`；默认值为 `false`。
- `src/config/daily.js` 的 `debugUnlimitedEntries` 已在阶段 6 设为 `false`；需要反复进入时由测试 fixture 显式注入，不通过正式运行配置放开。
- debug 模式仍可记录 `entriesUsed/attempts`，但 `canEnter()` 不因该计数拒绝进入；不把 `Infinity` 写入 JSON 存档。
- Renderer 在 debug 模式显示“次数不限”，不显示虚构的剩余数值。
- debug 开关不增加货币、不触发广告、不改变普通进度，也不作为未来线上用户可控参数。

### 5.4 日期锁定

1. 点击入口时调用 DailyChallengeService.resolve(now)。
2. 成功后把当日包的 dateKey、dayId、两个 level 的不可变快照存入当前 daily 状态。
3. 当前轮次跨午夜不换题；app.tick() 只处理动画和计时。
4. 返回主页、重玩或重新启动后再次进入，才重新解析日期。
5. 无题面或次数耗尽时不静默使用前一天或普通关卡。

## 6. 日期与服务接口

文件：src/services/daily-challenge-service.js

### 6.1 日期

- DateKey 严格为 YYYY-MM-DD。
- 当前版本时区为 Asia/Shanghai（UTC+08:00），由服务配置持有。
- 当前版本使用设备本地时钟；没有服务器时间、防篡改或远程签名。
- clock 可注入，测试必须覆盖本地日 23:59 到 00:00。

### 6.2 Manifest 解析接口

~~~js
new DailyChallengeService(manifest, {
  clock: () => new Date(),
  timeZone: 'Asia/Shanghai',
  solutions: dailySolutions
});

new ClearedApp(platform, {
  dailyDebugUnlimited: false // true only for the local debug entry
});

service.dateKey(now)          // -> 'YYYY-MM-DD'
service.resolve(now)          // -> available/unavailable
service.validate(level)       // -> { ok, errors }
service.validateDay(day)      // -> { ok, errors }
~~~

成功结果：

~~~js
{
  status: 'available',
  dateKey: '2026-08-31',
  dayId: 'daily-2026-08-31-v1',
  challengeId: 'daily-2026-08-31-v1', // 兼容别名，等于 dayId
  entryLimit: 3,
  levels: [/* level 0, level 1 */],
  levelCount: 2,
  challenge: /* levels[0]，兼容别名 */
}
~~~

失败结果至少含 status: 'unavailable'、dateKey 和机器可读 reason。

## 7. 每日数据契约

文件：data/daily-challenges.js。微信小游戏运行时使用 JS 模块；若保留 JSON 源，发布前必须生成 JS。

2026-09-07 追加 `daily-2026-09-07-v1`，保留原 8 月 31 日、9 月 1 日的内容和 ID。第 1 小关复用 3×3 热身，第 2 小关新增 8×10 中庭镂空：10 对棋子、中央 2×4 共 8 个镂空格、72 个可走格，10 条完整提示路径覆盖全部可走格。无传送门/冰块，不改变两关顺序、3 次进入、奖励、主线目录或同步协议；不需要为这个日期部署后端。

备案截图使用真实游戏入口：在北京时间 2026-09-07 重新编译，主页点击“高难关卡”，完成热身后截取“每日挑战”第 2 关。没有伪造画面、跳关、改设备时间或放开调试次数；其他日期不自动回退这道题。热身解法（行、列从 1 开始）：第一行从左连到右；第二行从左连到右，再向下到第三行最右格，最后沿第三行向左连完。进入第 2 小关不再扣次数，反复退出再进仍会消耗当日次数。

新增数据/解答由服务校验及 App 指针回放测试覆盖，包含当日边界、首页入口、两关胜利、镂空不可走和普通存档隔离。85 组全量测试、包预算、closed 发布配置及差异格式检查通过。Node 回放不替代微信开发者工具/真机截图验收，本轮没有生成或提交备案截图。

### 7.1 Manifest 形状

~~~js
module.exports = {
  SchemaVersion: 2,
  TimeZone: 'Asia/Shanghai',
  Days: [
    {
      Id: 'daily-2026-08-31-v1',
      DateKey: '2026-08-31',
      EntryLimit: 3,
      Levels: [
        {
          Id: 'daily-2026-08-31-intro-v1',
          LevelIndex: 0,
          Difficulty: 'intro',
          DifficultyLabel: '入门',
          PieceCount: 2,
          Width: 3,
          Height: 3,
          Blocked: [],
          Lines: [
            { Start: 0, End: 2 },
            { Start: 3, End: 6 }
          ],
          Palette: ['#...', '#...']
        },
        {
          Id: 'daily-2026-08-31-extreme-v1',
          LevelIndex: 1,
          Difficulty: 'extreme',
          DifficultyLabel: '极难',
          PieceCount: 10,
          Width: 8,
          Height: 10,
          Blocked: [3, 4, 27],
          Lines: [/* ... */],
          Palette: [/* ... */]
        }
      ]
    }
  ]
};
~~~

可以保留旧格式 Challenges 作为迁移输入，但默认发布数据必须使用 Days。字段约束：

| 字段 | 必需 | 约束 |
| --- | --- | --- |
| Day Id | 是 | 稳定唯一；发布后不复用 |
| DateKey | 是 | 严格日期；同一日期最多一个 Day |
| EntryLimit | 是 | 正整数；当前默认值为 3 |
| Levels | 是 | 恰好 2 个，按 LevelIndex=0,1 排序 |
| Level Id | 是 | 稳定唯一；提示和每日存档使用它 |
| LevelIndex | 是 | 只能为 0 或 1，且不得重复 |
| Difficulty | 是 | level 0 为 intro，level 1 为 extreme |
| PieceCount | 否 | 视觉/校验提示；当前 level 0 为 2，level 1 为 10，与 Lines.length 对应 |
| Width/Height | 是 | level 0 必须 3×3；level 1 必须 8×10 |
| Blocked | 是 | 整数索引数组；去重、范围有效 |
| Lines | 是 | 端点可走且互不重复；level 0 必须恰好 2 条 |
| Palette | 是 | 至少覆盖线数量 |

索引统一为行优先：index = row * Width + column。代码只使用 Blocked，不支持 Holes 别名。level 0 的两条线必须联合覆盖 3×3 的 9 格；level 1 的解答路径联合覆盖 80 - Blocked.length 格。

### 7.2 校验

validateDay() 和 validate() 必须拒绝：

- 日期、ID、EntryLimit、LevelIndex、尺寸或难度不符合约束；
- Blocked 非整数、越界、重复，或端点落在 Blocked；
- `Mechanic: 'portal'` 或显式 `Portals`（每日题 v1 尚无分段解答/存档契约）；
- 端点重复、路径经过 Blocked、越界、非相邻、重复或跨 level 重叠；
- 解答数量与 Lines 不一致，或没有覆盖该 level 的全部可走格。

### 7.3 每日提示索引

文件：data/daily-solutions.js。

推荐按 level ID 索引：

~~~js
module.exports = {
  SchemaVersion: 2,
  ByChallengeId: {
    'daily-2026-08-31-intro-v1': [[0, 1, 2], [3, 4, 5, 8, 7, 6]],
    'daily-2026-08-31-extreme-v1': [/* 与 Lines 对齐 */]
  }
};
~~~

也可提供按 dayId 分组的映射，但服务必须在解析时规范化为 level ID。每日提示不使用普通 setIndex/levelIndex。

## 8. 规则层：镂空

文件：core/game-runner.js。规则层不出现 daily、DateKey、难度或货币，只接受通用可选阻挡配置：

~~~js
new GameRunner(level, palette, onChange, {
  blocked: level.Blocked || []
});
~~~

三参数旧调用等价于空 blocked。规则契约：

- 建立长度为 Width * Height 的 blockedMask；阻挡格不可作为固定端点、路径格或占用格。
- 保留 isValidCell(index) 的范围语义，新增 isPlayableCell(index)。
- touchStart、touchMove、touchEnd、restore 拒绝阻挡格。
- fixedLine、owner、touched 不为阻挡格分配线路。
- 完成判定和 filledCount() 只统计可走格。
- snapshot()、undo()、rebuildOwners() 不得把阻挡格恢复为可走格。
- 每条线路都已提交且剩余可走格为 0 时 outcome=won；每条线路都已提交但仍有可走格时
  outcome=failed、reason=unfilled-cells。线路未全部提交时保持 playing。
- 失败立即冻结当前 runner 的输入和计时，但失败面板须等待最后一条清除动画结束后出现。

## 9. 提示、渲染与难度展示

### 9.1 提示

文件：`src/services/hint-service.js`、`src/services/hints/ordinary-hint-provider.js`。

- 普通 find(runner, setIndex, levelIndex) 保持兼容。
- 每日使用 findDaily(runner, levelId, dailySolutions)，按 level ID 查询。
- 完整预览使用 findDailyComplete(runner, levelId, dailySolutions)：只接受并整体验证预设解法，
  任一路线缺失、非法或未覆盖全部非 Blocked 格时返回 null，不使用 BFS 拼接答案。
- HintService 只从 `runner.getViewState()` 创建深拷贝 HintContext，再交给 ordinary provider。
- 存储路径和 BFS 都根据 HintContext 的 `blocked/blockedMask` 跳过镂空格。
- 提示求解服务不读日期、不写存档、不发奖励；提示访问许可由独立 HintAccessService 管理，见第 18 节。
- App 以独立 `hintPreview` 显示初始棋盘 ViewModel 和全部路线；预览持续 10 秒，再次点击提示立即关闭。
  预览期间计时继续，棋盘输入、重置和回撤禁用，真实 Runner、每日进度和撤销栈均不变。
- 按钮切换为“隐藏提示”时，图标与文案按宽度整体居中并保持间距；窄屏可等比缩小内容，
  不移动或缩小原有触控区域，普通关与每日关共用此排布。

### 9.2 Renderer

文件：`src/ui/canvas-renderer.js`、`src/ui/board/board-renderer.js`、`src/ui/board/interaction-map.js`。

- render() 显式处理 daily 和 dailyResult，不伪造普通 set。
- App 只提供纯 board ViewModel；每日与普通关共用同一个 BoardRenderer，Renderer 不持有 Runner。
- 动态按当前 level 的 Width/Height 布局：第一关渲染 3×3，第二关渲染 8×10。
- 标题至少显示“每日挑战”和 1 / 2 或 2 / 2；棋盘规格显示为 3 × 3 或 8 × 10。
- 每个 Blocked 格显示为不可走镂空，不绘制 tile、端点、提示或清除动画，也不产生棋盘 UI hit。
- 完整提示路径按线路颜色绘制经过格、中心连线和缩放方向箭头；预览仍复用当前安全区与动态棋盘布局。
- 主题只负责 tile、背景和按钮，不判断 Blocked。
- 结果页只显示每日完成、总用时和次数状态，不显示虚构货币数量。
- 未填满失败使用同一 Canvas 结果层，显示剩余空格数、“返回主页”和“重试本关”；面板出现后
  不得保留棋盘、顶部控制、提示或撤回的命中区域。
- 2026-09-04 视觉统一：普通／每日失败和成功结算共用 `drawResultPanel()` 的全宽深色横向面板，
  不再给失败结果加圆角外框或额外全屏遮罩。图标、标题、说明居中，底部按钮沿用普通成功
  结算的浅色无描边样式；每日因说明较多保留较高面板，位置受 `safeTop`／`safeBottom` 约束。
  文案、结果延迟、失败入场动画、action、每日重试免费及成功重玩次数门禁均不变；
  Node 回归覆盖 280／320／390／768 宽度，仍需微信开发者工具和真机视觉／触控验收。

## 10. App 编排边界

文件：src/app.js。

每日状态至少为：

~~~js
this.daily = {
  progressionScope: 'daily',
  dayId: null,
  dateKey: null,
  levels: [],
  levelIndex: 0,
  challenge: null,
  challengeId: null,
  runner: null,
  enteredAt: 0,
  runStartedAt: 0,
  elapsedBeforeLevel: 0,
  result: null,
  entriesUsed: 0,
  entryLimit: 3,
  entriesRemaining: 3
};
~~~

必须满足：

- home:dailyChallenge 只调用 enterDaily()，不得调用 openLevel()。
- enterDaily() 先解析 Day、校验两关、检查 canEnter()，创建 runner 成功后再 recordEntry()。
- 棋盘 pointer 由 `BoardInputController` 处理，App 只消费结构化输入事件和完整 commit。
- buildModel() 从 Runner 只读查询生成纯 board ViewModel，不向 Renderer 暴露 runner。
- 第 0 关通关后记录该 level 完成，累计时间，设置 levelIndex=1 并创建第二关 runner；不增加进入次数。
- 第 1 关通关后记录最终完成，切换 dailyResult；普通存档、普通广告和普通统计不变。
- 任一关 outcome=failed 时不得记录 level 完成、推进 levelIndex 或触发 onDailyCompleted；
  dailyFailure:retry 只重置当前 runner，保留已完成的前置 level 结果且不增加进入次数。
- dailyResult:replay 只有在仍可进入时才重开；次数耗尽时按钮禁用。
- daily:reset 只重置当前 runner；不扣额外次数。
- daily:revive 当前返回未实现状态且不注册 hit；未来由广告/分享服务授权后调用次数增加接口。
- App 对外保留 requestDailyRevive(source, idempotencyKey)；当前始终返回 implemented: false，不改变次数。
- onHide()/onShow() 暂停/恢复每日 runner，但不跨午夜换题。
- 普通 openLevel()、ProgressionService、resumeTarget() 保持原职责。

## 11. 每日存档与次数服务

文件：src/services/daily-progress-store.js。独立 key 保持：

~~~text
cleared:minigame:daily:v1
~~~

payload schema 可扩展但必须保留 schemaVersion。建议形状：

~~~js
{
  schemaVersion: 1,
  entries: {
    '2026-08-31': {
      dayId: 'daily-2026-08-31-v1',
  entryLimit: 3,
      entriesUsed: 1,
      attempts: 1,
      completed: false,
      levels: {
        'daily-2026-08-31-intro-v1': {
          levelIndex: 0,
          completed: true,
          bestMs: 1200,
          completedAt: 1780000000000
        },
        'daily-2026-08-31-extreme-v1': {
          levelIndex: 1,
          completed: false,
          bestMs: 0
        }
      }
    }
  }
}
~~~

公开方法：

~~~js
store.getDay(dateKey)
store.canEnter(dateKey, entryLimit = 3)
store.recordEntry({ dateKey, dayId, entryLimit, levelIds, idempotencyKey })
store.recordLevelCompletion({
  dateKey, dayId, levelId, levelIndex, levelCount, elapsedMs, completedAt
})
store.requestEntryIncrease({ source: 'ad'|'share', idempotencyKey }) // 当前返回 not-implemented
store.isCompleted(dateKey, dayId)

// Store-level debug override (normally supplied by App for the local build)
new DailyProgressStore(platform, { debugUnlimited: true })
~~~

兼容旧单题调用可保留 get()、isCompleted()、recordCompletion()，但新 App 不得用旧调用记录每日两关。

存档规则：

- entriesUsed 初始 0；成功 recordEntry() 后加 1；默认上限 3。
- 从早期每日 1 次版本迁移的记录，在未提供显式覆盖值时按当前 3 次基线计算剩余次数。
- 同一 idempotencyKey 重试返回已记录结果，不再次加次数。
- 同一日期的 dayId 不一致时返回 challenge-mismatch，不得覆盖。
- recordLevelCompletion() 幂等更新对应 level 的最佳时间；只有两个 level 都完成才将 day completed=true。
- 所有写入先持久化；失败回滚内存状态并返回 persist-failed。
- 每日记录不写普通存档、不增加 totalClears、不改变 lastPlayed。
- 广告/分享增加次数的未来接口必须带来源和幂等键；本阶段只预留，不建余额。

完成事件：

~~~js
onDailyCompleted({
  dateKey,
  dayId,
  levelIds,
  elapsedMs,
  firstClear
})
~~~

只表达事件，不承诺货币数量；未来货币账本自行幂等。每日不调用普通广告结算。

## 12. 代码边界矩阵

| 模块 | 每日职责 | 禁止 |
| --- | --- | --- |
| data/daily-challenges.js | Day、日期、两关题面和 EntryLimit | 绘图、触摸、存档、货币 |
| data/daily-solutions.js | 按 level ID 的提示路径 | 普通 set/level 索引 |
| src/services/daily-challenge-service.js | 日期、Day/level 解析和校验 | Canvas、平台 API、写存档 |
| src/services/daily-progress-store.js | 每日次数、level 完成、幂等 | 普通进度、余额、商城 |
| core/game-runner.js | 通用 Blocked 规则 | 日期、难度、奖励 |
| src/services/hint-service.js / hints provider | 每日提示路由和镂空感知搜索 | 持有 Runner、日期决策、发奖 |
| src/app.js / src/gameplay/* | scene、轮次、次数检查、输入事件和结算分派 | 直接绘图、普通解锁 |
| src/ui/canvas-renderer.js / src/ui/board/* | 主页三按钮、纯 ViewModel 动态棋盘、镂空和结果页 | 持有 Runner、改存档、算日期、发奖 |
| src/bootstrap.js | 注入 manifest、solutions、clock、回调 | 每日业务规则 |
| src/services/progress-store.js | 普通 schema v2 | 新增 daily 字段 |
| src/services/ads-service.js | 普通广告策略 | 默认因每日通关触发广告 |
| src/skins/* | 共用视觉 token/tile | 判断 Blocked/日期 |
| pages/* | 无 | 作为实现入口 |

## 13. 测试与验收

新增测试遵循现有 CommonJS run() 约定并注册到 tests/run.js：

1. **数据/服务**：两关数量和顺序；level0 为 3×3/2 线；level1 为 8×10；难度标签；日期边界；重复日期/ID；EntryLimit=3；无数据 unavailable。
2. **解答校验**：两关路径逐格相邻、端点匹配、避开 Blocked、联合覆盖全部可走格。
3. **次数存档**：前 3 次进入可用，第 4 次拒绝；幂等重试不重复消耗；广告/分享接口未实现时不增加次数；日期隔离和 challenge mismatch。
4. **Runner**：3×3 和 8×10 均可运行；洞不能开始/经过/释放；洞不计入完成覆盖；撤销/恢复不污染洞。
5. **提示**：按 level ID 查询；存储路径和 BFS 不穿洞。
6. **主页**：命中顺序为 home:dailyChallenge → home:corridor → home:start；按钮位置和安全区公式正确；次数耗尽时每日按钮无 hit；旧 home:themes action 仍可兼容调用。
7. **每日场景**：标题和 1/2、2/2；第 0 关通关进入第 1 关且不扣次数；第 1 关通关进入结果页；重玩受次数限制；复活 action 仅预留。
8. **隔离**：每日不改变普通完成数、lastPlayed、totalClears 或普通广告计数。
9. **失败与重试**：第 0/1 关留空失败都不写完成；第 1 关失败保留第 0 关结果；重试当前关
   不改变 entriesUsed/entriesRemaining；弹窗延迟期和显示期都无底层点击穿透。
10. **回归**：运行 node tests/run.js，所有既有普通连线、137 个主线关卡（含 26 个 Portal）、主题和音频测试通过；普通重排不改变每日进度和次数。

## 14. 实施顺序

1. 数据 manifest、解答和日期/校验服务。
2. 独立每日存档与进入次数。
3. GameRunner/HintService 的 Blocked 支持。
4. App 的 daily 两关轮次与结算分派。
5. Renderer 动态 3×3/8×10、镂空和次数状态。
6. 集成测试、真机安全区和触摸验收。
7. 后续另案：广告/分享增加次数、复活按钮、货币账本和奖励数值。

## 15. 已确认与后续可调参数

已确认：

- 每日 2 关。
- 每日进入次数 3 次。
- 第 1 关 3×3、2 种棋子，入门难度。
- 第 2 关 8×10，可有镂空，极难方向。
- 主页顺序：高难关卡 → 回廊 → 继续游戏/开始游戏；回廊内再进入主题或特效。

后续可调但不阻塞实现：

- 第 2 关具体线路数量、镂空位置和正式难度。
- 当前本地 8×10 题面主要用于流程与镂空验证，线路仍偏直观，尚未达到正式“羊了个羊”难度；正式题面需另行验收交错端点、路径冲突、窄通道和非对称镂空等约束。
- 进入次数增加的广告/分享条件及防刷规则。
- 复活是恢复当前 level、恢复整轮还是增加下一次进入。
- 每日完成奖励的货币名称、数量和发放账本。

## 16. 当前实现记录

已接入以下代码和数据：

- `data/daily-challenges.js`：本地两日示例数据；每个 Day 含 3×3 入门关和 8×10 极难关，后者含镂空和 10 条线路。
- `data/daily-solutions.js`：按 level ID 索引的完整提示路径，并保留旧平铺数据别名。
- `src/services/daily-challenge-service.js`：日期转换、Day/level 规范化、结构与解答校验。
- `src/services/daily-progress-store.js`：独立每日存档、每日 3 次进入、幂等键、逐关最佳时间和完成事件边界。
- `core/game-runner.js`：通用可选 `blocked` mask；普通三参数调用保持兼容。
- `src/services/hint-service.js` / `src/services/hints/ordinary-hint-provider.js`：每日 level ID 路由和只读 HintContext 镂空感知搜索。
- `src/app.js` / `src/gameplay/board-input-controller.js`：`home:dailyChallenge`、两关轮次、次数门禁、结构化棋盘输入、每日结果和复活预留 action。
- `src/ui/canvas-renderer.js` / `src/ui/board/board-renderer.js` / `interaction-map.js`：主页三按钮、普通/每日共用的 3×3/8×10 纯 ViewModel 棋盘、镂空视觉、难度/次数/轮次展示。
- `src/bootstrap.js` / `src/config/daily.js`：注入每日 manifest、解答、时区和调试开关。

checked-in 入口当前将 `dailyDebugUnlimited` 设为 `false`，所有实际构建执行每日 3 次限制；自动化仍可显式注入无限模式。

当前自动化回归命令为 `node tests/run.js`。示例日期表只覆盖当前开发验证日期；新增正式日期时必须按本契约补齐两个 level、解答和数据校验。


## 17. 在线额外次数接入（2026-09-03）

本节覆盖前文“尚未接入”的预留描述。`daily:extraEntry` 是当日完整挑战的额外进入额度，默认关闭；旧 `daily:revive` / `dailyResult:revive` 在功能启用时路由到同一语义。`dailyFailure:retry` 继续免费重试当前关，不新增消耗，不接广告。RewardService 返回确认 grant 后，App 才调用 `applyAuthorizedEntryGrant`；该方法保留 entriesUsed，单调合并 entryLimit，并在原每日 key 内使用 `_grantIds` 幂等，失败回滚内存。无货币或 ad revive 玩法。后端、正式广告位、真实隐私与广告行为及 Android/iOS 验证仍待执行。


### 17.1 交付复核后的恢复与兼容路由

`daily:revive`、`dailyResult:revive` 在 App 分派前统一成 `daily:extraEntry`，只在功能开启且首页/每日成功结果具有有效日期上下文时运行；关闭、无效场景或已有 pending 时安全返回 false。所有别名共用同一并发保护，不新增按钮或第二套复活语义。`dailyFailure:retry` 在开关开启时也继续免费，只重置当前关，不增加 entriesUsed、不触发广告。

达到平台发奖条件（`isEnded === true`）的 attemptId 与观看开始时 userId 一起由 RewardService 保存到既有待领取队列，再处理会话过期和认证。认证失败、网络失败或切换成其他账号不会丢掉原账号的待领取请求；重启后原账号可用相同键恢复，其他账号不能接收该请求，未达到条件而关闭不建立领奖记录。

回归覆盖 31 秒剩余会话/45 秒观看、失败和跨账号/重启恢复、重复关闭回调，以及旧/新 action 的开关、场景、上下文和并发等价性；属于客户端 Node 证明。真实后端、微信开发者工具在线流程、Android/iOS 和发布验收本次未执行，详见集成方案第 36 节。

## 18. 每日小关的提示分享

提示当前采用本地“发起分享流程后解锁，取消也可能解锁”的口径。每天每个小关分别解锁，与普通、Portal 关卡共享同一份当日提示访问记录；不读写每日进入额度。按钮先显示“分享解锁”，保存许可后变为“查看提示”，再次点击才显示原有 10 秒完整路径。当天重置、重玩和重启可复用许可。

后续“首个新关免费、第二个分享、第三个及以后观看广告并达到平台发奖条件后解锁”仍是待实施策略；原免费失败重试保持不变。日期、键格式、失败回退、代码边界及测试见 [`hint-access-and-sharing.md`](hint-access-and-sharing.md)。
## 19. 完整每日首胜货币

- 只有本轮固定 `dateKey` 下两项不同 levelId 都成功写入、且索引为 0／1 的完整每日记录，才获得 500 本地货币；第一小关不发放。
- 领取按 `dateKey` 去重，同日重玩、调试无限进入或同日期更换 dayId 都不会再次领取。跨午夜完成已经开始的旧日挑战仍归原 `dateKey`。
- `DailyProgressStore.exportRewardCompletions()` 只投影已保存的完整两关事实；读取或格式失败不以当前内存状态冒充成功。余额和领取标记由独立 `RewardUnlockService` 在同一次写盘中提交，不改变每日进入次数、提示或服务端额外次数合同。
