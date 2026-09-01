# Cleared 微信小游戏

这是对 2017 年 Xamarin 游戏 [brainoffline/Cleared](https://github.com/brainoffline/Cleared)
的轻量复刻。工程使用微信小游戏原生 JavaScript + Canvas 2D，不依赖 Cocos、Unity、npm
或网页运行环境。

现有内容：

- 92 个普通关卡，选关页统一按 1—92 连续编号；普通题面最大为 8×8；其中第 63—92 关为 Portal 章节；
- 首页、“选择关卡”、每页 25 关的左右滑动分页、游玩、撤销、重置和通关流程；
- 原版“连接成功后路径淡出并清空格子”的玩法；
- 全局顺序解锁，完成当前关后开放下一关，锁定关不可进入；
- 关卡底部左右分布“提示 / 回撤”按钮；提示以对应颜色的呼吸格子显示一条预计算的有效路径；
- 本地完成进度和每关最佳时间；
- 原版配色与 Logo；
- 可插拔皮肤服务与无广告默认实现。
- 主题入口、2×3 分页主题画廊，以及宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐、交通工具十个非经典主题素材。
- 回廊与消除特效选择场景，内置“无特效”和“逐渐消失”两种选择；运行时已将首页原主题按钮替换为回廊入口。
- “高难关卡”入口与“每日挑战”：每日 2 关（3×3 入门、8×10 极难镂空），正式模式每日默认 3 次进入；开发入口可无限次调试。

主题（内部仍称 skin）的画廊、分页、资源协议与代码边界记录在
[`docs/theme-system.md`](docs/theme-system.md)。宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐和交通工具十个非经典主题已接入运行时，后续主题按同一协议扩展。
主题卡片预览直接使用各主题前四个 tile 按 2×2 排列，不依赖独立预览图。
节日限定当前先作为可选视觉主题接入，按日期自动上架/下架的运营规则后续另行实现。

回廊功能入口、消除特效选择页、“无特效”/“逐渐消失”特效以及首页主题入口迁移契约，记录在
[`docs/corridor-and-clear-effects.md`](docs/corridor-and-clear-effects.md)。第一版场景、特效和首页回廊入口已接入，旧主题 action 仍兼容保留。

传送门玩法的入口段锁定、松手后任选同网络其他出口、错误选择回滚、试玩关卡、分段解答格式和
`GameRunner`/输入/渲染代码边界记录在 [`docs/portal-mechanic.md`](docs/portal-mechanic.md)。
目前已完成 Portal v2 单网络任选出口、分段手势/提示、完整路径清除动画与 5 个试玩关卡（`data/portal-demo.js`），并保留 Portal v1 题面和解答兼容。提示只在到门锁定和松手等待两个阶段出现在棋盘上方，带轻微呼吸效果；门格不显示 `P1`，Portal 阶段不震动，完整线路消除仍保留原有震动。
传送门以 [`src/mechanics/portal.js`](src/mechanics/portal.js) 作为独立“玩法拓展”定义，不属于主题或特效回廊；试玩通关不写入普通关卡进度、最佳时间或广告计数。门格只显示传送门，不叠加当前主题棋子；默认图标为
[`assets/icons/portal.png`](assets/icons/portal.png)。

传送门作为首个玩法拓展所暴露的运行上下文、规则查询、输入、提示、渲染与结算边界，以及后续分阶段迁移步骤，记录在
[`docs/gameplay-extension-architecture.md`](docs/gameplay-extension-architecture.md)。阶段 0—6 的架构重构已经完成；Portal v2 已触发并完成阶段 7 的最小规则版本 Registry，以 allowlist 分派 v1/v2 策略，未知机制或版本不会执行内容脚本。

新增的 30 个 8×8 Portal 普通关卡、分档目标、精确题面、分段解法和后续机制预留记录在
[`docs/8x8-portal-level-pack-design.md`](docs/8x8-portal-level-pack-design.md)。它们已接入普通 catalog，
但仍需策划试玩、唯一解审查和真机验收后才视为正式发布内容。

“高难关卡”主页入口及“每日挑战”模式的棋盘、日期、镂空、存档和实现边界记录在
[`docs/daily-challenge-mode.md`](docs/daily-challenge-mode.md)；广告/分享增次、复活和货币系统暂未接入。

## 直接导入微信开发者工具

1. 打开微信开发者工具并选择导入项目。
2. 项目目录选择 `/Users/ethan/Projects/ClearedMiniProgram`。
3. 工程已写入当前小游戏 AppID；若以后更换账号，只需更新 `project.config.json`。
4. 导入后点击编译即可。

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

拖动连线时，当前路径格会使用对应线路颜色并轻微放大；松手后按回廊中选择的消除特效立即移除或淡出。

普通关卡按 1 → 92 的显示编号顺序解锁，底层仍保留原有数据索引以兼容存档；已完成关卡
始终可以重玩，未解锁关卡显示锁图标且不响应点击。关卡分布和显示编号为：Training 2 关
（1—2）、5×5 5 关（3—7）、6×6 10 关（8—17）、7×7 15 关（18—32）、8×8 60 关
（33—92，其中 63—92 为 Portal 章节）。普通题面最大为 8×8；8×10 仅由独立的“高难关卡／每日挑战”模式使用，
不计入普通关卡编号、进度或统计。

## 轻量架构

```text
game.js                         小游戏入口
core/game-runner.js             纯规则、结构化手势结果与只读状态查询（支持镂空/Portal）
core/mechanics/                 机制规则版本 allowlist 与 Portal v1/v2 策略
core/portal-schema.js           Portal 字段读取、规范化与索引的唯一共享来源
core/portal-solution.js         Portal 分段解规范化、反转与展平纯函数
core/portal-validation.js       Portal 题面和分段解答的严格发布校验
data/                           原版 JSON 与小游戏可加载的 JS 关卡模块
data/solutions.js               62 个无 Portal 普通关卡的完整有效路径（提示数据，离线生成）
data/portal-solutions.js        Portal 试玩与普通 Portal 关卡的按 ID 分段解答
data/daily-challenges.js        每日两关题面、日期和镂空数据
data/daily-solutions.js         每日关卡按 level ID 索引的提示路径
src/app.js                      场景、反馈与纯棋盘 ViewModel 编排
src/gameplay/run-context.js     关卡来源、进度域与棋盘机制上下文
src/gameplay/completion-policies.js 按进度域分派普通/试玩/每日结算
src/gameplay/board-input-controller.js 棋盘 pointer 生命周期与逐格采样
src/platform/wechat.js          Canvas、触摸、生命周期、存储和广告 API
src/ui/canvas-renderer.js       单 Canvas 场景渲染门面
src/ui/board/interaction-map.js 命中区域与棋盘定位
src/ui/board/board-renderer.js  普通/每日共用的纯 ViewModel 棋盘与消除特效绘制
src/ui/board/portal-overlay.js  Portal 图标、状态光圈与资源回退
src/services/progress-store.js  版本化本地存档
src/services/progression-service.js 顺序解锁策略
src/services/skin-service.js    皮肤注册与切换
src/services/clear-effect-service.js 消除特效注册、选择与回退
src/services/ads-service.js     激励视频/插屏广告门面，默认无广告
src/services/audio-service.js   BGM、连线和通关音效适配
src/services/hint-service.js    普通/Portal 提示 provider 的兼容路由门面
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
src/mechanics/portal.js         传送门玩法拓展定义、试玩集与解答依赖
src/config/ads.js               广告位与展示频率配置
src/config/progression.js       普通关卡连续顺序解锁配置
src/config/audio.js              音频资源与音量配置
assets/audio/                   压缩后的本地音频素材
docs/portal-mechanic.md          传送门玩法、状态机、数据/提示契约与代码边界
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
assets/effects/none/             “无特效”选择页预览图
assets/effects/fade/             “逐渐消失”特效选择页预览图
tests/clear-effect-service.test.js、tests/clear-effect-system.test.js 特效服务与场景测试
```

新增皮肤时，只需注册新的语义化皮肤配置和素材映射，不改关卡规则。正式题目的提示路径会在发布前
离线生成并由测试校验，运行时仍保留普通与 Portal 的防御性回退搜索。部署广告时，在
`src/config/ads.js` 填入广告位 ID；游戏规则不直接依赖广告 API。激励视频只在完整播放后
返回奖励资格，插屏广告包含频率和最短间隔控制。

## 验证

```sh
node tests/run.js
```

测试覆盖路径连接、回退、阻挡、跨行边界、重画、撤销、Portal v1/v2 与多出口回放、92 个普通关卡的数据完整性、
普通 Portal 章节的按 ID 发布校验与逐段回放、进度存储、
主题清单/分页/素材回退、回廊与消除特效清单/分页/存档/无特效与淡出回退、每日两关/次数/镂空规则、
未填满棋盘的失败终局与重试、Canvas 渲染和完整小游戏启动/触控烟雾流程。62 个无 Portal 普通关卡的官方
解答以及 30 个 Portal 章节解答还会实际驱动规则机，确保全部保持胜利结果。

如修改原始关卡 JSON，可运行 `node scripts/generate-level-modules.js` 更新提交到工程中的
JS 数据模块；正常导入和运行小游戏不需要执行此命令。

声音系统使用原版 BGM 的压缩版本，以及 Echo of Genesis 提供的点击、连线、错误和通关
音效；通关音采用约 2.3 秒的短版 shimmer。小游戏首次触摸后解锁音频，切到后台会暂停，
并可在首页或游玩页切换静音。原项目代码、关卡和仓库素材的许可声明见
`THIRD_PARTY_NOTICES.md`。
