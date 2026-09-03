# 结果与购买面板视觉核对（2026-09-04）

final result: passed

本结果仅指现有 CanvasRenderer 的离屏布局与截图形式核对，不等于微信开发者工具或真机验收。
本次修改现有原生小游戏，不创建网页原型、不引入浏览器／npm 运行依赖、不发布。

## 目标与证据

- Source visual truth: `/var/folders/d4/vlsfy7fd51vgb9ymqtc_zs8m0000gn/T/codex-clipboard-8677ca2e-bc5c-4e46-ac20-0482e57c5450.png`
- Full-view comparison: `/tmp/cleared-panel-qa.VZ1Zkm/comparison.png`（原附件与五种结果同图比对）。
- Narrow comparison: `/tmp/cleared-panel-qa.VZ1Zkm/narrow-comparison.png`。
- Purchase in actual gallery layout: `/tmp/cleared-panel-qa.VZ1Zkm/purchase-in-gallery.png`。
- Implementation screenshots: `/tmp/cleared-panel-qa.VZ1Zkm/{ordinary-success,ordinary-failure,daily-success,daily-failure,purchase}-{280,320,390,768}.png`。
- 原附件为 644×400；其游戏内容宽约 568px，按现有 390px 逻辑宽度的 1.456 倍对齐。
  实现原图为 280×568、320×568、390×844、768×1024，离屏密度 1；对照图仅等比放大面板，
  不把外侧灰边或截图裁剪当作游戏布局。截图中的青色仅用于关卡面板对照，购买页保留真实橙色背景。
- States: 购买确认；普通失败；每日失败；普通新纪录；每日两关完成。
  回归另覆盖购买禁用、处理中、错误、保存重试，及每日分享／增次入口与重玩禁用。
- Focused evidence: 对照图本身就是完整面板裁剪，标题、说明、图标和按钮清晰可读；
  另检查真实主题页上的购买面板，避免只用纯色背景掩盖透字问题。

## Findings 与修正历史

1. 初次离屏捕获缺少中文字体，且拼图底部被裁切，不能作为验收证据。
   仅修正临时捕获程序：加载系统 PingFang／Helvetica Neue，扩大比较画布，重新捕获。
   未修改游戏字体栈或增加字体资产。
2. [P1，已修复] 购买面板的半透明背景透出主题卡片文字，与截图中清晰的单层信息相冲突。
   在购买面板矩形内部先绘制画廊底色，再应用原 `strongPanel`；不遮盖面板外页面。
   复核 `purchase-in-gallery.png`：名称、金额和按钮不再与下层卡片叠字。
3. 修正后重新生成并查看原附件／五面板同图对照及真实画廊截图，无剩余 P0／P1／P2 布局问题。

## 五项核对

- 字体／层级：沿用游戏原字体栈、27px／300 主标题、13px／12px 辅助说明、15px 按钮。
  离屏 Skia 与微信的字体回退及抗锯齿不同，不据此替换生产字体。
  使用相同离屏环境渲染修改前后的普通成功页，RGBA 差异为 0，原截图对应的基准样式未被改写。
- 间距／布局：面板从 x=0 铺满逻辑宽度，无外框、无整体圆角；标题纵向位置为面板顶部 +92，
  主按钮高度 46，按钮行居中。每日内容更多时扩展面板高度，保留安全区与清楚的说明／按钮间距。
- 颜色：复用 `strongPanel` 和普通成功按钮的 `levelCell`，不新增主题色；购买使用画廊原底色。
- 图像／图标：复用现有成功、警告、锁图标及商品预览资源；未生成或替换任何美术素材。
- 文案／内容：保留各场景原有名称、金额、结果、剩余格数、每日次数和按钮动作；
  关卡、广告、分享条件与解锁成功通知仍保留原圆角样式。

## 验证与余项

- `node tests/run.js`：新增统一面板样式回归，连同购买原子扣费、失败重试、每日次数和模态输入现有测试一起运行。
- 样式回归断言全宽面板、面板内不透字底色、主标题规格、46px 按钮、安全区、禁用状态与非目标弹窗不变。
- 微信开发者工具编译／预览、Android／iOS 真机触摸与系统字体效果尚未执行。
- Follow-up polish: 无新增美术或视觉扩展项；下一步在微信开发者工具复核五种界面。
