# P5-E iOS 正式 StoreKit 接入建议（待批准）

> 施工前审计基线：2026-09-27，C `dd6b512fd9f9df4872dbd8e41779110b9445ec24`、H `27ce5d5c9f38043fa00fc7559fb317dd48ec750b`，两仓均为干净 `main`。本文只冻结建议，不授权修改 H 代码、创建真实商品、使用沙盒账号或发行。Android 新增工作继续暂停。P5-D 的正式 App 购买／恢复／取消按钮模拟器触控仍无结果。

## 审计结论与建议值

- 保持共享逻辑权益 `full_game_v1`、六关试玩及普通存档原样。建议沿用 Apple 非消耗型商品 ID `com.godwhere.cleared.fullgame`，以 App Store Connect 实际创建结果为最终前提；真实价格、币种、地区和文案均未冻结，App 仅显示 `Product.displayPrice`。`src/native-main.js` 已装配原生插件；共享 `src/app.js` 的购买／恢复 action 不需改动。当前 H 的 JS provider 只接受 `storekit-local`，Swift 所有者只在 Debug 模拟器 `CLEARED_STOREKIT_LOCAL=1` 时运行，商业库只有 `storekit-local` namespace，Release 与非模拟器保持关闭。
- **先批准代码，再单独批准外部验证。**建议 P5-E 代码阶段建立沙盒／生产环境隔离、原生交易核验、显式恢复同步和失败关闭测试；不在本阶段创建 App Store Connect 商品、登入沙盒账号、安装真机包、启用发行签名或上传。没有真实商品和沙盒交易时只能报告静态、Node、本地 StoreKit 与模拟器证据，不能称正式购买已验收。
- 仅原生 StoreKit 已验证的、商品 ID／bundle ID／非消耗型类型／环境均匹配的交易能授予权益。`.xcode`、`.sandbox`、`.production` 三种来源必须严格分开；P5-D 的 `storekit-local-v1.sqlite` 和已有授权不得迁入沙盒或生产缓存。建议新增 `com.godwhere.cleared/commercial/storekit-sandbox/v1` 与 `com.godwhere.cleared/commercial/storekit-production/v1`，分别使用独立 no-backup SQLite 文件；保留安装标识绑定、`synchronous=FULL`、串行事务、损坏／未来 schema 保留原字节。普通 `com.godwhere.cleared/ordinary/prod/v1` 及四条记录 key 不变。
- 启动即监听 `Transaction.updates`，缓存可用后补扫 `Transaction.unfinished`，启动／回前台重查 `currentEntitlements`；同一交易 ID 幂等处理。新权益先可靠落盘，后发布 `owned_verified`、再 `finish()`；失败时保留交易待重试。旧空查询不能覆盖较新的交易，完整无竞争查询和已验证撤销必须能去权。`AppStore.sync()` 只在用户点击“恢复购买”后调用，启动和回前台不得触发 Apple 账号提示。[Apple 未完成交易](https://developer.apple.com/documentation/storekit/transaction/unfinished)、[手动同步](https://developer.apple.com/documentation/storekit/appstore/sync%28%29)
- **离线环境判定是未解决的产品风险。**当前 iOS 27 SDK 的 `AppTransaction` 从 iOS 16 才可用，不能把它当作 iOS 15 的唯一环境来源。建议 iOS 16+ 只在已验证 `AppTransaction` 可识别安装渠道时使用对应环境缓存；iOS 15 优先使用当前 StoreKit 已验证交易及其兼容环境表示。若冷启动离线时无法可靠判断当前安装环境，就失败关闭商业缓存并显示可重试状态，不能凭 Debug／Release、包名或旧本地库猜测环境。若这无法满足“同安装可靠确认权益可离线使用”的既定合同，须先补证可信 iOS 15 渠道信号或由用户重新决定最低系统／离线承诺，不能宣称 P5-E 完成。[Apple 交易环境兼容属性](https://developer.apple.com/documentation/storekit/transaction/environmentstringrepresentation)、[Apple 沙盒与 Xcode 测试区别](https://developer.apple.com/documentation/storekit/testing-at-all-stages-of-development-with-xcode-and-the-sandbox)
- 默认 `App` scheme 移除本地 `.storekit` 配置与 `CLEARED_STOREKIT_LOCAL`；新增单独 `AppLocalStoreKit` scheme 保留 P5-D 回归。发布载荷和 WebView bundle 不得包含 `.storekit` 夹具；没有商品或环境不匹配时保持未拥有。原有 `nativeCopyEligible:false` 与双平台放行条件不变。

## 建议逐文件白名单

这是**下一阶段待批准**的精确路径，不以目录前缀授权。施工前仍需重新核对两仓状态、分支、实际差异和调用链。若测试证明必须修改表外文件，先停下补审。

| 仓库 | 精确路径 | 用途 |
| --- | --- | --- |
| C | `README.md` | 用户可见 App 能力与验收状态 |
| C | `docs/app-portability-plan.md` | 阶段、证据及未完成门槛 |
| C | `docs/p5-e-ios-storekit-scope-proposal.md` | 建议值与执行记录 |
| H | `README.md` | iOS 本地与正式渠道的使用说明 |
| H | `docs/p5-host-contract.md` | 商业缓存、原生所有者及证据边界 |
| H | `p5-scope-lock.json` | P5-E 阶段与精确授权标记 |
| H | `scripts/verify-p5-scope.js` | 阶段锁、白名单与环境隔离校验 |
| H | `scripts/build.js` | 正式产物来源／渠道标记 |
| H | `scripts/scan-bundle.js` | 测试夹具与禁用依赖的产物扫描 |
| H | `src/store/native-entitlement-provider.js` | 只接受合法原生环境快照及递增 revision |
| H | `tests/native-entitlement-provider.test.js` | 错误来源、乱序及失败关闭回归 |
| H | `tests/native-web-smoke.js` | 正式入口在无插件／无商品时保持门禁 |
| H | `tests/p5-host-contract.test.js` | 锁、scheme、命名空间和产物合同 |
| H | `ios/App/App/ClearedStoreKitOwner.swift` | 已验证交易、环境选择、恢复与生命周期 |
| H | `ios/App/App/ClearedEntitlementStore.swift` | 三环境独立商业缓存与事务 |
| H | `ios/App/AppTests/ClearedStoreKitOwnerTests.swift` | 隔离、失败、恢复、退款和重试回归 |
| H | `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` | 默认 scheme 不载入本地 StoreKit |
| H | `ios/App/App.xcodeproj/xcshareddata/xcschemes/AppLocalStoreKit.xcscheme`（新增） | 专供 P5-D 本地交易回归 |

不包含 C 共享运行码、H 的 `shared-source.lock.json`、`src/native-main.js`、普通 SQLite 实现、`AppDelegate.swift`、插件、Xcode 工程 `project.pbxproj`、Android、微信配置、CloudBase、每日挑战、广告、分享、账号或关卡／Renderer／GameRunner。H 当前共享锁仍指向 C `0b53ad6bab9845e855f136b61a3a707817bf0472`；至本审计 C HEAD 的差异仅为 `docs/app-portability-plan.md`、`docs/p5-c-scope-proposal.md` 和 `docs/p5-d-ios-scope-proposal.md`，无共享运行码、catalog 或产品策略变化，故**不建议刷新共享锁**；不运行 `pnpm lock:shared`。

## 验证矩阵与停止条件

| 证据层 | P5-E 代码阶段应验证 | 仍须另行授权／条件 |
| --- | --- | --- |
| 静态／Node | 精确白名单、锁与来源摘要、三环境隔离、错误来源拒绝、旧空查询／迟到退款、写失败前不发布不 `finish`、bundle 无本地夹具；C 全套既定检查，H 开发中 `pnpm preflight`、提交后干净工作区 `pnpm verify` | 不能据此确认 Apple 交易 |
| 浏览器 | 无原生插件和无商品时六关门禁保持；合成原生快照仅验证 JS 消费合同 | 不能算原生 StoreKit |
| iOS 模拟器＋Xcode 本地 StoreKit | 新独立 scheme 重跑 P5-D 购买／取消／pending／恢复／撤销／故障；默认 scheme 无本地夹具；补做正式 App 按钮真实触控 | 本地 `.storekit` 不能证明沙盒或生产交易 |
| 真机与商店沙盒 | 经单独授权、真实商品和沙盒账号可用后，验证 iOS 15 与较新系统的购买／取消／pending／恢复、退款、离线、重装与备份、低空间及真实显示 | 当前未授权，暂缓；发行签名、上传、送审、发布更不在本白名单 |

最低版本工具链限制（2026-09-27 复核）：本机 macOS 27.0、Xcode 27.0 只装 iOS 27.0 模拟器。[Apple 的 Xcode 支持表](https://developer.apple.com/xcode/system-requirements)列 Xcode 27 可把 iOS 15 设为部署目标，但仅支持运行 iOS 17+ 的设备和模拟器；本阶段的 iOS 15 类型检查不能替代最低系统运行。iOS 15 完整验收需要另一套受支持的工具链或以后经单独授权的设备／分发流程；不为通过当前矩阵擅自提高产品最低版本。

若 `.xcode` 缓存可授予沙盒／生产权益、JS 可自行签发 `owned_verified`、未知环境或损坏缓存放行、未落盘就 `finish()`、启动自动 `AppStore.sync()`、`nativeCopyEligible` 被提前改为 `true`，立即停止。真实商品 ID 不可用、iOS 15 离线环境无法可靠判定、任何表外文件或账号／签名／商店操作成为必需时，先记录证据并取得新的明确授权。[Apple 沙盒测试条件](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox)、[非消耗型商品创建](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-consumable-or-non-consumable-in-app-purchases)
