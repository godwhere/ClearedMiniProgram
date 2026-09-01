# 回廊与消除特效系统设计与实现边界

> 设计记录：2026-08-31  
> 最近更新：2026-09-01（适配 `BoardRenderer` 架构并新增 `none`）
>
> 需求状态：已确认（按分阶段契约实施）  
> 实现状态：回廊/特效场景已接入，内置 `none` 与 `fade` 两种选择、独立预览素材和回归测试；真机视觉验收待完成
>
> 运行时：微信小游戏单 Canvas 链路 `game.js → src/bootstrap.js → src/app.js → src/ui/canvas-renderer.js → src/ui/board/board-renderer.js`

## 1. 需求复述与现有基线

本需求包含三个相互关联、但需要分阶段交付的部分：

1. 为连接成功后的消除过程增加可选择的、轻量的视觉特效。
2. 在主页增加一个“回廊”功能入口。进入后显示与主题画廊相同的 **2 列 × 3 行** 网格，但网格卡片是其他功能的入口；第一版只放“主题”和“特效”。
3. 增加“特效选择”页面，布局和交互参考现有主题选择页面。内置“无特效”和“逐渐消失”两种选择：前者提交后立即移除路径，后者让路径格逐步降低透明度直至消失；预览图均为画廊素材，不参与棋盘运行时。

当前工程的相关基线如下：

| 能力 | 当前实现 | 本需求的处理 |
| --- | --- | --- |
| 首页 | `CanvasRenderer.drawHome()` 绘制 `home:dailyChallenge`、`home:corridor`、`home:start`（直接 App 构造默认仍可关闭迁移） | 运行时复用原主题按钮位置显示回廊；不增加第四枚按钮，`home:themes` 仅作兼容 action |
| 主题画廊 | `scene === 'themes'`，固定 2×3、空槽、左右滑动和 `theme:<id>` | 保持主题协议；回廊只是上游入口，不重命名主题 manifest |
| 当前清除表现 | `app.onPathCompleted()` 根据选择创建可空动画快照；`BoardRenderer.drawClearAnimation()` 负责约 300ms 的 alpha/scale 淡出 | `none` 不创建快照并立即移除；`fade` 复用既有淡出表现；两者都不改变规则 |
| 规则层 | `core/game-runner.js` 管理路径、占用、撤销和完成判定 | 不读取特效，不改变任何规则或结算时机 |
| 旧页面 | `pages/*` 和根目录旧小程序页面被 `project.config.json` 排除 | 不作为实现入口 |

两种选择都不是新的玩法或棋盘状态。`GameRunner` 在连接成功时仍立即更新 owner/path 并判定结果；`none` 不增加任何临时视觉状态，`fade` 只负责随后几百毫秒的 Canvas 绘制。

## 2. 分阶段交付与明确范围

### 2.1 当前阶段：文档冻结

文档冻结阶段已完成；当前实现已按本文契约落地，首页入口迁移已在正式 `bootstrap` 配置启用，仍可由独立开关回退。以下内容继续作为后续实现依据：

- 回廊页面和特效页面的场景、布局、路由、存档和测试契约；
- `none` / `fade` 特效的声明式数据协议和渲染白名单；
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
       └─ corridor:effects → 特效画廊
            └─ effect:<id> → 选择特效并返回特效画廊
~~~

迁移后 `home:themes` 不再注册为可见命中区域，但 `performAction('home:themes')` 仍保留兼容别名，避免旧自动化测试、外部调用或恢复中的 UI 消息突然失效。主题的 `theme:<id>`、主题 manifest 和 `settings.skinId` 不改名。

## 3. 用户流程与稳定命中 ID

### 3.1 场景

新增两个场景：

- `scene === 'corridor'`：功能入口回廊；
- `scene === 'effects'`：消除特效选择页。

已有 `scene === 'themes'` 保持不变。应用层维护 `galleryOrigin`（`home` 或 `corridor`），用于决定从主题页返回主页还是回廊；不能依靠全局共享的主题页索引推断来源。

### 3.2 Action 契约

| Action | 目标 | 可见/兼容说明 |
| --- | --- | --- |
| `home:corridor` | 进入 `corridor` | 当前运行时的唯一可见回廊入口，复用原主题按钮位置 |
| `home:themes` | 进入 `themes` | 当前运行时不注册 visible hit；`performAction` 兼容保留 |
| `corridor:home` | 回到主页 | 回廊左上角返回 |
| `corridor:themes` | 进入主题画廊 | 设置 `galleryOrigin = 'corridor'` |
| `corridor:effects` | 进入特效画廊 | 设置 `galleryOrigin = 'corridor'` |
| `corridor:sound` | 切换静音 | 与其他场景的音效入口一致 |
| `themes:corridor` | 从回廊来源的主题页返回回廊 | 新契约；仅在 `galleryOrigin === 'corridor'` 时绘制 |
| `themes:home` | 从旧主题入口返回主页 | 兼容旧流程和旧测试 |
| `themes:sound`、`themes:prev`、`themes:next` | 主题页现有控制 | 保持现有协议 |
| `effects:corridor` | 从特效页返回回廊 | 特效页左上角返回 |
| `effects:home` | 从旧/内部直达特效页返回主页 | 兼容别名，不作为回廊主流程的首选 |
| `effects:sound`、`effects:prev`、`effects:next` | 特效页控制 | 分页只有超过 6 个特效时才启用 prev/next |
| `effect:<id>` | 选择指定特效并留在当前页 | 选择失败不得改写存档 |

顶部返回按钮的命中 ID 必须和 `model.backAction` 一致，不能同一帧同时注册 `themes:home` 与 `themes:corridor` 两个重叠 hit。

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

第一版只有两个有效入口：

~~~js
[
  { id: 'themes',  name: '主题',  action: 'corridor:themes' },
  { id: 'effects', name: '特效', action: 'corridor:effects' }
]
~~~

剩余四个槽位保留为空，不显示伪造的锁定状态，也不注册命中区域。未来增加功能时按注册顺序追加，不改变已有 `id` 或槽位映射。

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

## 5. 特效选择页契约

### 5.1 布局和选择

- 页面固定 2 列 × 3 行，每页 6 个槽位；卡片尺寸、间距、标题和顶部控制参考 `drawThemes()`。
- `effectPageIndex`、`effectPageCount`、`EFFECT_PAGE_SIZE` 独立于主题分页。
- 内置卡片按稳定顺序显示：`effect:none`（“无特效”）在前，`effect:fade`（“逐渐消失”）在后；其余四槽为空且无 hit。
- 点击有效卡片后立即写入 `settings.clearEffectId`、重绘并留在当前页；不自动进入棋盘、不重置当前关卡、不清除当前进度。
- 选择页可显示当前选中标记；未注册或加载失败的预览不应使卡片不可选。

### 5.2 特效页模型

~~~js
{
  scene: 'effects',
  effects: [
    { id: 'none', name: '无特效', type: 'none', preview: 'assets/effects/none/preview.png' },
    { id: 'fade', name: '逐渐消失', type: 'fade', preview: 'assets/effects/fade/preview.png' }
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

### 6.1 既有动画的抽象方式

普通关卡、每日挑战和 Portal 试玩都在 `ClearedApp.onPathCompleted()` 处理路径完成。应用层根据当前选择创建可空动画快照，不在各模式中复制完成流程。

连接完成时，应用层创建一次性的动画快照：

~~~js
const effect = clearEffects.current();
const animation = effect.type === 'none' ? null : {
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
- `none` 必须用 `clearAnimation === null` 表达，不创建 0ms 哨兵快照，不触发动画时钟或 Portal 清除窗口；
- `effectId`、`durationMs`、`params` 必须在开始时快照化；`params` 至少要做深拷贝（或冻结只读副本），不能持有注册表对象的可变引用。动画播放中切换特效不会改变当前动画，新完成的路径才使用新选择；
- 普通 `play/result` 和每日 `daily/dailyResult` 使用同一个清除适配器；
- 特效层不修改 `GameRunner` 的 owner、selectedCells、撤销栈或 outcome；规则层独立判断
  `playing/won/failed`，未填满失败面板在 `max(animation ? animation.durationMs : 0, resultDelayMs)` 后出现，
  不得提前遮挡最后一条清除动画；
- `play:reset`、`play:undo`、`daily:reset`、`daily:undo` 清除尚未完成的动画快照；
- `app.isAnimating()` 只对非空、非 `none` 快照使用其中的 `durationMs`，避免无特效空转，也避免切换选择后提前停止旧动画。

时长来源按以下优先级解析，所有结果都经过数值校验和上限限制：

~~~text
animation.durationMs（已快照）
  > 当前 effect manifest.durationMs
  > legacy skin.animation.pathClearMs
  > 300ms
~~~

该优先级只适用于真实动画。`skin.animation.pathClearMs` 继续作为旧主题/旧调用的兼容回退；`none` 不参与时长解析。

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

`none` 的运行时语义是“没有动画快照”：路径提交、owner 更新、结果判定、音效、震动和结算照常发生，但已占用格立即从棋盘 ViewModel 中隐藏。结果页仍遵守独立的 `skin.animation.resultDelayMs`，不能把“无特效”解释为取消所有场景转场。

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
type === 'none'  → 不绘制；正常 App 流程不会创建该快照
type === 'fade'  → 逐格 alpha/scale 算法
未知 type        → 经典 fade 回退
~~~

renderer 不执行 manifest 中的函数、脚本、字符串表达式或网络内容。首版不支持粒子系统、物理模拟、shader、offscreen canvas、逐帧 sprite sheet、协程或动态下载。

每个路径格的绘制应为 O(1)，只复用当前主循环和 `drawTile()`；不在每帧创建与路径长度成倍增长的临时对象，不在渲染循环中加载图片。效果时长结束后必须由 `tick()` 触发一次最终重绘，确保残留透明层从 Canvas 移除。

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
service.select('fade');         // 成功写入 settings.clearEffectId
service.resolve('missing');     // 返回 fade 回退，不抛出运行时错误
~~~

若实现采用 `deepClone()`，它只表示对普通对象/数组的递归数据复制；不得用 JSON 序列化复制图片对象、函数或平台句柄，也不得把这些值放进 manifest。

服务必须：

- 按 `src/effects/index.js` 顺序注册内置 `none`、`fade`，并保证可信的 `fade` 安全回退不会被同名扩展覆盖；
- 拒绝空 ID、重复 ID、原型污染键和非普通对象；
- 深拷贝/合并纯数据，不能让调用方修改内部 manifest；
- 对未知或损坏的 `clearEffectId` 使用 `fade`，保留存档其他字段；
- `list()` 不暴露图片对象、函数、平台句柄或任意脚本；
- 选择成功后立即调用 `ProgressStore.setSetting('clearEffectId', id)`。

服务不负责：Canvas 绘图、触摸命中、场景切换、路径求解、音效播放、广告、解锁和网络同步。

## 8. 预览图与 ImageGen 边界

内置预览图位于 `assets/effects/none/preview.png` 和 `assets/effects/fade/preview.png`。它们只服务于特效卡片，不是棋盘动画贴图。

`fade` 的美术意象：

- 轻薄、半透明的风痕或飘散带状线条；
- 明亮、干净、低细节，主体居中，能在小卡片中一眼看懂“逐渐消散”；
- 不包含文字、按钮、Logo、棋盘或水印；
- 使用适合 `contain` 绘制的方形或 4:3 构图，避免重要内容贴边。

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
3. 不把失败预览传入棋盘 `drawTile()`；棋盘继续遵守当前选择的 `none`/`fade` 运行时语义。

不允许从远程 URL 下载预览图，也不允许因为预览图加载而阻塞进入关卡。

## 9. 存档与兼容策略

继续使用 `ProgressStore` 的 schema version 2，不新增第二套设置存档。将选择结果持久化到 `settings.clearEffectId` 是沿用主题行为的实现假设；若产品最终决定特效只在当前会话生效，必须在编码前修改本节和服务契约。

~~~js
settings: {
  skinId: 'classic',
  clearEffectId: 'none',
  soundEnabled: true
}
~~~

规则如下：

- 全新安装默认 `none`；已有 v1 或已有 v2 缺少 `clearEffectId` 时继续读取为 `fade`，避免升级后静默改变视觉；显式保存的 `none` / `fade` 原样保留。
- 存档中的未知/损坏 ID 回退 `fade`；是否立即回写修正值由测试决定，但不得覆盖 `completed`、`bestMs`、`lastPlayed`、`stats` 或 `skinId`。
- 特效选择是全局视觉设置，普通关卡和每日挑战共用；不写入 `DailyProgressStore`，不影响每日次数、完成状态或奖励资格。
- 第一版不做特效解锁、付费、抽取、网络同步、运营时间窗或广告增益。
- 更换特效不会重置当前棋盘、计时、撤销栈或提示状态。

## 10. 代码边界矩阵

| 模块 | 允许承担 | 明确禁止 |
| --- | --- | --- |
| `src/bootstrap.js` | 注入内置 effects 清单、`ClearEffectService` 配置和测试替身；保持正式/调试启动参数显式 | 在 bootstrap 中绘制页面、读写特效存档或实现动画算法 |
| `src/app.js` | 持有 `this.clearEffects`；维护画廊状态与 action；在 `onPathCompleted()` 创建可空动画快照并编排独立结果延迟 | 直接绘制 Canvas、读取/解析图片、实现逐格特效算法、修改 `GameRunner` 规则 |
| `src/ui/canvas-renderer.js` | 分派场景；绘制回廊/特效画廊；懒加载预览；提供 `none`/`fade` 对应的缺图回退和兼容代理 | 写存档、切换场景、调用路径求解、修改 runner、实现棋盘规则 |
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

1. `CanvasRenderer.render()` 的 `corridor`、`effects` 分支；
2. `ClearedApp.buildModel()` 的两个场景模型；
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
themes(origin=corridor) --themes:corridor--> corridor
themes(origin=home)     --themes:home--> home
effects --effects:corridor--> corridor
effect:<id>              -- stay --> effects
~~~

特效选择和页面返回不得改变 `setIndex`、`levelIndex`、`runner`、`daily` 或普通进度存档。

## 12. 测试与验收清单

实现阶段至少新增或更新以下自动化覆盖：

1. **服务注册与回退**：内置顺序固定为 `none → fade`；可信 `fade` 始终存在；未知 ID、重复 ID、恶意键和坏 manifest 不会使启动失败。
2. **存档兼容**：新安装默认 `none`，已有缺字段存档读取为 `fade`；选择后写入 `settings.clearEffectId`；重新创建 App 能恢复；其他存档字段不变。
3. **回廊命中**：`corridor:home`、`corridor:themes`、`corridor:effects` 正确注册；4 个空槽无 hit；安全区和窄屏不重叠。
4. **特效分页**：0、1、6、7 个特效的页数、槽位映射、空槽无 hit、边界 clamp；`effectPageIndex` 不影响 `themePageIndex`。
5. **导航来源**：从回廊进入主题后返回回廊；旧 `home:themes → themes:home` 仍可用；`home:corridor` 是当前唯一可见回廊入口。
6. **特效选择**：`effect:none` / `effect:fade` 点击后即时重绘、保持在 effects 场景并持久化；非法选择不改变当前 ID。
7. **清除视觉契约**：`none` 在普通、每日和 Portal 中均不创建快照、不绘制格子、不保留动画尾；`fade` 的 alpha 单调从 1 到 0；两者都不改变 GameRunner 状态和结算。
8. **动画快照**：动画播放中切换特效不会改变已开始路径；reset/undo 会清除旧动画；duration 非法值会安全回退；未填满失败窗口不得早于最终动画结束出现。
9. **预览回退与竞态**：ImageGen 预览懒加载；失败、缺图、晚到回调均不会阻塞页面或覆盖当前页面；棋盘不请求预览图。
10. **轻量边界**：不新增粒子/物理/offscreen canvas/逐帧 sprite/网络依赖；每格每帧最多调用一次 `drawTile()`，绘制为 O(1)，新增临时对象数量不超过当前路径长度，单次动画沿用主循环。
11. **回归**：运行 `node tests/run.js`，现有主题、每日挑战、连线、音频、Canvas 和启动测试全部通过。
12. **真机视觉**：在窄屏、安全区和高 DPR 设备检查回廊/特效页始终保持 2×3，返回按钮可点，预览不拉伸，淡出不遮挡底部操作区。

## 13. 首页迁移的单独执行记录（已启用）

首页替换已作为独立配置启用，不与首个特效算法绑定。当前执行结果：

- `drawHome()` 继续使用现有首页按钮栈和安全区计算；回廊按钮复用当前主题按钮的矩形、圆角、字体和层级；
- 可见命中已从 `home:themes` 改为 `home:corridor`，没有重叠的双 hit；
- `home:dailyChallenge`、`home:start` 的文案、位置和可用条件未因迁移改变；
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
