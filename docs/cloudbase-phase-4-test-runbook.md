# CloudBase 阶段 4：迁移、同步与云经济测试手册

状态：阶段4代码、数据库 schema 和三个测试 Event 函数已经就绪，并在测试环境仅对账号A完成第一次真实 PRIMARY 迁移、普通首通、最佳时间、断网队列重启恢复、每日首次/重复完成、普通和每日的真实双设备防重，以及离线购买转在线恢复；在线只扣一次并新增一个永久主题。验收后客户端迁移/同步/经济开关和三个函数写门禁均已关闭，线上写白名单为空；账号B未触碰，未修改生产环境。

## 当前检查点

- 客户端基线：main `639fa992001754e47b1bcaed1ad26885116ac5e3`，开始干净，72组测试；阶段4当前77组通过，新增真实云 SDK 跨 JavaScript 运行域回执回归。
- 测试环境：`cloudbase-d9gpluqt21ba89532`，关联AppID `wx7fb1a0811192cd97`。
- 后端：12个集合均拒绝客户端直接读写，8个自定义索引已回读；identity/player保持2/2且无孤儿、无平台身份原文。
- 三个函数均为Event/Nodejs20.19/5秒/256MiB/Active。身份与state.read原生返回200；管理端伪造上下文被拒绝。测试时A专用白名单只部署到 `player-state-api` 的 sync profile和 `economy-api` 的 economy profile，账号B始终被排除；验收后三函数均已恢复closed profile，实时写白名单为空。
- 账号A真实迁移后为1个钱包、1条期初账本、2个迁移奖励记录、2个永久资产、0个购买回执、1个FINALIZED迁移；一次新普通首通后余额12700→12800且只新增一条奖励账本/claim，重复第一关只把bestMs从42000改为1823，余额、账本和claim不变。增量后dry-run的13类一致性违规全为0。
- 开发者工具对10个新增集合逐一执行原生读取和零命中update，20次操作全部返回`-502003`，没有创建或修改文档。
- iPad阶段3回归：断网冷启动、普通关卡、本地存档正常；恢复联网后账号文案正常。该证据不代表阶段4迁移或跨设备云存档已通过。
- 2026-09-05恢复阶段4后重新完成实时关闭门禁核验：三个函数仍为`closed`，identity/player仍为2/2，全部10个业务集合仍为空且钱包dry-run为0违规；另生成一份仓库外0600身份基线备份，并确认现有A专用门禁只选择最新身份、排除最早的账号B。客户端77组、后端52单元/3集成/3并发及包体、schema、catalog、函数包、密钥扫描与两仓库diff check均重新通过。
- 同日已为账号A生成仓库外0600客户端备份和合成旧存档，并经用户明确确认后替换；账号B未触碰。PRIMARY迁移6/6块在云端完成，第一次finalize响应于客户端超时后通过同一import的status/finalize重放恢复，没有第二份期初余额。真实原生回执随后暴露跨JavaScript运行域对象被本地严格对象校验误拒绝的问题；客户端已在云调用边界把数据型own property受限转换为本地对象，并以跨运行域+丢失finalize响应回归覆盖。修复包重启后账号A为`cloud-authoritative`、本地所有权已采用、无pendingApplication，账号页显示已同步。
- 第一次真实重复通关还暴露结算页停留在“货币待保存”的瞬时文案：数据实际已经ACK并正确防重。客户端现将进度operation的终态回执通知原结算页，ACK后按服务端`rewardGranted/rewardAmount`显示获得或已领取，RETRYABLE继续显示“奖励待同步”，拒绝/异常回执显示同步失败；回调不写入SyncStore，账号守卫仍生效。
- 预览版飞行模式完成第4关时，本地显示“奖励待同步”且进度保留；实时管理端核对确认云端仍为12900、4个完成记录且没有第4关。恢复网络后的当次自动同步及随后在线游玩仍显示未同步，但退出并重新进入后持久队列自动补传；第4和第6关各只发100，最终余额13100、5条账本、6个claim、6个完成记录，13类dry-run违规全为0。产品验收允许“重启后自动恢复”，不把网络刚恢复时立即变为已同步设为阶段4硬门槛。
- 临时develop/trial日期2026-09-01下，迁移记录原为进入1次、只完成第1小关且无每日claim；真实完成两小关后只发500，余额13100→13600、只新增1条账本和1条每日claim。第三次进入重复完成显示“今日奖励已领取”，余额/账本/claim不再增加；entriesUsed最终为3且13类dry-run违规全为0。验收后已移除本机临时日期。
- iPad同账号A先以迁移/写入关闭的预览进入：非空旧存档保持“本地游玩/云身份未连接”，没有静默覆盖或上传；用户主动清除该iPad上账号A的小程序缓存后重新扫码，空白本地自动恢复为余额13600、6个完成记录并显示“云存档已同步”。管理端核对身份/玩家仍为2/2，钱包、账本、claim、资产和购买计数均未变化。
- 同账号A的iPhone与iPad都从云端同步后，先同时进入第7关，再依次完成：iPhone显示获得100，iPad显示本关奖励已领取。管理端最终只新增1个完成、1条账本和1个claim，余额13600→13700；13类dry-run违规仍全为0。
- 同账号A的iPhone与iPad在临时develop/trial日期2026-08-31下同时完成每日第二小关：iPhone显示获得500，iPad显示今日奖励已领取。管理端最终只新增1条账本和1个每日claim，余额13700→14200；总计8条账本、9个claim，13类dry-run违规仍全为0。验收后已移除本机临时日期。
- 账号A的iPhone在云身份已同步后开启飞行模式，点击购买甜点主题只显示“需要联网确认购买，余额和主题均未改变”。实时管理端核对仍为余额14200、8条账本、0个购买回执、2个永久资产且甜点主题未拥有，证明断网点击没有本地假成功或服务端副作用。恢复网络后未重扫或清缓存，点击重试显示“已永久解锁”且余额4200；管理端只新增1条-10000账本、1个购买回执和1个永久资产，13类dry-run违规仍全为0。随后选择“稍后再说”不会改变当前主题；重新打开甜点主题直接显示已永久解锁，点击立即应用后素材正常加载，余额仍为4200。
- 最终收尾已移除临时诊断入口和日期覆盖，客户端只保留身份/只读测试能力并关闭migration/write/economy；三个云函数均已核验为closed profile。最终云数据保持1个钱包、9条账本、9个reward claim、3个永久资产、1个购买回执和1个FINALIZED迁移，余额4200，13类dry-run违规全为0。

## 客户端职责

| 模块 | 阶段4职责 |
| --- | --- |
| `cloud-function-transport.js` | develop/trial与逐动作布尔门禁；release/unknown拒绝；原生/跨运行域回执在边界转换为有深度和节点上限的数据型本地对象，拒绝访问器与危险键 |
| `api-client.js` | 严格校验迁移、状态、部分ACK、经济回执；不接受宽松对象 |
| `legacy-migration-builder.js` | 从现有服务导出单份不可变PRIMARY快照，不猜缺失奖励 |
| `progress-sync-service.js` | read → prepare → 本地二次哈希/完整chunk清单校验 → freeze → chunks → finalize；随后增量push，并在权威回执应用成功后结算进程内结果页观察者 |
| `sync-store.js` | environment/player/epoch域权威、迁移冻结、独立冻结快照档案、不可变操作、部分ACK隔离 |
| `authoritative-state-applier.js` | 先校验账号token，再把已校验响应随pendingApplication落盘；重启先重放该响应，再继续读云 |
| `economy-service.js` | 只在cloud-authoritative发购买；operation按环境/账号/epoch/商品隔离，结果未知时重启自动复用原operation |
| `app.js` | 只在home/account且无进行中玩法/分享/广告/购买时允许迁移；普通/每日结果页只根据已应用的云回执结束奖励待同步状态 |

体力与偏好仍是本地延后域；本阶段不把它们写云。广告、分享归因、资料和行为上报也不在阶段4写入范围。

## 开关必须双边同时满足

仓库内 `src/config/cloudbase.js` 永远默认全关。本机只在Git忽略的 `src/config/cloudbase.local.js` 配置develop/trial测试；示例文件不能填真实环境后提交。

真实日期没有本地每日内容时，阶段4的每日端到端验收可在同一忽略配置中临时设置 `dailyTestDateKey: '2026-09-01'`，只解析清单里已有的两小关。该字段只在develop/trial加载，不修改Mac/iPad系统时间、网络、体力计时或完成时间；release不加载。服务器仍以挑战锁定的`dateKey`作为奖励键。每日验收完成后删除该字段。

| 步骤 | 客户端 | player-state-api | economy-api |
| --- | --- | --- | --- |
| 只读 | identity/read=true，其余false | closed | closed |
| 首次迁移 | 再开migration | migration，仅专用player | closed |
| 增量同步 | migration/write=true | sync，同一player | closed |
| 云购买 | 再开economy | sync | economy，同一player |

任一侧未打开都必须失败关闭。不能先开客户端等待后端，也不能将真实玩家加入宽泛白名单。

## 首个迁移样本的强制准备

1. 明确选择一个专用、可丢弃的微信测试账号；不能默认使用当前账号B，也不能使用其现有2400余额/18体力存档。
2. 在关闭写入时导出该设备的完整微信开发者工具/小游戏本地存储到仓库外私密备份，记录恢复位置和权限。不要清除其他账号数据。
3. 构造合成旧存档，至少包含可人工核对的普通完成/最佳时间、每日进入与完成、余额、一个关卡奖励、一个非默认永久资产；体力和偏好只用于确认仍留本机。
4. 记录预期汇总、客户端snapshotHash和所有业务集合的迁移前计数。再次确认云端该player没有完成迁移、钱包或账本。
5. 私人门禁文件只加入这个内部playerId，然后只将状态函数升到migration；客户端只开migration。当前本地0600门禁已由两条身份备份按管理员确认的“第一条B、第二条A”生成，校验A=latest且B被排除；迁移完成后同一白名单已升到sync。任何其他账号仍必须收到`PLAYER_NOT_ALLOWLISTED`。

第一次迁移必须在home/account发起。活动关卡、每日结算、分享/广告、奖励领取、购买或外部保存进行中时，客户端应返回`migration-not-ready`。

账号A连接到开发者工具后，可在调试控制台使用只读的`copy(JSON.stringify(...))`导出所有`cleared:*`玩法存储；必须排除`cleared:minigame:session:v1`和`cleared:minigame:events:v1`，避免备份登录凭据或遥测。导出信封只携带session中的`mode/ownerId/bindingEpoch/environmentId`绑定摘要，不携带session本体；备份脚本必须把摘要与仓库外0600门禁中唯一的账号A匹配，账号B或其他绑定直接拒绝且不打印playerId。剪贴板内容只允许传给`scripts/save-stage4-client-backup.js --env-id cloudbase-d9gpluqt21ba89532 --account-label A`；脚本同时校验必需玩法key、拒绝凭据字段，并只写仓库外0600文件。没有`ok:true`、校验和和备份路径前不得写合成存档。该工具不提供自动恢复或清理命令，账号B禁止使用。

```js
const session = wx.getStorageSync('cleared:minigame:session:v1');
copy(JSON.stringify({
  schemaVersion: 1,
  source: 'wechat-devtools-copy',
  binding: {
    mode: session && session.mode,
    ownerId: session && session.ownerId,
    bindingEpoch: session && session.bindingEpoch,
    environmentId: session && session.environmentId
  },
  entries: wx.getStorageInfoSync().keys
    .filter(key => key.startsWith('cleared:') &&
      key !== 'cleared:minigame:session:v1' && key !== 'cleared:minigame:events:v1')
    .map(key => ({ key, value: wx.getStorageSync(key) }))
}));
```

```sh
pbpaste | node scripts/save-stage4-client-backup.js \
  --env-id cloudbase-d9gpluqt21ba89532 --account-label A
```

备份命令返回的路径必须直接传给合成工具；工具再次校验0600权限、备份校验和、唯一A白名单与环境绑定，再用现有Store和迁移Builder验证四个合成玩法key。输出仍是仓库外0600文件，不会自动写微信存储，也不会输出内部playerId：

```sh
node scripts/prepare-stage4-synthetic-save.js \
  --env-id cloudbase-d9gpluqt21ba89532 --account-label A \
  --backup /绝对路径/stage4-client-backup-A-时间.json
```

合成样本固定为普通完成`0:0`/`1:2`（42秒/73秒）、最后游玩`1:2`、余额12700、两个普通claim、`theme:gem`和`theme:festival`拥有权、体力7、节日主题/无消除特效/静音，以及2026-09-01每日已进入一次且只完成入门关（51秒）。这样PRIMARY导入不补发100/500；迁移后临时`dailyTestDateKey`可从真实每日UI完成两小关并只由云端发一次500。

## 迁移验收

- prepare成功后、本地freeze前故意改变一次源存档，必须得到`snapshot-changed`，无migration记录、无上传、仍为legacy-local。
- freeze前必须先把完整快照写入`cleared:minigame:migration-archives:v1`；档案写盘失败时不得记录migration或切换权威。重启后必须复用该不可变档案，不能从随时间变化的体力或已部分应用的Store重建另一份快照。
- 正常样本必须按相同import上传；中断一个chunk后重启，使用`migration.status`继续，不重建另一份快照。
- 重发相同chunk与finalize返回相同语义；相同ID不同内容、缺chunk、空chunk冒充非空、汇总变化和不一致奖励都被拒绝。
- `progress:resume`是每次迁移必需的单记录chunk（值可为null），确保冻结快照中的最后游玩位置不会被分块遗漏；finalize后普通完成、resume、每日、余额、开账ledger、reward claims和entitlements与预期完全一致；体力/偏好仍取本机。
- SUPPLEMENTAL只合并完成事实、更优时间和可由普通进度验证的里程碑资产；被忽略的余额、claim及购买/广告/分享资产必须返回冲突数量，冻结档案继续保留，不静默覆盖或相加。
- 客户端只在权威回执全部持久化后删除迁移冻结；pendingApplication同时保留稳定receipt/fingerprint和已校验响应，杀进程后先从该检查点重放，不依赖并发设备之后返回完全相同的云快照，也不重复补钱或解锁。
- 管理端执行钱包dry-run，所有违规为0；直接客户端读写12个集合继续被拒绝。

## 同步、经济和双设备验收

迁移通过后才进入sync：

- 普通新完成、最佳时间改善和每日操作形成不可变operation；离线保留，恢复后重放。
- 单机优先验收允许网络恢复时首次重试失败；只要本地状态和原operation持久保留，并在下次启动或后续成功flush时自动补传即可。即时联网状态探测不作为本阶段硬门槛。
- 服务器只ACK部分ID时，客户端只删除明确接受项；未ACK项保留，明确拒绝项由服务器强制附带对应域权威快照后隔离，不能留下被拒绝的乐观状态；跨环境/账号/epoch回执隔离。
- A设备写入后，B设备同账号冷启动从云权威恢复；B有非空不同本地核心存档时必须要求迁移/人工处理，不能静默覆盖。
- A/B微信账号来回切换时，旧generation迟到结果不能改当前scope或UI。

经济最后开启：

- 购买成功只扣一次并新增一次资产/账本/订单/operation回执；相同operation重放不重复扣款。
- 余额不足、已拥有、非法catalog、迁移未完成和非白名单玩家均无扣款。
- 两个设备并发购买同一/不同主题，最终余额非负且与账本一致。
- 断网点击不能本地假定成功；超时或杀进程后保留同一operation，账号恢复时自动重试，只以服务端回执应用。

## 验证命令与证据边界

```sh
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

当前源码估算主包2,966,924字节、总包16,257,864字节，各分包均在预算内；客户端77组、后端52项单元/3项集成/3项并发测试通过。账号页现在把云读取/迁移、待发送操作和云同步完成分别显示为“正在同步”“等待同步”“已同步”，不再回退成“本地游玩”；手动重试也会保留待同步、迁移等待、补充存档冲突或购买待确认的具体结果，不再覆盖成笼统的成功文案。普通/每日结算页在云端尚未确认时显示“奖励待同步”，只有权威回执完成本地应用后才显示实际获得或已领取。云权威撤销本地主题拥有权时，运行时只回退显示经典主题并保留本机偏好，不会继续使用未确认资产，也不会把拥有权变化当成主题选择；若拥有权在主题分包下载期间撤销，本次下载不会应用主题，并会清除等待状态。新设备自动恢复前的空白判定还会检查独立持久化的待确认购买；存在该请求时进入迁移/冲突流程，不静默接管本地核心状态。后端迁移回归还明确覆盖普通或每日完成事实缺少对应迁移claim的矛盾快照：finalize拒绝且不会猜测补发。客户端回归覆盖服务端已完成finalize但响应丢失：重试通过migration.status识别原import已完成，只重放同一finalize回执，不重建快照或创建第二次迁移。后端部署验证还把唯一批准的阶段4测试环境固化为代码级白名单，三处配置同时误改也不能把脚本切到生产目标；所有可执行云管理与只读审计脚本统一经过该门禁。钱包核对逻辑已拆为不访问CloudBase的纯审计函数，并用合成账本覆盖余额重算、负余额、重复/孤儿记录、迁移缺块和四类确定性ID。2026-09-04切换iOS二维码真机调试时，开发者工具实际打包上传成功并显示`代码包 15500 KB`，因此不再用源码统计替代本次工具打包证据；该结果仍不等于正式上传或发布。后端自动测试也不能代替真实CloudBase事务、开发者工具和双设备证据。

上海日期边界自动证据精确覆盖`2026-09-03T15:59:59.999Z -> 2026-09-03`和`2026-09-03T16:00:00.000Z -> 2026-09-04`。客户端还验证已进入的旧挑战跨午夜完成后，两条完成操作继续使用进入时锁定的旧`dateKey/dayId`，且不创建新日期记录；后端验证奖励claim同样使用锁定日期，新日期的首次奖励资格保持独立。

购买回执的客户端回归还核对`economy + entitlements`由同一个资产状态写盘同时落地：余额扣减和主题永久拥有权只产生一次资产存储写入，不存在两域之间的本地半状态窗口；回执中的`balanceAfter`若与权威钱包快照不一致，客户端拒绝应用并保留原购买请求供重试。若服务端已经成功而本地清理待确认请求时写盘失败，重建服务后会复用原operation取得`ALREADY_OWNED`，余额保持只扣一次并最终清除请求。

实际工作区文件边界已按阶段4白名单复核：客户端`core/`、`data/`、mechanics/skins/effects清单、`src/ui/board/`、素材、旧页面及体力/广告/额外次数服务均无改动；`skin-service.js`是已在执行计划解释的唯一必要例外，只做拥有权撤销时的运行时显示回退。后端改动限于Event函数、shared纯业务模块、数据库声明、管理脚本、测试和文档，未引入Web框架或监听服务。

记录匿名账号A/B、设备、时间、内部playerId、requestId、import/receipt ID、预期/实际汇总和集合计数；不记录OPENID/UNIONID、HMAC、AppSecret、完整函数变量或真实重要存档内容。

## 退出条件当前证据审计

下表只记录当前证据强度；`自动通过`不能替代后续明确要求的真机或真实CloudBase事务。完成真实步骤后必须逐项改为对应的实时证据，不能仅因代码存在就宣布阶段4完成。

| 条目 | 当前证据 | 状态 |
| --- | --- | --- |
| 1 阶段3身份/只读无回归 | 最新closed函数下原生identity/state.read成功；账号页保持只读文案与本地存档，identity审计仍为2/2 | 已证实（关闭门禁） |
| 2 两仓库 | 客户端与后端仍为两个独立Git工作区 | 已证实 |
| 3 普通Event函数 | 三函数线上元数据均为Event、无触发器/路由 | 已证实 |
| 4 仅测试环境 | 部署/验证脚本锁定批准环境，未创建生产环境 | 已证实 |
| 5 玩家白名单 | 服务端三类写入均同时检查明确player白名单和动作开关；实测开放期间只有A、始终排除B；收尾后实时白名单为空 | 已证实（同步/经济门禁已关闭） |
| 6 默认fail closed | 客户端migration/write/economy均关闭，三函数均恢复closed profile且实时白名单为空；管理端伪造无副作用 | 已证实 |
| 7 分域权威 | SyncStore对六域分别持久化权威模式 | 自动通过 |
| 8 体力本地 | 迁移/恢复保持stamina为legacy-local | 自动+账号A真机迁移通过 |
| 9 偏好本地 | preferences不进入四个云权威应用域 | 自动+账号A真机迁移通过 |
| 10 主余额一次 | PRIMARY期初分块同内容重放返回原回执、异内容冲突；真实超时后同import重放，钱包和opening ledger仍各一份 | 自动+账号A真实迁移通过 |
| 11 次设备余额不相加 | SUPPLEMENTAL自动验证忽略余额并返回冲突；iPad同账号空白恢复余额13600且没有新增钱包/账本/claim | 自动+第二设备恢复通过；真实SUPPLEMENTAL待执行 |
| 12 迁移claim不发钱 | 普通/每日claim均写为SETTLED_BY_MIGRATION；真实迁移为2 claim且仅1条期初流水，无额外+100/+500 | 自动+账号A真实迁移通过 |
| 13 云progress不重复+100 | 权威写回不调用本地reconcile；账号A新首通只新增100一次，重复第一关仅改善bestMs且余额/账本/claim不变；断网第4关和在线第6关在重启恢复后各只发一次 | 自动+账号A真实同步通过 |
| 14 云daily不重复+500 | 权威写回不调用本地reconcile；账号A真实补完两小关只发500一次，重复完成显示已领取且余额/账本/claim不变；跨上海午夜仍以进入时锁定dateKey结算 | 自动+账号A真实同步通过 |
| 15 两设备首通一份奖励 | 并发事务测试仅一claim/ledger；iPhone/iPad同关依次提交实测第一台+100、第二台已领取，云端只新增一份 | 自动+真实双设备通过 |
| 16 两设备每日一份奖励 | 并发第二小关仅一claim/ledger；iPhone/iPad同日依次提交实测第一台+500、第二台已领取，云端只新增一份 | 自动+真实双设备通过 |
| 17 ledger可重算钱包 | 纯审计合成账本验证余额重算/不匹配；账号A购买后1钱包/9账本、余额4200，真实dry-run为0违规 | 已证实（购买后） |
| 18 钱包不为负 | 事务/并发/重算测试通过；真实购买后余额4200且账本重算一致 | 自动+真机通过 |
| 19 购买在线 | iPhone飞行模式实测只提示需要联网，余额/主题未变；云端余额、账本、购买回执和资产计数均未变化 | 自动+真机通过 |
| 20 超时重试不重复扣 | durable operation重启复用；服务端成功但本地清理写盘失败后同operation恢复为ALREADY_OWNED；iPhone离线失败转在线重试复用待确认operation且只扣一次 | 自动+真机网络恢复通过；真机杀进程未强制执行 |
| 21 已拥有不重复扣 | 服务端幂等购买/客户端回执测试；真机重新打开甜点主题直接显示已永久解锁，余额4200且云端仍只有1个购买回执 | 自动+真机通过 |
| 22 拥有权与应用状态分离 | entitlements与progress.settings分域；真机购买后选“稍后再说”不改变当前主题，之后可独立选择应用 | 自动+真机通过 |
| 23 拥有权与素材下载分离 | 先保留拥有权，分包失败可重试且不改拥有权；真机在拥有后点击立即应用，素材加载成功且余额不变 | 自动+真机通过 |
| 24 state.read恢复核心 | 空云/迁移完成/重启恢复测试；账号A iPad清除其本地缓存后从云恢复余额13600和6个完成记录 | 自动+双设备真机通过 |
| 25 非空本地不静默覆盖 | 新设备恢复门禁拒绝非空不同核心，并把独立持久化的待确认购买计入非空判定；iPad非空旧存档实测保持本地且未写云 | 自动+第二设备通过 |
| 26 operation范围隔离 | 客户端与服务端均绑定owner/env/epoch | 自动通过 |
| 27 部分ACK精确删除 | 只删accepted ID，reject隔离，retry保留；结果页观察者只在ACK/reject终态结算，retry继续挂起 | 自动通过 |
| 28 写盘失败不推进revision | 带ACK回执的finish写盘失败后revision仍保持原值，pendingApplication保留 | 自动通过 |
| 29 写盘失败不删operation | 同一失败路径确认已ACK operation仍在原scope队列，等待稳定回执重放 | 自动通过 |
| 30 同ID异payload拒绝 | 客户端队列、服务端operation/purchase均拒绝 | 自动通过 |
| 31 新集合客户端拒绝 | 10个阶段4新集合各读/写共20个原生探针均-502003 | 已证实 |
| 32 catalog parity | 92关/13奖励一致 | 已证实 |
| 33 客户端Node | 77组全通过 | 已证实 |
| 34 包体预算 | 最终主包2,966,924、总包16,257,864字节；DevTools此前真机调试上传显示15500 KB，最终移除诊断入口后未重新执行工具包分析 | 源码预算通过；非正式发布 |
| 35 后端单元/集成 | 52单元+3集成通过 | 已证实 |
| 36 并发 | 3项并发通过；真实两设备依次提交的普通和每日防重均通过 | 已证实；真实同时到达仍以自动事务证据为准 |
| 37 reconciliation dry-run | 纯审计合成异常全部命中；账号A普通、断网恢复、每日首次/重复、双设备完成及购买后13类真实违规均为0 | 购买后通过 |
| 38 两仓库diff check | 最终两个工作区均通过；未提交的阶段4改动按原边界保留 | 已证实 |
| 39 无生产修改 | 仅批准测试环境有改动，最终三函数写门禁全部关闭 | 已证实 |
| 40 未进入阶段5 | stamina/preferences仍延后且保持本地权威 | 已证实 |

## 回滚

客户端按economy → write → migration → read → identity → enabled顺序关闭；后端将economy和player-state退到closed并撤销专用player白名单。保留本地备份、legacyBackup、Session/Sync scopes、installId/migrationId、队列和全部云回执/账本。

不得清库、轮换HMAC、重生成ID或把已完成迁移的player降回legacy-local补奖。迁移中断使用同一import继续或保持冻结；不构造第二份PRIMARY覆盖。网络排查遵守项目/开发者工具/local-only边界，禁止自动修改macOS网络与Shadowrocket TUN。
