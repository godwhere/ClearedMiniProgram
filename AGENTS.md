# Cleared Mini Game：代理协作指南

## 核心原则

先理解，再做减法。目标不是最少行数，而是交付最小、完整、可读且可验证的正确改动。

动手前按顺序判断，找到第一个足以解决问题的方案就停止扩张：

1. 需求是否已经由现有行为满足，或根本不需要新增实现。
2. 仓库里是否已有可复用的模块、配置、数据协议、测试或相邻模式。
3. 原生 JavaScript、Canvas 2D 或微信小游戏 API 是否已经覆盖。
4. 是否能在现有边界内做一个局部修改。
5. 只有上述方案都不成立时，才新增实现；不要为假设中的未来需求搭脚手架。

最小化不能省掉：信任边界校验、防止进度或数据丢失的错误处理、兼容回退、触控与安全区适配、用户明确要求，以及能证明行为正确的验证。

## 开始修改前

- 先读需求涉及的 `README.md`、对应 `docs/*.md`、实现和测试，沿实际入口把流程追完整。
- 用搜索找到准备修改的函数、所有调用者、同类 action/scene、存档字段和测试；修 bug 时优先修共同根因，并检查兄弟调用路径。
- 先查看 `git status` 和相关 diff。工作区中的未提交改动属于用户；不得清理、回退、覆盖或顺手格式化无关文件。
- 对复杂但意图清楚的任务，默认交付风险可控的最小版本，并说明有意未做的扩展；只有会实质改变结果的选择才需要停下来询问。

## 项目事实与边界

- 这是原生微信小游戏：CommonJS JavaScript + 单 Canvas 2D，无 npm 运行依赖、无 DOM、无常规构建步骤。入口为 `game.js -> src/bootstrap.js -> src/app.js`。
- 微信开发者工具可直接导入项目。不要引入 Web 专用 API、包管理器、框架或构建系统，除非需求确实无法由当前运行时完成并已说明维护成本。
- `core/game-runner.js` 是纯玩法规则与状态权威；`core/portal-validation.js` 负责传送门题面/解答校验。两者不得依赖 `wx`、Canvas、场景 UI 或主题外观。
- `GameRunner` 调用方只能通过结构化 gesture 结果和只读 board/selection/mechanic/view 查询获取状态；App、Hint 和 Renderer 不得读取其可变内部数组。
- `src/app.js` 负责场景、反馈和结算编排；`src/gameplay/` 负责 RunContext、按进度域结算和棋盘输入；`src/ui/canvas-renderer.js` 负责场景绘制门面，`src/ui/board/` 只消费纯 ViewModel；`src/platform/wechat.js` 是微信 API 适配边界。不要跨层复制职责。
- `src/services/` 承担存档、解锁、提示、音频、广告、每日挑战、主题和特效等领域能力；优先通过现有服务扩展，不要在 app 或 renderer 中另建平行状态。
- `HintService` 只负责兼容路由；普通与 Portal hint provider 只能消费纯 HintContext，不能持有 Runner、Canvas 或平台对象。
- `src/skins/*.js` 和 `src/effects/*.js` 应保持声明式 manifest；注册顺序集中在各自 `index.js`。主题和特效不能改变连线规则，也不能注入平台调用或任意业务回调。
- `src/mechanics/*.js` 是 data-only 的玩法拓展定义，只能声明稳定 ID、规则版本、资源和试玩内容依赖；不得携带触摸、结算、存档、Canvas、平台或远程脚本回调。
- 处理玩法拓展时必须区分“关卡来源/进度域”和“棋盘机制”：试玩是否写进度由来源决定，portal 等机制只决定规则与展示。详细迁移边界见 `docs/gameplay-extension-architecture.md`。
- 旧小程序的 `pages/` 及根目录 `app.js`、`app.json`、`app.wxss` 已删除。除非任务明确要求恢复旧实现，否则不得重新引入平行页面结构；新功能只改当前 Canvas 运行时。
- scene/action/hit ID、存档 key、关卡 ID 和已发布 manifest ID 都是兼容契约；非必要不要重命名或复用。

## 实现约束

- 复用现有 CommonJS、代码风格和数据结构。避免单实现抽象、重复 helper、投机性配置、无调用者的扩展点和无请求的全仓重构。
- 优先改最接近根因且由所有相关路径共用的位置；文件越少越好，但不能为了小 diff 把逻辑放错层。
- 平台失败必须有安全回退：存储失败不能破坏内存状态，资源失败不能阻断游戏，广告缺失应保持 no-op，非法主题应回退经典主题。
- Canvas/触控改动必须继续使用动态宽高、`safeTop`/`safeBottom` 和受控 DPR；不要把截图尺寸或运行时统计硬编码成产品逻辑。
- 有意采用带上限的简化方案时，在相邻注释或对应设计文档中写清上限与升级触发条件，不留含糊的“以后优化”。
- 不手改带 `Generated from the adjacent JSON source` 标记的关卡 JS。修改 `data/clearedset*.json` 后运行 `node scripts/generate-level-modules.js`，并保持 JSON、生成的 JS、catalog、solutions 与相关测试一致。
- 修改主题素材前阅读 `docs/theme-system.md`；正式 sprite sheet 必须满足当前 manifest 与校验脚本的尺寸、槽位、透明安全边及回退契约。脚本通过只是必要条件，仍需视觉验收。

## 验证

- 任何非平凡行为变化都要在现有 `tests/` 体系中留下最小有效回归测试；测试应在错误实现下失败，而不只是执行代码。
- 代码、配置或数据变更完成后运行：

  ```sh
  node tests/run.js
  ```

- 修改主题 sprite sheet 时还要运行：

  ```sh
  node scripts/validate-theme-assets.js <PNG_OR_DIRECTORY>
  ```

- 测试文件导出 `run` 并由 `tests/run.js` 聚合；直接执行单个 `*.test.js` 不会自动运行测试。
- 涉及触控、安全区、Canvas 视觉、图片加载、音频、广告或生命周期时，Node 测试不能替代微信开发者工具编译/预览和必要的真机验收。明确报告尚未执行的设备验证。
- 完成前运行 `git diff --check`，并再次确认 diff 只包含任务所需文件。

## 文档与交付

- 文档描述当前有效实现和约束，不在 `README.md` 中堆叠实施过程、旧方案或逐次变更记录。

以下修改必须在同一次交付中同步对应 Markdown 文档：

| 修改类型 | 必须同步的文档 |
| --- | --- |
| 用户可见玩法、内容数量、功能入口、本地运行命令、顶层架构或当前包体结构 | `README.md` |
| 棋盘规则、机制协议、关卡/解答格式、关卡来源或进度域 | `docs/gameplay-extension-architecture.md`，并按内容同步 `docs/portal-mechanic.md`、`docs/ice-trial.md`、`docs/daily-challenge-mode.md` 或关卡专题文档 |
| 主题、消除效果、manifest、精灵表、预览图或素材回退规则 | `docs/theme-system.md` 或 `docs/corridor-and-clear-effects.md` |
| `game.json` 分包、资源路径、按需加载、`packOptions`、包体预算或预算脚本 | `docs/package-splitting.md`；涉及包体基线或优化取舍时同时更新 `docs/package-size-optimization-plan.md`；用户可见包组成变化时同步 `README.md` |
| CloudBase 身份、联网、存档、同步、冲突、货币、奖励、购买或体力合同 | `docs/cloudbase-local-first-sync.md`，并按领域同步 `docs/reward-unlock-system.md` 或 `docs/stamina-system.md` |
| 场景/action、模块职责、依赖方向、入口链路、平台适配或生命周期边界 | 对应架构文档；影响顶层入口或结构时同步 `README.md` |
| 语言检测、词典、用户语言设置或可见文案协议 | `docs/localization.md`；支持语言或切换入口变化时同步 `README.md` |
| 发布配置、验证命令或验收标准 | 对应专题文档；用户需要执行的命令变化时同步 `README.md` |

- 一项修改命中多行时，需要同时更新所有对应文档；如果确认无需更新，最终说明中简要写明原因。
- 最终说明只需交代：改了什么、改在哪里、如何验证、哪些设备或发布检查尚未执行。不要用长篇说明掩盖不必要的实现。
