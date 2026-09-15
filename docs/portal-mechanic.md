# 传送门玩法设计与实现边界

> 2026-09-07 内容更新：主线 137 题，其中 26 个 Portal。8×8 新增 6 个简单双门并重新编排，规则和提示状态机不变。
> 历史章节编号不再等于显示位置；见 [难度系统](level-difficulty-system.md) 和 [当前目录](level-difficulty-catalog.md)。冰块不加入主线。

> 设计记录：2026-09-01
> 当前规则：Portal v2；Portal v1 仅保留兼容读取与回放。
> 实现状态：主线 Portal、统一两句提示、触摸取消和发布校验已接入；独立试玩已删除，微信开发者工具及真机仍需发布前验收。
> 运行时：微信小游戏单 Canvas 链路 `game.js → src/bootstrap.js → src/app.js → core/game-runner.js / src/ui/canvas-renderer.js`

Portal 只通过普通主线选关进入。原独立试玩的 5 个题面、对应解答、隐藏 action、
专用运行上下文与结算分支已删除；主线关卡 ID、进度和 Portal v1/v2 规则兼容不变。

## 1. 目的与当前规则

传送门把“从同色端点连续拖到另一端点”的局部连线扩展成“入口段 → 松手 → 出口段”的跨区域连线。它改变棋盘拓扑，不属于主题、清除特效、广告或进度结算。

Portal v2 的目标是让传送门保持中性、无需编号：同一关只声明一个传送网络，玩家进入其中一扇门后，可以从任意另一扇当前可用的门继续。

本文定义运行时规则；8×8 题面的颜色数、门数、旁路难度和内容验收另见
[`portal-level-design-guide.md`](portal-level-design-guide.md)。

| 项目 | Portal v2 规则 |
| --- | --- |
| 网络 | 每关恰好一个中性网络，包含至少两个门格 |
| 触发 | 滑动进入入口格后立即锁定，同一次手势不能继续移动 |
| 释放 | 必须松开手指，入口段暂时保留 |
| 出口 | 下一次可从网络内任意另一扇当前可用的门继续 |
| 错误选择 | 按下原入口、普通格或不可用门时回滚入口段；不扣分、不扣步 |
| 使用次数 | 每条线路最多使用该网络一次，防止循环或链式跳跃 |
| 门格占用 | 实际选择的入口和出口归当前线路占用；未选择的门保持未占用 |
| 必填覆盖 | v2 的传送门格不是必填覆盖格；所有非 `Blocked`、非传送门格仍必须覆盖 |
| 端点 | 传送门只能作为中途节点，不得与线路端点重叠 |
| 计时 | 等待出口期间继续计时 |
| 多指 | 只接受第一个有效 pointer |
| 每日挑战 | 当前仍不启用 Portal 每日题 |

以下能力不属于 v2：多个彼此独立的网络、同一线路多次传送、单向门、移动门、定时门、一次性门、远程脚本和传送门端点。这些能力必须使用新的规则版本。

### 1.1 Portal v1 兼容边界

Portal v1 的 `{ Id, A, B }` 固定门对、`PairId` 解答和“两个门格均参与覆盖”继续可读、可校验、可回放。主线 Portal 使用 v2；不得把旧 v1 数据静默解释成 v2 网络，也不得让未知版本改变普通四方向移动。

## 2. 术语与棋盘模型

- **传送网络（portal network）**：一个稳定内部 `Id` 和至少两个 `Cells`。`Id` 只用于数据、解答和回放，不显示给玩家。
- **入口门（entry）**：当前线路本次滑动首先到达的门格。
- **候选出口（eligible exits）**：同一网络内除入口外，当前未阻挡、未被其他线路占用且合法的门格。
- **选定出口（selected exit）**：玩家松手后实际重新按下的候选出口。
- **入口段（entry segment）**：线路起点到入口门的连续四邻接路径。
- **出口段（continuation segment）**：从选定出口开始、继续走向普通终点的连续路径。
- **传送跳跃（teleport edge）**：入口与选定出口之间的非相邻规则连接。
- **入口前快照（pre-portal snapshot）**：错误选择、撤销或生命周期取消时用于恢复的稳定状态。

```text
普通移动：上 / 下 / 左 / 右，且只能进入可用格
传送移动：entry --(松手/重新按下)--> 任一 eligible exit
路径数据：[起点, …, entry] + teleport edge + [selected exit, …, 终点]
```

不得把入口和出口塞进同一个普通相邻数组，也不得绘制跨越棋盘的长直线。

## 3. 玩家流程与反馈

### 3.1 进入与普通拖动

1. 关卡必须显式声明 `Mechanic: 'portal'`、已支持的 `PortalRulesVersion` 和合法 `Portals`。
2. 门格只绘制 [`assets/icons/portal.png`](../assets/icons/portal.png) 或安全矢量回退，不叠加主题棋子。图片以格子中心绘制，在原有绘制尺寸上放大 25% 以补偿素材透明边距；选中呼吸缩放继续叠加，矢量回退尺寸不变。
3. 棋盘不显示 `P1` 或任何内部网络编号；当前单网络无需配对标签。
4. 初始 `READY` 与进门前 `DRAWING` 统一显示“路径会通过传送门抵达另一个传送门”；不再读取逐关 `Instructions`。到达入口后切换第二句，出口续接后隐藏。
5. 玩家只能从普通同色端点起笔；门格不是起笔端点。

### 3.2 到达入口：`PORTAL_LOCKED`

1. 路径首次进入一个拥有至少一个候选出口的门格时，将该格追加到当前段并立即锁定。
2. 同一 pointer 的后续 move 被忽略；大步采样必须在首次遇到门格时停止，不能越过入口。
3. 棋盘正上方改为“到达传送门后松手，再从另一扇门继续”，使用轻微呼吸效果。
4. 入口门主体围绕格子中心轻微放大，并显示青色半透明底光和加粗选中轮廓；其他门保持原尺寸，且不触发轻震动。
5. 提示区域在 Portal 关整个生命周期固定预留，提示出现时棋盘不得跳位。

### 3.3 松手等待出口：`PORTAL_WAIT`

1. `pointerup` 优先结束锁定手势，即使释放坐标稍微离开棋盘。
2. 入口段暂时保留，进入 `PORTAL_WAIT`。
3. `portalPending` 保存线路、网络 ID、入口、候选出口、入口段、已用网络和恢复快照。
4. 继续显示到门时的第二句，不再切换第三种文案；位置与呼吸效果不变。
5. 所有候选出口同时高亮；内部网络 ID 不参与视觉标记。
6. 等待状态不提交线路、不写普通 Undo、不触发清除、结算或震动，也没有自动超时。

### 3.4 从任一候选出口继续：`PORTAL_CONTINUE`

1. 玩家按下任一候选出口后，系统恢复同一线路，并把该门作为出口段首格。
2. 提交的跳跃记录稳定的 `portalId/from/to`，而不是在渲染层推断。
3. 提示和候选出口光圈立即消失。
4. 若尚未走出出口就松手，保留入口段并回到 `PORTAL_WAIT`。
5. 若出口段收到非法结束或系统取消，只回滚出口段，保留入口段并回到等待态。
6. 从出口走出首个合法相邻格后恢复普通 `DRAWING`，到普通目标端点松手才提交整条线路。

### 3.5 错误选择与完成反馈

- 在 `PORTAL_WAIT` 按下原入口、普通格或不可用门，会恢复入口前快照并回到 `READY`；本次按下不顺带启动新线路。
- 错误选择不是失败，不扣资源，不使用重失败表现。
- Portal 到达、松手和重新起笔均不触发震动。
- 关卡提示语仅在游玩时绘制；进入成功或失败结算即隐藏（含面板出现前的等待阶段），保留提示带布局，避免文字透过结算面板或引起棋盘跳位。
- 只有完整线路提交并开始消除时保留现有震动：普通完成使用轻反馈，最终结果沿用现有强度。

### 3.6 通关

`isBoardComplete()` 只有在以下条件同时满足时才返回真：

- 所有线路均已提交；
- 不存在 `PORTAL_LOCKED / PORTAL_WAIT / PORTAL_CONTINUE` 或 pending；
- 所有非 `Blocked`、非传送门格均被合法线路覆盖。

实际使用的入口和出口仍写入路径及 owner；未使用的门允许保持 `owner === -1`，且不计入 v2 的 `remainingCellCount()`。正式提示解整体必须至少包含一次传送，以验证并展示 Portal 流程；题面可以存在经过内容审查的高成本无门解，不新增 `portal-unused` 终局，也不把“是否使用 Portal”作为胜负条件。

## 4. 状态机与生命周期

```text
READY
  └─ 普通端点按下 ─────────────→ DRAWING
       ├─ 普通合法移动 ─────────→ DRAWING
       ├─ 进入有候选出口的门 ───→ PORTAL_LOCKED
       └─ 普通取消 ─────────────→ READY

PORTAL_LOCKED
  ├─ move ────────────────────→ PORTAL_LOCKED（忽略）
  └─ 松手/锁定态 touchcancel ──→ PORTAL_WAIT

PORTAL_WAIT
  ├─ 按任一 eligible exit ─────→ PORTAL_CONTINUE
  └─ 按其他位置 ───────────────→ READY（回滚入口段）

PORTAL_CONTINUE
  ├─ 首个合法相邻格 ───────────→ DRAWING
  ├─ 未移动就松手 ─────────────→ PORTAL_WAIT
  └─ 非法结束/touchcancel ─────→ PORTAL_WAIT（清出口段）

DRAWING
  └─ 普通目标端点松手 ─────────→ READY、SOLVED 或 failed
```

撤销、重置、返回、切关和切后台必须清理 pointer、pending、候选出口和临时门占用。pending 不写入本地存档；重新进入关卡只恢复稳定的已提交状态。完整传送线路只压入一个 Undo 快照。

## 5. 关卡数据契约

### 5.1 Portal v2

```js
{
  Id: 'portal-main-5x5-01',
  Mechanic: 'portal',
  PortalRulesVersion: 2,
  Width: 5,
  Height: 5,
  Lines: [{ Start: 0, End: 24 }],
  Portals: [
    { Id: 'P1', Cells: [21, 2] }
  ]
}
```

约定：

- 当前 v2 必须恰好声明一个网络，`Cells` 至少两个；
- `Id` 非空且稳定，但不显示给玩家；
- `Cells` 使用行优先索引，必须为不重复、范围内的整数；
- 门格不得与 `Blocked` 或任何线路端点重叠；
- `Cells` 不携带方向、回调或脚本；从任一入口可选择任一其他合法出口；
- 图标由机制 manifest 统一映射，不写入每个关卡；
- 当前机制 manifest 的 `rulesVersion` 为 2，并显式声明 `supportedRulesVersions: [1, 2]`；不再携带试玩内容依赖。

### 5.2 Portal v1 兼容形状

```js
{
  Mechanic: 'portal',
  PortalRulesVersion: 1,
  Portals: [{ Id: 'P1', A: 7, B: 28 }]
}
```

v1 只允许一个固定双向门对，解答可继续使用 `PairId`，且两个门格仍属于必填覆盖。v1 数据不会被迁移器在运行时自动改写。

### 5.3 发布校验

`core/portal-validation.js` 必须拒绝：非法机制或版本、空/多网络、少于两个门格、重复 ID/格、非整数或越界格、端点/Blocked 冲突、无解、伪造跳跃、同线多次传送和必填格不完整。

运行时可以对未校验外部数据安全降级，正式目录和发布测试必须严格失败。普通关卡没有 `Portals` 时保持原行为。

## 6. 解答与提示契约

### 6.1 v2 分段解答

```js
{
  ByLevelId: {
    'portal-main-5x5-01': [{
      Segments: [
        {
          Cells: [0, 1, 6, 5, 10, 11, 16, 15, 20, 21],
          Exit: { PortalId: 'P1', From: 21, To: 2 }
        },
        { Cells: [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24] }
      ]
    }]
  }
}
```

规范：

- 每个 `Cells` 内部逐格四方向相邻；
- `Exit.From` 等于上一段最后一格，`Exit.To` 等于下一段第一格；
- `Exit.PortalId` 指向真实网络，From/To 均属于其 `Cells` 且不相等；
- 每条线路最多一次 Exit；整个 Portal 题解至少一次 Exit；
- v2 完整性只要求所有非 Blocked、非 Portal 格覆盖，未使用门可不出现在解答中；
- v1 的 `PairId` 继续兼容读取，但新 v2 内容必须发布 `PortalId`。

### 6.2 HintService

- 普通关仍返回旧 `{ lineIndex, path, source }`；Portal 返回分段 `segments/teleports`；
- 混合章节的普通题优先按稳定 `levelId` 查找 `solutions.ByLevelId`，再兼容旧坐标表；ID 前缀不参与机制判断；
- 完整预览入口返回所有线路，只读取按 level ID 发布的预设分段解；任一路线缺失或非法时整包失败，
  不用逐线搜索拼出完整答案。每条结果统一为 `Line.Start → Line.End`，并保留 `segments/teleports`；
- 存储解优先，运行时搜索把每个候选出口作为一条传送分支；
- 进入门格后必须通过传送边，不能从入口继续普通相邻移动；
- `PORTAL_WAIT` 只提示可执行的候选出口和剩余段；
- 提示不得将非相邻门格画成直线，不得修改 Runner、进度、音频或震动；
- 完整预览在只读初始棋盘 ViewModel 上绘制：入口段箭头指向入口门，出口段从出口门向外，
  两门之间不绘制普通连续实线，Portal overlay 始终最后绘制；
- 预览持续 10 秒并可再次点击立即关闭；期间计时继续，但棋盘输入、重置和回撤禁用，
  真实 Runner 的已完成线路、selection、Portal pending 和撤销状态保持不变；
- 无可执行 Portal 解时返回 `null`，不能降级成错误的普通路径。

## 7. 代码边界

### 7.1 规则与版本

- `src/mechanics/index.js`：注册 data-only gameplay extension definition，并由 bootstrap 按稳定 ID 注入。
- `core/mechanics/index.js`：按 `mechanic@rulesVersion` 解析 allowlist；未知组合不得启用规则。
- `core/mechanics/portal-v1.js`：保留固定门对和门格必填覆盖策略。
- `core/mechanics/portal-v2.js`：声明单网络、门格非必填覆盖、每线一次传送。
- `core/portal-schema.js`：统一读取、规范化和建立索引，不负责中文提示。
- `core/game-runner.js`：唯一玩法状态权威，管理候选出口、快照、占用、完成和撤销；不依赖 wx、Canvas、主题或存档。
- `core/portal-validation.js`：纯题面/解答发布校验，不访问平台或运行时状态。

### 7.2 App 与输入

- `src/gameplay/board-input-controller.js` 只把 pointer 翻译为结构化 gesture，不重新判断候选出口。
- `src/app.js` 只消费事件、构建纯 ViewModel、播放完成反馈并编排结算；不读取 Runner 私有数组。
- 到达、松手和出口起笔不震动；`onPathCompleted()` 继续负责完整线路消除震动。
- 主线 Portal 与普通题使用相同的 catalog 进度和结算；不存在独立试玩结算分支。

### 7.3 渲染

- `BoardRenderer` 固定按“棋盘格 → 清除动画 → 路径提示 → Portal overlay”绘制；
- `PortalOverlay` 只绘门图、资源回退、LOCKED 入口放大/选中高亮和状态光圈，不绘 `P1` 或其他内部 ID；
- 已参与当前路径的门格在格内绘制对应路径颜色的细框，入口与实际选中的出口同色，保留门图；颜色与棋盘共用 palette。候选出口仍为黄色提示，LOCKED 青色外圈保留。边框消费 ViewModel 的 selected/selection 和清除期间的 owner，不缓存归属；撤销、取消同步恢复，清除结束时与门图一起消失，无特效时立即消失。
- `src/ui/portal-instructions.js` 是两句提示的唯一来源；App、初始答案预览与 Renderer 兼容路径均复用它。READY/进门前使用第一句，LOCKED/WAIT 使用第二句，CONTINUE/出口后的 DRAWING 隐藏；
- 全部主线游玩标题统一显示“当前关卡 / 总关卡”（如 `27 / 137`）；不显示名称或 `Instructions`，计时保持独立；
- 选关页只显示连续关卡数字，不在 Portal 关卡数字格上叠加机制徽标；
- 提示使用轻微呼吸效果，出现和切换时不得改变棋盘布局；
- Renderer 只消费纯 ViewModel，不自行推断规则或注册独立 Portal hit；
- 图片加载失败必须保留可操作的矢量回退。

## 8. 主线入口与测试内容

当前 20 个 Portal 题由 4 个里程碑教学题和 16 个高阶混合章节题组成，全部通过主线选关进入。
独立试玩内容已退役，旧隐藏入口不再执行。测试直接使用主线题面；Blocked、三门网络和
v1 兼容继续由不进入小游戏包的测试 fixture 验证，不能为测试恢复生产试玩入口。

## 9. 测试与验收

- `tests/portal-validation.test.js`：v1/v2 字段、版本、网络数量、格冲突、PortalId、每线一次与 required coverage；
- `tests/game-runner-portal.test.js`：任意候选出口、不可用出口过滤、v1 兼容、回滚、撤销、取消和完成；
- `tests/game-runner-contract.test.js`：结构化结果与只读候选出口数组；
- `tests/board-input-controller.test.js`：逐格采样、锁定早停、pointer 隔离和取消；
- `tests/hint-service-portal.test.js`：分段解、多出口搜索、等待态和无解；
- `tests/app-portal.test.js`：两句提示切换、无 Portal 阶段震动、主线结算与导航、旧试玩入口不再执行；
- `tests/renderer-portal.test.js`：提示位置/呼吸、棋盘不跳位、纯数字标题、选关页不叠加 Portal 徽标、LOCKED 入口居中放大/选中高亮、无 P1、多出口高亮和资源回退；
- `tests/portal-publishing.test.js`：26 个主线 Portal 题、无逐关说明与残留试玩解、历史 63–67 内容质量门槛、高成本无门解、三门未用门 fixture、v1 兼容 fixture 和逐段回放；
- `tests/mixed-chapter.test.js`：68–97 的 19 普通/11 Portal 混排、6–9 色、双门、无凑数短线、完整提示、对称去重、无门分类与一/二色廉价旁路排除；93–97 另检查反向/变序回放、逐格完整提示与追加解锁衔接；
- `tests/level-copilot-*.test.js`：开发期版本 15 的连续 seed Schema、长 seed 安全切分、有界尾段重连与 `P1` 编译、Portal 感知对称查重、共享校验、逐段 Runner 回放、必需／高成本可选分类、廉价旁路与搜索不确定失败关闭、2—5 级评分和独立评测集；该工具不进入小游戏包，也不改变本节运行时协议；
- `node tests/run.js` 必须全量通过，现有普通关行为不得回归。
- `Portals` 缺省或空数组时，现有无 Portal 普通关卡必须保持原有规则、输入、计时、撤销与完成判定语义；新增普通 Portal 关卡使用独立的 v2 分段解答。

微信开发者工具和真机仍须检查：安全区、窄屏文案、提示出现时机、棋盘稳定、入口门放大后不遮挡相邻格、选中高亮可辨识、快速滑动、touchcancel、候选出口命中、图片回退、到门无震动、完成消除仍震动，以及等待态退出后不持续无意义重绘。

## 10. 发布门槛

1. 连续编号 1—137 的普通主线关（含 26 个 Portal 题）和 Portal v1 兼容 fixture 零回归；新增六个简单双门受 `level-difficulty.test.js` 的禁门、提示和正反/变序回放约束；
2. Portal v2 题面、PortalId 解答和 required coverage 全部通过离线校验；
3. 真实触摸完成“入口 → 松手 → 任一候选出口 → 普通终点”；
4. 全部主线 Portal 复用两句提示；进门前为第一句，LOCKED/WAIT 为第二句，出口续接后隐藏，棋盘不跳位；
5. 棋盘不显示 P1，LOCKED 入口放大和选中高亮清楚，候选出口光圈仍清楚；
6. Portal 阶段不震动，完整线路消除震动保留；
7. 错误选择、撤销、重置、后台和切关不留下 pending；
8. 未使用 v2 门不阻止通关，已使用入口/出口仍正确记录 owner 和跳跃；
9. 图片失败不阻断输入；当前选中路径上的所有门图标持续居中呼吸（包括 WAIT、CONTINUE 和出口后的 DRAWING），图片与矢量回退共用缩放。候选出口不参与此缩放。取消或完成选中路径后停止选中呼吸；重绘复用已有 selection 驱动，不增加计时器。LOCKED 的青色高亮与路径色框规则不变；
10. README、架构文档和实现状态同步更新。
