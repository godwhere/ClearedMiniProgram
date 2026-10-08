# 回廊与消除特效系统设计与实现边界

> 设计记录：2026-08-31  
> 最近更新：2026-10-08（适配 `BoardRenderer` 架构并新增 `none`）
>
> 需求状态：已确认（按分阶段契约实施）  
> 实现状态：回廊包含主题、特效、音乐三个入口；`none` 默认可用，`fade` 在主线第 10 关（`2:2`）完成后永久解锁；音乐页默认勾选《格间微光》，《漫步》10000 金币永久解锁。自动回归、开发者工具编译与音乐购买云端部署／回读已完成；新客户端上传、真机购买及视觉／音频验收待完成。

2026-10-08 新增 `starburst`、`bubbles`、`petals`、`shatter` 四种 Canvas 消除特效，各 10000 金币永久解锁。客户端默认同时消除，账号页可选依次消除并逐格同音；CloudBase 的特效购买与消除方式同步已部署，三个函数 Active、完整代码与原配置回读一致。客户端 118 组、后端 110 项及三个实际候选各 26 项通过；账号设置的窄屏／横屏离线 Canvas 检查通过。21:10 微信开发者工具最终普通编译后主页加载、控制台 0 错误。新客户端上传、微信内特效视觉／触控及真机购买／音频验收仍待完成。
>
> 运行时：微信小游戏单 Canvas 链路 `game.js → src/bootstrap.js → src/app.js → src/ui/canvas-renderer.js → src/ui/board/board-renderer.js`

## 1. 需求复述与现有基线

本需求包含三个相互关联、但需要分阶段交付的部分：

1. 为连接成功后的消除过程增加可选择的、轻量的视觉特效。
2. 在主页提供“回廊”功能入口。进入后显示与主题画廊相同的 **2 列 × 3 行** 网格，当前依次放“主题”“特效”“音乐”。
3. “特效选择”页面沿用主题页的布局与交互，内置无特效、逐渐消失、星光迸散、泡泡轻弹、花瓣飘落、冰晶碎裂六种选择。位图预览只用于画廊；新增四种使用同一形状绘制器的静态姿态作矢量预览。

当前工程的相关基线如下：

| 能力 | 当前实现 | 本需求的处理 |
| --- | --- | --- |
| 首页 | `CanvasRenderer.drawHome()` 绘制 `home:dailyChallenge`、`home:corridor`、`home:start`（直接 App 构造默认仍可关闭迁移） | 运行时复用原主题按钮位置显示回廊；不增加第四枚按钮，`home:themes` 仅作兼容 action |
| 主题画廊 | `scene === 'themes'`，固定 2×3、空槽、左右滑动和 `theme:<id>` | 保持主题协议；回廊只是上游入口，不重命名主题 manifest |
| 当前清除表现 | `app.onPathCompleted()` 根据选择创建可空动画快照；`BoardRenderer.drawClearAnimation()` 负责约 300ms 的 alpha/scale 淡出 | 默认同时消除；`none` 不创建快照；两种方式都不改变规则 |
| 规则层 | `core/game-runner.js` 管理路径、占用、撤销和完成判定 | 不读取特效，不改变任何规则或结算时机 |
| 旧页面 | `pages/*` 和根目录旧小程序页面被 `project.config.json` 排除 | 不作为实现入口 |

两种选择都不是新的玩法或棋盘状态。`GameRunner` 在连接成功时仍立即更新 owner/path 并判定结果；消除方式和特效只负责随后 Canvas 绘制，不延后 owner/path 或存档提交。

## 2. 分阶段交付与明确范围

### 2.1 当前阶段：文档冻结

文档冻结阶段已完成；当前实现已按本文契约落地，首页入口迁移已在正式 `bootstrap` 配置启用，仍可由独立开关回退。以下内容继续作为后续实现依据：

- 回廊页面和特效页面的场景、布局、路由、存档和测试契约；
- 六种内置特效的声明式数据协议和渲染白名单；
- 首页从主题入口迁移到回廊入口时必须保持的兼容规则。

### 2.2 第一版实现顺序（历史记录）

第一版曾按下列顺序实施；当前 `none` 扩展在既有边界上增量完成：

1. 新增 `ClearEffectService`、`src/effects/index.js` 和 `fade` manifest；在 `src/bootstrap.js` 完成依赖注入；补充 `ProgressStore.state.settings.clearEffectId` 的默认/回退逻辑。
2. 将现有清除动画抽到 renderer 的特效适配点，普通关卡和每日挑战共用；先保证选择 `fade` 时视觉与现状一致。
3. 新增 `effects` 场景和特效 2×3 选择页，加入选择、持久化、预览懒加载和失败回退。
4. 新增 `corridor` 场景和 2×3 功能入口页；初始有效卡片只有“主题”和“特效”，其余四槽为空。首页迁移已在运行时启用，并复用原主题按钮矩形和布局。
5. 保留 `home:themes` 的兼容 action 和旧主题返回路由；不在首页并列增加第四枚按钮。

### 2.3 迁移后目标（当前运行时）

迁移完成后的目标导航是：

~~~text
主页
  └─ home:corridor → 回廊
       ├─ corridor:themes  → 主题画廊
       │    └─ theme:<id>  → 选择主题并返回主题画廊
       ├─ corridor:effects → 特效画廊
       │    └─ effect:<id> → 选择特效并留在特效画廊
       └─ corridor:music   → 音乐画廊
            └─ music:<id>  → 选择曲目并留在音乐画廊
~~~

迁移后 `home:themes` 不再注册为可见命中区域，但 `performAction('home:themes')` 仍保留兼容别名，避免旧自动化测试、外部调用或恢复中的 UI 消息突然失效。主题的 `theme:<id>`、主题 manifest 和 `settings.skinId` 不改名。

## 3. 用户流程与稳定命中 ID

### 3.1 场景

回廊相关场景：

- `scene === 'corridor'`：功能入口回廊；
- `scene === 'effects'`：消除特效选择页。
- `scene === 'music'`：背景音乐选择页。

已有 `scene === 'themes'` 保持不变。应用层维护 `galleryOrigin`（`home` 或 `corridor`），用于决定从主题页返回主页还是回廊；不能依靠全局共享的主题页索引推断来源。

### 3.2 Action 契约

| Action | 目标 | 可见/兼容说明 |
| --- | --- | --- |
| `home:corridor` | 进入 `corridor` | 当前运行时的唯一可见回廊入口，复用原主题按钮位置 |
| `home:themes` | 进入 `themes` | 当前运行时不注册 visible hit；`performAction` 兼容保留 |
| `corridor:home` | 回到主页 | 回廊左上角返回 |
| `corridor:themes` | 进入主题画廊 | 设置 `galleryOrigin = 'corridor'` |
| `corridor:effects` | 进入特效画廊 | 设置 `galleryOrigin = 'corridor'` |
| `corridor:music` | 进入音乐画廊 | 独立 `musicPageIndex`，保持原主题/特效顺序 |
| `music:corridor` | 从音乐页返回回廊 | 音乐页左上角返回 |
| `music:prev`、`music:next` | 音乐页分页 | 超过 6 首曲目时才显示分页箭头 |
| `music:<id>` | 选择曲目并留在当前页，锁定曲目打开解锁弹窗 | 拥有、下载成功且保存成功才切换，非法 ID/失败不改变当前选中曲目 |
| `corridor:sound` | 旧 action 兼容 | 当前不绘制按钮或注册命中区域；声音统一在账号页音量滑条控制 |
| `themes:corridor` | 从回廊来源的主题页返回回廊 | 新契约；仅在 `galleryOrigin === 'corridor'` 时绘制 |
| `themes:home` | 从旧主题入口返回主页 | 兼容旧流程和旧测试 |
| `themes:sound` | 旧 action 兼容 | 当前不绘制按钮或注册命中区域 |
| `themes:prev`、`themes:next` | 主题页分页 | 保持现有协议 |
| `effects:corridor` | 从特效页返回回廊 | 特效页左上角返回 |
| `effects:home` | 从旧/内部直达特效页返回主页 | 兼容别名，不作为回廊主流程的首选 |
| `effects:sound` | 旧 action 兼容 | 当前不绘制按钮或注册命中区域 |
| `effects:prev`、`effects:next` | 特效页分页 | 分页只有超过 6 个特效时才启用 prev/next |
| `effect:<id>` | 选择指定特效并留在当前页 | 选择失败不得改写存档 |

顶部返回按钮的命中 ID 必须和 `model.backAction` 一致，不能同一帧同时注册 `themes:home` 与 `themes:corridor` 两个重叠 hit。

回廊、主题页、特效页和音乐页左上角统一使用 48×48 顶部触控区，中心为 `safeTop + 36`，标题与其对齐；返回箭头和主页图形采用同一图标尺寸。保留安全区和卡片间距，旧直达主题流程仍沿用 `themes:home` 返回主页。完整尺寸见 [Canvas UI 标准](ui-standard.md)。

## 4. 回廊页面契约

### 4.1 网格

回廊使用与主题页相同的安全区和卡片视觉参数，但拥有独立的分页状态：

~~~js
const CORRIDOR_PAGE_SIZE = 6;
const CORRIDOR_COLUMNS = 2;
const CORRIDOR_ROWS = 3;

pageCount = Math.max(1, Math.ceil(entryCount / CORRIDOR_PAGE_SIZE));
pageIndex = clamp(pageIndex, 0, pageCount - 1);
slotIndex = pageIndex * CORRIDOR_PAGE_SIZE + row * CORRIDOR_COLUMNS + column;
~~~

当前有三个有效入口：

~~~js
[
  { id: 'themes',  name: '主题',  action: 'corridor:themes' },
  { id: 'effects', name: '特效', action: 'corridor:effects' },
  { id: 'music',   name: '音乐', action: 'corridor:music' }
]
~~~

剩余三个槽位保留为空，不显示伪造的锁定状态，也不注册命中区域。未来增加功能时按注册顺序追加，不改变已有 `id` 或槽位映射。

卡片预览首版只需使用轻量图标/矢量回退和名称，不要求额外 ImageGen 资产；回廊卡片不得直接读取主题或特效的棋盘运行时图片。

### 4.2 触摸与分页

- 横向位移 `abs(dx) > 52` 且 `abs(dx) > abs(dy) * 1.2` 才算翻页，规则与主题页一致。
- 向左进入下一页，向右进入上一页；首尾页不越界。
- 未达到阈值的手势按点击候选处理；垂直拖动不翻页。
- 回廊只有一页时，滑动无效果但不能误触空槽。
- `corridorPageIndex` 不得复用 `setIndex`、`themePageIndex` 或 `effectPageIndex`。
- 初版只有一页时不显示分页箭头；若未来入口超过 6 个，新增 `corridor:prev` / `corridor:next`，并沿用主题页的禁用和边界规则。

### 4.3 回廊模型

`ClearedApp.buildModel()` 在回廊场景至少提供：

~~~js
{
  scene: 'corridor',
  corridorEntries: [/* data-only descriptors */],
  corridorPageIndex: 0,
  corridorPageCount: 1,
  corridorPageSize: 6,
  backAction: 'corridor:home',
  soundEnabled: true,
  pressedId: null
}
~~~

renderer 只消费这些数据并注册 hit；入口目标和场景切换由 `src/app.js` 处理。

### 4.4 音乐分类与曲目选择

- 音乐页复用特效页的 2×3 卡片布局、选中描边与勾选标记；默认卡片和音乐入口使用 Canvas 双音符，《漫步》使用主包透明封面，失败回退音符。
- `src/config/audio.js` 的 `tracks` 是曲目顺序的唯一来源：`grid-glow`（《格间微光》）保留原音频和音量 `0.28`，`candy-day-stroll`（《漫步》）追加在后，同为音量 `0.28`。`bgm` 引用同一默认曲目，旧单曲配置仍兼容。
- `AudioService.listMusic()` 向 UI 返回曲目描述的副本（`id/name/src/volume` 和可选 `preview`）；`currentMusicId()` 提供选中 ID。新旧存档缺少 `settings.musicId`、非法 ID 或无永久拥有权时安全回退默认曲目。
- 曲目选择通过现有 `ProgressStore` 保存 `settings.musicId`，当前仅保存在本设备，不加入 CloudBase 偏好或备份的三字段合同；异步 App 宿主必须先可靠保存再切换，由现有存储边界按点击顺序串行保存。保存失败不得应用失败的选择，当前选中状态须与最后一次可靠保存的曲目一致。
- 声音入口位于账号页消除方式下方的 0–100% 音量滑条；音乐与音效共用主音量，0% 静音。`settings.soundVolume` 保存在本设备，不加入云偏好／备份；`soundEnabled` 的静音变化继续同步。拖动试听、松手原子保存，取消或保存失败恢复确认值，见 [音乐系统](music-system.md#账号页音量)。
- 选择当前曲目不重启播放；播放器失败后再次点击可重试。换曲释放旧 BGM，并使旧下载/播放回调失效。静音、后台、音频中断和首次交互门禁继续由 `AudioService` 管理，选曲不自动打开声音。
- 音乐开关仍只在主页显示。音乐页只选择曲目；`musicPageIndex` 与关卡、主题、特效、回廊分页独立，超过六首时支持箭头及横向滑动。
- 《漫步》复用共享奖励服务，10000 金币购买后才允许选择。应用通过 `ClearedApp.setMusic()` 先下载独立音乐包，再可靠保存并切换；下载失败保留旧曲，进度／失败状态显示在卡片上；关闭应用弹窗、快速改选、换账号或销毁后晚回调不能换曲。曲目、封面、音源许可和验收见 [音乐系统](music-system.md)。
- 自动回归覆盖默认勾选、双语曲名、点击/返回、独立分页及安全区、保存失败/快速改选/旧播放回调、静音与生命周期；离线使用生产 Renderer 检查 320×568（DPR 1）与 390×844（DPR 2）的矢量构图和中英文排版，不能代替真机音频听验。

## 5. 特效选择页契约

### 5.1 布局和选择

- 页面固定 2 列 × 3 行，每页 6 个槽位；卡片尺寸、间距、标题和顶部控制参考 `drawThemes()`。
- `effectPageIndex`、`effectPageCount`、`EFFECT_PAGE_SIZE` 独立于主题分页。
- 内置卡片按稳定顺序显示：`none → fade → starburst → bubbles → petals → shatter`，正好占满六槽。原两项 ID 和顺序不变。
- 点击有效卡片后立即写入 `settings.clearEffectId`、重绘并留在当前页；不自动进入棋盘、不重置当前关卡、不清除当前进度。
- 选择页可显示当前选中标记；未注册或加载失败的预览不应使卡片不可选。

### 5.2 特效页模型

~~~js
{
  scene: 'effects',
  effects: [
    { id: 'none', name: '无特效', type: 'none', preview: 'assets/effects/none/preview.png' },
    { id: 'fade', name: '逐渐消失', type: 'fade', preview: 'assets/effects/fade/preview.png' },
    { id: 'starburst', name: '星光迸散', type: 'starburst' },
    { id: 'bubbles', name: '泡泡轻弹', type: 'bubbles' },
    { id: 'petals', name: '花瓣飘落', type: 'petals' },
    { id: 'shatter', name: '冰晶碎裂', type: 'shatter' }
  ],
  effectPageIndex: 0,
  effectPageCount: 1,
  effectPageSize: 6,
  currentEffectId: 'none',
  backAction: 'effects:corridor',
  soundEnabled: true,
  pressedId: null
}
~~~

模型中的 `effects` 只含可序列化的画廊描述，不把平台图片对象、Canvas context、回调或 `GameRunner` 引用传入页面模型。

## 6. 消除特效运行时契约

### 默认同时消除与可选依次消除

账号页“游戏设置”卡片集中展示语言和消除方式；头像昵称、云存档状态归入独立的“用户资料与存档”卡片，隐私协议为底部独立入口。具体排布见 [Canvas UI 标准](ui-standard.md#账号页分区)。“消除方式”与语言共用左右选择器的排布，只有两侧箭头可点击，在 `sequential`（依次消除）和 `simultaneous`（同时消除）之间循环切换。原 `account:clearMode` action 保留调用兼容；箭头分别使用 `account:clearMode:prev` / `account:clearMode:next`，不注册整行命中区。全新、旧档缺字段和非法本地值均回退同时消除；已保存的合法选择继续保留；本地仍用既有 progress v2 key。已开始快照固定当前方式，改变设置只影响下一条路径。无特效同样服从隐藏顺序，不强制选择或解锁付费特效。

依次模式按 gesture 返回的路径顺序每隔 120ms 触发一格；Portal 固定节点排除，分段路径仍按从起点到终点的顺序衔接。每格保留原 manifest 的 80–500ms 尾部，总视觉时长为 `(格数 - 1) × 120ms + 单格时长`。当前发布棋盘最多 80 格，最长 9.98s；扩大棋盘时须同步调整 `clear-animation-timing.js` 上限及验收。破冰只消失冰层，地板保留。结算面板及每日热身转场等待最后一格和音效尾音结束，存档和规则判定仍在原完成边界执行。

逐格播放现有 `path-complete.m4a`，基础音量 0.52（乘账号页主音量）、片长约 354ms，不变调；音效池最多四路并允许尾音重叠。AudioService 使用现有 App tick 驱动，无新增后台计时器；迟到帧仅播最近应触发的一格，不集中补播。静音、暂停、后台、撤销、重置、换 Runner 或离开棋盘取消剩余触发；胜利／失败提示音在序列收尾后播放。沿用单条活动快照：新完成路径替换尚未结束的上一条，旧声音取消，不叠加无限序列。

`settings.clearMode` 通过既有 preferences 域、单字段操作、待办合并和幂等回执同步。请求明确发送 `includeClearMode:true` 才收到新字段；旧客户端继续收到原三字段快照，改声音或外观不覆盖云端消除方式。新客户端在既有 state.read 请求中将 preferences 已知 revision 设为 0，补取紧凑偏好，避免旧客户端曾同步相同 revision 却没有保存新增字段；其他域 revision 和本机同步元数据不变，不新增请求。云端旧文档缺字段只读视为同时消除，不批量重写玩家设置；非法枚举拒绝。

### 6.1 既有动画的抽象方式

普通关卡（含主线 Portal）与每日挑战都在 `ClearedApp.onPathCompleted()` 处理路径完成。应用层根据当前选择创建可空动画快照，不在各模式中复制完成流程；独立 Portal 试玩已删除。

连接完成时，应用层创建一次性的动画快照：

~~~js
const effect = clearEffects.current();
const animation = effect.type === 'none' && clearMode === 'simultaneous' ? null : {
  clearMode,
  lineIndex,
  cells: cells.slice(),
  startedAt: now,
  effectId: effect.id,
  durationMs: effect.durationMs,
  params: deepClone(effect.params)
};
~~~

约束：

- `cells` 必须复制，后续撤销或新路径不能改变已开始的动画；
- 同时消除的 `none` 用 `clearAnimation === null` 表达；依次消除的 `none` 保留路径时序快照，单格时长为 0，未轮到的格子仍完整显示，不绘制粒子；
- `effectId`、`durationMs`、`params` 必须在开始时快照化；`params` 至少要做深拷贝（或冻结只读副本），不能持有注册表对象的可变引用。动画播放中切换特效不会改变当前动画，新完成的路径才使用新选择；
- 普通 `play/result` 和每日 `daily/dailyResult` 使用同一个清除适配器；
- 特效层不修改 `GameRunner` 的 owner、selectedCells、撤销栈或 outcome；规则层独立判断
  `playing/won/failed`，未填满失败面板在 `max(animation ? animation.durationMs : 0, resultDelayMs)` 后出现，
  不得提前遮挡最后一条清除动画；
- `play:reset`、`play:undo`、`daily:reset`、`daily:undo` 清除尚未完成的动画快照；
- `app.isAnimating()` 对非空快照使用单格时长加依次触发间隔的总时长，避免无特效空转，也避免切换选择后提前停止旧动画。

时长来源按以下优先级解析，所有结果都经过数值校验和上限限制：

~~~text
animation.durationMs（已快照）
  > 当前 effect manifest.durationMs
  > legacy skin.animation.pathClearMs
  > 300ms
~~~

该优先级只适用于真实动画。`skin.animation.pathClearMs` 继续作为旧主题/旧调用的兼容回退；`none` 的单格时长为 0，依次模式仍计算路径触发间隔。

### 6.2 `none` 无特效定义

~~~js
{
  id: 'none',
  name: '无特效',
  type: 'none',
  preview: 'assets/effects/none/preview.png',
  durationMs: 0,
  params: {}
}
~~~

`none` 不产生淡出或粒子：同时模式没有动画快照并立即隐藏；依次模式只保留路径时序，逐格直接隐藏。路径提交、owner 更新、结果判定、震动和结算照常发生。结果页仍遵守独立的 `skin.animation.resultDelayMs`，不能把“无特效”解释为取消所有场景转场。

#### 独立消除画面抖动

每次完整线路提交（普通、每日、试玩及最终消除）由 App 生成独立的 `clearFeedback`，不依赖 `clearAnimation`，也不改变原有手机马达振动强度。Renderer 只消费起始时间和 180ms 时长，让游玩／结果画面进行三次逐渐衰减的水平轻抖；幅度按屏宽计算，最大 3 个逻辑像素，与 DPR 无关。最终消除后即使棋盘已空，标题等画面内容仍会给出反馈。背景始终按完整原始视口清理，纵向安全区、布局和触控坐标不变。

快速连续消除只重启一次反馈，不叠加；重置、成功回撤、退后台清除反馈，不带入其他 Runner 或非游玩场景。Portal 到达／等待／出口起笔不触发。App 保持反馈期间重绘，并在结束后绘制原位帧；选择 `none` 不产生淡出或粒子，隐藏顺序仍服从消除方式；同时模式只保留独立反馈。

验收：Node 覆盖触发、原位收尾、无特效、最终消除、Portal 等待不抖和三种屏宽下的有界位移；微信开发者工具与手机预览仍需检查实际观感，尤其 iPhone 15 Pro 的普通及最后一次消除。开发者工具对振动接口的表现不能代替 Canvas 画面反馈的真机验证。

### 6.3 `fade` 视觉定义

`fade` 的目标是保持当前轻量观感：每个已连接路径格独立绘制，透明度从 1 降到 0，并允许极轻微地从 1 放大到 1.14；不增加粒子、光晕或逐帧贴图。

推荐 manifest 参数如下（数值可在视觉验收时微调，但不能突破资源和性能边界）：

~~~js
{
  id: 'fade',
  name: '逐渐消失',
  type: 'fade',
  preview: 'assets/effects/fade/preview.png',
  durationMs: 300,
  params: {
    alphaFrom: 1,
    alphaTo: 0,
    scaleFrom: 1,
    scaleTo: 1.14,
    staggerRatio: 0.018
  }
}
~~~

实现必须对白名单字段做数值校验：`none` 固定为 `durationMs: 0` / 空参数；真实动画的 `durationMs` 限制在 80–500ms，`alpha` 限制在 0–1，`scale` 为正数，`staggerRatio` 限制在 0–0.1。非法动画值回退到 `fade` 默认值，不得让 Canvas 收到 `NaN` 或无穷值。

### 6.4 渲染器分发边界

`BoardRenderer.drawClearAnimation()` 是棋盘清除视觉出口；`CanvasRenderer` 只保留场景/画廊门面和兼容代理。Renderer 按 `type` 白名单分发：

~~~text
type === 'none'  → 同时模式不绘制；依次模式完整显示等待格，轮到后直接隐藏
type === 'fade'  → 逐格 alpha/scale 算法
starburst / bubbles / petals / shatter → 缩小淡出与解析形状
未知 type        → 经典 fade 回退
~~~

renderer 不执行 manifest 中的函数、脚本、字符串表达式或网络内容。新增四种只使用解析轨迹与 Canvas 基础路径，不引入持续粒子状态、物理模拟、shader、offscreen canvas、逐帧 sprite sheet、协程或动态下载。

每个路径格的绘制应为 O(1)，只复用当前主循环和 `drawTile()`；每格最多四个形状及其绘制用渐变，不建立粒子对象数组或额外模拟状态，不在渲染循环中加载图片。效果时长结束后必须由 `tick()` 触发一次最终重绘，确保残留透明层从 Canvas 移除。

### 6.5 四种新增效果

| 稳定 ID | 名称 | 时长 | 表现 |
| --- | --- | --- | --- |
| `starburst` | 星光迸散 | 420ms | 金色、粉色、青色与淡紫四角星带暖白高光向四周散开 |
| `bubbles` | 泡泡轻弹 | 460ms | 粉、青、紫、绿、黄的柔和彩虹泡泡带白色反光上浮 |
| `petals` | 花瓣飘落 | 500ms | 粉紫渐变花瓣旋转散开并下落 |
| `shatter` | 冰晶碎裂 | 380ms | 冰蓝、浅蓝与青色菱形碎晶带白色亮边旋转迸散 |

`src/ui/board/clear-particles.js` 只绘制形状，由 BoardRenderer 和画廊共同调用；manifest 沿用已校验的 alpha、scale、stagger 五个参数。缩小的原方块保留本次连线的主题色，粒子使用上表各自的固定配色；格索引决定颜色轮换，同一条线也有多种颜色。每个形状最多一个三色标线性渐变，渐变接口不可用时保留多色实色回退；使用 `source-over` 保留明亮背景上的色相，绘制后恢复 Canvas 状态。坐标、尺寸和散开距离均取当前棋盘格；每格最多四个形状，泡泡为三个，位置由格索引与时间确定，不使用随机数或新计时器。新效果的整条路径错峰窗口最多占 24%，即使 8×10 长路径也在快照时长内完成。Portal 格始终排除；仍保留一层冰的格继续只画破冰覆盖层，不让地板误消失。

本批没有位图运行时资源，保持原 12 个普通分包。后续若升级为带贴图的光效或序列帧，应沿用主题／音乐的 `SubpackageService`：资源置于独立普通分包，选择应用时按需加载、绘制循环只用已缓存图片、失败回退本批解析形状，卡片不提前下载运行时资源。引入资源时需同步 manifest 资源校验、`game.json`、分包配置与包体专题，不用本批的形状数量上限替代贴图预算。

首版验证：客户端 117 组、后端 85 项单元及 22 项集成／并发通过；catalog 对齐为 300 关／18 项奖励，预览资源校验、包体脚本和两仓 `git diff --check` 通过。使用生产 Renderer 离线查看四种效果的多个进度帧，并检查可交互预览的五个播放选择、320／760px 布局与脚本错误。微信开发者工具执行普通编译后主页加载、控制台 0 错误；自动点击模拟器回廊按钮未完成导航，因此不把特效页触控或微信内动画记为已验收。首版阶段未部署或上传；当前云端已部署，客户端上传与真机视觉／购买恢复仍待验收。

配色调整验证：客户端 117 组通过，回归覆盖同一连线多色、四种配色区分、渐变缺失回退、原方块保留连线色、混色与 Canvas 状态恢复；离线用生产 Renderer 检查深色／明亮背景的消除中间帧及经典主题画廊。交互预览已更新生产绘制代码并通过语法检查，本轮未重新完成浏览器交互验收。微信开发者工具重新普通编译后主页加载、控制台 0 错误；真机配色、帧率及微信内特效页验收仍待完成。

## 7. 特效 Manifest 与服务接口

### 7.1 文件和注册顺序

建议新增以下文件：

```text
src/services/clear-effect-service.js   # 注册、选择、持久化、回退
src/effects/index.js                   # 内置特效注册顺序
src/effects/none.js                    # 无动画的 none 数据 manifest
src/effects/fade.js                    # 仅含 fade 数据 manifest
assets/effects/none/preview.png        # “无特效”选择页预览图
assets/effects/fade/preview.png        # 选择页预览图，不参与棋盘运行时
tests/clear-effect-system.test.js      # 服务、页面和渲染契约
```

`src/effects/*.js` 必须是纯数据模块，不能导入 `wx`、Canvas、`GameRunner` 或存档服务。`index.js` 只汇总注册顺序，不做页面跳转或分页。
`src/bootstrap.js` 负责把内置 effects 清单和配置传给 `ClearedApp`；由 App 实例化 `ClearEffectService`，再把 renderer 所需的只读查询依赖显式传入。不得在 renderer 内部隐式 `require` 业务注册表。

推荐的依赖 wiring（名称可在实现时保持一致）：

~~~js
// src/bootstrap.js
const effects = require('./effects/index.js');
const app = new ClearedApp(platform, { effects });

// src/app.js（构造函数内部）
this.clearEffects = new ClearEffectService(this.progress, opts.effects || []);
this.renderer = new CanvasRenderer(platform, this.skins, this.clearEffects);
~~~

`CanvasRenderer` 对第三个参数只能执行 `current/get/resolve` 等只读查询；选择和持久化必须回到 `ClearedApp.performAction()` → `this.clearEffects.select()`。

### 7.2 服务 API

`ClearEffectService` 的形状参考 `SkinService`，但职责仅限于特效清单和当前选择：

~~~js
const service = new ClearEffectService(progressStore, effects);

service.current();             // 当前完整 manifest
service.get('none');            // 无特效 manifest
service.get('fade');            // 已注册 manifest 或 null
service.list();                 // 画廊用的可序列化描述列表
service.select('none');         // 选择后不创建清除动画
service.select('fade');         // 已拥有且成功写入 settings.clearEffectId 时才成功
service.resolve('missing');     // 返回 fade 回退，不抛出运行时错误
~~~

若实现采用 `deepClone()`，它只表示对普通对象/数组的递归数据复制；不得用 JSON 序列化复制图片对象、函数或平台句柄，也不得把这些值放进 manifest。

服务必须：

- 按 `src/effects/index.js` 顺序注册六种内置效果，并保证可信的 `fade` 安全回退不会被同名扩展覆盖；
- 拒绝空 ID、重复 ID、原型污染键和非普通对象；
- 深拷贝/合并纯数据，不能让调用方修改内部 manifest；
- 实际选择恢复对未知、损坏或未拥有的 `clearEffectId` 使用 `none`；manifest 的未知动画参数仍可解析为可信 `fade` 视觉回退；
- `list()` 不暴露图片对象、函数、平台句柄或任意脚本；
- 选择先检查只读拥有权，再调用 `ProgressStore.setSetting('clearEffectId', id)`；只有明确写盘成功才更新当前 ID。

服务不负责：Canvas 绘图、触摸命中、场景切换、路径求解、音效播放、发奖或网络同步。它通过注入的只读拥有权查询拒绝未拥有项目，并仅在设置写盘成功后更新当前选择。

## 8. 预览图与 ImageGen 边界

内置预览图位于 `assets/effects/none/preview.png` 和 `assets/effects/fade/preview.png`。它们只服务于特效卡片，不是棋盘动画贴图。

四种新增 manifest 不声明 `preview`，卡片与解锁弹窗调用同一个形状绘制器的固定进度，不请求不存在的 PNG，也不误用 fade 图。

2026-09-03 起，回廊所有位图预览统一采用 **128×128、最多 128 种实际 RGBA 颜色的 PNG-8**，每张不超过 8 KiB。
两张特效图从原构图等比缩放并透明居中补边；原图保存于 `scripts/gallery-preview-sources/effects/`，该目录不参与发布。
十套主题预览遵守相同规格，存放在主包的 `assets/theme-previews/`。回廊入口与经典主题继续由 Canvas 绘制，不新增位图。
具体生成流程、代码白名单/禁止区和验收清单见 [`corridor-preview-assets.md`](corridor-preview-assets.md)。

`fade` 的美术意象：

- 轻薄、半透明的风痕或飘散带状线条；
- 明亮、干净、低细节，主体居中，能在小卡片中一眼看懂“逐渐消散”；
- 不包含文字、按钮、Logo、棋盘或水印；
- 源图使用适合 `contain` 的方形或 4:3 构图，避免重要内容贴边；发布小图统一为等比补边的 128×128 正方形。

可供 ImageGen 使用的提示词草案（仅美术输入，不是运行时代码）：

~~~text
轻量 2D 手机益智游戏特效预览，一缕明亮的微风将彩色方块化作细小的光尘向右上方飘散，
半透明的白色与淡蓝色风痕，简洁干净、低细节、柔和赛璐璐风格，主体居中，适合小尺寸卡片，
无文字、无 UI、无 Logo、无棋盘、无水印，方形或 4:3 构图。
~~~

`none` 使用完整、静止、清晰的彩色圆角方块，保留透明安全边；不得包含风线、粒子、碎片、拖影、文字或 UI。

renderer 只在 `effects` 场景懒加载预览图，并使用请求 token/generation 防止旧图晚到覆盖新页面。加载失败、文件缺失或尺寸不可用时：

1. 特效卡片仍可点击；
2. `none` 使用静止完整方块回退，`fade` 与回廊“特效”入口使用风线和消散方块回退；
3. 不把失败预览传入棋盘 `drawTile()`；棋盘继续遵守当前选择的六种效果语义。

不允许从远程 URL 下载预览图，也不允许因为预览图加载而阻塞进入关卡。

## 9. 存档与兼容策略

继续使用 `ProgressStore` 的 schema version 2，不新增第二套设置存档。将选择结果持久化到 `settings.clearEffectId` 是沿用主题行为的实现假设；若产品最终决定特效只在当前会话生效，必须在编码前修改本节和服务契约。

~~~js
settings: {
  skinId: 'classic',
  clearEffectId: 'none',
  clearMode: 'sequential',
  soundEnabled: true
}
~~~

规则如下：

- 全新安装默认 `none`。已有进度存档可继续保留 `clearEffectId` 字段，但字段本身不证明拥有；未拥有 `fade` 时启动回退 `none`，完成 `2:2` 后才可恢复或选择。
- 存档中的未知、损坏或未拥有 ID 在实际应用路径回退 `none`；manifest 解析仍可用可信 `fade` 作为未知动画参数的视觉兼容值，不因此绕过使用权限。
- 特效选择是全局视觉设置，普通关卡和每日挑战共用；不写入 `DailyProgressStore`，不影响每日次数、完成状态或奖励资格。
- 本期特效仅支持 `none` 默认可用、`fade` 通过主线第 10 关解锁；暂不增加特效货币、广告或分享解锁，也不增加抽取、网络同步、运营时间窗或广告增益。
- 更换特效不会重置当前棋盘、计时、撤销栈或提示状态。

## 10. 代码边界矩阵

| 模块 | 允许承担 | 明确禁止 |
| --- | --- | --- |
| `src/bootstrap.js` | 注入内置 effects 清单、`ClearEffectService` 配置和测试替身；保持正式/调试启动参数显式 | 在 bootstrap 中绘制页面、读写特效存档或实现动画算法 |
| `src/app.js` | 持有 `this.clearEffects`；维护画廊状态与 action；在 `onPathCompleted()` 创建可空动画快照并编排独立结果延迟 | 直接绘制 Canvas、读取/解析图片、实现逐格特效算法、修改 `GameRunner` 规则 |
| `src/ui/canvas-renderer.js` | 分派场景；绘制回廊及特效/音乐画廊的共用卡片布局；懒加载特效预览；提供 `none`/`fade` 缺图回退与音乐矢量图标 | 写存档、切换场景、调用路径求解、修改 runner、实现棋盘规则 |
| `src/services/audio-service.js` / `src/config/audio.js` | 声明曲目列表；提供只读曲目描述、选中 ID、可靠保存后切换、音频加载与生命周期保护 | Canvas、场景跳转、棋盘规则、CloudBase 偏好扩展 |
| `src/ui/board/board-renderer.js` | 消费纯棋盘 ViewModel；按白名单绘制 `fade`，对 `none` 早退 | 读取存档、修改 App/Runner、加载画廊预览 |
| `src/ui/board/portal-overlay.js` | 最后绘制 Portal；只在真实清除动画窗口保留门格视觉 | 把 `none` 当作 300ms 动画、判断 Portal 合法性 |
| `src/services/clear-effect-service.js` | 注册/校验 manifest、`current/get/list/select/resolve`、默认与非法 ID 回退、`clearEffectId` 持久化 | Canvas、平台 API、触摸命中、动画时钟、关卡完成或音效 |
| `src/effects/*.js` | 纯 JSON 可序列化的 `id/name/type/preview/durationMs/params` | 函数、类实例、回调、`wx`、Canvas、`GameRunner`、网络地址或业务状态 |
| `src/effects/index.js` | 维护内置 manifest 的确定性注册顺序 | 页面跳转、分页、存档写入、图片加载 |
| `src/services/progress-store.js` | 新安装默认 `none`；已有缺字段存档兼容 `fade`；保存全局 `clearEffectId` | 升级 schema、创建重复存档 key、写每日状态 |
| `src/services/skin-service.js` / `src/skins/*` | 继续管理主题和 `skinId`；主题页协议不变 | 保存特效选择、读取 effect manifest、把特效逻辑塞入主题配置 |
| `core/game-runner.js` | 继续管理路径、owner、撤销、计时和完成判定 | 读取特效 ID、计算 alpha/scale、加载资源 |
| `src/platform/wechat.js` | 继续提供 Canvas、图片、生命周期和输入能力 | 特效业务决策、动画策略、远程资源下载 |
| `data/*` | 保持关卡、palette、solution 数据不变 | 存放特效 manifest、预览图或特效状态 |
| `assets/effects/<id>/` | 保存选择页预览等静态特效资源 | 逐帧棋盘动画贴图、可执行脚本、远程资源清单 |
| `pages/*`、根 `app.js/app.json/app.wxss` | 不参与本小游戏发布 | 新增回廊或特效实现 |
| `tests/*` | 验证路由、分页、回退、存档、普通/每日/Portal 共用的 `none`/`fade` 语义和性能边界 | 依赖真实网络、依赖未提交的 ImageGen 远程结果 |

## 11. 触摸、渲染和状态机执行边界

新增场景必须同时补齐以下位置，不能只添加 renderer 分支：

1. `CanvasRenderer.render()` 的 `corridor`、`effects`、`music` 分支；
2. `ClearedApp.buildModel()` 的三个场景模型；
3. `onPointerStart()`：在空白槽或非按钮区域保留 pointer，以支持横滑；
4. `onPointerEnd()`：处理横滑阈值、边界和 action 一致性；
5. `performAction()`：处理 canonical action 及兼容别名；
6. `isAnimating()`/`tick()`：使用动画快照时长并在结束时最终重绘；
7. `onHide()`/`onShow()`/重置/撤销：不留下旧预览请求或过期动画状态；场景离开、资源源变更或新一代页面开始时递增 preview generation/token，回调只有在 token 仍匹配时才能写入缓存并 `invalidate()`。

推荐的状态关系如下：

~~~text
home --home:corridor--> corridor
corridor --corridor:themes--> themes(origin=corridor)
corridor --corridor:effects--> effects
corridor --corridor:music--> music
themes(origin=corridor) --themes:corridor--> corridor
themes(origin=home)     --themes:home--> home
effects --effects:corridor--> corridor
effect:<id>              -- stay --> effects
music --music:corridor--> corridor
music:<id>              -- stay --> music
~~~

特效选择和页面返回不得改变 `setIndex`、`levelIndex`、`runner`、`daily` 或普通进度存档。

## 12. 测试与验收清单

实现阶段至少新增或更新以下自动化覆盖：

1. **服务注册与回退**：内置顺序固定为 `none → fade → starburst → bubbles → petals → shatter`；可信 `fade` 始终存在；未知 ID、重复 ID、恶意键和坏 manifest 不会使启动失败。
2. **存档兼容**：新安装默认 `none`，已有缺字段存档读取为 `fade`；选择后写入 `settings.clearEffectId`；重新创建 App 能恢复；其他存档字段不变。
3. **回廊命中**：`corridor:home`、`corridor:themes`、`corridor:effects`、`corridor:music` 正确注册；3 个空槽无 hit；安全区和窄屏不重叠。
4. **特效分页**：0、1、6、7 个特效的页数、槽位映射、空槽无 hit、边界 clamp；`effectPageIndex` 不影响 `themePageIndex`。
5. **导航来源**：从回廊进入主题后返回回廊；旧 `home:themes → themes:home` 仍可用；`home:corridor` 是当前唯一可见回廊入口。
6. **特效选择**：`effect:none` 始终可选；`effect:fade` 锁定时显示“通关第 10 关解锁”，拥有后点击即时重绘并可靠持久化；非法、未拥有或保存失败均不改变当前 ID。
7. **清除视觉契约**：同时模式的 `none` 不创建快照；依次模式的 `none` 保留路径时序，未轮到的格子完整显示，轮到后直接隐藏；`fade` 的 alpha 单调从 1 到 0；两种方式都不改变 GameRunner 状态和结算。每日热身必须等末格音效与动画尾结束才切换下一题。
8. **动画快照**：动画播放中切换特效不会改变已开始路径；reset/undo 会清除旧动画；duration 非法值会安全回退；未填满失败窗口不得早于最终动画结束出现。
9. **预览回退与竞态**：ImageGen 预览懒加载；失败、缺图、晚到回调均不会阻塞页面或覆盖当前页面；棋盘不请求预览图。
   另运行 `node scripts/validate-gallery-previews.js` 校验全部回廊位图的 128/128c 规格与主包归属；运行离线生成工具的 `--check` 验证源图和小图一致。
10. **轻量边界**：不新增粒子/物理/offscreen canvas/逐帧 sprite/网络依赖；每格每帧最多调用一次 `drawTile()`，绘制为 O(1)，新增临时对象数量不超过当前路径长度，单次动画沿用主循环。
11. **回归**：运行 `node tests/run.js`，现有主题、每日挑战、连线、音频、Canvas 和启动测试全部通过。
12. **真机视觉**：在窄屏、安全区和高 DPR 设备检查回廊/特效页始终保持 2×3，返回按钮可点，预览不拉伸，淡出不遮挡底部操作区。

## 13. 首页迁移的单独执行记录（已启用）

首页替换已作为独立配置启用，不与首个特效算法绑定。当前执行结果：

- `drawHome()` 继续使用现有首页按钮栈和安全区计算；回廊按钮复用当前主题按钮的矩形、圆角、字体和层级；
- 可见命中已从 `home:themes` 改为 `home:corridor`，没有重叠的双 hit；
- `home:dailyChallenge`、`home:start` 的文案、位置和可用条件未因迁移改变；
- 首页关卡进度放入 `home:start` 按钮内右侧，以 `已完成数量/总关卡数` 的数值形式展示，例如 `23/92`，不显示“已完成”前缀。按钮主文案“继续游戏／开始游戏”继续位于原矩形中心，Logo 下方不再重复显示进度；进度文本共用原按钮命中区域。
- `performAction('home:themes')`、`themes:home` 兼容别名继续保留，并已同步相关测试/文档；
- `docs/theme-system.md` 继续作为主题 manifest/tile 的权威文档，只需补充“回廊为上游入口”的交叉说明，不把回廊逻辑塞入 SkinService；
- 直接构造 `ClearedApp` 时仍可用 `homeMigration: false` 做兼容测试；正式 `src/bootstrap.js` 已设为 `true`。

任何需要改变存档 schema、关卡规则、每日次数、页面打包范围或平台能力的方案，都必须另开变更记录，不能借回廊或消除特效一并混入。

## 14. 当前实现记录

当前已完成的代码和素材：

- `src/services/clear-effect-service.js`：特效注册、校验、选择、`clearEffectId` 持久化和 `fade` 回退；
- `src/effects/none.js`、`src/effects/fade.js`、`src/effects/index.js`：按 `none → fade` 注册的声明式 manifest；
- `src/app.js`：特效服务 wiring、回廊/特效场景、路由、分页、动画快照和首页迁移开关；
- `src/ui/canvas-renderer.js`：回廊/特效 2×3 画廊、预览懒加载和按类型区分的失败回退；
- `src/ui/board/board-renderer.js`、`src/ui/board/portal-overlay.js`：纯 ViewModel 清除绘制和 Portal 最终叠加；
- `src/bootstrap.js`、`src/services/progress-store.js`：内置清单注入和 schema v2 设置兼容；
- `assets/effects/none/preview.png`、`assets/effects/fade/preview.png`：ImageGen 生成并压缩后的静止方块/风吹飘散预览图；
- `tests/clear-effect-service.test.js`、`tests/clear-effect-system.test.js` 及 Portal/每日测试：服务、存档、路由、分页、预览和普通/每日/Portal 的快照语义覆盖。

当前仍未完成：

- 真机上的窄屏、安全区、高 DPR 和实际图片加载视觉验收；
- 粒子类特效；当前白名单仅实现 `none` 和 `fade`。
