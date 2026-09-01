# 玩法拓展架构整理方案（以传送门 v1 为基线）

> 记录日期：2026-09-01  
> 审阅基线：`main@4a3c34aab0f4034b886cdbf2a5cbaf14b1d038cc`  
> 文档状态：阶段 0—6 已实施并进入回归基线；阶段 7 尚未触发
> 关联文档：[`portal-mechanic.md`](portal-mechanic.md)、[`daily-challenge-mode.md`](daily-challenge-mode.md)、[`../AGENTS.md`](../AGENTS.md)

## 1. 审阅结论

这次传送门提交已经把 v1 从“实验逻辑”推进为可发布校验的完整玩法：

- `Mechanic: 'portal'` 与 `PortalRulesVersion: 1` 成为显式启用条件，非法、缺失或未来版本不会悄悄改变普通关卡规则；
- `PORTAL_LOCKED → PORTAL_WAIT → PORTAL_CONTINUE` 的触摸边界更完整，`touchcancel` 不再被简单等同为整段取消；
- 存储解支持正反向、分段提示和传送边，运行时搜索也不再把门两端当成普通相邻格；
- 试玩关卡从普通 catalog、普通进度、最佳时间和广告计数中隔离；
- 门格拥有独立视觉语义，不再叠加主题棋子、提示棋子和清除棋子；
- `portal-publishing.test.js` 会校验并逐段重放 5 个真实试玩关卡，形成了可靠的内容发布门槛；
- 每日挑战 v1 明确拒绝传送门题面，避免在尚无分段存档契约时错误兼容。

这些行为应当作为后续重构的回归基线，不能为了拆文件而改变。

审阅基线当时最主要的问题不是传送门规则不完整，而是**玩法拓展的边界只在 manifest 层出现，运行时边界仍然分散在 `GameRunner`、`ClearedApp`、`HintService` 和 `CanvasRenderer` 中**。如果在该结构上直接增加第二种玩法，中心文件会继续扩张，并产生更多 `if (mechanic === ...)` 分支。

因此后续方案采用：

> 先固定公开契约，再拆运行上下文和读写边界；先消除中心文件对内部状态的读取，再考虑通用玩法注册表。每一个阶段都保持可运行、可回滚、可独立提交。

## 2. 审阅基线中必须解决的五个问题（现均已解决）

本节保留阶段 0 实施前的历史问题描述，用于解释重构动机；当前代码状态以第 10—11 节的完成标准和落地记录为准。

### 2.1 “关卡来源”和“棋盘机制”被混成一个判断

审阅基线中的 `activeMechanicId === 'portal'` 同时被用于判断：

- 当前棋盘是否有传送门规则；
- 当前关卡是否是试玩；
- 通关是否写普通进度；
- 结果页返回首页还是选关；
- 是否存在下一关。

这两个概念必须正交：

- **关卡来源（run source）**决定进度、结果和导航，例如普通 catalog、玩法试玩、每日挑战；
- **棋盘机制（mechanic）**决定移动拓扑和交互规则，例如普通、portal。

以后正式普通关卡完全可能使用 portal 规则并照常写进度；其他试玩也可能使用普通规则但不写进度。结算逻辑不能再由 `mechanicId` 推断。

### 2.2 `setIndex = -1` 和 `currentSet/currentLevel` 构成隐式哨兵协议

审阅基线中，普通关卡使用 `catalog.sets[setIndex]`，传送门试玩使用 `currentSet/currentLevel`，并将 `setIndex` 设为 `-1`。每个调用方都需要记住：

```text
setIndex >= 0 可能是普通关卡
setIndex === -1 可能是试玩
currentSet 不为空时又覆盖 catalog
```

这会让提示、结果、下一关、返回、统计等逻辑持续增加例外。应使用显式的运行上下文，索引缺失时使用 `null`，不再以负数表达业务含义。

### 2.3 App、Hint 和 Renderer 直接读取 `GameRunner` 可变内部字段

审阅基线中的调用方会直接读取：

```text
selectedLine / selectedCells / selectedSegments
completedPaths / completedSegments / completedTeleports
portalPhase / portalPending / portalLock
owner / fixedLine / blockedMask
portalByCell / portals
```

这些字段一旦调整，输入、提示和渲染会同时破坏。规则层虽然是“唯一权威”，但还没有真正的稳定查询接口。后续应提供只读快照和结构化手势结果，并保留旧方法作为兼容包装。

### 2.4 Portal schema 在 Runner 与 Validator 中重复实现

审阅基线中的 `core/game-runner.js` 和 `core/portal-validation.js` 都各自读取：

- `Mechanic/mechanic`；
- `PortalRulesVersion/portalRulesVersion`；
- `Portals/portals`；
- `Id/id`、`A/a`、`B/b`、`Cells/cells`；
- 棋盘范围、重复格和索引。

Validator 应保持严格诊断，Runner 应保持防御性降级，但两者应共享同一套**无副作用的读取与规范化函数**，避免某一边升级后另一边仍按旧规则解释题面。

### 2.5 `HintService` 和 `CanvasRenderer` 在审阅基线中再次成为中心文件

Portal 初次接入后：

- `HintService` 同时处理普通解、每日解、分段 portal 解、反向解、路径可用性和 BFS；
- `CanvasRenderer` 同时处理场景、棋盘、门格、提示、清除动画、素材缓存和命中区域；
- 两者都依赖 Runner 的内部结构。

应优先拆出 portal hint provider 和 board/portal renderer，而不是把整个服务或整个 Canvas 系统一次重写。

## 3. 不可破坏的架构约束

后续所有阶段必须继续遵守：

1. 保持原生微信小游戏、CommonJS、单 Canvas、无 npm 运行依赖和无额外构建系统。
2. `core/` 不依赖 `src/`、`wx`、Canvas、存档、音频、广告或 UI 文案。
3. `src/platform/wechat.js` 继续作为唯一微信 API 边界。
4. `src/mechanics/*.js` 保持 data-only manifest，不允许注入任意回调、平台对象或存档对象。
5. 主题和清除特效仍是纯视觉能力，不能改变棋盘拓扑。
6. `home:portalTrial`、`corridor:portalTrial` 兼容别名、`portal` manifest ID、关卡 ID、存档 key 和已发布 action ID 不重命名。
7. 普通 122 关、每日挑战和传送门试玩的进度域继续隔离。
8. `pages/` 与根目录旧小程序页面不进入新架构。
9. 每个重构提交都必须先通过 `node tests/run.js`，再进入下一阶段。
10. 不在同一提交中同时进行大规模搬文件、改玩法规则和改视觉表现。

## 4. 目标依赖方向

目标不是引入“插件框架”，而是建立少量稳定边界：

```text
game.js
  └─ src/bootstrap.js                    只装配依赖
       └─ src/app.js                     场景、结果与反馈编排
            ├─ src/gameplay/run-context.js
            ├─ src/gameplay/board-input-controller.js
            ├─ src/gameplay/completion-policies.js
            ├─ src/services/hint-service.js        兼容门面
            │    ├─ src/services/hints/ordinary-hint-provider.js
            │    └─ src/services/hints/portal-hint-provider.js
            │         └─ core/portal-solution.js
            └─ src/ui/canvas-renderer.js           场景渲染门面
                 └─ src/ui/board/*

core/game-runner.js
  ├─ core/portal-schema.js
  └─ 纯规则、快照和结构化结果

core/portal-validation.js
  └─ core/portal-schema.js
```

依赖只能向下：

```text
bootstrap → app/gameplay/services/ui → core/data
ui       → 只读 ViewModel，不反向写 app 或 runner
services → core 的只读契约，不读取 Canvas/platform 私有对象
core     → 只依赖纯数据和纯函数
```

## 5. 核心概念与稳定数据契约

### 5.1 `MechanicDefinition`：只声明能力，不承载业务实现

现有 `src/mechanics/portal.js` 的方向正确，继续保持类似形状：

```js
{
  id: 'portal',
  kind: 'gameplay-extension',
  mechanic: 'portal',
  rulesVersion: 1,
  icon: 'assets/icons/portal.png',
  enabled: true,
  trial: {
    label: '传送门试玩',
    action: 'home:portalTrial',
    set: portalDemo,
    solutions: portalSolutions
  }
}
```

它可以声明：

- 稳定 ID 与规则版本；
- 展示名称和资源；
- 试玩入口与内容依赖；
- 是否启用。

它不得声明：

- `onTouchMove`、`onComplete` 等可执行业务回调；
- 进度写入方式；
- Canvas 绘制函数；
- `wx` API；
- 任意远程脚本。

只有当第二个真实玩法拓展进入实现时，才新增 `src/mechanics/index.js` 或 registry。当前只有 portal 时，不创建空的通用插件框架。

### 5.2 `RunContext`：明确关卡来源、进度域和机制

建议新增 `src/gameplay/run-context.js`，创建后不允许调用方手工拼装：

```js
{
  source: {
    kind: 'catalog' | 'mechanic-trial' | 'daily',
    id: 'ordinary' | 'portal-trial' | 'daily-2026-09-01'
  },
  progressionScope: 'ordinary' | 'none' | 'daily',
  mechanic: {
    id: null | 'portal',
    rulesVersion: null | 1
  },
  setIndex: null | 0,
  levelIndex: 0,
  set,
  level
}
```

硬规则：

- 结算由 `progressionScope` 决定，不由 `mechanic.id` 决定；
- `setIndex` 不适用时为 `null`，不得再使用 `-1`；
- `level` 和 `set` 在进入关卡时锁定为当前运行上下文；
- App 只持有一个普通/试玩 `runContext`，每日挑战继续由其独立 daily session 管理，后续再统一；
- `isPortalTrial()` 最终替换为 `runContext.source.kind === 'mechanic-trial' && source.id === 'portal-trial'`；
- 正式 portal 普通关未来可以是 `source.kind === 'catalog'`、`progressionScope === 'ordinary'`、`mechanic.id === 'portal'`。

### 5.3 `GameRunner`：命令接口与查询接口分离

#### 命令接口

第一阶段保留现有方法：

```js
touchStart(cell)
touchMove(cell)
touchEnd(cell)
handlePointerCancel()
reset()
undo()
pause()
resume()
```

随后新增结构化方法，并让旧方法成为兼容包装：

```js
startGesture(cell) -> GestureResult
moveGesture(cell) -> GestureResult
endGesture(cell) -> GestureResult
cancelGesture('pointer-cancel' | 'navigation' | 'reset') -> GestureResult
```

建议的结果形状：

```js
{
  changed: true,
  status: 'drawing' | 'portal-wait' | 'completed' | 'cancelled' | 'ignored',
  phase: 'READY' | 'DRAWING' | 'PORTAL_LOCKED' | 'PORTAL_WAIT' | 'PORTAL_CONTINUE',
  expectedExit: null | 12,
  commit: null | {
    lineIndex: 0,
    cells: [/* 完整覆盖格 */],
    segments: [[/* A 段 */], [/* B 段 */]],
    teleports: [{ pairId: 'P1', from: 21, to: 2 }]
  },
  outcome: 'playing' | 'won' | 'failed'
}
```

App 只根据结果触发音效、震动、清除动画与结算，不再在 `touchEnd()` 后读取 `completedPaths[lineIndex]`。

#### 查询接口

建议提供：

```js
getBoardState()
getSelectionState()
getMechanicState()
getCompletedLine(lineIndex)
getViewState()
```

返回值必须是新对象或只读副本，至少覆盖：

```js
{
  outcome,
  elapsedMs,
  board: {
    width,
    height,
    blocked,
    owner,
    fixedLine
  },
  selection: {
    lineIndex,
    cells,
    segments
  },
  mechanic: {
    id: null | 'portal',
    rulesVersion: null | 1,
    phase,
    portals,
    pending: null | { lineIndex, pairId, entry, exit, entryCells },
    locked: null | { lineIndex, pairId, entry, exit }
  }
}
```

棋盘最大仅 8×10，按帧复制几十个整数的成本可控。若未来性能数据证明有问题，再改为版本号加缓存；不要现在暴露可变数组换取未经证明的微小优化。

### 5.4 输入控制器：只翻译 pointer，不重新判断规则

建议新增 `src/gameplay/board-input-controller.js`，迁移：

- board pointer 的捕获与释放；
- `traceBoard()` 的逐格插值；
- 大步滑动遇到 `PORTAL_LOCKED` 时立即停止；
- pointer ID 校验；
- pointer cancel 到 Runner 命令的映射；
- `cellAt()` 与 board layout 的读取。

输入控制器依赖一个小型定位接口：

```js
{
  cellAt(x, y),
  getBoardLayout()
}
```

它输出事件，不直接播放音效或修改场景：

```js
{ type: 'step' }
{ type: 'portal-wait', expectedExit: 2 }
{ type: 'path-completed', commit }
{ type: 'invalid-selection' }
{ type: 'cancelled' }
```

App 继续负责：

- 音效与震动；
- 清除动画；
- result/dailyResult 转场；
- 结算与存档；
- 首页、选关和画廊 UI pointer。

输入控制器不得：

- 读取 `portalPending` 或 `portalLock` 后自行推断规则；
- 写普通或每日进度；
- 调用 Renderer 绘制方法；
- 直接依赖 `wx`。

### 5.5 提示服务：门面路由到 provider

保留 `src/services/hint-service.js` 作为兼容门面，避免现有构造调用立即失效。内部逐步拆为：

```text
src/services/hints/ordinary-hint-provider.js
src/services/hints/portal-hint-provider.js
```

职责建议：

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `HintService` | 根据只读 mechanic state 选择 provider；保持 `find/findDaily` 兼容 API | BFS 细节、Canvas、音效 |
| ordinary provider | 普通/每日平面路径、已有解答选择 | portal 分段与门状态 |
| portal provider | 分段解规范化、正反向、等待态剩余段、portal-aware 搜索 | 修改 Runner、结算、资源加载 |
| `core/portal-solution.js` | 分段解纯数据规范化与反转 | 查询棋盘占用、播放提示 |

Portal provider 只接受只读 `HintContext`：

```js
{
  levelId,
  width,
  height,
  lines,
  completedLines,
  owner,
  fixedLine,
  blocked,
  selection,
  portal: {
    phase,
    portals,
    pending
  }
}
```

不再直接持有并读取可变 Runner 实例。

### 5.6 完成策略：按进度域结算

建议新增 `src/gameplay/completion-policies.js`，先使用简单函数，不建立类层级：

```js
settleOrdinary(context)
settleTrial(context)
settleDaily(context)
```

| progressionScope | 行为 |
| --- | --- |
| `ordinary` | `ProgressStore.recordCompletion()`，更新最佳时间，调用普通广告完成钩子 |
| `none` | 生成 `persisted: false` 的会话结果，不写任何普通存档或广告计数 |
| `daily` | 调用 DailyProgressStore 的每关/每日结算，不写普通 ProgressStore |

`onPathCompleted()` 最终只负责：

1. 创建清除动画快照；
2. 处理 failed 终局；
3. 将 won 交给对应完成策略；
4. 根据策略结果切换场景。

它不再包含 `if (isPortalTrial())` 这种按玩法 ID 结算的分支。

### 5.7 Renderer：只消费纯 ViewModel

目标状态下 `CanvasRenderer` 不再接收 Runner 实例，而接收：

```js
{
  board: {
    width,
    height,
    cells,
    completedPaths,
    selection,
    clearAnimation,
    hint
  },
  mechanic: {
    portal: null | {
      icon,
      portals,
      phase,
      expectedExit,
      lockedEntry
    }
  }
}
```

推荐逐步拆出：

```text
src/ui/board/board-renderer.js
src/ui/board/portal-overlay.js
src/ui/board/interaction-map.js
```

边界：

- `board-renderer.js` 负责底板、普通格、路径、提示、清除动画的绘制顺序；
- `portal-overlay.js` 只负责门格底板、图标、编号、锁定/等待光圈和资源回退；
- `interaction-map.js` 保存 hit 与 board layout，提供 `hitTest/cellAt/getBoardLayout/clear`；
- `canvas-renderer.js` 保持场景分发和公共绘图原语，在迁移完成前作为兼容门面；
- Portal overlay 必须最后绘制，但不得自行读取 Runner 或修改 App 状态。

## 6. 文件级代码边界

| 文件/模块 | 可以依赖 | 必须负责 | 禁止负责 |
| --- | --- | --- | --- |
| `src/bootstrap.js` | platform、配置、数据、服务构造器 | 实例化和注入 | 场景状态、portal phase、结算 |
| `src/mechanics/portal.js` | portal demo、solutions 路径数据 | data-only 描述与入口元数据 | 规则函数、Canvas、存档、wx |
| `src/gameplay/run-context.js` | catalog/manifest 的纯数据 | 规范化关卡来源和进度域 | 规则执行、绘制、持久化 |
| `src/gameplay/board-input-controller.js` | Runner 命令接口、cell locator | pointer 生命周期和逐格采样 | portal 合法性、结算、绘制 |
| `src/gameplay/completion-policies.js` | ProgressStore、DailyStore、Ads 的窄接口 | 按 progressionScope 结算 | 棋盘规则、触摸、Canvas |
| `core/portal-schema.js` | 无或纯 helper | 字段读取、规范化、索引 | UI、错误文案、存档 |
| `core/portal-validation.js` | portal schema/solution | 严格题面和发布诊断 | 运行时状态、自动修复题面 |
| `core/game-runner.js` | portal schema | 棋盘规则、状态机、撤销、结果 | wx、Canvas、提示、音效、存档 |
| `src/services/hint-service.js` | provider | 兼容门面和 provider 选择 | portal BFS 细节、UI |
| `src/services/hints/portal-hint-provider.js` | 只读 HintContext、纯 solution helper | 分段提示和搜索 | Runner 修改、结算 |
| `src/ui/board/board-renderer.js` | Canvas 原语、纯 ViewModel | 棋盘绘制顺序 | 读取存档、调用规则命令 |
| `src/ui/board/portal-overlay.js` | Canvas 原语、图片缓存、portal ViewModel | portal 视觉 | 判断传送合法性、修改 phase |
| `src/app.js` | 上述模块的公开接口 | 场景、反馈、动画和模块编排 | 重复实现 portal schema/BFS/Canvas 细节 |

## 7. 分阶段实施步骤

> 实施记录（2026-09-01）：阶段 0—6 已按下述边界落地。以下步骤继续作为回归、审阅和后续拆分的验收契约；阶段 7 仍须满足其触发条件后另案实施。

每一阶段独立提交；禁止把后续阶段的空目录或空抽象提前加入。

### 阶段 0：冻结基线与自动化安全线

**目标**：在重构前证明当前传送门行为，防止“搬代码时顺便改规则”。

**涉及文件**：

```text
.github/workflows/test.yml                  新增（若启用 GitHub Actions）
tests/architecture-boundaries.test.js      新增
tests/run.js                               注册测试
docs/gameplay-extension-architecture.md    本文
```

**步骤**：

1. 保留现有 5 个试玩关的 publishing replay 测试。
2. 增加边界测试，至少检查 `core/*.js` 不 require `src/`、`wx`、Canvas 或存档服务。
3. 增加公开契约快照：portal manifest ID、rulesVersion、试玩 action、兼容 alias 不变。
4. 在 Actions 中执行 `node tests/run.js`；固定一个项目支持的 Node 版本。
5. 将 PR 合并条件设为测试通过；主分支保护属于仓库设置，不在运行时代码中实现。

**验收**：

- 全量 Node 测试通过；
- 普通 122 关和 5 个 portal 试玩解答均能重放；
- 微信开发者工具与真机验收仍单独记录，Node 测试不宣称覆盖设备行为。

**建议提交**：`test: freeze gameplay extension architecture contracts`

### 阶段 1：统一 Portal schema

**目标**：消除 Runner 与 Validator 的字段解释重复，不改任何玩法行为。

**涉及文件**：

```text
core/portal-schema.js              新增
core/portal-validation.js          修改
core/game-runner.js                修改
tests/portal-validation.test.js    修改
tests/game-runner-portal.test.js   修改
tests/portal-publishing.test.js    保持/补充
```

**步骤**：

1. 将纯读取函数迁入 `portal-schema.js`：字段 alias、尺寸、portal descriptor、index 构建。
2. Validator 调用共享 schema，并继续产生现有稳定错误码。
3. Runner 调用同一 schema，但只消费 validator-safe 的规范化结果；非法 v1 仍回退普通移动。
4. `core/portal-validation.js` 保留当前默认导出和所有公开 alias，避免脚本/测试调用失效。
5. 加入“同一题面在 validator 和 runner 中得到一致 portal index”的交叉测试。

**验收**：

- 错误码集合不变；
- 缺失/未来版本仍不启用 portal；
- 普通关不受影响；
- 5 个试玩 publishing replay 全部通过。

**建议提交**：`refactor(core): share portal schema normalization`

### 阶段 2：引入显式 RunContext，移除负索引哨兵

**目标**：将“试玩/普通/每日来源”与“portal/普通机制”分开。

**涉及文件**：

```text
src/gameplay/run-context.js      新增
src/app.js                       修改
tests/app-portal.test.js         修改
tests/app-smoke.test.js          修改
tests/progress-store.test.js     必要时补充
```

**步骤**：

1. 实现 `createCatalogRunContext()` 与 `createMechanicTrialRunContext()`。
2. `openLevel()` 创建 catalog context；`openPortalTrial()` 创建 mechanic-trial context。
3. 用 `runContext.set/level/levelIndex` 替换 `currentSet/currentLevel` 双轨读取。
4. 将 `setIndex = -1` 替换为 `setIndex: null`；普通进度 API 只在 `progressionScope === 'ordinary'` 时接收索引。
5. 将返回、重玩、下一关和结果文案判断改为读取 `source.kind/source.id`。
6. `mechanic.id` 只用于规则/展示，不再决定是否持久化。
7. 暂时保留 `isPortalTrial()` 作为兼容 helper，但其实现改为读取 `runContext.source`；下一阶段移除内部调用。

**验收**：

- Portal 试玩仍不写普通完成、最佳时间、lastPlayed 或广告计数；
- 普通关照常写进度；
- `setIndex` 不再出现业务哨兵 `-1`；
- 构造一个“普通来源 + portal mechanic”的测试上下文时，结算策略仍为 ordinary。

**建议提交**：`refactor(gameplay): separate run source from board mechanic`

### 阶段 3：建立 Runner 结构化结果与只读查询

**目标**：调用方不再读取 Runner 的可变内部数组。

**涉及文件**：

```text
core/game-runner.js                  修改
src/app.js                           修改
src/services/hint-service.js         先适配查询接口
src/ui/canvas-renderer.js            先适配查询接口
tests/game-runner-contract.test.js   新增
tests/game-runner-portal.test.js     修改
```

**步骤**：

1. 新增 `startGesture/moveGesture/endGesture/cancelGesture` 的结构化返回值。
2. `touchStart/touchMove/touchEnd/handlePointerCancel` 保持旧返回语义，内部委托新方法。
3. `endGesture()` 在完成时直接返回完整 `commit`，包括 cells、segments 和 teleports。
4. 新增只读 board/selection/mechanic 查询；数组全部复制。
5. App 使用 commit 创建清除动画，不再读 `completedPaths/completedSegments`。
6. Hint 和 Renderer 先改为使用查询结果，后续阶段再拆文件。
7. 加入“调用方修改返回快照不会改变 Runner”的测试。

**验收**：

- App、Hint、Renderer 中不再直接读取 `portalPending/portalLock/completedSegments`；
- 旧 touch API 的测试全部保持通过；
- 清除动画仍覆盖入口段和出口段；
- `touchcancel` 的三个 portal 分支行为不变。

**建议提交**：`refactor(core): expose immutable runner interaction results`

### 阶段 4：抽出棋盘输入控制器

**目标**：让 App 不再包含 portal 专属 pointer 分支和逐格插值细节。

**涉及文件**：

```text
src/gameplay/board-input-controller.js   新增
src/ui/board/interaction-map.js          新增或从 renderer 内部提取
src/app.js                               修改
src/ui/canvas-renderer.js                修改兼容门面
tests/board-input-controller.test.js     新增
tests/app-portal.test.js                 收缩为场景/结算测试
```

**步骤**：

1. 先将 `hits`、`boardLayout`、`hitTest()`、`cellAt()` 放入 InteractionMap，Renderer 保留代理方法。
2. 输入控制器接管 board pointer 的 start/move/end/cancel。
3. 迁移 `traceBoard()`，继续按 cell 的 0.32 倍步长逐格采样。
4. Runner 返回 `PORTAL_LOCKED` 后立即停止同次插值。
5. 输入控制器输出事件；App 负责音频、震动、动画和转场。
6. 首页、选关、主题、回廊和特效的 UI pointer 仍暂留 App，避免一次性重写所有输入。

**验收**：

- App 不访问 `renderer.boardLayout` 或直接清空 `renderer.hits`；
- 大步滑动不会越过入口门；
- 错误出口、未移动释放、系统取消、双指干扰均保持现有行为；
- 普通关 board input 回归通过。

**建议提交**：`refactor(input): isolate board gesture orchestration`

### 阶段 5：拆分 Portal Hint Provider

**目标**：让普通提示逻辑不理解 portal 状态，让 portal 搜索可独立测试。

**涉及文件**：

```text
core/portal-solution.js                       新增
src/services/hints/ordinary-hint-provider.js  新增
src/services/hints/portal-hint-provider.js    新增
src/services/hint-service.js                  缩减为门面
tests/hint-service.test.js                    保持兼容测试
tests/hint-service-portal.test.js             迁移 provider 测试
```

**步骤**：

1. 将分段解规范化、反转和 flatten 的纯逻辑迁到 `core/portal-solution.js`。
2. 将普通 stored path 与平面 BFS 迁到 ordinary provider。
3. 将 portal stored path、等待态剩余段和 portal BFS 迁到 portal provider。
4. Provider 只接收只读 HintContext，不持有 Runner。
5. `HintService.find()` 根据 `context.mechanic.id` 路由；`findDaily()` 可继续使用 ordinary provider 与独立 solutions catalog。
6. 保留旧构造函数三参数形式和 options object 形式，先不破坏宿主测试。

**验收**：

- `hint-service.js` 不再包含 portal BFS；
- Portal provider 测试覆盖正向、反向、等待态、入口格避让、门强制边、无解；
- 提示调用不能改变 Runner 快照；
- 普通与每日提示结果不变。

**建议提交**：`refactor(hints): isolate portal hint provider`

### 阶段 6：拆分棋盘与 Portal 渲染

**目标**：Renderer 不再读取 Runner，portal 视觉变成纯 ViewModel overlay。

**涉及文件**：

```text
src/ui/board/board-renderer.js       新增
src/ui/board/portal-overlay.js       新增
src/ui/canvas-renderer.js            缩减
src/app.js                           构建纯 board ViewModel
tests/renderer.test.js               修改
tests/renderer-portal.test.js        修改
```

**步骤**：

1. 从普通 play/daily 共用代码中提取 board layout 和基础格绘制。
2. 把 portal icon 加载、fallback、编号、锁定环和等待环迁入 portal overlay。
3. App/Presenter 根据 Runner 只读状态构建 board ViewModel。
4. Renderer 按固定顺序绘制：底板 → 普通格/路径 → 清除动画 → 提示 → portal overlay。
5. Portal 格继续跳过主题、提示和清除棋子；清除期间底板和门图标保留。
6. `CanvasRenderer` 继续负责场景分发、按钮和公共 Canvas 原语，不在本阶段拆首页/画廊。

**验收**：

- `CanvasRenderer` 和子 renderer 均不持有 Runner；
- 普通 play 与 daily 共用同一 BoardRenderer；
- 门图缺失仍有矢量回退且不阻塞输入；
- portal 提示不画跨门直线；
- Blocked、portal、endpoint 的层级无视觉回归。

**建议提交**：`refactor(ui): isolate board and portal rendering`

### 阶段 7：第二种玩法出现后再建立 Registry

**触发条件**：满足以下任一条件才实施：

- 第二种会改变棋盘规则的 gameplay extension 进入开发；
- Portal v2 支持多对门或链式门，需要按 rulesVersion 选择不同规则实现；
- 远程内容需要基于 allowlist 解析 mechanic。

届时新增：

```text
src/mechanics/index.js                 definition 注册与查询
core/mechanics/index.js                规则版本 allowlist
core/mechanics/portal-v1.js            如确有必要，从 GameRunner 拆出状态策略
```

Registry 只返回已知 definition/规则适配器；未知 ID 或版本必须拒绝或降级，不允许执行内容中携带的代码。

在触发条件出现前，`GameRunner` 继续作为唯一规则权威，避免为单一 portal 实现提前搭建复杂插件框架。

## 8. 建议的 PR 与提交边界

不要把全部阶段放进一个 PR。建议顺序：

| PR | 内容 | 运行时行为 |
| --- | --- | --- |
| PR 0 | 本文、README/AGENTS 链接 | 不变 |
| PR 1 | CI/架构边界测试 + shared portal schema | 不变 |
| PR 2 | RunContext + progressionScope 完成策略 | 不变 |
| PR 3 | Runner 结构化结果 + BoardInputController | 不变 |
| PR 4 | Hint provider 拆分 | 不变 |
| PR 5 | BoardRenderer + PortalOverlay | 不变 |
| 后续 PR | 新玩法或 portal v2 registry | 按新需求评审 |

每个 PR 应包含：

1. 明确的“本 PR 不改变哪些行为”；
2. 变更前会失败、变更后会通过的最小测试；
3. `node tests/run.js` 结果；
4. `git diff --check` 结果；
5. 涉及触摸/Canvas 时的微信开发者工具与真机验收状态；
6. 不相关文件零格式化、零重命名。

## 9. 发布和验证清单

自动化：

```sh
node tests/run.js
git diff --check
```

传送门专项必须持续覆盖：

- v1 显式启用与非法版本降级；
- 双向入口/出口；
- 大步采样停在入口；
- 错误出口回滚入口段；
- 出口段取消只回滚出口段；
- reset、undo、onHide 和切关不会遗留 pending；
- 分段提示正反向与等待态；
- 门格不叠加主题/提示/清除棋子；
- 试玩通关不写普通进度和广告计数；
- 5 个真实题面/解答逐段重放并全板覆盖。

设备验收：

- 微信开发者工具编译和预览；
- 至少一台 iOS 与一台 Android 真机；
- 系统打断产生的 `touchcancel`；
- 快速拖动、边缘释放、第二指干扰；
- 小屏、安全区、高 DPR 和图片加载失败；
- 等待出口提示是否足够明确。

## 10. 完成标准

阶段 1—6 已完成，当前实现达到：

- 新玩法试玩不再要求修改 App 的普通进度分支；
- 正式 portal 普通关可以写普通进度，试玩 portal 仍不写，二者只由 run source 区分；
- App、Hint 和 Renderer 不读取 Runner 可变内部数组；
- Portal schema 在 runtime、validator 和 publishing gate 中只有一个解释来源；
- Board 输入、Portal 提示和 Portal 绘制均可独立测试；
- `src/app.js` 与 `src/ui/canvas-renderer.js` 不再因每个玩法拓展成比例增长；
- 未引入框架、构建系统、任意脚本插件或无真实调用者的抽象。

这套边界既支持继续打磨传送门，也为第二种棋盘玩法留下清晰施工面，同时保留当前项目最重要的轻量、可直接导入和可回归验证特性。

## 11. 实际落地记录

| 阶段 | 已落地文件与契约 |
| --- | --- |
| 0 | `.github/workflows/test.yml` 固定 Node 版本并运行全量测试；`tests/architecture-boundaries.test.js` 锁定 core 依赖方向与运行时调用边界。 |
| 1 | `core/portal-schema.js` 成为 Runner、Validator 和发布校验共享的字段读取、规范化与索引来源；Validator 的公开 alias 和稳定错误码保持兼容。 |
| 2 | `src/gameplay/run-context.js` 与 `completion-policies.js` 分离来源、进度域和机制；App 不再使用负索引或 `currentSet/currentLevel` 双轨状态。 |
| 3 | `GameRunner` 提供结构化 GestureResult、完整 commit、只读 board/selection/mechanic/view 查询；旧 touch API 保持布尔兼容。 |
| 4 | `BoardInputController` 接管棋盘 pointer、逐格采样和 Portal 锁定早停；`InteractionMap` 接管命中与棋盘定位，App 只消费输入事件。 |
| 5 | `HintService` 缩为兼容门面；普通与 Portal provider 只消费纯 HintContext；`core/portal-solution.js` 承担分段解规范化、反转和展平。 |
| 6 | App 构建纯棋盘 ViewModel；普通与每日场景共用 `BoardRenderer`，Portal 图标、锁定/等待态和资源回退由 `PortalOverlay` 最后绘制。 |
| 7 | 未实施。当前仍只有 Portal v1，没有第二种真实棋盘机制、Portal v2 或远程 allowlist 需求。 |

自动化继续以 `node tests/run.js` 和 `git diff --check` 为本地完成门槛。微信开发者工具编译/预览、iOS 与 Android 真机触摸、安全区、高 DPR 和图片加载失败仍属于发布前人工验收，不能由 Node 测试替代。
