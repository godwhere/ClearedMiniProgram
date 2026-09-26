# 微信小游戏到独立 App：架构准备方案与严格代码边界

> 初稿日期：2026-09-08；本次更新：2026-09-27。
> 状态：语言本地化已完成本地实现，作为现有能力保留；App 化已实施 P0、P1、P2、P2.5-A／B／C、P3、P4、P4.5、P5-A／B、P5-C 的原生调试宿主与普通 SQLite 存档，以及 P5-D 的 iOS 本地 StoreKit 模拟。用户要求先完成 iOS、暂缓 Android 新增工作。`dist/native-web/` 已是可玩候选，但原双模拟器验收条件未改，`nativeCopyEligible:false`。P2.5-B／P4 的 fake store 和 P5-D 的本地交易都不代表真实购买。开发者工具、模拟器、真机、商店沙盒与上架证据不能互相替代。
> 当前授权：用户于 2026-09-22 授权按阶段实施并要求每个独立任务通过 GitHub Desktop 提交，随后分别批准 P4.5、P5-A、P5-B、P5-C 的逐文件建议值和本机调试签名，以及仅限 Xcode 本地模拟的 P5-D；另补充批准 H 的 `tests/browser-smoke.js` 纳入 P5-B。上述阶段均已本地提交且未推送。P5-C 的 C 代码白名单为空，P5-D 的 C 白名单只有本方案与阶段合同文档。真机专属验收继续暂缓；P4.5 双模拟器证据只适用于独立合成工程。App Store Connect 商品、沙盒真实购买、服务器／云服务变更、发行签名、安装包上传、送审与发布仍未获授权。
> 本轮 P0 审计起点：本地 `main` 的 `984303becf8afab1dcd4fc855cc4128f4e1d9460`，tree 为 `544090431fc5c514b38898d47bb2ecf75dffce33`；开始时工作区干净并跟踪 `origin/main`。`0fde16caa6c9732306141d2884cd8cfda0194f8f` 是上一轮远端文档审阅起点，`5010d7ce067bf0f412cd28dba452218c3b95bf26` 是 2026-09-09 的历史账号页／本地化核验节点，初稿基线为 `cf8bcab8776f742aea0f2cff9830d3a72732f0d8`。每个代码阶段仍须以届时最新 HEAD 重新刷新差异、测试、分包和包体。
> 客户端根目录 C：`/Users/ethan/Projects/ClearedMiniProgram`。下文施工路径相对 C，除非另有说明；P4 已将独立 App 宿主根目录 H 冻结为 `/Users/ethan/Projects/ClearedApp`，位于 C 之外。
> 相关约束：[玩法架构](gameplay-extension-architecture.md)、[单方案结算](single-mode-settlement-plan.md)、[当前联网方式](cloudbase-local-first-sync.md)、[奖励解锁](reward-unlock-system.md)、[体力](stamina-system.md)、[每日挑战](daily-challenge-mode.md)、[回廊与特效](corridor-and-clear-effects.md)、[App 编排减负](app-orchestration-refactor-plan.md)、[主题分包](package-splitting.md)、[已实现的语言本地化](localization.md)。

> 工作归属：`5010d7c` 的账号页修改是用户独立完成的操作，不属于本方案的实施成果。它作为现有可复用基础保留；账号数据不互通不等于账号页代码不能共享。

## 1. 结论与产品边界

保留现有 CommonJS JavaScript＋单 Canvas 游戏主体，逐步形成：**一份共享游戏代码、独立平台入口、独立产品存档，以及按宿主注入的产品能力。** 微信小游戏继续使用现有在线体系；App 首版采用无需登录和玩法服务器的单机模式。

本轮目标是为未来 App 打基础，不是立即交付两个正式客户端。不更换引擎，不复制一份游戏长期独立维护，不迁移服务器，不改变微信端的结算权威。

**微信开发者工具直接导入、编译、预览和上传的现有方式必须保持。** App 专用工程和构建依赖隔离到独立宿主，不能要求微信端先构建 App、安装依赖或更换上传入口。此项是后续改造的硬验收条件，不是对尚未实施代码或微信后台审核结果的无条件保证；详见第 7.3—7.5 节。

### 1.1 已明确的需求

- 微信小游戏继续维护和发布。
- 未来希望制作 App，上架软件商店。
- App 使用独立宿主工程，默认位于当前微信项目根目录之外并单独管理原生构建；当前仓库继续作为共享游戏规则、内容、Canvas UI 和素材的唯一源码来源。
- 不从零重写玩法，也不复制一份可编辑的 App 专用 `core`／关卡／Renderer；App 只新增宿主入口、平台适配、本地存储、商店购买和产品策略。
- 微信小游戏与 App 的用户、进度和资产不互通。
- 已有一台美国服务器和一台上海腾讯服务器；App 首版不接入它们，服务器与现有云服务保持不变。
- 语言本地化已经完成，现有 `zh-CN`／`en-US` 词典、语言服务和账号页切换器直接复用，不平行建设第二套方案。
- 现有账号页修改属于用户的独立工作。App 首版不需要账号或登录页，但正式发布必须提供可发现的“恢复购买”入口；可在设置页复用既有账号页布局和通用交互，也可使用独立的购买面板，不默认复制整页。
- App 首版为单机游戏：进度、金币和回廊拥有权保存在 App 自己的本地存档中，不要求登录、云存档、CloudBase 或自建玩法服务器。
- App 采用“免费下载试玩前 6 个主线关卡 → 一次性购买完整版”的模式；完整版是 Apple／Google 商店中的非消耗型永久权益，不采用付费下载后才能安装的模式。
- App 首版不提供每日挑战，也不接入任何广告 SDK、广告位或广告形式（包括激励、插屏和横幅）；未来如需增加必须单独确认。App 首页不显示或注册每日挑战入口，App 包不因共享代码存在而启动每日日期、次数或奖励流程。
- 仅在 App 模式中，回廊内原本要求激励广告或分享解锁的项目统一改为消耗 `10000` 金币永久解锁；既有奖励 ID、主题／特效 ID 和微信端规则不变。
- App 首版普通提示走纯本地免费路径，不以广告、分享或金币解锁；结果分享等不产生奖励的社交能力默认关闭，后续启用时不得改变本方案的购买或奖励合同。
- App 的完整版权益与 iOS／Android 各自的商店账号绑定；首版不提供跨商店共享购买，也不把可编辑的普通存档布尔值当作购买凭证。

### 1.2 尚未替用户决定的事项

- App 首发操作系统、商店与发行地区。
- Apple／Google 的商品 ID、显示价格、税务档位及首发促销策略。
- 原生容器与正式本地存储实现；首版不要求登录或云备份，但未来是否另增这些能力仍需独立立项。
- 是否在后续版本建立 App 账号并允许 iOS／Android 共享权益；首版明确不互通。

“本地化”已明确为语言本地化，不再作为待确认事项，也不代表批准本地结算或切换资产权威。

### 1.3 现在做与以后做

| 现在的准备工作 | 留到正式 App 阶段 |
| --- | --- |
| 通用启动不再必须创建微信平台 | Android／iOS 正式原生工程、签名与安装包 |
| 明确画面、输入、生命周期、存储和资源合同 | 正式原生持久化与设备回归 |
| 划清产品、环境、购买权益与存档边界 | 商店沙盒、恢复购买和正式存档验收 |
| 保留现有双语运行时与语言存储，验证平台提取不造成回归 | App 商店文案、新增原生页面文案及各宿主视觉验收 |
| 以第二宿主验证同一份源码；随后执行 P4.5 最小原生存储验证 | StoreKit／Play Billing 一次性购买、隐私和上架验收 |

P4.5 只使用独立宿主中的测试工程和合成存档，验证原生提交语义，不提前开放正式存档、真实购买或发布权限。

## 2. 当前代码事实与调整理由

### 2.1 应保留的基础

- 真实入口是 `game.js → src/bootstrap.js → src/app.js`，不是 Cocos 或常规网页工程。
- `core/` 是纯规则；`src/gameplay/` 负责 RunContext、棋盘输入和完成策略。
- `src/services/` 已有进度、每日挑战、奖励、体力、提示、音频和同步等业务所有者。
- `src/ui/` 负责 Canvas 绘制与 ViewModel；棋盘规则不属于 Renderer。
- `src/platform/wechat.js` 已集中封装微信 API。
- 关卡、解答、机制、主题和特效通过稳定数据契约共享，不必为 App 重写。
- `src/i18n/` 与 `LocaleService` 已实现双语及设备级语言选择，bootstrap 注入同一实例；这些是现有能力，不是 App 化待建模块。

### 2.2 必须处理的实际耦合

| 当前证据 | 问题 | 调整原则 |
| --- | --- | --- |
| `src/bootstrap.js::start` 创建 `WechatPlatform`，并装配 CloudBase | 通用游戏启动与微信启动混在同一组合根 | P1 提取通用装配的直接职责；微信环境与云服务继续留在原入口 |
| `src/app.js` 保留广告配置、每日默认模块，以及方法内的 `AuthoritativeStateApplier` 等依赖 | 抽出组合根不等于其整个传递依赖图已经纯净 | P0 登记既有传递依赖，P2.5-A 清理产品默认依赖，P4 以真实产物验收；不在 P1 偷改 App |
| 平台音频、广告、资料按钮、分包接口具有微信语义 | 同名 API 不代表 App 行为等价 | 约定输入、结果、失败和生命周期语义，再实现适配 |
| `AuthService`、`ApiClient` 校验云环境、玩家身份、绑定版本和回执 | 接自有后端不是替换 `baseUrl` | 后续独立审查身份与协议映射，不放松现有校验 |
| `setStorage` 同步返回布尔值，业务据此确认提交 | 原生异步存储不能直接伪装成同步接口 | 当前冻结合同；P4.5 先验证原生提交语义，P5 再实施共享调用链的必要改造 |
| 双语词典、LocaleService、Renderer／App／分享／资料消费者已接入 | 拆启动或增加宿主时可能丢失注入、误改回退或重建语言状态 | 复用现有语义 key 和单一语言实例，执行本地化回归，不重新建设 |
| `bindLifecycle` 没有返回完整解绑能力 | 第二宿主重挂载可能重复监听 | 单独补启动／销毁合同与回归 |
| `ClearedApp` 当前默认创建广告、每日服务和每日 store，Renderer 总是绘制每日入口 | 仅在宿主“不注入”这些能力仍会自动回退创建，无法满足 App 能力裁剪 | 增加显式产品能力合同；显式关闭时不得回退创建、绘制、注册 action 或打包排期数据 |
| `recoverRewardUnlocks()` 当前要求普通与每日两个完成来源都成功 | 直接移除每日 store 会让普通关首次通关金币无法确认 | 每日能力关闭时使用受测的空完成来源 `{ok:true, days:[]}`；不得为拿到金币而保留每日业务 |
| 普通关进入只判断玩法进度与体力 | 隐藏第 7 关按钮不能阻止续玩、下一关或直接入口绕过完整版权益 | 注入纯内容访问策略，所有进入路径在同一门禁判断后才能启动 Runner |
| 广告／分享解锁和 CloudBase 目前由微信产品入口装配 | App 首版产品能力不同，但共享代码不能被全局改写 | 由 App 宿主注入声明式功能与奖励策略；微信配置保持原样 |

2026-09-09 已核对 `src/i18n/index.js`、两份词典、`src/services/locale-service.js`、平台语言读取、bootstrap 注入及相关测试。用户确认语言本地化完成；当前本地化专题文档仍将开发者工具、真机与发布检查列为待验。本轮不把这些事项自动标记通过。

### 2.3 App 首版内容与商业合同（2026-09-21）

| 项目 | App 首版合同 | 不得推导出的行为 |
| --- | --- | --- |
| 免费试玩 | 仅当前主线 catalog 的 `0:0`、`0:1`、`1:0`、`1:1`、`1:2`、`1:3` 六个稳定 `levelKey` 具有免费访问资格；仍按原主线进度顺序解锁，解锁后可进入、重玩并可靠保存 | 不按“已完成任意 6 关”放行，不一开始解锁全六关，不重编号关卡，不让 catalog 重排静默改变试玩内容 |
| 完整版 | 除上述六关外的全部玩法内容，包括第 7 关及后续主线、Portal／冰封主线和现有 `home:iceTrial`，由一个非消耗型永久权益门禁；购买成功或恢复成功后移除商业门禁，原玩法／进度解锁规则仍然生效 | 不一次解锁所有关卡进度，不自动授予回廊全部项目，不把取消、待处理、未验证或仅本地勾选视为成功 |
| 购买入口 | 访问受限内容时返回统一 `requires_full_game` 结果并打开“购买完整版／恢复购买”面板；设置或首页可另提供可发现入口 | 不在通关后自动发起交易，不在缺少直接用户操作时弹原生购买框，不硬编码币种或价格 |
| 离线使用 | 已由商店验证的完整版权益可安全缓存，供之后离线启动；联网时按平台合同刷新 | 不要求每局联网，也不因暂时离线删除已经可靠确认的权益 |
| 每日挑战 | App 不显示入口、不创建每日运行、不发每日 `500` 金币；共享实现仅为微信兼容保留 | 不删除微信每日数据、action、测试或专题文档，不把隐藏入口等同于删除共享代码 |
| 广告 | App 首版不装配任何广告能力、不显示广告，也不以广告作为提示、次数、回廊或经济来源 | 不用假成功、免费回退或本地模拟回调发奖；未来广告需重新评估隐私和商店范围 |
| 回廊 | App 将所有 `rewarded_ad`／`share` 解锁条件解析为 `currency`，单项价格统一为 `10000`；当前快照涉及 `ocean`、`spring`、`music`、`vehicles`、`festival` 五个主题；首版金币仅为游戏内本地资产，不销售金币包 | 不修改共享稳定 ID，不改变微信端原解锁方式，不因购买完整版自动拥有这些项目 |
| 提示与分享 | 普通提示在 App 首版使用纯本地免费模式；结果分享等无奖励社交入口默认关闭 | 不从分享结果发奖，不把 App 默认策略全局写回微信配置 |

六关之后的内容门禁必须同时覆盖选关、首页续玩、结果页下一关、试玩入口和直接 `openLevel` 调用，并在扣体力或创建 Runner 之前返回统一结构化原因。由用户点击购买后才调用原生商店，同一时间只允许一个主动购买流程；商店未知／不可用时保留六关试玩并提供重试。发起购买、取消购买、商店不可用或购买仍为 pending，都必须保留已保存的前 6 关进度和金币，不扣体力、不重复发放首次通关奖励。购买完成只改变完整版访问权益；主线进度、金币和回廊拥有权继续按各自合同保存。单飞限制不意味着停止处理商店主动通知或此前 pending 交易的完成事件。

本文不评估金币总产出、收集速度、价格曲线或能否买齐全部回廊项目，也不把这些内容列为 App 架构或上架验收条件。

## 3. 目标依赖结构与职责合同

目标是少量可验证的边界，不是新建通用引擎、插件框架或全局事件总线。

```text
ClearedMiniProgram（共享源码唯一来源＋微信宿主）
├─ 微信入口 game.js → bootstrap（微信平台、微信配置、现有在线服务）
└─ 通用游戏源码／catalog 快照／runtime 合同版本
   ├─ core、gameplay、data、i18n
   ├─ 可复用 services、ui、assets
   └─ 通用游戏装配、纯策略合同与查询
                    │ 固定源码版本／只读构建输入
                    ▼
ClearedApp（独立宿主工程 H）
└─ App 入口、Canvas 宿主、AppPlatform、本地存储、商店权益服务、产品配置
                    │
                    ▼
          App 场景与业务顺序编排
            ├─ gameplay → core
            ├─ services → 各自领域状态与持久化
            └─ ui → 纯 ViewModel 与 Canvas 绘制

平台 API、原生 SDK、网络传输通过注入的适配能力访问。
通用游戏装配不反向导入任何具体宿主入口。
```

| 层级 | 允许负责 | 严格禁止 |
| --- | --- | --- |
| 平台启动入口 | 选择平台、环境、配置和在线实现；装配依赖 | 算奖励、操作棋盘、绘制 UI |
| 通用装配 | 创建通用依赖、连接 App、启动本地游戏 | 导入微信实现、读取云配置、按语言或系统选择服务器 |
| 产品能力／内容访问策略 | 声明功能是否存在、解析宿主白名单和完整版门禁 | 调用平台 SDK、发奖、保存、按 iOS／Android 分支 |
| `core/` | 棋盘规则、结构化结果、只读查询 | 平台、存档、登录、语言、广告、支付 |
| `src/gameplay/` | 关卡来源、输入转译、按进度域完成策略 | 微信分支、原生 SDK、云请求 |
| `src/services/` | 各自领域状态、校验、保存与恢复 | 访问平台私有对象、另建钱包／进度副本 |
| `src/app.js` | 场景、执行顺序、界面异步结果有效性校验 | 直接调用宿主 SDK、复制规则、持有第二套业务资产或商店权益权威 |
| `src/ui/` | 绘制、文字测量、布局与命中区域 | 读写存档、发奖、根据翻译文字判断业务 |
| 平台适配 | Canvas、输入、设备能力与结果归一化 | 因平台不同直接增加金币、授予游戏内奖励或改变胜负 |
| 宿主级商店权益服务 | 验证、归并、持久化商店权益，去重并确认交易，发布只读快照 | 依赖购买面板是否存在、直接改普通游戏存档或自动跳转关卡 |
| 本地化 | 翻译、参数插值、展示格式 | 改稳定 ID、结算日期、账号归属或数据地区 |

### 3.1 独立宿主工程与单一源码所有权

App 工程采用独立宿主边界，工作名可为 `ClearedApp`；实际路径和仓库名在 P4 建立时记录，但必须位于客户端根目录 C 之外。默认使用独立 Git 仓库，或在同一父级工作区中保持独立仓库根；不得把 `ios/`、`android/`、原生 SDK、App 打包器或 `node_modules` 放进当前微信项目根目录。文中的 `ClearedApp` 宿主工程与 `src/app.js` 导出的 `ClearedApp` 类不是同一对象。

| 所有者 | 位置 | 负责内容 |
| --- | --- | --- |
| 共享游戏源码 | 当前 `ClearedMiniProgram` 仓库 | `core/`、`data/`、`src/gameplay/`、`src/mechanics/`、`src/i18n/`、可复用的 `src/services/`／`src/ui/`、`assets/` 及对应测试；仍以实际依赖审计结果为准 |
| 微信宿主 | 当前 `ClearedMiniProgram` 仓库 | `game.js`、`src/bootstrap.js` 的微信装配、`src/platform/wechat.js`、CloudBase／微信配置、分包、开发者工具和上传合同 |
| App 宿主 | 独立 `ClearedApp` 工程 H | App 入口、HTML／Canvas 壳、App 平台适配、原生生命周期与存储桥、StoreKit／Play Billing、App 产品配置、App 构建和 `ios/`／`android/` 工程 |
| App 构建产物 | H 的生成目录 | 从固定共享源码版本打包出的只读 JS／数据／素材快照；允许进入安装包，但不是第二份源码 |

共享代码流转必须满足：

- 规则、关卡、机制、通用 UI 或通用服务的修改先进入当前仓库并通过其测试；App 宿主只升级所引用的共享源码版本。
- P4 首版不使用 Git submodule；App 仓库保存 `shared-source.lock.json`（或等价的机读锁文件），只固定共享仓库 URL／路径、完整 shared commit、tree hash、runtime contract version、产品策略 hash、catalog 顺序／hash、`full_game_v1` 与六关 `levelKey`。它不记录所在仓库的 host commit，避免自引用哈希；CI 生成的 `build-provenance.json` 再记录 host commit、锁文件摘要、工具链版本和构建时间。发布构建遇到任一工作树未提交或锁文件不匹配必须失败。
- App 专用入口、存储、商店购买和产品配置留在 App 宿主；只有两个宿主都需要且职责确属通用层的接口，才回到当前仓库做最小抽取。
- 不在 P0—P3 预先搬迁整个仓库、建立大而全的共享框架或改成新 monorepo。若 P4 证明版本传递不可维护，再以独立方案评估共享包或仓库重组。
- App 发现共享缺陷时，应在共享源码处修复并让微信回归；不得仅在 App 的生成副本打补丁形成永久分叉。

**策略合同与产品取值不是同一份源码：**

| 内容 | 唯一生产归属 | 约束 |
| --- | --- | --- |
| 策略结构、校验、纯内容访问查询、空每日完成源 | 共享 `src/runtime/product-policy.js` | 不硬编码 App 六关、价格或商店商品映射；不导入宿主 |
| 微信兼容默认装配与现有配置 | 微信 bootstrap／原有配置 | 不接受 App 覆盖反向修改；既有直接构造测试的兼容路径在 P0 登记 |
| 六关取值、`full_game_v1`、禁用能力和回廊覆盖参数 | H 的单一 App 产品配置 | 由宿主注入，P4 冻结具体文件路径；不是共享模块的隐式默认 |
| P2.5 的 App 策略样例 | `tests/fixtures/app-product-policy.js`（拟新增） | 只用于测试；生产代码不得导入它，也不得把它升级为另一份生产配置 |

P4 将宿主规范化配置与本文冻结值、测试 fixture 及锁文件逐项核对；计算 hash 时固定对象键排序并保留有语义的数组顺序。差异必须显式复核，不能靠同时改 fixture 和期望值掩盖产品变化。

### 3.2 通用装配的最小实现

拟新增 `src/runtime/game-runtime.js`，只承担两段现有工作：

1. 创建通用本地业务服务，供具体入口继续装配其在线服务。
2. 接收装配完成的依赖，创建 App 并完成共有连接与本地启动。

不建立服务定位器、动态依赖注册表或任意启动钩子系统。`ClearedApp` 已有的构造回退和领域所有权继续保留，但必须区分“未传入”和“显式关闭”：`undefined` 才允许进入已登记的微信兼容默认路径，`false`／`null` 或明确的 disabled provider 不得回退创建每日、广告或分享服务。App 宿主必须显式提供产品配置；不靠漏传参数选择单机模式。通用入口同时暴露可检查的 `runtimeContractVersion`，宿主锁文件与运行时必须一致。

微信 `bootstrap` 继续负责创建平台、选择配置、创建现有身份与云服务、注册微信相关行为及安排原有在线工作。通用层与入口的拆分必须保证：

- `bootstrap.start()` 的参数兼容性不变，仍同步返回 App。
- 本地启动不等待网络；在线工作仍安排在本地启动之后。
- develop／trial／release／unknown 的选择顺序、异常回退和 release 隔离不变。
- `localBackupEnabled` 仍固定关闭，不恢复历史备份装配。
- 开发者工具解锁和每日测试日期仍遵守原有环境边界。
- 不在 App、Renderer、规则或业务服务中增加 `typeof wx`、系统名称等平台分派。
- 现有 LocaleService 只创建一次并继续注入 App、Renderer、ShareService、ProfileService；保留正式语言解析和轻量旧宿主的兼容回退，不新建第二套语言状态。
- 提取后的通用模块使用明确的 CommonJS 字面量依赖并位于微信可入包路径；不能用动态路径加载替代原依赖，不能在微信启动时连带导入其他宿主。

P1 的“不导入具体宿主”检查限定为新通用组合根的直接依赖与装配职责；其经过既有 `app.js` 引入的传递依赖必须如实登记，不冒充已经消除。P2.5-A 才处理产品默认依赖；P4 再验证最终 bundle。既有安全测试保持有效，不能用这一区分豁免任何原有信任边界。

### 3.3 平台能力合同

先保留现有平台接口形状，不强制拆成多个类，不建立无人消费的能力注册表。新增能力只服务于已批准的调用者。

| 能力 | 不可省略的合同 |
| --- | --- |
| Canvas | 使用逻辑坐标；受控 DPR；适配层处理实际像素和尺寸变化 |
| 安全区 | 保持当前字段语义；`safeBottom` 是底部坐标，不是底部留白高度 |
| 输入 | 输出稳定指针 ID 和逻辑坐标；明确取消、多指、移出画面、恢复后的行为 |
| 生命周期 | 前后台事件去重；监听可解绑；暂停游戏、取消输入与音频顺序可验证 |
| 帧循环 | 保持现有时间戳含义；不能将相对帧时间直接替换当前绝对时间 |
| 图片／资源 | 区分未加载、加载中、成功、失败；损坏或不可用时保留经典主题回退 |
| 音频 | 归一化播放、暂停、中断、错误及首次交互限制 |
| 广告／分享 | 微信保持原合同；App 首版完全不装配广告 SDK、广告服务或奖励分享，回廊对应条件由 App 奖励策略改为金币，不得伪造完成凭证 |
| 一次性购买 | 区分购买成功、取消、pending、失败、已拥有和恢复；只有平台验证或可靠恢复的非消耗型权益才能开放完整版 |
| 隐私入口 | 平台负责打开方式，App 负责展示时机与失败反馈 |
| 存储 | 缺失、损坏、读失败、写失败不能混为一谈；确认成功必须对应实际提交合同 |
| 系统导航 | 首版固定竖屏；Android 返回键先关闭游戏内弹层，再返回上一场景，仅首页可触发系统退出语义 |

完整版商店通过一个注入对象向共享 App 提供最小合同：

- `current()` 同步返回不可变的权益快照，包含逻辑商品 ID、第 4.7 节状态、来源、交易标识（如有）、最后成功验证时间和同一 provider 实例内单调递增的 `revision`；价格元数据来自商店，不承担授权作用。
- `refresh(reason)`、`purchase()`、`restore()` 异步返回 `{ snapshot, operation }`。`snapshot` 是同一权益所有者产生的当前快照；`operation` 只描述本次操作的类别、成功／取消／pending／失败及是否可重试，不是另一份权益状态。
- `subscribe(listener)` 返回可调用的解绑函数。共享 App 可持有只读展示投影，不自行写 `owned`、不保存交易凭据。
- `dispose()` 可重入，由创建 provider 的宿主负责调用。共享 App 的 `dispose()` 只解绑自己的订阅和界面回调，不因一个页面或 Canvas 实例销毁而终止仍需处理的宿主交易。
- 缺少 provider 时返回不可用，不授予完整版。原生交易对象、签名材料和原生存储细节不暴露给共享代码。

场景代次只用于丢弃旧面板反馈和自动跳转，不决定交易是否有效。宿主实例有效性、权益状态归并和交易持久化遵守第 4.8 节；关闭购买面板不是取消商店交易。

### 3.4 平台能力与产品规则分开

“App 首版没有广告”和“缺少广告 API 时免费发奖”不是同一件事。App 必须由宿主注入单一的声明式产品配置，而不是在 `RewardUnlockService`、App 或 Renderer 中散布 iOS／Android 判断。下列是已批准的 App 产品取值，不是共享模块默认值：

- `dailyEnabled:false`、`adsEnabled:false`、`rewardedShareEnabled:false`、`resultShareEnabled:false`、`hintMode:'free'`。
- `freeLevelKeys:['0:0','0:1','1:0','1:1','1:2','1:3']`、`fullGameEntitlementId:'full_game_v1'`、`iceTrialRequiresFullGame:true`。`full_game_v1` 是两平台共用的逻辑 ID，P5 只将它分别映射到 Apple／Google 真实商品 ID，不在存档或 UI 中用商店 ID 取代。
- 每日功能显式关闭时，为历史奖励核对注入空完成源 `{ok:true, days:[]}`；不得为保留普通关首通金币而创建每日进度、日期键或结算。
- 内容门禁是 App／Progression 共用的纯查询，同时覆盖 `home:start`、选关、结果页下一关、`home:iceTrial`、试玩入口和直接 `openLevel`；Renderer 只渲染可用态，不是安全边界。
- 购买面板使用稳定 action `store:purchaseFullGame`、`store:restorePurchases`、`store:retry`、`store:close`；受限内容统一返回 `requires_full_game`。这些 ID 不翻译，也不复用微信“同步”或回廊金币购买 action。
- App 宿主在创建 `RewardUnlockService` 前注入覆盖后的奖励配置，仅将 `rewarded_ad`／`share` 解析为 `currency:10000`；微信继续使用共享目录原条件。
- 策略只改变功能可见性、内容访问和解锁条件，不改奖励 ID、素材 ID、玩法规则或微信存档；不得自动发奖、伪造广告／分享完成或把购买取消解释为成功。

共享策略只校验并解释输入。App 具体取值、覆盖配置和 hash 的生产所有者均为 H；P2.5 只在测试 fixture 中表达这些取值。不得在共享运行码与 App 宿主各写一份六关或价格常量。

### 3.5 资源边界

- 保留主题 ID、素材路径、manifest、`SubpackageService` 及现有失败回退。
- 微信继续使用原有分包；App 原型优先随安装包携带资源。
- 当前微信基线包含 10 个主题分包和 1 个 `audio-bgm` 分包；App 必须显式列出所需图像、音频和字体，不得因微信分包 API 不存在就略过资源完整性校验。
- App 构建不包含微信云环境配置、每日排期数据、广告配置或广告 SDK；通过产物扫描证明，不仅依赖源码未执行。为保持一份共享 App 编排，bundle 中若仍有无数据、不可达的每日／广告兼容分支，必须在产物清单中单独记录并用测试证明无 UI、无 action、无服务实例、无网络／平台调用；商店扫描或包体预算不接受时再触发模块拆分，不假称它已被移除。
- 第二宿主必须验证打包资源实际存在且可加载，不能无条件报告分包成功。
- 准备阶段不改主题素材、不新增 CDN、热更新、远程脚本或资源版本管理器。
- 只有已确认需要远程资源时，才按具体容量、加载和失败需求扩展下载与缓存。

## 4. 产品身份、存档和结算边界

### 4.1 微信与 App 按产品隔离

区分产品与环境，不把操作系统名称直接当成用户命名空间。App 首版不创建业务账号：iOS 与 Android 各自依赖本平台商店账号恢复完整版，购买权益和本地存档不跨平台同步。

| 对象 | 必须隔离的内容 |
| --- | --- |
| 身份 | 不以微信玩家身份自动建立 App 账号；App 首版也不强制创建独立登录账号 |
| 本地存档 | 不自动发现、读取、迁入另一产品的存档 |
| 商店身份 | StoreKit／Play Billing 只在各自平台适配层使用；不把商店账号标识写入普通游戏存档 |
| 待办和恢复 | 不跨产品重放同步、购买、奖励和恢复记录；完整版恢复只采用当前商店的受信任结果 |
| 云数据 | App 首版没有玩法云数据；微信现有 CloudBase 不作为 App 数据源 |
| 统计 | 区分产品及环境，不混算用户与事件 |
| 导入导出 | 结构相同不代表有权跨产品恢复；必须校验来源与用途 |

客户端增加 `productId` 本身不是安全隔离。若未来增加跨平台账号、云存档或服务器权益，服务器必须验证身份与产品绑定，不能信任客户端随意声明的产品、账号或环境；该能力不属于首版。

### 4.2 不改当前微信 key 和协议

- 微信端保留现有物理存档 key、schema、迁移与恢复逻辑，不批量重命名 `cleared:minigame:*`。
- 第二宿主／App 在存储适配层使用独立物理命名空间；业务仍使用既有逻辑 key，不在每个服务中判断平台。
- App 首次启动创建自己的空档，不寻找或导入微信旧档。
- 现有 `ownerId`、`environmentId`、`bindingEpoch`、作用域代次与异步保护保持原合同，不为准备工作直接扩展已验证的持久化字段。
- 不清除用户的存档、云待办、恢复记录、历史身份或冻结状态。

### 4.3 同步保存与异步原生存储必须分阶段处理

当前平台 `setStorage` 同步返回布尔值，业务据此判断是否提交。禁止实现“写入内存 → 发起后台原生保存 → 立即返回 true”的假同步适配。

准备阶段冻结现有合同并补失败测试，不全仓异步化。P2.5-C 只在同步测试存储合同上验证本地业务逻辑，不声称已解决原生持久化；P4.5 先完成最小原生存储验证，再进入 P5 的正式提交链路改造。

正式 App 存储阶段需单独设计：

1. 测量真实存档体积与写入频率，再选择持久化方案。
2. 采用异步原生存储时，建立候选状态 → 等待提交 → 成功后确认业务结果的链路。
3. 启动预加载可以解决读取时机，但不能证明后续写入已经可靠完成。
4. 扣款与所有权、奖励与领取记录须有一致提交／恢复机制，不能只保存其中一项。
5. 本地失败、云端待同步和未持久化显示分别表达，不虚报保存成功。
6. 强退、重启、升级、空间不足与重复提交测试通过前，不承载正式玩家存档。

Capacitor Preferences 返回 Promise；官方提示移动系统可能清理 `localStorage`，并说明 Preferences 是轻量键值存储而非通用数据库。因此浏览器保存测试不能代替 App 持久化验收；使用 `await` 也不自动证明多字段原子性或崩溃持久性，必须核对具体实现的成功语义并实测。[官方说明](https://capacitorjs.com/docs/apis/preferences)

### 4.4 微信正式结算保持不变

当前只有“本地保存＋低频批量云结算”一条正式运行链路。必须保留：

- 待同步奖励仅为只读预显示，不变成可消费余额或第二份钱包。
- 购买等待有效云确认，失败不扣币、不授予所有权。
- 断网不切换本地发币，不清空待办以伪装同步成功。
- `progress/daily/economy/entitlements/stamina/preferences` 六域分别判断权威。
- 账号、环境或绑定变化后，旧请求结果不能写入当前存档。
- 历史 `legacy-local`、`migration-freeze`、`local-backup` 的兼容、阻断和恢复保护不因平台改造而删除。
- 不打开备份开关，不部署历史备份协议，不重置玩家数据。

### 4.5 App 首版本地结算与购买权益

App 首版已经确定为独立单机产品。共享领域权威解析增加明确的 `app-local` 模式：`progress/economy/entitlements/stamina/preferences` 只执行 App 本地提交，`daily` 为 disabled；不创建 SyncStore、待同步队列、CloudBase 请求或历史 `local-backup` 类型。这里的领域 `entitlements` 是回廊拥有权，不是商店完整版凭证。金币产出与价格曲线不属于本文评估范围；本文只冻结 App 回廊覆盖价格 `10000`。

- `app-local` 只能由显式 App 装配与独立存储命名空间共同选择，不以网络失败、缺少 SyncStore 或存档中自报模式触发。不能只在允许模式数组里加字符串而遗漏实际写入准入。
- 已处于微信云权威、迁移冻结或历史备份保护的实例不得切换为 `app-local`；本阶段不迁移微信实例或历史真实数据。
- 本地游戏状态必须可靠、一致地保存；金币扣除和回廊拥有权不能只成功其中一项。首通记录先持久化，奖励账本再按稳定关卡键幂等核对；中途失败可重启补办，不要求把既有所有 Store 强行合并成一份存档。
- 完整版权益不是普通游戏资产。其权威来源是 StoreKit／Play Billing 的已验证非消耗型购买或恢复结果，本地只保存可离线使用的可靠缓存。
- 免费试玩存档升级到完整版时原地保留，不迁移微信用户，不重置前 6 关进度、金币、设置或回廊拥有权。
- App 不运行每日结算，不发每日奖励，不创建日期键或每日进入次数。
- 首版不要求自建交易服务器；如后续安全评估、商店要求或跨平台权益要求改变，再单独批准服务端验证，不把密钥放进客户端。
- 测试宿主中的假商店只能用于验证状态机，不能作为 StoreKit／Play Billing 沙盒、恢复购买或离线权益验收证据。

### 4.6 App 系统备份、卸载与恢复边界

- 进度、金币、回廊拥有权和设置可按各平台最终配置参与同平台 OS 托管备份，但这只是最佳努力恢复，不是 App 自建云存档、不保证一定存在，也不支持 iOS／Android 互转。
- 完整版本地缓存不进入普通存档备份，并绑定一个不随普通备份恢复的安装实例标识；若 OS 恢复了旧缓存，或卸载后仍残留平台安全存储数据，新安装启动时也必须忽略其授权效力，直到当前商店成功刷新。
- 用户卸载后，若 OS 备份不可用，本地进度、金币和回廊拥有权会丢失；完整版可通过原商店账号的“恢复购买”重新取得。这一差异必须在帮助／商店说明中明示。
- 备份排除、恢复后的 schema 兼容与真机卸载／重装测试属于 P5；Android 须核查 Auto Backup 规则，iOS 须核查选定存储方案的备份属性。P4.5 可以提前验证选型风险，但不能替代正式矩阵。[Android Auto Backup](https://developer.android.com/identity/data/autobackup)

### 4.7 一次性完整版权益状态机

业务只消费归一化状态：`unknown`、`not_owned`、`pending`、`owned_verified`、`temporarily_unavailable`、`revoked`。同时记录结果来源和最后成功验证时间；界面不根据按钮回调或普通存档字段自行推导拥有权。

- `owned_verified` 放行完整版；`unknown`、`not_owned`、`pending`、`revoked` 都不放行。`temporarily_unavailable` 只在同一 App 安装中同时携带未被 OS 备份恢复的既往 `owned_verified` 受保护缓存时继续离线放行；否则只保留六关试玩与重试／恢复入口。非消耗型权益不因本地超时自动过期，退款／撤销以下一次成功权威刷新为准。
- 权益状态与操作状态分开：用户取消一次购买、一次恢复失败或刷新正在进行，不直接把已经有效的权益改成 `not_owned`／`pending`。权益的 `pending` 表示尚无可用已验证拥有权；存在可用已验证权益时，另一次操作的 pending 只写在 `operation` 中。
- 启动和每次回到前台都请求宿主权益服务刷新；并发触发可以合并，不阻塞本地启动。商店短暂不可用或超时按缓存合同处理，不得删除一份之前已可靠验证的离线缓存。
- 原生商店适配必须校验预期商品 ID、App／package 身份、交易环境和平台验证结果，再向 JavaScript 返回不可变的归一化记录；不接受 JS 传入的任意 `owned:true` 或错误商品授权。离线缓存与普通存档分开，使用带 schema／来源／交易 ID／最后验证时间的原生受保护存储；客户端方案不宣称这能完全防篡改。
- 沙盒／测试商店、开发包和正式发布的权益命名空间与缓存必须隔离；测试交易不得解锁正式包，发布候选包不得携带假商店或测试授权。
- Google 仅对 `PURCHASED` 处理授权，`PENDING` 不解锁、不 acknowledgment；以 purchase token 做幂等去重，可靠落盘授权后再 acknowledgment，并在从 `PURCHASED` 开始计算的 3 天时限内重试确认。启动／回前台查询当前购买，不仅依赖当次购买回调。[Google Play Billing](https://developer.android.com/google/play/billing/integrate)
- Apple 启动时读取已验证的 `Transaction.currentEntitlements`，运行期监听交易更新；只对 verified 交易授权，可靠落盘后再 finish。[Apple 当前权益](https://developer.apple.com/documentation/storekit/transaction/currententitlements)
- App 必须始终提供可发现、可手动触发的“恢复购买”入口；恢复会调用平台正式同步，独立显示 pending、成功、未找到与失败，不伪装成云存档。[Apple 恢复购买](https://developer.apple.com/documentation/storekit/restoring-purchased-products)
- 退款、撤销或家庭共享资格失效在下一次成功的权威刷新后转为 `revoked`，移除完整版访问，但不删除游戏存档；用户重新取得权益后可继续原进度。去权结果同样需要第 4.8 节的有效性与并发校验，不从超时或不完整查询推断撤销。
- 首版不用服务器意味着反欺诈、实时退款感知和跨设备账本能力较弱；P5 必须记录这一风险接受结论。若商店要求、安全评估或实测无法接受，停工并重新评估服务端验证，不在客户端内放置服务账号密钥。

### 4.8 权益唯一所有者、并发归并与界面生命周期

**商店权益的唯一写入者是宿主级权益服务，不是购买面板、Renderer 或共享 App。** 原生交易监听、启动／前台查询、主动购买与恢复的结果统一进入该服务。Google 的购买查询用于补齐未收到回调或应用不在运行时完成的购买；Apple 的交易更新也可以来自应用外或其他设备，因此交易处理不能依赖发起面板仍然存在。[Google 购买处理](https://developer.android.com/google/play/billing/integrate)、[Apple 交易更新](https://developer.apple.com/documentation/storekit/transaction/updates)

以下是本项目的实施合同，不把它们冒充平台 SDK 已自动提供的保证：

1. **界面代次与宿主代次分离。** 面板关闭或场景切换后，丢弃旧弹层反馈与自动跳转；有效交易仍继续验证、幂等落盘、acknowledgment／finish，并通知当前订阅者。购买成功不自动进入先前被拒绝的关卡；需要继续时重新经过内容和体力门禁。宿主实例销毁或测试／正式环境切换后，旧实例不能写入新实例状态；由新的宿主从商店和可靠存储恢复，而不是重用旧 JS 回调。
2. **单一归并队列。** 查询、购买、恢复、交易通知都由同一个状态所有者串行提交，不各自维护一份缓存。单飞只限制主动交易发起；不能等待一笔可能持续很久的 pending 交易结束后才处理查询或交易通知。
3. **旧查询不得覆盖期间的新交易。** 查询开始时记录宿主内部的观察代次；收到有效交易／撤销证据或开始提交该证据时即推进代次，而不是等写入结束才推进。查询返回时若代次已经变化或关键提交仍未完成，不用其空结果或旧 `not_owned` 覆盖新事实；合并安排一次后续权威查询。不能只比较请求完成顺序或设备墙钟时间。
4. **不是永远保留 owned。** 无竞争、成功且完整的最新权益查询或有效撤销证据仍能去权；旧购买通知也不得复活已被可靠确认撤销的同一交易。冲突无法判定时重新查询，不能把“防旧结果覆盖”实现成退款永不生效。平台查询失败、部分结果和明确未拥有必须区分。
5. **先可靠记录，再确认交付。** 新权益、幂等标识及必要的待确认状态必须按选定持久化合同可恢复；写入失败不得向 JS 发布新的 `owned_verified`，也不得把待办标为完成。写入成功后重复回调只补未完成确认，不重复授权或重置游戏数据。商店已完成、应用强退的情况由重启查询与幂等恢复补齐。
6. **只读快照防乱序。** provider 对外发布同一实例内递增的 `revision`；App 不以较旧快照覆盖较新投影。`revision` 只用于并发排序，不是购买验证凭证，也不是跨安装或跨环境通行证。

必须覆盖的反例：

| 事件顺序 | 正确结果 |
| --- | --- |
| 查询 A 开始 → 购买 B 验证并落盘 → A 返回旧 `not_owned` | B 不被撤销；旧查询不写回，必要时补一次新查询 |
| 发起购买 → 关闭面板／回首页 → 交易完成 | 权益可靠确认；不重新打开旧面板、不自动跳关、不丢交易 |
| pending 时退出应用 → 商店稍后完成 → 重启查询 | 验证后仅授权一次，并补必要确认 |
| 同一交易同时来自购买回调、恢复和更新监听 | 按交易标识归并；不重复持久化业务收益，确认可重试 |
| 已拥有 → 用户取消另一操作／刷新失败 | 不误变为未拥有；按有效缓存合同继续使用 |
| 新权益落盘失败／落盘后确认前强退 | 不虚报新保存成功；重启后可恢复并补办，无重复授权 |
| 已确认撤销 → 旧 owned 事件迟到 | 不复活旧权益；有冲突则重新权威查询 |
| 错误商品／环境／失效宿主实例返回成功 | 不写当前权益或普通游戏存档 |

P2.5-B 的 fake provider 只证明共享消费者遵守合同；P4 必须对宿主实际权益所有者注入乱序、重复和失败事件验证归并；P5 再用真实商店与原生存储验证，不能用 fake 的正确实现冒充生产实现已通过。

## 5. 已完成的语言本地化：复用与保护合同

### 5.1 已实现的模块与规则

以 [语言本地化专题](localization.md) 和当前实现为准，直接复用：

| 现有模块 | 已承担的职责 | App 化限制 |
| --- | --- | --- |
| `src/i18n/index.js` | 两种语言 ID、标签归一化、安全查询、命名插值和词典校验 | 继续保持纯逻辑，不访问平台／存档 |
| `src/i18n/locales/zh-CN.js`、`en-US.js` | data-only 中英文语义词典 | 复用同一对词典；P2.5-B 仅增购买／恢复必需语义 key，不复制 App 专用词典 |
| `src/services/locale-service.js` | 当前语言与独立设备偏好的唯一所有者 | 不并入进度、账号或云偏好 |
| `src/platform/wechat.js::getSystemLanguage` | 原始系统语言读取与平台兼容回退 | 不重建第二个读取入口 |
| `src/bootstrap.js` | 创建并注入同一个 LocaleService | 提取装配时保持消费者连接 |
| App、Renderer、Portal 指引、分享和资料服务 | 按语义 key 生成界面、分享标题与原生控件文案 | 不改变 action、分享 query 或权限行为 |

2026-09-21 的既有检查记录为两份词典各有 335 个 key，key 和占位符校验通过；这是历史快照，不是永久数量限制，也不是本轮重新运行的结果。专题中的初始词条统计属于实施记录，本轮不改写其初始统计或其他任务的修改。

语言顺序为“有效手动选择 → 系统语言归一化 → 默认 `en-US`”；中文标签归为 `zh-CN`，英文归为 `en-US`，其他／空值／读取异常归为 `en-US`。自动解析不写成手动偏好。完全缺少官方语言 API 的旧轻量宿主仍保持现有中文兼容回退，不把该测试兼容例外推广为正式未知语言的默认。

账号页继续使用 `account:language:prev`／`account:language:next`，显示“语言 ‹ 中文 ›”或“Language ‹ English ›”。不新增第三种语言、跟随系统按钮或重置入口，不引入本地化框架、字体包或远程词库。

### 5.2 文案不得成为业务合同

- scene／action／hit ID、关卡 ID、机制 ID、奖励 ID、错误码、存档 key 和同步类型不翻译、不改名。
- `home:dailyChallenge` 作为微信与共享代码中的稳定 action 不改名；App 首版不得注册其可见 hit 或发出该 action，“每日挑战”仍只是显示值。
- 禁止比较翻译文字决定按钮状态、动作、奖励或布局模式。
- 使用带命名参数的整句模板，不拼接多个翻译片段。
- 本地化不进入 `core/`，不改变 board／hint／机制规则合同。
- 主题与机制名称可以在展示边界按稳定 ID 映射，不为翻译破坏 data-only manifest。

### 5.3 现有独立语言存档必须保持

语言存档已由 LocaleService 独占，物理 key 为 `cleared:minigame:locale:v1`，记录为 `{ schemaVersion: 1, locale: 'zh-CN' }` 或对应 `en-US`。

初稿“可放进 ProgressStore 的 settings.locale”建议已被实际独立设备设置实现取代，不得再照旧建议迁移。

- 不加入 ProgressStore、PreferencesService、账号绑定、云同步、备份或迁移快照。
- 无有效手动记录时按系统语言解析，不为自动结果写存档。
- 手动选择立即作用于当前会话；写失败时语言仍保持当前选择，服务返回 `ok:false`、`persisted:false` 和 `storage-write-failed`。不得改成虚报保存成功，也不得以通用存储回滚规则撤销此已批准的展示行为。
- 云偏好恢复和账号切换不得修改设备语言 key。
- 未来 App 使用独立物理命名空间，不自动迁入微信语言偏好；复用语言逻辑不代表共享用户设置。

### 5.4 语言、日期、地区独立

当前每日挑战使用 `Asia/Shanghai`。语言切换不得改变挑战日期键、次数刷新、奖励去重、体力恢复或服务器地址。英文界面不代表连接美国服务器。

App 首版不包含每日挑战，因此不建立 App 每日时区、日期迁移或每日奖励合同；这不改变微信端的 `Asia/Shanghai` 规则。

### 5.5 后续只做回归与各宿主验收

- 现有首页、账号、结算、提示、错误和内容名称的双语实现保留，不重新启动全量提取。
- 用实际文字测量与布局约束处理长文本，不为每种语言硬编码字号。
- 验证换行、截断、数字参数、字体缺字、安全区及点击区域。
- 已批准的中英文文案和无关布局保持原样；语言归一化遵守第 5.1 节，不把所有环境重新默认成中文。
- 内部长文本测试语言不得成为未验收的正式语言入口。
- 开发者工具／真机的双语视觉、触控、重启、原生资料与分享验收仍按专题记录完成。代码接入完成不等于已获正式发布验收；本轮不修改切换器开关或替用户发布。

### 5.6 现有账号页作为可选设置页基础

用户独立完成的账号页不是待删除的微信专用页面。App 首版不提供登录或云存档，因此不要求保留完整账号页；但必须在设置或购买面板中提供可发现的“恢复购买”入口。若由账号场景承载语言、恢复购买或通用设置，优先从现有 `account` 场景增量裁剪可复用布局，不显示虚假的账号、同步或云状态。

**共享页面代码，隔离账号与业务数据。** 具体边界如下：

| 现有部分 | 可复用的内容 | App 接入时必须分离的部分 |
| --- | --- | --- |
| `src/ui/account-layout.js` | 安全区、响应式面板、资料摘要、语言行及操作行布局 | 按实际能力提供布局选项，不硬编码成必须支持微信资料／备份 |
| `CanvasRenderer.drawAccount` 及相关反馈绘制 | 卡片、头像占位、双语文本、按钮、命中区域与反馈样式 | 账号资料、在线状态与动作可用性由 App 自己的 ViewModel 提供，不能展示虚假的“已同步” |
| 语言选择 | LocaleService、两种语言、选择器交互与语义 key | App 使用自己的物理存档命名空间，不读取微信语言设置 |
| App 的账号场景编排 | 进入／返回、显示状态、异步结果与场景代次保护的现有模式 | 首版只接实际存在的设置／恢复购买能力；不直接复用微信凭据或 CloudBase 环境 |
| 隐私／同步等入口的展示位置 | 已有操作行及反馈结构 | 微信原生隐私接口、资料按钮及云协议不是 App 实现；缺少能力时隐藏或明确不可用 |

施工约束：

- 不复制成另一套 `AppAccountPage` 长期维护，不恢复 DOM／小程序页面结构，不为了共享先抽象一套通用页面框架。
- 在共享 Canvas 路线下，优先复用现有布局和绘制；确有平台差异时只替换必要服务、ViewModel 字段或能力连接。复用基础不代表整套微信账号流程无需适配。
- 当前 `account` 场景和既有 action 保留；同名 action 必须维持原语义，不能将“同步”悄悄改为无关本地操作。
- App 没有登录或云同步时，语言和可用的通用设置仍可用；不得为复用账号页而强制创建账号或接入服务器。
- 恢复购买属于必备的商店权益操作，不得伪装成云同步；使用独立 action、pending 状态和成功／未找到／失败反馈。不复用账号页时，由独立购买／设置面板承载，不得省略。
- 页面标题暂不预定为 Settings。现有微信账号页名称不变，未来 App 可保留 Account，是否改名另行决定。
- P1／P2 不扩大账号页写入权限。P4 可在第二宿主验证复用页面及缺能力状态；正式身份／资料／同步适配属于 P5 的独立范围，首版仍不得据此新增登录或云存档。
- 复用验收覆盖现有微信页不回归、App 数据来源独立、无云能力不伪报成功、语言可独立使用及两个宿主的安全区／触控。

## 6. 分阶段实施与文件白名单

下表和各阶段清单是当前实施授权的严格施工边界。整体目标授权不等于合并各阶段权限；每阶段须独立核对差异、测试与出口并单独提交，不把跨阶段工作合成一个大改动。

**方法级边界的使用规则：** 下文列出的现有方法以本轮 P0 本地基线为依据；“拟新增”名称是设计，不声称已经存在。每个子阶段开始前，以该阶段 P0 记录补齐实际文件、方法／构造区段、调用者、允许新增的状态、必须保持的副作用顺序和测试用例。只列出文件名不构成整文件修改许可。若当前代码已改名、抽出或存在未覆盖调用点，先更新该子阶段清单再施工；不得以“同一功能相关”为由自动扩展到未列方法。

### P0：刷新基线，冻结合同

仅清点、测试和文档，不改运行行为。

- 记录 HEAD、工作区差异、测试基线及相关未提交工作。
- 清点平台方法与调用者，记录 Canvas／输入坐标、时间戳、生命周期、资源和存储语义。
- 记录存档 key、身份作用域、六域权威与旧档恢复边界。
- 将已完成本地化和届时实际存在的账号页修改纳入基线；冻结语言实例注入、独立 key、回退和失败合同，不假定存在未提交修改。
- 冻结试玩白名单 `0:0`、`0:1`、`1:0`、`1:1`、`1:2`、`1:3`、完整版逻辑权益 ID `full_game_v1`，以及 App 无每日挑战、无任何广告、无奖励分享的功能矩阵。
- 清点回廊奖励目录，证明 App 覆盖层只把 `rewarded_ad`／`share` 解析为 `currency:10000`，没有改写微信目录。
- 冻结第 3.1 节的工程所有权映射和锁文件字段；记录已有 shared commit、tree hash、catalog 快照。尚未实现的 runtime contract 或宿主产品配置 hash 标为待产出，不编造当前值。
- 登记 `app.js` 的直接／传递依赖、方法内字面量 require、动态可选加载与已知直接构造宿主；分别标明 P1 保留、P2.5-A 处理、P4 产物验证的项目。
- 对 P2.5-A／B／C 分别登记方法级清单、状态所有者、失败路径和独立出口；登记第 4.8 节权益所有权与并发反例。
- 确认微信项目根目录中没有 App 原生工程、SDK、打包器或 `node_modules`；记录第 7.3 节的微信入口、上传配置、分包和源码预算基线。
- 确认后续阶段是否仍能使用下列文件白名单；如必须扩展，在施工前说明最小增量与原因。

写入仅限 `docs/app-portability-plan.md` 和 README 的相关说明。本次文档整理提供了审阅基线，但不替代未来实施前的 P0 刷新。

#### P0 实施记录：2026-09-22

本节是上述审计起点的本地快照，只证明 P0。后续提交会改变 HEAD；P4 锁文件必须使用届时实际共享提交与 tree，不能复用本节哈希冒充新构建输入。

| 项目 | 刷新结果 |
| --- | --- |
| Git 与工作区 | `main` at `984303becf8afab1dcd4fc855cc4128f4e1d9460`，tree `544090431fc5c514b38898d47bb2ecf75dffce33`；开始时无未提交差异 |
| 聚合回归 | `node tests/run.js` 通过 105／105 组 |
| 微信包预算 | 主包 1,442,500 bytes；10 个主题分包＋`audio-bgm` 共 11 个分包通过；总计 16,415,611 bytes |
| 发布配置预检 | `node scripts/check-release-readiness.js --mode rollout` 返回 `ready:true`、无失败项；仅为本地配置证据 |
| 微信入口与配置 | `game.js → src/bootstrap.js::start()` 保持；`compileType: game`、现有 AppID、`packOptions`、`game.json` 和 `src/config/subpackages.js` 未改 |
| App 工程隔离 | C 内未发现 `ios/`、`android/`、`node_modules` 或 Capacitor 配置；尚未创建 H |
| 设备与发布证据 | 本阶段未执行开发者工具、Android／iOS 模拟器、真机、实际上传、商店沙盒、送审或发布 |

当前目录为 5 个 set、168 个主线关卡。目录前六项依次为 `0:0`、`0:1`、`1:0`、`1:1`、`1:2`、`1:3`；有序 `levelKey` 列表 SHA-256 为 `ff2a25e8ae237a2a23f061c4cb679c8465b4da0a9ceec5c88803b3446abef6b6`，规范化 catalog 快照 SHA-256 为 `a8ea41b487ebe360ce5d7ab3827eca414e2e93822a278be9515f24bdcde38f68`。`full_game_v1` 仍只是冻结的逻辑权益 ID；P2.5-B 后共享 `runtimeContractVersion` 为 `2`，App 生产策略 hash 和 H 均尚未产出，不填写假值。

当前 `src/config/rewards.js` 快照 SHA-256 为 `ffba0f34f5339962ea295410622a4fadc6625bb8db354879567324174273dc33`。需要由 H 覆盖为 `currency:10000` 的现有条目恰为五项：`theme:ocean`、`theme:spring`、`theme:music`、`theme:vehicles` 的 `rewarded_ad`，以及 `theme:festival` 的 `share`。共享目录本身不改；P2.5-C 必须用覆盖后的真实 `RewardUnlockService` 实例验证。

**平台与持久化基线：**

| 合同 | 当前所有者、调用者与缺口 |
| --- | --- |
| Canvas／安全区 | `WechatPlatform` 创建首个屏幕 Canvas；`resize()` 使用逻辑宽高、将 DPR 限制为 1—2，并令 `safeBottom` 表示底部坐标。`CanvasRenderer` 和账号布局消费 `platform.metrics`；尺寸变化后 App 重新连接 `renderer.ctx` |
| 输入 | `bindPointer()` 将 touch 转为 `{x,y,id}`，逐点分发 start／move／end／cancel 并返回解绑函数；`ClearedApp.start()` 绑定，`dispose()` 调用 `unbindPointer()` |
| 帧循环 | `startLoop()` 先停止旧循环，向 App 传入 `Date.now()` 的绝对毫秒值；Canvas RAF 缺失时回退约 33ms 定时器。hide 和 dispose 停止循环，show 重新启动 |
| 生命周期 | `bindLifecycle()` 当前注册 hide／show／resize／音频中断匿名监听但不返回解绑函数；重复挂载无法完整解除，是 P2 的已确认缺口 |
| 图片与分包 | `createImage()` 明确回调成功／失败；`SubpackageService` 通过 `loadSubpackage()` 处理不支持、失败、进度和完成；Renderer／Portal overlay 保留缺图回退 |
| 存储 | `getStorage()` 的旧兼容接口会把缺失与异常都表示为 `null`；`readStorageResult()` 区分 `{found:false}` 与 `storage-read-failed`；`setStorage()` 同步返回布尔值。Progress、奖励、体力等写入以该布尔值决定是否确认状态，P1—P4 不得伪装异步成功 |

现有物理 key 冻结为：`cleared:minigame:progress:v2`（兼容读取 `cleared:progress:v1`）、`daily:v1`、`reward-unlocks:v1`、`stamina:v1`、`online:v1`、`migration-archives:v1`、`locale:v1`、`session:v1`、`economy-requests:v1`、`rewards:v1`、`share-entry:v1`、`hint-access:v1` 和 `events:v1`，均带 `cleared:minigame:` 前缀。P0 不迁移或重写任何 key。

`SyncStore` 当前六域为 `progress/daily/economy/entitlements/stamina/preferences`，合法模式只有 `legacy-local/migration-freeze/cloud-authoritative/local-backup`；`app-local` 尚未实现。核心四域随全局模式变化，stamina／preferences 按既有阶段独立推进。身份隔离继续由 `ownerId`、`environmentId`、`bindingEpoch`、`activationSequence` 和 App 的 `accountGeneration` 共同保护；历史 `local-backup`、迁移冻结、pending application／restore 仍失败关闭。这里的 `entitlements` 仍指回廊拥有权，不是商店完整版权益。

`bootstrap.start()` 只创建一个 `LocaleService`，并把同一实例传给 App、Renderer、ProfileService 与 ShareService。独立 key、手动偏好优先、系统语言归一化、未知正式语言回退 `en-US`、旧轻量宿主中文兼容和写失败时“当前会话生效但 `persisted:false`”的合同均已由现有测试覆盖；P1 只保持连接，不迁移状态。

**依赖与直接构造基线：**

- `src/app.js` 当前有 29 个顶层字面量 `require`、2 个方法内字面量 `require`（`LegacyMigrationBuilder`、`AuthoritativeStateApplier`），以及 6 个经 `optionalRequire(path, fallback)` 传入变量路径的已知可选模块：ClearEffect、DailyChallenge、DailyProgress、每日 manifest、每日 solutions 和 Portal solutions。按字面量静态解析的递归闭包为 79 个 JavaScript 文件。
- 该闭包仍包含广告配置／服务、每日服务／存档／数据、奖励、体力、SyncStore 及历史权威应用代码。P1 只验证新组合根的直接依赖并登记这些传递项；P2.5-A 处理默认能力，P4 才能以真实 bundle 证明最终依赖与数据裁剪。
- 生产直接构造者为 `src/bootstrap.js`。另有 22 个测试模块直接 `new ClearedApp`：`account-app`、`app-portal`、`app-smoke`、`clear-effect-system`、`cloud-session-migration`、`cloud-stale-callback`、`daily-app`、`daily-entry-grant`、`daily-mechanic-pack`、`hint-share`、`hint-tiered`、`ice-mainline`、`ice-trial`、`level-difficulty`、`level-ui`、`localization`、`reward-unlock-app`、`share-entry`、`stamina-app`、`stamina-renderer`、`theme-system` 及 `tests/helpers/mainline-pack-fixture.js`。P1 必须保留这些调用者的构造兼容，不以批量改测试掩盖默认行为变化。

**P2.5 方法级施工清单确认：**

| 子阶段 | 当前实际区段与状态所有者 | 失败路径和独立出口 |
| --- | --- | --- |
| A 能力裁剪 | `app.js` 的 `optionalRequire`、`constructor()` 可选服务区、`buildModel()`、`performAction()`、`recoverRewardUnlocks()` 和普通 `showHint()`；Renderer 仅限 `drawHome()`、`drawDailyResult()`、`drawRewardDialog()` 及对应 hit 分支；产品能力只读状态归拟新增 ProductPolicy | 显式 disabled 不得落回默认构造；禁用 action 必须安全拒绝；空每日完成源仍让普通奖励核对成功；微信默认构造和现有每日／广告路径不变 |
| B 内容与商店消费合同 | `ProgressionService` 的 `constructor()`、拟新增 `accessStatus()`，并组合但不改写 `isUnlocked()`／`nextLevel()`／`resumeTarget()`；App 的 `constructor()`、`buildModel()`、`performAction()`、`openLevel()`、`openIceTrial()`、`start()`、`dispose()`；Renderer 的 `drawHome()`、`drawLevels()`、`drawResult()`、`drawAccount()` 与拟新增商店弹层；只读权益权威归宿主 provider | 门禁必须先于 Runner 创建和体力扣除；取消／pending／失败不写普通资产；面板关闭只废弃旧 UI 反馈；旧 revision 不覆盖新快照；fake 只证明消费者合同 |
| C App 本地权威 | App 构造期的命名空间／六域权威一致性、`authorityMode()`、`recoverRewardUnlocks()`、`recoverStaminaRefunds()`、`openLevel()`、`requestRewardUnlock()`、普通完成／体力退款／设置保存判断；RewardUnlockService 的构造、`setAuthorityMode()`、`reconcile()`、`purchase()`、`write()`；StaminaService 的构造、`setAuthorityMode()`、`settle()`、`snapshot()`、`restoreUnlockedLevels()`、`unlockOrdinaryLevel()`、`refundQuickClear()`、`flush()` | 不完整／未知／混合模式与受保护实例失败关闭；奖励账本写失败不改已确认余额，体力扣除＋永久进入权同写，回廊余额＋拥有权同写；重启可按持久化首通事实幂等补办；同步测试存储不冒充原生提交 |

P2.5-B 已新增共享 store provider 注入合同、只读界面投影和 fake 消费者测试；共享 App 不保存交易凭据、不写 owned，也不销毁宿主 provider。实际 App 宿主 provider 与归并队列仍不存在，因此 fake 只覆盖第 4.8 节适用于消费者的旧／重复 revision、pending、撤销、失效 App 实例、provider 失败和关闭面板反例；P4 再验证实际宿主唯一所有者、持久化和归并队列。

仓库没有 `scripts/check-markdown-links.js`，因此该不存在的命令未列作 P0 成功证据；本文与 README 的本地 Markdown 链接在提交前另以只读检查核对。P0 只更新本文和 README，没有运行行为、微信配置、存档、云端或真实数据变化。

### P1：仅抽离通用装配

这是建议最先批准的代码阶段。

| 类别 | 精确白名单 | 可改内容 |
| --- | --- | --- |
| 运行代码 | `src/bootstrap.js` | 仅 `start()` 的通用本地对象创建、依赖传递和共有连接；保留微信配置、在线服务及微信相关启动工作 |
| 新增运行代码 | `src/runtime/game-runtime.js` | 通用本地服务创建和 App 装配；不直接导入具体宿主或云配置 |
| 现有测试 | `tests/architecture-boundaries.test.js` | 增加通用组合根直接依赖限制与既有传递依赖登记，不放松原安全线 |
| 现有测试 | `tests/single-settlement-bootstrap.test.js` | 证明固定云结算入口与历史保护不变 |
| 现有测试 | `tests/account-bootstrap.test.js` | 证明原启动、身份与恢复顺序不变 |
| 新增测试 | `tests/game-runtime.test.js` | 注入测试平台、无真实网络的通用装配测试 |
| 测试入口 | `tests/run.js` | 注册新增测试 |
| 文档 | 本文、`README.md` | 记录实际结构与验证状态，不提前宣称第二宿主可用 |

阶段出口：

1. 微信 `start()` 的参数和同步返回合同不变。
2. 新通用组合根不直接导入微信平台、CloudBase 配置或具体网络实现，不自行选择／创建在线服务。
3. 测试平台可以建立游戏；测试不依赖真实账号、真实云或生产存档，也不隐式发起微信在线调用。
4. 原配置选择、单方案入口、账号恢复和完整回归继续通过。
5. `tests/game-runtime.test.js` 证明同一语言实例继续注入，手动偏好和系统语言行为不变；现有两组本地化测试运行但原则上只读。
6. 按第 7.4 节证明微信入口与可入包依赖完整，预算／发布配置预检通过；开发者工具及必要真机启动回归单独记录。未执行不得标记设备或实际上传通过。
7. 通用装配提供可由仓库外宿主消费的明确入口，不要求把 App 工具链放入 C。通过既有 App 引入的传递依赖必须输出清单；本阶段不声称完整依赖闭包已去除每日／广告／历史云编排，最终产物由 P4 验证。

本阶段 `game.js`、`src/app.js`、所有业务服务、云配置、规则与数据均只读。不能为了达到 P2.5／P4 的依赖裁剪出口而提前修改它们；若提取本身必须修改白名单外文件，先报告具体原因并修订授权边界。

#### P1 实施记录：2026-09-22

- 从 P0 提交 `4b71818` 的干净工作区开始；新增 `src/runtime/game-runtime.js`，导出 `runtimeContractVersion:1`、`createLocalServices()` 和 `startGame()`。前者创建通用本地服务，后者创建 App、连接偏好／权威保护／迁移快照与分享，再同步启动本地游戏。
- `src/bootstrap.js` 仍独占 `WechatPlatform`、环境配置选择、身份、CloudBase／HTTP 传输、在线服务与启动后的在线调度；它把明确依赖交给通用装配。`game.js`、`src/app.js`、平台、业务服务、配置、规则、数据和微信上传配置均未修改。
- 通用组合根的直接依赖已由架构测试固定为 App 与可复用本地服务／奖励配置；不得直接导入微信平台、CloudBase、backend、身份、会话、SyncStore 或云传输。现有 App 的 31 个字面量依赖与 6 个 `optionalRequire` 路径仍被登记为传递边界，未冒充已完成 P2.5-A／P4 裁剪。
- 新测试用纯测试平台证明同步返回、无网络启动、同一 LocaleService 注入、系统语言、手动偏好、重启恢复与写失败语义；现有单方案结算、账号恢复、环境选择和完整回归保持通过。
- 本地验证：`node tests/run.js` 106／106 组通过；主包 1,444,499 bytes、11 个分包和总计 16,417,610 bytes 通过预算；rollout 配置预检 `ready:true`。本阶段未执行微信开发者工具、Android／iOS 模拟器、真机、实际上传、商店、审核或发布，因此只标记源码与本地合同通过。

### P2：平台合同与生命周期

本阶段运行代码上限为：

- `src/platform/wechat.js`：必要的合同补齐与生命周期解绑。
- `src/app.js`：仅 `start`／`dispose` 的生命周期挂接；不以此开放整个 App 文件。
- `src/runtime/game-runtime.js`：仅必要的依赖连接。

测试白名单为 `tests/platform-contract.test.js`（新增）、`tests/game-runtime.test.js`、`tests/app-smoke.test.js`、`tests/board-input-controller.test.js`、`tests/architecture-boundaries.test.js`、`tests/run.js`。其他音频、资源、账号等现有测试仍须执行，但不因运行它们获得修改权限。

文档仅更新本文；若公共平台合同影响 README 描述，可同步对应段落。

阶段出口：

- 生命周期可解绑且重复销毁安全；重新挂载不重复响应。
- 中断／恢复不会残留指针或启动多个循环。
- 坐标、安全区和时间戳语义不变。
- 旧轻量宿主缺少新增可选方法时保留兼容回退。
- 设备回归覆盖切后台、回前台、尺寸变化和音频中断。

能力缺失需要修改具体按钮／ViewModel 时，必须另列屏幕、方法和测试白名单后再实施，不把“能力适配”当作修改所有 UI 的授权。

#### P2 实施记录：2026-09-22

- 从 P1 提交 `9a9f6dd` 的干净工作区开始。`WechatPlatform.bindLifecycle()` 现在以同一回调引用注册并返回可重入解绑函数；支持宿主的 `offHide/offShow/offWindowResize/offAudioInterruptionBegin/offAudioInterruptionEnd` 会真实移除监听，不支持 `off*` 的旧轻量宿主也会让遗留回调失活。
- `bindPointer()` 同样在解绑后失活，并在可用时调用四个 `offTouch*`；多指逐点分发、稳定 pointer ID、`clientX/clientY` 与 `x/y` 回退、空 cancel、逻辑坐标均保持。解绑 API 抛错不会中断其余清理。
- `ClearedApp.start()` 对同一实例只挂载一次；`dispose()` 可重复调用，只解绑自己的 pointer／lifecycle 监听并停止自己的循环，不重复销毁服务。缺少新增解绑返回值的旧宿主继续使用安全回退。
- 新平台合同测试覆盖 DPR 1—2、安全区坐标、Canvas 实际像素、绝对 `Date.now()` 帧时间、hide/show、resize、音频中断、原生解绑、无 `off*` 回退和重新挂载；通用 runtime 测试覆盖 App 重复 start／dispose。
- 本地验证：`node tests/run.js` 107／107 组通过；主包 1,445,954 bytes、11 个分包和总计 16,419,065 bytes 通过预算；rollout 配置预检 `ready:true`。未执行微信开发者工具、Android／iOS 模拟器、真机或实际上传，因此设备上的后台恢复、旋转／尺寸变化和音频中断仍明确待验。

### P2.5：分为 A／B／C 三个独立子阶段

原 P2.5 不再作为一次整体施工授权。顺序为 **A 能力裁剪 → B 内容门禁与购买界面合同 → C App 本地结算**；每个子阶段必须有自己的差异、完整回归、微信兼容检查和出口记录。三个子阶段均不创建 App 工程、不接真实商店、不实施原生异步存储。

下列“绘制分支”等区段还须在子阶段 P0 记录中定位到实际方法及前后边界；若不足以实现出口，先补清单，不开放整个文件。所有子阶段均只更新本文；README 仅在公共入口或顶层结构说明确有变化时更新对应段落。

#### P2.5-A：显式能力裁剪与默认依赖清理

| 文件 | 允许方法／区段 | 可新增状态与职责 | 不得改变 |
| --- | --- | --- | --- |
| `src/runtime/product-policy.js`（新增） | 策略规范化／校验、能力查询、disabled daily completion source | 不可变能力快照与纯空完成源 | 不写 App 生产取值、购买凭证、价格算法或平台调用 |
| `src/runtime/game-runtime.js` | 通用服务工厂与 App 装配参数 | 注入产品配置和可选服务；显式关闭不回退创建 | 不加入商店／云实现，不切换资产权威 |
| `src/bootstrap.js` | 顶部依赖和 `start()` 对应装配区段 | 显式提供微信每日、广告、分享与原有配置 | 微信生产行为、配置选择、身份和在线调度顺序 |
| `src/app.js` | 顶部依赖／`optionalRequire`、`constructor()` 的可选服务区段、`performAction()` 禁用分支、`buildModel()` 能力投影、`recoverRewardUnlocks()` 的完成源选择；普通提示入口仅限选择本地免费路径的区段；`dispose()` 仅允许为缺失广告服务补空值保护 | 只读能力引用；缺能力安全返回；已知动态可选依赖改为打包器可枚举的字面量映射 | 体力恢复 → 奖励核对 → 外观可用性恢复的顺序；不改奖励金额、门禁或保存合同 |
| `src/ui/canvas-renderer.js` | 首页每日入口、广告／分享按钮及相关 hit 注册区段 | 按 ViewModel 不绘制、不命中 | 不改变其余布局，不判断购买权益或访问存档 |
| `tests/fixtures/app-product-policy.js`（新增） | 仅声明式测试配置 | 已冻结 App 产品取值的 fixture | 生产代码不得导入，不能成为第二份生产配置 |

新增 `tests/product-policy.test.js`；可改测试仅限 `tests/game-runtime.test.js`、`tests/app-smoke.test.js`、`tests/daily-app.test.js`、`tests/hint-access-service.test.js`、`tests/reward-unlock-app.test.js`、`tests/reward-unlock-renderer.test.js`、`tests/renderer-button.test.js`、`tests/single-settlement-bootstrap.test.js`、`tests/account-bootstrap.test.js`、`tests/architecture-boundaries.test.js`、`tests/run.js` 中与本阶段直接相关的用例。

出口：微信既有能力与默认行为不变；显式关闭每日／广告／分享后无服务实例、可见入口、hit 或有效 action，直接调用被禁用 action 也安全拒绝；普通提示仍能本地使用且不创建每日次数／日期记录。普通奖励核对收到合法空每日源，不因裁剪每日而失败；本阶段不宣称已经实现 `app-local`。生产配置不得导入测试 fixture。

默认依赖移动与旧直接构造兼容无法同时满足时，必须列出具体宿主／测试调用者并说明最小适配范围；不以删除测试、静默改默认、让 App 包带入禁止配置或回退动态路径来掩盖冲突。最终 bundle 裁剪仍由 P4 实测。

#### P2.5-A 实施记录：2026-09-22

- 从 P2 提交 `8156190` 的干净工作区开始。新增共享 `ProductPolicy`，只负责配置规范化／校验、不可变能力快照和禁用每日时的 `{ok:true, days:[]}` 完成源；六关、`full_game_v1` 等 App 取值仅存在于测试 fixture，生产源码不得导入。
- 通用 runtime 按策略创建本地服务：禁用每日或使用免费提示时不创建 `DailyProgressStore`／`HintAccessService`；App 显式禁用时不保留 Daily service/store、Ads、Share、Reward service 或外部提示账本引用。微信 bootstrap 显式注入原每日、广告、分享与 `tiered` 提示能力，既有启动和在线调度顺序不变。
- App 将只读能力投影给 Renderer；首页无每日按钮／hit，结果页无分享按钮／hit，广告／奖励分享条件没有可执行解锁按钮，直接发送相关 action 也安全拒绝。普通提示直接走本地解题路径且不创建 `hint-access:v1` 日期记录；普通首通奖励通过纯空每日源正常核对。
- 六个动态 `optionalRequire(path)` 调用保留兼容入口，但实际加载改为六个可枚举的字面量 loader；P4 仍须以真实 bundle 证明禁止数据／配置未进入 App 产物。测试期间确认禁用广告后 `dispose()` 原先会无条件调用服务，因此白名单精确扩展为一行空值保护，没有改变其他生命周期顺序。
- 本地验证：`node tests/run.js` 108／108 组通过；主包 1,459,377 bytes、11 个分包和总计 16,432,488 bytes 通过预算；rollout 配置预检 `ready:true`。未执行微信开发者工具、Android／iOS 模拟器、真机或实际上传；本阶段也未创建第二宿主、购买门禁或 `app-local` 权威。

#### P2.5-B：统一内容门禁与购买／恢复界面合同

| 文件 | 允许方法／区段 | 可新增状态与职责 | 不得改变 |
| --- | --- | --- | --- |
| `src/runtime/product-policy.js` | 新增纯内容访问查询 | 消费宿主白名单和归一化权益快照，返回允许／结构化拒绝原因 | 不持有商店服务、交易队列或存档；不硬编码 App 六关 |
| `src/runtime/game-runtime.js` | 装配参数、合同版本暴露 | 注入内容访问查询与 store provider | 不创建实际商店、不选择平台商品 ID |
| `src/services/progression-service.js` | `constructor()` 的可选查询注入；拟新增 `accessStatus()` 组合查询 | 组合产品访问与原进度条件；已完成／体力永久解锁也不能绕过商业门禁 | `isUnlocked()` 的原进度规则、`nextLevel()` 的目录顺序、`resumeTarget()` 的原导航语义；不偷偷跳过受限内容 |
| `src/app.js` | `constructor()` 的策略／provider 引用；`openLevel()`、`openIceTrial()` 的前置门禁；`performAction()` 中所有关卡入口（含重置／重试／试玩重玩）与新增 store action；`buildModel()` 的访问／商店投影；`start()`／`dispose()` 仅接入／解除权益订阅；`onPointerStart()`／`onPointerMove()`／`onPointerEnd()` 仅增加 store 弹层输入截获 | 拟新增 `checkContentAccess()`、当前 run 重玩查询、`openStoreDialog()`、`requestFullGamePurchase()`、`restoreFullGamePurchase()`、`dismissStoreDialog()`；仅界面场景代次、操作反馈、只读权益投影与解绑引用；弹层打开时阻止滑页或棋盘手势穿透 | 不增第二份 owned 权威，不直接保存交易，不调用原生 SDK，不改 Runner／体力扣除／首通写入顺序 |
| `src/ui/canvas-renderer.js` | 首页／选关／结果页的访问状态绘制区段；拟新增 `drawStoreDialog()` 及对应 hit | 稳定 store action、双语面板、购买／恢复／重试／关闭反馈 | 不根据价格或文案判断授权，不复用云同步／回廊购买 action |
| `src/i18n/locales/zh-CN.js`、`src/i18n/locales/en-US.js` | 仅新增购买／恢复、门禁和商店状态所需语义 key | 对称词条和占位符 | 原词条、语言默认、稳定 action／错误码 |
| `tests/helpers/fake-full-game-store.js`（拟新增） | 可控快照、Promise 和订阅事件 | 模拟延迟、乱序、重复、失败和操作结果 | 不进入生产依赖图，不冒充原生验证 |

可改测试为 `tests/product-policy.test.js`、`tests/game-runtime.test.js`、`tests/app-smoke.test.js`、`tests/progression-service.test.js`、`tests/app-portal.test.js`、`tests/ice-mainline.test.js`、`tests/ice-trial.test.js`、`tests/level-ui.test.js`、`tests/renderer-button.test.js`、`tests/localization.test.js`、`tests/architecture-boundaries.test.js`、`tests/run.js`；可新增 `tests/full-game-access.test.js`，只验证共享门禁与 provider 消费合同。

出口：

1. 未购买时只有六个固定 `levelKey` 具备商业访问资格，仍须通过原进度规则；首页、选关、下一关、直接 `openLevel`、试玩和冰封入口均不能绕过。先做访问查询，再扣体力或创建 Runner；直接调用的防线与 UI 一致。
2. 受限入口打开同一双语购买／恢复面板；只有直接点击才调用购买。取消、pending、失败不授权、不扣体力、不修改既有进度、金币、回廊或首通记录。
3. 关闭面板／切换场景只取消旧 UI 反馈和自动跳转，不阻止有效交易更新 provider。App 解绑订阅不销毁宿主所有的 provider；较旧快照不覆盖较新投影。
4. 权益变更只改变内容访问，不自动创建关卡运行；恢复入口可发现。商品价格缺失时不硬编码替代价格。
5. 使用 fake 证明共享消费者的上述行为和第 4.8 节适用的反例；不据此宣称宿主实际归并、原生持久化或真实商店已通过。

#### P2.5-C：App 本地权威与一致提交

施工前冻结唯一显式输入；不得根据缺少网络、缺少 CloudBase 或普通本地存储的存在自动推断 `app-local`：

```js
{
  authority: {
    mode: 'app-local',
    storageNamespaceId: '<host-owned opaque non-empty id>',
    domains: {
      progress: 'app-local',
      daily: 'disabled',
      economy: 'app-local',
      entitlements: 'app-local',
      stamina: 'app-local',
      preferences: 'app-local'
    }
  },
  rewardUnlockOverride: {
    sourceTypes: ['rewarded_ad', 'share'],
    replacement: { type: 'currency', cost: 10000 },
    expectedMatches: 5
  }
}
```

`storageNamespaceId` 由独立宿主 H 持有，必须是非空、不透明且稳定的命名空间身份；App 平台适配在该模式额外提供 `storageNamespace() -> { id, isolated }`。组合根须在创建 App 或任何有状态服务前确认返回值存在、`isolated === true` 且 `id` 与产品合同完全一致；默认微信路径不要求该方法。六域必须完整且逐项等于上表，不能缺项、混用其他权威或把 `daily` 改成本地日期域。该模式不得注入 SyncStore、ProgressSync、Economy、身份、云备份、在线或每日服务；任何不完整、未知或冲突配置都在构造副作用前失败关闭。

奖励覆盖是共享配置的纯投影：只匹配 `sourceTypes` 声明的现有条目，匹配数必须等于 `expectedMatches`，并保留每项稳定 `id`、`kind` 与 `itemId`；零匹配、少匹配、多匹配、非法替代类型或非正整数价格都失败。不得修改 `src/config/rewards.js` 或把投影写回共享目录。上面的 `5` 与 `10000` 是首版 App fixture／H 的固定产品取值；共享校验只消费显式输入，不硬编码这些数字。

| 文件 | 允许方法／区段 | 可新增状态与职责 | 不得改变 |
| --- | --- | --- | --- |
| `src/runtime/game-runtime.js` | 本地服务创建、运行时合同版本和 App 注入区段 | 显式选择 `app-local`；启动前检查宿主命名空间、功能矩阵、六域配置和禁止依赖；只在检查完成后创建本地服务 | 不创建 SyncStore、云待办或历史备份服务；默认微信装配不变 |
| `src/app.js` | `constructor()` 的模式／服务一致性；`authorityMode()`；`recoverRewardUnlocks()`、`recoverStaminaRefunds()`；`openLevel()` 的本地权威路由；`requestRewardUnlock()` 的金币购买路由；普通完成／体力退款／设置保存的既有权威判断区段 | 消费明确的领域模式，不另建钱包或存档；SyncStore 存在时始终优先，明确的 `app-local` 才直接调用本地服务 | 原胜负、进度保存后核对奖励的顺序、微信云确认／迁移保护和异步账号隔离；权威不一致时不得创建 Runner、扣体力、发奖励或写设置 |
| `src/services/reward-unlock-service.js` | `constructor()`／`setAuthorityMode()`、`reconcile()`、`purchase()` 的准入；`write(candidate)` 仅在必要时补失败保护 | `app-local` 只允许首通核对与金币购买；候选余额、领取记录和拥有权在同一账本提交 | 不使广告／分享授权入口接受 `app-local`；不改金额、schema、稳定 key、云回执校验或第二份资产 |
| `src/services/stamina-service.js` | `constructor()`／`setAuthorityMode()`；`settle()`、`snapshot()`、`unlockOrdinaryLevel()`、`refundQuickClear()`、`restoreUnlockedLevels()`、`flush()` 及其直接调用链内必要的模式准入区段 | 明确本地结算／入场／恢复／退款权限；只允许全新且显式配置的服务进入 `app-local` | 自然恢复、永久解锁和退款算法、微信 key、云权威／冻结保护；不全仓异步化 |
| `src/runtime/product-policy.js`、`tests/fixtures/app-product-policy.js` | 已有策略校验、六域／命名空间合同与奖励目录纯投影；测试 fixture 保存固定 App 取值 | 验证完整能力／本地模式组合、独立命名空间和回廊覆盖输入 | App 生产覆盖参数仍归 H；不全局改共享奖励目录，不把测试 fixture 引入生产依赖图 |
| 文档 | 本文、`README.md`、`docs/reward-unlock-system.md`、`docs/stamina-system.md`、`docs/cloudbase-local-first-sync.md` | 同步 App 本地权威与微信云／历史本地备份的区别、证据边界和失败语义 | 只在同步测试证据范围标记已实现，不覆盖历史设备／云端证据 |

可改测试为 `tests/product-policy.test.js`、`tests/game-runtime.test.js`、`tests/app-smoke.test.js`、`tests/reward-unlock-service.test.js`、`tests/reward-unlock-app.test.js`、`tests/reward-unlock-renderer.test.js`、`tests/stamina-service.test.js`、`tests/stamina-app.test.js`、`tests/stamina-renderer.test.js`、`tests/single-settlement-bootstrap.test.js`、`tests/account-bootstrap.test.js`、`tests/architecture-boundaries.test.js`、`tests/run.js`；可新增 `tests/app-local-authority.test.js`，使用真实领域服务与可失败的独立测试存储。

出口：

- App 明确使用 `app-local`，`daily` disabled；命名空间、六域矩阵或奖励覆盖缺失／多余／冲突时，在读取或写入本地业务数据及创建 App 前失败。无 SyncStore、日期键、云待办或线上调用；微信断网／缺服务不能转为 App 本地权威。
- 普通首通的持久化事实可幂等补发奖励；进度已保存、奖励保存失败时重启能补办且只发一次，不能消费未确认到账的余额。
- App fixture 的现有五项 `rewarded_ad/share` 回廊条目全部投影为 `currency:10000`，稳定 ID／kind／itemId 不变，共享奖励配置对象及 `src/config/rewards.js` 不变。回廊购买时余额和拥有权共同成功或共同失败；失败不改已确认状态，重复购买不重复扣币。使用覆盖后的真实服务实例验证，而不只测试配置对象。
- `app-local` 不接受广告／分享发奖；已有云权威／迁移冻结／历史备份或已使用实例不能切入该模式。未知模式安全拒绝，不落入宽松本地默认。
- 体力 `settle()`、入场解锁、快通退款、恢复和重启补办走同一显式本地权威；注入失败时不创建 Runner、不扣体力，保存失败不确认内存变化，幂等重试只执行一次。设置保持既有所有者与失败语义；LocaleService 的会话语言例外遵守第 5.3 节。购买完整版不重置任何普通游戏资产。
- 两个测试宿主即使使用相同逻辑 key，只要命名空间 ID 不同就互不可见；该测试只证明合同级逻辑隔离。正式原生物理命名空间、提交成功语义、杀进程恢复和设备隔离必须经 P4／P4.5／P5，不把 Node 全绿称作“App 存档可靠性已完成”。
- 微信默认装配、云权威、历史 `local-backup`、单方案结算和既有模式保护测试继续通过；本阶段不修改其配置、存档 key 或协议。

P2.5-A／B／C 未列出的 `core/`、`data/`、manifest、微信配置、云协议、SyncStore、ProgressStore 和原生实现均只读。确需改动先报告最小范围；不得将三个子阶段的文件白名单合并成任意时点的总权限。

### P3：本地化已实现，调整为回归保护检查点

原 P3 的语言建设工作已由独立本地化任务完成，不再列为 App 化待开发功能，也不为了阶段编号重新实施。

本检查点默认无运行代码写入权限，执行：

1. `tests/localization.test.js` 与 `tests/locale-service.test.js`，经完整聚合入口运行。
2. P1／P2／P2.5-A／B／C 后同一语言实例、系统读取、手动偏好、失败语义和消费者连接回归。
3. 双语不影响稳定 ID、云偏好、账号归属或服务器；微信每日日期保持原规则，App 功能矩阵继续不暴露每日挑战。
4. 根据本地化专题补充开发者工具与真机证据；只在实际完成后登记。

如发现回归，先给出具体文件、方法和最小测试范围；不能自动获得词典、Renderer、账号布局或存档的批量修改授权。P4 新宿主继续复用词典和语言服务逻辑，但单独适配系统语言、存储命名空间及原生文案。

### P4：第二宿主验证

在客户端根目录 C 之外新建独立 `ClearedApp` 浏览器／WebView 验证宿主，使用同一份游戏源码，不作为正式 App 发布。

独立宿主已是确定边界，不再作为可选建议。P4 需记录 H 的实际路径、仓库根、构建方式、文件清单和依赖；宿主拥有自己的依赖与生成目录，不在微信根目录安装原生容器、打包器或 `node_modules`，不恢复旧小程序的 `pages/`、根 `app.js` 等结构。

运行边界：

- 新宿主必须经 P1 通用入口和 P2.5 产品合同启动，不复制 App、规则、服务或内容形成第二套源代码。
- 创建并校验 `shared-source.lock.json`；每次验证另生成 `build-provenance.json`，记录 App 宿主提交、锁文件摘要、共享源码完整提交／tree hash、runtime contract version、catalog 顺序／hash 和六关快照。共享输入必须只读且工作树干净；可复制进生成目录作为构建产物，但不得复制后继续手工维护。
- 选定并锁定一个 CommonJS 打包器及版本，以真实生产模式打出 web bundle；产物扫描必须证明动态可选依赖已被字面量映射、所需资源齐全，且不包含 CloudBase／微信环境配置、每日排期数据、广告 SDK 或广告配置；对尚未拆出的共享惰性兼容分支输出明细。
- 在 H 建立唯一生产 App 产品配置；与第 3.1／3.4 节、测试 fixture 和锁文件比对。不从共享测试目录导入 fixture，不把六关或覆盖价格重新硬编码进共享查询。
- App 专用入口、平台适配、存储、商店权益所有者和产品配置只存在于独立宿主；发现共享缺陷时回到当前仓库修复并执行微信回归。
- 宿主平台适配输出同一合同；DOM 和原生 API 只存在于宿主适配中。
- 不创建 CloudBase 服务，不发送线上请求，不读写真实微信存档。
- 使用独立测试存档和明确标记的本地验证配置；不得把测试结算当成正式 App 经济方案。
- 不装配任何广告或分享能力；普通提示使用本地免费路径，App 回廊使用 `currency:10000` 覆盖策略。
- 用明确标记的假商店底层适配器模拟未购买、成功、取消、pending、失败、已拥有和恢复；将这些事件送进宿主实际权益所有者，按第 4.8 节验证乱序归并、去重、失效实例与 UI 解绑。不能只证明 fake 自己实现了正确状态机。
- 需要账号／设置展示时优先复用现有 account 场景、布局和双语绘制；用独立测试数据验证，缺少在线能力时不调用微信服务。
- 微信客户端原则上只读；如缺少必要共享接口，先列具体差异，不放宽架构测试或修改生产配置。

阶段出口：同一份源码跑通首页、六个固定试玩关、所有进入路径的完整版门禁、测试权益解锁后的普通／Portal／冰封和结果；证明 App 无每日挑战、广告或奖励分享的入口、action、服务实例和运行时调用，且产物无每日排期数据、广告 SDK 或广告配置；验证回廊覆盖、资源、音频、生命周期、独立测试存档、语言与长文本；验证实际宿主权益所有者的并发合同；证明干净、锁定、可追溯的共享源码能够重现构建且没有可编辑的业务源码副本。浏览器通过仅证明第二宿主兼容性，不证明原生持久化、真实购买、恢复或上架能力。

### P4.5：最小原生存储验证

本阶段在 P4 通过后、P5 大规模原生开发前执行，须独立批准。目标不是提前实现正式 App，而是验证选定原生存储的真实成功语义，并给 P5 列出必要的共享调用链改造范围。

| 边界 | 允许范围 | 禁止范围 |
| --- | --- | --- |
| 工程 | H 内独立测试工程；拟用 `experiments/storage-spike/` 保存入口、测试桥、合成数据和测试报告 | C 内任何新增原生工程／依赖；正式发布工程、商店商品或真实交易 |
| 文件 | 施工前列出测试工程的具体入口、桥接、原生存储实现、依赖锁和所需原生生成文件清单；仅批准该清单 | 不用目录前缀充当整个 H 的写入许可，不修改共享运行码 |
| 数据 | 独立测试命名空间与合成进度／账本；记录体积和写入频率假设 | 真实玩家存档、微信数据、正式权益凭据、云数据 |
| 输出 | 保存合同、失败矩阵、实际测量、选型结论及 P5 方法／文件影响清单 | 不宣称完整游戏已接入该存储，不把样例通过写成全平台通过 |

最小闭环为：`候选状态 → 原生提交 → 返回真实结果 → 确认已提交状态 → 强退 → 重启读取`。至少覆盖一次余额与拥有权的共同提交，以及进度已保存而奖励尚未保存的幂等恢复样例。

必须分别测试写入前失败、写入中强退、写入完成但回调未达时强退、明确成功后重启、重复提交、读取损坏／失败及空间不足（不能实测时明确记录故障注入与证据缺口）。重启结果只能是合同允许的完整旧状态或完整新状态，不能出现半扣款／半授权。Promise resolve、单次读回和浏览器 localStorage 成功都不能单独作为持久性证明。

记录所测 OS／设备、存储实现及版本、原生 API 的提交含义、并发写入排序、原子边界、备份属性和失败恢复。只测一个平台时，另一个平台仍为未验；所需平台未通过前不得声称正式存储完成。不能满足合同就调整选型或在 P5 方案中明确批准必要的异步调用链改造，不回到“内存先写、后台保存、立即 true”。

出口为可审查的选型与提交合同证据，以及 P5 的最小影响清单，不是正式存档／卸载重装／购买验收。该阶段失败时，不以浏览器原型可玩为由继续扩大原生施工。

实施状态（2026-09-23）：P4.5 已获独立批准并完成。独立宿主最终证据提交为 `c337878039348c7646b3b177afcd4fb1a8af8383`；iOS 26.5／Xcode 27.0 的 iPhone 17 Pro 模拟器与 Android 16／API 36 的 `Roco_API_36` 模拟器均以 Capacitor `8.5.2` 和系统 SQLite 通过 10／10 场景，Android 另有 3／3 仪器测试通过。选型结论是：系统 SQLite 可作为 P5 普通 App 本地状态的候选，但需采用真实异步提交链路。详细报告、截图、源码摘要与限制位于 H 的 `experiments/storage-spike/reports/`；第 13.17 节记录本轮证据。真机、实际备份／恢复、卸载／重装、真实空间耗尽、StoreKit／Play Billing、签名和发布仍未验。

P4.5 输出的 P5 最小影响范围如下；它是设计输入，不构成 P5 施工授权：

- 保留现有微信 `readStorageResult()`／`setStorage()` 同步合同，新增独立 App 异步存储接缝；不得直接把现有返回值改成 Promise，否则严格比较 `=== true` 与宽松比较 `!== false` 的既有调用者会分别失败关闭或误报已提交。
- 共享侧只纳入 `src/runtime/game-runtime.js`、`src/services/progress-store.js`、`reward-unlock-service.js`、`stamina-service.js`、`locale-service.js`、三个设置消费者及 `src/app.js` 中经调用链证明必要的初始化、候选提交、恢复和生命周期区段。启动须先读盘，写入须按“最后确认状态 → 候选 → 等待原生提交 → 替换确认状态”串行化。
- 完成结算先提交进度，再执行可幂等恢复的奖励或体力退款；RewardUnlock、Stamina、语言与设置只能在实际提交后报告持久化成功。Daily、CloudBase／SyncStore、广告、分享、账号、GameRunner、内容和 Renderer 默认不进入该迁移。
- `full_game_v1` 不得由普通存档授予。P5 宿主须把经商店验证的商业权益保存到独立的 no-backup、安装绑定缓存，在发布 `owned` 以及 Apple `finish`／Google acknowledgment 之前完成可靠持久化；共享完整版权益消费者不因此取得存储所有权。
- Android 本次实测使用 API 28 起可用的 `SQLiteDatabase.OpenParams`，而实验工程仍声明 `minSdk 24`。P5 必须选择最低 API 28，或另行实现并测试 API 24—27 兼容路径，不能从 API 36 结果外推。

### P5：正式 App 专项，分阶段另行授权

只有第二宿主与最小原生存储验证提供足够证据后，才按独立白名单逐段实施。P5-A 已冻结宿主身份、最低系统范围和可重现构建边界；P5-B 已建立共享异步普通存档接缝；P5-C 已接入原生调试宿主和普通存档；P5-D 已接入 iOS 本地 StoreKit 模拟。以下合同和未完成验收仍须逐段审查，不能把局部实施视为整项放行：

- 原生容器与操作系统版本范围。
- 正式存储及异步提交／恢复链路；采用 P4.5 的结论，逐个列出共享服务与 App 调用者的必要修改，不能仅凭“await 保存”扩大到全仓。
- Apple／Google 的商品 ID、商店返回的本地化价格，以及第 4.7—4.8 节的购买、pending、验证、幂等落盘、acknowledgment／finish、启动／回前台刷新、手动恢复、并发归并、退款／撤销和离线缓存链路。
- 六个稳定 `levelKey` 试玩快照、全路径完整版门禁、App 本地结算、每日挑战／任何广告／奖励分享禁用和回廊 `currency:10000` 覆盖策略。
- 首版无登录、无云存档、无玩法服务器的产品状态；不得为了复用微信能力重新引入账号或 CloudBase。
- 第 4.6 节的 OS 备份排除／恢复、卸载重装、存档升级和权益缓存分离。
- 原生工程、签名、固定竖屏、Android 返回键、隐私、素材／音乐授权清单、商店隐私标签／Data Safety 与发布流程。
- 在选定首发 OS 和最低设备后，冻结帧时间、峰值内存、启动时间、包体与真机矩阵的可测阈值；没有阈值不能只以“看起来流畅”验收。
- `ios/`／`android/`、原生 SDK、App 构建流水线只存在于独立宿主；提交 JavaScript 依赖锁、Gradle Wrapper／版本目录和 iOS 依赖锁（若实际使用），不用浮动 `latest`。发布记录同时保存宿主 commit、`shared-source.lock.json`、工具链版本和商店商品映射摘要。

本阶段必须有独立的文件白名单、数据迁移边界和设备验收计划，不能沿用 P1 或 P4.5 的授权扩展到正式资产、后端或发布。

实施状态（2026-09-23）：P5-A 已获独立批准并在 H 的提交 `1698f2ba87d13069e726040ee2f2913c369b0260` 完成。正式显示名为 `Cleared`，iOS Bundle ID 与 Android applicationId 均为 `com.godwhere.cleared`；最低系统范围冻结为 iOS `15.0` 与 Android API `28`。P4 浏览器验证输出固定为 `dist/browser-test/`，正式原生 Web 边界固定为 `dist/native-web/`，原生 provenance／扫描证据位于 Web 根之外的 `dist/native-meta/`。当前 `dist/native-web/` 只含 `index.html`、`styles.css` 与失败关闭的 `game.js`，状态为 `contract-gate-only`、`nativeCopyEligible:false`；它不能复制为正式 App，也不包含 fake store、P4 fixture／命名空间、浏览器 `localStorage`、Storage Spike、微信／CloudBase API、远程脚本或调试入口。

提交后的干净宿主以 `pnpm verify` 通过 P5 精确文件白名单、4／4 Node 合同组、双输出构建／扫描、失败关闭原生门 smoke，以及既有 P4 六关与全部门禁 Chrome 闭环；provenance 记录该宿主提交、tree、干净状态、共享锁／P5 锁摘要和逐文件输入摘要。该段是 P5-A 的历史证据；P5-B 的追加证据见第 13.18 节。正式原生工程、SQLite 端口与商店仍未接入。

#### P5-C 施工前审计：正式原生宿主与普通存档（已批准的历史基线）

截至 2026-09-26，H 的 `src/main.js` 使用 P4 命名空间、同步 `BrowserPlatform`／`localStorage` 和 `FakeStoreAdapter`；`src/store/entitlement-owner.js` 的缓存也是 P4 同步浏览器存储。`scripts/build.js` 对 `native-web` 只复制失败关闭的三文件门，`scripts/scan-bundle.js` 与 `p5-scope-lock.json` 明确要求 `nativeCopyEligible:false`、`storageIntegration:false`、`nativeProjectGeneration:false`。C 的 `startAppLocalGameAsync()` 已能消费异步 `open`／`commit`／`lookupOperation`，但没有正式 H 端口。P4.5 的 Swift／Java SQLite 代码和 82 个测试工程原生跟踪文件仅供设计参考，不能把合成工程直接改名为生产工程。

建议 P5-C 交付两平台模拟器可安装的**六关试玩调试构建与正式普通存档链路**：H 新建独立的原生入口、Canvas 平台适配和原生 SQLite 端口，调用 C 的异步入口；保留 P4 浏览器入口及其测试，但正式载荷不得引用其命名空间、假商店、`localStorage` 或测试 fixture。App 产品取值继续只有 H 一份，分别注入 P4 测试与正式普通存档 namespace。商店尚未接入时，正式宿主只能提供未拥有／商店不可用的受限状态，不能从 P4 权益缓存或普通存档产生 `owned_verified`。先形成可扫描的游戏产物，再在正式 iOS／Android 工程接通同一端口；只有双端从冷启动、六关游玩、提交、强退到重启全部通过，才允许把 `nativeCopyEligible` 改为 `true`。该标志只表示可复制进原生调试工程，不表示签名、商店或发布就绪。

- 普通数据库只接受 P5-B 冻结的 namespace、schema 和四个记录 key；候选记录与 operation ID／请求摘要同一 SQLite 事务提交，同 ID 不同内容拒绝。桥接回调丢失时按同 ID 查询／重试，未知结果锁住后续写入；损坏或未来 schema 保留原字节并阻止游戏启动。正式实现需验证 iOS／Android 的事务与回调边界，不能把 P4.5 合成结果升格。
- 系统备份规则要显式包含普通数据库，并考虑 SQLite WAL／SHM 等伴随文件；商业缓存仍不创建。Android API 30 及以下和 API 31 及以上分别核查 `fullBackupContent`／`dataExtractionRules`，[Android 官方备份规则](https://developer.android.com/identity/data/autobackup)；iOS 核查 Application Support 文件的备份属性及替换写入后的属性，[Apple 文件备份属性](https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey)。属性检查不是实际备份／恢复验收。
- 现有 H 需要审查的精确非生成入口为 `src/main.js`、`src/browser-platform.js`、`src/product-config.js`、`src/store/entitlement-owner.js`、`scripts/build.js`、`scripts/scan-bundle.js`、`scripts/verify-p5-scope.js`、`web/native/index.html`、`web/native/styles.css`、`web/native/gate.js`、`tests/native-web-smoke.js`、`tests/browser-smoke.js`、`tests/product-and-lock.test.js`、`tests/p5-host-contract.test.js`、`package.json`、`pnpm-lock.yaml`、`p5-scope-lock.json`、`README.md` 和 `docs/p5-host-contract.md`。这是调用链审计结果，**不是施工白名单**；新增原生入口、端口、插件、配置、测试、生成工程及任何 C 修复都须在动工前列成逐文件白名单，不能用 `ios/`、`android/` 或 `src/` 前缀代替。Capacitor 官方允许 App 内本地原生插件，并以原生工程配置和 `webDir` 管理宿主，[插件说明](https://capacitorjs.com/docs/plugins/creating-plugins)、[配置说明](https://capacitorjs.com/docs/basics/configuring-your-app)。
- 2026-09-26 的只读 Node 合成测量：空档首次异步启动产生 2 次记录提交，原记录不变的重启产生 0 次；在不经过商业／体力门禁的测量脚本中将现有 200 个目录关卡各记一次完成，产生 200 次进度提交，再执行一次奖励恢复提交。四条 JSON 记录合计 8,237 bytes（进度 5,454、奖励 2,690、体力 93、未写入语言 0）；这不是实际玩家分布、真实游戏操作频率、SQLite 数据库／操作日志大小或磁盘耐久证据。P5-C 仍须量测真实调用链的关键操作频率、事务日志增长与受控代表性存档体积，明确日志保留／清理规则，不读取未获授权的玩家数据。
- 隔离桌面 SQLite 容量模型进一步支持 P5-C 的[操作日志建议值](p5-c-scope-proposal.md)：schema 1 全量保留 operation ID／请求摘要，不按 TTL 或条数自动清理；200／10,000／100,000 条合成操作的主数据库分别为 65,536／1,622,016／15,958,016 bytes。P5-C 仍须在双模拟器按正式 schema 测量数据库与 WAL 增长；预计 100,000 条达到 32 MiB 或 WAL 无法受控 checkpoint 时停止放行原生调试载荷并复核。该桌面模型不是正式原生或真机容量验收。
- 施工前隔离生成并核对 8.5.2 候选工程的完整逐文件输出，冻结 H 的提交基线、依赖版本、构建输入与精确白名单后再请求授权。模板的 71 个可追踪原生源文件已全部列入建议清单；另两个未忽略的 Example 测试在白名单外，因此不能直接在 H 工作区执行 `cap add`，须在隔离目录生成后只复制获批文件。当前机器只发现 iOS 27 模拟器和 Android API 36 的 `Roco_API_36` 虚拟设备，没有 iOS 15／Android API 28 的最低版本运行证据；最低版本兼容须补相应模拟器或设备验证。
- P5-C 验证须分别记录静态／Node、浏览器、iOS 模拟器和 Android 模拟器：锁文件及产物 provenance、P4 六关回归、正式 bundle 无假商店／远程请求／微信／CloudBase／每日／广告、SQLite 故障注入、并发与重复 operation ID、进度先于奖励恢复、体力先于 Runner、语言／设置重启、两端六关及后台／强退恢复。真机断电、实际 OS 备份／恢复、卸载重装与闪存空间耗尽继续标为未验。任一端口只能靠假同步返回、共享运行码需要超出新白名单、或产物含 P4 资产时停止，不复制为正式原生载荷。

P5-C 的 [110 个 H 文件逐项建议清单](p5-c-scope-proposal.md) 已由用户批准，包括本机调试签名。H 的阶段锁以提交 `140648b527bd395c54e74e90244fc136ddd7f21b` 为基线，C 共享锁仍是 `0b53ad6bab9845e855f136b61a3a707817bf0472`、runtime contract 5；C 后续仅有文档提交，不静默刷新共享锁。P5-C 之后的商店权益与受保护 no-backup 缓存、真实商品 ID、StoreKit 2／Play Billing、沙盒购买／恢复／退款应作为下一份独立施工合同；再之后才处理真机性能、隐私／许可、发行签名与发布。当前目标仍是完整 App 化，不以六关试玩替代最终商业和发布验收；这些后续工作各自需要可核对的文件清单、账号／设备条件和明确授权。

P5-C 当前施工证据（2026-09-26）：H 已将正式入口接到共享异步 runtime、Swift／Java 系统 SQLite，操作摘要以同一原始请求字节计算，`full_game_v1` 固定为未拥有／商店不可用。静态／Node、双输出扫描、Chrome 的正式入口失败关闭与合成端口启动，以及 P4 六关浏览器回归通过。Android API 36 隔离模拟器完成六个免费关、普通档强退恢复、200 次真实设置写入和 10,000 条隔离操作日志；未来 schema、损坏 JSON／数据库头、同 ID 冲突等五项原生仪器测试通过。iOS 27 iPhone 18 Pro 模拟器已安装并运行到主页，普通 SQLite 创建与强退重启通过。iOS 原先在未来 schema 失败时改动 WAL 伴随文件，已改为先只读检查；在测试专用备份／恢复控制下，未来 schema、损坏 JSON 和无效数据库头均失败关闭，数据库、WAL、SHM 的 SHA-256 保持不变。另在独立 bundle 的模拟器隔离副本中编译 H 原样 Swift 存储文件，完成 10,000 条合成 operation，数据库 790,528 bytes、截断前 WAL 1,738,672 bytes、截断后 0；该结果不等于正式 App 10,000 次玩法提交。Android API 28 隔离模拟器揭示旧 WebView 中 `globalThis` 不存在导致正式入口读档前中断；H 入口改用 `window.Capacitor` 并以 Chrome 局部缺失该全局变量的回归覆盖。修复后 API 28 WebView 已进入 `Cleared ready`；通过 WebView 调试接口发送触控事件逐关完成六个免费关，第六关后显示完整游戏门禁。普通 SQLite 中有进度／奖励／体力三条记录和 33 条 operation，强退重启后的内部 Canvas 显示 `6/200`、600 金币；模拟器系统级触控也能打开门禁。五项原生存储仪器测试通过，含 10,000 条隔离 operation。系统截图在无窗口与软件渲染模式下仍只有状态栏和空白内容；WebView 内部 Canvas 图像不能替代实际显示验收。iOS 六关、语言／设置、200 次真实路径提交、完整双端故障矩阵、最低 iOS 15 与 API 28 系统显示均未验，因此 `nativeCopyEligible` 保持 `false`。真机断电、备份／恢复／卸载重装、商店与发布仍无证据。

P5-C iOS 优先补充（2026-09-27）：用户要求先做好 iOS，Android 新增工作暂停，原双端放行条件和 `nativeCopyEligible:false` 不变。H 的 iOS 27／iPhone 18 Pro 调试 App 通过模拟器真实触控完成六个免费关，完整游戏门禁继续显示未拥有且商店不可用；系统 SQLite 保存六关进度、600 金币、体力 5、中文和静音，强退重启后可读。主页声音开关经真实调用链写入 200 次，operation 数 36→236，约 25 秒含触控和绘制；主库／WAL／SHM 在检查点前分别为 4,096／3,242,472／32,768 bytes，检查点后主库为 69,632 bytes、WAL／SHM 消失。外部检查点揭示旧版只读预检在无 WAL 伴随文件时误报存档不可用：回归测试先在旧实现失败，修复后只在无 WAL 时以只读 immutable 方式检查主库，存在 WAL 时继续读取未合并提交；模拟器再次检查点并直接重启后，六关、中文、静音与累计 240 条 operation 均保留。另修复 UIKit 安全区注入早于异步读档生命周期绑定导致的冷启动状态栏重叠，模拟器冷启动截图已复核。在保留 20,632-byte 未合并 WAL 的隔离模拟器测试中移走 SHM 后直接启动，仍读回 242 条 operation 和六关／中文，SHM 重建后再一次真实设置写入使记录增至 243。H 的 `pnpm preflight`、Xcode 27.0 调试构建与安装通过；这些不是 iOS 15、真机、备份／重装、单次提交延迟、商店或发布验收。C 的共享代码与 H 的共享锁均未改。

同日继续以 iOS 模拟器真实触控写入 200 次设置，operation 数 243→443；临时 Debug 计时围绕 H Swift `ClearedStorageStore.commit(requestJSON:)` 得到 200 条日志，单次中位 1.0125 ms、p95 1.387 ms、最大 2.789 ms，包含串行队列等待、解析和 SQLite `COMMIT`，不包含 JS 桥接、触控或绘制。计时代码已移除，无埋点 App 重新构建安装后冷启动仍显示六关／中文／静音，SQLite 保留 443 条 operation。此证据仅为 iOS 27 模拟器 Debug 性能，不代表 iOS 15、真机或 Release；相关备份／重装、商店和发布验收仍未进行，C 共享代码与 H 共享锁继续不变。

用户已批准 [P5-D iOS 本地 StoreKit 逐文件白名单](p5-d-ios-scope-proposal.md)：仅以 Xcode 本地非消耗型商品、独立 no-backup 商业缓存和原生验证链实施模拟器方案，不创建 App Store Connect 商品，不使用沙盒账号，也不进行真机、发行签名或发布操作。Android 新增工作仍暂停，P5-C 的双平台 `nativeCopyEligible:false` 条件不变。本地模拟的恢复按钮只重查 Xcode 当前权益；正式商店所需的账号同步留待另一阶段。

P5-D 本地模拟实施记录（2026-09-27）：H 的 `5d6a4160f84d1ad29a9a058490bc626dac01e31b` 接入 iOS StoreKit 2 本地非消耗型商品、独立商业 SQLite、原生插件与只消费原生快照的 JS provider；`7ddd78c10a0a409451dc2752efc5b50dfe8b86c8` 修复插件通知晚安装时的当前快照补发；`b9d4c392643c199294b5aa58804ee8705295b980` 增加商业 SQLite 写入拒绝回归；`27ce5d5c9f38043fa00fc7559fb317dd48ec750b` 验证无交易恢复时旧缓存去权。Xcode 27 图形界面在 iOS 27 iPhone 18 Pro 模拟器运行 10 项 Swift XCTest 全过，覆盖购买／恢复／退款、pending 批准前不授权、启动未完成交易补扫、缓存失败关闭和普通存档隔离；注入写入拒绝时 App 不授权、不 `finish`，解除故障后重试落盘并完成交易。该故障注入不是系统真实低空间；迟到退款交易与通知竞态的回归断言均曾在错误实现下失败。Xcode Run 的原生桥显示本地夹具价格 `$1.99` 并成功读取既有普通档。H 从干净双仓工作区运行 `pnpm verify` 通过，Chrome 原生入口合成插件及六关浏览器 smoke 通过，iOS 15 SDK 类型检查通过。正式 App 的恢复／购买弹窗／取消按钮模拟器触控补证见下文；证据仍缺实际 App 完成购买、恢复已有交易、真实低空间、iOS 15 运行及真机／沙盒／商店验收。早先一次 CLI `xcodebuild test` 未能加载本地 StoreKit 配置，当次交易通过证据来自 Xcode 图形界面；后续原工程 CLI 复测见下文。C 共享运行码与 H `shared-source.lock.json` 未变，`nativeCopyEligible:false` 不变，不把本地模拟计为商店或发布放行。

P5-D UI 链路补充：H 的 `8037940b2f4fdd70e9ca8db948a7ddacdc670188` 在 Chrome `native-web` 合成插件中，经 Canvas 点击账号恢复与两次取消购买，确认调用只由用户操作触发、取消后仍可购买、普通档无新增提交；干净 H `pnpm verify` 通过。此项仅为浏览器证据。另建隔离的 iOS 27 iPhone 18 Pro 模拟器（`D28B2D14-F0CA-4A61-BF4D-5B0F796DDAC9`）后，Xcode 图形界面重新安装并启动正式 App；系统截图显示主页、`0/200` 和体力 5，原生桥日志显示 WebView 加载、普通存档打开／提交，以及未拥有的 StoreKit 快照和本地夹具价 `$1.99`。截图留在本机 `/tmp/cleared-p5d-after-load.png`，当时只证明启动显示。原模拟器的 Apple Account 登录提示未输入账号；新模拟器上 Device Hub 接口仍超时，后续改用隔离副本的 Xcode UI 测试补证触控。

P5-D 原生包扫描补充：H 的 `a1ecca8716f7f376068dc5a9c6a746078d812cb1` 在已批准的 `scripts/scan-bundle.js` 与合同测试内加入可选 iOS `.app` 检查。无签名 Release 模拟器包的 33 项锁定 Web 文件哈希一致，另有两个空 Cordova 占位文件；包内没有 `.storekit` 夹具。额外 JS、非空占位文件、改动游戏 bundle 和夹具注入均由负向测试拦截，干净 H `pnpm verify` 及实际包扫描通过。该证据只覆盖指定模拟器包的文件和字节，不改变 `nativeCopyEligible:false`，不证明 App 按钮触控、真实交易或发行包合规。

Device Hub 排障补充：经系统进程界面正常退出并重新启动 Device Hub，仅启动上述新模拟器后，其可访问接口仍超时；Xcode 再次启动 App，系统截图 `/tmp/cleared-p5d-after-devicehub-restart3.png` 仍显示主页。该现象不能归因于原模拟器登录提示或旧 Device Hub 进程，也不是 App 启动失败的证据；此时按钮触控验收尚未完成。

P5-D 命令行原生复测（2026-09-27）：从干净 H 工作树，以原始 `App` scheme 对 iOS 27 模拟器运行 `xcodebuild test -only-testing:AppTests/ClearedStoreKitOwnerTests CODE_SIGNING_ALLOWED=NO`，10 项 Swift XCTest 全过；结果包在本机 `/tmp/cleared-p5d-full-cli-result.xcresult`。本地交易由测试中的 `SKTestSession` 驱动。隔离副本与未修改 scheme 的对照单测均通过，因此没有把 Test 动作配置实验写回 H，也不能解释早先 CLI 失败。该原生结果自身不覆盖 App Canvas 触控、iOS 15、真机或商店。

P5-D 正式 App 模拟器触控补证（2026-09-27）：在 `/tmp` 的 H iOS 工程副本中临时加入 Xcode UI 测试目标，不改 H 仓库或其 scheme。首个只检查窗口存在的测试在 WebView 白屏时误通过；改为等待截图 OCR 识别实际主页／账户文字后，错误的头像坐标使测试按预期失败。修正坐标后，同一 iOS 27 模拟器完成主页头像→Account→Restore Purchases，界面返回“无既有购买”；再点 Buy Full Game，出现明确标注仅供测试、不会扣费的 Xcode 本地 StoreKit 确认页，关闭后界面显示“Purchase cancelled”，购买按钮仍在。最终 UI 测试 1／1 通过，截图在本机 `/tmp/cleared-p5d-purchase-cancel-ui-attachments/`，结果包为 `/tmp/cleared-p5d-purchase-cancel-ui-result.xcresult`；只读查询商业 SQLite 为 `not_owned`、无交易 ID、`pendingFinish=0`。临时 UI 测试没有纳入 H 白名单或提交，因此不是持久回归；App Canvas 的成功购买、已有交易恢复、pending 与退款的端到端触控仍未验。

继续确认本地购买时，Xcode 系统页显示“Your purchase was successful”及“Environment: Xcode”（本机截图 `/tmp/cleared-p5d-success-sheet.png`），但该轮临时 UI 测试未关闭系统成功提示，最终结果为失败；复跑又遇到旧模拟交易状态、夹具载入不一致和磁盘空间耗尽。释放空间后新模拟器已正常显示主页。没有得到 App `owned_verified`、商业 SQLite 入库与关卡解锁的联合证据，故成功购买和已有交易恢复仍未通过 App 端到端验收；系统提示不能代替该结论。

P5-D 本地交易管理器补证：Xcode 图形界面运行隔离 `App` scheme，在新 iOS 27 模拟器直接创建测试交易 ID `0` 后，独立商业 SQLite 与 App 原生桥发往 JS 的快照均为 `owned_verified`，无待 `finish`；退款后均为 `revoked`，重启仍去权；创建新交易 ID `1` 后均重新授权，旧退款墓碑仍保留。此证据覆盖 Xcode 本地交易更新、App 原生所有者、商业缓存、JS 桥与重启恢复，**没有点击 Canvas 购买／恢复按钮，也未观察关卡解锁**；不把它计为完整 App 购买或商店验收。

最低版本验收工具链复核：H 的 `0e291d28d7532d0776d01c85d257633855ea8e7c` 记录本机 macOS 27／Xcode 27 仅装 iOS 27 模拟器。[Apple 的 Xcode 支持表](https://developer.apple.com/xcode/system-requirements)将 Xcode 27 的 iOS 15 列为可部署目标，但设备和模拟器运行支持从 iOS 17 起。因此 iOS 15 类型检查只有静态效力；最低版本运行与 StoreKit 行为须使用受支持的其他工具链或日后经授权的设备／分发流程，不改 iOS 15 产品下限。

下一段 iOS 正式商店链路的[P5-E 施工前建议](p5-e-ios-storekit-scope-proposal.md)已完成审计，尚待逐文件白名单批准；代码实施和 App Store Connect／沙盒／真机授权分开。建议先隔离 Xcode 本地、沙盒及生产商业缓存，并解决 iOS 15 离线环境判定，再以真实商品和设备验证购买全生命周期。P5-D 的恢复、购买弹窗与取消已有正式 App 模拟器触控证据；交易管理器注入另有 App 原生缓存与 JS 快照证据，Canvas 成功购买和已有交易恢复仍未验。

2026-09-27 iOS 发布差距静态复核（C `c77ebb8fd39e2ee14c5c4601f52ef2f729348412`、H `0e291d28d7532d0776d01c85d257633855ea8e7c`，两仓干净）：H 的 `ios/App/App/Info.plist` 仍允许 iPhone／iPad 横屏，与第 9 节固定竖屏合同不符；`AppIcon.appiconset` 和 `Splash.imageset` 仍为 Capacitor 模板图。共享 `account:privacy` 按钮会显示，H 的 `src/canvas-platform.js` 却恒返回 `not-supported`，因此 App 当前没有可用的页内隐私政策入口；仓库也未配置发布用隐私政策／支持地址或素材许可清单。H App target 尚无自身 `PrivacyInfo.xcprivacy`；Capacitor podspec 声明了其组件的 manifest，且 H 未依赖 Capacitor Preferences，故不能只凭缺少 App 文件断言 manifest 不合规，必须对最终原生代码和依赖做 required-reason API／数据采集审计，再核对构建产物与 App Privacy 声明。[Apple 隐私 manifest 规则](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)、[App Privacy 与政策 URL 要求](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)、[App 图标要求](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)。普通 SQLite 目录已显式允许备份、商业缓存目录已显式排除备份；这只是源码配置，V25 的 OS 备份／重装恢复仍无真机证据。以上归 V25／V27 后续独立施工和发布验收，不加入待批准的 P5-E StoreKit 白名单；正式政策文本、支持地址、图标素材权利及任何商店表单均未由本次审计代填。

V27 iOS 发布面进一步核对（C `8f668b5fe97e3ac13739dd06996823d19b872053`、H `a5574cc1260916e5e00df4e83c77d6036dc6563b`）：共享 `src/app.js` 的 `account:privacy` 已调用平台接口并处理打开失败；H 的 `NativePlatform` 继承 `CanvasPlatform.openPrivacyContract()` 的恒失败实现。Apple 要求隐私政策链接在 App 内易于访问，App Store Connect 另需公开的隐私政策 URL；版本元数据还需支持 URL，支持页应提供可联系的方式。[审核指南 5.1.1](https://developer.apple.com/app-store/review/guidelines/)、[支持 URL 说明](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)。H 的正式 WebView 扫描会拒绝 bundle 中的 HTTP(S) URL，因此后续建议在 H 原生边界固定并校验政策地址、由 JS 只发起打开动作；不得为加入任意远程链接而静默放宽产物扫描。实际政策文本、可访问的 HTTPS 隐私／支持地址及数据收集声明须由发行方确认，当前没有可写入的真实值。

H 的 Xcode App target 当前 `TARGETED_DEVICE_FAMILY="1,2"`，同时面向 iPhone 和 iPad；第 3.3 节却只冻结“首版固定竖屏”。Apple 已将 iPad 的 `UIRequiresFullScreen` 兼容模式标为废弃，并要求考虑可调整尺寸及方向的窗口；只删 `Info.plist` 横屏值不能证明 iPad 发布界面可用。[Apple iPad 迁移说明](https://developer.apple.com/documentation/technotes/tn3192-migrating-your-app-from-the-deprecated-uirequiresfullscreen-key)。首版若仅支持 iPhone，应独立批准设备范围和 Xcode target 修改；若包含 iPad，须先冻结旋转、窗口尺寸、Canvas 安全区及实际交互矩阵。该产品选择、公开 URL、图标／启动图权利和最终依赖隐私清单均是 V27 后续逐文件施工建议的前置输入，不属于 P5-E 白名单或现有发布证据。

V27 的 [iOS 素材与第三方许可静态清单](p5-ios-asset-rights-audit.md) 已逐项盘点候选 WebView 的 30 个素材、原生模板图、双语文案与 Capacitor 依赖；已有哈希和生成链，但多数素材缺少可签收的 App 分发权属材料。该清单是待补证输入，不构成发布许可或 P5-E 扩围。

V27 的 [iOS 隐私数据流静态盘点](p5-ios-privacy-data-audit.md) 已按普通 SQLite、独立本地商业缓存、系统能力、第三方 manifest 与缺失的政策入口记录当前数据路径。WebView 无远程请求的浏览器证据不能替代原生／真机网络审查，也不能自动填写 App Privacy；正式政策、支持 URL 和最终候选仍待确认。

下一段 iOS 设备展示与隐私入口的 [P5-F 施工前建议](p5-f-ios-presentation-privacy-scope-proposal.md) 已列出精确 F1 文件白名单和验证矩阵；iPhone 首发只是建议，设备范围与真实 HTTPS 政策／支持地址尚待用户冻结。P5-E 商店代码审批与 F1 分开；图标、启动图和权利签收也不包含在 F1。此建议不授权代码、账号、签名或发布操作。

## 7. App 技术路线与构建边界

### 7.1 首选验证路线，不是已确定的技术承诺

基于当前 JavaScript＋Canvas 形态，优先验证“共享游戏 → 浏览器适配 → Capacitor 原生容器 → Android／iOS”。Capacitor 提供原生容器及插件能力，但不会自动转换微信 API。[官方介绍](https://capacitorjs.com/docs)

App 侧需要将 CommonJS 内容打包为宿主可运行的资源，并编译原生工程；微信端继续无常规构建步骤、可直接导入开发者工具。按 Capacitor 文档，独立宿主至少需要自己的 `package.json`、指向已构建 web 产物的 `webDir` 和一份具有 `<head>` 的 `index.html`；这些均属于 App 仓库，不能放入微信根目录。[Capacitor 安装前提](https://capacitorjs.com/docs/getting-started)、[官方构建流程](https://capacitorjs.com/docs/basics/workflow)

不承诺复用比例或商店通过率。是否最终采用该路线，由真机输入延迟、帧时间、内存、音频、资源与存储结果决定。只有测得当前路线无法满足明确目标，才提出更换渲染或引擎的独立方案。

### 7.2 一份源代码，分别产生包

- App 宿主在客户端根目录 C 之外拥有独立仓库根；原生工程、原生插件和构建依赖只属于该宿主，不成为微信运行依赖。
- 当前仓库是共享游戏代码和内容的唯一可编辑来源；App 仓库以 `shared-source.lock.json` 锁定完整 shared commit、tree hash、`runtimeContractVersion`、产品策略 hash、catalog 顺序／hash、`full_game_v1` 和六关快照，不再使用未定义的“内容版本”作为唯一证据。首版不使用 submodule。
- P4 本地验证可记录受控的只读本地来源；P5 发布锁必须指向可重现取得的规范仓库身份或不可变源码归档及其摘要，不能依赖某台电脑的可变绝对路径。
- CI 以当前 App host commit 和锁文件中的 shared commit 重现构建，并生成 `build-provenance.json`；发布构建遇到任一仓库工作树不干净、tree hash 不匹配、runtime contract 不兼容或六关快照漂移时直接失败。
- App 仓库提交打包器／Capacitor 的精确 JavaScript 依赖锁，原生工程使用已固定的 Gradle Wrapper／版本目录和 iOS 依赖锁（若使用）；构建禁止隐式升级 `latest`。`build-provenance.json` 记录 Node、Java、Xcode／Android SDK、Capacitor、打包器与原生插件版本。
- 生成产物允许复制进入 App 的生成目录和安装包，但生成文件不得被手工修改或成为第二份业务源码；通用修复必须从当前仓库重新构建流入 App。
- App 专用入口、平台适配、存储、购买和产品配置不得反向进入微信启动链路；只有确属两个宿主共用的能力，才按最小范围回到共享源码。
- 微信包排除 App 工程、构建工具和原生 SDK；App 包不得意外携带微信环境配置或启动云服务。
- App 首版不引入任何广告 SDK、广告位配置或广告素材；App 入口不装配每日挑战服务和排期数据。共享仓库可以保留微信所需实现，但不得因此在 App 中注册对应入口或运行任务。生产 bundle 需证明每日排期数据、广告 SDK／配置未进包，并对共享惰性兼容分支输出明细。
- 现有关卡 JSON／生成 JS 关系、主题 manifest 和发布校验不变，不手改生成文件。
- 正式宿主加载受信任的随包内容；外部网页不共享原生桥权限，不添加任意远程脚本执行能力。原生桥限制应按所选容器验证。[Android WebView 安全说明](https://developer.android.com/develop/ui/views/layout/webapps/webview)

### 7.3 微信编译、预览、上传不回归的硬边界

“不影响上传”在本方案中指：保持用户操作方式、微信工程类型、上传入口、入包完整性和现有运行合同；不承诺每次提交都无需验证，也不保证外部账号权限、网络或平台审核必然通过。

| 边界 | 当前事实及后续要求 |
| --- | --- |
| 工程类型与 AppID | `project.config.json` 的 `compileType: game`、当前 AppID 和项目根目录保持；不改成网页／普通小程序工程 |
| 微信入口 | 根 `game.js` 继续静态引用 `src/bootstrap.js` 并调用 `start()`；P1 仅在内部提取装配，不换上传入口 |
| 编译方式 | 保持 CommonJS、单 Canvas、无 npm 运行依赖；不要求先运行 App 构建、安装依赖、生成微信专用新入口或更换开发者工具工作流 |
| 入包依赖 | 新通用文件位于可入包路径，静态引用可追踪；两份词典与 LocaleService 必须随当前主包入口可达。不能用动态路径、忽略列表或跨包代码依赖使上传包缺模块 |
| 上传配置 | `project.config.json` 的 `packOptions`、编译设置，以及 `project.private.config.json` 不属于 P1／P2／P2.5-A／B／C 写入白名单；不能调整工具设置来掩盖缺依赖 |
| 分包 | `game.json` 与 `src/config/subpackages.js` 的 10 个主题分包加 1 个 `audio-bgm` 分包，共 11 个；名称、root、资源路径和空入口保持，不为 App 合包或重排微信分包 |
| App 工程隔离 | App 工程、SDK、`node_modules`、打包产物、缓存和原生项目不放入微信上传目录；不依赖开发者工具“恰好过滤未用文件”来隐藏这些内容 |
| 环境配置 | 内部／release 选择、开发本地覆盖排除和固定关闭备份的合同不变；App 环境不进入微信启动图 |
| 文档／测试 | 当前 `docs/`、README、`tests/`、`scripts/` 均由 `packOptions.ignore` 排除；新增或更新本文不增加该源码统计口径的上传包体 |
| 包体 | 每阶段重新测量；不得为通过预算提高阈值、移走必需资源或把加载失败伪装成功 |

2026-09-21 的既有文档更新、2026-09-22 的执行合同收口及本次 P0 均没有修改 `game.js`、`game.json`、`project.config.json`、`project.private.config.json`、`src/config/subpackages.js` 或云配置。从 P1 起如必须变化，先报告原因并单独批准，不能继续宣称处于“上传配置不变”的原范围内。

### 7.4 上传兼容性验收顺序

每阶段分开记录以下证据：

1. **源码与合同：**刷新差异、完整测试、入口与静态依赖检查；确认语言模块可达、App 模块不可达，且运行必需文件未被忽略。P1 的直接依赖检查与 P4 的最终产物检查分别记录。
2. **本地包与发布配置：**执行下列本地命令，记录字节、预算、环境与失败项。`--mode rollout` 仅选择检查规则，不启用任何云开关或部署。
3. **开发者工具：**直接打开同一微信项目，重新编译与预览；核对代码包分析，检查双语、普通关／每日挑战、主题分包、前后台和旧档。
4. **实际上传：**在用户单独授权上传后，以同一候选版本验证上传结果；保留版本号、提交／差异、工具版本和结果。没有该证据只能标记“本地预检通过，实际上传未验”。
5. **审核与发布：**与上传分开，不因上传成功自动标记审核、发布或真实云端验收通过。

```sh
node tests/run.js
node scripts/check-package-budget.js
node scripts/check-release-readiness.js --mode rollout
git diff --check
```

只要新增模块漏入包、微信编译失败、分包加载退化或超过项目预算，该阶段就不能以“App 原型已可运行”作为完成理由。先修复已批准范围内的兼容问题；需要改变上传配置、分包或产品行为时停止并报告。

### 7.5 2026-09-21 历史本地检查快照

以下数值由既有记录保留，执行基线是当时 HEAD `3f673682113aaa9fe6ac2fec7df7fb9777561d55` 及仅本文有未提交修改的工作区。它们不是 2026-09-22 本轮重新运行的结果，也不是未来 App 改造、开发者工具、真机或商店验收结果：

| 检查 | 历史结果 | 含义与限制 |
| --- | --- | --- |
| 完整 Node 回归 | 105 组通过，退出码 0 | 当时聚合入口的本地回归；不包含尚未实施的 App 阶段测试 |
| 主包源码估算 | 1,442,500 bytes，约 1.376 MiB | 低于项目 1.60 MiB 预算；不可视为无限扩张空间 |
| 微信分包 | 10 个主题加 `audio-bgm` 共 11 个全部通过；最大主题约 1.451 MiB，音频包约 1.604 MiB | 使用当时分包与 ignore 规则的源码字节估算 |
| 总包源码估算 | 16,415,611 bytes，约 15.655 MiB | 低于项目 18 MiB 预算 |
| release 配置预检 | `ready:true`，`mode:rollout`，无失败项 | 仅本地配置检查，不表示已上传／部署或真实云状态通过 |
| 文档入包 | 本文与 README 均被忽略 | 文档改动不改变该统计口径的包体 |
| 开发者工具／真实上传 | 该轮未执行 | 最终包体和上传结果仍需在改造后的候选包上验证 |

项目预算不是宣称微信当前所有账号／基础库的官方限制；最终以开发者工具和微信后台的实际校验为准。本文不以未经核实的平台限额为依据提高或调整现有项目预算。

## 8. App 首版不接玩法服务器

美国服务器、上海腾讯服务器及现有 CloudBase 都不调整，也不作为 App 首版依赖；不登录部署、不改域名／证书／数据库／云函数，不做跨区双写或容灾。App 的普通进度、金币和回廊拥有权仅使用本地存档。

一次性完整版权益由平台商店负责：iOS 使用 StoreKit 的已验证交易和当前权益，Android 使用 Play Billing 的购买查询、确认与恢复；App 按第 4.7—4.8 节缓存已可靠确认的永久权益供离线启动。Apple／Google 这里托管的是商店交易与同平台权益，不是游戏进度、金币或跨平台账号后端。[Apple StoreKit](https://developer.apple.com/documentation/storekit/in-app-purchase)、[Google Play Billing](https://developer.android.com/google/play/billing/integrate)

- 首版不创建 App 账号、交易账本服务器或跨平台权益服务。
- 客户端不得包含 App Store Server API 私钥、Google Play Developer API 服务账号密钥或任何服务器凭据。
- Google 官方仍建议安全后端处理购买验证和生命周期；首版选择简单非消耗型商品的客户端路径，正式发布前必须按届时 Play Billing 要求重新核查风险和合规性。[Google 后端集成说明](https://developer.android.com/google/play/billing/backend)
- 无服务器首版必须完成启动／回前台查询、Google acknowledgment、Apple finish、手动恢复及退款／撤销测试；不能因为不建服务器就只保留“购买成功”一条路径。
- P5 的安全／发布评审须显式签收“客户端方案的反欺诈和实时退款感知能力较弱”；若不接受，再独立立项服务端验证，不边做边默认扩建。
- 若未来需要跨 iOS／Android 共享购买、订阅、消耗型商品、云存档或更强退款／反欺诈处理，再单独批准自建、云函数或第三方托管后端；不得借首版架构预建无人使用的服务。

## 9. 正式 App 上架边界

“能打包安装”和“可上架”是两种验收。正式阶段需根据商店、地区和一次性买断模式复核完整性、隐私与数字内容购买要求；首版无账号、无每日挑战、无任何广告，不得在隐私声明或商店素材中虚构这些能力。[App Store 审核指南](https://developer.apple.com/app-store/review/guidelines/)

- 现有游戏币购买主题不是原生商店支付接口。
- App 首版不销售金币或其他消耗品；回廊 `10000` 金币使用游戏内本地余额。未来若销售金币，必须另行设计消耗型 IAP、恢复／幂等与交易账本，不沿用本非消耗型合同。
- App 免费下载，前 6 个主线关卡免费试玩；第 7 关及后续由一个非消耗型“一次性购买完整版”商品解锁。
- Apple 与 Google 分别配置商品和恢复购买；一端购买不自动解锁另一端。商品 ID 与价格在 P5 冻结。
- 购买页的币种和显示价格从当前商店商品信息读取，不在共享文案或运行逻辑中硬编码。
- 购买成功、已拥有或恢复成功必须经过平台验证；取消、pending、失败和商店不可用不能据此新增完整版权益；已确认权益的离线缓存按第 4.7 节保留，与普通游戏存档分开处理。
- App 首版不链接任何广告 SDK、广告商品或广告位，不以分享代替真实货币购买完整版。
- 若使用 Capacitor Preferences，iOS 工程按官方要求配置 `PrivacyInfo.xcprivacy`；所有原生插件和 SDK 列入数据采集清单，再如实填写 App Privacy／Google Play Data Safety。[Capacitor Preferences 隐私要求](https://capacitorjs.com/docs/apis/preferences)
- 发布候选版保存图像、字体、音效、BGM、翻译和第三方代码的来源／许可清单；“微信版已在用”不自动证明拥有 App Store／Google Play 分发权。
- 发布候选版提供可访问的隐私政策与支持联系方式，并按实际功能填写年龄／内容分级；首版不创建 App 账号，不显示虚假的“删除账号”。未来一旦增加账号创建，必须重新评审删除与数据权利流程。
- 签名证书、provisioning profile、keystore、商店 API 密钥和 CI 凭据只存于受控密钥管理，不提交到任一仓库、不打进客户端、不写入构建日志或 `build-provenance.json`。
- 固定竖屏、Android 返回键、安全区、无网、强退、升级、卸载／重装和 OS 备份恢复纳入发布候选真机矩阵。
- 不预先承诺某种容器一定通过审核，也不通过远程脚本绕过应用功能审核。
- 商店规则具有时效性，须在确定发行地区和正式送审前重新核查。2026-09-21 的既有资料核查记录保留；本轮 2026-09-22 仅针对购买查询／更新、pending／确认和 Preferences 存储语义重新查阅官方资料，不把它扩写成全部商店合规已复核。

## 10. 验收矩阵

| 编号 | 验收项 | 必须证明 | 证据边界 |
| --- | --- | --- | --- |
| V01 | 通用装配 | P1 新组合根不直接导入微信实现或云配置；可注入测试平台；既有传递依赖已登记 | Node＋直接依赖检查；完整产物归 V26 |
| V02 | 微信启动 | 同步返回、在线调度顺序、配置选择不变 | Node；开发者工具／设备另验 |
| V03 | 微信结算权威 | 待同步余额不能消费；断网不切本地发币 | 现有结算与失败回归 |
| V04 | 微信身份与回调 | 账号、环境、绑定变化后旧回执无权写入 | 现有隔离／恢复测试 |
| V05 | 存储失败 | 缺失、损坏、读取失败、写入失败分别处理 | 故障注入；不能只测试成功 |
| V06 | 产品隔离 | 两宿主不串存档、身份、待办和恢复 | 独立命名空间与拒绝交叉数据测试 |
| V07 | 输入与安全区 | 指针 ID、坐标、取消、多指、DPR 语义一致 | Node＋实际触控与画面 |
| V08 | 生命周期 | 不重复监听／循环；解绑、恢复和音频中断正确 | Node＋各宿主设备 |
| V09 | 资源 | 缺图、失败、重试、经典主题回退真实有效 | Node＋实际图片加载 |
| V10 | App 能力裁剪 | 无每日挑战、任何广告或奖励分享的入口、action、服务实例或运行时调用；产物无每日排期、广告 SDK／配置；普通提示走本地免费路径 | P2.5-A 功能矩阵、UI/action、依赖检查；P4 bundle 与请求观测 |
| V11 | 本地化语义 | 稳定 ID 和规则不变；微信每日日期不变，App 不因语言暴露每日入口 | 词条与业务回归 |
| V12 | 语言持久化 | 保存失败不虚报；云恢复不覆盖本地语言 | 旧档／坏值／恢复测试 |
| V13 | 长文本 | 换行、字体、按钮、安全区和点击区域可用 | 实际 Canvas 视觉检查 |
| V14 | 第二宿主闭环 | 同一份源码完整游玩，微信／线上调用为零 | 实际宿主＋请求观测 |
| V15 | 正式 App 保存 | 等待真实提交；强退、升级、空间不足可恢复 | P5 Android／iOS 原生设备，不借用浏览器或 P4.5 样例证据 |
| V16 | 构建与包边界 | 微信不含 App 依赖，App 不误启微信配置 | 实际构建与包内容检查 |
| V17 | 上架 | 所选商店、地区、账号和商业模式要求满足 | 正式专项，不由 Node 代替 |
| V18 | 微信上传兼容 | 同一项目可直接编译／预览；依赖齐全、分包不变、预算通过，获授权后记录实际上传结果 | 源码检查、开发者工具、实际上传分别记录，禁止相互替代 |
| V19 | 设置页复用 | App 可省略完整账号页，但必须在设置或购买面板提供可发现的恢复购买；如复用既有布局，只显示真实能力 | 页面／场景测试及第二宿主视觉交互 |
| V20 | 六关试玩 | 仅六个固定键具备商业访问资格且保留原进度规则；首页、选关、下一关、`openLevel`、试玩和冰封入口不可绕过；购买后保留试玩存档 | P2.5-B 目录快照、全路径门禁；P4／P5 升级与重启 |
| V21 | 一次性完整版 | 双语面板可发现、主动购买单飞；六状态与操作结果分离；查询、验证、幂等落盘、确认、恢复、退款／撤销、离线缓存和环境隔离正确 | fake 仅验合同；真实商店沙盒、真机与后台状态变化另验 |
| V22 | 回廊 App 覆盖 | 全部广告／分享条件解析为 `currency:10000`；微信原配置、稳定 ID 和行为不变 | 配置解析、实际服务实例与两宿主回归 |
| V23 | 独立宿主与单一源码 | H 位于 C 外；锁文件固定源码、runtime、策略、catalog 与六关；provenance 记录 host commit 与工具链；脏工作树不能发布 | 空缓存重现构建、锁文件漂移失败测试、两宿主回归 |
| V24 | App 本地权威 | `app-local` 的首通、体力、金币与回廊一致保存；空每日源不阻断普通奖励；无云待办；微信实例不能切入本地权威 | P2.5-C 真实服务＋失败存储、重启和重复操作；原生另验 |
| V25 | 系统备份与卸载 | 普通存档按声明恢复；完整版权益不从普通备份或卸载残留直接授权；无备份重装丢进度但可恢复购买 | iOS／Android 真机备份、卸载／重装、离线／联网矩阵 |
| V26 | App 构建可移植 | 锁定依赖与工具链，真实 bundle 不含禁止配置／SDK／每日数据；资源可枚举，惰性兼容分支有明细且不可达 | P4／P5 空缓存生产构建、产物扫描、缺资源负测试与安装包检查 |
| V27 | 发布合规与设备矩阵 | 隐私 manifest、隐私表单、政策／支持入口、许可、密钥隔离、竖屏／返回键与量化性能阈值完成 | 发布候选包、表单、清单、密钥扫描和真机报告 |
| V28 | 权益并发与生命周期 | 关闭面板不丢有效交易；旧查询不覆盖新权益；重复／pending／撤销／失效实例与写入失败可恢复；无第二权益所有者 | P2.5-B 消费者测试，P4 实际宿主归并测试，P5 真实商店／原生存储 |
| V29 | 策略唯一归属 | 共享层只有合同与查询；App 配置只归 H；生产不导入 fixture；冻结值、配置与锁文件一致 | 依赖扫描、配置规范化比对及漂移负测试 |
| V30 | 原生存储最小验证 | 候选 → 原生提交 → 确认 → 强退 → 重启闭环；无半扣款／半授权；输出 P5 最小影响清单 | P4.5 指定平台测试工程；明确未测平台与证据缺口，不替代 V15／V25 |

代码、配置或数据变化后执行完整 `node tests/run.js`；新增测试导出 `run` 并注册到聚合入口。完成每阶段后执行 `git diff --check` 并核验文件及方法白名单；纯文档远端编辑若未执行本地命令，必须如实单列，不能沿用历史成功记录。

平台／资源改动还应运行对应现有资源和包预算检查。Node 全绿不替代开发者工具、真机、StoreKit／Play Billing 沙盒、恢复购买或送审证据。

## 11. 全局禁止项与停工条件

### 11.1 全局禁止项

- 不改稳定关卡 ID、机制版本、action／hit ID、已发布 manifest ID 和当前微信存档 key。
- 不清空、自动迁移或覆盖真实玩家数据，不清理历史待办与恢复保护。
- 不打开历史备份模式，不改变微信云端资产权威。
- 不部署云服务，不改两台服务器，不上传安装包、送审或发布；本地运行代码提交只能包含当前独立阶段白名单内、已完成验证的差异，并须使用 GitHub Desktop。未经另行授权不推送任何提交。
- 不通过删除测试、放宽协议白名单或移除信任边界来兼容 App。
- 不在业务层散布微信、iOS、Android 分支。
- 不在微信运行链路引入 DOM、原生插件、npm 运行依赖或新构建步骤。
- 不在 C 内创建 `ios/`、`android/`、App 宿主配置、App 打包器、原生 SDK、`node_modules` 或 App 构建产物。
- 不在 App 宿主中维护可编辑的 `core/`、`data/`、共享 `src/ui/` 或关卡副本；不对生成的共享 bundle 做永久 App 专用补丁。
- 不擅自修改微信 AppID、工程类型、上传配置、分包入口／root、忽略列表或项目预算；这些不属于 P1／P2／P2.5-A／B／C 的施工白名单。
- 不重建旧小程序页面结构，不大规模搬文件、改语言或重写 Renderer。
- 不为 App 首版接入每日挑战、任何广告或奖励分享，不用完整购买自动授予回廊项目。
- 不为实现 App 专属价格而全局改写共享奖励目录；必须使用宿主注入的声明式覆盖策略，保持微信规则不变。
- 不用 Renderer 隐藏按钮代替内容门禁，不允许任何直接 `openLevel`、续玩、下一关或冰封入口绕过共用策略。
- 不将显式 `false`／`null`／disabled provider 解释为“未注入”并回退创建每日、广告或分享服务。
- 不以普通存档中的可编辑布尔值、购买按钮回调或未验证结果冒充完整版权益。
- 不把完整版权益缓存当作普通 OS 备份中可直接恢复的授权，不因退款／撤销删除普通游戏存档。
- 不因面板关闭丢弃有效交易，不用旧查询撤销新权益，不在 App／Renderer 另建权益权威；也不以并发保护为由永久忽略有效撤销。
- 不在共享运行码与 H 各维护一份 App 产品取值，不把测试 fixture 打入生产依赖。
- 不把 P1 的直接依赖通过写成传递依赖／最终 bundle 已通过，不合并 P2.5-A／B／C 的授权范围。
- 不从脏的共享工作树生成发布包，不跳过锁文件、runtime contract 或 catalog 快照校验。
- 不把签名证书、keystore、provisioning profile、商店／服务账号密钥、CI 凭据或可恢复的秘密写入源码、锁文件、构建产物或日志。
- 不用浏览器、Node 或最小原生样例证据替代正式原生持久化、真机、云端和商店验收。

### 11.2 必须停止并报告的情况

1. 与本地化或其他未提交工作重叠，无法在不覆盖用户修改的前提下推进。
2. 必须修改当前子阶段文件／方法白名单外内容，或超出 P2.5-C 已明确的 App 本地权威范围。
3. 需要变更存档 key、schema、账号归属、恢复顺序或云协议。
4. 平台差异迫使业务伪造保存／广告／支付成功。
5. 现有接口无法在原生异步存储下保持提交语义；应进入 P4.5 选型／P5 独立方案，而非现场全仓异步化。
6. 需要改变已确认的“固定六关试玩＋一次性完整版＋无每日挑战／任何广告／奖励分享＋回廊 10000 金币覆盖”合同，或新增账号、云存档、跨平台权益。
7. 需要真实账号操作、数据迁移、服务器部署或发布权限。
8. 微信编译、预览、模块入包、分包加载或包预算发生回归，需要修改原上传边界。
9. 独立宿主只能靠手工复制并继续编辑共享业务源码才能运行，无法形成可追溯的只读构建输入。
10. App 工具链或原生 SDK 必须进入 C，或者共享代码必须反向依赖 App 专用实现。
11. catalog 顺序或六个白名单 `levelKey` 变化，但未经产品复核和锁文件升级。
12. 真实打包器无法解析已知可选依赖，或产物仍包含 CloudBase／微信环境配置、每日排期数据、广告 SDK／配置、未记录的可疑兼容分支，或缺失必需资源。
13. 无服务器商店方案无法满足 acknowledgment／finish、恢复购买、退款／撤销、并发归并或风险接受要求。
14. 所选存储无法将普通存档与完整版权益缓存的 OS 备份／恢复语义分离。
15. 需要以购买面板／场景代次决定合法交易是否落盘，或实际宿主的权益唯一所有者无法成立。
16. P4.5 不能证明选定方案的提交与崩溃恢复合同，却准备承载正式存档或扩大原生施工。

报告具体文件、失败证据、影响合同和最小新增范围，等待明确方向；不能凭“完成 App 化”的目标自行扩展授权。

### 11.3 回退

按阶段保持差异可独立审查。运行改动回退不得清空存档或切换资产权威；涉及新原生存储／schema 的后续阶段，必须先设计版本兼容再实施。不得用 `reset --hard` 或批量覆盖撤销用户工作。

## 12. 建议执行顺序与完成定义

推荐顺序为 **P0 刷新 → P1 通用装配 → P2 平台合同 → P2.5-A 能力裁剪 → P2.5-B 内容门禁与购买界面合同 → P2.5-C App 本地权威 → P3 本地化回归 → P4 第二宿主验证 → P4.5 最小原生存储验证 → P5 正式 App 专项**。

原 P3 的建设不再重复执行；每个涉及微信运行代码的阶段均须遵守第 7.3—7.4 节。P2.5 的三个子阶段已分别实施、验收和提交。P4.5 在冻结独立测试工程清单后完成模拟器可覆盖的部分；P5-A／B、P5-C 原生调试宿主与普通存档、P5-D iOS 本地 StoreKit 模拟均已分别提交。P5-D 正式 App 的本地恢复、购买弹窗与取消已由模拟器临时 UI 测试补证，成功购买等触控矩阵仍未闭合。P5-E 的 iOS 正式 StoreKit 建议值已冻结但未获施工授权；App Store Connect、沙盒、真机和发布分别取得授权与证据。必须依赖真机、操作系统实际备份／恢复与商店的项目继续暂缓并记录证据缺口。

语言本地化已完成，账号页、文案和测试的后续修改已在历史核验期间提交为 `5010d7c`。各阶段以届时最新工作区为基线，不按早期提交覆盖这些内容，也不重新选择语言存储位置。

准备阶段完成需同时满足：同一份规则和内容被第二宿主使用；H 位于 C 外，锁文件与 CI 可从干净的两仓精确 commit 重现构建且不存在可编辑副本；真实 bundle 不携带禁止的微信配置、每日排期或广告 SDK／配置，残留惰性兼容分支如实列出且不可达；微信运行和旧档保护不变；六关白名单、全路径门禁、商店权益消费合同、`app-local`、无每日／广告／奖励分享及回廊覆盖有明确边界；策略生产归属唯一；恢复购买可发现；产品数据隔离；语言不影响规则和归属；宿主实际权益所有者通过并发／生命周期测试；平台缺失能力安全回退；P4.5 为 P5 提供可信存储选型及最小改造清单。

准备阶段的历史通过不单独证明真实购买或正式原生存档；P5-C 已在调试宿主接入原生普通存档，P5-D 只验证了本地模拟交易。正式 App 完成还需满足真实商店权益全生命周期、OS 备份／卸载、隐私／许可、真机性能和送审边界。金币产出和价格曲线不属于本方案完成标准。

## 13. 本次交付与验证记录

本节按日期保留历史事实。旧记录中的“本轮／当前／未提交”只指对应日期，不作为 2026-09-22 或未来施工的工作区与测试证明。

### 13.1 初稿记录：2026-09-08

- 新增本文与 README 索引；未实施 App 化。
- 初稿审阅基线的 Node 回归为 95 组通过，记录保留但不代表本地化后的当前版本。

### 13.2 本次更新：2026-09-09

- 将语言本地化改为已完成的现有能力，明确模块、独立设备 key、回退、手动选择和写失败语义；撤销将语言放进 ProgressStore 的旧建议。
- 原 P3 改为回归检查点，不重新建设词典、语言服务或切换器。
- 新增微信上传兼容硬边界、配置冻结范围、验证顺序、V18 和第 7.5 节当前检查证据；README 同步索引说明。
- 完整 Node 回归 97／97、源码包预算与本地 release 配置预检通过；检查 Markdown 本地链接和 `git diff --check`。
- 仅改本文及 README；保留本轮开始时已有的账号页、词典、测试和专题文档修改，不改代码、配置或真实数据。核验期间这些既有修改提交为 `5010d7c`，文件哈希未变化；该提交不是本轮文档操作。
- P1／P2／P4／P5 尚未实施，P3 的语言建设已在独立任务中完成；未来 P0 仍须刷新。
- 本轮未执行开发者工具、第二宿主、Android／iOS 真机、真实云端、广告／支付、实际上传、审核或发布。
- 未更改服务器、云服务、账号或真实存档；未提交或推送。

### 13.3 账号页归属与复用补充：2026-09-09

- 用户明确账号页修改是其独立操作，文档仅引用为既有基础，不列为本方案的实现成果。
- 补充第 5.6 节与 V19：未来 App 如需账号页，优先复用现有页面，隔离的是身份、存档和在线服务，不是必须复制或重做 UI。
- 同步更正本地化专题中“App 必须显示为 Settings”的预设；页面名称与是否提供登录仍待 App 产品阶段决定。
- 本次仅更新本文和 `docs/localization.md`，未改运行代码、上传配置或云服务；执行文档链接与差异检查，不重复运行行为测试。

### 13.4 App 首版单机买断合同：2026-09-21

- 确认 App 免费试玩固定前 6 个主线关卡，第 7 关及后续由一个非消耗型一次性完整版权益解锁；购买不自动授予回廊项目。
- 确认 App 首版无登录、云存档、玩法服务器、每日挑战和激励广告；Apple／Google 购买分别恢复，不跨平台共享。
- 确认仅在 App 中将回廊所有广告／分享解锁条件覆盖为单项 `10000` 金币，微信奖励目录、稳定 ID 和现有行为不变。
- 用户明确不评估金币产出和价格曲线；本文不设置相关验收门槛，也不据此新增奖励来源或调整价格。
- 本次仅更新本文，未修改 README、运行代码、奖励配置、当前微信产品行为、服务器或发布状态；行为测试、第二宿主、商店沙盒、真机和上架验收均未执行。

### 13.5 独立 App 宿主与共享源码边界：2026-09-21

- 确认工程层面另建位于客户端根目录 C 之外的独立 `ClearedApp` 宿主，代码层面继续复用当前仓库，不从零重写游戏。
- 当前 `ClearedMiniProgram` 仓库是规则、关卡、通用 Canvas UI、服务与素材的唯一可编辑共享来源；App 宿主只拥有入口、平台适配、本地存储、商店购买、产品策略和原生构建。
- P4 再确定具体传递机制，但必须只读、固定版本且可追溯；允许构建产物复制进安装包，不允许手工复制后形成长期分叉。
- 新增 P0／P1／P4／P5 边界、V23、全局禁止项和停工条件；本轮仍只修改方案文档，没有建立宿主工程、移动源码或执行 App 构建。

### 13.6 全面审计修复：2026-09-21

- 将当前基线刷新为 `3f673682113aaa9fe6ac2fec7df7fb9777561d55`、105 组 Node 回归、1 个主包与 11 个分包的字节估算；第 13.2 节的 2026-09-09 数字只作历史记录。
- 修复了原方案缺少可施工产品 seam 的问题：增加 P2.5 精确白名单、显式 disabled 语义、固定六关全路径门禁、空每日完成源和 `app-local` 领域权威。
- 明确 App 首版完全无广告／奖励分享、普通提示本地免费、`home:iceTrial` 需完整版，并要求回廊规则在服务创建前覆盖而非全局改目录。
- 补齐一次性购买状态机、Google acknowledgment、Apple verified／finish、启动／回前台刷新、必备恢复购买、退款／撤销、离线缓存、OS 备份和卸载合同。
- 将双仓传递方式从待定收敛为 `shared-source.lock.json` 锁定 shared commit／tree hash／runtime contract／catalog／六关快照，并由 `build-provenance.json` 记录 host commit 与锁文件摘要的可重现构建；首版不使用 submodule，脏工作树不能发布。
- 补齐真实 CommonJS bundle 扫描、动态依赖风险、资源完整性、Preferences 隐私 manifest、App Privacy／Data Safety、素材／音乐许可、固定竖屏、Android 返回键和可测性能阈值。
- 本地验证已通过：`node tests/run.js` 共 105 组、包预算（主包 1,442,500 bytes，11 个分包，总计 16,415,611 bytes）、`check-release-readiness --mode rollout`（`ready:true`）、Markdown 本地链接与 `git diff --check`。
- 本次仍仅修改本文，没有实施 P1—P5、建立 App 仓库、更改微信行为、访问服务器或执行上传；开发者工具、第二宿主、原生真机、商店沙盒、备份恢复和送审仍待各阶段取证。

### 13.7 执行合同收口：2026-09-22

- 以远端 `main` 的 `0fde16caa6c9732306141d2884cd8cfda0194f8f` 为本轮审阅起点，更新本文；不把远端状态当成用户本地工作区状态。
- 修正“关闭面板或场景变化后不更新授权”的歧义：界面代次只保护界面，宿主权益服务独立处理有效交易；新增第 4.8 节唯一所有者、并发归并、旧查询保护、重复／pending／撤销／强退与失败反例。
- 收窄 P1 为组合根直接依赖与装配职责分离，登记既有传递依赖，保留 P2.5-A 清理与 P4 真实产物验收，禁止提前修改 P1 白名单外代码。
- 将 P2.5 拆成 A／B／C，补文件、方法／构造区段、允许状态、不可改变的顺序和逐阶段测试；共享 App、进度、奖励与体力的领域所有权不变。
- 明确共享层拥有策略合同与查询，H 拥有唯一生产配置；测试 fixture 不进入生产，新增配置一致性与 hash 漂移验证。
- 增加 P4.5 最小原生存储验证及其独立授权、合成数据、失败矩阵和 P5 最小影响清单；不以 `await` 或浏览器成功代替提交可靠性。
- 同步更新 V01／V20／V21／V24 等验收措辞，增加 V28—V30，更新停工条件和执行顺序；产品模式、六关、回廊价格、无广告／每日、数据隔离和微信发布工作流不变。
- 本轮通过 GitHub 读取文档、相关源码和边界测试，并针对交易处理与存储语义查阅官方资料。仅进行文档与边界核对；没有重新执行 `node tests/run.js`、包预算、release 预检或本地 `git diff --check`，没有开发者工具、真机、原生存储、商店沙盒或发布证据。第 7.5 节及历史测试数字保持历史记录身份。
- 本轮写入范围仅为本文；README 索引与现有运行结构没有变化，因此不修改 README 或其他专题文档。没有实施任何 App 代码阶段、改微信配置／云服务／真实存档、建立 App 工程或执行安装包上传。

### 13.8 P0 本地基线刷新：2026-09-22

- 用户授权开始按阶段实施，并要求每完成一个独立任务后使用 GitHub Desktop 提交；真机专属验收暂缓，模拟器可用于其能够覆盖的验证。
- 从干净的本地 `main` `984303becf8afab1dcd4fc855cc4128f4e1d9460` 重新清点入口、平台、存储、权威域、直接构造者、App 依赖闭包、固定六关和回廊覆盖对象。
- 完整 Node 回归 105／105、包预算和 rollout 配置预检通过；P0 未执行开发者工具、模拟器、真机、商店、上传、审核或发布。
- 本阶段只更新本文与 README 的实施状态，没有运行行为、配置、存档、云端或真实数据变化；P1 仍须作为下一项独立代码任务实施和提交。

### 13.9 P1 通用装配：2026-09-22

- 新增版本化通用装配入口，把本地服务创建、App 连接和同步本地启动从微信 bootstrap 的直接职责中提取出来；微信入口和在线服务仍由原 bootstrap 所有。
- 新增纯测试平台回归和直接依赖／保留传递依赖门禁；App 默认依赖仍留待 P2.5-A，第二宿主与真实 bundle 仍留待 P4。
- 完整 Node 回归 106／106、包预算和 rollout 配置预检通过；开发者工具、模拟器、真机、上传与发布未执行。
- 本阶段按白名单更新 `src/bootstrap.js`、新增通用 runtime 与测试，并同步本文及 README；未修改 App、平台、业务服务、云配置、规则、数据、真实存档或远端系统。

### 13.10 P2 平台合同与生命周期：2026-09-22

- 为触摸和生命周期注册增加同引用、可重入解绑；在旧宿主没有 `off*` API 时，已解绑回调仍会失活，重新挂载不会重复响应。
- App 的 `start()`／`dispose()` 现在是单次挂载、可重复销毁；坐标、安全区、绝对时间戳、前后台和音频中断语义由新平台合同测试固定。
- 完整 Node 回归 107／107、包预算和 rollout 配置预检通过；开发者工具、模拟器、真机、上传与发布未执行。
- 本阶段只修改 `src/platform/wechat.js`、`src/app.js` 的 start／dispose 接缝及白名单测试和本文；没有改场景、Renderer、业务规则、存档 schema、云端或发布配置。

### 13.11 P2.5-A 显式能力裁剪：2026-09-22

- 新增纯 `ProductPolicy` 合同、App 测试 fixture 与可枚举的 App 可选依赖 loader；共享策略没有 App 六关、商品 ID 或价格生产取值。
- 禁用产品配置下没有每日／广告／分享服务引用、入口、hit 或有效 action；免费普通提示不写日期记录，空每日完成源不阻断普通奖励核对。微信 bootstrap 显式保留原能力和默认行为。
- 完整 Node 回归 108／108、包预算和 rollout 配置预检通过；开发者工具、模拟器、真机、上传与发布未执行。
- 本阶段没有实施完整版内容门禁、购买界面、真实商店、`app-local` 结算或第二宿主；这些仍分别归 P2.5-B、P2.5-C 与 P4。

### 13.12 P2.5-B 内容门禁与购买／恢复界面合同：2026-09-22

- `ProductPolicy` 新增不可变权益快照规范化与纯内容访问查询；App 的六关白名单和 `full_game_v1` 仍只存在于测试 fixture，共享生产源码没有硬编码这些取值。通用 runtime 合同版本升级为 `2`，只注入查询与宿主 store，不创建真实商店。
- `ProgressionService.accessStatus()` 先组合商业访问、再应用原进度规则；首页继续、选关、结果页下一关、直接 `openLevel()` 与冰封试玩都复用同一门禁。受限入口在创建 Runner 或调用体力解锁前停止；已完成记录和永久体力解锁不能绕过撤销后的商业门禁。
- Canvas 新增双语购买／恢复面板及稳定 `store:*` action；账号页保留可发现的恢复入口。缺少商店价格时只显示无价格购买文案，不猜测金额。购买、恢复和重试仅由明确点击触发。
- 为防购买弹层上的空白触摸穿透到底层选关滑页或棋盘手势，`onPointerStart()`／`onPointerMove()`／`onPointerEnd()` 只增加与既有奖励弹层同类的 store 模态截获；该必要最小扩展已同步回 P2.5-B 方法边界，不改变普通输入路径。
- 共享 App 只接受单调递增 revision 的只读权益快照：关闭面板仅丢弃旧界面反馈，不丢弃仍有效的 provider 更新；权益更新不自动进入关卡；`dispose()` 只解绑订阅，不调用宿主 provider 的 `dispose()`。
- fake provider 回归覆盖未购买、pending、取消、可重试／不可重试失败、恢复成功／未找到、撤销后的活动重置／失败重试／试玩重玩、旧／重复／乱序 revision、关闭面板或切换场景后的成功更新、启动／回前台刷新失败及失效 App 解绑。完整 Node 回归 109／109；包预算通过（主包 1,485,237 bytes，11 个分包，总计 16,458,348 bytes），rollout 配置预检为 `ready:true`，`git diff --check` 通过。
- 本阶段没有创建宿主权益所有者、真实 Apple／Google 商品或原生存储，也没有执行开发者工具、模拟器、真机、商店沙盒、上传、审核或发布；fake 成功不能作为这些边界的证据。`app-local` 结算仍归 P2.5-C，实际宿主归并与 bundle 验证仍归 P4。

### 13.13 P2.5-C 施工合同冻结：2026-09-22

- 在修改运行时前固定 `authority.mode`、宿主持有的独立存储命名空间、六域映射与奖励覆盖输入；不允许用断网、缺少云服务或普通本地存储自动推断 `app-local`。
- 组合根须在 App 和有状态服务产生副作用前校验完整合同，拒绝 SyncStore、ProgressSync、Economy、身份、云备份、在线及每日依赖；App 内 SyncStore 仍始终优先，权威或服务不一致时失败关闭。
- 奖励覆盖只做不变纯投影：首版 fixture／H 的五项广告／分享回廊统一为 `currency:10000`，稳定标识不变，共享奖励目录不变。RewardUnlockService 与 StaminaService 只允许全新、显式配置的实例进入 `app-local`，并补列体力 `settle()`／`snapshot()` 调用链。
- 本次只同步本文、README、奖励、体力和 CloudBase 专题文档，没有修改运行行为、配置、存档、云端或真实数据，也未执行开发者工具、模拟器、真机、商店、上传、审核或发布。P2.5-C 运行时代码和自动化仍待下一项独立任务实施。

### 13.14 P2.5-C App 本地权威实施：2026-09-22

- 通用 runtime 合同升级为 `3`。ProductPolicy 精确规范化完整六域、宿主持有的非空命名空间和奖励覆盖输入；`createLocalServices()` 在 Locale、Progress、Stamina、RewardUnlockService 等任何有状态服务读盘前，先拒绝禁止依赖、验证同步 `{ id, isolated:true }`、完成共享奖励目录的纯投影与完整 schema 校验。`startGame()` 只接受一份一致的规范策略，并重新生成商业访问查询，防止旧闭包或第二策略绕过六关门禁。
- App fixture 的五项 `rewarded_ad/share` 条目由外部声明投影为 `currency:10000`；真实 RewardUnlockService 目录必须与规范投影在稳定顺序、ID、kind、itemId、类型和价格上精确一致。共享 `src/config/rewards.js` 未修改；错误匹配数、损坏 schema、伪造价格、额外权威字段和混合服务都在 App 或业务存储副作用前失败。
- RewardUnlockService 与 StaminaService 只能在全新构造时选择 `app-local`，之后双向锁定。普通首通、金币购买、体力入场与快通退款使用候选写入；写失败回滚未确认内存状态。已持久化进度可在重启后幂等补发奖励／退款，重复恢复或购买不重复发放、返还或扣币；广告／分享授权仍拒绝。App 在创建 Runner、改变奖励弹层、同步或异步保存设置前复查领域权威，SyncStore／迁移冻结／备份恢复保护保持优先。
- 新增 `tests/app-local-authority.test.js`，并扩充产品策略、runtime、奖励、体力、主题异步回调和架构边界回归。同步测试覆盖命名空间缺失／不匹配／Promise、禁止依赖、策略冲突、奖励价格与 schema 漂移、失败回滚、重启补办、重复操作、两个逻辑命名空间隔离，以及微信默认／云权威／历史 `local-backup` 保护。
- 本地验证：`node tests/run.js` 110／110 组通过；包预算通过（主包 1,505,205 bytes，11 个分包，总计 16,478,316 bytes）；rollout 配置预检 `ready:true`；`git diff --check` 通过。未创建 H，也未执行微信开发者工具、Android／iOS 模拟器、真机、原生杀进程恢复、商店沙盒、上传、审核或发布；同步 fake storage 的成功不构成这些证据。

### 13.15 P3 本地化回归检查点：2026-09-22

- 按回归检查点执行完整 `node tests/run.js`，共 110／110 组通过；聚合入口中的 `tests/localization.test.js` 与 `tests/locale-service.test.js` 均通过。没有发现需要修改词典、LocaleService、Renderer、账号布局或存储合同的回归，本阶段不改运行代码。
- P1／P2／P2.5-A／B／C 后仍由通用 runtime 创建同一个 LocaleService，并注入 App 与 Renderer；既有 bootstrap 继续把该实例交给 Profile 与 Share 消费者。系统语言归一化、手动偏好优先、自动结果不写盘、写失败保留会话语言并返回失败、重启恢复和双语消费者回归均通过。
- 稳定 ID、云偏好、账号归属、服务器和微信 `Asia/Shanghai` 每日日期规则未因语言切换改变；App 产品矩阵仍禁用每日挑战。该结论来自现有边界测试与完整聚合回归，不扩写为开发者工具、原生系统或发布证据。
- 本阶段只更新本文与 README 的实施状态。`docs/localization.md` 的语言合同和证据边界仍准确，因没有语言行为变化、也没有新增开发者工具或真机证据而保持不变。
- 未执行微信开发者工具、Android／iOS 模拟器、真机、原生 Profile／Share、上传、审核或发布。当前没有独立 App 宿主可供模拟器验证；字体、长文本、换行、截断、安全区、触控、首次启动／重启和原生系统交互仍须在对应宿主与设备阶段取证。

### 13.16 P4 浏览器第二宿主验证：2026-09-23

- 独立 Git 仓库 H 已建立于 `/Users/ethan/Projects/ClearedApp`，最终验证提交为 `a31bd7f06ce6606d253635858c7b1b8d0da4f911`、tree `a9fe4d5b198db8fb2653dbc17e0748b53892bde5`；未配置或发布远端。H 的 25 个跟踪文件由 6 个顶层配置／说明文件、7 个 `scripts/` 构建文件、5 个 `src/` 宿主文件、5 个 `tests/` 验证文件和 2 个 `web/` 壳文件组成。生产依赖仅为精确锁定的 `esbuild@0.28.2` 与测试用 `playwright-core@1.63.0`，包管理器为 `pnpm@11.19.0`。
- `shared-source.lock.json` 锁定 C 的提交 `5c906ca8c9dc2f286cc9844eddd7b101e19eaed7`、tree `89ff40ff03ec9fbc9495e44777a131913bfd0f82`、runtime contract `3`、产品策略 hash、168 关目录顺序／内容 hash、`full_game_v1` 与六关快照。构建用 `git archive` 把该不可变提交展开到系统临时目录；完成或失败都在 `finally` 删除临时源码，只把 bundle、30 项枚举资源和带 hash 的浏览器验证 fixture 写入忽略的生成目录，不在 H 保留可编辑共享业务源码。
- 宿主唯一生产配置固定六关 `0:0`、`0:1`、`1:0`、`1:1`、`1:2`、`1:3`，关闭每日挑战、广告和分享，普通提示免费，冰封试玩要求完整版，五项广告／分享回廊纯投影为 `currency:10000`。浏览器平台适配实现 Canvas／DPR／安全区、Pointer Events、去重的前后台生命周期、绝对时间帧循环、图片回调、HTMLAudioElement 包装、系统语言和独立同步 localStorage 命名空间；缺失能力安全回退。
- 宿主权益唯一所有者回归覆盖购买、恢复、pending、取消、失败、重复交易、撤销、缓存重启、写入失败、旧查询、交易证据已入队但尚未提交时的查询竞争和销毁解绑。独立只读审计发现并复核了待提交交易被旧查询覆盖、临时源码快照残留及重复 visibility 事件三个问题；修复后没有剩余代码阻塞。
- `pnpm verify` 在 H 的干净工作树通过：Node `v24.14.0`、pnpm `11.19.0`、esbuild `0.28.2`、Google Chrome `153.0.8010.53`；正式 bundle 为 465,140 bytes、86 个输入、SHA-256 `d13116900a28c0a999e7efbde5a5d8aeea6ea67bb55bc8dc9fe87d2c89926fe8`。扫描验证 30 项资源及 bundle／资源 manifest／锁文件／fixture 与 provenance hash 一致，禁止输入为空，CSP 禁止远端连接；三个仍被打包但由产品合同及失败关闭 stub 保证不可达的兼容分支已写入 provenance。
- Chrome 自动闭环以 390×844 逻辑视口和 DPR 上限 2 完成六关；从结果下一关、选关、首页继续、冰封入口和直接打开共五条路径都不能绕过完整版门禁。假商店解锁后完成 Portal 关和冰封试玩；重载后保留 7 条完成记录、`en-US` 手动偏好、已验证权益和 Portal 访问。五项回廊投影正确，BGM 与至少一个音效从本地加载，16 个请求中远端请求为 0，页面错误为 0。五张中英文／重载截图已人工核对该视口下的长英文、商店面板、账号页与首页，没有发现截断或布局阻塞；这不外推为其他尺寸或原生设备视觉证据。
- 另从提交重新克隆 H，并使用全新的 pnpm store 执行 `pnpm install --frozen-lockfile` 和完整 `pnpm verify`；依赖、bundle hash、资源数、浏览器结果与原仓库一致，证明干净的两仓锁定输入可重现。C 本阶段只更新本文与 README 的实施状态，微信运行代码、配置、CloudBase、真实数据和发布流程没有变化。
- P4 仅证明共享源码的浏览器／WebView 第二宿主兼容性。浏览器 localStorage、fake store 和桌面 Chrome 不能证明 Android／iOS 原生持久化、杀进程恢复、备份／卸载、真实购买／恢复／退款、安装包、性能或上架能力；本阶段未执行微信开发者工具、Android／iOS 模拟器、真机、商店沙盒、上传、审核、推送或发布。P4.5 须先获得独立批准并冻结测试工程文件清单，P5 仍需另行设计与授权。

### 13.17 P4.5 最小原生存储验证：2026-09-23

- 用户独立批准 P4.5 后，只在 H 的冻结白名单 `experiments/storage-spike/` 内建立隔离测试工程；C 的共享运行码、真实玩家存档、微信／CloudBase 数据、正式权益、商品、网络、签名和发布均未触碰。测试 bundle ID／命名空间为 `com.godwhere.cleared.storagespike`／`p45.synthetic.v1`，数据全部为合成状态。
- 最终 H 提交为 `c337878039348c7646b3b177afcd4fb1a8af8383`、tree `b3563e664dc1af3aa5bbb2dba1bb5385220d43e7`；独立仓库仍未配置或发布远端。Capacitor 固定为 `8.5.2`；iOS 使用系统 SQLite3，Android 使用框架 `SQLiteDatabase`，不新增第三方数据库插件。
- iPhone 17 Pro 模拟器／iOS 26.5／Xcode 27.0（`27A266a`）使用 SQLite `3.51.0`；`Roco_API_36` 模拟器／Android 16 API 36／Temurin JDK 21 使用 SQLite `3.44.3`。两端均为 WAL、`synchronous=FULL` 和原生事务；Android 记录框架有界 `busy_timeout=2500 ms`。两端构建通过，Android lint 与 3／3 仪器测试通过。
- 两端各 10／10 场景通过：干净旧状态、写前失败、扣款后提交前强退、提交后回调前强退、明确成功后强退重读、同 operation ID 重试、并发排序、损坏读取失败关闭、事务内注入 `SQLITE_FULL`、进度先提交而奖励待办后幂等恢复。合成回廊交易只出现完整旧对 `(1000,false)` 或完整新对 `(600,true)`；native 结果与 JavaScript callback 分开记录，回调丢失后用相同 operation ID 重试不会重复扣款。
- `node scripts/verify-reports.mjs` 验证 2 份平台报告、每份 10 个标准场景、当前输入文件 SHA-256 与有效 PNG 截图；`node scripts/verify-scope.mjs --require-reports` 验证 99 个路径全部属于冻结白名单。两张模拟器截图已人工核对，均显示正确平台、独立命名空间与重置后的合成旧状态。
- C 仅更新本文的实施状态与证据边界；完整 Node 回归 110／110、包预算（主包 1,505,205 bytes，11 个分包，总计 16,478,316 bytes）和 rollout 配置预检 `ready:true` 均通过，`git diff --check` 通过。共享运行入口、微信配置、README 所述用户操作和包结构均未变化，因此本阶段不修改 README 或其他专题文档。
- 选型建议仅覆盖普通 App 本地状态：P5 增加独立异步存储接缝并逐个迁移 runtime 初始化、Progress、RewardUnlock、Stamina、Locale、设置消费者及 App 的必要调用点；微信同步存储合同不变。精确文件／调用链、顺序、测试清单与商业权益隔离要求保存在 H 的 `reports/conclusion.md`。
- 本轮仅核对 iOS Application Support 的 backup exclusion 属性为 false，以及 Android manifest／XML 明确允许普通数据库备份；没有执行实际 OS 备份／恢复、设备迁移、卸载／重装或 no-backup 商业权益缓存。强退是 `simctl terminate`／`adb force-stop`，空间不足为 `max_page_count` 故障注入，均不能替代真机断电、闪存耐久或真实磁盘耗尽。
- P4.5 不含 `full_game_v1`，也未执行 StoreKit／Play Billing、购买／恢复／退款、Apple finish、Google acknowledgment、签名、安装包、性能、商店审核、上传、推送或发布。P5 是剩余的唯一设计／实施阶段，仍须另行授权；上述真机与外部平台验收在获得相应条件前继续暂缓。

### 13.18 P5-B 共享异步普通存档接缝：2026-09-26

- 经单独批准，只在共享源码新增 `startAppLocalGameAsync()` 和 `AppLocalPersistence`；同步 `startGame()`／微信 `readStorageResult()`、`setStorage()` 合同不变。H 的正式原生载荷仍为 `contract-gate-only`、`nativeCopyEligible:false`。不生成 `ios/`／`android/`，不连接商店或签名。
- 正式普通 namespace 冻结为 `com.godwhere.cleared/ordinary/prod/v1`，容器 schema 为 1；四条逻辑记录维持 Progress v2、RewardUnlock v1、Stamina v1、Locale v1。宿主异步端口 `open({namespace,schemaVersion,keys})` 一次返回结构化存在性／schema；`commit({namespace,schemaVersion,operationId,writes})` 必须在同一原生事务内写入记录和操作 ID；`lookupOperation({namespace,schemaVersion,operationId,writes})` 用于提交回调不明时查询，并核对完整请求。只有 `{ok:true,committed:true,matches:true}` 能确认候选；`matches:false` 明确拒绝，缺少匹配结果则继续失败关闭。每个 namespace 串行构造候选、等待确认后更新内存；同 ID 同请求可重放，同 ID 不同请求须拒绝。明确失败保留旧状态；不明结果禁止后续写入直到同 ID 得到确认或明确失败。读取失败、损坏、未知未来 schema 均阻止启动并保留原字节，不按新安装初始化；未来升级须在原生单事务内迁移且禁止降级写入。P4 浏览器、P4.5 合成数据库、微信和 CloudBase 数据不导入。
- 异步启动在建立 App／Runner 前读取、校验、恢复已完成关卡的永久进入权、快通退款和普通首通奖励。入场先确认体力余额与永久解锁同写，再确认 `lastPlayed`，最后创建 Runner；普通完成先确认进度，再幂等处理奖励和退款。金币余额／拥有／待展示通知同写；失败时不展示虚假的到账。语言、主题、特效和声音由各自候选保存后更新本地确认状态；生命周期写入只是补充检查点，不代替关键事务。
- `full_game_v1` 继续由独立商业权益所有者控制，绝不写进普通 namespace；安装绑定、no-backup 的原生商业缓存、StoreKit 2／Play Billing、正式原生端口、备份和卸载重装验收属于后续阶段。P5-B 回归只证明 Node 故障注入与共享调用链；P4.5 的双模拟器合成 SQLite 证据不能外推为本接缝已在正式 App 模拟器或真机运行。
- 本地提交为 C 的 `584dc9e0760e7ab2aa28939b37db998e9bce53d8`／`abb68279c87293b642dd2988b7caac357c9b25ab` 及 H 的 `3054ac9c01ac93d562091957637a4ecebc5e8007`，均由 GitHub Desktop 完成且未推送。C 的 113／113 Node 测试、包预算、rollout 预检及差异检查通过；H 的 `pnpm preflight` 与提交后干净工作区的 `pnpm verify` 通过。H 共享锁在审查后从 `5c906ca8c9dc2f286cc9844eddd7b101e19eaed7` 升至 C 的 `abb68279c87293b642dd2988b7caac357c9b25ab`：普通目录 168→200、runtime contract 3→4，六个试玩快照、产品策略 hash 与 `full_game_v1` 均未变。两仓本地干净不等于远端 CI 已可取回未推送的 C 提交。
- 后续审计复现了回调不明且 operation ID 与旧请求冲突时，旧版只按 ID 查询会误确认新候选的缺陷；回归测试先在旧实现下失败。现将查询改为携带完整请求并要求端口返回明确的内容匹配结果，运行时合同由 4 升至 5。该修复仍只属于 P5-B 共享接缝，未开始 P5-C 原生端口。
- 同会话回归又复现了两个缓存缺陷：同一 operation ID 可被不同关卡误认，重放已确认操作会以旧进度快照覆盖之后保存的设置。显式操作现在绑定稳定的关卡／用时意图；冲突拒绝，合法重放返回最新确认记录且不重新写入。该修复仍属于 P5-B 共享运行码，不改变原生端口签名或普通存档 schema。
