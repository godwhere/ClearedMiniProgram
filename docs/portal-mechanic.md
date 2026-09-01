# 传送门玩法设计与实现边界

> 设计记录：2026-09-01  
> 需求状态：v1 试玩契约已冻结并实现。
> 实现状态：规则机、双向分段提示、触摸取消、Canvas 渲染、5 个试玩关与发布校验已接入；微信开发者工具及真机仍需发布前验收。
> 运行时：微信小游戏单 Canvas 链路 `game.js → src/bootstrap.js → src/app.js → core/game-runner.js / src/ui/canvas-renderer.js`

## 1. 目的与核心判断

传送门把当前“从同色端点连续拖到另一端点”的局部连线，扩展成“入口段 → 松手 → 出口段”的跨区域连线。它改变的是棋盘的拓扑关系，而不是主题、清除特效或普通障碍物的视觉表现。

本功能第一版的目标是制作少量可解释、可验证的试用关卡，确认以下问题：

- 玩家能否在第一次看到传送门时理解“到门后必须松手”；
- 玩家能否正确找到配对出口并从出口继续；
- 错误选择后是否能快速重新连接，而不会认为关卡已经失败；
- 传送门是否能产生有价值的路线规划，而不是单纯缩短路径；
- 现有普通关卡、提示、撤销、计时和通关结算是否完全不回归。

### 1.1 v1 已冻结的规则

| 项目 | v1 规则 | 说明 |
| --- | --- | --- |
| 配对 | 传送门固定成对、双向 | 从 A 可到 B，从 B 可到 A；A/B 只是本次使用的入口/出口称呼 |
| 触发 | 滑动进入入口格后立即锁定 | 不自动跨屏，不允许同一次手势继续移动 |
| 释放 | 必须松开手指 | 松手后保留入口段，进入等待出口状态 |
| 正确续接 | 下一次按下配对出口后继续同一条线路 | 出口后允许向任意四方向移动 |
| 错误选择 | 按下的不是配对出口时，取消入口段的临时保留路径 | 不扣分、不扣步、不增加失败次数；本次按下不启动新线路，玩家抬手后可重新连接 |
| 入口段 | 从本线路起点到入口格的路径 | 错误出口选择时整体回滚；已完成的其他线路不受影响 |
| 门格占用 | 两个门格计入覆盖，并归当前线路占用 | 其他线路不能重叠使用 |
| 使用次数 | 试用关卡每条线路最多使用一组传送门一次 | 防止 A↔B 循环；未来链式规则需另行升级版本 |
| 端点 | 传送门只能作为中途节点 | 传送门不得与 `Lines[].Start/End` 重叠 |
| 目的端可用性 | 进入入口前预检配对出口 | 出口被阻挡、被其他线路占用或不合法时，不进入锁定态，玩家可改道 |
| 计时 | 沿用现有计时，继续运行 | 错误选择没有额外惩罚，但等待本身不暂停计时 |
| 多指 | 只接受第一个有效 pointer | 其他 pointer 不改变规则状态 |
| 每日挑战 | v1 不启用传送门每日题 | 先在普通试用关卡验证规则和提示；每日题需单独扩展校验契约 |

### 1.2 明确不属于 v1 的内容

- 任意门网络或“从多个出口任选其一”；
- 单向门、移动门、定时门、一次性门和门状态切换；
- 传送门作为线路起点或终点；
- 同一组门在一条线路中重复进入；
- 多人、双指同时画两条线路或跨 pointer 合并；
- 通过传送门直接完成线路，跳过普通终点校验；
- 将 A→B 绘制成穿过棋盘的长直线；
- 把传送门规则混入主题、清除特效、广告或进度结算；
- 在试用验证前加入每日挑战、排行榜或远程关卡。

## 2. 术语与棋盘模型

### 2.1 术语

- **传送门对（portal pair）**：一个唯一 `Id` 对应的两个棋盘格。
- **入口门 A（entry）**：当前线路本次滑动首先到达的门格。
- **出口门 B（exit）**：A 的配对门格，玩家松手后必须从这里重新按下。
- **A 段（entry segment）**：当前线路起点到 A 的连续相邻格路径。它在等待 B 时是“临时保留路径”，尚未作为完整线路提交。
- **B 段（continuation segment）**：从 B 开始、通过普通相邻移动走向终点或下一扇门的路径。
- **传送跳跃（teleport edge）**：A 与 B 之间的规则连接。它不是普通相邻关系，也不占用 A、B 之间的任何中间格。
- **入口前快照（pre-portal snapshot）**：进入当前线路或当前 A 段前的可恢复状态。错误选择或取消时使用它回滚 A 段。
- **等待出口（awaiting exit）**：玩家已松手，系统正在等待从配对门 B 开始下一次滑动的状态。

### 2.2 棋盘拓扑

普通段仍使用现有四方向相邻规则：

```text
普通移动：上 / 下 / 左 / 右，且只能进入可用格
传送移动：A ⇄ B，仅由成对传送门产生
```

规则层可以把传送门理解为一条特殊边，但路径数据必须保留“连续段”和“跳跃边”的区别：

```text
[起点, …, A] --(释放/从 B 重新按下)--> [B, …, 终点]
```

不得把 `[A, B]` 当作普通路径相邻项，否则会造成以下错误：

- 规则层误判 A→B 为非法或错误占格；
- Canvas 把 A、B 直接画成穿过棋盘的直线；
- 提示服务生成玩家无法一笔完成的假路径；
- `filledCount()` 和解答覆盖检查把不存在的中间格算作已覆盖。

## 3. 玩家完整流程

### 3.1 进入关卡

1. 关卡模型带有 `Mechanic: 'portal'` 和合法的 `Portals` 数组。
2. 画布在普通棋盘格上绘制传送门图标；图标源为 [`assets/icons/portal.png`](../assets/icons/portal.png)。
3. 传送门图标为 512×512、RGBA、透明背景的静态资源。第一版不在图片文件内烘焙配对编号；编号、配对色环或高亮由渲染层叠加。
4. 玩家可以从普通同色端点开始；传送门不是可起笔的端点。

### 3.2 普通起笔与移动

1. 玩家在未完成的同色端点按下。
2. 系统捕获该 pointer，进入 `DRAWING`。
3. 玩家沿四方向拖动；路径格必须相邻、可走、未被其他线路占用，且不能穿过其他端点。
4. 回拖到当前线路自己的旧格，沿用现有规则截短当前临时路径。
5. 进入传送门前，规则层检查配对出口 B 是否可用：
   - B 被 `Blocked` 占用：不可进入 A；
   - B 被其他线路占用：不可进入 A；
   - B 是其他线路端点：不可进入 A；
   - B 已被当前线路使用过：不可进入 A；
   - 其他数据不合法：不可进入 A。
6. 预检失败时，当前线路停留在最后一个合法格；玩家可改道，不产生失败记录。

### 3.3 滑到入口 A

1. 采样到 A 的那一格时，将 A 追加到当前路径。
2. 立即进入 `PORTAL_LOCKED`：
   - 当前路径终点固定为 A；
   - 同一 pointer 后续的 `move` 全部忽略；
   - 不自动把路径移动到 B；
   - 不允许继续向 A 周围移动或拖回；
   - 播放传送门到达反馈（音效、轻震动或短脉冲）。
3. 若一次触摸移动跨越多个格，`traceBoard()` 必须逐格采样，在首次遇到 A 后立即停止本次插值，不能越过 A。
4. 如果玩家手指仍按住，画面保持 A 的锁定状态；这不是等待 B 的第二次按下。

### 3.4 在 A 松手

1. 只要已进入 `PORTAL_LOCKED`，`pointerup` 就被视为在 A 结束本次手势。
2. 松手坐标即使稍微离开棋盘或不再落在 A，也不能按普通非法释放处理；入口锁定优先级更高。
3. 入口段 `[起点, …, A]` 暂时保留，进入 `PORTAL_WAIT`。
4. `portalPending` 记录：
   - `lineIndex`；
   - `pairId`；
   - `entry`（A）；
   - `exit`（B）；
   - A 段的连续 `cells`；
   - 进入 A 前的恢复快照。
5. B 门显示明显的脉冲、高亮或箭头提示，文案使用“从另一端继续”或“从配对门继续”。
6. 进入等待状态不提交完整线路、不压入普通 `undoStack`，也不触发通关、清除动画或完成结算。
7. 等待状态没有自动超时。玩家可以思考后再从 B 重新按下；重置、返回、系统取消等显式中断按第 6 节处理。

### 3.5 从正确出口 B 继续

1. 玩家在 `PORTAL_WAIT` 中再次按下。
2. 只有按下位置落在当前 `exit` B 的吸附/触摸范围内，才进入 `PORTAL_CONTINUE`。
3. 正确按下 B 后：
   - 恢复同一 `lineIndex`；
   - 把 B 作为传送跳跃后的首个路径格；
   - 保留 A 段和 A→B 的跳跃元数据；
   - 不要求延续进入 A 时的方向；
   - 重新捕获新的 pointer，后续移动由四方向相邻规则约束。
4. 如果按下 B 后立即抬手、没有走出第一个有效相邻格：
   - 不提交线路；
   - 保留 A 段；
   - 回到 `PORTAL_WAIT`，允许再次从 B 按下。
5. 从 B 走出有效相邻格后进入普通 `DRAWING`；直到目标端点松手，整条线路才可能提交。

### 3.6 按错位置：取消 A 段并重新连接

这是 v1 的明确产品规则：**错误选择不是惩罚，而是取消当前 A 段，让玩家重新连接。**

1. 在 `PORTAL_WAIT` 中，玩家下一次按下的位置不是 B（包括普通格、其他传送门、端点、阻挡格或棋盘外）。
2. 系统立即恢复“进入 A 之前”的快照：
   - 清除从线路起点到 A 的临时保留路径；
   - 清除 `portalPending`、门占用和当前传送上下文；
   - 不影响其他已经提交的线路；
   - 不写入新的撤销记录；
   - 不扣步数、不增加失败次数。
3. 这次错误按下只用于取消 A 段，不同时启动新线路；玩家抬手后，下一次按下才可以从普通端点重新连接。
4. 可以播放一次轻量错误提示，但不得使用会让玩家误以为整关失败的重错误表现。
5. 回滚后状态回到 `READY`。玩家需要重新从该线路的普通端点起笔。

### 3.7 从 B 继续后的失败移动

为了避免玩家已经正确找到 B 后还要从头重画，v1 采用局部恢复：

- `PORTAL_CONTINUE` 中尚未走出 B 的首个有效相邻格就松手：保留 A 段，回到 `PORTAL_WAIT`；
- 已从 B 走出一段，但尚未到终点且本次触摸被取消或非法结束：只清除本次 B 段临时路径，保留 A 段，回到 `PORTAL_WAIT`；
- 如果玩家明确按下“重置”或离开关卡，则按整关/整次手势规则清除 pending，见第 6 节。

这类恢复同样不扣步、不增加失败次数、不修改其他线路。

### 3.8 到达终点与通关

1. 从 B 继续后，玩家必须沿合法相邻格到达该线路的普通目标端点。
2. 只有在目标端点松手且整条线路合法时，才提交完整线路。
3. 提交时一次性记录：连续段、传送跳跃、门格占用和撤销快照。
4. `isBoardComplete()` 只有在以下条件同时满足时才返回真：
   - 所有线路均已提交；
   - 没有 `portalPending`、`PORTAL_LOCKED` 或 `PORTAL_CONTINUE`；
   - 所有非 `Blocked` 格（包括传送门两端）均被合法线路覆盖。
5. 通关后的结果页、清除动画、普通进度和每日结算继续沿用现有流程；传送门不改变结算时机。

## 4. 状态机契约

### 4.1 状态名称

状态名是规则层和应用层之间的概念契约，具体实现可以使用字符串常量或等价枚举，但不得让 UI 自己猜测状态。

| 状态 | 含义 | 必须保持的不变量 |
| --- | --- | --- |
| `READY` | 没有活动手势或等待中的传送 | `selectedLine === -1`，`portalPending === null`，没有活动 pointer |
| `DRAWING` | 普通四方向连线 | 只有一个有效 pointer；当前段每相邻一步都合法 |
| `PORTAL_LOCKED` | 手指仍按住，刚进入 A | 当前路径最后一格是 A；后续 move 不再改变路径 |
| `PORTAL_WAIT` | 已松手，等待从 B 重新按下 | A 段和恢复快照保留；只接受配对 B |
| `PORTAL_CONTINUE` | 已从 B 按下，但尚未走出第一格 | 当前线路和传送跳跃上下文保留；无有效移动时抬手回 `PORTAL_WAIT` |
| `SOLVED` | 当前线路/棋盘已完成 | 禁止新手势；结果和结算由应用层处理 |

### 4.2 状态转移图

```text
READY
  └─ 按普通端点 ───────────────→ DRAWING
       ├─ 普通合法移动 ─────────→ DRAWING
       ├─ 进入可用门 A ──────────→ PORTAL_LOCKED
       └─ 松手/取消 ─────────────→ READY（沿用旧规则）

PORTAL_LOCKED
  ├─ 任意 move ────────────────→ PORTAL_LOCKED（忽略）
  └─ 松手 ────────────────────→ PORTAL_WAIT

PORTAL_WAIT
  ├─ 按配对门 B ───────────────→ PORTAL_CONTINUE
  └─ 按其他位置 ───────────────→ READY（回滚 A 段）

PORTAL_CONTINUE
  ├─ 第一个有效相邻格 ─────────→ DRAWING
  ├─ 未移动就松手 ─────────────→ PORTAL_WAIT
  └─ B 段非法/取消 ─────────────→ PORTAL_WAIT（清 B 段，保留 A 段）

DRAWING
  ├─ 到普通目标端点并松手 ──────→ READY 或 SOLVED
  └─ 再次进入其他可用门 ───────→ PORTAL_LOCKED（未来扩展；v1 关卡限制一组门）
```

### 4.3 事件矩阵

| 当前状态 | 事件 | 合法条件 | 结果 | 是否写 Undo |
| --- | --- | --- | --- | --- |
| `READY` | `touchStart(i)` | `i` 是未完成线路普通端点 | 进入 `DRAWING` | 否 |
| `DRAWING` | `touchMove(i)` | 四方向相邻且可用 | 追加当前段 | 否 |
| `DRAWING` | `touchMove(A)` | A 可用且 B 预检通过 | 追加 A，进入 `PORTAL_LOCKED` | 否 |
| `DRAWING` | `touchMove(A)` | B 不可用 | 保持最后合法格 | 否 |
| `PORTAL_LOCKED` | `touchMove(*)` | 任意 | 忽略 | 否 |
| `PORTAL_LOCKED` | `touchEnd(*)` | 任意释放坐标 | 进入 `PORTAL_WAIT` | 否 |
| `PORTAL_WAIT` | `touchStart(B)` | 正确配对、B 可用 | 进入 `PORTAL_CONTINUE` | 否 |
| `PORTAL_WAIT` | `touchStart(!B)` | 任意错误位置 | 回滚 A 段，进入 `READY` | 否 |
| `PORTAL_CONTINUE` | `touchMove(i)` | 首个/后续四方向合法格 | 进入/保持 `DRAWING` | 否 |
| `PORTAL_CONTINUE` | `touchEnd(B)` | 没有有效移动 | 回到 `PORTAL_WAIT` | 否 |
| `DRAWING` | `touchEnd(target)` | 到达同色目标端点 | 提交整条线路；可能 `SOLVED` | 是，一次 |
| 任意 | `reset` | — | 清空棋盘与 pending | 清空 |
| 任意 | `undo` | 有 pending | 回到入口前快照 | 不新增 |

## 5. 失败、取消与生命周期

### 5.1 普通触摸取消

- `DRAWING` 在入口前收到 `pointercancel`：回滚本次普通手势到起笔前快照，沿用现有 `abortSelection()` 语义。
- `PORTAL_LOCKED` 收到系统取消：按“已经到达 A 并松手”处理，进入 `PORTAL_WAIT`，以便玩家重新从 B 连接；不会让晚到的 pointer 事件继续修改路径。
- `PORTAL_CONTINUE` 收到系统取消：清除 B 之后尚未提交的临时段，保留 A 段，回到 `PORTAL_WAIT`。

### 5.2 重置、撤销、返回与切关

**重置**

- 清除所有线路、门占用、`portalPending`、当前 pointer、错误提示和撤销栈；
- 使旧 pointer token 失效，晚到事件全部忽略；
- 计时重新开始，状态回到 `READY`。

**撤销**

- 在 `PORTAL_LOCKED`、`PORTAL_WAIT` 或 `PORTAL_CONTINUE` 中点击撤销：恢复进入本条线路前的快照，清除 A/B 临时段和 pending；
- 该操作不新增撤销记录；
- 在没有 pending 时，沿用现有“撤销上一条已提交线路”的行为；
- 一条完整传送线路（包含 A 段、跳跃和 B 段）只压入一个快照，撤销是原子操作。

**返回/切关**

- 离开棋盘、返回关卡列表或切换关卡时，丢弃临时手势和 pending，只保留已提交线路/存档；
- 不允许把 pending 传送状态带到另一关；
- 若导航按钮在触摸期间被命中，先结束 pointer，再执行导航，不能留下悬挂 `selectedLine`。

**切后台/回前台**

- `onHide()` 清除 pointer、pressed UI 和晚到事件 token，并暂停计时和音频；
- `DRAWING` 在入口前回滚当前手势；
- `PORTAL_LOCKED`、`PORTAL_WAIT`、`PORTAL_CONTINUE` 的临时状态统一回滚到进入 A 前快照，清除 pending，避免进程恢复后出现幽灵等待态；
- `onShow()` 只恢复计时/渲染，不恢复旧 pointer；玩家回到关卡后从普通端点重新连接；
- v1 不把 pending 传送状态写入本地存档。若进程被杀，恢复最近稳定的已提交状态。

### 5.3 反馈原则

错误出口不是失败惩罚。反馈只用于说明状态变化：

- 正确到达 A：传送门脉冲、轻音效/震动；
- 等待 B：B 门高亮、配对标记、短文案；
- 按错位置：轻量提示“请从配对门重新连接”，随后回滚 A 段；
- 不播放长失败动画，不弹出失败结果页，不扣资源。

## 6. 关卡数据契约

### 6.1 规范字段

普通 `Games[]` 关卡和未来允许传送门的每日 `Levels[]` 使用同一形状。字段沿用当前数据的 PascalCase 风格：

```js
{
  Id: 'portal-demo-01',
  Name: '传送门·入门',
  Mechanic: 'portal',
  PortalRulesVersion: 1,
  Width: 6,
  Height: 6,
  Palette: ['#ff1d23', '#0A71c7'],
  Lines: [
    { Start: 0, End: 35 },
    { Start: 5, End: 30 }
  ],
  Portals: [
    { Id: 'P1', A: 7, B: 28 }
  ]
}
```

约定：

- `Mechanic: 'portal'` 是显式规则选择；`Portals` 存在但未声明机制属于数据错误；
- `PortalRulesVersion: 1` 为 v1 必填契约；缺失、非 1 或未来版本不会启用 v1 运行时规则；
- `Portals[].Id` 在关卡内唯一、非空、稳定；
- `A`、`B` 是行优先索引：`index = row * Width + col`；
- A/B 双向，不在数据中写方向、脚本或函数；
- 图标路径不写入每个关卡，统一由渲染资源映射到 `assets/icons/portal.png`；
- v1 试用关卡最多一个传送门对；若未来允许多对，必须升级规则版本或显式扩展契约。

### 6.2 与现有字段的关系

| 字段 | 关系 | 约束 |
| --- | --- | --- |
| `Width` / `Height` | 决定索引范围和棋盘布局 | 不改变现有棋盘几何 |
| `Lines` | 仍是唯一线路端点来源 | 端点不得与传送门重叠 |
| `Blocked` | 仍表示不可走/不覆盖格 | 不得与任一传送门格重叠 |
| `Portals` | 新增特殊边和门格 | 不放入 `Blocked`，不改 `Lines` |
| `Palette` | 仍由主题/关卡颜色提供 | 不用于决定配对规则 |
| `Mechanic` | 选择 portal runner 语义 | 缺省或非 portal 时保持旧规则 |

### 6.3 数据校验

`core/portal-validation.js` 是题面与分段解答的纯函数发布校验模块。校验包含：

- `Portals` 必须是数组；
- 每个 portal 必须是对象；
- `Id` 必须是非空字符串且不重复；
- `A`、`B` 必须是整数、在棋盘范围内且不相等；
- 所有 portal 格全局唯一；
- `Blocked` 必须为整数数组，值在棋盘范围内且不重复；非法值不得减少解答覆盖数；
- portal 格不得与 `Blocked` 重叠；
- portal 格不得与任何线路端点重叠；
- v1 传送门对数量不得超过一个；
- `Mechanic: 'portal'` 时至少有一对门；
- 普通关卡没有 `Portals` 时必须通过旧校验，不能被强制转成 portal 关卡；
- 试用关卡必须有至少一个合法解；
- 解答中的每一次跳跃必须匹配真实 portal 对，且每对门只使用一次。

稳定错误码包含：

```text
portal-mechanic-invalid
portals-required-array
portal-not-object
portal-id-required
portal-id-duplicate
portal-cell-integer
portal-cell-out-of-range
portal-cell-duplicate
portal-endpoint-conflict
portal-blocked-conflict
portal-blocked-required-array
portal-blocked-integer
portal-blocked-out-of-range
portal-blocked-duplicate
portal-pair-count-exceeded
portal-solution-required
solution-portal-transition-required
solution-portal-pair-invalid
solution-portal-reuse
solution-segment-non-adjacent
solution-portal-order
```

坏数据不能静默当成普通关卡发布。运行时 runner 可以对外部坏数据采取宽容的“忽略非法门”策略以避免崩溃，但正式目录/每日服务必须在加载前拒绝并报告错误。

## 7. 解答与提示契约

### 7.1 为什么不能继续使用单一 cell 数组

当前普通关卡的 `data/solutions.js` 和 `HintService` 使用 `[start, ..., end]` 的连续 cell 数组。该格式无法表达非相邻的 A→B，也无法表达“必须松手并重新按下”。传送门关卡不能把 A、B 直接塞进同一条普通数组。

### 7.2 portal 解答格式

`data/portal-solutions.js` 按段保存每条线路：

```js
{
  ByLevelId: {
    'portal-demo-01': [
      {
        Segments: [
          {
            Cells: [0, 1, 7],
            Exit: { PairId: 'P1', From: 7, To: 28 }
          },
          {
            Cells: [28, 29, 35]
          }
        ]
      },
      {
        Segments: [
          { Cells: [5, 11, 17, 23, 29, 30] }
        ]
      }
    ]
  }
}
```

规范：

- 外层数组顺序与 `Lines` 顺序一致；
- 第一段从对应 `Start` 开始；最后一段以对应 `End` 结束；
- 每个 `Cells` 内部必须逐格四方向相邻；
- `Exit.From` 必须等于上一段最后一格；`Exit.To` 必须等于下一段第一格；
- `Exit.PairId` 必须存在于 `Portals`；
- 每个 pair 在同一条线路中最多出现一次；
- 所有线路合并后必须覆盖 `total - blocked.size` 个可覆盖格；
- A→B 的跳跃不产生中间 cell，不参与普通相邻校验；
- 传送门提示必须带 `requiresRelease: true` 或等价的 data-only 标记，以便 UI 显示“松手后继续”。

### 7.3 HintService 边界

- 无 `Portals` 的普通关卡继续返回旧格式 `{ lineIndex, path, source }`，不改变任何旧调用；
- portal 关卡返回 `{ lineIndex, segments, teleports, source }`，必要时同时提供兼容性的 `path`，但旧 renderer 不得直接消费含跳跃的扁平数组；
- 存储解答优先，运行时 BFS 只能把 portal pair 当作一条特殊边；
- BFS 输出必须重新分段，不能返回 `[A, B]` 作为普通相邻路径；
- 当前处于 `PORTAL_WAIT` 时，提示只显示配对 B 和 B 之后的剩余段；
- A/B 不携带固定方向；等待态按本次 `entry/exit` 与起笔端点选择存储解的正向或反向；
- 进入门格后必须使用传送边，BFS 不得从入口继续走普通相邻边；
- 玩家的入口段与存储解不同时，剩余提示不得穿过已保留的入口格；
- 如果没有 portal-aware 解法，返回 `null` 或明确的“该关暂无提示”，不能返回一条不可操作的直线；
- HintService 不修改 runner，不写进度，不播放音效。

## 8. 代码边界

以下是已实现的模块边界。模块可以增加内部辅助函数，但不得把其他模块的职责搬进来。

### 8.1 `core/game-runner.js`：唯一规则权威

**负责：**

- 读取并规范化 `level.Portals`；
- 建立只读 `portalByCell`、`portalPairs` 查询；
- 判断 A/B 是否可用、是否已被当前线路使用；
- 管理 `READY / DRAWING / PORTAL_LOCKED / PORTAL_WAIT / PORTAL_CONTINUE / SOLVED` 的规则状态；
- 维护当前线路的连续段、传送跳跃元数据、入口前快照和门使用记录；
- 在 `touchStart/touchMove/touchEnd` 中执行所有合法性判断；
- 处理 `snapshot/restore/undo/reset/abortSelection/cancelSelection` 的 portal 状态；
- 让两个 portal 格参与 `owner`、`filledCount()`、`isBoardComplete()`。

**不得负责：**

- 不访问 `wx`、Canvas、图片、音效、震动或页面路由；
- 不读取主题、清除特效、每日次数或进度存储；
- 不决定中文提示文案；
- 不把 A→B 当作 `adjacent()` 的普通邻接；
- 不直接绘制路径；
- 不自行调用 HintService 或求解器。

**已接入的只读查询/状态接口：**

```js
portalAt(index) -> { id, entry: index, exit } | null
portalExit(index) -> number | -1
isPortalCell(index) -> boolean
portalStatus() -> null | {
  phase, lineIndex, pairId, entry, exit,
  entryCells, usedPairIds
}
cancelPortalContinuation() -> boolean
handlePointerCancel() -> boolean
```

接口名称可调整，但应用层必须能获得上述语义，不得读取 runner 私有数组后自行推断规则。

**兼容约束：**

- `Portals` 缺省或空数组时，现有 122 关的 `touchStart/touchMove/touchEnd`、`owner`、撤销、计时和完成判定保持旧语义；
- `selectedCells` 的连续段 API 尽量保持可用。非相邻跳跃应通过平行的 `selectedSegments` / `portalJumps` 元数据表达，不把旧数组改成对象；
- `touchEnd()` 的布尔返回值继续只表示“整条线路已成功提交”，到达 A 或进入等待态不能返回完成；
- pending 状态不得写进已完成线路快照，取消时通过入口前快照恢复。

### 8.2 `src/app.js`：输入与场景编排

**负责修改的入口：**

- `onPointerStart()`：区分普通起笔、正确 B 起笔和错误等待态按下；保存 pointer id；错误按下触发 runner 的回滚接口，但不启动新线；
- `onPointerMove()` / `traceBoard()`：继续负责坐标插值和逐格转发；一旦 runner 报告进入 `PORTAL_LOCKED`，立即停止本次插值；
- `onPointerEnd()`：把释放交给 runner；对 `PORTAL_WAIT` 不播放普通线路失败音效、不触发完成结算；
- `onPointerCancel()`：根据 runner 状态执行普通手势回滚、portal pending 回滚或 B 段局部回滚；
- `onHide()` / `onShow()`：清除旧 pointer token、暂停/恢复计时和音频，按第 5 节清理临时状态；
- `performAction('play:reset'/'play:undo'/'daily:reset'/'daily:undo')`：调用 runner 的统一 portal 清理/撤销接口；
- `buildModel()`：向 renderer 提供 data-only 的 `portals`、`portalState`、`portalInstruction`、分段路径和 `expectedExit`；
- `openLevel()` 与每日 runner 构造：把关卡的 `Mechanic`/`Portals` 传给 runner，但不在 app 中重复做门合法性判断。
- 首页可见 action 为 `home:portalTrial`；旧 `corridor:portalTrial` 只作为不可见的兼容别名，回廊不注册传送门卡片或 hit。
- 试玩结果页显示“试玩完成 / 试玩不记录最佳”，返回 action 回首页，不宣称已写入普通选关进度。

**不得负责：**

- 不根据坐标自行判断 A/B 配对、占用或循环；
- 不直接改 `owner`、`selectedCells`、`completedPaths`；
- 不把等待态转换成普通 UI 点击；
- 不在 `traceBoard()` 中模拟传送或拼接 A→B；
- 不在 app 中实现 BFS、解答校验或 Canvas 绘制；
- 不把 portal 逻辑复制成普通关卡和每日关卡两套分支；两者共用同一 runner 协议。

### 8.3 `src/ui/canvas-renderer.js`：只读视觉表现

**负责：**

- 在 `drawPlay()` 和 `drawDaily()` 使用同一个 portal 绘制适配器；
- 加载并缓存 `assets/icons/portal.png`；
- 按棋盘 cell 几何绘制传送门图标、配对标记、环形高亮和等待脉冲；
- 绘制 A 段、B 段和普通线路；传送跳跃只绘制断开的提示线、弧线、箭头或配对光效；
- 门格只绘制空格底板、传送门、编号与状态光圈；主题棋子、提示棋子和清除棋子均不叠加在门格；线路清除期间空格底板和门图标保留到动画结束；
- 普通 play 与 daily 使用同一阻挡格视觉语义，`Blocked` 不得绘成可走空格；
- 在 `PORTAL_WAIT` 高亮 `expectedExit` 并显示提示文案；
- 对资源加载失败提供纯色/矢量回退，不阻塞关卡输入；
- 保持 `cellAt()`、`boardLayout` 和现有安全区布局语义。

**不得负责：**

- 不调用 `touchStart/touchMove/touchEnd`；
- 不修改 runner、owner、pending 或进度；
- 不自行推断哪扇门是配对出口；
- 不注册独立的 portal UI hit；传送门仍是棋盘格，由 app/runner 处理触摸；
- 不把两个非相邻门格交给普通 `drawPath()` 画成一条直线；
- 不从图片文件名或像素颜色推断规则。

**资源契约：**

```text
资源：assets/icons/portal.png
格式：PNG / RGBA / 512×512 / 透明背景
用途：棋盘传送门主体图标
配对信息：由 model.portalState 或 portal descriptor 提供
禁止：运行时修改原图、把配对编号永久烘焙进共享图标
```

### 8.4 `src/services/hint-service.js`：提示与求解适配

**负责：**

- 识别普通解答与 portal 分段解答；
- 以四邻接 + portal edge 构造搜索图；
- 校验路径段、跳跃顺序、占用冲突和 pending 出口；
- 向 app 返回只读提示对象。

**不得负责：**

- 不修改 runner 状态；
- 不决定玩家按错后的回滚；
- 不绘制提示；
- 不兼容性地把 portal 关卡降级成普通 BFS。

### 8.5 `core/portal-validation.js` 与 `src/services/daily-challenge-service.js`

**纯校验模块 `core/portal-validation.js`：**

- 只接收普通 JS 数据并返回 `{ ok, errors }`；
- 不访问平台、存储、Canvas 或 runner；
- 校验 portal 字段、端点/阻挡冲突、规则版本和解答段；
- 可被普通 catalog 检查、试用关卡脚本和每日服务复用。

**每日服务：**

- v1 继续拒绝或不加载带 `Mechanic: 'portal'` 的每日题，直到 portal 解答和每日存档契约完成；
- 未来启用时，只调用共享纯校验，不在服务中复制 runner 规则；
- `Blocked` 与 `Portals` 的冲突必须在解析阶段报告；
- 不改变每日次数、奖励、结算和普通进度边界。

### 8.6 数据、进度、音频与其他模块

| 模块 | v1 边界 |
| --- | --- |
| `src/mechanics/portal.js` | 声明玩法 ID、v1 版本、图标、首页试玩 action、试玩 set 与分段解答；不注册进主题/特效回廊 |
| `data/catalog-v2.js` | 只保留 122 个普通关；传送门试玩不占用普通 set/level 索引 |
| `data/portal-solutions.js` | 保存 portal 分段解答；不污染 `data/solutions.js` 的旧数组格式 |
| `src/services/progress-store.js` | 传送门试玩不写普通完成、最佳时间、`lastPlayed` 或 `totalClears`；结果只在当次会话展示 |
| `src/services/audio-service.js` | 只提供/播放已有或新增的 portal 音效；不判断规则 |
| `src/services/clear-effect-service.js` | 不读取 portal；线路完成后的清除特效仍由 app 快照决定 |
| `src/skins/*` | 可提供图标尺寸、颜色 token 或回退色；不决定配对和状态 |
| `src/bootstrap.js` | 只负责注入 portal 玩法定义及其解答依赖；不承载 portal 状态 |
| `pages/*`、根目录旧小程序页面 | 不作为实现入口，继续保持排除状态 |

## 9. 试玩关卡

第一批已实现 5 个关卡，固定一对双向中性传送门。

| ID | 设计目标 | 关卡要求 | 观察点 |
| --- | --- | --- | --- |
| `portal-demo-01` | 教学“到门—松手—从另一端继续” | 单线路、开阔棋盘、一对门 | 首次理解率、是否继续拖动 |
| `portal-demo-02` | 传送门改变最短路线 | 两条线路、一对门 | 是否能读懂配对关系 |
| `portal-demo-03` | 出口占位 | 两条线路，B 靠近另一线路 | 是否先完成正确顺序 |
| `portal-demo-04` | 错误出口回滚 | 让其他门/普通格容易误按，但仍可快速重连 | 按错后是否理解“重新连接” |
| `portal-demo-05` | 覆盖全板 | 门格必须参与覆盖，含少量 `Blocked` | 是否理解门格不是装饰 |

试用关卡暂不加入每日挑战，不使用移动门、单向门或多对串联。每关必须离线验证至少一个解，并记录人工可读的分段解答。

## 10. 测试与验收契约

### 10.1 规则层

`tests/game-runner-portal.test.js` 覆盖：

- 没有 `Portals` 的旧关卡全部保持旧行为；
- 从端点滑到 A，A 后继续 move 被忽略；
- 在 A 松手（包括释放坐标在棋盘外）进入等待；
- 从正确 B 按下后继续到终点并成功提交；
- 等待态按错位置会回滚 A 段，不写 Undo，不启动新线；
- 按正确 B 但不移动就松手，可再次等待/重连；
- B 被 `Blocked`、他线、他端点占用时不能进入 A；
- A/B 双向进入均可用；
- 同一 pair 重复使用被拒绝；
- 两个门格计入 `filledCount()` 和 `isBoardComplete()`；
- `undo/reset/abort/cancel` 清理 pending、门占用和快照；
- 跨行相邻判断不会把边界两格误判为相邻；
- 多指和过期 pointer 不改变状态。

### 10.2 输入编排层

`tests/app-portal.test.js` 覆盖：

- `start endpoint → move → end portal → start paired exit → move → end target` 完整 pointer 序列；
- 大步移动在 A 处截断，不越过 A；
- 等待态按错后 A 段消失，下一次可从普通端点重新开始；
- `touchcancel` 在入口锁定时进入等待，在出口段中只回滚出口段；
- 普通、daily（未来启用）使用同一 portal runner 流程；
- `onHide/onShow` 不恢复旧 pointer，不留下幽灵 pending；
- reset/back/切关不把 pending 带到下一关；
- 完成后仍进入原有 result/dailyResult 结算路径。
- 试玩结果不写入普通关卡完成、最佳时间、`lastPlayed` 和广告计数；
- 传送线路清除动画快照包含入口段和出口段。

### 10.3 数据、提示与渲染层

- `tests/portal-validation.test.js`：字段类型、规则版本、ID/格重复、越界 Blocked、端点/阻挡冲突、pair 数量和稳定错误码；
- `tests/hint-service-portal.test.js`：正反向分段解答、强制 portal edge BFS、入口段避让、pending 剩余段与无解返回 null；
- `tests/renderer-portal.test.js`：图标加载/回退、配对高亮、等待文案、门格不叠加主题/提示棋子、普通 play 阻挡格与无门回归；
- `tests/portal-publishing.test.js`：5 个真实试玩题面/解答校验、逐段 `GameRunner` 重放和全板覆盖；
- `node tests/run.js` 在接入代码后必须全量通过，现有 122 关数据测试不得新增回归。

### 10.4 真机验收指标

首批试用关卡重点记录：

- 第一次到达 A 后，玩家松手并成功从 B 续接的比例；
- 按错出口后，玩家重新从普通端点起笔的比例；
- 因“不能继续拖动”而退出关卡的比例；
- 每关平均重试次数和完成时间；
- 等待 B 时的误触位置分布；
- 低分辨率屏幕上图标、配对标记和触摸吸附范围是否清晰。

## 11. 实现状态

- 已完成：题面/解答校验、双向规则状态机、撤销/取消/生命周期契约。
- 已完成：正反向存储解、强制传送边 BFS、分段提示与完整路径清除动画。
- 已完成：独立玩法拓展定义、首页试玩入口、普通进度隔离、门格专属渲染与 Blocked 视觉。
- 已完成：5 关真实数据发布校验和 `GameRunner` 逐段重放。
- 待发布前执行：微信开发者工具编译/预览、安全区与真机触摸验收。

## 12. 兼容与发布门槛

只有以下条件全部满足，才允许把传送门关卡加入正式可见入口：

1. 无 `Portals` 的旧关卡行为、提示、渲染和结算零回归；
2. 传送门数据和每一条分段解答通过离线校验；
3. A→松手→B 的真实触摸流程在微信真机通过；
4. 错误按下会回滚 A 段，且不会扣分、扣步或启动新线路；
5. 重置、撤销、切后台、返回和切关不留下 pending 状态；
6. 等待态不会让渲染循环无限忙等；
7. 传送门图标加载失败时仍可完成关卡；
8. 文案、配对标记和触摸吸附范围经过至少一轮可用性测试；
9. README 的玩法说明和本文的“实现状态”同步更新。
