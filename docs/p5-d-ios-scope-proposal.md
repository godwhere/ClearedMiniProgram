# P5-D iOS 本地 StoreKit 施工合同（已批准）

> 2026-09-27 用户批准按本逐文件白名单实施 Xcode 本地 StoreKit 模拟。用户要求优先完成 iOS、暂停 Android 新增工作。**未授权 App Store Connect 商品、沙盒账号或真实购买**。P5-C 原双端 `nativeCopyEligible:false` 放行条件不在此修改。

## 建议值与施工边界

- 只接 iOS 的一个非消耗型完整版商品。共享逻辑权益 ID 仍为 `full_game_v1`；建议 Apple 商品 ID 为 `com.godwhere.cleared.fullgame`。先用 Xcode 本地 `.storekit` 配置模拟同 ID 商品，测试价格仅为夹具；运行时展示 `Product.displayPrice`，不冻结真实售价。本地配置不会在 App Store Connect 创建商品。[Apple 的本地 StoreKit 测试说明](https://developer.apple.com/documentation/xcode/setting-up-storekit-testing-in-xcode)、[商品 ID 规则](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information)
- 正式 Web 入口把当前 `UnavailableEntitlementProvider` 替换为只消费原生结果的 iOS provider；无插件、初始化失败或未验证时继续关闭商业门禁。不得复用 P4 `EntitlementOwner`、`FakeStoreAdapter`、同步浏览器缓存或普通 SQLite 数据库。C 共享游戏代码无建议改动；六关、门禁、购买／恢复 action 和普通存档合同继续原样。
- 宿主级 Swift 所有者在 App 启动时立即建立贯穿进程生命期的 `Transaction.updates` 监听；商业缓存就绪后及待 `finish` 补办时主动枚举 `Transaction.unfinished`，启动与回前台另查已验证的 `Transaction.currentEntitlements`。`updates` 对启动时未完成交易只投递一次，不能以权益查询代替未完成交易补扫；缓存暂时无法打开时保留待处理交易，不发布权益、不 `finish`。购买、恢复、更新和补扫归入同一串行所有者，按交易 ID 幂等归并。只接受预期商品、bundle 与可识别环境的 verified 非消耗型交易。本阶段本地恢复只查询 Xcode 当前权益，不调用可能弹 Apple 账号认证的 `AppStore.sync()`；以后正式商店恢复如需同步，也只允许由用户明确点击触发，不能在启动时弹认证。[Apple 交易更新](https://developer.apple.com/documentation/storekit/transaction/updates)、[未完成交易](https://developer.apple.com/documentation/storekit/transaction/unfinished)、[当前权益](https://developer.apple.com/documentation/storekit/transaction/currententitlements)、[手动同步](https://developer.apple.com/documentation/storekit/appstore/sync%28%29)
- **iOS 15 编译边界**：以本机 Xcode 27／iOS 27 SDK 对 `arm64-apple-ios15.0-simulator` 进行独立 Swift 类型检查：`Product.products(for:)`／`purchase()`、`Transaction.currentEntitlements`／`updates`／`unfinished`／`finish()`、`AppStore.sync()` 可编译；直接访问 `Transaction.environment` 报“仅 iOS 16.0+”。环境校验必须对 iOS 16+ 使用该属性，并在 iOS 15 采用 StoreKit 已验证交易的兼容表示（`environmentStringRepresentation` 或经验证后解码的 `jsonRepresentation`）；这两种表示在 iOS 15 目标下均可编译。未知或不匹配的环境一律拒绝，不靠构建配置猜测交易来源。[Apple 的兼容环境属性](https://developer.apple.com/documentation/storekit/transaction/environmentstringrepresentation)、[交易 JSON 说明](https://developer.apple.com/documentation/storekit/transaction/jsonrepresentation)。这是 SDK 静态证据；[Apple 的 Xcode 支持表](https://developer.apple.com/xcode/system-requirements)显示 Xcode 27 的 iOS 15 只是部署目标，设备／模拟器运行支持从 iOS 17 起。本机 macOS 27／Xcode 27 只装 iOS 27 模拟器，iOS 15 **运行**验收须使用兼容的其他工具链或经授权的设备。
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

### Ask to Buy 弹窗反馈补充建议（待单独批准）

下文是 2026-09-27 模拟器发现缺陷后的**增量建议**，不改变上表已批准的边界。C 接受本地获批的较新 `owned_verified` 快照后，已打开弹窗仍优先显示旧 `pending` 操作文案；购买按钮同时消失，商业 SQLite 已落盘且 `pendingFinish=[]`。修复应以已接受的权益快照为授权与展示依据：一旦其 revision 高于操作结果的快照 revision，旧操作反馈不得覆盖新状态；迟到的 pending 结果也不得把获批画面改回“未解锁”。撤销、取消、失败与恢复仍按各自真实状态显示，关闭弹窗不丢失有效权益。只改共享消费者反馈，不让 JS 签发商业权益。

拟增文件均为**精确路径**；原白名单内的 C `docs/app-portability-plan.md`、本文与 H `docs/p5-host-contract.md` 可同步记录结果。未收到明确增量批准前，以下代码与共享锁均只读。

| 仓库 | 拟增精确路径 | 必要原因 |
| --- | --- | --- |
| C | `src/app.js` | 让较新权益快照淘汰已过时的弹窗操作反馈 |
| C | `tests/full-game-access.test.js` | pending→获批、获批后迟到 pending、撤销及普通存档不变的失败先行回归 |
| H | `shared-source.lock.json` | C 修复提交后，按审核过的 commit／tree 显式升级唯一共享源码锁 |
| H | `p5-scope-lock.json` | 只把共享锁这一精确路径增入 P5-D 许可清单 |
| H | `scripts/verify-p5-scope.js` | 校验补审后的清单摘要与指定共享提交，仍禁止改动 P4.5 存储报告 |
| H | `tests/p5-host-contract.test.js` | 断言唯一共享锁升级、产品与目录摘要不漂移、其他禁止输入仍只读 |

刷新前先复核锁定 C `0b53ad6bab9845e855f136b61a3a707817bf0472` 至目标提交的逐文件差异。至本增量审计时 C `d055b5e9b58d1edba213f8d8a076eb249ea4a51a` 的差异仅为 `README.md` 与七份 P5 Markdown 文档；`core/`、`data/`、`src/`、`assets/` 均无改动。H 对当前 C 再计算的 runtime contract、产品策略、catalog 顺序／内容、逻辑权益和六关快照均与旧锁一致。代码修复提交后须重新审查差异与这些值，只在 C 干净提交后更新 H 锁，不运行 `pnpm lock:shared`，不扩大为目录授权。

验收：C 的回归必须在旧实现下失败，并覆盖较新已验证授权优先、迟到操作结果不能倒退、撤销后门禁恢复及普通存档不变；再运行 `node tests/run.js`、包预算、rollout 预检和 `git diff --check`。H 开发中 `pnpm preflight`、提交后干净双仓 `pnpm verify`；iOS 27 上用 Xcode 本地 Ask to Buy 重跑批准前／后 Canvas 文字、按钮、商业 SQLite 与 `finish`，保存清晰截图。若需要表外文件、产品／catalog 变化、真实商品或商店账号，停下重新审查；iOS 15 运行、真机和发布仍不在此次补充范围。

## 验证矩阵与停止条件

| 证据层 | 必须验证 | 不得推断 |
| --- | --- | --- |
| 静态／Node | C 113 组回归、包预算、rollout；H 范围锁、共享锁、bundle 扫描、provider 乱序／失败关闭测试，iOS 15 目标编译保护，`pnpm preflight`；提交后干净 H `pnpm verify` | iOS 15 运行或真实购买 |
| 浏览器 | 六关、所有完整版入口门禁；无插件不能授予权益，P4 fake store 仅在测试输出；无远程请求 | StoreKit 原生验证 |
| iOS 27 模拟器＋Xcode 本地 StoreKit | 系统商品信息与本地化价格、购买／取消／pending、手动恢复有／无交易、重复更新、强退重启、缓存打开或写入失败前后、启动时错过一次更新后的 `unfinished` 补扫与 `finish` 重试、撤销／退款、普通存档原地保留；记录 Swift XCTest 与实际 App 触控结果 | App Store 沙盒、真实扣费、真机或 iOS 15 |
| 真机／商店／发布 | 本阶段暂缓：最低 iOS 15、OS 备份／卸载重装、断电／低空间、沙盒购买／恢复／退款、App Store Connect 商品、发行签名、上传与审核 | 不能由本地 `.storekit` 替代 |

若需要 JS 提供 `owned:true`、错误商品／环境也可授权、未可靠落盘就 `finish` 或发布权益、启动时只靠一次 `updates` 而无法补扫未完成交易、旧空查询覆盖新交易、已验证撤销不能去权、缓存可从普通存档／备份恢复出商业权益，立即停止。`nativeCopyEligible:false` 在本阶段保持，不把 iOS 本地交易成功当成双平台放行或商店上线证据。

## 实施记录（2026-09-27）

H 在 `5d6a4160f84d1ad29a9a058490bc626dac01e31b` 完成逐文件白名单内的本地实现，并在 `7ddd78c10a0a409451dc2752efc5b50dfe8b86c8` 修复原生通知晚安装时的快照补发；两次均由 GitHub Desktop 本地提交，未推送。H 的 `pnpm preflight`、提交后干净双仓 `pnpm verify`、范围锁与 bundle 扫描、Chrome 无插件失败关闭／合成插件／六关 smoke 均通过。iOS 15 SDK 类型检查通过，仅证明编译兼容。

Xcode 27 图形界面在 iOS 27 iPhone 18 Pro 模拟器执行 10 项 Swift XCTest 全部通过：本地购买／恢复／退款、无交易恢复时旧缓存去权、待批准购买不提前授权、启动漏过更新后的 `unfinished` 补扫与缓存恢复、独立 SQLite 与普通档隔离、缺安装标识或数据库、损坏数据和未来 schema 的失败关闭。H 的 `b9d4c392643c199294b5aa58804ee8705295b980` 新增商业 SQLite 写入拒绝注入：App 购买不授权、不 `finish`，故障解除后刷新才落盘授权并完成交易；这是确定性写入失败，不是系统真实低空间。H 的 `27ce5d5c9f38043fa00fc7559fb317dd48ec750b` 又验证无交易时恢复可清除仅存于商业缓存的旧授权。退款后空查询、多次退款的迟到旧交易和晚安装通知的断言曾先在错误实现下失败。Xcode Run 中原生桥读取到本地测试价格 `$1.99` 与既有普通档；该价格不是正式定价。早先一次 CLI `xcodebuild test` 未成功加载本地 StoreKit 配置，当次不能计入交易证据。

后续对干净 H 原工程的原始 `App` scheme，在 iOS 27 模拟器 `D28B2D14-F0CA-4A61-BF4D-5B0F796DDAC9` 运行 `xcodebuild test -only-testing:AppTests/ClearedStoreKitOwnerTests CODE_SIGNING_ALLOWED=NO`，10 项原生 XCTest 全过，结果包为本机 `/tmp/cleared-p5d-full-cli-result.xcresult`。StoreKit 用例由 `SKTestSession` 驱动本地夹具；此前 CLI 失败未在这次复测重现。隔离副本的 Test 动作加本地配置与未改 H scheme 的单测均通过，不能把成功归因于 scheme 修改，因此没有写回该实验。此原生证据自身不覆盖正式 App Canvas 触控。

正式 App iOS 27 模拟器触控补证：在 `/tmp` 的 H 工程副本中临时加入 UI 测试目标，等待截图 OCR 识别真实主页／账户文字后依次触发账户恢复、购买按钮与系统取消。界面先显示无既有购买，再弹出明确标注仅供测试且不会扣费的 Xcode 本地 StoreKit 页；关闭后显示取消且购买按钮仍在。最终 1／1 UI 测试通过，结果包 `/tmp/cleared-p5d-purchase-cancel-ui-result.xcresult`，截图 `/tmp/cleared-p5d-purchase-cancel-ui-attachments/`；只读查询商业缓存为 `not_owned`、无交易 ID、无待 `finish` 项。最初只断言窗口的测试曾在白屏时误通过，错误头像坐标在加强断言后按预期失败。临时 UI 测试和 Test 动作实验均未写回 H；此轮成功购买、已有交易恢复、pending 与退款的 App Canvas 触控仍缺证据，后续两项补证见下。

同日继续用隔离 UI 测试确认购买：Xcode 本地系统页出现“Your purchase was successful”和“Environment: Xcode”，截图 `/tmp/cleared-p5d-success-sheet.png`，但该轮测试未关闭系统成功提示便在等待 Canvas 反馈时失败，结果包 `/tmp/cleared-p5d-purchase-success-ui-r2.xcresult` 为 **失败**。后续复跑受到旧模拟交易状态、测试动作未稳定载入本地夹具及一度磁盘空间耗尽影响；释放空间后新模拟器可正常显示主页，但没有获得 App `owned_verified`、商业 SQLite 入库及解锁的联合证据。系统本地成功提示只证明模拟确认页，不把完整 App 购买或已有交易恢复记为通过；这些测试问题也不足以判定游戏代码有缺陷。

另在新建 iOS 27 模拟器 `C4082E51-48DF-4F2F-B09F-A8C860D3272F` 中，Xcode 图形界面运行隔离工程的本地 StoreKit `App` scheme，交易管理器直接创建非消耗型测试交易 ID `0`：独立商业 SQLite 从 `not_owned` 变为 `owned_verified`、`pendingFinish=[]`，运行中的原生桥向 JS 推送相同的 `storekit-local` 快照。管理器退款后，库与 JS 快照均变为 `revoked`，库保留原交易墓碑；停止并重启 App 仍读回 `revoked`。再次创建交易 ID `1` 后，库与 JS 快照恢复 `owned_verified`，旧墓碑保留且无待 `finish` 项。这验证本地交易管理器→正式 App 原生所有者→商业缓存→JS 桥及重启恢复，**未经过 Canvas 购买／恢复按钮**，也未单独观察关卡解锁；不代表 App 端到端购买或真实商店验收。

H 的 `8037940b2f4fdd70e9ca8db948a7ddacdc670188` 补充 Chrome 正式 `native-web` 入口的合成插件 UI smoke：账号页点击恢复返回 `not_found` 后，购买按钮仍可触发；两次 `cancelled` 购买均到达 JS 原生 provider，普通存档未增加提交。测试还检查购买和恢复不会在加载时自行发起。H 从干净工作区运行 `pnpm verify` 通过。这项测试自身只有浏览器 Canvas 与合成插件证据；上文另列正式 App 的模拟器触控。原模拟器曾停在系统 Apple Account 登录提示，未输入账号；新模拟器的 Device Hub 桌面接口仍超时。

H 的 `a1ecca8716f7f376068dc5a9c6a746078d812cb1` 给已获批的 bundle 扫描器加入可选 `--ios-app`：对指定模拟器 `.app` 的 33 个锁定 Web 文件逐项核对哈希，只接受两个空的 Capacitor Cordova 占位文件，并拒绝任何 `.storekit` 文件。隔离负向测试验证额外 JS、非空占位文件、改动 `game.js` 和测试夹具均被拒绝；无签名 Release 模拟器包实扫通过，`public` 共 35 项、`.storekit` 为 0。提交后干净 H `pnpm verify` 与包扫描均通过。这是实际模拟器包的可见文件检查，不证明原生交易、真机、发行 archive 或商店验收。

随后在同一隔离工程与 iOS 27 模拟器中补齐两项正式 App Canvas 触控：先由 Xcode 管理器注入的交易 ID `1` 经账号页“恢复购买”按钮返回完成提示，弹窗显示对勾且不再提供购买按钮；只读商业 SQLite 为 `owned_verified`、`transactionID=1`、`pendingFinish=[]`。该 UI 测试 1／1 通过，结果包 `/tmp/cleared-p5d-owned-restore-ui.xcresult`，截图在 `/tmp/cleared-p5d-owned-restore-attachments/`。再用管理器退款 ID `1`，原生桥向 JS 推送 `revoked`；从 Canvas 账号页恢复得到无既有购买后，点击购买，在 Xcode 本地成功页确认并关闭系统“OK”提示，Canvas 显示操作完成与对勾、购买按钮消失。第二项 UI 测试 1／1 通过，结果包 `/tmp/cleared-p5d-purchase-success-ui-r5.xcresult`，系统页及 Canvas 截图在 `/tmp/cleared-p5d-purchase-success-ui-r5-attachments/`。只读商业 SQLite 记录新 `transactionID=2`、`owned_verified`、旧退款墓碑 `invalidatedOriginalIDs=["0","1"]`、`pendingFinish=[]`。先前系统成功页后未关闭提示的失败结果仍保留作历史排障证据；本次通过的是 Xcode 本地模拟，不是实际扣费或正式商品。临时 UI 测试只在 `/tmp`，未纳入 H 工程及持久回归；也尚未单独观察关卡解锁画面。

第七关入口也在同一隔离模拟器补证：从另一台 iOS 27 模拟器中先前真实触控完成的六关普通进度，**只取进度 JSON** 写入本测试模拟器的普通 SQLite 作为前置夹具；写前备份该模拟器原数据库至 `/tmp/cleared-p5d-before-six-progress-C408.sqlite`，原模拟器不变。这不是 App 自行恢复存档，也不是 OS 备份测试。因未复制奖励记录，首轮 UI 测试被正常补发的“Gems”奖励弹窗遮挡；关闭提示后，主页显示 `6/200`、“Continue”且不显示“Unlock Full Game”，点击继续打开 `7 / 200` 的传送门棋盘。首次断言只因截图 OCR 将 `7 / 200` 拆成 `7 | 200` 而失败；修正识别后隔离 UI 测试 1／1 通过，结果包 `/tmp/cleared-p5d-owned-level-seven-ui-r3.xcresult`，主页与棋盘截图在 `/tmp/cleared-p5d-owned-level-seven-ui-r3-attachments/`。随后只读核对商业库仍为 `owned_verified`、`transactionID=2`、`pendingFinish=[]`，普通库仍列出六关完成记录。此项证明本地已授权状态与六关进度组合后可进入第七关；未证明同一安装自然连续玩六关再购买、跨机迁移、备份或商店权益。

退款与 pending 的 Canvas 局部补证：Xcode 管理器退款 ID `2` 后，JS 桥收到 `revoked`；隔离 UI 测试重启 App，主页保留 `6/200` 并显示“Unlock Full Game”，点击只打开购买弹窗。1／1 通过，结果包 `/tmp/cleared-p5d-refund-six-ui-r2.xcresult`，截图 `/tmp/cleared-p5d-refund-six-ui-r2-attachments/`；商业 SQLite 为 `revoked`、退款墓碑含 `0/1/2`、`pendingFinish=[]`，普通六关进度未删。再用 `SKTestSession` 的 Ask to Buy 且关闭系统对话框，从 Canvas 购买得到本地待批准请求 ID `0`；画面明确显示确认前不解锁且保留购买入口，商业库未授权，普通进度不变。第二项 1／1 通过，结果包 `/tmp/cleared-p5d-pending-only-ui-r5.xcresult`，截图 `/tmp/cleared-p5d-pending-only-ui-r5-attachments/`。系统“Ask Permission”页在另一轮出现过，但确认后的交易观察没有通过；旧模拟器清空交易造成 ID `0` 与退款墓碑冲突，空白模拟器又因磁盘空间不足未载入本地商品，故批准后自动授权的 Canvas 全链仍未验收。UI 测试均只在 `/tmp`。

另将旧模拟器克隆为独立 iOS 27 测试机 `61865A63-FF38-4284-9D6C-37ECA8E79598`，只在克隆中卸载测试 App，清除旧商业缓存和退款墓碑；Xcode Run 先确认本地商品 `$1.99` 可用，再用 `/tmp` 临时 UI 测试从 Canvas 发起 Ask to Buy。批准前画面保留购买按钮并提示内容锁定；`SKTestSession` 批准本地请求 ID `0` 后，购买按钮消失，商业 SQLite 只读结果为 `owned_verified`、`transactionID=0`、`pendingFinish=[]`。测试 1／1 通过，结果包 `/tmp/cleared-p5d-pending-clone-approved-r2.xcresult`，批准前截图位于 `/tmp/cleared-p5d-pending-clone-approved-r2-attachments/`。**发现共享 Canvas 反馈缺陷**：权益已授权，但已打开弹窗仍显示“商店处理中，确认前不会解锁”。`src/app.js` 接受新快照并重绘后，`storeDialogView()` 仍优先显示先前的 `pending` 操作文案。批准后的附件恰在 Canvas 重绘时截到空帧；测试日志的后续 OCR 文本和商业库可证明上述不一致，不能把该附件当作清晰的批准后画面。此缺陷所需 C 运行码和 H 共享锁均在当前 P5-D 逐文件白名单外，须补审后才能修改。

对曾真实触控完成六关的原 iOS 27 模拟器另做只读前置审计：普通库有精确六关、600 金币，商业库原为本地 `owned_verified`／交易 `35`。先将普通和商业目录连同 WAL／SHM 备份为 `/tmp/cleared-p5d-original-six-pre-ui.tar`；随后 `/tmp` 隔离工程的命令行 UI 测试重装 App，数据容器 UUID 改变，启动刷新未看见旧交易，将商业状态改为 `not_owned` 并把 `35` 加入失效列表。测试 OCR 只见 `6/200`、未见“继续游戏”，因此**失败且不构成第七关或自然连续流程证据**；这次本地 StoreKit 会话的交易缺失也不能判为游戏退款缺陷。Xcode 在测试报告失败后未完成结果包收尾，已中止悬挂进程。模拟器关闭后，把两目录从备份恢复到新容器，并以逐文件字节比较确认与测试前一致，商业库复核为交易 `35` 的 `owned_verified`。目录属性复核显示商业目录仍有 `com.apple.metadata:com_apple_backup_excludeItem=com.apple.MobileBackup`，普通目录无此排除属性；`installation-id` 文件也逐字节一致。这只恢复了本地文件与属性，不能证明真实 OS 备份，不证明以后无该交易的会话启动时不会再次去权。后续验证必须先确认测试会话能查询同一笔本地交易，并避免测试重装改变“同一安装”的前提。

同一模拟器的补充直启实验（2026-09-27）没有重装 App：不设本地测试环境变量时，实际系统截图 `/tmp/cleared-p5d-original-direct-launch.png` 显示 `6/200`、600 金币和“解锁完整版”；商业 SQLite 此时仍保存交易 `35` 的 `owned_verified`，与 `ClearedStoreKitOwner` 在未启用本地测试时对 JS 失败关闭的代码一致，不能将该画面误判为落盘去权。随后以 `SIMCTL_CHILD_CLEARED_STOREKIT_LOCAL=1` 重新启动**同一安装**，但没有重连原 Xcode StoreKit 交易会话；截图 `/tmp/cleared-p5d-original-gated-launch.png` 仍显示 `6/200` 和解锁入口，商业库变为 `not_owned`、revision `46`，失效列表新增 `35`，普通库四个记录 key 保留。这与启动查询未返回原交易并进入 `reconcile()` 完整空查询去权分支一致；没有记录到原交易会话的直接查询结果，不能把它判作退款或门禁缺陷。关闭模拟器后又从上述备份恢复普通、商业目录，逐文件字节比较通过，商业备份排除属性仍在、普通目录仍无该属性。当前模拟器已关闭，恢复后的旧交易在无对应本地会话的下一次启动仍可能再次失效。

公开 `XCUICoordinate.press(forDuration:thenDragTo:)` 仅指定一个终点，本机 `simctl io` 无触控注入操作；仓库 `data/solutions.js` 的六关解答里，除 `0:0` 外均至少有一条需要一次按住时转弯的路径。因此当前单段拖动的临时 UI 测试和 Computer Use 不能无夹具重走六关。下一次连续流程验收需在**同一安装与可查询的同一 Xcode 本地交易会话**中用可连续经过多个格子的真实触控完成六关，再从 Canvas 购买并进入第七关；不能用拆段拖动、注入进度、重装或只看商业库状态替代。[Apple 的公开坐标拖动接口](https://developer.apple.com/documentation/xcuiautomation/xcuicoordinate)。

仍未验收：上述批准后弹窗文案修复与清晰截图、同一安装自然连续六关→购买→第七关、系统真实低空间、iOS 15 系统运行、真机备份／重装与断电、App Store 沙盒及发布。当前临时 UI 测试和 Computer Use 都只提供起点到终点的单段拖动，而六关解法包含转弯且须在一次触摸中完成；需用可连续经过多个格子的实际触控补测，不以拆段拖动或注入进度冒充。Android 新增工作暂停，`shared-source.lock.json` 仍锁定 C 的 `0b53ad6bab9845e855f136b61a3a707817bf0472`，共享运行码／catalog／产品合同未变；`nativeCopyEligible:false` 保持。
