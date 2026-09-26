# P5 iOS 素材与第三方许可静态清单（未签收）

> 2026-09-27 审计基线：C `fda21454875d4808f0d63309747172a3f19ab4ee`、H `0e291d28d7532d0776d01c85d257633855ea8e7c`，两仓干净。H 在干净工作区执行 `pnpm verify` 通过；`shared-source.lock.json` 仍锁定 C `0b53ad6bab9845e855f136b61a3a707817bf0472`。这是 V27 的发布前静态盘点，不是法律权属、真机或商店验收，也不授权替换素材、刷新共享锁或发布。

## 当前载荷与证据

H 的 `p5-scope-lock.json` 精确列出 `dist/native-web/` 的 33 个文件：`game.js`、`index.html`、`styles.css` 和下列 **30 个素材文件**，素材合计 **15,301,202 bytes**。干净构建生成的 `dist/native-meta/payload-manifest.json` 记录每个文件的字节数与 SHA-256；`scripts/scan-bundle.js` 校验文件清单和哈希。路径与哈希证明进入候选包的字节，不能证明创作归属或 iOS／App Store 分发许可。

**音频：6 个。** BGM 曾按相同 SHA-256 从主包路径搬到 `audio-bgm`；搬移、压缩与试听记录不构成许可证明。

```text
assets/audio/bgm/cleared-bgm.m4a
assets/audio/path-complete.m4a
assets/audio/path-error.m4a
assets/audio/path-step.m4a
assets/audio/ui-click.m4a
assets/audio/victory-shimmer.m4a
```

**正式主题精灵表：10 个。** `docs/theme-system.md` 记录旧图集的主体提取、归一化和槽位验收；仍需追溯旧图集的来源及改作、移动端 App 分发权。

```text
assets/skins/animals/animal-sprite-sheet.png
assets/skins/desserts/dessert-sprite-sheet.png
assets/skins/festival/festival-sprite-sheet.png
assets/skins/fruits/fruit-sprite-sheet.png
assets/skins/gem/gem-sprite-sheet.png
assets/skins/music/music-sprite-sheet.png
assets/skins/ocean/ocean-sprite-sheet.png
assets/skins/space/space-sprite-sheet.png
assets/skins/spring/spring-sprite-sheet.png
assets/skins/vehicles/vehicle-sprite-sheet.png
```

**主题预览：10 个。** `scripts/generate-gallery-previews.py` 从上述同名正式精灵表生成，`--check` 可复核字节一致性；预览继承原图所需的权利证明。

```text
assets/theme-previews/animals.png
assets/theme-previews/desserts.png
assets/theme-previews/festival.png
assets/theme-previews/fruits.png
assets/theme-previews/gem.png
assets/theme-previews/music.png
assets/theme-previews/ocean.png
assets/theme-previews/space.png
assets/theme-previews/spring.png
assets/theme-previews/vehicles.png
```

**其他图片：4 个。** 两张特效预览来自未入包的 `scripts/gallery-preview-sources/effects/none.png`、`fade.png`；Logo 与 Portal 图标只有仓库历史和技术用途记录，未发现可签收的 App 分发权属记录。

```text
assets/effects/fade/preview.png
assets/effects/none/preview.png
assets/icons/portal.png
assets/logo.png
```

## WebView 以外的发布载荷

- iOS `AppIcon.appiconset` 含 1 张 1024×1024 图，`Splash.imageset` 含 3 张相同 SHA-256 的 2732×2732 图，当前仍是 Capacitor 模板外观。它们不在上述 30 个共享素材内；正式图案及其来源、许可和视觉验收未定。
- `src/i18n/locales/zh-CN.js` 与 `en-US.js` 的文案编入 `game.js`；30 个素材中没有字体文件。正式发布前仍须确认双语文案来源、第三方字体是否实际随最终包分发，以及相应权利。
- H 的 `ios/App/CapApp-SPM/Package.swift` 和 `Package.resolved` 将 `capacitor-swift-pm` 固定在 8.5.2／`0b6882e9a3288342aacf36348e5a94e4f1dd7b13`，原生依赖包含 Capacitor 与 Cordova；本机 `@capacitor/core`、`@capacitor/ios` 的 `LICENSE` 均为 MIT。`dist/native-meta/bundle-meta.json` 的 90 个 JS 输入没有 `node_modules` 路径，但这不能排除原生包中的第三方代码。正式候选需核对实际嵌入框架、许可文本和所需声明；H 构建设置 `legalComments:'none'`，不能把 bundle 中没有注释当成已满足许可通知。

## V27 签收条件

1. 对上面每个精确素材路径，保存原始作者／供应方、原始素材标识、获取方式、适用许可或合同、是否允许改作及 iOS／App Store 分发、所需署名和可核验的授权文件。派生预览同时关联源精灵表；Git 提交或哈希只证明版本，不自动证明权利。
2. 对正式图标／启动图、双语文案、最终内嵌原生依赖和可能新增的字体，按最终安装包补齐同一清单及许可通知。未核实的项目保持“待补证”，不能填“已授权”。
3. 如素材必须替换，由 C 作为唯一共享源码来源修改并重生成受影响预览；逐项审查产品合同、catalog、包体与共享锁差异后另行批准锁更新。H 不直接改生成的共享副本。

此清单只推进 V27 的输入盘点。缺少权利文件或发布包实际第三方清单时，V27 仍未通过；P5-E StoreKit 白名单、`nativeCopyEligible:false`、真机／商店／发布边界均不因本审计改变。
