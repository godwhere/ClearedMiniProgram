# P5-C 正式原生宿主与普通存档：建议白名单

> 状态：施工建议，尚未授权；审计基线 C `196f388b7090492f82dec22d0e619efb0f1da3ff`，H `3054ac9c01ac93d562091957637a4ecebc5e8007`。2026-09-26 使用 H 既有的 Capacitor 8.5.2 依赖在 `/tmp` 隔离生成 iOS／Android 工程；没有生成 H 根级原生工程或改动 H 文件。若工具链或生成模板变化，先重审本表。

## 目标与边界

P5-C 拟交付 iOS／Android 模拟器上的六关试玩调试构建和正式普通 SQLite 存档；`full_game_v1` 始终由固定未拥有、拒绝本地授权写入的“商店不可用”宿主提供者阻止，直到独立商店阶段。正式输出不得包含 P4 命名空间、浏览器 `localStorage`、假商店、P4.5 合成数据、微信／CloudBase、每日挑战、广告、分享或远程脚本。若模拟器构建需要本机调试签名，须在批准 P5-C 时一并明确其许可与证据；发行签名、上传、送审、发布、真实购买与服务器均不在本建议内。

C 的共享运行码现已有 `startAppLocalGameAsync()`，**本建议的 C 代码白名单为空**。C 文档白名单仅为 `docs/app-portability-plan.md` 和本建议文件；若端到端故障证明必须改 C 运行码，应先说明调用链并另行批准精确文件，不得在 H 的生成 bundle 上打补丁。

H 的建议逐文件白名单如下。删除 `web/native/gate.js` 和修改现有文件都计入白名单。生成工程的默认 Example 测试不纳入，测试要覆盖真实提交与失败合同。以下是候选许可上限，并非必须逐个修改；实际改动与原生工具自动新增文件必须在提交前逐项比对，出现表外路径即停止、重审和扩充批准。

### H 宿主源码、构建及测试（30 个）

```text
README.md
capacitor.config.json
docs/p5-host-contract.md
p5-scope-lock.json
package.json
pnpm-lock.yaml
scripts/build.js
scripts/run-native-matrix.mjs
scripts/scan-bundle.js
scripts/verify-native-matrix.mjs
scripts/verify-p5-scope.js
src/app-product-values.js
src/browser-platform.js
src/canvas-platform.js
src/native-main.js
src/native-platform.js
src/native-product-config.js
src/native-storage-port.js
src/product-config.js
src/store/unavailable-entitlement-provider.js
tests/browser-platform.test.js
tests/browser-smoke.js
tests/native-storage-port.test.js
tests/native-web-smoke.js
tests/p5-host-contract.test.js
tests/product-and-lock.test.js
tests/run.js
web/native/gate.js
web/native/index.html
web/native/styles.css
```

### H 原生工程（80 个）

```text
android/.gitignore
android/app/.gitignore
android/app/build.gradle
android/app/capacitor.build.gradle
android/app/proguard-rules.pro
android/app/src/androidTest/java/com/godwhere/cleared/ClearedStorageStoreInstrumentedTest.java
android/app/src/main/AndroidManifest.xml
android/app/src/main/java/com/godwhere/cleared/ClearedStoragePlugin.java
android/app/src/main/java/com/godwhere/cleared/ClearedStorageStore.java
android/app/src/main/java/com/godwhere/cleared/MainActivity.java
android/app/src/main/res/drawable-land-hdpi/splash.png
android/app/src/main/res/drawable-land-mdpi/splash.png
android/app/src/main/res/drawable-land-xhdpi/splash.png
android/app/src/main/res/drawable-land-xxhdpi/splash.png
android/app/src/main/res/drawable-land-xxxhdpi/splash.png
android/app/src/main/res/drawable-port-hdpi/splash.png
android/app/src/main/res/drawable-port-mdpi/splash.png
android/app/src/main/res/drawable-port-xhdpi/splash.png
android/app/src/main/res/drawable-port-xxhdpi/splash.png
android/app/src/main/res/drawable-port-xxxhdpi/splash.png
android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml
android/app/src/main/res/drawable/ic_launcher_background.xml
android/app/src/main/res/drawable/splash.png
android/app/src/main/res/layout/activity_main.xml
android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
android/app/src/main/res/mipmap-hdpi/ic_launcher.png
android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png
android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
android/app/src/main/res/mipmap-mdpi/ic_launcher.png
android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png
android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png
android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png
android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
android/app/src/main/res/values/ic_launcher_background.xml
android/app/src/main/res/values/strings.xml
android/app/src/main/res/values/styles.xml
android/app/src/main/res/xml/backup_rules.xml
android/app/src/main/res/xml/data_extraction_rules.xml
android/app/src/main/res/xml/file_paths.xml
android/build.gradle
android/capacitor.settings.gradle
android/gradle.properties
android/gradle/wrapper/gradle-wrapper.jar
android/gradle/wrapper/gradle-wrapper.properties
android/gradlew
android/gradlew.bat
android/settings.gradle
android/variables.gradle
ios/.gitignore
ios/App/App.xcodeproj/project.pbxproj
ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
ios/App/App/AppDelegate.swift
ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json
ios/App/App/Assets.xcassets/Contents.json
ios/App/App/Assets.xcassets/Splash.imageset/Contents.json
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
ios/App/App/Base.lproj/LaunchScreen.storyboard
ios/App/App/Base.lproj/Main.storyboard
ios/App/App/ClearedStorageBridgeViewController.swift
ios/App/App/ClearedStoragePlugin.swift
ios/App/App/ClearedStorageStore.swift
ios/App/App/Info.plist
ios/App/App/SceneDelegate.swift
ios/App/CapApp-SPM/.gitignore
ios/App/CapApp-SPM/Package.swift
ios/App/CapApp-SPM/README.md
ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift
ios/debug.xcconfig
```

## 冻结值与关键实现

- 宿主保持 `Cleared`、`com.godwhere.cleared`、iOS 15.0+、Android API 28+；Capacitor `@capacitor/core`、`cli`、`ios`、`android` 建议继续精确锁定 P4.5 已测的 8.5.2。正式 `webDir` 为 H 的 `dist/native-web`，元数据在 `dist/native-meta` 外置。
- H 以一个不可复制的 App 产品取值源生成 P4 测试和正式原生配置；P4 的 `src/main.js`、`FakeStoreAdapter`、`EntitlementOwner` 可保持现状，正式入口必须独立且不导入三者。Canvas 平台共用能力可抽为 H 内基类；正式存储方法只能经异步原生端口，任何同步读写调用均失败关闭。
- 原生端口严格提供 P5-B 的 `open({namespace,schemaVersion,keys})`、`commit({namespace,schemaVersion,operationId,writes})` 和 `lookupOperation(operationId)`。四个普通记录、操作 ID 与内容摘要在同一 SQLite 事务内提交；同 ID 不同内容拒绝，查询不明结果时不发布新确认状态。损坏或未来 schema 保留原字节；迁移只允许前向单事务升级。操作日志保留与清理规则必须在实现前以量测结果冻结。
- Android 备份配置分别覆盖 API 30 及以下与 API 31 及以上，iOS 核查 Application Support 属性；配置检查不替代真机恢复。调试构建中的故障注入入口必须在正式构建中不可达且不进入 `dist/native-web`。
- 构建与扫描区分 P4 浏览器产物和正式原生产物，核对 H／C 提交、tree、输入摘要和精确文件清单。只有双模拟器从冷启动到 SQLite 提交、强退及重启可玩验证通过，才把 `nativeCopyEligible` 改为 `true`；这不代表商店或发布就绪。

## 验证与停止条件

| 证据 | P5-C 必须通过 | 仍待后续 |
| --- | --- | --- |
| Node／静态 | H 精确白名单、锁和产物扫描；C 113 组回归、包预算、rollout 预检；操作 ID、损坏、迁移、并发故障注入 | 原生真实提交 |
| 浏览器 | P4 六关／门禁回归；正式 bundle 无 fake store、P4、`localStorage`、微信／CloudBase、每日、广告、分享、远程请求 | 原生性能 |
| iOS 模拟器 | 真正的原生端口提交／强退恢复、六关、语言／设置、失败与重复操作，记录 OS／Xcode 版本 | iOS 15 最低版本、真机与 OS 备份 |
| Android 模拟器 | 同上；API 36 可用，另需 API 28 最低版本验证；记录 Gradle／SDK／SQLite 版本 | 真机、真实空间耗尽和备份／重装 |

当前机器只有 iOS 27 模拟器和 Android API 36 虚拟设备；最低 OS 验收、真机断电、真实备份／卸载重装、商店沙盒均尚无证据。C 的合成 200 关模型四条 JSON 记录共 8,237 bytes，不能代表 SQLite 日志与真实玩家负载。若任一平台只可假同步、必须修改表外文件、出现原生插件正式包中的调试入口或禁用依赖，停止施工并复核白名单／方案。

批准本建议也不授权 P5 后续的 StoreKit 2／Play Billing、商业 no-backup 缓存、发行签名、上传、送审或发布；这些需分别形成精确白名单和外部验收方案。
