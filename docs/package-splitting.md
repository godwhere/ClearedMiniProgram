# 微信小游戏主包 4M 限制：主题资源分包实施方案

## 当前每日内容包排除项

版本更新面板及纯图标／整屏背景接入后的当前源码估算：主包 **1,709,167 bytes / 1.630 MiB**，总包 **18,590,391 bytes / 17.729 MiB**。更新内容、确认标记和 Canvas 排版随主包发布，没有新增素材或分包；仍满足 **1.63 / 3.50 / 18.00 MiB** 门禁。主包距现有门禁仅余 **11 bytes**，后续修改更新文案或代码必须重新验证预算；下文数字为此前各阶段基线。

十天机制包及其后的 28 天四周题面和解答仍在主包，无新分包或素材。`project.config.json.packOptions.ignore` 排除本地 `output/`、`tmp/` 两个目录，避免个人文档和临时预览进入微信包；不删除目录内容，不排除正式 daily 数据或运行资源。`tests/package-budget.test.js` 对这两个排除项和每日内容保留建立回归。

2026-10-08 主线补至 300 关后的源码字节估算：主包 **1,669,631 bytes / 1.592 MiB**，总包 **16,642,742 bytes / 15.872 MiB**，继续满足主包 1.60 MiB / 单分包 3.50 MiB / 总包 18.00 MiB 门禁。微信最终编译包和真机验收仍需另做；下文旧实施阶段数字是当时基线。

随后《漫步》与四种消除特效候选、依次消除及账号页分区接入后的当前源码统计为主包 **1,701,445 bytes / 1.623 MiB**、总包 **18,582,669 bytes / 17.722 MiB**，仍为一个主包与 12 个普通分包。特效前主包为 1,677,115 bytes，距原 1.60 MiB 门禁仅 606 bytes；首版纯 Canvas 效果、矢量预览及购买校验实增 5,316 bytes，彩色渐变与高光调整再增 1,326 bytes，依次消除、逐格同音、账号设置和偏好同步再增 9,401 bytes；资料、设置分区及左右选择器及同时消除默认值追加 2,568 bytes，无新增素材或分包。账号页音量滑条及试听／保存代码追加 5,719 bytes，无新增素材或分包，主包项目门禁调整到 **1.63 MiB**，单分包 **3.50 MiB** 与总包 **18.00 MiB** 不变。未修改现有图片；无损重编码候选不足以覆盖新增代码，因此保留原资源，不为轻量绘制代码引入新的分包加载链路。

后续带贴图或序列帧的特效应复用主题／音乐的普通分包机制，在选择应用时通过 `SubpackageService` 加载，资源失败回退解析形状；小卡片继续使用轻量预览。新资源包必须独立登记、计入同一预算脚本并完成图片、弱网及设备验收，不直接放入主包。绘制约束见 [消除特效](corridor-and-clear-effects.md#65-四种新增效果)。上述数值仍是源码估算，微信最终编译包尚未验证。

预算脚本对与已发布 JS 同目录同名的 `.js.map` 做路径校验，但不计入包体字节和文件数；孤立的 `.js.map` 仍计入。微信[游戏深度保护插件文档](https://developers.weixin.qq.com/minigame/dev/devtools/codeprotect.html)说明此类映射文件需与加固 JS 一同提审，但不计入代码包大小，也不会下发客户端。实际编译包仍以开发者工具代码依赖分析及上传校验为准。

> 文档状态：十套主题分包、主包 PNG-8 预览及 BGM 独立分包已实现；最新源码预算、音频自动测试、开发者工具普通编译与本地代码分析通过，真机与上传验收待执行
> 目标仓库：`godwhere/ClearedMiniProgram`  
> 设计基线：`main@50058c67050364d09e695ba88c549e79258b5569`  
> 适用入口：`game.js -> src/bootstrap.js -> src/app.js -> src/ui/canvas-renderer.js`

实施基线已合入 `main@0ad6357d11c96111630c5e66d41f303a4db39b84`，保留其 Portal 混合章节和提示更新。
下文保留原始设计与验收边界；当前启动注入依照最新 bootstrap，已删除的 Portal 试玩不会重新引入。
当前为主包、十个主题分包和两个音乐普通分包：默认曲目位于 `audio-bgm`；《漫步》位于 `audio-candy-day-stroll`（`assets/audio/candy-day-stroll/`），主包封面为 `assets/music-previews/candy-day-stroll.png`。锁定卡片不请求新音频；解锁后应用复用 `SubpackageService` 的进度、去重和失败重试，下载成功且选择可靠保存后才换曲，晚到的旧请求不能覆盖新选择。静音不因选曲而开启，启动播放继续遵守声音／首次交互／生命周期门禁。详见 [音乐系统](music-system.md)。使用 `node scripts/check-package-budget.js` 获取当前字节统计。
素材校验沿用现有 CLI：不传参数时检查十张正式精灵表；历史动物草稿已从仓库删除。
正式十张素材使用默认扫描全部通过，未修改校验器或任何正式 PNG。

以上“未修改 PNG”及第 5 节文件清单仅记录首轮分包实施。2026-09-03 后续接入的主包主题小图、
两张特效缩略图及其严格代码边界，以 [`corridor-preview-assets.md`](corridor-preview-assets.md) 为准。

## 1. 目标

把当前微信小游戏的主包稳定压到 4M 以下，同时保持现有玩法、关卡、主题 ID、存档字段和主题素材协议不变。

首轮采用以下方案：

1. 主包保留启动代码、完整玩法、关卡数据、经典主题、BGM、短音效、Logo、Portal 图标和特效预览。
2. 十套非经典主题的正式精灵表分别放入十个普通分包。
3. 主题画廊在分包未加载时读取主包四格 PNG-8 小图，不提前访问完整精灵表；小图失败仍有颜色回退。
4. 用户点击未加载主题时，先调用 `wx.loadSubpackage()`；加载成功后才正式选择并保存主题。
5. 增加并发去重、失败重试、下载进度、快速切换竞态保护和包体预算检查。
6. 若微信开发者工具最终报告主包仍超过项目预算，再把 BGM 拆成独立分包；首轮不提前增加这部分复杂度。

本方案解决的是发布包划分和主题资源加载，不重构玩法架构，也不引入 CDN、npm、Webpack、Cocos 或其他构建系统。

---

## 2. 当前结构与问题定位

当前项目是原生微信小游戏：CommonJS JavaScript、单 Canvas 2D、无 npm 运行依赖。实际启动链路为：

```text
game.js
  -> src/bootstrap.js
    -> src/app.js
      -> src/services/**
      -> src/ui/canvas-renderer.js
      -> core/**
```

当前 `game.json` 没有 `subpackages`。未被 `project.config.json.packOptions.ignore` 排除的十套主题精灵表全部进入主包。

十张正式主题精灵表原始大小合计约：

```text
13,289,490 bytes ~= 12.67 MiB
```

主题目录已经天然独立：

```text
assets/skins/gem/
assets/skins/animals/
assets/skins/fruits/
assets/skins/desserts/
assets/skins/space/
assets/skins/ocean/
assets/skins/spring/
assets/skins/festival/
assets/skins/music/
assets/skins/vehicles/
```

因此最小改动不是重新压图或搬动素材，而是直接把这十个现有目录声明为普通分包。

### 2.1 主要体积来源

| 主题分包 | 正式精灵表 | 原始大小 |
| --- | --- | ---: |
| `theme-gem` | `gem-sprite-sheet.png` | 1,169,749 bytes |
| `theme-animals` | `animal-sprite-sheet.png` | 1,460,217 bytes |
| `theme-fruits` | `fruit-sprite-sheet.png` | 1,213,718 bytes |
| `theme-desserts` | `dessert-sprite-sheet.png` | 1,459,627 bytes |
| `theme-space` | `space-sprite-sheet.png` | 1,283,370 bytes |
| `theme-ocean` | `ocean-sprite-sheet.png` | 1,412,990 bytes |
| `theme-spring` | `spring-sprite-sheet.png` | 1,193,549 bytes |
| `theme-festival` | `festival-sprite-sheet.png` | 1,521,583 bytes |
| `theme-music` | `music-sprite-sheet.png` | 1,227,214 bytes |
| `theme-vehicles` | `vehicle-sprite-sheet.png` | 1,347,473 bytes |

其他较大的主包资源包括约 1.68 MB 的 BGM、两张特效预览和 Portal 图标。主题拆出后，主包原始尺寸预计约 2.8-3.0 MiB；最终结果必须以微信开发者工具“代码包分析/本地代码”报告为准。

---

## 3. 架构决策

### 3.1 每个主题一个普通分包

不把十个主题合成一个大分包，原因如下：

- 用户只下载自己选择的约 1.1-1.5 MiB 素材。
- 每个包都有充足的 4M 安全余量。
- 单个主题失败不会影响其他主题。
- 素材目录和 manifest 中的路径不需要移动或改名。
- 后续更新一个主题时，不会使所有主题一起失效或重新下载。

### 3.2 主包必须保持完整可玩

即使没有网络或主题分包加载失败，用户仍必须能够：

- 冷启动进入游戏。
- 使用经典主题。
- 进入普通关卡、每日挑战和 Portal 关卡。
- 使用撤销、提示、计时、完成判定和短音效。

主题下载失败只能影响该主题的高清棋子图，不能阻断玩法。

### 3.3 主包轻量预览（后续补充）

首轮仅使用色块回退；按用户后续确认，现统一使用 128×128 / 128 色 PNG-8 主包预览：

- 分包未加载：卡片显示真实图标的 2×2 小图。
- 分包加载中：保留小图并显示下载进度。
- 分包加载成功：棋盘加载完整精灵表，卡片继续使用主包小图。
- 分包加载失败：保留小图和“加载失败，点击重试”。

十张小图位于 `assets/theme-previews/`，两张特效图也缩到同一规格；单张不超过 8 KiB。
失败/缺图时按“已就绪正式图 → 色块”回退，不触发分包下载。完整生产与验收合同见回廊预览方案。

### 3.4 BGM 首轮保留主包

主题拆出后预计已有足够余量。BGM 分包会额外影响首次用户交互、前后台生命周期、声音开关、重试和播放竞态，因此只作为第二级兜底。

触发第二级兜底的条件：

```text
微信开发者工具实际主包 > 3.2 MiB 项目预算，
或接近 4M 导致后续版本没有足够增长空间。
```

此时再新增 `audio-bgm` 分包；不在本轮同时实施。

---

## 4. 目标包结构

```text
主包
├── game.js
├── game.json
├── project.config.json
├── core/**
├── data/**
├── src/**
├── assets/logo.png
├── assets/audio/cleared-bgm.m4a
├── assets/audio/ui-click.m4a
├── assets/audio/path-step.m4a
├── assets/audio/path-error.m4a
├── assets/audio/path-complete.m4a
├── assets/audio/victory-shimmer.m4a
├── assets/effects/**
└── assets/icons/portal.png

普通分包
├── assets/skins/gem/
├── assets/skins/animals/
├── assets/skins/fruits/
├── assets/skins/desserts/
├── assets/skins/space/
├── assets/skins/ocean/
├── assets/skins/spring/
├── assets/skins/festival/
├── assets/skins/music/
└── assets/skins/vehicles/
```

每个分包目录新增根级 `game.js`：

```js
'use strict';

// Asset-only WeChat Mini Game subpackage.
// Loading this package makes the sibling theme assets available.
module.exports = {};
```

这些入口必须无副作用，不得注册主题、修改 `GameGlobal`、require 主包模块或执行场景逻辑。

---

## 5. 精确文件变更清单（首轮分包实施）

### 5.1 新增

```text
src/config/subpackages.js
src/services/subpackage-service.js

assets/skins/gem/game.js
assets/skins/animals/game.js
assets/skins/fruits/game.js
assets/skins/desserts/game.js
assets/skins/space/game.js
assets/skins/ocean/game.js
assets/skins/spring/game.js
assets/skins/festival/game.js
assets/skins/music/game.js
assets/skins/vehicles/game.js

scripts/check-package-budget.js
tests/subpackage-service.test.js
tests/package-budget.test.js
```

### 5.2 修改

```text
game.json
project.config.json
src/platform/wechat.js
src/bootstrap.js
src/app.js
src/ui/canvas-renderer.js
tests/project-config.test.js
tests/theme-system.test.js
tests/run.js
docs/theme-system.md
README.md
```

### 5.3 不修改

```text
core/**
data/**
src/gameplay/**
src/mechanics/**
src/services/progress-store.js
src/services/daily-progress-store.js
src/services/audio-service.js
src/config/audio.js
src/skins/*.js
src/effects/*.js
pages/**
```

也不得修改：

- `settings.skinId` 存档 key。
- 现有主题 ID 和注册顺序。
- 精灵表路径、尺寸、5x2 布局和 10 槽协议。
- 关卡 ID、关卡数据和路径答案。
- Portal、每日挑战、广告和音频行为。
- Canvas 尺寸、绘制坐标与触控协议。

---

## 6. `game.json` 精确配置

将现有内容扩展为：

```json
{
  "deviceOrientation": "portrait",
  "showStatusBar": false,
  "subpackages": [
    {
      "name": "theme-gem",
      "root": "assets/skins/gem/"
    },
    {
      "name": "theme-animals",
      "root": "assets/skins/animals/"
    },
    {
      "name": "theme-fruits",
      "root": "assets/skins/fruits/"
    },
    {
      "name": "theme-desserts",
      "root": "assets/skins/desserts/"
    },
    {
      "name": "theme-space",
      "root": "assets/skins/space/"
    },
    {
      "name": "theme-ocean",
      "root": "assets/skins/ocean/"
    },
    {
      "name": "theme-spring",
      "root": "assets/skins/spring/"
    },
    {
      "name": "theme-festival",
      "root": "assets/skins/festival/"
    },
    {
      "name": "theme-music",
      "root": "assets/skins/music/"
    },
    {
      "name": "theme-vehicles",
      "root": "assets/skins/vehicles/"
    }
  ]
}
```

固定约束：

1. `name` 必须与运行时配置完全一致。
2. `root` 必须唯一、互不嵌套并以 `/` 结尾。
3. 每个 `root` 下必须存在 `game.js`。
4. 不得把完整 `assets/skins` 目录加入 ignore。
5. 主题目录只提交正式精灵表与分包入口；本地草稿目录继续由发布配置排除。

---

## 7. `project.config.json` 清理边界

保留现有压缩设置和已有 ignore，只追加确认不应进入发布包的开发文件：

```json
{
  "value": "docs",
  "type": "folder"
},
{
  "value": ".github",
  "type": "folder"
},
{
  "value": "AGENTS.md",
  "type": "file"
},
{
  "value": ".gitattributes",
  "type": "file"
},
{
  "value": ".gitignore",
  "type": "file"
}
```

评估阶段的 `assets/icons/bomb.png` 没有运行时引用，已在后续结构清理中删除；
正式使用的 `assets/icons/portal.png` 必须保留。

不要为本任务修改 `uploadWithSourceMap`；是否关闭只能根据开发者工具最终报告单独决定。

---

## 8. 统一分包配置

新增 `src/config/subpackages.js`，它是运行时 package name、root、主题 ID 和资源路径前缀的唯一配置源：

```js
'use strict';

const packages = [
  {
    name: 'theme-gem',
    root: 'assets/skins/gem/',
    themeIds: ['gem'],
    assetPrefixes: ['assets/skins/gem/']
  },
  {
    name: 'theme-animals',
    root: 'assets/skins/animals/',
    themeIds: ['animals'],
    assetPrefixes: ['assets/skins/animals/']
  },
  {
    name: 'theme-fruits',
    root: 'assets/skins/fruits/',
    themeIds: ['fruits'],
    assetPrefixes: ['assets/skins/fruits/']
  },
  {
    name: 'theme-desserts',
    root: 'assets/skins/desserts/',
    themeIds: ['desserts'],
    assetPrefixes: ['assets/skins/desserts/']
  },
  {
    name: 'theme-space',
    root: 'assets/skins/space/',
    themeIds: ['space'],
    assetPrefixes: ['assets/skins/space/']
  },
  {
    name: 'theme-ocean',
    root: 'assets/skins/ocean/',
    themeIds: ['ocean'],
    assetPrefixes: ['assets/skins/ocean/']
  },
  {
    name: 'theme-spring',
    root: 'assets/skins/spring/',
    themeIds: ['spring'],
    assetPrefixes: ['assets/skins/spring/']
  },
  {
    name: 'theme-festival',
    root: 'assets/skins/festival/',
    themeIds: ['festival'],
    assetPrefixes: ['assets/skins/festival/']
  },
  {
    name: 'theme-music',
    root: 'assets/skins/music/',
    themeIds: ['music'],
    assetPrefixes: ['assets/skins/music/']
  },
  {
    name: 'theme-vehicles',
    root: 'assets/skins/vehicles/',
    themeIds: ['vehicles'],
    assetPrefixes: ['assets/skins/vehicles/']
  }
];

module.exports = Object.freeze({
  packages: Object.freeze(packages)
});
```

不要把分包名拼接逻辑散落在 App 或 Renderer 中。

---

## 9. 平台层边界

只允许在 `src/platform/wechat.js` 中直接访问 `wx.loadSubpackage`。

新增平台方法：

```js
loadSubpackage(name, handlers) {
  const callbacks = handlers || {};

  if (!this.api || typeof this.api.loadSubpackage !== 'function') {
    const error = new Error('wx.loadSubpackage is unavailable');
    error.code = 'SUBPACKAGE_UNSUPPORTED';
    if (callbacks.fail) callbacks.fail(error);
    if (callbacks.complete) callbacks.complete(error);
    return null;
  }

  const task = this.api.loadSubpackage({
    name,
    success: result => {
      if (callbacks.success) callbacks.success(result || {});
    },
    fail: error => {
      if (callbacks.fail) callbacks.fail(error);
    },
    complete: result => {
      if (callbacks.complete) callbacks.complete(result);
    }
  });

  if (task &&
      typeof task.onProgressUpdate === 'function' &&
      typeof callbacks.progress === 'function') {
    task.onProgressUpdate(result => callbacks.progress({
      progress: Math.max(0, Math.min(100,
        Number(result.progress) || 0)),
      totalBytesWritten: Math.max(0,
        Number(result.totalBytesWritten) || 0),
      totalBytesExpectedToWrite: Math.max(0,
        Number(result.totalBytesExpectedToWrite) || 0)
    }));
  }

  return task;
}
```

平台层职责到此为止：不保存主题、不切场景、不持久化状态、不知道 Canvas。

---

## 10. `SubpackageService` 契约

新增 `src/services/subpackage-service.js`。

### 10.1 对外接口

```js
packageForTheme(themeId)
packageForAsset(source)
getPackageState(packageName)
getThemeState(themeId)
isPackageReady(packageName)
isAssetReady(source)
ensurePackage(packageName, onProgress)
ensureTheme(themeId, onProgress)
```

### 10.2 状态模型

```js
{
  name: 'theme-gem',
  status: 'idle', // idle | loading | loaded | failed
  progress: 0,
  totalBytesWritten: 0,
  totalBytesExpectedToWrite: 0,
  attempts: 0,
  errorCode: null
}
```

状态转换：

```text
idle -> loading -> loaded
                  -> failed
failed -> loading  // 用户再次点击时显式重试
loading -> loading // 并发请求复用同一个 Promise
loaded -> loaded   // 直接返回缓存结果
```

### 10.3 必须行为

- 同一包的并发请求只调用一次平台 API。
- 所有并发调用者共享最终 Promise。
- 多个进度订阅者都可以收到更新。
- 失败不能永久缓存；下次用户操作可重试。
- 加载状态只保存在当前 JS 进程内，不写入本地存档。
- 不持久化“某个分包已下载”，避免微信清理代码包缓存后产生假状态。
- 内部索引使用 `Object.create(null)`，拒绝 `__proto__`、`constructor` 和 `prototype`。
- 对外返回状态快照，不暴露内部可变 record、Promise 或微信 task。
- 错误只保留稳定的 `errorCode`，不要把原始微信错误对象放进 ViewModel。

### 10.4 非微信测试宿主

Node fake platform 不应被迫实现完整微信 API。测试中应注入支持成功/失败控制的 fake `loadSubpackage`。对于明确不支持分包的生产宿主，不得伪装为已加载；应返回 `SUBPACKAGE_UNSUPPORTED`，App 保留旧主题并继续运行。

---

## 11. `bootstrap.js` 注入边界

新增 require：

```js
const SubpackageService =
  require('./services/subpackage-service.js');
const subpackageConfig =
  require('./config/subpackages.js');
```

在创建 App 前创建服务：

```js
const subpackages = new SubpackageService(
  platform,
  subpackageConfig
);
```

通过 App options 注入：

```js
const app = new ClearedApp(platform, {
  // 现有 options 保持
  subpackages,
  skins,
  effects,
  adConfig,
  progressionConfig: runtimeProgressionConfig,
  audioConfig,
  solutionCatalog,
  dailyManifest,
  dailySolutions,
  portalMechanic: mechanics.get('portal'),
  homeMigration: true,
  dailyEntryLimit: dailyConfig.entryLimit,
  dailyTimeZone: dailyConfig.timeZone,
  dailyDebugUnlimited:
    dailyConfig.debugUnlimitedEntries === true
});
```

不允许 Renderer 自行创建 Service，也不允许全局单例。

---

## 12. `app.js` 事务式主题选择

### 12.1 新增状态

在 constructor 中注入并保存：

```js
this.subpackages = opts.subpackages || null;
this.pendingSkinId = null;
this.skinLoadRequestId = 0;
```

Renderer 构造增加第四个参数：

```js
this.renderer = new CanvasRenderer(
  platform,
  this.skins,
  this.clearEffects,
  this.subpackages
);
```

### 12.2 选择流程

当前同步 `setSkin()` 必须改成：

```text
校验主题 ID
-> 查询该主题所属分包
-> 已加载则立即提交
-> 未加载则记录 pending、显示进度并请求分包
-> 分包成功且 requestId 仍为最新时提交主题
-> 调用 SkinService.select() 写入 skinId
-> 清理 Renderer 该主题失败缓存
-> 加载当前主题图片并重绘
```

分包加载失败时：

```text
清除 pending
保留原主题
不写 skinId
显示失败状态
允许下次点击重试
```

### 12.3 竞态保护

每次有效主题点击递增：

```js
const requestId = ++this.skinLoadRequestId;
```

所有异步回调提交前必须判断：

```js
if (requestId !== this.skinLoadRequestId) return false;
```

场景：

```text
用户点击 gem
用户立即点击 animals
animals 先完成并生效
gem 后完成
最终仍必须是 animals
```

不需要取消底层下载；过期请求只是不允许改变主题状态。

### 12.4 `setSkin()` 返回语义

保留同步调用接口，返回值定义为：

```text
true：主题 ID 有效，已经立即应用或成功开始加载。
false：主题 ID 非法，未开始任何操作。
```

不得把 Promise 泄漏给现有触控 action。异步错误在内部归一化和呈现，不得产生未处理 rejection。

### 12.5 恢复保存主题

当前 `SkinService` 会恢复保存的主题 ID。启动后必须调用 `prepareCurrentSkinAssets()`：

- 当前为 classic：不请求分包。
- 当前为非经典主题且包未加载：请求对应分包。
- 加载期间继续使用颜色回退，启动不阻塞。
- 成功后清理缓存并重新加载图片。
- 失败后保留保存主题的 palette/fallback，玩法继续。
- 回调执行时再次确认用户没有切换到其他主题。

### 12.6 ViewModel

`themeDescriptors()` 给每张主题卡增加：

```js
{
  assetState: 'idle',
  assetProgress: 0,
  pending: false
}
```

只允许以下状态进入 ViewModel：

```text
idle
loading
loaded
failed
```

不要放入 Promise、微信 task、Service 实例或原始 Error。

---

## 13. `CanvasRenderer` 修改边界

Renderer 不调用 `wx.loadSubpackage()`，也不负责决定何时切换主题。它只判断某个图片路径现在是否可以访问。

### 13.1 constructor

增加可选第四参数：

```js
constructor(
  platform,
  skinService,
  clearEffects,
  subpackages
) {
  this.platform = platform;
  this.skinService = skinService;
  this.clearEffects = clearEffects || null;
  this.subpackages = subpackages || null;
  // 其余初始化保持
}
```

### 13.2 资源就绪判断

```js
isAssetReady(source) {
  if (!this.subpackages ||
      typeof this.subpackages.isAssetReady !== 'function') {
    return true;
  }

  return this.subpackages.isAssetReady(source);
}
```

### 13.3 `loadSkinAssets()`

在每次 `platform.createImage(source, ...)` 前逐个判断：

```js
if (!this.isAssetReady(source)) return;
```

必须按资源路径逐个判断，不能以“整个主题是否就绪”替代，因为非经典主题可能继承主包内的 Logo 等资源。

### 13.4 `ensureThemeTileImage()`

得到 `info.source` 后、任何缓存写入或 `createImage()` 之前判断：

```js
if (!this.isAssetReady(info.source)) {
  return {
    key: info.key,
    image: null
  };
}
```

分包未加载时不得：

- 调用 `createImage()`。
- 把 `null` 写入永久失败缓存。
- 更新 `themeTileSources`。
- 创建重复 load record。

否则分包之后加载成功，Renderer 仍可能命中旧失败状态。

### 13.5 缓存失效

新增：

```js
invalidateThemeAssets(themeId) {
  const id = String(themeId);

  delete this.themeTileImages[id];
  delete this.themeTileSources[id];
  delete this.themeTileLoads[id];

  // 主包小图独立缓存，下载成功/选择主题时保留；路径变化由预览加载器识别。
}
```

App 在对应分包成功后、重新加载图片前调用。

### 13.6 画廊反馈

主题卡在主包小图预览（失败时仍有颜色回退）基础上显示：

```text
idle    -> 点击下载
loading -> 下载 37%
failed  -> 加载失败，点击重试
loaded  -> 正常预览/选中态
```

下载期间不显示全屏阻断层，不冻结分页、滑动和返回按钮。

---

## 14. 包体预算门禁

新增 `scripts/check-package-budget.js`，仅使用 Node 内置模块 `fs` 和 `path`。

职责：

1. 读取 `game.json.subpackages`。
2. 读取 `project.config.json.packOptions.ignore`。
3. 遍历仓库实际文件。
4. 排除 `.git/` 和打包 ignore。
5. 同名 JS 存在时，排除相邻 `.js.map` 的包体计量；继续校验其路径，孤立 map 仍计入。
6. 按最长匹配 root 把文件归入对应分包。
7. 其余发布文件归入主包。
8. 检查 root 唯一且不嵌套。
9. 检查每个分包有根级 `game.js`。
10. 输出每个包的文件数、字节数和最大文件。
11. 超预算时退出码为 1。

固定项目预算：

```js
const MIB = 1024 * 1024;

const BUDGETS = {
  main: Math.floor(3.2 * MIB),
  subpackage: Math.floor(3.5 * MIB),
  total: 18 * MIB,
  platformHardLimit: 4 * MIB
};
```

这些是项目预警线，不替代微信开发者工具最终统计。

示例输出：

```text
PASS main               2.85 MiB / 3.20 MiB
PASS theme-gem          1.12 MiB / 3.50 MiB
PASS theme-animals      1.39 MiB / 3.50 MiB
PASS theme-festival     1.45 MiB / 3.50 MiB
PASS total             15.50 MiB / 18.00 MiB
```

---

## 15. 测试要求

### 15.1 `tests/subpackage-service.test.js`

至少覆盖：

1. `idle -> loading -> loaded`。
2. 相同包并发 ensure 只调用一次平台 API。
3. 多个调用者共享最终结果。
4. 多个订阅者收到进度。
5. success 后进度为 100。
6. fail 后状态为 failed。
7. failed 后再次 ensure 会重试。
8. loaded 后再次 ensure 不调用平台。
9. 非法 package name 被拒绝。
10. `__proto__`、`constructor`、`prototype` 不污染映射。
11. theme ID 和 asset prefix 都能映射到正确分包。
12. unsupported platform 返回稳定错误且不会把状态标记为 loaded。

### 15.2 `tests/theme-system.test.js`

新增可控制分包 success/fail/progress 的 fake platform，并覆盖：

1. 进入主题页不提前读取未加载 sprite sheet。
2. idle 卡片显示主包四格预览；小图失败且正式图不可用时才显示颜色回退。
3. 点击主题后 pending 生效，但当前主题和存档暂时不变。
4. progress 正确进入 ViewModel。
5. success 后才选择主题和写存档。
6. fail 后旧主题和存档不变。
7. 失败后再次点击会重试。
8. 同主题重复点击只发生一次底层下载。
9. 快速点击两个主题时最后请求获胜。
10. 分包成功后 Renderer 清理旧失败缓存并读取 sprite sheet。
11. classic 不调用分包 API。
12. 保存为非经典主题时，启动异步恢复且不阻塞首帧。
13. 分包失败时玩法仍可进入。

### 15.3 `tests/project-config.test.js`

断言：

- `game.json` 恰好有十个主题分包。
- package name 和 root 唯一。
- root 全部存在、互不嵌套且以 `/` 结尾。
- 每个 root 下存在 `game.js`。
- 每个 root 下存在对应正式精灵表。
- `src/config/subpackages.js` 与 `game.json` 一致。
- 每个主题 ID 映射到正确 root。
- 正式主题目录没有被 ignore。
- 本地主题草稿路径仍被排除，仓库中不提交历史草稿。
- Portal 图标未被排除。

### 15.4 `tests/package-budget.test.js`

调用预算脚本导出的纯函数，断言：

```text
main <= 3.2 MiB
each subpackage <= 3.5 MiB
total <= 18 MiB
```

### 15.5 `tests/run.js`

注册新增测试：

```js
['subpackage service',
  require('./subpackage-service.test.js')],
['package budget',
  require('./package-budget.test.js')],
```

---

## 16. 实施顺序

每个阶段完成后都必须运行全量测试，不要一次性重写所有文件。

### 阶段 A：配置和平台基础设施

新增/修改：

```text
src/config/subpackages.js
src/services/subpackage-service.js
src/platform/wechat.js
src/bootstrap.js
tests/subpackage-service.test.js
tests/run.js
```

验收：Service 的状态机、并发去重、进度和重试通过测试；尚未启用 `game.json` 分包时，现有玩法不受影响。

### 阶段 B：主题选择和 Renderer 门控

修改：

```text
src/app.js
src/ui/canvas-renderer.js
tests/theme-system.test.js
```

验收：未加载资源不触发 `createImage()`；成功后才选择并保存；失败和竞态行为符合本文档。

### 阶段 C：正式声明十个分包

新增/修改：

```text
game.json
assets/skins/*/game.js
project.config.json
tests/project-config.test.js
```

验收：主包不再包含十张完整精灵表；每个主题只请求自己的分包。

### 阶段 D：包体门禁和文档

新增/修改：

```text
scripts/check-package-budget.js
tests/package-budget.test.js
README.md
docs/theme-system.md
```

验收：本地可输出每个包的字节数；超预算时测试失败；主题系统文档不再声称“点击立即应用”而忽略下载过程。

---

## 17. 自动验证命令

```bash
node tests/run.js
node scripts/validate-theme-assets.js assets/skins
node scripts/check-package-budget.js
git diff --check
```

如果现有校验脚本实际不接收路径参数，按其当前 CLI 契约调用，不要为本任务无关地重写参数协议。

---

## 18. 微信开发者工具验收

必须在“详情 / 本地代码 / 代码包分析”中确认：

```text
实际主包 < 4M
项目目标主包 <= 3.2 MiB
每个主题分包 < 4M
总包低于当前开发者工具和后台显示的上限
```

主包依赖分析中不得出现：

```text
assets/skins/gem/gem-sprite-sheet.png
assets/skins/animals/animal-sprite-sheet.png
assets/skins/fruits/fruit-sprite-sheet.png
assets/skins/desserts/dessert-sprite-sheet.png
assets/skins/space/space-sprite-sheet.png
assets/skins/ocean/ocean-sprite-sheet.png
assets/skins/spring/spring-sprite-sheet.png
assets/skins/festival/festival-sprite-sheet.png
assets/skins/music/music-sprite-sheet.png
assets/skins/vehicles/vehicle-sprite-sheet.png
```

---

## 19. 功能验收矩阵

| 场景 | 预期 |
| --- | --- |
| 首次启动，classic | 不请求主题分包，游戏立即可用 |
| 进入普通关卡 | 完整可玩 |
| 进入主题画廊 | 未下载主题显示主包 PNG-8 四格小图，不访问其 sprite sheet |
| 点击未下载主题 | 旧主题继续生效，卡片显示下载进度 |
| 下载成功 | 新主题生效并写入 `settings.skinId` |
| 下载失败 | 旧主题和存档不变，显示可重试状态 |
| 再次点击失败主题 | 重新发起底层请求 |
| 同一主题连续点击 | 仅一次底层请求 |
| 快速点击多个主题 | 只有最后一次点击允许提交 |
| 保存主题后重启 | 首帧不阻塞，随后加载对应分包并恢复图片 |
| 加载中切后台再回来 | 不重复提交，不发生旧回调覆盖 |
| 分包 API 不可用 | 经典主题和玩法继续，主题显示失败而不是假成功 |
| PNG 解码失败 | Renderer 使用颜色回退，不阻断玩法 |

---

## 20. 真机测试

至少覆盖：

- Android 微信当前稳定版。
- iOS 微信当前稳定版。
- 首次安装 + Wi-Fi。
- 首次安装 + 移动网络。
- 首次安装 + 断网。
- 弱网/限速。
- 下载中切后台再回前台。
- 下载失败后重试。
- 已加载分包的二次启动缓存表现。
- 清理微信缓存后重新进入。
- 连续快速点击三个主题。

Node 测试不能替代真机的分包下载和 Canvas 图片加载验收。

---

## 21. 第二级优化：BGM 独立分包

该阶段不与首轮主题拆分混写。启动条件可以是开发者工具显示主包高于预算、缺乏后续增长空间，
也可以是用户明确接受首次音乐延迟以改善首包下载。2026-09-09 已按后一条件实施：

```text
assets/audio/cleared-bgm.m4a
  -> assets/audio/bgm/cleared-bgm.m4a

新增：
assets/audio/bgm/game.js

game.json：
新增 audio-bgm 分包

修改：
src/config/audio.js
src/services/audio-service.js
tests/audio-service.test.js
```

BGM 兜底必须满足：

- 短音效仍留在主包。
- 首次用户交互后才加载 BGM 分包。
- 分包失败不影响游戏和短音效。
- 关闭再开启声音允许重试。
- 后台与系统音频中断是独立挂起原因；只解除一个原因不得恢复播放。
- hide/dispose 后异步回调不得开始播放，回到前台且条件重新满足时恢复原播放意图。
- 不持久化分包就绪状态，宿主清缓存后由下一进程重新确认。

原曲未重编码，短音效仍在主包。首次加载、离线失败、前后台、中断、快速开关和清缓存后的真机行为仍须按第 20 节验收。

---

## 22. 完成定义

以下条件全部满足才算完成：

1. 十套正式主题精灵表全部从主包移出。
2. 主包在微信开发者工具中实际小于 4M，并尽量不超过 3.2 MiB 项目预算。
3. 未加载主题不会触发图片读取。
4. 分包成功后才选择并保存新主题。
5. 失败、重试和快速切换竞态有自动测试。
6. 经典主题和完整玩法在离线状态可用。
7. 全量 Node 测试、主题素材校验、包体预算和 `git diff --check` 全部通过。
8. Android 和 iOS 真机完成基础验收。
9. 没有修改本文档列出的禁止范围。
10. 最终提交说明包含开发者工具实际主包、各分包和总包尺寸，而不是只给源码估算。


## 23. 首轮实施验收记录（2026-09-03）

十个普通分包已落地；App 编排最后有效请求的异步提交，SubpackageService 管理进程内的
idle/loading/loaded/failed 状态、进度、共享 Promise 和重试，Renderer 按完整路径门控资源并清理缓存。
选择成功后才写 settings.skinId；下载失败保留旧主题，已保存主题在启动时使用自身颜色回退。
BGM 二级兜底未触发，音频、PNG、主题注册、玩法和存档协议均未改动。

本次实现文件为第 5.1、5.2 节列出的全部 26 个文件，另更新本文件的实施状态和验收记录，合计 27 个。
没有额外修改测试辅助文件或禁止范围。方案分支先合入当前 main；相对 main 的玩法、数据、主题 manifest、音频和 PNG 差异为空。
Git HTTPS 拉取因本机未配置凭据失败；已通过已连接的 GitHub API 核对远端 main 和方案分支 SHA，均与本地缓存一致。

自动验证：

- 阶段 A、B、C 均通过当时的 35 组全量测试；阶段 D 最终 36 组测试全部通过。
- node tests/run.js：通过，新增两组测试均已注册。
- node scripts/validate-theme-assets.js：正式十张图全部通过（2000×800、10 槽、24px 安全边）。
- node scripts/validate-theme-assets.js assets/skins：当前扫描仓库内正式主题素材；历史动物草稿已在后续结构清理中删除。
- node scripts/check-package-budget.js：全部预算通过，超限/非法配置的非零退出码有回归覆盖。
- git diff --check：通过。
- 阶段 B 曾遇到原有 Portal 提示测试中两次 getViewState 的 elapsedMs 相差 1ms；未修改无关测试，复查与最终测试通过。

下表将 Node 源码统计和开发者工具的本地代码分析分开记录。后者使用微信开发者工具 Stable
2.02.2608060 的“详情 -> 本地代码 -> 代码依赖分析”导出；界面显示主包 2.80MB、总包 15.48MB，
导出文件共 98 个。十张正式精灵表的 subPackage 字段均指向对应 root，不在主包内。

| 包 | Node 源码 bytes | Node MiB | 开发者工具本地分析 bytes |
| --- | ---: | ---: | ---: |
| main | 2,978,650 | 2.841 | 2,939,726 |
| theme-gem | 1,169,894 | 1.116 | 1,169,894 |
| theme-animals | 1,460,362 | 1.393 | 1,460,362 |
| theme-fruits | 1,213,863 | 1.158 | 1,213,863 |
| theme-desserts | 1,459,772 | 1.392 | 1,459,772 |
| theme-space | 1,283,515 | 1.224 | 1,283,515 |
| theme-ocean | 1,413,135 | 1.348 | 1,413,135 |
| theme-spring | 1,193,694 | 1.138 | 1,193,694 |
| theme-festival | 1,521,728 | 1.451 | 1,521,728 |
| theme-music | 1,227,359 | 1.171 | 1,227,359 |
| theme-vehicles | 1,347,618 | 1.285 | 1,347,618 |
| total | 16,269,590 | 15.516 | 16,230,666 |

Node 遍历当前发布目录共 101 个文件，保守计入开发者工具另行处理的文件；两套统计不是相同口径。
开发者工具本地分析满足主包 3.2 MiB 和各分包 4 MiB 门槛，但仍不等同于微信后台真实上传结果。

已在开发者工具执行编译并显示首页。模拟器内完整主题触摸切换、Android/iOS 真机、真实下载进度、
断网/弱网、后台恢复、清缓存后二次启动、实际上传与后台当前总包上限尚未验收。
提交审核前按“详情 -> 本地代码 -> 代码包分析”复核，随后完成第 19、20 节设备矩阵。

## 24. 主包 PNG-8 回廊预览补充（2026-09-03）

按用户确认接入 128×128 / 128 色 PNG-8：新增十张主包主题四格小图，压缩两张既有特效预览；
每张不超过 8 KiB，十二张合计 `77,347 bytes`（约 75.53 KiB）。未下载主题分包时即可显示真实预览；
主题下载事务、正式精灵表和分包配置不变。特效原图保存在已排除发布的 scripts 目录。

严格文件白名单、三处预览方法的修改边界、生成命令与完整验收记录见
[`corridor-preview-assets.md`](corridor-preview-assets.md)。第 5 节的禁止范围仅针对此前首轮分包实施。

本次主包源码 `2,611,952 bytes / 2.491 MiB`，较第 23 节减少 `366,698 bytes`；
总包源码 `15,902,892 bytes / 15.166 MiB`。开发者工具 Stable 2.02.2608060 本地分析界面显示
主包约 2.45MB、总包约 15.13MB，主包包含 theme-previews，十张正式图仍属于对应分包。
这不是后台实际上传报告，不能替代真机与真实网络状态验收。

37 组测试、预览生成一致性、十二张 PNG-8 合同、十张正式图合同、包体预算与代码边界核对通过。
开发者工具编译及本地包体分析已执行；模拟器逐项画廊触控/真实下载矩阵、Android/iOS 与上传审核仍待验收。

## 25. 主包元数据、Portal 与 BGM 优化记录（2026-09-09）

本轮在 `main@5010d7ce067bf0f412cd28dba452218c3b95bf26` 的用户现有工作区上实施，未修改玩法、关卡、
存档、CloudBase、主题 manifest、触控或发布账号配置。

- `project.config.json` 增加 `.DS_Store`、`assets/.DS_Store`、`src/.DS_Store` 三条精确 file 排除规则；
  源码估算不再计入 38,924 bytes。开发者工具是否原本已经隐式排除这些文件仍待包分析确认。
- Portal 图标保持 512×512、8-bit RGBA、sRGB 与解码 RGBA 像素完全一致，只重排 PNG 过滤与压缩编码；
  从 222,288 bytes 降至 180,936 bytes，减少 41,352 bytes。
- `cleared-bgm.m4a` 以相同 SHA-256
  `aaa61ddad38bb2cc493f224937932dfe8ad31db396ec89877a9ef44b728754da` 移入 `audio-bgm`；没有重编码、裁短或复制主包原件。
- 音频服务只在声音开启、已发生用户交互、无挂起且未销毁时请求 BGM；共享下载、失败后的 off→on 显式重试、
  晚回调失效、后台／中断双原因、context 错误及失败短音效 context 释放均有回归覆盖。五个短音效路径不变。
- 主包项目门禁由 3.2 MiB 收紧到 1.6 MiB；各普通分包 3.5 MiB、总包 18 MiB 与严格小于 4 MiB 的检查不变。

当前 Node 源码统计：main `1,425,033 bytes / 1.359 MiB`，`audio-bgm` `1,682,171 bytes / 1.604 MiB`，
total `16,398,144 bytes / 15.638 MiB`。相对开工基线，主包减少 1,756,322 bytes（约 55.2%），
总包减少 74,151 bytes。修改后 97 组全量测试、正式主题素材、画廊预览、预算与 diff 检查均通过。
微信开发者工具 Stable 2.02.2608060 普通编译通过并显示首页；本地代码依赖分析显示代码总体积
`15.64MB`、153 个文件，main `1.36MB`、`assets/audio/bgm/` `1.60MB`，十个主题仍归各自分包。
控制台没有项目错误，唯一警告是基础库的 HarmonyOS 兼容提示。界面值经过舍入，不是后台上传精确字节；
模拟器/设备音频、Portal 深浅主题截图、弱网、上传、提审和发布均未执行。

依次消除、逐格声音时序与账号／云偏好兼容只增加轻量代码，不增加声音素材、贴图或分包。此次主包预算由 1.61 调整到 1.62 MiB，给已验证的设置与时序代码留出空间；单分包和总包门禁保持不变。后续账号页音量滑条沿用现有素材，主包门禁为 1.63 MiB。
