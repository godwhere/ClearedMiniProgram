# 云结算模式收敛：实施方案与严格代码边界

> 日期：2026-09-08。状态：R0—R3 本地实施完成；V16 已按追加授权失败关闭，设备、真实云端及发布操作未执行。
> 客户端根目录 C：`/Users/ethan/Projects/ClearedMiniProgram`。
> 审阅基线：`main@c5c7baad5b1968c9b6052e9ddf643a1cb40e6c61`，加上当时工作区已有的四份文档修改。
> 本文只治理架构评价中的“风险 2：联网／结算状态并存造成维护成本”，不包含 App 总控或 Renderer 拆分。
> 用户本轮请求的是方案，不是实施、切换模式、部署或发布授权。下文白名单仅在用户另行批准实施后生效。

## 1. 决策与交付范围

本次推荐交付：**锁住现行云结算协议，补齐模式分派回归，在一个现有服务文件内整理启动分派，不改变玩家数据权威、请求节奏或恢复语义。**

首发继续采用“本地保存＋低频批量云结算”；金币到账和货币购买仍由云端确认。`local-backup` 维持未启用，不为它增加本次首发要求，也不删除其源码、测试或存档兼容代码。

这不是把四个状态删成一个开关，也不是改成本地发币、云端只存快照。模式多本身不是已证实的数据故障；若检查发现真实缺陷，必须按第 10 节分开处理。

本次完整实施的预算边界：

- **最多修改 1 个现有运行文件**：`src/services/progress-sync-service.js`。
- **最多新增 1 个测试文件**，另外只允许修改第 7 节列出的两个现有测试文件。
- **不新增运行文件、配置项、存档字段、接口、服务类、依赖或定时器。**
- 方案和实施记录只使用本文及现行联网说明；不重写历史接入／备份方案。
- 完成依据是行为保持和边界可验证，不是文件行数、删除分支数或新增测试数量。

## 2. 当前证据与仍未证明的事项

### 2.1 本轮已核对

| 位置 | 当前事实 |
| --- | --- |
| `src/config/cloudbase.internal.js`、`src/config/cloudbase.release.js` | 身份、读取、写入、首次建档、经济、体力和偏好均启用，`localBackupEnabled:false` |
| `src/bootstrap.js::cloudConfigForEnvironment/start` | 区分 develop／trial／release；创建现有服务，本地启动后异步恢复联网 |
| `src/services/sync-store.js::MODES/DOMAINS` | 四个兼容状态、六个数据域；保存各域权威，不是只保存一个统一联网开关 |
| `ProgressSyncService::state/atCheckpoint/bootstrapCloud` | 分别负责状态展示、检查点调度、云启动分派；它们的条件有意不同 |
| `ProgressSyncService::bootstrapCloud` | 未完成购买、待应用回执、待同步操作、迁移冻结会阻止进入备份路径 |
| `ProgressSyncService::runCloud/runMigration/ensureStage5Bootstrap` | 保留云读取、准入、首次建档／迁移、延后数据域接管和批量同步 |
| `AuthoritativeStateApplier::resumePending/applySyncReceipt` | 通过已有恢复记录逐域应用云回执；未完整保存不能提前确认完毕 |
| `App::resumeOnline`、`EconomyService::recoverPending` | 已有购买恢复链，不能在本次整理中搬移或重排 |
| `scripts/check-release-readiness.js::auditRelease` | rollout 模式已要求正式配置关闭本地备份，不应再造一个发布检查器 |
| `tests/cloud-runtime-config.test.js` | 已检查 release、trial、上传后 develop 回退配置均不切备份协议 |

2026-09-08 本轮规划期间重跑：`node tests/run.js` 的 89 组全部通过；`node scripts/check-release-readiness.js --mode rollout` 返回 `ready:true`。这是修改前客户端基线，不是下文新增测试已完成。

### 2.2 本轮未执行或未证明

- 没有读取或修改真实玩家存档、云数据库、后端部署配置。
- 没有证明真实账号存在“备份模式存档＋当前备份关闭”的组合。
- 没有证明上述组合一定导致覆盖或丢档；它是必须单独审查的兼容边界。
- 没有执行新的微信预览、手机回归、上传、送审、发布或上线后观察。
- 现有首发范围以 [当前联网说明](cloudbase-local-first-sync.md) 和 README 的最新状态为准；本文不改变准入、138 关目录或已有发布验收要求。

## 3. 不可破坏的契约

### 3.1 状态含义

| 持久化状态 | 含义 | 本次处理 |
| --- | --- | --- |
| `legacy-local` | 尚未完成云接管的本地状态，承载相应本地游玩和首次建档前状态 | 保留现有适用条件，不把它误认为可删除的旧 HTTP 功能 |
| `migration-freeze` | 迁移中的保护状态，限制会改变迁移来源的操作 | 保留，不取消冻结、不丢弃导入记录 |
| `cloud-authoritative` | 当前首发的云结算权威；进度可本地保存，资产结算需云确认 | 作为当前主路径，断网不能退回本地发币 |
| `local-backup` | 本地结算、云端仅备份的兼容状态，目前候选配置未启用 | 保留源码及解释能力，不能因开关关闭而抹掉存档中的状态 |

必须区分三件事：本版本配置允许的能力、存档已归属的数据权威、当前网络／恢复状态。三者不互相替代。

### 3.2 数据和安全

1. `SyncStore.domainAuthority` 继续是各数据域持久化权威的来源。奖励／体力服务的运行时校验保留，不再新增第二份独立决策状态。
2. 普通进度、每日、经济、永久拥有权、体力、偏好六域不合并；体力／偏好延后接管的混合状态继续兼容。
3. 所有存储 key、schemaVersion、owner／environment／bindingEpoch、operation ID、receipt ID、revision 和领取去重字段原样保留。
4. 身份、环境、绑定 epoch、激活序列或请求代次变化时，旧异步结果仍不得应用；每个原有安全校验点保持，不只在入口检查一次。
5. 不清队列，不伪造 ACK，不补币，不自动合并余额，不把已绑定云账号恢复成游客。
6. 先记录恢复任务、再逐域保存、全部成功后完成确认的顺序保持。保存失败和中断仍能按原协议恢复。
7. 云结算与本地备份不能对同一业务操作同时生效；展示奖励额度不等于已到账，不能仅凭 `ok:true` 推断到账或已同步。
8. `migrationEnabled:true` 目前也服务于正常新玩家首次建档；不得以“删旧迁移”为理由关闭。
9. 服务端准入未明确允许、身份读取失败、云档读取失败，均不自动授权模式切换。

### 3.3 请求和展示

- 保留现有 `identity.init`、`state.read`、迁移、`sync.push`、`economy.purchase` 的调用方、payload 和恢复方式。
- 不改变现行自动检查点 60 秒最小间隔、失败退避上限 5 分钟、5 次完成／40 条待办／3 分钟待办年龄的触发条件及适用分支。
- 保留无待办时的跳过条件、手动绕过冷却、同一在途任务复用、每批最多 50 条和单次最多 4 批；不增加轮询。
- 备份测试中的 3 分钟冷却、无变化零请求和旧 ACK 保护原样保留；不移植到当前云结算模式。
- 不改变 scene/action/hit ID、按钮、奖励文案、错误提示和页面可操作状态。
- 返回值中的 `status`、`reason`、`skipped`、`readOnlyPhase`、`backup` 等现有契约不改；内部决策原因不得直接泄漏成新的用户可见状态。

## 4. 目标代码结构：只整理一个现有分派点

### 4.1 不建立新“模式系统”

继续使用 `ProgressSyncService` 门面，既不创建 `SaveModeManager`／`OnlineCoordinator`，也不创建继承体系、插件注册表或通用状态机。

允许在 `progress-sync-service.js` 内部增加一个纯函数，建议名称 `selectCloudBootstrapRoute(input)`，只解释 `bootstrapCloud` 已有的分派条件。

建议输入仅包含调用现场读出的普通值：

- `backupAvailable`：`config.localBackupEnabled === true` 且现有 backup 服务已注入。
- `pendingPurchase`：现有 `economy.hasPendingPurchase(current)` 的结果。
- `pendingApplication`：当前 scope 是否有待应用云回执。
- `pendingOperationCount`：当前 scope 的待同步操作数。
- `progressAuthority`：当前进度域权威值。

输出只包含内部 `route: 'cloud' | 'backup' | 'blocked'` 和便于审阅的内部 `reason`。`blocked` 仅用于已授权的 V16 失败关闭并复用公开 `not-configured`；这些内部 route／reason 不是新的存档模式、API 字段或 UI 状态。

函数不得拿到 App、Store、API、platform、session 或 callback，不读写存储、不发请求、不查时钟、不创建或缓存模式。不得为了单元测试新增导出；通过现有 `bootstrapCloud` 公共入口测试。

### 4.2 分派表与优先级

身份、transport、当前 scope 和在途任务的现有入口检查先执行；本表不代替这些检查。

| 顺序 | 条件 | 路由 | 限制 |
| --- | --- | --- | --- |
| 1 | 存档进度域已是 `local-backup`，但当前版本未开启备份或没有注入备份服务 | `blocked`，返回既有 `not-configured` | 不发 `state.read`／`sync.push`／backup 请求，不改权威、队列或业务数据；这是 V16 确认后获得的追加授权 |
| 2 | 当前版本未开启备份，或没有注入备份服务；且存档不是 `local-backup` | 原 `runCloud` 路径 | 仅对原有受支持云／本地／迁移状态保持现状 |
| 3 | 存在未完成购买 | 原 `runCloud` 路径 | 不在此处恢复、取消或重建购买；后续恢复继续由原 App／Economy 链负责 |
| 4 | 存在待应用云回执 | 原 `runCloud` 路径 | 继续由 `resumePending` 恢复，不把回执删除来满足切换条件 |
| 5 | 存在待同步操作 | 原 `runCloud` 路径 | 继续原批量同步，不因“有待办”额外禁止正常游玩 |
| 6 | 进度域处于 `migration-freeze` | 原 `runCloud` 路径 | 继续既有恢复协议，不新增解冻步骤 |
| 7 | 备份已明确配置且上述旧任务均无阻塞 | 原 `backup.bootstrap(current)` 路径 | 只复用现有激活及恢复实现；不是允许上线启用新模式 |

必须覆盖单个阻塞、多个阻塞同时存在、阻塞消失后的下一次调用。不能启动时计算一次并持久缓存，也不能在旧流程执行一半时自动切到新流程。

保持当前 `inFlight`／`checkpointFlight` 的复用和 `finally` 清理语义；不要顺手把原非 async 方法改为 async，避免改变 Promise 对象身份和同步分支行为。

### 4.3 为什么不统一所有条件

以下三个判断不是重复实现，不能强行替换为同一个 `isLocalBackup()`：

- `state()`：决定展示哪个服务的状态，当前要求“配置可用＋存档已处于备份模式”。
- `atCheckpoint()`：决定检查点编排；`run()` 可能完成首次接管，必须保留执行后再次检查权威的顺序。
- `bootstrapCloud()`：决定本次云启动能否进入备份路径，必须考虑旧购买、回执、操作和迁移。

本次只集中第三种决策；前两种允许补解释性注释，**不改其执行语句**。`localChanged` 和所有业务 enqueue 方法也不纳入本轮重构。

这种边界刻意较小：优先让高风险切换条件可测试、可阅读；只有以后出现另一个真实调用方需要同一决策时，才重新评估是否提取文件。不能为了“以后可能有更多模式”先搭架构。

## 5. 行为保持与缺陷修复必须分开

本轮 R0—R3 是保持行为的架构收敛，不包含新的数据政策。

- 特征测试应在整理前通过，用来证明请求序列、返回值和持久化结果不变。
- 如果新增安全测试在原代码上失败，必须先区分：测试夹具不符合真实契约、既有缺陷、还是提出了新产品行为。
- 既有缺陷不能通过削弱断言、接受危险输出或把失败测试 `.skip` 后宣称解决。
- 需要修复时记录最小复现、可达条件、涉及方法、预期行为和额外文件，按第 10 节单独批准。
- 如果问题仅属于未启用路径且真实候选不受影响，可以完成互不相关的安全阶段，并明确列为未来启用前条件；不能称该组合“已验收”。

## 6. 分阶段执行与出口

### R0：刷新基线、确认既有保护

只读工作：

1. 重新读取 AGENTS、当前联网说明、本文涉及实现及调用者；核对 HEAD 和相关 diff。若涉及代码已有用户修改，重新确认边界，不以本文旧行号覆盖。
2. 记录原有修改清单及相关文件指纹。本文编写时已有修改为 README 和三份 cloud 文档，全部属于用户。
3. 重跑完整客户端测试和现有 rollout 预检，记录成功／失败；现有失败不得被重构掩盖。
4. 按第 9 节建立覆盖映射，优先引用已有用例，识别真正缺口。

出口：基线明确，当前首发协议不变，没有将历史方案误当成启用指令。此阶段没有运行代码、配置或数据写入。

### R1：先补回归，再运行原代码

允许修改：第 7 节 T1、T2、T3；本文仅记录结果。

1. 新测试必须由 `tests/run.js` 注册；测试文件导出 `run` 函数，不依赖直接执行文件。
2. 在唯一新增的模式路由测试中覆盖分派表、阻塞解除、错误配置组合审查、在途复用及旧结果保护。
3. 在已有检查点测试中补当前配置下的协议排他断言、生命周期和请求节奏断言；不要复制已有购买／迁移／回执测试。
4. 所有请求都使用明确的 fake API／内存存储，不读取本机真实 override，不连接实际环境。夹具固定时钟，异步采用可控 Promise；修改 require cache 或全局对象必须在 finally 恢复，App 必须 dispose。
5. 先在未修改生产逻辑的代码上运行。安全缺口按第 10 节处理，正常特征测试应通过。

出口：第 9 节每项有具体测试或明确的暂停原因；正常主路径已被测试锁住。不能在该阶段提前写重构“帮助测试通过”。

### R2：仅整理启动分派

允许修改：第 7 节 C1，以及 T1／T2 的必要断言；不修改其他服务。

1. 按第 4 节提取内部纯决策，保持原入口守卫、原流程和原输出。
2. `bootstrapCloud` 继续负责采集现场状态和调用选定流程；禁止在纯函数内藏入业务处理。
3. 不改 `runCloud` 的恢复与读取顺序，不改 `runMigration`，不改 App 中购买恢复，不改变任何 enqueue 行为。
4. 用 R1 的同一组固定输入比较重构前后结果：接口 action／顺序／操作 ID／payload／存档快照／公开返回值一致；涉及时间和生成 ID 的测试须固定来源或验证稳定关系，不能随意忽略业务字段。
5. 所有既有备份测试仍保留并运行；默认关闭不是删除其覆盖的理由。

出口：唯一运行 diff 落在 C1 的授权片段，没有新可见行为，完整测试和 rollout 预检通过。若纯提取没有实际可读性收益，允许以“R1 测试＋明确注释”结束，记录理由；不能为了完成阶段而增加无用抽象。

### R3：文档收口、范围核验与必要设备回归

允许修改：第 7 节 D1、D2；不扩大运行范围。

- 本文记录各阶段状态、测试日志位置、未解决组合、实际修改文件和是否改变运行代码。
- 当前联网说明最多增加一段指向本文的架构／验证说明，不改现行首发决定、历史证据、准入和开关描述。
- 按第 11 节验证。若有运行代码变更，实施完成与设备验收必须分开报告。
- 保持已有新账号建档、通关重进、第 138 关及发布检查，不追加新备份部署／双机备份冲突为此次首发要求。

出口：本地完成、设备结果、真实云端和发布状态各自有证据；未执行项明确标注，不能把全部标成“完成”。

## 7. 精确写入白名单

路径均相对 C。文件白名单不等于允许整文件重写，必须同时满足阶段和函数／片段边界。

| 编号 | 文件 | 允许修改的精确范围 | 不允许 |
| --- | --- | --- | --- |
| C1 | `src/services/progress-sync-service.js` | 文件内部新增一个第 4 节纯决策函数；`bootstrapCloud(session)` 内原 `pendingPurchase` 采集到 cloud／backup 分派块；`state()`、`atCheckpoint()` 只补注释 | 新增导出／实例状态／依赖；修改 constructor、schedule、localChanged、enqueue 系列、flush、bootstrapReadOnly、cloudMatches、cloudRequest、runCloud、runMigration、ensureStage5Bootstrap、drainCloud、pushCloud、旧 HTTP run；修改入口守卫和在途复用 |
| T1 | `tests/cloud-mode-routing.test.js`（新增） | 本次路由、阻塞、组合审查及公开入口回归；文件内局部测试夹具 | 真实 HTTP／云调用、写入真实存档、新增通用测试框架、导出生产内部函数来测试 |
| T2 | `tests/cloud-checkpoint-sync.test.js` | 现有 `client()` 测试夹具可增加可选配置参数且默认行为不变；新增当前候选配置的协议排他用例，补 `lifecycle()` 的必要断言，并在本文件导出的 run 中调用 | 删除或放宽 cadenceAndPersistence、retriesAndBatches、coalescing、purchaseCheckpoint 的现有断言；重写全文件或改变其他测试含义 |
| T3 | `tests/run.js` | 注册 T1 的一条聚合项 | 删除、跳过、改变已有 suite 顺序或测试执行机制 |
| D1 | `docs/cloud-settlement-mode-consolidation-plan.md` | 实施状态、实际边界、覆盖映射、验证证据和问题记录 | 把未授权方案改成已启用／已发布，或者事后扩白名单掩盖越界 |
| D2 | `docs/cloudbase-local-first-sync.md` | R3 中插入一段本文链接及无行为变化的职责说明；局部保存已有用户 diff | 改写首发协议、历史验收、开关、请求节奏或备份启用门槛 |

编写本文这一轮实际只允许新增 D1。未来 R0—R3 合计最多涉及上述 6 个文件；未列文件不因“测试需要”“顺手修复”自动获得写权限。

测试复用优先级：已有 `tests/helpers/cloud-stage4-services.js`、`tests/helpers/cloud-readonly-fixture.js`、`cloud-backup-service.test.js` 的 `run.setup`。这些 helper **只读复用**；若新增路由夹具需要轻量封装，放在 T1 内，不能修改共享 helper 默认语义。

本轮不改 README：没有新用户能力、入口、架构层、公开命令或发布流程，专题文档足以说明内部整理；README 本来已有用户修改，应保持。若实施导致上述事实变化，应视为越界，先重新确认。

## 8. 明确禁止修改和操作

除第 7 节之外，所有文件默认只读。尤其禁止：

- `src/app.js`、`src/bootstrap.js`、`src/platform/wechat.js`、`src/gameplay/**`、`src/ui/**`、`core/**`、关卡、素材、主题和特效。
- `src/config/**` 全部配置，包括 Git 忽略的本机 override；`game.json`、`project.config.json` 等打包配置。
- `sync-store.js`、`session-store.js`、`auth-service.js`、`api-client.js`、`cloud-function-transport.js`、`authoritative-state-applier.js`、`economy-service.js`、所有业务 Store、奖励／体力服务。
- `cloud-backup-service.js`、`backup-snapshot.js`、`legacy-migration-builder.js` 的实现及存档协议。
- 后端仓库 `/Users/ethan/Projects/ClearedCloudBase` 的代码、配置、函数包、集合、规则和部署。
- 修改用户既有四份文档中的无关片段，删除旧方案，清缓存／测试档／云数据，改变账号权限或环境。
- 自动 commit、push、创建 PR、部署、生成并分发新的微信候选包、上传、提交审核或发布。
- 新建自动化监控、长期任务、通用插件框架、运行依赖、编译工具链或后台定时同步。

若范围不足，先提交“触发用例＋为什么现有边界无法解决＋额外文件和方法＋行为影响”，等待单独确认。不得先改后补授权。

## 9. 验证矩阵与证据要求

“已有覆盖”表示优先复用并在实施时复跑，不代表以下每一新增组合在当前测试里都已完整覆盖。

| ID | 场景 | 必须证明 | 主要测试位置／实施方式 |
| --- | --- | --- | --- |
| V01 | release／trial／上传 develop 回退 | 仍使用既有云结算配置，备份关闭；release 不读本机 override | 复跑 `cloud-runtime-config.test.js`、`release-readiness.test.js` |
| V02 | 当前配置的启动、主页、账号和前后台 | 调用原身份／结算契约，`backup.read`／`backup.commit` 为零；云链不调用旧 HTTP | T2 的真实 App＋fake platform；精确检查请求 action，不只检查开关 |
| V03 | 当前配置、相关数据域已接管的普通完成、每日完成和设置变更 | 不调用备份；云权威资产不经本地兜底发币；原操作类型、模式和请求节奏保留。未接管本地状态另按原契约测试，不一概禁止本地结算 | `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart/cloudAuthoritativeDailyCompletionKeepsRewardsPending` 锁住普通／每日真实结算的余额与领取标记；`cloud-checkpoint-sync.test.js::currentProtocolExclusivity` 保留操作类型及 backup 零调用证据；复跑原 local-backup／legacy-local 套件 |
| V04 | 未注入备份／配置关闭 | 继续原正常 cloud 路由；不能因为缺少可选服务而崩溃 | T1 经 `bootstrapCloud` 测试 |
| V05 | 备份开启且无旧任务 | 只进入现有 backup.bootstrap，一次调用不同时进入 runCloud | T1 分派 spy＋现有 `cloud-backup-service.test.js` 集成行为 |
| V06 | 未完成购买、待回执、待操作、迁移冻结 | 四类阻塞逐个及组合阻止切换；不删除任务；解除后下一次重新评估 | T1；复跑 `cloud-backup-restore.test.js` 已有购买门禁用例 |
| V07 | 同时多次启动／检查点 | 返回原在途任务，执行一次；成功和失败后均能正常重试 | T1＋T2 原并发用例；不能只断言请求最终成功 |
| V08 | 当前云权威账号断网并重启 | 保留归属、进度和待办，未确认收益不通过本地兜底到账 | `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart` 使用全新 App／服务和复制的持久存储复载，逐项比较账号范围、六域权威、普通进度、完成操作身份、余额及领取标记；复跑 checkpoint／account-bootstrap suite |
| V09 | 首次建档和中断迁移 | 原导入记录可恢复，不重复建档／发奖，非空本地数据不被静默替换 | 复跑 `cloud-rollout.test.js`、`cloud-session-migration.test.js`、`cloud-new-device-restore.test.js` |
| V10 | 回执保存部分失败／部分 ACK | 保留恢复任务和未确认操作；重启重放原回执，只清真正完成的待办 | 复跑 `cloud-sync-partial-ack.test.js`、`cloud-stage5-client.test.js`、`sync-store.test.js`；T1 只补分派缺口 |
| V11 | 购买扣款后响应丢失 | 使用原购买操作恢复，不重复扣款，不提前进入备份 | 复跑 `cloud-economy-purchase.test.js`、`cloud-backup-restore.test.js` |
| V12 | 身份／账号／环境变化后旧响应返回 | 不应用新范围；旧在途失败不污染新范围冷却 | 复跑 `cloud-stale-callback.test.js`、`cloud-account-scope.test.js`、`cloud-environment-scope.test.js`；T1 保留分派守卫测试 |
| V13 | 核心域已接管，体力／偏好延后 | 各域权限不被全局化，原补建和幂等逻辑保留 | 复跑 `cloud-stage5-client.test.js`、`cloud-readonly-state.test.js` |
| V14 | 冷却、手动重试、批次与在途合并 | 60 秒／5 分钟、5／40／3 分钟触发、50×4 上限及无待办条件不变 | T2 原 cadence／retries／coalescing／purchaseCheckpoint；不删已有断言 |
| V15 | 已有备份模式及恢复测试 | 本地结算、保存失败、恢复中断、冲突确认、旧 ACK 仍按原协议工作 | 复跑 local-backup-settlement、cloud-backup-service、cloud-backup-restore suites，不启用真实配置 |
| V16 | 存档是 local-backup，当前开关关闭／服务缺失 | 先审查是否会进入不兼容读取／应用；不得据此伪造权威迁移或静默覆盖 | T1 专项模拟与第 10 节问题记录；这是待审查项，不预先宣称通过 |
| V17 | API／公开输出／数据格式 | 原请求 payload、操作 ID 关系、返回状态和存档结构保持；没有新存储 key | 固定输入的重构前后对比＋完整套件 |

路由 spy 只能证明选中了哪个入口，不能证明资产安全。V02／V03／V08 需要真实服务对象配 fake API 和跨实例保存读取，不能把 `authorityMode`、`applySyncReceipt` 或 `runCloud` 全部 stub 掉后声称完整结算已验收。

已有测试若足以证明某行，记录具体测试函数／断言即可；新增测试只填缺口。对新增用例做最小反例验证：在隔离的测试模拟中故意选择错误入口、移除一个阻塞条件或制造保存失败，确认相应断言确实能失败。不能永久改坏运行代码或依赖测试数量作为证明。

## 10. 发现新缺陷时的严格分流

重点组合是 V16。当前源码中的开关关闭分支可能进入 `runCloud`，但仅凭该入口选择不能推断实际覆盖；需模拟真实状态校验、回执应用和业务数据前后差异。

若确认存在危险：

1. 保存仅用虚构账号和内存存储的最小复现、请求轨迹、前后快照及失败断言。
2. 区分它是否可由当前候选的正常流程到达，还是只在未来启用备份／使用特制存档时出现；不捏造现有玩家受影响。
3. 不让“保持现状”的特征测试永久认可丢数据行为；不把失败用例改成跳过后宣称通过。
4. 先停下相关运行重构，报告需要的额外行为决定。若隔离性明确，可继续不受影响的只读核查和测试整理，但交付必须列出未完成项。
5. 候选修复原则是保留当前数据、拒绝未经授权的跨协议写入；究竟限制云应用、提示不兼容，还是保留对应恢复能力，需要独立方案和授权，不能在本次白名单内自行实现。
6. 若涉及 App 文案／可操作状态、Store 模式迁移或后端协议，必须另列新的文件和验收边界。本文不预授权任何一项。

账号域不一致、破坏首次建档、重复结算、回执中断丢失、原套件新增失败，也遵循这一分流，而不是一边修一边扩大重构。

## 11. 验证命令、设备边界和回退

### 11.1 本地检查

在 C 执行；完整日志写入临时目录，展示时只显示统计与末尾摘要：

```sh
node tests/run.js > /tmp/cleared-mode-consolidation-tests.log 2>&1
node scripts/check-release-readiness.js --mode rollout > /tmp/cleared-mode-consolidation-release.log 2>&1
git diff --check
git status --short
```

分别检查退出码，不能用最后一个命令成功掩盖前面失败。测试包含一个新增聚合项时通常从 89 组变为 90 组，但实际数量以届时版本为准，不能硬编码为验收条件。

- 新增文件未进入普通 `git diff` 时，单独检查内容和格式，不能漏审。
- 用阶段开始记录区分本轮 diff 与用户原有 diff；不能要求整个工作区干净，也不能格式化原有修改来“消除差异”。
- 在当前候选配置的测试中，直接对 `backup.read/backup.commit` 设失败断言，而不是删除备份服务来证明零请求。
- 不运行后端部署工具、真实账号重置、预览上传或云端写入脚本。

### 11.2 必要的设备验证

若本次只交付测试／文档且没有执行语义变化，不新增专项设备验收要求，保留原首发验收清单即可。

若 R2 修改运行代码，则需在获准的本地编译／预览和测试账号范围内验证：

- 启动和首次建档，账号页状态正确；不得为覆盖新账号场景直接重置已有 A／B 档。
- 已接管账号断网通关、退出重进、恢复网络后同步，进度及奖励不重复不丢失。
- 快速切前后台、回首页／账号页不会新增备份调用或异常重复结算。
- 使用游戏币购买和异常重试，结果与现行规则一致。
- 原候选第 138 关保存／奖励等既有要求继续保留，不在本文重复扩张为新内容项目。

无设备或没有真实账号操作授权时，交付“本地实现已验证、设备待验”，不代用户修改数据。新备份的部署、双设备备份冲突、真实 backup 接口恢复不属于本次新增验收。

### 11.3 回退

本方案不改数据结构和云协议，因此获准实施的 R2 应可通过撤销本轮代码片段回到原客户端逻辑，不需要清档、补币或回滚云数据。

回退必须按本轮补丁精确操作并保留用户修改；禁止 `git reset --hard`、整文件覆盖和清理工作区。若发现只有修改玩家数据才能回退，说明实施已越过本方案边界，应立即停止并报告。

## 12. 完成定义与交付格式

只有同时满足下列条件，才能称“风险 2 的本轮收敛已完成”：

1. 修改范围不超过第 7 节，且符合每个文件的方法／片段限制；运行文件最多一个。
2. 首发配置、正常新玩家准入、首次建档、目录、奖励数值、节奏和恢复语义不变。
3. 分派条件集中或已用足够测试与注释锁定；没有为了整理增加第二份权威、新服务或持久状态。
4. 验证矩阵逐项指向实际证据；未启用／不兼容组合有明确结论或范围外问题记录，不能隐藏。
5. 完整客户端测试、rollout 预检和差异检查通过；原有备份测试未删除或弱化。
6. 当前文档与实现一致；设备、真实云端及发布是否执行单独列明。

最终交付只需说明：实际修改文件与方法、行为是否保持、测试结果、未解决组合、设备待验和未执行的外部操作。不把“路线选择变清晰”夸大为所有联网复杂度已消失。

## 13. 当前规划交付记录

- 2026-09-08：完成代码和测试入口核对，新增本方案文档；尚未开始 R1 测试新增或 R2 运行整理。
- 规划基线测试：89 组通过；rollout 预检通过。测试日志：`/tmp/cleared-save-mode-plan-baseline.log`。
- 本轮不改 README 及其他已有修改，不改配置、运行代码、测试、后端或玩家数据。
- 本文交付检查：用户原有四份文档的内容指纹前后一致；现有 diff 和新增方案文档的空白／格式差异检查无错误。
- 用户后续批准实施时，默认范围为本文 R0—R3；第 10 节的新缺陷修复和未来备份启用／旧 HTTP 退役均不自动包含。

### 13.1 2026-09-08 实施进度

- 用户已批准按本文实施。R0 重新确认 `main@c5c7baad5b1968c9b6052e9ddf643a1cb40e6c61`；阶段开始时的用户修改仍为 README、三份既有 cloud 文档和本方案，运行代码无既有 diff。
- R0 客户端基线 89 组全部通过，日志为 `/tmp/cleared-mode-consolidation-r0-tests.log`；rollout 预检返回 `ready:true`，日志为 `/tmp/cleared-mode-consolidation-r0-release.log`。
- R1 新增 `tests/cloud-mode-routing.test.js` 并由 `tests/run.js` 注册；`tests/cloud-checkpoint-sync.test.js` 只扩展可选夹具和当前配置的协议排他／生命周期断言。生产实现尚未修改。
- R1 运行原生产实现后共有 89 组通过、1 组失败；失败仅为 V16 的安全断言。单组合日志为 `/tmp/cleared-mode-consolidation-r1-tests.log`，开关／服务三组合日志为 `/tmp/cleared-mode-consolidation-r1-v16-matrix.log`。这不是可以忽略的旧失败，也不是测试夹具误报。
- 用户随后明确授权“复用 `not-configured` 失败关闭、零云结算请求并保留本地数据”。R2 只在 `progress-sync-service.js` 增加内部 `selectCloudBootstrapRoute`、为 `state()`／`atCheckpoint()` 补职责注释，并整理 `bootstrapCloud` 原分派片段；未修改其他运行文件。
- R2 聚焦路由测试通过，日志为 `/tmp/cleared-mode-consolidation-r2-routing.log`；完整 90 组通过，日志为 `/tmp/cleared-mode-consolidation-r2-tests.log`；rollout 预检 `ready:true`，日志为 `/tmp/cleared-mode-consolidation-r2-release.log`。
- R3 仅更新本文与 `cloudbase-local-first-sync.md`。配置、Store、App、Renderer、后端、玩家数据及真实环境均未修改；没有部署、预览、上传、送审或发布。

### 13.2 R1 覆盖映射

| 验证项 | 当前证据 |
| --- | --- |
| V01 | R0 完整套件中的 `cloud-runtime-config.test.js`、`release-readiness.test.js` 通过；rollout 预检通过 |
| V02 | `cloud-checkpoint-sync.test.js::lifecycle/currentProtocolExclusivity` 通过；fake API 只观察到 `identity.init`、`state.read`、`sync.push`，注入的 backup 入口调用数为零 |
| V03 | `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart` 通过真实普通通关编排检查余额和 `claimedOrdinary`；`cloudAuthoritativeDailyCompletionKeepsRewardsPending` 通过真实每日入场及两关完成条件检查余额和 `claimedDaily`；两者的失败重试／奖励恢复均未提前结算。`currentProtocolExclusivity` 继续证明原操作类型和 backup 零调用 |
| V04—V06 | `cloud-mode-routing.test.js::configuredRoutesAndBlockers` 在抵达 V16 前通过：配置关闭、未注入服务、无阻塞、四类单阻塞、组合阻塞及解除后重评均符合原分派 |
| V07、V12 | `cloud-mode-routing.test.js::entryGuardsAndFlights` 在抵达 V16 前通过；并发复用、成功／失败后清理、未配置和 scope 失配入口均已锁定；原 stale/account/environment suites 通过 |
| V08 | `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart` 跨全新实例复载同一持久存储后，账号归属、六域权威、普通进度和原完成待办身份保持，余额及领取标记仍为云确认前基线 |
| V09—V15、V17 | R1 完整运行中相应既有 suite 均通过；未删除或放宽原备份、迁移、回执、购买、批次和权威断言 |
| V16 | `cloud-mode-routing.test.js::localBackupArchiveCannotFallThroughToCloud` 在原实现上失败并确认危险；追加授权修复后通过，三种能力缺失组合均零云结算／backup 请求、返回 `not-configured`，跨实例快照不变 |

### 13.3 V16 已确认问题与授权修复

最小复现只使用内存平台和虚构账号：先通过现有 backup 服务形成六域 `local-backup` 存档，再保存普通关卡 `0:0` 和余额 100；随后分别测试“`localBackupEnabled:false` 但 backup 服务仍注入”“开关开启但未注入 backup 服务”“开关关闭且服务缺失”三种组合，fake `state.read` 均返回同账号、同环境、六域完整但为空的合法云档。

三种组合的实际请求轨迹均为一次 `state.read`，公开结果均为 `{ ok:true, status:'cloud-synced', pending:0 }`。跨实例重载后的快照都从“普通进度含 `0:0`、余额 100、六域 `local-backup`”变成“普通进度为空、余额 0、六域 `cloud-authoritative`”。这证明只要开关或服务任一条件不满足，现有分支都会把兼容备份档送入云结算应用链并静默覆盖，而不只是选择了一个无害入口。

当前 checked-in 候选配置保持 `localBackupEnabled:false`，正常新档不会由该配置生成 `local-backup`；本轮也没有证据表明真实玩家已持有这种组合。因此不能声称当前玩家已经受影响，但也不能把特制／旧版本可持久化到的状态视为安全。

用户已单独批准最小失败关闭政策：`ProgressSyncService.bootstrapCloud`／内部分派识别“存档是 `local-backup` 但当前 backup 能力不可用”，禁止 `runCloud`，把进程内服务状态设为现有 `error`，返回 `{ ok:false, reason:'not-configured' }`，不写 Store 或业务域。`App.cloudAccountMessage` 已将这类失败映射为“云连接未完成，本地进度已保留”，因此没有新增公开状态、文案或 App／Renderer 修改。

修复后同一三组合测试均没有发出 `state.read`、`sync.push` 或 backup 调用；公开结果、服务状态和跨实例持久快照符合授权。另有组合用例证明，即使该不兼容档同时声明旧购买、回执和操作，失败关闭仍优先且不会清除任务。正常 cloud、旧购买／回执／操作／迁移恢复及已配置 backup 分支仍使用原路径，完整套件未出现其他差异。

### 13.4 最终边界与未执行项

- 实际运行 diff 只有 `src/services/progress-sync-service.js`；没有新增运行文件、依赖、配置、存档字段、API、服务类或定时器。
- 实际测试 diff 为新增 `tests/cloud-mode-routing.test.js`、注册 `tests/run.js`，以及局部扩展 `tests/cloud-checkpoint-sync.test.js`；原备份、节奏、购买、迁移和回执断言均保留。
- 当前首发仍是本地保存＋低频批量云结算；`localBackupEnabled:false` 和后端备份开关未变。V16 只保护不兼容存档，不启用 backup，也不把断网资产改成本地发放。
- 因本轮没有微信开发者工具／测试账号操作授权，未执行编译预览、真机启动／断网通关／前后台／购买回归、真实 CloudBase 读取或发布流程。R2 的本地实现已验证，设备与真实环境仍按第 11.2 节待验；这不等于手机或线上已生效。

### 13.5 V03／V08 验收缺口补测

- 本轮只修改 `tests/cloud-mode-routing.test.js` 的文件内夹具／用例及本文的 V03／V08 记录；没有修改 `cloud-checkpoint-sync.test.js`、测试入口或任何运行代码、配置、Store、存档结构、后端与结算规则。
- `cloudAuthoritativeOfflineCompletionSurvivesRestart` 先由 fake `identity.init/state.read` 回执完成六域云接管，并确认 `progress`、`daily`、`economy`、`entitlements`、`stamina`、`preferences` 都是 `cloud-authoritative`。选用尚未完成且未领取的普通关卡 `0:0`，记录 `SyncStore.context` 的 owner／environment／bindingEpoch／activationSequence、local owner／environment、`SessionStore` 的迁移身份、普通进度、奖励持久档和完成待办基线。
- 同一函数在 fake API 返回 `STORE_TEMPORARY` 后走真实 `openLevel`、Runner 手势和 `App.onPathCompleted`：持久档中的 `completed['0:0']`、`bestMs['0:0']`、`lastPlayed`、`stats.totalClears` 更新；结果奖励保持 `{status:'pending', amount:0}`；奖励余额、`claimedOrdinary`、`claimedDaily` 及奖励持久档与结算前完全相同；六域权威和账号范围不降级；没有 `backup.read/backup.commit`。
- 该函数随后销毁旧 App，用复制出的同一份内存存储和新的 fake platform 重建 App、ProgressStore、RewardUnlockService、SyncStore、ProgressSyncService，网络继续失败。重载后再次比较账号／环境／绑定／迁移身份、六域权威和普通进度；按 `MAIN_LEVEL_COMPLETED + levelKey` 精确定位待办，并逐字段保留原 `operationId`、`payloadHash`、payload、owner／environment／bindingEpoch，不以全队列长度代替，也没有生成等价完成待办。启动重试、显式重试及两次 `recoverRewardUnlocks` 后，余额和领取标记仍为云确认前基线。
- `cloudAuthoritativeDailyCompletionKeepsRewardsPending` 使用同一六域接管夹具和固定 2026-09-07 时钟，先通过真实 `enterDaily` 入场限制，再通过 Canvas 指针路径完成入门与极难两关。用例确认 `completionRecorded/dayFirstClear` 和 DailyProgressStore 的完整日记录均成立，且存在一条 `DAILY_ENTRY_RECORDED` 和两条身份不同、levelIndex 为 0／1 的 `DAILY_LEVEL_COMPLETED`；这不是直接调用 enqueue 伪造的每日结算。奖励结果仍为 pending，余额和 `claimedDaily['2026-09-07']` 未改变；动作重试、奖励恢复和离线云重试后操作身份及资产基线仍保持，backup 请求为零。
- `cloud-checkpoint-sync.test.js::currentProtocolExclusivity` 未改动，继续检查 `MAIN_LEVEL_COMPLETED`、`DAILY_LEVEL_COMPLETED`、`PREFERENCE_FIELD_SET` 原操作类型以及 backup 两入口零调用；本轮没有删除、跳过或放宽请求节奏、并发、批次、购买和协议排他断言。原 legacy-local／local-backup 结算用例仍在完整套件内通过，因此本次云权威断言没有一概禁止未接管状态的本地结算。
- 新增模式路由聚合用例连续两次聚焦运行通过，日志为 `/tmp/cleared-v03-v08-routing-1.log`、`/tmp/cleared-v03-v08-routing-2.log`。本轮完整 `node tests/run.js` 为 90 组通过、0 组失败，日志为 `/tmp/cleared-v03-v08-tests.log`；rollout 发布预检退出码为 0 且 `ready:true`，日志为 `/tmp/cleared-v03-v08-release.log`。没有发现需要扩大运行修改边界的缺陷。
- 本轮没有连接真实 CloudBase、读取或改写真实账号、清档、部署、预览、上传或发布；微信开发者工具、真机断网重启及真实云恢复仍未执行，不能由本地 fake API 回归替代。
