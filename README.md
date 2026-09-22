<p align="center">
  <img src="assets/logo.png" width="160" alt="Cleared Logo">
</p>

# Cleared · 清空每一格

Cleared 是一款连线填格益智游戏：连接颜色相同的两个端点，并让所有格子都被合法路径覆盖。

项目使用原生微信小游戏实现，并加入 Portal、冰封格、每日挑战、体力、提示、奖励、主题、分包加载和 CloudBase 云结算与跨设备存档等完整功能。客户端使用 CommonJS JavaScript 和单 Canvas 2D，不依赖 Cocos、Unity、DOM 或 npm 运行依赖。

> 项目尚未正式上线。主线关卡会持续更新，目前已收录 168 关，客户端与现有 CloudBase 关卡目录已经对齐。

## 玩法介绍

- 从一个彩色端点开始，只能上下左右经过相邻格子，连接到同色的另一个端点。
- 路径不能穿过其他端点或已经占用的格子；拖回本次路径中的旧格可以回退。
- 一条路径连接成功后会淡出，但经过的格子仍算被占用。
- 所有格子都被合法路径覆盖时过关；如果端点已经全部连接但还有空格，则本关失败。
- 游玩中可以撤销、重置或查看提示，已完成关卡会记录最快通关时间。

项目还包含两种扩展机制：

- **Portal**：路径进入传送门后暂停，松手并从同一网络中的另一个出口继续。入口、出口、分段手势、撤销和提示都由同一套规则状态维护。
- **冰封格**：两条不同的完成连线先破冰、再清除地板；冰格可连续或分散，并可与 Portal v2 同盘出现，端点和传送门格不能结冰。

## 项目内容

| 部分 | 当前内容 |
| --- | --- |
| 主线关卡 | 持续更新，目前已收录 168 关，从教学小棋盘逐步扩展到 8×8；当前目录包含 129 个普通题、26 个 Portal 题和 13 个冰封题 |
| 难度节奏 | 每关有 1—5 级设计难度；高难关后安排恢复题，并通过固定顺序保持旧关卡 ID 和存档兼容 |
| 每日挑战 | 每个已排期日期提供 3×3 热身和 8×10 挑战；北京时间 2026-09-16 至 09-25 新增十天：3 天 Portal、2 天冰封、5 天混合；每日 3 次进入，完整首通奖励 500，独立于主线进度 |
| 成长系统 | 顺序解锁、最佳时间、体力恢复与快通返还、分级提示、首次通关奖励和永久解锁 |
| 外观与声音 | 经典主题加 10 套可选主题、两种消除效果、按需 BGM 与主包操作音效 |
| 账号与存档 | 进度先保存到本机，首页可立即显示可靠入队的待同步奖励；CloudBase 仍统一确认余额、扣款与所有权，并提供跨设备恢复、批量同步和冲突保护 |
| 发布适配 | 安全区和受控 DPR、一个主包与 11 个普通分包、主包预算检查、开发者工具与正式包配置隔离 |

## 包体与资源加载

当前发布包由一个主包和 11 个普通分包组成：

- 主包约 1.38 MiB，包含启动代码、完整玩法、全部关卡与解答、经典主题、轻量预览、Portal 图标和五个短音效。
- 10 个主题分包在玩家选择主题时按需加载；加载失败不会阻断启动和游玩。
- `audio-bgm` 分包约 1.60 MiB，在声音开启后的首次有效交互后加载；首次播放可能延迟，加载失败只影响本次音乐。
- 当前源码预算统计总计约 15.66 MiB；项目门禁为主包不超过 1.60 MiB、单个分包不超过 3.50 MiB、总包不超过 18.00 MiB。

本地 `output/` 和 `tmp/` 仅用于临时产物，不进入微信上传包；不删除其中的文件。每日题面和完整解答随客户端打包，新增日期不是云端内容热更新。

## 技术结构

微信入口是 `game.js -> src/bootstrap.js -> src/runtime/game-runtime.js -> src/app.js`。`bootstrap` 选择微信平台、环境与在线服务；`game-runtime` 创建通用本地服务并连接 App；`app` 负责场景状态、业务执行顺序和结算编排。规则、输入、渲染、平台和存档各自保持明确边界。

```text
game.js
└── src/bootstrap.js                 微信组合根、环境配置与在线服务
    └── src/runtime/game-runtime.js  通用本地服务与 App 装配
        └── src/app.js               场景、反馈和结算编排
            ├── src/gameplay/        关卡上下文、输入控制和完成策略
            ├── src/services/        进度、体力、奖励、提示、同步等领域服务
            │   └── daily-progress-adapter.js  无状态的每日存档接口兼容与结果归一化
            ├── src/ui/              Canvas 场景和纯棋盘 ViewModel 渲染
            │   └── view-models/daily-view-model.js  每日场景纯字段映射
            ├── src/platform/wechat.js  微信 API 的唯一适配边界
            └── core/                不依赖 wx、Canvas 或存档的纯规则

data/                                关卡、解答、难度和每日题面
src/mechanics/                       Portal、冰封等 data-only 机制声明
src/skins/ 与 src/effects/           只影响表现的主题和消除效果声明
assets/                              Logo、音频、图标、预览与主题精灵表
docs/                                玩法、架构、联网和发布约定
scripts/                             关卡生成、资源校验与发布前检查工具
tests/                               规则、服务、渲染、同步和启动回归测试
.github/workflows/                   持续集成测试
```

`src/app.js` 保留每日场景状态、Runner、关卡推进和云待办顺序。`daily-progress-adapter.js` 负责统一每日存档接口和返回结果，`daily-view-model.js` 负责将每日状态映射成 Renderer 所需字段。两个模块都是无状态模块，不持有 App、Runner、平台或云服务。

几个重要的实现约束：

- `core/game-runner.js` 是棋盘状态和规则权威，只返回结构化手势结果与只读查询，不读取 Canvas 或微信 API。
- 关卡来源和棋盘机制分开表达。普通主线、每日挑战与试玩决定进度和结算；Portal、冰封只决定规则与展示。
- Renderer 只消费 ViewModel，输入控制器只把触摸转换成棋盘坐标，二者都不复制胜负判断。
- 存档 key、关卡 ID 和机制版本保持稳定；奖励、体力和云端操作使用去重记录，保存失败不会先行发奖或破坏内存状态。
- 金币仍只有一份云确认钱包；`RewardUnlockService` 额外派生待同步奖励的只读显示合计，App 负责传递，Renderer 只负责绘制，不读取云待办或计算奖励。
- 原始关卡保存在 JSON 中，提交到小游戏的是生成后的 JavaScript 模块；发布测试会回放正式解答并校验目录、难度和兼容关系。
- `scripts/theme-extraction/runs/` 存放本地生成的素材检查结果，并由 Git 忽略；仓库只保存正式主题素材。
- `game.js` 仍是微信客户端唯一可执行入口；`game-runtime.js` 只导出可注入平台的通用装配，不选择宿主或在线环境。

更完整的依赖方向和扩展规则见 [玩法拓展架构](docs/gameplay-extension-architecture.md)。

## 本地运行

项目没有常规构建步骤，可以直接导入微信开发者工具：

1. 打开微信开发者工具并选择“导入项目”。
2. 选择本仓库根目录，项目类型为小游戏。
3. 若使用其他微信账号，在 `project.config.json` 中换成对应的小游戏 AppID。
4. 点击编译即可运行。

开发者工具模拟器会开放全部主线关卡，方便检查内容；其他运行环境仍按正常顺序解锁。具体差异见 [开发者工具说明](docs/dev-tools.md)。

## 开发期关卡 Copilot

仓库包含一个只在开发电脑运行的关卡 Copilot。普通题支持 5×5、6×6、7×7、8×8 和无镂空 8×10、4—10 色、目标难度 1—3；版本 16 的 Portal v2 候选支持 5×5、6×6、7×7、8×8 和无镂空 8×10、目标难度 2—5，并通过可选 `portalCellCount` 明确选择 2 门或上限 4 门。两种配置都只编译一个中性 P1 网络；2 门使用一条传送线路，4 门使用两条传送线路，每线仍最多跳转一次。冰封、障碍、奇数门格、超过 4 门和多个独立 Portal 网络仍不支持。

普通题由模型生成完整路径；Portal 模型生成 `colorCount - portalCellCount / 2` 条连续 seed 路径，本地再对一条或两条 seed 路径枚举切点，每次切分固定产生一条双段 Portal 路径和一条中间普通路径。未切分路径和切分后的两条最终线路都不得超过棋盘 35%；待切分 seed 可以更长，但只有拆分结果全部合规才会继续。四门切点交叉枚举固定为每条路径最多 32 组代表切点、总计最多 1024 个候选；5 级若首个合法 seed 分数不足，还会在深度 5、beam 100、最多 1600 个 seed、最多 20 秒内做有界尾段重连。所有最终候选仍须执行覆盖与机制合同校验、正式目录等价查重、`GameRunner` 逐段回放、精确求解／Portal 旁路审计和现有难度评估；禁用 Portal 后若只重排任一传送线或传送线加任意一色就能完成，会作为廉价旁路拒绝。

候选只写入被 Git 和微信包忽略的 `scripts/level-copilot/runs/`，人工接受也不会修改正式关卡、解答、云端或玩家数据。版本 7 的 V1 真实评测覆盖 5×5／6×6；版本 8 的普通大棋盘 full 为 23/24 reviewable、人工接受 13 例；版本 15 的 8×8 双门 Portal full 为 23/24 reviewable、22/23 布局唯一。版本 16 的独立 8×10／2—4 门真实 Codex smoke 为 6/6 reviewable、6/6 布局唯一，双门与四门均覆盖 2、4、5 级；四门三例均实际包含 4 个门格、2 条传送线路并分类为 `required`。不同版本评测不能混算，新候选尚未完成人工审核，也没有写入正式关卡。

缺省生成命令继续使用 Responses API；Codex CLI 必须显式传入 `--provider codex`，且只接受已确认的 ChatGPT 登录。两条路径失败时不会互相回退；Codex 订阅路径不传模型或 API key，美元成本字段保持不适用。

Codex 生成会在仓库外新建一次性的 `0700` 工作目录，并通过 `--strict-config`、忽略用户／项目配置与规则、禁用项目文档来固定配置边界。真实 `HOME` 不会传入；子进程只收到 `PATH`、用于既有 ChatGPT 登录定位的 `CODEX_HOME`、固定 locale，以及都指向本次隔离目录的 `HOME`／`TMPDIR`。调用层会显式关闭 Apps、技能发现与技能指令、MCP、插件、hook、shell、浏览器／电脑操作、图像、memory、Web、subagent 和请求类工具。正常结束时 JSONL 必须完整解析；超时、取消或输出超限时只审计终止前的完整事件前缀，再返回真实终止原因。任何已完成事件中的非纯推理／最终消息活动都会失败关闭，事件正文不会写入 artifact。该边界防止普通用户和项目配置改变生成路径，但不宣称能绕过操作系统或组织管理员强制的 Codex 配置；若受管策略拒绝固定限制或仍注入禁止活动，运行应失败而不是放宽限制。ordinary 单次 provider 保持 60 秒；Portal 因分段完整覆盖输出较大而使用 120 秒，但每个 run 的总预算仍为 180 秒。流水线会把两者中更短的剩余时间作为取消信号传入 Responses 请求或 Codex 子进程，并在清理完成后返回。

```sh
# 离线验证 brief
node scripts/level-copilot/cli.js validate --brief path/to/brief.json

# Responses API（旧命令语义不变）；两个环境变量都必须由当前进程提供
OPENAI_API_KEY=... OPENAI_MODEL=... \
  node scripts/level-copilot/cli.js generate --brief path/to/brief.json --live

# Codex CLI；只使用已确认的 ChatGPT 登录，不读取 API key 或模型环境变量
codex login status
node scripts/level-copilot/cli.js generate \
  --brief path/to/brief.json --live --provider codex

# 离线重放候选，或记录一次人工决定
node scripts/level-copilot/cli.js replay --run <runId>
node scripts/level-copilot/cli.js review --run <runId> --decision accepted --reason "clear opening"

# 显式串行在线评测；为每例预留流水线最坏 5 次 provider 调用，不会由测试或 CI 自动调用
node scripts/level-copilot/eval.js --live --max-calls 30 --smoke
node scripts/level-copilot/eval.js --live --max-calls 120
node scripts/level-copilot/eval.js --provider codex --live --max-calls 30 --smoke

# 大棋盘固定评测集；仍需显式联网，smoke 也是 6 例／最多 30 次 provider 调用
node scripts/level-copilot/eval.js --cases scripts/level-copilot/eval-cases-large-v1.json \
  --provider codex --live --max-calls 30 --smoke

# 双门 Portal 固定评测集；full 为 24 例／最多 120 次 provider 调用
node scripts/level-copilot/eval.js --cases scripts/level-copilot/eval-cases-portal-v1.json \
  --provider codex --live --max-calls 30 --smoke

# 8×10／2—4 门 Portal 前沿评测集；smoke 为 6 例，full 仍为 24 例
node scripts/level-copilot/eval.js --cases scripts/level-copilot/eval-cases-portal-frontier-v1.json \
  --provider codex --live --max-calls 30 --smoke

# 完成人工 review 后，按持久化的 caseId → runId 清单离线重算指标
node scripts/level-copilot/eval.js --recompute <evaluationId>
```

完整输入合同、失败关闭、评测分母和正式纳入边界见 [AI 关卡设计 Copilot 实施方案](docs/ai-level-copilot-implementation-plan.md)；作品集级问题说明、架构、最终指标、典型案例和面试讲解见 [AI 关卡 Copilot V1 案例报告](docs/ai-level-copilot-v1-portfolio-report.md)。

## 验证

Node.js 只用于测试和离线工具，不是小游戏运行依赖。

```sh
node tests/run.js
node scripts/validate-theme-assets.js
node scripts/validate-gallery-previews.js
node scripts/check-package-budget.js
git diff --check
```

当前测试入口包含 110 组回归测试，覆盖棋盘规则、Portal 与冰封回放、现有 168 关目录数据、触摸采样、Canvas 渲染、每日存档兼容和页面字段映射、进度与体力、App 本地权威与逻辑命名空间隔离、待同步金币显示、奖励去重、主题/BGM 分包、CloudBase 配置选择、单一结算入口、同步冲突、小游戏启动烟雾流程，以及关卡 Copilot 的离线合同、Responses／Codex 客户端、验证流水线、并发安全落盘和评测指标。

修改 `data/clearedset*.json` 后，需要运行下面的命令更新提交到工程中的关卡模块：

```sh
node scripts/generate-level-modules.js
```

这些命令用于验证源码、关卡数据、资源和项目预算；最终代码包大小以微信开发者工具的代码包分析为准。

## 联网与存档

微信小游戏生产入口当前只有一条正式运行链路：**本地保存 + CloudBase 低频批量云结算**。

- 普通关卡和每日挑战的进度先可靠保存到本机，再登记到当前账号的云端待办队列。
- 首通奖励成功入队后，首页和购买确认会立即显示“云确认余额 + 待同步奖励”的合计，并明确标出其中尚未同步的金额；普通关卡和每日挑战分别按稳定关卡 ID 与日期去重。
- 这个显示合计只是根据可靠待办得到的只读预览，不会写入钱包，也不能作为消费凭证。云确认余额、领取记录和永久拥有权只有在有效回执到达后才会改变。
- 同步由启动、返回首页、进入账号页、前后台切换及持久变更等事件触发，并带有冷却、失败退避和批量上限；游戏不会定时轮询服务器。
- 启动时会确认身份并读取云状态，随后按进度、每日挑战、资产、体力和偏好等数据域恢复或同步。账号、环境或绑定状态变化时，旧请求结果不会写入当前存档。
- 网络暂时不可用时，允许离线进行的内容仍先保留本地进度、待办和显示金额，重启后也会从原待办恢复；联网后继续原操作，不会切换到本地发币。
- 购买时会先同步待确认收益，再由 CloudBase 确认扣款与解锁；同步或购买失败不会扣币或授予主题。

独立 App 的 P2.5-C 共享运行时及 P4 浏览器第二宿主已完成本地实现。仓库外的 `/Users/ethan/Projects/ClearedApp` 以锁文件固定本仓库提交、产品策略、168 关目录、六关快照与 runtime contract 3，并从锁定提交的系统临时快照生成 bundle、在构建后删除快照，不保存可编辑的共享业务源码副本。它只在显式提供 `app-local`、匹配且隔离的存储命名空间、完整六域映射和 App 产品配置时启用；不会因为断网或缺少 CloudBase 自动切换，也拒绝混入 SyncStore、每日挑战、广告、分享或在线服务。P4 已在 Chrome 中验证六关、五条完整版门禁、购买／恢复后的普通关／Portal／冰封、五项 `currency:10000` 回廊投影、双语重载、30 项资源和零远端请求。该宿主仍只是浏览器／WebView 兼容性原型；原生存储提交、杀进程恢复、设备隔离、真实商店和安装包仍归 P4.5／P5。

当前协议、恢复与冲突边界见 [CloudBase 联网说明](docs/cloudbase-local-first-sync.md)。

广告位、资料授权和部分分享奖励默认关闭，完成对应平台配置后可启用。

## 相关文档

- [每日挑战十天机制包与北京时间排期](docs/daily-mechanic-pack.md)

- [玩法拓展架构](docs/gameplay-extension-architecture.md)：规则层、输入、提示、渲染和结算的职责边界。
- [微信小游戏英文本地化方案](docs/localization.md)：系统语言默认、双语词典和账号页语言切换。
- [独立 App 架构准备方案](docs/app-portability-plan.md)：复用已完成的双语能力，规划平台适配、独立账号与存档；明确保持微信编译／预览／上传流程的硬边界、包预算与分阶段验收。P0—P4 已完成共享源码、同步测试及浏览器第二宿主边界内的本地实施；P4.5 原生存储最小验证须单独批准，P5 正式原生 App、真实商店与发布尚未实施。当前商店验证仍只使用测试 provider，不代表真实购买已接通。
- [Portal 机制](docs/portal-mechanic.md)：传送门状态机、分段手势、数据与解答格式。
- [冰封玩法](docs/ice-trial.md)：两层地板规则、提示流程及主线接入边界。
- [关卡难度系统](docs/level-difficulty-system.md)：评分方法、排序规则和舒缓关节奏。
- [AI 关卡设计 Copilot 实施方案](docs/ai-level-copilot-implementation-plan.md)：开发期候选生成、确定性门禁、安全落盘、人工审核和固定评测边界。
- [AI 关卡 Copilot V1 案例报告](docs/ai-level-copilot-v1-portfolio-report.md)：面向作品集和面试的架构、指标、案例、AI 协作边界与后续路线总结。
- [每日挑战](docs/daily-challenge-mode.md)：日期、次数、镂空棋盘和独立存档。
- [体力系统](docs/stamina-system.md)：消费、恢复、返还、回滚和跨设备规则。
- [奖励与货币系统](docs/reward-unlock-system.md)：确认余额、待同步显示、领取去重和购买权限。
- [主题系统](docs/theme-system.md)：主题 manifest、精灵表、画廊和异常回退。
- [分包方案](docs/package-splitting.md)：主包、主题与 BGM 分包划分，以及按需加载和失败回退。
- [包体优化说明](docs/package-size-optimization-plan.md)：当前包体基线、Portal 图标压缩、BGM 分包和预算门禁。
- [CloudBase 联网说明](docs/cloudbase-local-first-sync.md)：云结算、同步频率、恢复和冲突规则。
