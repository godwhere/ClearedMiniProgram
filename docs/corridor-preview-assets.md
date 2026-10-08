# 回廊主包预览图：128×128 PNG-8 接入方案与修改边界

> 用户确认：2026-09-03，采用对比图中的 `PNG8 128 / 128c`。  
> 实施基线：`69659a8d82bd`；开始时工作区无未提交改动。  
> 状态：已接入；37 组自动测试、离线 Canvas 渲染、开发者工具编译与本地包体分析通过。设备与网络验收待补，详见第 8 节。

## 1. 交付结果

玩家从首页进入“回廊 → 主题”，无需先下载主题分包，即可看到当前页各主题的四个图标。
点击主题后仍使用既有下载进度、失败重试和成功后才切换/保存的流程。预览在下载中、下载失败后继续显示。

本次统一所有现有回廊位图预览：十个非经典主题，以及“无特效”“逐渐消失”两张特效预览。

2026-10-08 新增的星光、泡泡、花瓣、冰晶使用 Canvas 静态形状预览，manifest 不声明 `preview`，不新增 PNG 输出或源图；下文位图生成和校验仍只覆盖有 `preview` 的条目。新效果的绘制与数量上限见 [消除特效](corridor-and-clear-effects.md)。
经典主题和回廊“主题／特效／音乐”入口由 Canvas 绘制。默认曲目仍用矢量音符；《漫步》曲目卡片和解锁弹窗使用主包 `assets/music-previews/candy-day-stroll.png`，不提前读取音频分包，图片失败回退矢量音符。音乐预览也由 `validate-gallery-previews.js` 校验尺寸、透明 PNG-8、颜色、体积和主包归属，见 [音乐系统](music-system.md)。
以后回廊增加位图预览时，暂按本文同一规格生产和验收；不为未来栏目预先增加注册器、场景或加载系统。

## 2. 素材合同

| 项目 | 固定要求 |
| --- | --- |
| 文件 | `.png`，PNG-8 索引色，IHDR `colorType=3`、`bitDepth=8` |
| 尺寸 | 整张严格为 `128×128` 像素；不是每个图标 128 像素 |
| 颜色 | 实际使用的 RGBA 颜色不超过 128 种，含透明色；保留半透明边缘 |
| 单张体积 | 不超过 `8 KiB`；超限时报错，不能静默减到 96 像素、64 色或更换格式 |
| 主题图内容 | 正式精灵表逻辑槽 `0、1、2、3`，按行优先组成 `2×2`；每格 `64×64` |
| 主题图安全边 | 每个 64 像素格四边至少 2 像素不出现可见 alpha（阈值 8），四槽均非空 |
| 特效图内容 | 原图等比缩入 128×128，透明居中补边，不拉伸、不裁掉原构图 |
| 图片职责 | 只包含美术；主题底砖、卡片背景、名称、状态与选中框由现有 Canvas 绘制 |
| 路径 | 主题：`assets/theme-previews/<id>.png`；特效：`assets/effects/<id>/preview.png`；音乐：`assets/music-previews/<id>.png` |
| 包归属 | 全部预览位于主包，必须不被 `packOptions.ignore` 排除；正式棋盘精灵表仍在原分包 |

PNG-8 是当前 PNG 加载链可直接消费的格式。本次不增加运行时解码器，也不引入 WebP/AVIF。
前两轮讨论的 96×96 规格与 256×256 建议均由本次确认覆盖。

## 3. 数据与渲染接入

主题 manifest 仅新增顶层路径，例如：

```js
preview: 'assets/theme-previews/gem.png'
```

复用 `SkinService.list()` 已有的 `preview` 透传，不把小图放进 `assets.tileSheet`，不增加新服务或 App 状态。

主题卡片按以下优先级绘制：

1. 主包预览加载成功且尺寸为 128×128：使用小图四个 64×64 槽位。
2. 小图缺失、解码失败、尺寸不符或尚未就绪：仅在正式精灵表已就绪时沿用原四元素绘制。
3. 正式精灵表也未就绪：沿用主题颜色回退。

预览使用临时、仅用于本次绘制的 `2×2 / count=4` 配置，通过现有 `drawTile()` 保留底砖、缩放和间距。
不能修改已注册 manifest 的 `5×2 / count=10` 配置，也不能把预览图片写入棋盘的 `images.tileSheet`。

图片请求只由当前可见页发起，复用 `ensurePreviewImage()` 的按主题/路径缓存与请求 token。
失败应缓存，不能每帧重试；旧路径请求晚到不能覆盖新路径结果。
分包下载或主题选择只清理正式素材缓存，不清空独立的主包预览缓存，避免卡片闪回色块。
图片路径变化仍由预览缓存自身识别。拒绝把网络 URL/data URI 当作预览请求。

特效页继续通过原有加载器和 `contain` 绘制，仅替换图片文件；保留场景 generation 和按效果区分的矢量回退。
下载提示文案、点击区域、分页和安全区布局均沿用现状。

## 4. 严格代码修改边界

### 4.1 运行时代码白名单（11 个文件）

| 文件 | 唯一允许改动 |
| --- | --- |
| `src/skins/gem.js` | 新增顶层 `preview` 字符串 |
| `src/skins/animals.js` | 同上 |
| `src/skins/fruits.js` | 同上 |
| `src/skins/desserts.js` | 同上 |
| `src/skins/space.js` | 同上 |
| `src/skins/ocean.js` | 同上 |
| `src/skins/spring.js` | 同上 |
| `src/skins/festival.js` | 同上 |
| `src/skins/music.js` | 同上 |
| `src/skins/vehicles.js` | 同上 |
| `src/ui/canvas-renderer.js` | 仅限下列函数与相邻预览注释 |

Renderer 内允许修改：

- constructor 中预览缓存的说明注释；
- `ensurePreviewImage()`：本地路径检查、同步加载结果与失败/请求缓存收尾；
- `invalidateThemeAssets()`：保留主包预览缓存，维持正式图片失效逻辑；
- `drawThemeElementsPreview()`：选择预览资源与临时 2×2 配置；
- `loadSkinAssets()`、`drawThemes()`：只更新已过期注释。

不得修改 Renderer 的 `drawTile()`、棋盘绘制、特效动画、场景分派、卡片尺寸、命中 ID 或分页逻辑。
不允许以顺手整理为由重命名方法、清理其他缓存或抽出新的通用 gallery 框架。

### 4.2 素材、离线工具、测试与文档白名单

| 范围 | 允许的文件与用途 |
| --- | --- |
| 主题输出（10 张） | `assets/theme-previews/{gem,animals,fruits,desserts,space,ocean,spring,festival,music,vehicles}.png` |
| 特效输出（2 张） | `assets/effects/none/preview.png`、`assets/effects/fade/preview.png` |
| 特效源图（2 张） | `scripts/gallery-preview-sources/effects/none.png`、`scripts/gallery-preview-sources/effects/fade.png`，逐字节保存替换前原图；现有 scripts 排除规则使其不入包 |
| 生成工具 | `scripts/generate-gallery-previews.py`：从现有 manifest 枚举资源，裁切、等比缩放、减色、写入及 `--check` |
| 验收工具 | `scripts/validate-gallery-previews.js`：复用既有 PNG 解码器，检查本文素材合同与包归属 |
| 测试 | `tests/theme-system.test.js`、`tests/clear-effect-system.test.js`、`tests/gallery-preview-assets.test.js`、`tests/package-budget.test.js` |
| 测试聚合 | `tests/run.js`：仅新增 gallery preview assets 测试注册 |
| 文档 | 本文、`README.md`、`docs/theme-system.md`、`docs/corridor-and-clear-effects.md`、`docs/package-splitting.md` |

### 4.3 禁止修改

- `core/**`、`data/**`、`src/gameplay/**`、`src/mechanics/**`、`src/ui/board/**`；
- `src/app.js`、`src/bootstrap.js`、`src/platform/**`、`src/services/**`；
- `src/skins/classic.js`、`src/skins/index.js` 和所有现有主题字段（新增 preview 除外）；
- `src/effects/**` 的 ID、类型、时长、参数、顺序与路径；
- `assets/skins/**` 内任何正式精灵表、旧稿或分包入口；
- 音频、Logo、Portal 图标、旧小程序目录；
- `game.json`、`project.config.json`、`src/config/subpackages.js`、发布流程与现有包体阈值；
- `scripts/validate-theme-assets.js` 的正式精灵表合同和与本任务无关的测试。

上述范围只约束本次交付。后续新增主题仍按既有主题/分包注册流程操作，不能把本次白名单当成允许任意扩张的入口。
如发现必须跨出边界，先记录具体必要性并使边界变更可审阅，不能为通过测试而放宽合同或修改玩法。

## 5. 可重复生成与新增素材流程

生成工具为离线美术工具，依赖 Node.js（读取已有 CommonJS manifest）和 Python/Pillow；不进入小游戏运行时，不增加 npm 运行依赖或常规构建步骤。
本批使用 Pillow 12.3.0。主题直接读取正式精灵表，特效从 `scripts/gallery-preview-sources/effects/<id>.png` 读取保留的源图。

```sh
python3 -m pip install Pillow==12.3.0
python3 scripts/generate-gallery-previews.py
python3 scripts/generate-gallery-previews.py --check
node scripts/validate-gallery-previews.js
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

生成前先验证全部输入和输出路径。生成结果全部通过尺寸/颜色/单张预算检查后才写入目标，使用同目录临时文件替换，避免中途错误留下半张图片。
`--check` 重新生成并比对现有输出，不写文件；源图变化而小图未同步时失败。

新增主题时，在其原有 manifest 声明 `preview`，再运行上述生成和检查。工具从 `src/skins/index.js` 枚举，不能维护另一份主题 ID 清单。
新增有图特效时，提供对应源图并沿用现有 manifest 的 `preview` 路径，再执行同一流程。
图片不存在、路径进入分包、被排除、尺寸/颜色/体积违规均应在自动验收中失败。

## 6. 包体与扩展边界

实施前主包源码统计为 `2,978,650 bytes / 2.841 MiB`。两张旧特效图合计 `445,684 bytes`。
试压后两张特效图约 9 KiB；十套主题 128/128c 预览约 66 KiB。预计本次整体缩小主包，最终以第 8 节实测为准。

每张图不超过 8 KiB，主包继续遵守现有 3.2 MiB 预算；不额外设固定主题数量上限。
以后达到单张或主包预算时，先检查无关大资源和素材构图，再单独评估资源策略；不能自动更改用户批准的 128/128c 规格、改用远程预览或预下载全部主题。

## 7. 验收清单

自动验收必须覆盖：

1. 经典冷启动/直接游玩不请求画廊预览；进入主题页只加载可见页小图。
2. 所有主题分包未就绪时，两页仍绘制真实的四格主包预览；浏览与翻页不发起分包下载。
3. 下载中、失败重试、成功切换和快速点击仍遵循既有流程；预览缓存不会被选择/下载清空。
4. 卡片四次 drawImage 分别使用 128×128 小图的 `(0,0)、(64,0)、(0,64)、(64,64)`；棋盘仍使用正式图全部 10 槽。
5. 小图失败、零/错误尺寸、同步异常和旧请求晚到均安全回退，不读取未加载分包，不每帧重试，不污染正式素材缓存。
6. 十二张位图均满足尺寸、索引色、128 色、透明度、体积、主包归属；主题四槽非空且有安全边。
7. 特效预览仍只在特效页加载，离开后的旧回调被忽略，棋盘动画不消费预览。
8. 全量测试、生成一致性、正式主题素材校验、包体检查、`git diff --check` 均通过。
9. 相对实施基线核对文件白名单；主题除新增 preview 外数据深度相等，禁止目录无差异。

微信开发者工具与设备验收：

- 编译后核实预览图在主包，十张正式精灵表在对应分包；以工具实际代码包分析复核源码估算。
- 清除主题缓存后进入两页主题画廊，断网仍有预览；点击主题下载失败时小图仍在，当前主题保持原选择。
- 检查窄屏、常见安全区、DPR 1/2、主题与特效页的清晰度、半透明边缘、2×3 排列及点击区域。
- Android/iOS 分别验证下载成功/失败、快速切换、前后台与冷启动恢复。
- Node 测试和离线截图不能代替真机验收；未完成的项目必须在交付时明确列出。

## 8. 实施与验证记录

### 8.1 实际交付与边界核对

本次共 37 个文件，均在第 4 节白名单内。运行时为 10 个 manifest 新增 `preview`，
以及 Renderer 三个预览方法的行为修改；constructor、`loadSkinAssets()`、`drawThemes()` 仅更新注释。

已相对 `69659a8d82bd` 验证：

- 十个 manifest 去掉新增 preview 后与基线深度相等；
- Renderer 其余方法逐段相等，三个仅注释区域的可执行代码相等；
- 两张特效源图与替换前的文件逐字节相等；
- 玩法、App、存档/下载服务、平台、棋盘模块、正式精灵表与分包配置均无差异。

### 8.2 实际图片与包体

| 资源 | 数量 | 实际总字节 | KiB |
| --- | ---: | ---: | ---: |
| 主题四格 PNG-8 | 10 | 68,024 | 66.43 |
| 无特效 PNG-8 | 1 | 3,828 | 3.74 |
| 逐渐消失 PNG-8 | 1 | 5,495 | 5.37 |
| 全部回廊位图预览 | 12 | 77,347 | 75.53 |

十二张均为 128×128、PNG-8、实际 128 色，单张均小于 8 KiB。主题图补足 2px 透明边，避免缩放/减色将原有极淡边缘变成可见串边。

- 主包源码：`2,978,650 → 2,611,952 bytes`，`2.841 → 2.491 MiB`，净减少 `366,698 bytes`（约 358 KiB）。
- 总包源码：`15,902,892 bytes`，约 `15.166 MiB`；十个正式主题分包大小不变。
- 开发者工具 Stable `2.02.2608060` 的本地代码依赖分析界面显示：主包约 `2.45MB`，总包约 `15.13MB`，108 个文件；主包出现 `theme-previews`，十张正式图仍在各自分包。
- Node 保守统计 111 个发布文件，与开发者工具统计口径不同；以上都不等同于微信后台实际上传结果。

### 8.3 已执行验证

- `node tests/run.js`：37 组通过；包含未下载两页预览、可见页加载、四帧裁切、正式第 10 槽、缓存/请求竞态、下载失败与安全回退。
- `python3 scripts/generate-gallery-previews.py --check`：12 张生成一致；运行时无需 Python/Pillow。
- `node scripts/validate-gallery-previews.js`：12 张规格、透明度、安全边、体积、主包归属通过。
- `node scripts/validate-theme-assets.js`：十张正式精灵表通过，未修改其内容与校验器。
- `node scripts/check-package-budget.js`：主包、分包、总包预算全部通过。
- 使用当前生产 Renderer 与真实 PNG 解码，在 `320×568 / DPR 1`、`390×844 / DPR 2` 离线绘制两页主题和特效页；图标可辨识、无串边/拉伸，未请求正式精灵表或主题下载。离线宿主字体仅用于查看布局，不替代微信系统字体验收。
- 微信开发者工具已执行编译，可显示首页与游戏棋盘，并完成上述本地包体分析。
- 文件/方法白名单、原图保留和 `git diff --check` 已核对。

### 8.4 尚未完成

模拟器逐项画廊触控/真实下载矩阵，以及 Android/iOS 真机的清缓存离线、弱网、下载重试、前后台和高 DPR 最终视觉验收，仍需按第 7 节补齐。
本次未执行实际上传或提交审核。
