# P5 iOS 隐私数据流静态盘点（未申报）

> 2026-09-27 基线：C `d270c0cc118438a69b5e948101f8fed62a1c28fb`、H `a5574cc1260916e5e00df4e83c77d6036dc6563b`，两仓干净。H 的 `shared-source.lock.json` 仍锁定 C `0b53ad6bab9845e855f136b61a3a707817bf0472`。本文只盘点当前 iOS 调试候选的数据路径，不是隐私政策、App Privacy 表单、法律判断或上架验收；不授权账号、商店、上传、发布或共享锁更新。

## 当前实际数据路径

| 数据／能力 | 入口与持久化位置 | 已核实边界 |
| --- | --- | --- |
| 普通游戏状态 | H `src/native-main.js` 启动共享异步 runtime，经 `ClearedStoragePlugin.swift` 写入 `ClearedStorageStore.swift` 的 `Application Support/ClearedOrdinary/cleared-ordinary-v1.sqlite` | 固定四个记录 key：进度、奖励／解锁、体力、语言；operation ID 与请求摘要用于幂等。目录显式允许 OS 备份。这是本机保存，不构成 OS 备份恢复实测。 |
| 完整版权益 | `ClearedStoreKitOwner.swift` 将本地 StoreKit 已验证结果写入 `ClearedEntitlementStore.swift` 的 `Application Support/ClearedCommercial/storekit-local-v1.sqlite` | 当前仅 Xcode 本地模拟。库含商品 ID、交易／原始交易 ID、验证时间、版本、待 `finish` ID 与撤销记录；独立 `installation-id` 标记绑定安装。目录显式排除备份；真实沙盒／生产环境尚未实施，不能据此填写真实交易数据处理结论。 |
| 界面和系统能力 | H `CanvasPlatform` 读取 `navigator.language`，使用 Canvas 指针、音频和可用时的短振动；`NativePlatform` 继承这些能力 | 正式 `src/native-main.js` 未装配 App 登录、广告、分享奖励或 CloudBase。这里仅是入口与代码盘点，不证明最终安装包没有其他 SDK 数据行为。 |
| 隐私政策入口 | 共享 `src/app.js` 的 `account:privacy` 调用平台接口；H `NativePlatform` 继承 `CanvasPlatform.openPrivacyContract()` | 现为 `not-supported` 并显示打开失败。没有实际政策 URL，也未发生用户主动打开政策页的原生网络请求。发布前须接通真实、易于访问的入口。 |

H 的正式 `native-web` 扫描拒绝远程 URL、微信／CloudBase、广告和每日入口等标记；Chrome 合成端口 smoke 报告远程请求数为 0。这只覆盖被测试的 WebView 构建与浏览器请求，不覆盖 StoreKit 与 Apple 的通信、将来用户主动打开隐私／支持网站、系统备份或最终设备的全部网络行为。不能据此把 App Privacy 填为“未收集数据”。

## 原生依赖与待核实声明

- H 原生依赖锁定 Capacitor `8.5.2`，当前 `@capacitor/ios` 的 Capacitor 和 CapacitorCordova 各自带 `PrivacyInfo.xcprivacy`，其中数据收集与 required-reason API 数组为空；H App target 没有自己的 manifest。对 H 自写 Swift 的静态搜索发现 `FileManager` 的目录、文件存在性与备份标志操作，未发现 `UserDefaults`、磁盘空间、系统启动时间或文件时间戳调用。搜索结果和第三方自声明都不能替代最终原生可执行文件、框架及 Apple 当前 required-reason API 清单的逐项审查。[Apple required-reason API 规则](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)。
- P5-E 若获批，沙盒／生产交易、商业缓存环境和依赖可能变化；App Privacy、政策和 manifest 必须按**最终提交候选**重审。不能把 P5-D 的本地交易 ID 当作真实商店数据流，也不能把普通游戏存档与商业缓存合并申报或备份。
- Apple 要求隐私政策链接在 App 内可发现且在 App Store Connect 提供 URL；提交版本还需要可实际联系到发行方的支持 URL。真实政策文本、HTTPS 地址、联系人与最终数据处理说明尚未提供，不能生成占位链接或代填“无数据收集”。[App Review 5.1.1](https://developer.apple.com/app-store/review/guidelines/)、[支持 URL 字段](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)。

## 后续证据顺序

1. **静态／Node：**在最终源码和依赖锁上复核普通与商业数据字段、网络 API、SDK、隐私 manifest、链接白名单和无远程脚本；保存最终 bundle／原生包文件摘要。H `pnpm verify` 只证明其覆盖的构建与测试。
2. **浏览器／模拟器：**分别验证 Canvas 隐私 action、原生打开结果与失败反馈、离线／错误 URL、安全区和方向；记录实际网络请求。Chrome 合成插件不代替 iOS 系统弹窗或 Safari 打开结果。
3. **真机／商店：**在获授权的最终候选上审查实际 SDK、网络、OS 备份／卸载及 StoreKit 沙盒行为；由发行方核实政策、支持联系、App Privacy 答案和可分发素材权利，再填写 App Store Connect。未完成时 V25／V27 均保持待验。

此盘点不改变 P5-E 白名单、`nativeCopyEligible:false` 或“Android 新增工作暂停”。
