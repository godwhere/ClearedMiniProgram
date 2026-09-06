# Cleared 微信小游戏

工程使用微信小游戏原生 JavaScript + Canvas 2D，不依赖 Cocos、Unity、npm
或网页运行环境。

CloudBase 阶段 4 的迁移、同步与云经济代码已经就绪，测试环境中的三个普通事件函数和 12 个私有集合仍保持关闭写入门禁。阶段 3 的真实身份、只读状态与离线回归未退化；首次合成旧存档迁移、云钱包和真实双设备验收仍未执行。测试开关、回滚及证据边界见 [阶段 4 测试手册](docs/cloudbase-phase-4-test-runbook.md)。

现有内容：

- 92 个普通关卡，选关页统一按 1—92 连续编号；第 7、17、32、47 关为 Portal 里程碑教学关，第 63—92 关为 16 个普通题与 14 个 Portal 题组成的高阶混合章节；普通题面最大为 8×8；
- 首页、“选择关卡”、每页 25 关的左右滑动分页、游玩、撤销、重置和通关流程；
- 已完成关卡的数字下方显示最快通关时间，使用分:秒格式，例如 `1:30`；旧记录缺失或时间无效时不显示时间，未完成关卡不显示成绩；
- 原版“连接成功后路径淡出并清空格子”的玩法；
- 全局顺序解锁，完成当前关后开放下一关，锁定关不可进入；
- 主线第 1 关在棋盘上方显示“连接两个相同的色块或物体”，第 2—5 关显示“别漏掉空白格，全部消除才能通关哦”。教学复用传送门提示的位置和 32px 留白，重玩仍显示；第 6 关起不再显示新手教学，后续 Portal 机制说明保持原规则，每日挑战不显示这组文案；
- 关卡底部保留提示与回撤按钮；每天第一个新关卡的提示免费，第二个分享解锁，第三个起观看广告并达到平台发奖条件后解锁。提示广告默认关闭，因此当前第三个起仍使用分享。普通、Portal、每日两个小关共用当天新解锁关卡数；已解锁关卡当天可无限查看，每次显示 10 秒。免费保存成功立即预览；分享／广告解锁后再次点击才预览。分享采用“发起流程后解锁，取消也可能解锁”的口径。规则与代码边界见 [`docs/hint-tiered-unlock-and-ad-fallback.md`](docs/hint-tiered-unlock-and-ad-fallback.md)；
- 本地完成进度和每关最佳时间；首页进度以 `23/92` 这样的格式显示在“继续游戏／开始游戏”按钮内右侧，主文案保持原位置居中；
- 普通关卡体力：新安装和旧版升级初始 5 点，每关首次解锁消耗 1 点，解锁后重入免费；余额低于 5 时每 5 分钟恢复 1 点。首页和选关页的体力徽标只显示当前体力（如 4、5，超额为 6），不显示自然恢复上限。首页顶部按“音乐按钮 → 无底板货币余额 → 体力按钮”排列，金币余额与体力数字使用相同字号；体力详情默认收起，点击后低于 5 显示倒计时，大于等于 5 显示“体力已满”。选关页只显示闪电与当前数量，关卡内及普通结果页顶部不显示体力 UI。
- 本地奖励与简易货币已接入：主线每关首次通关获得 100，完整完成当日两小关首次获得 500；新存档为 0，按稳定关卡坐标和上海日期去重。`classic`／`none` 始终可用，其余主题和 `fade` 按指定关卡、10000 货币、独立激励广告或奖励分享条件永久解锁；解锁与应用分开，保存失败可安全重试。云端不再确认某主题的拥有权时，当前显示回退到经典主题但保留本机选择，重新取得拥有权后可恢复原选择。真实广告位和专用开关仍为空／关闭。
- 原版配色与 Logo；
- 可插拔皮肤服务与无广告默认实现。
- 账号接入基础层：独立 session／同步元数据／有限事件队列，由 bootstrap 显式注入；普通结算完成后才通知 EngagementService。后端相关开关默认关闭，提示分享可独立使用，原本地进度存档 key 与离线启动不变。完整实施合同见 [`docs/user-account-sharing-ads-integration.md`](docs/user-account-sharing-ads-integration.md)。
- 旧 HTTP 静默身份／普通云存档兼容层仍保留，但 `backend`、旧 `auth` 和旧 `progressSync` 默认全部关闭，不是阶段 4 的开启入口。阶段 4 使用独立 CloudBase Event 函数、分域权威和 operation 回执，当前启用范围以后文“CloudBase 测试状态”为准，不应同时打开旧 HTTP 链路。旧兼容协议仍只合并完成集合和最短有效用时：旧存档只有 completed 而没有 bestMs 时省略 elapsedMs，不能凭空生成最佳时间；账号变化暂停同步并保留本地数据，事件和同步队列各最多 200 条。
- 首页左上角以玩家头像作为账号入口，点击进入账号页；未取得资料、图片加载中或失败时显示默认人像。账号页提供本地／云同步状态、重试同步和隐私协议入口；云读取或迁移显示“正在同步”，有待发送操作显示“等待同步”，完成后显示“已同步”，不会误显示为“本地游玩”。可选头像昵称服务与 Canvas 共用纯布局，原生按钮在离开、隐藏、调整尺寸或销毁时移除；拒绝授权不影响游玩。资料服务已由 bootstrap 注入，当前 profile 开关默认关闭，因此默认显示占位头像。
  已在微信开发者工具 Stable 2.02.2608060 编译并验证账号页进入、关闭后端时的重试回退及返回首页。原生授权按钮、真实资料读写、隐私授权、Android/iOS 和发布包分析尚未验收。
- 菜单、普通成功结果和每日成功结果分享已实现，默认关闭。分享使用游戏截图，不新增图片资源；只有预先取得的后端 shareId 才进入 query。冷/热启动归因使用独立 `cleared:minigame:share-entry:v1`，最多保留 20 条待发送项与 50 个近期已处理标识；超过容量不接收新归因，后端仍须幂等防自邀。分享发起与回前台不能直接发放邀请或每日增次奖励；提示分享只登记本地提示访问许可。
- 激励广告返回稳定 attemptId、rewarded/reason 和清理后的错误码；提示广告以 `isEnded === true` 为准，不根据跳过按钮或自行计时判断。当前 `hintMode: 'tiered'`、`hintRewardedEnabled: false`，保留 `free`、`share` 与原 `rewarded` 模式。广告未启用、广告位为空／无效或接口不支持时预先使用分享；实际广告提前关闭、无库存、忙碌或出错不会自动转为分享。存档失败先重试原关卡资格，不再索取分享／广告，也不重复发放首次免费。可选 `disableFallbackSharePage` 仅在基础库 ≥ 3.7.7 时传入，兼容判断由平台层承担。
- 主题入口、2×3 分页主题画廊，以及宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐、交通工具十个非经典主题素材。
- 回廊与消除特效选择场景，内置“无特效”和“逐渐消失”两种选择；运行时已将首页原主题按钮替换为回廊入口。
- 回廊里的主题页、特效页使用更大的左箭头返回按钮，触摸区域为 56×56，点击返回回廊；
- “高难关卡”入口与“每日挑战”：每日 2 关（3×3 入门、8×10 极难镂空），正式模式每日默认 3 次进入；开发入口可无限次调试。
- 开发者工具运行时全解锁：在微信开发者工具模拟器中可直接进入全部普通关卡，真机与发布包仍按顺序解锁；详见 [`docs/dev-tools.md`](docs/dev-tools.md)。

主题（内部仍称 skin）的画廊、分页、资源协议与代码边界记录在
[`docs/theme-system.md`](docs/theme-system.md)。宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐和交通工具十个非经典主题已接入运行时，后续主题按同一协议扩展。
十套正式精灵表各自放在普通分包中。主题卡片从主包读取 **128×128、128 色 PNG-8** 小图，
未下载分包也能看到前四个图标的 2×2 预览。点击后保留原主题并显示下载进度；成功后才切换并保存，失败可再次点击重试，预览始终保留。
回廊中的两张特效预览也统一为同一规格，每张不超过 8 KiB；入口插画继续由 Canvas 直接绘制。
生成流程、验收门禁与本次严格修改边界见 [`docs/corridor-preview-assets.md`](docs/corridor-preview-assets.md)。
经典主题冷启动不请求主题分包；恢复保存的非经典主题时先用颜色回退显示，下载不阻塞游玩。
包划分、加载状态与验收边界见 [`docs/package-splitting.md`](docs/package-splitting.md)。
节日限定当前先作为可选视觉主题接入，按日期自动上架/下架的运营规则后续另行实现。

回廊功能入口、消除特效选择页、“无特效”/“逐渐消失”特效以及首页主题入口迁移契约，记录在
[`docs/corridor-and-clear-effects.md`](docs/corridor-and-clear-effects.md)。第一版场景、特效和首页回廊入口已接入，旧主题 action 仍兼容保留。

传送门玩法的入口段锁定、松手后任选同网络其他出口、错误选择回滚、分段解答格式和
`GameRunner`/输入/渲染代码边界记录在 [`docs/portal-mechanic.md`](docs/portal-mechanic.md)。
目前已完成 Portal v2 单网络任选出口、分段手势、完整路径清除动画、4 个前期里程碑教学关，以及 8×8 高阶混合章节中的 14 个双门题，并保留 Portal v1 题面和解答兼容。全部 Portal 关在进门前显示“路径会通过传送门抵达另一个传送门”，到门锁定和等待出口时显示“到达传送门后松手，再从另一扇门继续”，出口续接后隐藏。主线游玩标题统一为“当前关卡 / 总关卡”，不显示名称。连到入口时门图标会居中放大并显示选中高亮；门格不显示 `P1`，Portal 阶段不震动，完整线路消除仍保留原有震动。
独立传送门试玩及其隐藏兼容入口已删除；所有 Portal 题均通过主线连续选关进入。
传送门以 [`src/mechanics/portal.js`](src/mechanics/portal.js) 作为独立“玩法拓展”定义，不属于主题或特效回廊。门格只显示传送门，不叠加当前主题棋子；默认图标为
[`assets/icons/portal.png`](assets/icons/portal.png)。

传送门作为首个玩法拓展所暴露的运行上下文、规则查询、输入、提示、渲染与结算边界，以及后续分阶段迁移步骤，记录在
[`docs/gameplay-extension-architecture.md`](docs/gameplay-extension-architecture.md)。阶段 0—6 的架构重构已经完成；Portal v2 已触发并完成阶段 7 的最小规则版本 Registry，以 allowlist 分派 v1/v2 策略，未知机制或版本不会执行内容脚本。

第 63–92 关的高阶混排、题面指标、解答来源和后续机制预留记录在
[`docs/8x8-portal-level-pack-design.md`](docs/8x8-portal-level-pack-design.md)。63–67 保留首批
五个双门题；68–92 已重做为 16 个普通题和 9 个双门题，使用 6–9 色均衡线路，Portal 说明
统一为上述两句状态提示。64、76、84、89 保留经过审查的高成本无门解。可复用的出题方法和质量门槛见
[`docs/portal-level-design-guide.md`](docs/portal-level-design-guide.md)。全部内容仍需策划试玩和真机验收。

“高难关卡”主页入口及“每日挑战”模式的棋盘、日期、镂空、存档和实现边界记录在
 [`docs/daily-challenge-mode.md`](docs/daily-challenge-mode.md)；额外进入次数仍由服务端 `RewardService` 处理并默认关闭；失败重试免费。每日完整首胜的 500 本地货币由独立 `RewardUnlockService` 处理。

## 直接导入微信开发者工具

1. 打开微信开发者工具并选择导入项目。
2. 项目目录选择 `/Users/ethan/Projects/ClearedMiniProgram`。
3. 工程已写入当前小游戏 AppID；若以后更换账号，只需更新 `project.config.json`。
4. 导入后点击编译即可。

### CloudBase 测试状态

测试环境已进入阶段4的“关闭门禁”检查点：三个Event函数和12个拒绝客户端直读写的集合已部署，但玩家白名单为空，迁移、同步和经济写入全部关闭。开发者工具只会进行可信身份与状态读取，本地存档不会自动上传；账号页的“云身份／只读测试，本地存档未上传”仍是当前正确文案。

阶段4本机配置只能通过Git忽略的 `src/config/cloudbase.local.js` 在develop/trial逐项开启；仓库默认和release始终全关。首次真实迁移必须使用专用可丢弃微信测试账号，先导出本地存储，再构造合成旧存档，不能使用现有重要存档。服务端prepare通过后，客户端先把完整冻结快照写入独立本地迁移档案，再进入freeze；写盘失败不切权威，SUPPLEMENTAL未接受的余额或资产会返回冲突摘要且原快照仍可恢复。执行顺序、验收与回滚见 [`docs/cloudbase-phase-4-test-runbook.md`](docs/cloudbase-phase-4-test-runbook.md)。

项目根目录已经包含 `game.js`、`game.json` 和 `project.config.json`，其
`compileType` 为 `game`，不需要运行构建命令。旧小程序页面仍保留作为迁移参考，
但已通过打包配置排除，不会进入小游戏代码包。

## 玩法

从一个彩色端点开始，只能上下左右经过相邻格子，连接到同色的另一个端点。路径不能
穿过其他端点或已经清除的格子。连接成功后该路径淡出，但对应格子仍算被占用；所有格子
都被合法路径覆盖时过关。拖回本次路径中的旧格可以回退。

如果所有同色端点都已连接，但仍有可走格未被路径覆盖，本关进入失败终局。最后一条路径
先完成当前清除表现（“无特效”为立即移除），随后显示剩余空格数量；玩家可以返回选关或重新开始当前关。失败不会记录
通关、最佳时间或广告结算。每日挑战的“重试本关”不会额外消耗进入次数。

购买确认、关卡／广告／分享解锁条件、解锁成功通知、普通／每日挑战失败及普通／每日成功结算，
全部统一使用通关截图中的全宽深色横向面板：居中图标或商品预览、标题、说明与同排浅色按钮，
无圆角外框；颜色沿用当前场景，不固定为截图的青色。购买、奖励、重试与输入拦截规则不变。
微信原生分享面板、激励视频和授权界面由平台绘制，不属于可定制的游戏内 Canvas 弹窗。

拖动连线时，当前路径格会使用对应线路颜色并轻微放大；松手后按回廊中选择的消除特效立即移除或淡出。

普通关卡按 1 → 92 的显示编号顺序解锁，底层仍保留原有数据索引以兼容存档；已完成关卡
始终可以重玩，未解锁关卡显示锁图标且不响应点击。关卡分布和显示编号为：Training 2 关
（1—2）、5×5 5 关（3—7）、6×6 10 关（8—17）、7×7 15 关（18—32）、8×8 60 关
（33—92，其中第 47 关为 Portal 里程碑教学关，63—92 为高阶混合章节）。此外第 7、17、32 关分别承担 5×5、6×6、7×7 Portal 教学。普通题面最大为 8×8；8×10 仅由独立的“高难关卡／每日挑战”模式使用，
不计入普通关卡编号、进度或统计。

普通关卡（含 Portal）仅在首次进入可挑战的新关时消耗 1 点体力永久解锁；之后重复进入、通关重玩、返回选关再进或重启再进均免费，0 体力也可进入。下一关只有首次解锁才扣费，前置通关的顺序条件仍然有效。每关首次达成本次用时不超过 1 分钟的通关，自动返还 1 点体力；此前超时或重玩不影响资格，返还后不重复领取，每日挑战不参与。结算面板不展示返还规则或状态文案，到账时使用短暂反馈。
当前关重置和失败重试免费；每日挑战只使用每日进入次数，不消耗普通体力。无效、尚未满足顺序条件或 Runner 创建失败不扣费；
首次解锁时体力不足或保存失败会保留当前页面、Runner、结果和进度；已解锁关免费进入不依赖新体力写入。

**5 点是自然恢复上限，余额可以超过 5。** 低于 5 时每 5 分钟恢复 1 点；达到或超过 5 时停止恢复、清除倒计时，
不保留半段进度。消费后首次低于 5 时重新开始完整 5 分钟，恢复期间再次消费不重置倒计时。
体力使用独立本地键 `cleared:minigame:stamina:v1`，在同一次写入中保存余额及永久解锁列表 `unlockedLevels`，返还时与去重列表 `refundedLevels` 同存；不改变普通／每日进度或云同步 schema。旧存档保留原余额，并从已有完成及最后游玩记录恢复免费资格；更早且未完成的访问没有完整旧记录，无法还原。已有有效的 1 分钟快通最佳纪录会补返一次，无有效用时记录则不推定达成。自然恢复仍按绝对时间戳补算。
当前依赖客户端设备时间：时钟后调会延长等待，前调可能提前恢复，清数据或重装会重新获得初始体力；不提供跨设备同步。
完整规则、文件边界和验证记录见 [`docs/stamina-system.md`](docs/stamina-system.md)。

## 轻量架构

```text
game.js                         小游戏入口
core/game-runner.js             纯规则、结构化手势结果与只读状态查询（支持镂空/Portal）
core/mechanics/                 机制规则版本 allowlist 与 Portal v1/v2 策略
core/portal-schema.js           Portal 字段读取、规范化与索引的唯一共享来源
core/portal-solution.js         Portal 分段解规范化、反转与展平纯函数
core/portal-validation.js       Portal 题面和分段解答的严格发布校验
data/                           原版 JSON 与小游戏可加载的 JS 关卡模块
data/solutions.js               58 个旧普通题坐标解，并汇入 16 个混合章节普通题的 ID 解
data/ordinary-chapter-solutions.js 混合章节 16 个普通题的按 ID 完整路径
data/portal-solutions.js        18 个主线 Portal 题（4 个里程碑 + 14 个章节题）的按 ID 分段解答
data/daily-challenges.js        每日两关题面、日期和镂空数据
data/daily-solutions.js         每日关卡按 level ID 索引的提示路径
src/app.js                      场景、反馈与纯棋盘 ViewModel 编排
src/gameplay/run-context.js     关卡来源、进度域与棋盘机制上下文
src/gameplay/completion-policies.js 按进度域分派普通/每日结算
src/gameplay/board-input-controller.js 棋盘 pointer 生命周期与逐格采样
src/platform/wechat.js          Canvas、触摸、生命周期、存储和广告 API
src/ui/canvas-renderer.js       单 Canvas 场景渲染门面
src/ui/portal-instructions.js   主线 Portal 两句状态提示的唯一来源
src/ui/board/interaction-map.js 命中区域与棋盘定位
src/ui/board/board-renderer.js  普通/每日共用的纯 ViewModel 棋盘与消除特效绘制
src/ui/board/portal-overlay.js  Portal 图标、状态光圈与资源回退
src/services/progress-store.js  版本化本地存档
src/services/stamina-service.js 普通体力独立存档、恢复、永久解锁与快通返还
src/services/reward-unlock-service.js 本地货币、永久拥有权、领取去重和待展示通知
src/config/rewards.js            奖励对象、条件、价格和次数的声明式配置
src/config/stamina.js           初始体力、自然上限、恢复间隔、解锁成本和快通返还参数
src/services/progression-service.js 顺序解锁策略
src/services/skin-service.js    皮肤注册与切换
src/services/subpackage-service.js 进程内分包状态、进度、请求去重和失败重试
src/config/subpackages.js       十个普通主题分包的名称、目录、主题和资源前缀映射
src/services/clear-effect-service.js 消除特效注册、选择与回退
src/services/ads-service.js     激励视频/插屏广告门面，默认无广告
src/services/audio-service.js   BGM、连线和通关音效适配
src/services/hint-service.js    普通/Portal 提示 provider 的兼容路由门面
src/services/hint-access-service.js 本地当日提示解锁、去重记录与保存失败重试
src/services/hints/             只消费纯 HintContext 的普通/Portal 提示实现
src/services/daily-challenge-service.js 日期选择、两关校验与每日题面解析
src/services/daily-progress-store.js     每日进入次数、关卡完成和幂等存档
src/config/daily.js              每日次数、时区和调试开关
src/skins/index.js              皮肤清单与统一注册入口
src/skins/classic.js            经典皮肤语义配置
src/skins/gem.js                宝石主题 manifest（10 色槽精灵表）
src/skins/animals.js            动物主题 manifest（10 个哺乳动物头像）
src/skins/fruits.js             水果主题 manifest（10 个水果精灵）
src/skins/desserts.js           甜点主题 manifest（10 个甜点精灵）
src/skins/space.js              太空主题 manifest（10 个太空精灵）
src/skins/ocean.js              海洋主题 manifest（10 个海洋精灵）
src/skins/spring.js             春天主题 manifest（10 个春季精灵）
src/skins/festival.js           节日限定主题 manifest（10 个节庆精灵）
src/skins/music.js              音乐主题 manifest（10 个音乐精灵）
src/skins/vehicles.js           交通工具主题 manifest（10 个交通工具精灵）
src/effects/index.js            内置消除特效注册入口
src/effects/none.js             “无特效”manifest（不创建清除动画快照）
src/effects/fade.js             “逐渐消失”特效 manifest
src/mechanics/index.js          玩法拓展 definition 注册与稳定 ID 查询
src/mechanics/portal.js         传送门玩法拓展定义与版本、图标声明
src/config/ads.js               广告位与展示频率配置
src/config/progression.js       普通关卡连续顺序解锁配置
src/config/audio.js              音频资源与音量配置
assets/audio/                   压缩后的本地音频素材
docs/portal-mechanic.md          传送门玩法、状态机、数据/提示契约与代码边界
docs/portal-level-design-guide.md Portal 关卡设计经验、难度指标与内容验收门槛
scripts/solve-no-portal.js       8×8 内容无门完整覆盖审计（有上限，非运行时逻辑）
docs/gameplay-extension-architecture.md 玩法拓展架构、迁移阶段和文件职责边界
assets/skins/gem/               宝石主题精灵图
assets/skins/animals/           动物主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/fruits/            水果主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/desserts/          甜点主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/space/              太空主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/ocean/              海洋主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/spring/             春天主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/festival/           节日限定主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/music/              音乐主题精灵图（主题页取前四个元素 2×2 展示）
assets/skins/vehicles/           交通工具主题精灵图（主题页取前四个元素 2×2 展示）
assets/theme-previews/           主包主题四格预览，128×128 / 128 色 PNG-8
assets/effects/none/             “无特效”选择页预览，128×128 / 128 色 PNG-8
assets/effects/fade/             “逐渐消失”特效选择页预览，128×128 / 128 色 PNG-8
tests/clear-effect-service.test.js、tests/clear-effect-system.test.js 特效服务与场景测试
```

新增皮肤时，只需注册新的语义化皮肤配置和素材映射，不改关卡规则。正式题目的提示路径会在发布前
离线生成并由测试校验，运行时仍保留普通与 Portal 的防御性回退搜索。部署广告时，在
`src/config/ads.js` 填入广告位 ID；游戏规则不直接依赖广告 API。激励视频只在完整播放后
返回奖励资格，插屏广告包含频率和最短间隔控制。

## 验证

```sh
node tests/run.js
node scripts/validate-theme-assets.js
node scripts/validate-gallery-previews.js
node scripts/check-package-budget.js
git diff --check
```

测试覆盖路径连接、回退、阻挡、跨行边界、重画、撤销、Portal v1/v2 与多出口回放、92 个普通关卡的数据完整性、
普通体力恢复／超额余额／存储失败回滚／首次解锁与免费重入／每关首次快通返还／11 套主题 320px 和 390px 布局、
4 个前期里程碑教学关与 30 个 8×8 高阶混合关的按 ID 发布校验与逐段回放、进度存储、
主题清单/分页/素材回退、回廊与消除特效清单/分页/存档/无特效与淡出回退、开发者工具运行时门禁、每日两关/次数/镂空规则、
未填满棋盘的失败终局与重试、Canvas 渲染和完整小游戏启动/触控烟雾流程。74 个无 Portal 普通题的官方
解答以及 18 个主线 Portal 题解答还会实际驱动规则机，确保全部保持胜利结果。

`node scripts/solve-no-portal.js` 可审计章节 Portal 题的无门解，追加关卡号可单独检查。
混排测试还会固定其他官方线路，排除只改一色或两色即可通关的廉价旁路。

如修改原始关卡 JSON，可运行 `node scripts/generate-level-modules.js` 更新提交到工程中的
JS 数据模块；正常导入和运行小游戏不需要执行此命令。

新增主题或更新回廊位图时，使用 Python/Pillow 离线运行 `python3 scripts/generate-gallery-previews.py`，
再用 `python3 scripts/generate-gallery-previews.py --check` 验证源图与输出一致。
主题配置声明顶层 `preview`，工具从现有注册列表枚举；特效源图保留在不入包的
`scripts/gallery-preview-sources/effects/`。安装说明与固定规格见回廊预览方案文档。

包体脚本按 `game.json.subpackages` 和 `project.config.json.packOptions.ignore` 统计源码字节，
主包预算 ≤ 3.2 MiB、单分包 ≤ 3.5 MiB、总包 ≤ 18 MiB，主包和每个分包均须严格小于 4 MiB。
它不代表最终微信包体；提交审核前须在开发者工具“详情 -> 本地代码 -> 代码包分析”复核实际包体、
十张精灵表均不在主包依赖中，以及后台当前总包上限，并在 Android/iOS 验证弱网、失败重试和清缓存重启。
BGM、短音效、Logo、Portal 图标以及轻量主题/特效预览仍在主包；仅在主包超预算时再评估 BGM 分包兜底。
主题素材校验不传参数时只检查正式精灵表并跳过 `drafts/`；显式传入 `assets/skins` 会同时检查已排除发布的历史草稿，当前动物旧稿会失败。

声音系统使用原版 BGM 的压缩版本，以及 Echo of Genesis 提供的点击、连线、错误和通关
音效；通关音采用约 2.3 秒的短版 shimmer。小游戏首次触摸后解锁音频，切到后台会暂停，
并可在首页或游玩页切换静音。原项目代码、关卡和仓库素材的许可声明见
`THIRD_PARTY_NOTICES.md`。

每日额外进入次数：`daily:extraEntry` 经完整视频与后端幂等 ledger 确认后，缓存服务端 entryLimit；客户端不提交数量。`cleared:minigame:rewards:v1` 最多保留 20 条待结算请求、64 条已确认 grant 缓存，缓存淘汰不删除服务端账本。写入失败、后台退出和同 grant 重放有恢复保护；普通/每日原存储 key 保持不变，新增每日 `_grantIds` 防重复。`dailyFailure:retry` 不扣额外次数且不要求广告。

邀请奖励客户端已接入，默认 `share.rewardsEnabled=false`。启用后只向 share-intents 提交 `rewardAction: daily_extra_entry` 作为活动意图，由服务端校验归因并在事务中发奖；邀请者通过 daily-entitlements 恢复确认 grant，不能从分享回调申领奖励。客户端处理自邀、过期和活动关闭的明确拒绝，网络失败保留归因 ID。服务端唯一约束、防刷、真实邀请闭环仍需在独立后端实现并验收。全部实施记录、精确文件清单、HTTP 合同及未完成发布检查见接入方案第 34—35 节。


交付复核的四项客户端修复记录见接入方案第 36 节：云快照落盘前先固定账号归属；完整广告结果先按发起账号与 attemptId 保存，再重新认证领取；返回首页通过 App action 刷新分享意图；旧 revive action 统一走 extraEntry。现有存档 key、HTTP 合同及在线默认关闭配置不变。修复版只完成本地 Node/包体/差异验证，后端、微信在线能力、真机及发布验收仍未完成。
