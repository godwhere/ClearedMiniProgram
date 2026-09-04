# CloudBase 阶段 0：实施前证据

审查日期：2026-09-04。本文先于阶段 1 运行时代码修改建立；以下行号均指实施前 HEAD。

## 基线与材料差异

- `git status`：main，工作区干净，本地显示与 origin/main 一致；未执行 fetch，不声称刷新了远端。
- `git rev-parse HEAD`：`f5d61d194a41a38846b3470e7546946a34ac104f`。
- `git log -1 --oneline`：`f5d61d1 docs: add CloudBase integration execution plan`。
- 相对正式方案审查基线 `69bcd6e4a0996149ef4b521d0d1764407bfc69cb`，仅新增该方案文档，无代码差异。
- 对照本机 `cloudbase-planning-2026-09-04/01-project-context.md`、`02-source-evidence.md`：材料 SHA 为 `a52f43c4c1cb4f2c141e96ad77726690a1d6cfe4`。按材料内 SHA-256 比较了 7 个文档和 34 个源码／测试文件；源码全部一致，文档仅 README 不同（删除开头来源介绍）。材料明确未运行测试，本轮另行实际执行。
- 已完整阅读正式 CloudBase 方案；另核对 AGENTS、README，以及账号／分享／广告、奖励、体力、每日、分级提示、分包文档的相关合同和最新实施记录。

## 启动与身份

`game.js:4 → bootstrap.start():36` 同步创建 Platform/Canvas、SubpackageService、ProgressStore、StaminaService、DailyProgressStore、RewardUnlockService、SessionStore、SyncStore，再创建 ApiClient、AuthService、Behavior/Profile/ProgressSync/Ads/Reward/Share/HintAccess/Engagement。

注意：StaminaService 构造只保存依赖，体力真正读取发生在 App 构造的 `restoreUnlockedLevels()` / `settle()`；不是所有 Store 都在 bootstrap 构造那一刻读盘。

App 构造：已完成和 lastPlayed 恢复永久解锁 → `recoverStaminaRefunds()` → 体力快照 → 每日服务/Store → `recoverRewardUnlocks()` → 拥有权约束的主题/特效服务。`bootstrap:92` 先 `app.start()` 安装输入、生命周期和本地循环，再安装分享入口，最后 Promise 微任务执行 `app.resumeOnline()`，第一帧不等待网络。

身份：`AuthService.ensureSession → current()`（到期前 30 秒失效）→ 单 flight → `platform.login()`（原生登录 code）→ ApiClient `POST /v1/auth/wechat`，payload 仅 code/installId/clientVersion → SessionStore。code 不保存。默认 backend/auth 均关闭。`resumeOnline` 为 auth → 可选 profile → progressSync bootstrap → 分享归因 → 恢复服务端每日增次；不是本地钱包结算入口。

**实施前发现**：SessionStore.set 在写盘 false/throw 时仍修改内存并返回 true，AuthService 因而会报告成功。这不同于本轮要求的“写盘失败不宣布绑定成功”。阶段 1 在该共同入口修复为写成功后提交，并保留先前 session；不改同步归属算法。默认在线关闭、正常读写路径不变；显式启用旧 HTTP 时的存储故障不再误报认证成功。

## 普通结算与奖励

真实顺序（`app.js:1430–1548`）：Runner 胜利 → completion policy（仅普通域）→ ProgressStore.recordCompletion 修改内存并首次 save → App 结果/场景 → `refundQuickClear` → 刷新体力 → 可选分享预取 → 再次 `progress.save() === true` → `recoverRewardUnlocks()` → `RewardUnlockService.reconcile()` → currencyReward → `ProgressSyncService.enqueueCompletion` → `EngagementService.onOrdinaryCompleted`。失败终局和每日不会走普通结算。

普通源保存失败：内存进度保留，但不发钱、不入队、不通知普通 engagement；`reward:retry` 先重试源保存，再读取已保存事实。reconcile 只根据持久完成快照发放，普通 `claimedOrdinary[levelKey]` 未领取才 +100，指定关卡的永久奖励独立检查。

**云合并重复奖励风险确实存在**：`mergeCloudSnapshot` 保存远端 completed；后续恢复看到本机没有 claim，就再 +100。它不会在 merge 内立即发生，而会在下一次恢复入口发生。本地重试由本机 claim 去重，但跨设备／已消费云钱包不能靠它保证安全。快通 bestMs 合并也有同类本地返还风险。阶段 1 不启用该链路，不修改奖励和体力；阶段 2 起必须先隔离归属和 legacy recovery，再处理迁移／权威回执。

### 恢复调用点（全量运行时搜索）

| 方法 | 调用点（app.js） |
| --- | --- |
| recoverRewardUnlocks | 307 构造；1528 普通通关；1710 每日最终通关；1833 reward:retry；2095 action 返回 home；2639 奖励数据不可用时重试；3259 onShow |
| RewardUnlockService.reconcile | 唯一运行时调用：2558，位于 recoverRewardUnlocks |
| recoverStaminaRefunds | 251 构造；3254 onShow；方法定义 3039 |
| refundQuickClear | 1515 普通通关；3046 恢复遍历 |

## 每日结算与资格

`enterDaily` 解析当日题包、验证两关几何与次数、创建 Runner，之后才 `dailyRecordEntry → recordEntry`。entry 幂等键按轮次生成；同键重试不再消费，写失败回滚。第 0 关完成 → recordLevelCompletion 保存 → 创建第 1 关 Runner（不再扣次数）；第 1 关完成 → Store 确认预期所有 level 完成 → dayCompleted/dayFirstClear → App 最终结果 → 已保存两关快照 → reconcile 按 dateKey 首次 +500。

- 上海日期使用 Intl，缺失时 UTC+8 确定性回退；时间来源仍是设备时钟。
- 轮次固定 dateKey/dayId；跨午夜不换题，旧轮次奖励归旧日，新进入重新解析。
- 正式两项不同 levelId、索引 0/1、预期数 2 且均已保存完成才有货币资格；单题兼容记录无 500。
- 默认限额 3；当前 `daily.debugUnlimitedEntries=true`（发布阻断项，本轮不改），无限调试仍记录次数。
- 同日重复完成不重复发 500。额外资格来自独立 RewardService 的确认 grant；`applyAuthorizedEntryGrant` 保留 entriesUsed、entryLimit 只增、`_grantIds` 幂等、写失败回滚。分享发起不证明邀请成功。

## 购买与体力

RewardUnlockService 同一候选副本／同一次写盘保存 balance、claimedOrdinary、claimedDaily、ownedRewards、adAttempts、pendingNotices。`purchase` 读取配置价格 10000，先检查已拥有，余额与拥有权及通知原子写入；失败不扣内存余额、不增加拥有权。已拥有重复购买为成功 no-op。外部广告／分享保存失败保留进程内原目标待重试，不能宣称未落盘凭证跨进程可恢复。主题 settings、永久拥有、资源下载各自独立。

`openLevel`：验证 context/顺序/Runner → 已完成直接可进入，否则 `unlockOrdinaryLevel` → 扣 1 和永久 unlockedLevels 同次写盘 → 成功才换场景/Runner。已解锁重入免费，失败不改变当前游玩。初始 5，naturalCap=5，低于 5 每 300000ms 恢复 1，余额可大于 5；>=5 清锚点，不截断余额。第一次符合 <=60000ms 的通关返还 1，按 levelKey 幂等；失败保留 pending，构造/onShow 可据 completed/bestMs 重试。onHide flush 体力、暂停 Runner/音频、保存进度并尽力同步；onShow 恢复返还/自然恢复/奖励，再恢复本地循环和异步在线流程。

## 当前同步（继续复用）

- SyncStore 是唯一 installId / migrationId 权威；同 key 重启复用。nextOperationSequence 先持久化再暴露 operationId，最多 200 条，满队列或写失败设置 snapshotRequired。
- 默认同步关闭仍记录本地 outbox，不发送；启动/前台恢复对比云快照补漏。只有 completed 的旧记录省略 elapsedMs，不生成虚假最佳时间。
- ProgressSyncService 先持久化 boundUserId，之后才能合并远端，再推进 revision；任一后续失败保留归属。同一 user 才能重试，变更 user 返回 account-mismatch，保留旧本地数据/队列。
- 401 最多重新认证一次；迁移/操作批次的 retryable POST 只安全重试一次、payload/ID 不变，ApiClient 不自行重试。
- 部分 ACK 仅删除本次发送集合中明确接受的 operation；元数据保存失败回滚、不提前删队列/推进 revision。SyncStore.acknowledge 本身不是该编排的 ACK 入口，不能用它替代 updateMetadata 的回滚语义。
- 目前只有单 boundUserId，不具备 guest/A/B 多命名空间或所有异步回调的身份代次保护。已有 accountGeneration 用于账号页生命周期，不是全域隔离；后续阶段仍必须补全。

## 存储 key

| key | 权威/用途 |
| --- | --- |
| cleared:minigame:progress:v2 | 普通进度、设置、lastPlayed、统计 |
| cleared:progress:v1 | 原始进度升级读取源 |
| cleared:minigame:daily:v1 | 每日进入、两关完成、grant 去重 |
| cleared:minigame:stamina:v1 | 体力、恢复锚点、解锁、返还 |
| cleared:minigame:reward-unlocks:v1 | 本地钱包、claim、拥有权、广告记录、通知 |
| cleared:minigame:session:v1 | 旧业务 session；阶段 1 保留 key，可存 schema v2 |
| cleared:minigame:online:v1 | installId、migrationId、绑定和同步队列 |
| cleared:minigame:events:v1 | 有限行为队列，非发奖依据 |
| cleared:minigame:share-entry:v1 | 分享归因 pending/seen |
| cleared:minigame:rewards:v1 | 服务端每日额外资格 pending/grants，非钱包 |
| cleared:minigame:hint-access:v1 | 本设备当日提示资格 |

## 验证与阶段 1 决策

修改前实际执行：`node tests/run.js` 64 组全部通过（`/tmp/cleared-cloudbase-baseline-tests.log`）；包体脚本通过：主包 2,800,109 bytes，总包 16,091,049 bytes，十个主题分包均通过（`/tmp/cleared-cloudbase-baseline-budget.log`）；`git diff --check` 通过。

现有测试覆盖：account-bootstrap/auth/API/session；sync-store/progress-sync-service/progress-sync-conflict 的绑定写边界重启、部分 ACK、重试、错账号、溢出补漏；reward-unlock-service/app 的持久来源、保存恢复、重复购买/补发；stamina-service/app 的恢复、超额、解锁/快通、保存失败；daily-progress-store/daily-app/daily-entry-grant 的日期、次数、两关、跨日和额度；架构、关卡、Portal、提示及包体保持全量执行。

阶段 1 冻结：默认关闭；不自动升级 v1；installId 留在 SyncStore；Cloud 身份仅接缝，不执行实际绑定；Cloud auth:true/旧迁移/经济调用明确拒绝。HTTP 路由不删。旧 `/progress/bootstrap` 不能伪装成完整 migration.prepare/chunk/finalize，旧奖励领取也没有一对一购买合同；这些映射须待对应阶段实现，不能只换名称就放行。

方案第 18 节的五项未来决策保留为**建议而非已获用户确认**：单主旧存档、在线购买、离线体力冲突保留进度并收敛为 0、独立私有后端仓库、旧客户端禁止重复导入经济基线。本轮不执行这些业务决策，因此不阻塞默认关闭的接缝；进入相关迁移／部署阶段前必须另行确认。

未执行：微信开发者工具 CloudBase 联调、真实云函数/数据库、真机账号切换、Android/iOS、生产发布；阶段 1 不创建云资源。Node 假平台不能证明这些验收。既有 daily 无限调试与仅普通进度云合并都不能作为正式 R1 上线依据。
