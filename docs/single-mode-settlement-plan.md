# 单方案结算收敛：实施方案与严格代码施工边界

> 日期：2026-09-08。
> 状态：S0—S3 本地实施完成；本轮单方案结算真机测试已通过（用户确认，登记日期 2026-09-08）。设备与云日志未由代理独立核验，微信开发者工具及发布验收不随本次登记标记通过。
> 客户端根目录 C：`/Users/ethan/Projects/ClearedMiniProgram`。
> 代码审阅基线：`0608a2c4924726d20f9d789ab3bddd2fe92f0b54`。实施前必须重新记录 HEAD、工作区差异和测试基线。
> 关联：[现行联网方式](cloudbase-local-first-sync.md)、[上一轮启动分派收敛及验收记录](cloud-settlement-mode-consolidation-plan.md)、[历史备份设计](local-settlement-cloud-backup-plan.md)。

## 1. 推荐结论：只保留一个正式运行方案

**推荐唯一正式方案：本地保存＋低频批量云结算。**

不再把“本地直接发币＋云端只存快照”作为正常启动可以启用的备选方案。原有备份代码暂时保留为历史兼容与回归材料，不继续扩展，不增加首发启用或部署任务。

这是基于当前首发决定、候选配置和已有实现作出的推荐，不代表用户今后不能重新选择本地结算。如果未来确有新需求，应独立设计和验证，不保留一个随时切换资产权威的运行开关。

### 1.1 为什么不再维护备选

- 主方案已经支持本地保存、离线待办、重试和恢复；断网处理不需要第二套发币规则。
- 两套方案的金币权威、购买、请求协议和恢复方式不同，“备选”不是低成本容灾。
- 当前备份默认关闭，也没有本轮立即启用的需求；继续为正常启动装配它，会持续保留未来误启用入口和依赖关系。
- 删除整套兼容代码涉及旧档、待办、恢复任务和测试，不适合与首轮入口收敛一起实施。

因此采用：**正式入口收束为一个方案，存档兼容保护继续保留。** 不以一次性删光所有分支作为交付目标。

### 1.2 唯一方案的玩家合同

| 项目 | 保持的行为 |
| --- | --- |
| 普通／每日进度 | 先可靠保存到本机，再登记原有云待办 |
| 金币到账 | 完成云接管后等待有效回执，不提前改余额或领取标记 |
| 游戏币购买 | 云端确认扣款与所有权；重试沿用原操作身份 |
| 断网 | 原本允许的游玩继续，云奖励待确认，不切换本地发币 |
| 首次启动／接管前旧本地档 | 沿用现有初始化、本地行为和首次建档流程，不新增强制联网门槛 |
| 云恢复 | 原云状态读取、回执应用、迁移和跨设备恢复合同继续保留 |
| 同步频率 | 原事件触发、冷却、退避和批量规则不变，不新增轮询 |
| 配置失效或云暂不可用 | 原错误和重试处理，不开启另一种结算协议 |

本轮讨论的“备份方案退役”特指 `CloudBackupService` 的本地结算＋快照备份协议；**不删除主方案的云存档、跨设备恢复，也不按文件名包含 backup 就删除其他兼容能力。**

### 1.3 后续显示层补充（2026-09-08）

单方案入口完成后，云权威模式增加了一个只读“显示合计”：确认余额加当前账号／环境／绑定 scope 中已可靠保存的普通或每日首通待办。该值只进入首页与购买确认 ViewModel，不修改 `RewardUnlockService.view()`、余额、领取标记、拥有权、待办协议、同步频率或购买协议，因此不构成恢复本地结算备选。

待办金额由现有奖励配置计算，普通按有效 catalog `levelKey`、每日按完整两关的 `dateKey` 去重；本地保存或入队失败不显示，断网／在途／可重试时保留，ACK 后由确认余额接替，拒绝后移除。迁移、只读、回执应用和恢复保护状态失败关闭。购买依旧先同步收益，再请求云端扣款与授予所有权。

## 2. “一个方案”与“四种存档状态”并不矛盾

| 现有编码 | 单方案下的定位 | 必须保留 |
| --- | --- | --- |
| `cloud-authoritative` | 唯一正式云结算方案已接管 | 云确认、去重、回执应用和离线待办 |
| `legacy-local` | 接管前初始化／旧档兼容 | 既有本地行为及首次建档，不自动改成云已接管 |
| `migration-freeze` | 迁移或异常保护 | 阻断、恢复依据和身份校验，不自动解除 |
| `local-backup` | 不再从正常启动新启用的历史存档类型 | 原数据、原恢复依据、拒绝错误切回云端的保护 |

重要限制：

1. 六域 `progress/daily/economy/entitlements/stamina/preferences` 继续独立读取权威；进度接管不代表体力、设置或资产已经接管。
2. `legacy-local` 确实有本地结算行为；不能为凑“一个模式”直接改成 `cloud-authoritative` 或删掉首次建档路径。
3. `migration-freeze` 也可能用于坏存档保护。没有迁移记录不代表可以解冻，`SyncStore.blocked` 等检查不能删除。
4. `local-backup` 不能直接转成云权威，更不能用旧云余额覆盖本地新增资产。
5. 本轮不改四种编码、schema、六域状态或恢复协议，不承诺“所有代码中只剩一个状态值”。

### 2.1 历史备份存档的真实边界

现有 V16 保护保证：备份存档在缺少／关闭备份能力时，云启动返回原 `not-configured`，不误发两类协议请求、不将其转成云权威。

**这不等于整个 App 已经实现历史备份存档只读隔离。** App、奖励和体力服务仍有该类型的本地兼容处理。本轮不修改这些行为，也不能在验收报告中宣称它们已经删除或全部禁止写入。

对这类旧档，本轮必须证明撤掉备份装配后没有相对于当前默认关闭配置新增的数据改写或权威变化。遇到未完成备份恢复时，保留原阻断和恢复记录，不能伪装恢复成功；实际恢复／转档需要另行授权和专门方案。

不因尚未证明真实账号使用过备份，就假定没有此类存档；也不为验证而清除现有玩家数据。

## 3. 最小实现：只收敛组合根

当前 `src/bootstrap.js::start` 即使在备份关闭时，也会创建 `BackupSnapshot`、`CloudBackupService`，并将备份实例注入 App 和 ProgressSyncService。开发配置还可以提供 `localBackupEnabled:true`。

首轮只移除这条正常装配和配置启用路径，继续调用现有云结算服务。不新增单／双策略解释模块，不为单方案引入模式管理器。

### 3.1 配置解析

`cloudConfigForEnvironment` 对 develop／trial／release／unknown 的选择规则保持不变，仅使最终返回配置中的 `localBackupEnabled` 恒为 `false`：

- develop 的本地覆盖即使传入 `true`，也不能在正常入口启用备份。
- 不修改本地覆盖文件本身，不改变云环境、准入、读写、经济、体力、偏好、每日验收日期等字段。
- 不改变配置加载顺序、异常回退、忽略文件处理和 release 不读取本地覆盖的约束。
- 不新增另一个配置名、环境变量或“隐藏调试开关”绕过该限制。
- 不原地修改被导入的配置对象；只有返回配置的该字段允许变化。

### 3.2 启动装配

`start` 中只取消：

1. `BackupSnapshot`、`CloudBackupService` 两个直接 import。
2. 为备份初始化使用的 `initialArchive` 读取。
3. `backupSnapshots` 和 `cloudBackup` 的实例创建。
4. 向 ProgressSyncService 传入的 `services.backup`。
5. 向 App 传入的 `cloudBackup`；沿用其现有缺省 `null` 行为。
6. `cloudBackup.accountGuard` 的绑定。

ProgressSyncService 的 `localBackupEnabled` 继续明确为 `false`。其余创建顺序、依赖注入、账号保护绑定、偏好绑定、本地启动和异步联网调度不变。

允许删除上述内容后确实无用的局部变量，不允许借机重排整个 bootstrap。

### 3.3 保留现有服务，不重写分派

ProgressSyncService 已能在无备份服务且开关关闭时使用现有云路径，并对历史备份存档失败关闭，因此本轮**不修改它**。

App 已对缺省 `cloudBackup` 做空值处理，账号页不会获得备份启用模型；备份 action ID 保留，直接调用时仍按原无服务路径返回，不新增可见入口。

现有测试通过直接构造备份服务仍可验证历史协议。这是兼容回归，不代表 `game.js → bootstrap.start()` 仍可启用第二个正式方案。

完成后仍存在兼容分支；本轮可量化收益是正常入口不再创建、注入或配置启用备选，不是全仓历史代码删除。

## 4. 严格运行代码施工边界

**最多修改一个现有运行文件：`src/bootstrap.js`。不新增运行文件。**

| 位置 | 允许修改 | 不允许修改 |
| --- | --- | --- |
| 文件顶部 import | 删除 `BackupSnapshot`、`CloudBackupService` 的两个直接依赖 | 清理或替换任何其他服务 |
| `cloudConfigForEnvironment` | 仅将每条返回路径的 `localBackupEnabled` 固定为 `false`，必要时复制返回对象 | 修改其他配置值、分支选择、加载顺序、回退和参数合同 |
| `start` 的备份装配片段 | 第 3.2 节六项，及明确保持关闭的配置传参 | 改变任何其他服务的构造、初始写入、回调或时序 |
| 相邻注释 | 说明单一正式方案和历史兼容仍保留 | 重写无关注释或格式化全文件 |

以下全面冻结：

- `src/app.js`、Renderer、玩法、输入、关卡、奖励／体力规则和用户可见文案。
- `src/services/progress-sync-service.js`、`sync-store.js`、`authoritative-state-applier.js`、`legacy-migration-builder.js`。
- `cloud-backup-service.js`、`backup-snapshot.js` 及奖励／体力／经济／进度／每日／偏好服务。
- API、Transport、Auth、Session、微信适配和所有存储方法。
- `src/config/**`、项目／包配置、`game.js`、脚本、依赖和构建方式。
- 其他仓库，包括 `/Users/ethan/Projects/ClearedCloudBase`，以及所有线上函数、数据库和部署配置。

禁止：存档升级、模式改名、删除旧编码、改变回执／待办协议、修改玩家数据、开启或部署备份、删除兼容代码、清档、commit、push、上传、送审、发布。

若一个文件的边界无法满足第 7 节验收，应停止并说明具体原因，不得直接扩展到 App 或业务服务。只有新增授权后才能修复超界问题。

## 5. 测试与文档白名单

### 5.1 测试：最多新增一个，修改两个

| 文件 | 允许范围 |
| --- | --- |
| **新增** `tests/single-settlement-bootstrap.test.js` | 实际 bootstrap 装配、调用可达性、正常账号与旧档行为对比、配置对象不被污染；通过现有 fake platform／服务夹具隔离副作用 |
| `tests/cloud-runtime-config.test.js` | 追加所有环境备份关闭、develop 本地覆盖不能开启、其他配置不变的断言；不得削弱原环境选择检查 |
| `tests/run.js` | 仅注册新增聚合组；不改原测试注册、顺序、失败处理或退出码 |

其余测试、共享夹具、架构依赖约束只读并继续运行。尤其不得删除旧备份测试来制造通过，不修改它们期望的历史协议，也不为兼容测试新增生产开关。

新增测试应遵循现有导出 `run` 函数和聚合入口的方式。允许在新测试内局部替换并恢复 Node 模块缓存／平台桩，禁止把替身写进运行代码；异步任务和替换必须在 `finally` 中清理，不能污染后续组。

### 5.2 文档范围

- 本文：记录阶段、函数级差异、测试和未执行事项。
- `docs/cloudbase-local-first-sync.md`：仅更新本方案链接和实施后的实际入口状态，保留历史记录。
- `README.md`：只有运行实现完成后，才局部同步当前联网方式；保留用户已有改动，不整体重写。

当前文档交付只新增本文，并在现行联网说明增加链接；未实施运行变更，README 不改。不修改上一轮收敛／历史备份设计的完成记录。

## 6. 施工阶段

用户明确授权本方案实施后，可按顺序推进，不需为同一白名单反复询问；触及第 9 节条件则停止。

### S0：基线和行为核对

- 记录 HEAD、工作区已有改动、相关 diff 和完整测试结果。
- 核对 `start`、两个被移除构造器的副作用、App 的无备份注入路径、ProgressSync 的无服务保护。
- 特别记录正常云档、接管前本地档、历史备份档和未完成恢复档在当前默认关闭配置下的行为。
- 文档编写时 HEAD 是 168 关目录；实施以届时 catalog 为准，不复用历史文档的 138 关作为当前数量。

出口：确认移除正常装配不是在删除旧档恢复任务，且有基线用于对比。不预设所有旧档都是只读。

### S1：先补入口和配置回归

- 在白名单测试中固定主方案已有行为，增加开发覆盖不能启用备份的目标检查。
- 装配检查必须执行真实 `bootstrap.start()`；静态搜索 import 只能作辅助证据。
- 确认测试会捕获“仍创建备份服务／仍注入备份对象／本地覆盖仍能启用”的错误实现。

出口：目标检查能够识别当前待改点，已有保护检查有效；不跳过原备份组。

### S2：仅修改 bootstrap

- 按第 3、4 节取消备份装配和正常配置启用路径。
- 其余服务、数据、回调和云请求流程原样保留，不新增策略模块或适配层。
- 若无服务路径暴露真实运行缺陷，先复现并报告，不用扩大函数白名单解决。

出口：正常入口只有云结算方案可达，旧档不被自动转换，测试和差异检查通过。

### S3：验收与交付

- 完成第 7 节矩阵，记录新断言和复用的原覆盖。
- 更新限定文档，明确“正式入口单方案”与“兼容代码仍保留”的区别。
- 记录实际运行文件数、函数片段、日志、尚未执行的设备与真实云检查。

出口：可以声明本地入口收敛完成，不能声明兼容退役、真实云、真机或发布完成。

## 7. 自动化验收矩阵

| ID | 场景 | 必须成立的结果 | 证据入口 |
| --- | --- | --- | --- |
| T01 | develop／trial／release／unknown 配置 | 返回的备份开关恒为 false；其他环境规则不变；原配置对象不被修改 | `cloud-runtime-config.test.js`、新增测试 |
| T02 | develop 覆盖显式传入 true | 正常启动仍不能创建／注入／启用备份；不改本地配置文件 | 同上 |
| T03 | 真实 bootstrap 装配 | App 无备份实例，ProgressSync 无 backup 依赖；其他服务、账号 guard、本地启动和异步联网保持 | 新增测试 |
| T04 | 正常已接管云档 | 仍走原云读取／同步／购买路径，无 backup.read／backup.commit | 新增测试，复用 `cloud-checkpoint-sync.test.js` |
| T05 | 接管前本地档／云关闭 | 原本地行为和首次建档不变，不强制联网、不强制改权威 | 新增测试，原 `cloudbase-disabled.test.js`、`cloud-rollout.test.js` |
| T06 | 云权威普通首次通关断网→重建 App | 进度可靠保存，奖励待确认；账号、六域权威和精确原操作身份保留，重复恢复不提前发币 | 原 `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart` |
| T07 | 每日真实入场与两关解题 | 一条入场＋两条完成操作；金币和领取标记在云确认前不变 | 原 `cloud-mode-routing.test.js::cloudAuthoritativeDailyCompletionKeepsRewardsPending` |
| T08 | 旧备份档进入无备份能力的正式入口 | 原 not-configured 保护；两种协议均不误发；不转云权威；与原默认关闭配置相比，不新增本地业务数据变化 | 新增真实装配用例＋原 `localBackupArchiveCannotFallThroughToCloud` |
| T09 | 旧备份档存在未完成恢复 | 不清任务、不伪报恢复完成；原游玩阻断和日志保留；不声称自动恢复可用 | 新增测试，原 `cloud-backup-restore.test.js` |
| T10 | 账号页及旧 backup action | 正常账号不显示备份启用模型；无服务直接调用原 action 不发请求、不改存档；同步重试仍可用 | 新增测试，原账号／布局测试 |
| T11 | 云购买失败／重试／重启 | 原购买 ID、账号信息、先同步收益及恰好一次扣款的合同不变 | 原 `cloud-economy-purchase.test.js`、`cloud-checkpoint-sync.test.js::purchaseCheckpoint` |
| T12 | 六域部分接管、迁移、坏档、部分回执 | 不统一覆写域权威，不提前解冻或本地发币，原恢复顺序不变 | 原 SyncStore、迁移、stage5、回执测试 |
| T13 | 账号／环境／绑定改变后的迟到回调 | 不能写入新 scope；guard 注入和校验仍生效 | 原账号／环境／迟到回调测试＋新增装配检查 |
| T14 | 冷却、退避、并发、批量 | 原 60 秒间隔、最大 5 分钟退避、事件阈值、50 条一批／最多四批及在途复用保持 | 原 `cloud-checkpoint-sync.test.js` |
| T15 | 原备份组件和恢复测试 | 全部继续通过，但不作为正常产品入口；不删除／放宽测试 | 原 `local-backup-settlement`、`cloud-backup-service`、`cloud-backup-restore` 等组 |
| T16 | 全量规则／UI／配置／发布预检 | 无关行为和依赖边界不变，备份仍关闭；没有删除云存档恢复 | 全量测试、现有 rollout 预检、diff 审核 |

质量要求：

- T03、T08、T09 不能只用直接构造服务的夹具替代真实启动装配。
- 存档对比必须覆盖账号／环境／绑定、六域权威、进度、奖励持久档、目标待办和恢复记录，不能只比较队列长度。
- 区分网络请求抛错与服务返回可重试错误，沿用真实 App 通关路径，不能只 enqueue 伪造结果。
- 旧备份档的“无新增变化”以同一输入在原默认关闭配置下的结果作基线；不能把原有本地兼容行为误报为本轮新只读保证。
- 不删断言、不跳过组、不改错误码、不降低请求数量／去重／跨账号要求。失败必须说明原因。

实施阶段执行以下独立命令，并分别确认退出码：

```sh
node tests/run.js > /tmp/cleared-single-mode-tests.log 2>&1
node scripts/check-release-readiness.js --mode rollout > /tmp/cleared-single-mode-release.log 2>&1
git diff --check
```

完整日志留存，只展示结果和必要尾部。新增一个聚合组不意味着仅验证一次调用；不能以组数增加作为覆盖完整的证明。

## 8. 真机和真实云验收

运行实现完成后，至少复测主方案：

1. 新账号首次建档、已接管账号启动／重启。
2. 普通首次通关断网→结束进程→重开→联网确认，重复重连无重复奖励。
3. 每日真实两关离线完成→重连，奖励和进度一致。
4. 云购买失败→重试，余额和所有权不双扣／重复发放。
5. 前后台、账号页同步操作，以及已有同账号跨设备恢复。

记录候选代码版本、设备／微信版本、匿名账号标签、环境、网络和操作时间、前后进度／余额／领取状态，以及云确认后结果。结果页显示奖励额度不能单独证明到账；真实去重和云状态需要对应日志或后端证据。

这份文档和本地实施授权不自动授权真实账号写入、后端访问／部署、预览／上传或清档。设备和云操作必须在已明确授权的范围内执行。

备份专项启用／部署不再是本方案的任务，也不增加为首发前置；历史档处置另行确认，不能为通过新候选验收而删除测试人员现有存档。

### 8.1 真机验收登记（用户确认）

| 项目 | 登记结果 |
| --- | --- |
| 本轮单方案结算真机测试 | **通过（用户确认）** |
| 登记日期 | 2026-09-08；不据此推定实际测试日期 |
| 范围 | 此前对话中的 D01—D08：新旧账号启动、普通离线通关与冷启动、每日挑战、购买失败与恢复、前后台与同步节奏、跨设备恢复、账号隔离、普通／Portal／冰封联网烟雾测试 |
| 结论来源 | 用户在本对话明确指示“将真机测试标记为通过”，据此登记整体通过 |
| 原始证据 | 未提供逐用例记录、设备／微信版本、测试包版本、录像或云日志；代理未独立执行或复核设备操作 |
| 不随本次通过的项目 | 条件性的历史备份档实机测试、备份启用／部署、独立后端日志核验、微信开发者工具及正式发布验收 |

这是用户确认的验收状态，不是代理自动化运行产生的实机证据。不补写未提供的设备、账号、耗时、操作 ID 或逐项实测数据，也不将结论自动延伸到后续候选包、全部关卡内容或全部平台组合。下文实施阶段的“未执行”保留为历史记录，当前真机状态以本节为准。

### 8.2 即时余额候选的验收边界

第 1.3 节是 8.1 用户确认之后的候选变化，不能继承此前的真机通过结论。本地回归覆盖普通／每日首通、重复来源、断网重启、部分 ACK、拒绝与重试、保存／入队失败、scope 隔离以及 9900 确认余额＋100 待确认奖励的购买前同步。仍需在同一候选包上完成“断网首通 → 回首页 → 结束并重开 → 联网确认 → 购买”的连续真机流程，并记录确认余额、显示合计、领取状态和所有权前后值。

## 9. 停工、回滚和后续物理清理

### 9.1 必须停止并申请扩界的情况

- 撤掉装配后，必须改 App、ProgressSync、钱包、体力、存档或恢复服务才能满足验收。
- 旧档出现新增数据改写、丢失、重复奖励或恢复任务被清除。
- 需要改配置文件、后端、存档 schema、操作协议或实际转换账号。
- 需要修改白名单外测试／共享夹具，或放宽旧安全断言。
- 用户已有修改与拟改区域重叠，无法局部保留。

报告必须包含：最小复现、当前与目标差异、受影响合同、拟新增文件／函数及验证。不能把“收束为一个方案”解释成全仓删分支授权。

### 9.2 回滚

- 本轮不改存档与模式，因此应能仅撤回本轮 bootstrap 差异，继续使用同一存档。实施后必须用同一批输入验证这一目标。
- 不使用清档、重建 operationId、删除恢复任务或退回 `legacy-local` 来回滚。
- 不回退用户已有工作，不使用破坏性 Git 操作，不自动 commit／push。

### 9.3 为什么不在本轮删除备份模块和四种编码

它们仍被历史兼容与测试引用，且旧备份存档不具备已确认的自动云权威转换路径。先封闭正常启用入口，可以避免在主方案迭代中继续装配第二套服务；直接删除则扩大数据安全风险。

未来只有在明确受支持版本／账号范围、验证旧档与未完成恢复任务的处置方式、列出所有调用者之后，才另立“兼容退役”清单。必须重新给出文件／函数／测试白名单，不能沿用本轮一个运行文件的授权删除其他代码。

未来的清理不作为本轮完成前置，也不无限期新增备份功能。若用户要求旧备份档在普通客户端完全只读或自动转云，同样需要单独设计，不能靠隐藏按钮声称完成。

## 10. 完成定义

同时满足以下条件，才能声明本轮本地实施完成：

- 正常入口只装配一个正式方案，任何环境配置覆盖都不能在那里开启备份。
- 实际只修改 `src/bootstrap.js` 的限定片段，没有新增运行模块或第二套状态源。
- 原云结算、接管前行为、四种编码、六域权威、待办和恢复合同保持。
- 旧备份存档没有被隐式切换或删除；对其兼容边界的描述与实测一致。
- T01—T16 有可定位证据，全量测试、rollout 预检与差异检查通过；原备份测试仍运行。
- 文档准确区分“正式入口单方案”“历史兼容保留”“设备／云／发布未验收”。

交付只报告：修改文件和函数、正常入口减少的依赖、保持不变的合同、验证日志、保留的兼容代码、尚未执行的设备／云检查及新增授权事项。不宣称“所有四模式代码已消失”。

## 11. 本次文档交付记录

- 用户允许不保留备选后，方案调整为唯一正式云结算方案；未交付的双方案草稿已被本文替代，不再新增 `settlement-policy.js` 或规划六个业务文件的判断改造。
- 实施前重新确认 `HEAD=0608a2c4924726d20f9d789ab3bddd2fe92f0b54`。已有 `README.md`、`cloudbase-local-first-sync.md`、`project.config.json` 修改和 `THIRD_PARTY_NOTICES.md` 删除均先作为用户工作保留；运行与测试文件当时无已有差异。
- S0 完整基线为 92 组通过、rollout `ready:true`、差异检查通过；日志为 `/tmp/cleared-single-mode-s0-tests.log`、`/tmp/cleared-single-mode-s0-release.log`、`/tmp/cleared-single-mode-s0-diff-check.log`。当前目录以 168 关为准，没有复用历史 138 关数量作为验收结论。
- S1 先新增 `single-settlement-bootstrap.test.js`、扩展 `cloud-runtime-config.test.js` 并注册聚合入口。在未修改生产代码时，两项目标检查均按预期失败：develop 覆盖仍能返回 `localBackupEnabled:true`，真实 `bootstrap.start()` 仍创建并注入备份服务；证据为 `/tmp/cleared-single-mode-s1-config-before.log` 和 `/tmp/cleared-single-mode-s1-bootstrap-before.log`。
- S2 唯一运行修改为 `src/bootstrap.js`：`cloudConfigForEnvironment` 的五条返回路径都在新对象上固定 `localBackupEnabled:false`；`start` 删除 `BackupSnapshot`／`CloudBackupService` 直接 import、空档读取、两个实例、两处服务注入和 backup guard 绑定，并向 ProgressSync 明确传入关闭值。其他服务构造顺序、App 启动、账号 guard、迁移快照回调和异步联网调度保持。
- S2 聚焦配置与真实装配用例通过，日志为 `/tmp/cleared-single-mode-s2-config.log`、`/tmp/cleared-single-mode-s2-bootstrap.log`。没有发现需要修改 App、ProgressSync、Store、奖励／体力／经济或恢复服务的运行缺陷。
- S3 局部更新本文、现行联网说明和 README 当前联网入口／测试数量；用户对 README 的整体改写及其他已有工作均保留。历史备份服务、快照构建、四种存档编码、恢复与冲突测试没有删除或改写。
- 最终完整测试为 93 组通过、0 组失败，日志 `/tmp/cleared-single-mode-tests.log`；rollout 发布预检退出码 0、`ready:true`，日志 `/tmp/cleared-single-mode-release.log`；`git diff --check` 通过，日志 `/tmp/cleared-single-mode-diff-check.log`。
- 实施阶段未接触真实 CloudBase、真实账号或玩家数据，未预览、部署、上传、送审、发布、commit 或 push；当时微信开发者工具、真机断网／重启、真实云恢复与购买验收尚未执行。后续用户已确认本轮真机测试通过，登记范围与证据边界见第 8.1 节，其他验收不随之变更。

### 11.1 T01—T16 实际覆盖映射

| 验证项 | 本轮证据 |
| --- | --- |
| T01—T02 | `cloud-runtime-config.test.js::run` 覆盖 develop 显式 true、上传 develop 回退、trial、release、unknown；所有返回值均关闭备份，其他公开环境字段保持，传入覆盖及三个导入配置对象均未被修改 |
| T03 | `single-settlement-bootstrap.test.js::bootstrapDoesNotLoadOrConstructBackupServices` 用新加载的真实 bootstrap 和依赖陷阱证明两个备份模块既不在组合根依赖中，也不读取空档或构造实例；`normalCloudBootstrapHasNoBackupDependency` 证明 App 为 `cloudBackup:null` 且 ProgressSync services 没有 backup 属性，同时其他核心服务和 account guard 仍装配 |
| T04 | `normalCloudBootstrapHasNoBackupDependency` 通过真实 App、六域云回执和 fake API 得到 `identity.init → state.read`、六域 `cloud-authoritative`、零 backup 请求；原 checkpoint／购买测试继续覆盖 `sync.push` 与购买路径 |
| T05 | `bootstrapDoesNotLoadOrConstructBackupServices` 在 unknown／云关闭入口保持 `legacy-local`、首页同步启动和普通关卡可进入；原 `cloudbase-disabled.test.js`、`cloud-rollout.test.js` 继续通过 |
| T06—T07 | 原 `cloud-mode-routing.test.js::cloudAuthoritativeOfflineCompletionSurvivesRestart/cloudAuthoritativeDailyCompletionKeepsRewardsPending` 未修改并通过，继续证明断网重启、精确待办身份和每日真实两关的资产保护 |
| T08 | `historicalBackupArchiveRemainsFailClosed(false)` 先用真实 Store／服务形成六域 `local-backup`、普通进度、余额与领取标记，再经真实 bootstrap 启动；只请求身份，返回 `not-configured`，无 state／sync／backup 请求，权威、业务存储及待办不变 |
| T09 | `historicalBackupArchiveRemainsFailClosed(true)` 在同一真实装配上保留完整 `pendingBackupRestore`，普通进入继续受阻并显示原恢复未完成提示；没有清任务、应用恢复或发请求 |
| T10 | `normalCloudBootstrapHasNoBackupDependency` 检查账号模型 `backupMode:false`；正常云档和两种历史档直接调用保留的 backup action 都返回 false、零请求且存储不变，账号同步重试仍完成原身份／状态读取 |
| T11 | 原 `cloud-economy-purchase.test.js` 与 `cloud-checkpoint-sync.test.js::purchaseCheckpoint` 在 93 组完整运行中通过；本轮未改 Economy、App 购买编排或操作 ID |
| T12 | 原 SyncStore、迁移、stage5、坏档和部分回执组全部通过；本轮未改四种编码、六域权威或应用顺序 |
| T13 | `normalCloudBootstrapHasNoBackupDependency` 明确比较 ProgressSync、AuthoritativeStateApplier、Economy 的 account guard；原账号／环境／迟到回调组继续通过 |
| T14 | 原 `cloud-checkpoint-sync.test.js` 完整通过；冷却、退避、阈值、批次和在途复用断言未修改 |
| T15 | 完整日志中的 `local backup settlement`、`cloud backup cadence and stale acknowledgements`、`cloud backup restore and conflicts` 均通过；历史模块仍可被测试直接构造，但正常 bootstrap 不再依赖它们 |
| T16 | 93 组完整测试、rollout `ready:true` 和差异检查共同通过；只新增一个聚合组，结论依据为上述函数级断言而非组数变化 |
