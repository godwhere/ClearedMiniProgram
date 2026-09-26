# P5-F iOS 设备展示与隐私入口建议（待取值、待批准）

> 2026-09-27 施工前基线：C `07df60254ec5d778ed29077d5d35e0c5602b1e9e`、H `a1ecca8716f7f376068dc5a9c6a746078d812cb1`，两仓干净。本文只冻结技术建议与候选逐文件清单；设备范围、公开地址及代码施工仍待明确回复。P5-E 的 StoreKit 白名单独立待批，Android 新增工作暂停，不刷新 `shared-source.lock.json`。

## 已核实入口与待定值

- 共享 `src/app.js` 的 `account:privacy` 只在账号场景响应用户点击，调用平台 `openPrivacyContract()`，失败时显示 `privacy-open-failed`；H `NativePlatform` 当前继承 `CanvasPlatform` 恒定的 `not-supported`。正式 `native-web` 扫描禁止 HTTP(S) 字面量，因此不能把任意政策 URL 塞入共享 Canvas 或 Web bundle。Apple 要求政策链接在 App 内易于访问，App Store Connect 另需政策 URL。[App Review 5.1.1](https://developer.apple.com/app-store/review/guidelines/)、[App Privacy 字段](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)。
- H 的 Debug 和无签名 Release 模拟器包都声明 `UIDeviceFamily=[1,2]`，iPhone／iPad 均允许横屏；这与既定首版固定竖屏不符。**建议首发仅面向 iPhone**，把 App target 的 `TARGETED_DEVICE_FAMILY` 收为 `1`，iPhone 方向只保留 Portrait。该设备范围仍待用户冻结；iPhone 专用 App 仍可能在 iPad 兼容模式运行，所以要做最小 iPad 兼容检查，不能宣称完全排除 iPad。若要正式支持 iPad，须另定可变窗口、旋转、Canvas 尺寸／安全区和视觉触控矩阵，不能只改方向数组。Apple 已弃用 iPad 的全屏兼容路径。[Xcode 设备族设置](https://developer.apple.com/documentation/xcode/build-settings-reference)、[App Review 设备兼容说明](https://developer.apple.com/forums/topics/app-store-distribution-and-marketing/app-store-distribution-and-marketing-app-review)、[iPad 窗口迁移](https://developer.apple.com/documentation/technotes/tn3192-migrating-your-app-from-the-deprecated-uirequiresfullscreen-key)。
- 实际、可公开访问的 HTTPS 隐私政策 URL 和支持 URL 均未给出；支持页须有可用联系信息。[Apple 支持 URL 字段](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)。不生成占位地址、不自动填写 App Privacy。H 已有 `LaunchScreen.storyboard` 配置，但图标／启动图仍是 Capacitor 模板；素材权属与视觉交付另按 [许可静态清单](p5-ios-asset-rights-audit.md) 签收。[iOS 27 启动画面条件](https://developer.apple.com/documentation/technotes/tn3208-preparing-your-apps-launch-screen-to-meet-app-store-requirements)。

## 建议先实施的 F1 合同

在设备范围与政策 URL 均明确、并另获下表批准后，H 原生侧固定唯一政策地址：从 App 自身 `Info.plist` 读取精确 HTTPS URL，只允许预定 host／path，原生插件只暴露 `openPrivacy()`，不接受 JS 传来的 URL。`NativePlatform.openPrivacyContract()` 仅转发用户点击并把系统打开结果映射为 `{ok}`；缺插件、无效地址、系统拒绝或抛错都失败关闭并沿现有共享反馈路径提示。启动、回前台和商店操作不得自动打开页面；H Web bundle 继续不含远端 URL，`scripts/scan-bundle.js` 不放宽远程脚本／地址禁令。系统“接受打开”不等于页面能联网加载，实际可达性另验。

若获批 iPhone 首发，Debug／Release 的 App target 同步设 `TARGETED_DEVICE_FAMILY=1`，`Info.plist` iPhone 方向只留 Portrait，并清理不再适用的 iPad 方向声明。iOS 15.0、Bundle ID、普通存档、商业缓存、`full_game_v1` 与六关白名单不变；`nativeCopyEligible:false` 仍由原双端出口控制。F1 不处理 App 图标、启动图、商店表单或发行签名。

### F1 候选逐文件白名单

这是**待批准**的精确路径，不以目录前缀授权。施工前重新核对两仓状态、分支、差异与实际调用链；表外文件先补审。

| 仓库 | 精确路径 | 必要改动 |
| --- | --- | --- |
| C | `README.md` | App 隐私入口与设备范围的用户可见状态 |
| C | `docs/app-portability-plan.md` | 阶段、V27 边界与证据 |
| C | `docs/p5-f-ios-presentation-privacy-scope-proposal.md` | 冻结取值与执行结果 |
| H | `README.md` | iOS 调试与手动验收说明 |
| H | `docs/p5-host-contract.md` | 原生政策打开、设备范围与证据 |
| H | `p5-scope-lock.json` | P5-F1 精确授权、设备与政策地址摘要 |
| H | `scripts/verify-p5-scope.js` | 阶段锁和文件白名单 |
| H | `scripts/scan-bundle.js` | 继续拒绝 Web URL，并核对指定 `.app` 的设备／方向及政策配置 |
| H | `src/native-main.js` | 向平台注入原生政策插件 |
| H | `src/native-platform.js` | 消费原生打开结果及失败关闭 |
| H | `tests/native-platform.test.js`（新增） | 缺插件、无效响应、失败和仅主动点击的 JS 合同 |
| H | `tests/native-web-smoke.js` | Canvas 隐私按钮实际点击与失败反馈的浏览器证据 |
| H | `tests/p5-host-contract.test.js` | 配置、锁和产物边界 |
| H | `tests/run.js` | 聚合新增测试 |
| H | `ios/App/App/Info.plist` | 固定政策 URL、iPhone 竖屏方向 |
| H | `ios/App/App.xcodeproj/project.pbxproj` | 设备族、原生插件及 XCTest 文件注册 |
| H | `ios/App/App/ClearedStorageBridgeViewController.swift` | 注册独立政策插件 |
| H | `ios/App/App/ClearedPolicyLinkPlugin.swift`（新增） | 仅打开固定 HTTPS 政策地址，不接受任意 JS URL |
| H | `ios/App/AppTests/ClearedPolicyLinkPluginTests.swift`（新增） | URL 校验、拒绝与系统打开结果映射 |

## 验证矩阵与停工点

| 层级 | F1 应取得的证据 | 不能据此宣称 |
| --- | --- | --- |
| 静态／Node | URL 必须为冻结 HTTPS host／path，JS 无任意打开参数；错误插件／结果失败关闭；共享 action、Web 禁远端、锁与精确文件清单保持。C 跑 `node tests/run.js`、包预算、rollout、`git diff --check`；H 开发中 `pnpm preflight`，提交后两仓干净运行 `pnpm verify` | 政策网站实际可达或 Apple 表单正确 |
| 浏览器 | Canvas 隐私按钮点击才调用合成插件；成功／失败反馈与场景代次正确；加载时无外部请求 | iOS 系统打开成功 |
| iOS 模拟器 | Xcode Debug／无签名 Release 构建，实际 `.app` 核对 `UIDeviceFamily`、方向与政策配置；iPhone 竖屏旋转、刘海安全区、点击后打开及失败反馈；即使只面向 iPhone，也在 iPad 兼容模式抽查启动、Canvas 尺寸和触控 | iOS 15 运行、真机或审核 |
| 真机／商店 | 最低系统、辅助功能、政策页在线／离线与回 App、最终设备包、App Privacy、支持 URL 和素材权利分别签收 | 当前未授权的账号、发行签名、上传或发布 |

设备范围或真实政策 URL 尚未冻结、地址无法安全验证、必须把远端 URL／脚本放入共享 bundle、需要修改表外文件，或 iPad 仍列为目标但缺窗口矩阵时，停止 F1 代码。P5-E StoreKit、图标／启动图替换、素材许可、App Store Connect、沙盒、真机安装、发行签名、上传、送审和发布均不包含在本白名单。

后续视觉素材须另行逐项批准，候选原生路径为 `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`、`ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`、`ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`、`ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png`、`ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png`、`ios/App/App/Assets.xcassets/Splash.imageset/Contents.json` 与 `ios/App/App/Base.lproj/LaunchScreen.storyboard`。这份清单**未授权**任何素材改动；若复用 C 素材，先证明来源与 App 分发权，并单独审查共享锁。
