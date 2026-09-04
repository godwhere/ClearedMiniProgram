# CloudBase 阶段 3：测试身份与只读链路

状态：阶段3的40项退出门禁已取得对应证据；两个测试事件函数、开发者工具真实链路、双真实账号、跨设备稳定性、离线恢复、Slow 3G迟到保护、持久化不变、错误配置回退与预览二维码均已通过。真机控制台未执行直接数据库负向命令，真实A/B账号切换中的迟到回调未复现，分别由开发者工具原生拒绝与可控A/B fake覆盖，不能冒充真机通过。只连接已有测试环境，不创建生产环境、不购买/升级套餐、不上传存档、不迁移、不进入阶段4。

## 基线与实际环境证据

- 客户端开始 SHA：`7a7fe72e0aa377ff725f0bc83f2b44ff5d1fa504`，main，开始干净；69组测试通过，主包2,859,372字节，总包16,150,312字节。
- 后端：同级 `/Users/ethan/Projects/ClearedCloudBase` 独立本地Git仓库，开始不存在，无远程推送证据；GitHub查询返回404不能区分不存在/无权限。
- 2026-09-04，锁定CLI3.8.1授权成功。环境 `cloudbase-d9gpluqt21ba89532`，名称cloudbase，上海，NORMAL，个人版、文档数据库，来源miniapp。
- `DescribeEnvInfo` 返回关联 `WxAppId=wx7fb1a0811192cd97`，匹配小游戏配置。开始时函数和集合均为空；当前只新增两个目标Event函数及两个身份集合。
- 预付费，到期2027-03-04；自动续费及超额付费关闭，IsAlwaysFree=false。管理员已明确“不用管费用”，取消费用告警前置门禁；未假称永久免费或告警已配置，未改变任何付费设置。
- 用户先备份的是AppSecret，不是身份映射密钥。已另经明确授权在仓库外生成独立HMAC密钥，并按用户要求复制成桌面文档；两份权限0600、内容一致、不显示/不提交。桌面副本未加密。两个函数的四项服务端变量已逐项比对一致，只输出匹配布尔值。

## 修改职责与必要例外

| 文件 | 职责与边界 |
| --- | --- |
| src/config/cloudbase.js、cloudbase.local.example.js、.gitignore | 默认全关；忽略实际测试override；全部写域开关必须false |
| src/platform/wechat.js | 只补基础库envVersion读取；所有原生云调用继续留在平台层 |
| src/services/cloud-function-transport.js | develop/trial与只读动作门禁，沿用watchdog，不重写平台适配 |
| src/services/api-client.js | 必要白名单外运行时适配：旧HTTP路由在Cloud模式拒绝；只投影两个请求；严格只读协议校验。共同协议出口无法由Auth单独修复，未扩展业务 |
| src/services/auth-service.js | 每次身份验证、保留旧凭据、双持久化就绪、A/B保守隔离、在途generation保护 |
| src/services/sync-store.js | 原v2上补环境维度；保留原scope/ID/sequence/队列；身份scope与原本地玩法归属分开。另修复真实旧v2缺少两个恢复槽位时的保守兼容（见下） |
| src/services/progress-sync-service.js | identity就绪后只读；不snapshot/ACK/merge；新本地通关仍入原本地队列；将SDK跨realm返回值投影为本地纯摘要后落盘 |
| src/app.js、src/bootstrap.js | 本地第一帧先启动；仅账号诊断更新；Cloud模式不走旧profile/share/reward恢复路径 |
| tests/cloud-identity-client.test.js、cloud-readonly-state.test.js、cloud-environment-scope.test.js、helpers/cloud-readonly-fixture.js | 真实客户端组件加可控平台替身：落盘顺序、部分失败重启、环境/epoch/generation、严格响应、业务不变与继续本地购买/通关 |
| 既有account-bootstrap/auth/api-client/transport/architecture测试、tests/run.js | 更新阶段1未实现接缝断言，保留HTTP回归；禁客户端后端SDK/秘密字段 |
| tests/hint-service.test.js、hint-service-portal.test.js | 验证时发现两类旧快照测试偶发elapsedMs从0到1；只用公开pause/resume固定测试计时，仍完整比较前后状态，不改Hint或Runner运行时 |

SessionStore v2现有写盘和旧凭据保留合同足够，本轮未重写。core/data/gameplay/mechanics/skins/effects/board/assets以及奖励、体力、广告、分享业务服务均未改。

## 身份与本地归属

1. 本地app.start完成后，微任务触发ensureSession；云调用不阻止输入。
2. 请求含独立requestId、installId、clientVersion和本环境旧绑定诊断；无accessToken、旧HTTPuserId或业务快照。
3. 严格验证环境、内部playerId、正epoch、migrationState=none、六域revision=0、上海时间以及空业务合同。
4. 先保存SessionStore，再持久激活 `cloud:environmentId|playerId` scope；两个存储键不原子。第二次写失败时Session保留为未就绪，Sync旧scope不变，重启后必须重新验证，不能读云。
5. 同环境A变B采用保守策略：保留A，generation失效，返回account-mismatch，暂停云read；不切换单一玩法缓存、不转移A队列。
6. 旧v2无环境的scope原样保留为未确定环境，不推断成test/prod。环境切换用不同scope；旧请求不能ACK或写新环境。
7. 本地玩法继续归属原localOwner/localEnvironment；只读身份激活不接管资产。新离线通关仍写原scope，不进入新云scope。原HTTP绑定存档在Cloud身份后暂停云read，仍保留本地游玩。

state.read只记录当前scope的lastReadAt/服务器时间/全0revision摘要，不改真实revision或任何pendingOperations，不调用任何AuthoritativeStateApplier业务写入。云返回progress/daily/balance/拥有权/体力/preferences等意外字段直接invalid-response，不部分应用。

## 测试开关与发布门禁

正式仓库始终 `enabled=false`、env为空、identity/read=false、testOnly=true、所有写域false。示例文件env为空。

等后端全部部署/验收前置完成后，才复制 `src/config/cloudbase.local.example.js` 为忽略的 `src/config/cloudbase.local.js`，明确填写已批准测试环境并启用enabled/identityEnabled/readEnabled。不提交实际override；不填生产配置。

bootstrap只在develop/trial读取可选override，使用字面量require供依赖分析识别。Transport再次检查运行版本，release/unknown/缺API均fail closed；release即使被误填测试ID和identity=true也不能调用云。开发工具已实际移走override并重新编译：无编译异常、transport为空、API未配置、身份与scope保留、本地游玩允许；测试后恢复忽略的本机配置。

## 本地验证

```sh
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

新增三组后共72组。覆盖Session写失败、Sync激活失败、重启恢复、A/B/epoch/env/generation迟到回调、恶意业务字段、只读诊断写失败、默认关闭/release/未知环境、网络/超时/初始化失败、原始队列不变、云身份后本地购买10000/首通100/快通返还。所有既有每日500、体力自然上限与广告迟到回调回归继续执行。

业务对照同时比较除Session/Sync外的持久化存储和内存progress/daily/rewards/stamina/hints、主题/特效选择。允许新身份与诊断变化，不允许把“加载成功”当成云存档已同步。

曾观察到既有hint只读测试1ms时钟漂移（非状态修改）；已仅固定该测试计时。2026-09-04最终全量复验72组全部通过；主包2,878,522字节（2.745 MiB，117文件），总包16,169,462字节（15.420 MiB，137文件），`git diff --check`通过。此处是源码估算，仍不能代替开发者工具最终包分析。

后端执行npm ci、17项Node单元测试、语法检查、秘密检查、隔离函数依赖安装和包校验。最终复验17/17、`verify:secrets`、`verify:function-packages`、`verify:environment -- --env-id cloudbase-d9gpluqt21ba89532`与`git diff --check`均通过；最终数据库审计仍为2个subject/2个player，字段/关联合法、无孤儿、无明文平台身份。环境verifier只证明准备门禁，真实验收由本runbook中的独立证据支撑。

## 真实联调发现与修复

1. 首版getWXContext即使增加SOURCE检查，管理端负向调用仍读到已有身份。立即关闭两函数客户端权限，停止第二函数部署。新增shared/context.js，将平台第二handler参数中的本次environment与getWXContext对照，无新鲜WX字段就拒绝；不从event读取context、不回退process.env、不输出完整上下文。修复后原生调用成功且仍同player，管理端在原生调用前后均AUTH_CONTEXT_MISSING。初版不可恢复为公开调用版本。
2. 真实旧v2存储没有pendingApplication/lastApplication两个后来新增的字段，导致SyncStore安全冻结。只有authorityMode=legacy-local、migration=null且两字段同时缺失才补null；原字段、队列、ID完全保留。迁移/云权威或单字段缺失继续拒绝。此为阶段2缺陷的最小修复，不是进入迁移。
3. 实际SDK的响应及revisions来自不同JS realm，存储层严格record检查拒绝原对象。先做完整协议验证，再新建本地对象，仅复制时间/日期与全零revision摘要；新增vm跨realm回归，不放宽存储校验或业务字段白名单。
4. 控制台的top和gameContext不共用业务require注册表；业务诊断必须选择gameContext。早期在top运行的require报错不构成模块缺失证明；已在正确上下文和真实App实例重新验收。

## 已取得的真实证据

- identity-api：Event/Nodejs20.19/256MiB/5秒，Active，修复更新时间2026-09-04 14:22:07；player-state-api同配置，更新时间14:26:01。均无触发器，环境HTTP路由为空。
- 原生identity返回player_c75ef90bae8ebe37a82b201578024793e707924f3f72d95b；重复/8路并发读取同一已初始化身份全部OK/MATCHED。真实首次并发创建尚未以新账号测试，不能混称通过；空数据库并发创建由Node单测覆盖。
- 两集合get/add原生负向均-502003。管理端审计1个subject/1个player，字段合法，无孤儿、无明文平台身份，migration=none、六域revision=0。管理API的数值使用Mongo Extended JSON，审计脚本仅解码安全整数包装。
- 完整实际App.resumeOnline：authenticated + cloud-readonly，readOnlySummary持久化成功；内存与磁盘五类业务存档、主题/特效/提示、所有队列及ID/操作序号前后严格相等。账号页已截图显示“云身份／只读测试，本地存档未上传”。
- 验收曾跨多个重编译/界面操作做旧基线对照，其中本地app_launch正常消费序号、日常生命周期落盘及音乐开关测试不能归因于云调用；音乐已恢复初始值，未回退操作序号或删除日常存档。最终改为真实App单次纯云流程前后同时比较内存/磁盘/队列，结果全部不变。
- 只读诊断基线保存于开发工具本机USER_DATA_PATH/cleared-phase3-baseline-20260904-ctxv2.json，未包含登录凭据，未上传，不是产品存档或迁移快照。
- 管理端调用尾部实际应用日志各1条，字段全在白名单；集中CLS查询返回TopicNotExist，未擅自开通日志资源，完整集中日志检索仍未通过。
- 开发者工具服务端口经授权开启时只监听127.0.0.1:15569；登录票据、自动信任项目和多端插件端口始终保持关闭。阶段验收完成后已关闭服务端口，并用本机只读监听检查确认15569无进程监听。工具代理页实际选择“不使用任何代理，勾选后直连网络”，Network节流已恢复Online。
- 首次CLI继承终端127.0.0.1:1082代理时，AppID权限查询即返回`tunneling socket ... 503`；仅对单次命令移除代理变量后AppID权限查询成功，但工具内部上传到`servicewechat.com/wxa-dev/testsource`仍返回相同503。随后只读检查发现当前default.conf已经存在`DOMAIN-SUFFIX,servicewechat.com,DIRECT`，没有重复添加；全局路由当前为Config。相同的单次无代理命令重试成功，生成470×470二维码。开发者工具实际包分析：主包2,522,648字节，总包15,812,448字节。未修改系统代理、DNS、路由、TUN、VPN或shell启动文件；此过程未出现包体80051。
- 开发者工具最早登录的真实微信账号为B，它产生第1组subject/player映射。另一真实账号A扫描预览码并授权后，数据库由1/1变为2/2，证明A与B映射到两个不同的内部player。预览虽继承了开发者工具本地存档，但这不是云端同步。A账号页准确显示“云身份／只读测试，本地存档未上传”；杀进程重开后正常进入且存档保持，数据库仍为2/2，未重复创建。
- 同一手机从A切回B后，首页与只读文案均正常，连续两次云端审计仍为2/2。根据用户对账号时序的明确确认，这是B稳定复用第1组映射的预期结果，不应要求B创建第3组映射。审计同时保持字段/关联合法、无孤儿且无明文平台身份。
- 同一账号B随后在iPad扫描同一预览码，正常进入首页，账号页准确显示“云身份／只读测试，本地存档未上传”。扫码后立即审计仍为2个subject/2个player，字段/关联合法、无孤儿、无明文平台身份，证明B跨手机/iPad复用同一内部player，未重复创建。iPad随后杀进程重开并完成3次前后台切换，首页和存档始终正常；再审计仍为2/2，未重复创建。
- iPad上的账号B完成真实离线恢复验收：断网后冷启动仍进入首页、普通关卡可玩、本地存档保持；恢复联网后账号页重新显示“云身份／只读测试，本地存档未上传”。随后管理端审计仍为2个subject/2个player，字段和关联合法、无孤儿、无明文平台身份，离线期间没有新建或改写身份记录。该证据不等于弱网迟到回调已被捕获。
- iPad二维码真机调试实际连接成功：设备iPad Pro (11-inch, M4)，iOS 26.4.2，微信8.0.76，基础库3.17.2 [1639]，开发者工具显示服务状态正常、Wi-Fi连接、往返耗时539ms。首次连接因操作者关闭连接信息窗口而结束；重新连接后iPad端确认“已连接”。Mac自动化当前只暴露主项目窗口，所以尚未在真机控制台执行直接数据库读写负向命令；该项不计通过。
- 在开发者工具的真实账号B上直接调用player-state-api：伪造账号A的claimedPlayerId与bindingEpoch=1返回`ACCOUNT_BINDING_MISMATCH`/`ok=false`/`data=undefined`；使用B的正确playerId但伪造bindingEpoch=2得到相同拒绝。额外伪造event的openid/OPENID、同时使用B的正确绑定时，返回`OK`且player仍匹配B，证明客户端身份字段被忽略。三次调用后数据库仍为2/2，无写入。这是B→A的真实反向验收；A→B在真机远程调试中仍待执行。
- 将本机开发/体验override临时改为不存在的环境ID后，开发者工具仍立即进入本地首页；等待云初始化失败后，原Cloud session与SyncStore的活动环境仍保持测试环境ID，没有切换到错误scope。此测试没有改系统网络，也没有上传本地存档；测试后必须恢复正确override。
- 将只读状态函数临时改为环境清单外的`player-state-api-phase3-missing`后，开发者工具仍进入本地首页；原Cloud session及SyncStore活动环境继续指向当前测试环境。真实原生调用该名称因环境默认拒绝规则先返回`-501023 PERMISSION_DENIED`，因此不能伪称平台返回“函数未找到”，但“配置指向不存在函数时不阻断本地启动且不切scope”已通过。随后已恢复仅含正确环境ID与两个开关的Git忽略override，并复核首页和“云身份／只读测试，本地存档未上传”文案正常。
- 开发者工具Network使用Slow 3G完成真实迟到回调验收：真实`player-state-api`请求返回200、耗时1.99秒；进入`cloud-reading`后约2240毫秒使旧App账号generation失效，迟到结果返回`account-mismatch`，完整本地存储快照、SyncStore状态和当前账号文案均逐字节保持不变。可控fake另覆盖owner、bindingEpoch、environment及generation切换。限速随后恢复Online；为取得当前App引用临时加入的入口诊断行已立即移除，`game.js`没有留下差异。该证据是实际SDK弱网加真实guard，不冒充一次真实A/B账号切换。

## 真实验收清单（部分待执行）

已执行默认关闭配置的开发工具编译与首页视觉检查：Stable 2.02.2608060，基础库3.16.2，develop。首页仍可见原本地进度24/92、余额2400、体力18（未截断到自然恢复上限5）；此项不是云调用验收。诊断输入曾因UI键盘标点丢失产生一次控制台SyntaxError，随后修正输入并重编译，无代码变更。

开发者工具已完成：首帧先出现；identity.init/state.read成功；账号页明确只读且未上传；直接数据库读写被拒绝；纯云流程前后业务状态不变；无override回退仍可本地游玩；云端资源只有两个Event函数和两个集合。这些证据不等于真机通过。

以下验收仍有未完成项。记录设备与系统、匿名账号A/B、内部playerId、requestId、时间与结论；不记录平台身份或秘密。

- A与B已分别取得两组合法且不同的subject/player映射，账号页文案正确；A杀进程/冷启动后稳定不新增player，B在同机切回及跨设备到iPad后也没有新增player。iPad上B的杀进程重开与3次前后台已通过，仍需A/B并行设备验收；真实并发首次初始化无重复player仍待专门验证。
- B→A的伪造player、B的伪造epoch以及伪造openid不取代可信身份已在开发者工具通过；仍需真机A→B反向拒绝。空UNIONID正常；响应和日志无平台身份原文。
- 真机再次直接get identity_subjects及add players都权限拒绝；开发者工具已通过，规则文件检查不算真机通过。
- iPad真实离线冷启动、普通关卡、本地存档及恢复联网后的只读账号文案已通过；错误env与函数不存在的开发者工具回退已通过；Slow 3G下真实state.read迟到并使旧generation失效后，存储、scope和UI均未被旧响应覆盖。真实A/B切换场景仍由可控fake覆盖，未冒充真机A/B迟到切换。
- identity/read前后progress/daily/余额/拥有权/体力/设置/提示/原队列不变，继续本地购买和通关正常。
- 只有两个Event函数、两个集合，无HTTP/public触发、迁移或业务写入。

## 回滚

关闭identityEnabled/readEnabled/enabled，并移走本地override。保持所有存档、Session、Sync scopes、installId/migrationId、队列、HMAC备份与数据库不变。不能通过清存档/清数据库解决身份bug。两个函数已部署；若身份链路异常，先停客户端测试调用，必要时将两个函数调用规则临时设为全部拒绝。不得恢复初版仅校验SOURCE的代码，也不删除集合、映射或环境。

网络排查只允许项目级、开发者工具级、localhost/本地端口和建议性DIRECT规则。禁止自动修改macOS系统代理、DNS、路由、pf、Shadowrocket/TUN/VPN/Network Extension或shell启动文件中的永久代理变量。服务端口在预览与设备验收完成前保持开启，完成后关闭并复核不再监听。

未调用migration.prepare，未上传本地存档，未执行sync.push，未创建钱包/奖励/永久资产/体力云写入，未进入阶段4。
