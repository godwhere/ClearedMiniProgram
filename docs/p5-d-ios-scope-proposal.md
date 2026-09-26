# P5-D iOS 本地 StoreKit 施工建议（待批准）

> 2026-09-27 只读审计建议。用户要求优先完成 iOS、暂停 Android 新增工作。本文件只冻结下一段的建议范围；**尚未授权 StoreKit 代码、商店商品或真实购买**。P5-C 原双端 `nativeCopyEligible:false` 放行条件不在此修改。

## 建议值与施工边界

- 只接 iOS 的一个非消耗型完整版商品。共享逻辑权益 ID 仍为 `full_game_v1`；建议 Apple 商品 ID 为 `com.godwhere.cleared.fullgame`。先用 Xcode 本地 `.storekit` 配置模拟同 ID 商品，测试价格仅为夹具；运行时展示 `Product.displayPrice`，不冻结真实售价。本地配置不会在 App Store Connect 创建商品。[Apple 的本地 StoreKit 测试说明](https://developer.apple.com/documentation/xcode/setting-up-storekit-testing-in-xcode)、[商品 ID 规则](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information)
- 正式 Web 入口把当前 `UnavailableEntitlementProvider` 替换为只消费原生结果的 iOS provider；无插件、初始化失败或未验证时继续关闭商业门禁。不得复用 P4 `EntitlementOwner`、`FakeStoreAdapter`、同步浏览器缓存或普通 SQLite 数据库。C 共享游戏代码无建议改动；六关、门禁、购买／恢复 action 和普通存档合同继续原样。
- 宿主级 Swift 所有者在 App 启动时立即建立贯穿进程生命期的 `Transaction.updates` 监听；商业缓存就绪后及待 `finish` 补办时主动枚举 `Transaction.unfinished`，启动与回前台另查已验证的 `Transaction.currentEntitlements`。`updates` 对启动时未完成交易只投递一次，不能以权益查询代替未完成交易补扫；缓存暂时无法打开时保留待处理交易，不发布权益、不 `finish`。购买、恢复、更新和补扫归入同一串行所有者，按交易 ID 幂等归并。只接受预期商品、bundle 与可识别环境的 verified 非消耗型交易。`AppStore.sync()` 只由用户明确点击“恢复购买”触发，不能在启动时弹认证。[Apple 交易更新](https://developer.apple.com/documentation/storekit/transaction/updates)、[未完成交易](https://developer.apple.com/documentation/storekit/transaction/unfinished)、[当前权益](https://developer.apple.com/documentation/storekit/transaction/currententitlements)、[手动同步](https://developer.apple.com/documentation/storekit/appstore/sync%28%29)
- **iOS 15 编译边界**：以本机 Xcode 27／iOS 27 SDK 对 `arm64-apple-ios15.0-simulator` 进行独立 Swift 类型检查：`Product.products(for:)`／`purchase()`、`Transaction.currentEntitlements`／`updates`／`unfinished`／`finish()`、`AppStore.sync()` 可编译；直接访问 `Transaction.environment` 报“仅 iOS 16.0+”。环境校验必须对 iOS 16+ 使用该属性，并在 iOS 15 采用 StoreKit 已验证交易的兼容表示（`environmentStringRepresentation` 或经验证后解码的 `jsonRepresentation`）；这两种表示在 iOS 15 目标下均可编译。未知或不匹配的环境一律拒绝，不靠构建配置猜测交易来源。[Apple 的兼容环境属性](https://developer.apple.com/documentation/storekit/transaction/environmentstringrepresentation)、[交易 JSON 说明](https://developer.apple.com/documentation/storekit/transaction/jsonrepresentation)。这是 SDK 静态证据；本机仅安装 iOS 27 模拟器，仍缺 iOS 15 **运行**验收。
- 建议商业缓存独立放在 `Library/Application Support/ClearedCommercial/`，schema 1，按 `storekit-local`／正式商店环境分隔；目录、安装实例标识及缓存文件明确排除 OS 备份。缓存记录商品 ID、bundle、环境、安装实例、交易／原始交易 ID、最后成功验证时间、状态和待 `finish` 标记。以独立 SQLite `synchronous=FULL` 事务串行落盘；新权益落盘成功后才发布 `owned_verified` 并调用 `finish()`，重启以同一交易 ID 幂等补办。写失败保留旧状态、不 `finish`、不碰普通存档；损坏或未来 schema 保留原字节并失败关闭。离线仅同一安装、同一环境中此前可靠确认的权益可继续放行。商业缓存不依赖普通数据库备份。[Apple 交易完成说明](https://developer.apple.com/documentation/storekit/transaction/finish%28%29)
- 旧查询不得覆盖期间落盘的新交易；完整且无竞争的权威查询或已验证撤销必须能去权，不能把超时／部分结果当成退款。取消与 pending 只影响本次操作，不撤销已有权益。关闭购买面板不停止原生交易监听；重新取得权益不重置六关、金币、体力或设置。
- 本阶段只允许本机调试签名、Xcode 本地 StoreKit 配置和 iOS 模拟器验证。**不**创建 App Store Connect 商品，不设真实价格，不使用沙盒账号，不做真机、发行签名、上传、送审或发布；这些仍需单独授权与外部验收。Android 代码、工程和计费保持原状。

## 建议逐文件白名单

获批后仅允许下列路径的必要最小改动；新增文件已注明。不得用目录前缀授权其余文件，不刷新 `shared-source.lock.json`。C 自锁定提交 `0b53ad6bab9845e855f136b61a3a707817bf0472` 后只有 P5 文档差异，catalog、策略与共享运行码未变。

| 仓库 | 精确路径 | 用途 |
| --- | --- | --- |
| C | `docs/app-portability-plan.md` | 记录阶段与证据边界 |
| C | `docs/p5-d-ios-scope-proposal.md` | 冻结本建议及执行结果 |
| H | `README.md` | 更新本地 iOS 调试与验证命令 |
| H | `docs/p5-host-contract.md` | 记录商业缓存／原生权益合同和证据 |
| H | `p5-scope-lock.json` | 明确 iOS StoreKit 本地测试授权、Apple ID 映射及仍未授权项目 |
| H | `src/native-main.js` | 注入原生权益 provider；缺失时失败关闭 |
| H | `src/store/native-entitlement-provider.js`（新增） | 只读快照、订阅、购买／恢复调用的 JS 桥；不签发权益 |
| H | `scripts/build.js` | 原生产物集成标记与来源 |
| H | `scripts/scan-bundle.js` | 确认正式包无 P4 fake store、浏览器缓存和测试交易注入 |
| H | `scripts/verify-p5-scope.js` | 精确白名单及分平台授权校验 |
| H | `tests/native-entitlement-provider.test.js`（新增） | 失败关闭、乱序 revision、解绑和操作状态回归 |
| H | `tests/native-web-smoke.js` | 无商店插件失败关闭与合成端口装配；标明浏览器证据 |
| H | `tests/p5-host-contract.test.js` | ID 映射、隔离和产物边界校验 |
| H | `tests/run.js` | 聚合新增 Node 回归 |
| H | `ios/App/App/AppDelegate.swift` | App 启动即建立原生交易监听 |
| H | `ios/App/App/ClearedStorageBridgeViewController.swift` | 注册独立 StoreKit 插件 |
| H | `ios/App/App/ClearedStoreKitPlugin.swift`（新增） | Capacitor 商店桥接，仅转交原生所有者结果 |
| H | `ios/App/App/ClearedStoreKitOwner.swift`（新增） | StoreKit 2 验证、串行归并、刷新／购买／恢复／撤销与 finish |
| H | `ios/App/App/ClearedEntitlementStore.swift`（新增） | 独立 no-backup 安装绑定商业 SQLite 缓存 |
| H | `ios/App/App/ClearedDebug.storekit`（新增） | 仅供 Xcode 本地交易模拟的非消耗型商品夹具 |
| H | `ios/App/App.xcodeproj/project.pbxproj` | 注册 Swift、测试目标与本地 StoreKit 配置 |
| H | `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`（新增） | 仅调试／测试启用本地 StoreKit 配置 |
| H | `ios/App/AppTests/ClearedStoreKitOwnerTests.swift`（新增） | 原生缓存失败、重复交易、pending、退款和重启补办测试 |

`src/app-product-values.js` 的逻辑 ID 不变；原生 Apple SKU 映射仅由 H 管理并由阶段锁／测试校验。`ios/App/App/ClearedStorageStore.swift` 及四条普通存档 key 不进入本阶段。若真实施工证明需要表外文件，先停止并补审白名单，不顺手扩张。

## 验证矩阵与停止条件

| 证据层 | 必须验证 | 不得推断 |
| --- | --- | --- |
| 静态／Node | C 113 组回归、包预算、rollout；H 范围锁、共享锁、bundle 扫描、provider 乱序／失败关闭测试，iOS 15 目标编译保护，`pnpm preflight`；提交后干净 H `pnpm verify` | iOS 15 运行或真实购买 |
| 浏览器 | 六关、所有完整版入口门禁；无插件不能授予权益，P4 fake store 仅在测试输出；无远程请求 | StoreKit 原生验证 |
| iOS 27 模拟器＋Xcode 本地 StoreKit | 系统商品信息与本地化价格、购买／取消／pending、手动恢复有／无交易、重复更新、强退重启、缓存打开或写入失败前后、启动时错过一次更新后的 `unfinished` 补扫与 `finish` 重试、撤销／退款、普通存档原地保留；记录 Swift XCTest 与实际 App 触控结果 | App Store 沙盒、真实扣费、真机或 iOS 15 |
| 真机／商店／发布 | 本阶段暂缓：最低 iOS 15、OS 备份／卸载重装、断电／低空间、沙盒购买／恢复／退款、App Store Connect 商品、发行签名、上传与审核 | 不能由本地 `.storekit` 替代 |

若需要 JS 提供 `owned:true`、错误商品／环境也可授权、未可靠落盘就 `finish` 或发布权益、启动时只靠一次 `updates` 而无法补扫未完成交易、旧空查询覆盖新交易、已验证撤销不能去权、缓存可从普通存档／备份恢复出商业权益，立即停止。`nativeCopyEligible:false` 在本阶段保持，不把 iOS 本地交易成功当成双平台放行或商店上线证据。
