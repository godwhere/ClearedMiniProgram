# Cleared 微信小游戏

这是对 2017 年 Xamarin 游戏 [brainoffline/Cleared](https://github.com/brainoffline/Cleared)
的轻量复刻。工程使用微信小游戏原生 JavaScript + Canvas 2D，不依赖 Cocos、Unity、npm
或网页运行环境。

现有内容：

- 6 个关卡组、122 个可玩关卡（Training 2、5×5 10、6×6 20，其余各 30）；
- 首页、选关、左右滑动切组、游玩、撤销、重置和通关流程；
- 原版“连接成功后路径淡出并清空格子”的玩法；
- 全局顺序解锁，完成当前关后开放下一关，锁定关不可进入；
- 关卡底部左右分布“提示 / 回撤”按钮；提示以对应颜色的呼吸格子显示一条预计算的有效路径；
- 本地完成进度和每关最佳时间；
- 原版配色与 Logo；
- 可插拔皮肤服务与无广告默认实现。
- 主题入口、2×3 分页主题画廊，以及宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐、交通工具十个非经典主题素材。
- 回廊与消除特效选择场景（首个“逐渐消失”特效）；运行时已将首页原主题按钮替换为回廊入口。
- “高难关卡”入口与“每日挑战”：每日 2 关（3×3 入门、8×10 极难镂空），正式模式每日默认 3 次进入；开发入口可无限次调试。

主题（内部仍称 skin）的画廊、分页、资源协议与代码边界记录在
[`docs/theme-system.md`](docs/theme-system.md)。宝石、动物、水果、甜点、太空、海洋、春天、节日限定、音乐和交通工具十个非经典主题已接入运行时，后续主题按同一协议扩展。
主题卡片预览直接使用各主题前四个 tile 按 2×2 排列，不依赖独立预览图。
节日限定当前先作为可选视觉主题接入，按日期自动上架/下架的运营规则后续另行实现。

回廊功能入口、消除特效选择页、首个“逐渐消失”特效以及首页主题入口迁移契约，记录在
[`docs/corridor-and-clear-effects.md`](docs/corridor-and-clear-effects.md)。第一版场景、特效和首页回廊入口已接入，旧主题 action 仍兼容保留。

传送门玩法的入口段锁定、松手后从配对出口继续、错误选择回滚、试用关卡计划、分段解答格式和
`GameRunner`/输入/渲染代码边界记录在 [`docs/portal-mechanic.md`](docs/portal-mechanic.md)。
目前已完成核心规则、手势编排、分段提示、Canvas 渲染与 5 个试用关卡（`data/portal-demo.js`）及分段解答（`data/portal-solutions.js`）的完整接入与测试验证；默认传送门图标为
[`assets/icons/portal.png`](assets/icons/portal.png)。

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

拖动连线时，当前路径格会使用对应线路颜色并轻微放大；松手后按原版规则淡出。

关卡按 Training → 5×5 → 6×6 → 7×7 → 8×8 → 8×10 的顺序解锁。已完成关卡
始终可以重玩；未解锁关卡显示锁图标且不响应点击。

## 轻量架构

```text
game.js                         小游戏入口
core/game-runner.js             纯规则与撤销状态（支持可选镂空），不依赖 wx/Canvas
data/                           原版 JSON 与小游戏可加载的 JS 关卡模块
data/solutions.js               122 关完整有效路径（提示数据，离线生成）
data/daily-challenges.js        每日两关题面、日期和镂空数据
data/daily-solutions.js         每日关卡按 level ID 索引的提示路径
src/app.js                      场景与输入编排
src/platform/wechat.js          Canvas、触摸、生命周期、存储和广告 API
src/ui/canvas-renderer.js       单 Canvas 渲染与命中区域
src/services/progress-store.js  版本化本地存档
src/services/progression-service.js 顺序解锁策略
src/services/skin-service.js    皮肤注册与切换
src/services/clear-effect-service.js 消除特效注册、选择与回退
src/services/ads-service.js     激励视频/插屏广告门面，默认无广告
src/services/audio-service.js   BGM、连线和通关音效适配
src/services/hint-service.js    解答路径提示与运行时回退搜索
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
src/effects/fade.js             “逐渐消失”特效 manifest
src/config/ads.js               广告位与展示频率配置
src/config/progression.js       跨关卡组解锁配置
src/config/audio.js              音频资源与音量配置
assets/audio/                   压缩后的本地音频素材
docs/portal-mechanic.md          传送门玩法、状态机、数据/提示契约与代码边界
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
assets/effects/fade/             “逐渐消失”特效选择页预览图
tests/clear-effect-service.test.js、tests/clear-effect-system.test.js 特效服务与场景测试
```

新增皮肤时，只需注册新的语义化皮肤配置和素材映射，不改关卡规则。提示路径已在发布前
离线生成并由测试校验，运行时不需要求解器。部署广告时，在
`src/config/ads.js` 填入广告位 ID；游戏规则不直接依赖广告 API。激励视频只在完整播放后
返回奖励资格，插屏广告包含频率和最短间隔控制。

## 验证

```sh
node tests/run.js
```

测试覆盖路径连接、回退、阻挡、跨行边界、重画、撤销、122 关数据完整性、进度存储、
主题清单/分页/素材回退、回廊与消除特效清单/分页/存档/淡出回退、每日两关/次数/镂空规则、
Canvas 渲染和完整小游戏启动/触控烟雾流程。

如修改原始关卡 JSON，可运行 `node scripts/generate-level-modules.js` 更新提交到工程中的
JS 数据模块；正常导入和运行小游戏不需要执行此命令。

声音系统使用原版 BGM 的压缩版本，以及 Echo of Genesis 提供的点击、连线、错误和通关
音效；通关音采用约 2.3 秒的短版 shimmer。小游戏首次触摸后解锁音频，切到后台会暂停，
并可在首页或游玩页切换静音。原项目代码、关卡和仓库素材的许可声明见
`THIRD_PARTY_NOTICES.md`。
