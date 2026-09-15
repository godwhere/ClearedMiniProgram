# AI 关卡设计 Copilot：详细实施方案与严格代码边界

> 整理日期：2026-09-15
>
> 审阅基线：`d407dd1`
>
> 文档状态：版本 7／`copilot-prompt-v4` 的 V1 与版本 8／`copilot-prompt-v5` 的普通大棋盘扩展均已完成验收；版本 15／`copilot-prompt-v10` 已实现双门 Portal 2—5 级混合生成、有界高难优化与确定性门禁，固定 smoke 为 6/6、full 为 23/24 reviewable；历史诊断和独立评测状态见第 28 节
>
> 本次授权：第一版按第 14 节白名单实施；大棋盘与 Portal 扩展分别按第 27、28 节边界实施；不修改运行代码、正式关卡、解答、云端、微信配置或发布状态
>
> 仓库位置：`/Users/ethan/Projects/ClearedMiniProgram`

## 1. 结论

第一版 Copilot 应实现为一个**只在开发电脑运行的本地命令行工具**，而不是小游戏内功能。

它接收结构化的普通关卡要求，调用 LLM 生成一份完整路径覆盖，随后完全由本地确定性代码：

1. 校验输入与模型输出结构；
2. 从完整路径反推出同色端点题面；
3. 校验逐格覆盖、相邻移动、路径互斥和端点合同；
4. 使用现有 `GameRunner` 回放到 `WON`；
5. 使用现有精确搜索器做独立可解性审计；
6. 使用现有难度评估器计算真实等级；
7. 与正式目录做旋转、镜像和换色等价去重；
8. 保存本地候选与评测记录，等待人工接受或拒绝。

模型输出永远被视为不可信输入。它不能写文件、执行代码、选择保存路径、分配正式关卡 ID、修改正式数据或绕过任何验证门禁。

第一版只支持：

- `ordinary` 普通连线玩法；
- `5×5` 或 `6×6` 正方形棋盘；
- `4—6` 条颜色线路；
- 目标设计难度 `1—3` 级；
- 每次最多生成 3 个候选；
- 候选只进入本地暂存区，不自动发布。

Portal、冰封格、障碍格、每日挑战、8×8、唯一解证明、自动写入正式关卡和小游戏内 AI 均不属于第一版。

第一版验收结论保持冻结。版本 8 在不改变玩法或发布边界的前提下，把同一普通关合同扩展到 `7×7`、`8×8` 和无镂空 `8×10`，颜色数上限扩到 10；版本 9 验证直接分段生成边界，版本 10—15 收敛为模型连续 seed、本地确定性切分与有界高难重连后开放双门 Portal v2。各版本的评测集和指标不能混算，详见第 27、28 节。

## 2. 当前仓库事实

本方案以当前真实代码为准，而不是为一个独立的新项目另建规则体系。

| 当前能力 | 现状 | Copilot 用法 |
| --- | --- | --- |
| 小游戏入口 | `game.js -> src/bootstrap.js -> src/app.js` | 不接入、不修改 |
| 规则权威 | `core/game-runner.js` | 回放候选解，最终必须为 `GameRunner.OUTCOME.WON` |
| 精确搜索 | `scripts/solve-no-portal.js` | 对编译出的普通题做独立可解性审计 |
| 难度评估 | `scripts/evaluate-level-difficulty.js` | 计算实际分数、等级和分项指标，不相信模型自报难度 |
| 正式目录 | `data/catalog-v2.js` | 只读，用于查重和基线统计 |
| 正式题面源 | `data/clearedset*.json` | 第一版严禁写入 |
| 生成题面模块 | `data/clearedset*.js` | 第一版严禁写入；以后也只能由现有生成脚本更新 |
| 普通／冰封解答 | `data/solutions.js`、`data/ordinary-chapter-solutions.js` | 第一版严禁写入 |
| Portal 解答 | `data/portal-solutions.js` | 不读取、不修改 |
| 测试入口 | `node tests/run.js` | 所有 Copilot 离线测试仍从该入口聚合 |
| 发布包边界 | `project.config.json` 已忽略 `scripts/`、`tests/` 和 `docs/` | 新工具不进入微信小游戏包 |

实施时重新读取的基线为 168 个主线关卡：129 个普通题、26 个 Portal 题和 13 个冰封题。加入七组 Copilot 离线测试后，聚合入口当前包含 104 组测试；这些数字仍不是永久常量。

关联文档：

- [README](../README.md)
- [V1 作品集案例报告](ai-level-copilot-v1-portfolio-report.md)
- [玩法拓展架构](gameplay-extension-architecture.md)
- [关卡难度系统](level-difficulty-system.md)
- [Portal 关卡设计指南](portal-level-design-guide.md)
- [冰封玩法](ice-trial.md)

## 3. 目标、非目标与成功定义

### 3.1 第一版目标

- 把“棋盘大小、颜色数、目标难度和简短设计意图”转换为候选普通关。
- 每份进入人工审核的候选都附带一份可回放的完整解。
- 无效候选自动获得有限、可审计的错误反馈并重新生成。
- 形成固定评测集，能比较 prompt 或模型版本，而不是凭单次观感判断。
- 记录格式通过率、静态规则通过率、运行时通过率、目标难度命中率、重复率、人工采纳率、延迟和 token／可选成本。
- 即使 LLM、网络或本地落盘失败，也不能影响小游戏源码、正式关卡和玩家数据。

### 3.2 明确非目标

- 不在小游戏中联网调用模型。
- 不新增 Canvas 页面、按钮、scene、action 或 hit ID。
- 不接入 CloudBase，不上传候选，不读取或修改玩家数据。
- 不让模型直接生成 JavaScript、补丁、命令、文件名或正式 ID。
- 不做聊天式多轮编辑器、网页后台、可视化拖拽界面或多人协作。
- 不引入 TypeScript、前端框架、数据库、向量库、Agent 框架或通用模型供应商抽象。
- 不新增 npm 运行依赖，也不创建 `package.json` 或 lockfile。
- 不声称关卡具有唯一解；现有搜索器目前只寻找一个解，不枚举第二解。
- 不把难度估计描述为玩家真实通过率；现有模型仍是设计估计。
- 不自动把候选加入主线、每日挑战、奖励、进度、提示或云端目录。

### 3.3 两层成功定义

系统正确性是硬门禁：

- 任何标记为 `reviewable` 的候选，静态合同、运行时回放、难度和查重门禁必须全部通过。
- 任何标记为 `accepted` 的候选仍只是一份人工认可的暂存稿，不是正式关卡。
- 正常命令和所有失败路径对正式数据的写入次数必须为 0。
- 所有自动测试不得访问真实网络。

模型实用性是评测指标，不是放宽硬门禁的理由：

- 模型可以低命中、超时或生成无效题；系统必须正确拒绝。
- prompt 或模型效果不佳时，调整生成策略，不删除验证步骤。
- 达不到第 13 节的建议门槛时，停止扩展 Portal／冰封，先改善普通关生成。

## 4. 核心架构决定

### 4.1 模型输出完整解，不直接输出正式题面

第一版要求模型输出完整路径覆盖 `CandidatePathCoverV1`。本地编译器取每条路径的首尾格作为一对端点，再生成候选 `Lines`。

例如模型输出：

```json
{
  "schemaVersion": 1,
  "paths": [
    { "cells": [0, 1, 2, 3, 4] },
    { "cells": [9, 8, 7, 6, 5] },
    { "cells": [10, 11, 12, 13, 14] },
    { "cells": [19, 18, 17, 16, 15] },
    { "cells": [20, 21, 22, 23, 24] }
  ],
  "designSummary": "Five readable horizontal paths for an introductory board."
}
```

本地编译后才得到：

```json
{
  "Width": 5,
  "Height": 5,
  "Lines": [
    { "Start": 0, "End": 4 },
    { "Start": 9, "End": 5 },
    { "Start": 10, "End": 14 },
    { "Start": 19, "End": 15 },
    { "Start": 20, "End": 24 }
  ]
}
```

这样做有三个直接收益：

- 模型必须同时给出一个“候选可解证明”，不能只猜端点。
- 题面与解答来自同一份受校验数据，不会分别生成后失配。
- 本地代码可以在写出候选前检查每一步，不需要相信自然语言解释。

完整路径仍不是充分验证：JSON Schema 无法表达“覆盖全部格子”“每步四邻接”“没有跨路径重复”等全部语义，因此后续本地门禁不可省略。

### 4.2 开发工具与运行时完全隔离

目标依赖方向为：

```text
brief.json
   │
   ▼
contracts ──► pipeline ──► 显式 provider 路由
                 │              ├──► OpenAI Responses client（固定 HTTPS）
                 │              └──► Codex client（本机 codex exec）
                 ▼
             candidate compiler
                 │
                 ▼
             deterministic validator
                 ├──► core/game-runner.js           只读复用
                 ├──► scripts/solve-no-portal.js    只读复用
                 ├──► scripts/evaluate-level-difficulty.js 只读复用
                 └──► data/catalog-v2.js            只读复用
                 │
                 ▼
              run store ──► scripts/level-copilot/runs/（仅本地）
```

反向依赖一律禁止：`game.js`、`src/`、`core/` 和 `data/` 不能 require Copilot 文件。

### 4.3 模型提供方选择

CLI 只支持两个显式提供方：缺省的 `responses-api` 保持旧命令语义，`--provider codex` 选择 `codex-cli`。任何失败都不得在两者之间自动回退。

Responses API 路径：

- 使用 Node 内置 `https` 发起请求，避免给当前无 npm 运行依赖的仓库新增包管理体系。
- 请求使用 Structured Outputs 的 `text.format` JSON Schema；结构约束依据 [Structured Outputs 官方说明](https://developers.openai.com/api/docs/guides/structured-outputs)。
- 请求生命周期、状态、错误、用量字段依据 [Responses create 官方参考](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)。
- 显式发送 `store: false`，不使用 conversation、`previous_response_id` 或任何工具调用。
- 模型名由 `OPENAI_MODEL` 显式提供，不在源码中写“最新模型”默认值。
- 密钥只从进程环境 `OPENAI_API_KEY` 读取，不读取仓库 `.env`，不写入日志或候选文件。
- 实施真实接口前必须再次核对官方文档；API 合同是可能变化的外部边界。

Codex CLI 路径：

- 只在 `codex login status` 明确返回 ChatGPT 登录时运行；不读取或复制 `~/.codex/auth.json`，也不更改登录状态。
- 使用 Node 内置 `child_process.spawn` 的参数数组和 `shell: false` 启动 `codex exec`。每次生成在仓库外独立创建 `0700` 系统临时工作目录，登录状态检查和生成都不从仓库或其子目录启动。
- 固定传入 `--ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --strict-config --sandbox read-only --json --output-schema --output-last-message`；用最高优先级配置覆盖将 `project_doc_max_bytes` 设为 0，固定 `model_provider="openai"`，并显式关闭 Apps、技能发现与技能指令、MCP、插件、hook、shell、浏览器／电脑操作、图像、memory、Web、subagent 和请求类工具。严格配置保证未知或失效的隔离键直接阻止启动，而不是被静默忽略。参数与配置键依据 [Codex 非交互模式](https://learn.chatgpt.com/zh-Hans/docs/non-interactive-mode)、[配置参考](https://learn.chatgpt.com/zh-Hans/docs/config-file/config-reference)、[Skills](https://learn.chatgpt.com/zh-Hans/docs/build-skills) 和 [Hooks](https://learn.chatgpt.com/zh-Hans/docs/hooks) 固化。
- 不传 `--model`。子进程不是“复制环境后删除若干键”，而是最小允许列表：`PATH`、用于定位既有 ChatGPT 登录的 `CODEX_HOME`、固定 `LANG`，以及都指向本次隔离目录的 `HOME`／`TMPDIR`；真实用户 `HOME`、任何 API key、provider key、代理、动态加载和自定义 base URL 环境变量均不读取、不传递。
- `--output-schema` 的内容直接来自 `contracts.candidateSchema(brief)`；Schema 和最后消息只存在于同一隔离临时目录，并在每次成功或失败后清理。
- 正常结束时 JSONL 的每一行都必须解析并通过事件白名单；仅允许 thread／turn 生命周期及 reasoning／agent message item。command、file change、MCP、Web、subagent、未知工具或未知事件全部失败关闭，只保留事件类型分类，不保存事件正文。超时、取消或输出超限时只容错解析终止前已经完整写出的事件前缀，以保留可用的 thread／状态／usage 和禁止活动审计；若前缀包含禁止活动则安全错误优先，否则返回对应的终止错误。截断尾行不能把真实终止原因覆盖为 JSONL 解析错误。
- 这是 ChatGPT 订阅路径，金额成本固定记录为 `estimatedCostUsd: null` 和 `costAccounting: "not_applicable_subscription"`。

以上是当前 CLI 能证明的**普通用户／项目层隔离边界**，不是操作系统容器：它阻止仓库、用户配置、用户技能和普通环境变量把额外上下文或 provider 注入本次生成，但不声称能绕过组织管理员通过系统／受管层强制执行的 Codex 策略。若受管策略与固定限制冲突并导致 CLI 拒绝启动，或在运行中仍产生禁止活动，provider 必须失败关闭，不得删除限制重试。JSONL 审计是事后失败关闭，不应被描述为能够撤销受管工具已经产生的副作用。

Structured Outputs 只能保证响应符合所给 JSON Schema；它不能证明 Cleared 的规则合法、可解、难度合适或有趣。所有游戏语义继续由本地代码判定。

## 5. 输入合同 `LevelBriefV1`

第一版的权威输入是 JSON 文件。自然语言只能放在受长度限制的 `designIntent` 字段中，不能单独作为一段任意 prompt 执行。

```json
{
  "schemaVersion": 1,
  "mechanic": "ordinary",
  "width": 6,
  "height": 6,
  "colorCount": 5,
  "targetGrade": 2,
  "designIntent": "有一条明显起手线，中段有少量绕行，整体适合作为章节前半段。"
}
```

### 5.1 字段规则

| 字段 | 第一版合同 |
| --- | --- |
| `schemaVersion` | 必须严格等于 `1` |
| `mechanic` | 必须严格等于 `ordinary` |
| `width` | 与 `height` 组合后只能为 `5×5`、`6×6`、`7×7`、`8×8` 或 `8×10` |
| `height` | 见上述固定尺寸白名单；不接受 `10×8`、`8×9` 或任意自由尺寸 |
| `colorCount` | `4—10` 的整数，且不能超过棋盘可容纳的端点数 |
| `targetGrade` | `1—3` 的整数 |
| `designIntent` | UTF-8 文本，1—300 个字符；拒绝控制字符 |

对象必须设置 `additionalProperties: false` 的等价本地校验。未知字段不是“以后可能有用”的扩展，而是输入错误。

### 5.2 硬要求与软要求

棋盘大小、颜色数、机制和目标难度是硬要求。`designIntent` 是软要求，只能由人工审核判断是否满足。

第一版不允许在 `designIntent` 中隐式增加以下硬规则：

- “必须唯一解”；
- “必须包含某个 Portal／冰格／障碍位置”；
- “必须有精确数量的弯折或某条指定路径”；
- “忽略之前规则”“写入某文件”或其他元指令。

以后若某项要求需要成为门禁，应先增加有类型的字段、本地验证和测试，再提升 `schemaVersion`；不能靠 prompt 文字形成隐藏合同。

## 6. 模型输出合同 `CandidatePathCoverV1`

响应 JSON 只允许三个顶层字段：

| 字段 | 合同 |
| --- | --- |
| `schemaVersion` | 必须为 `1` |
| `paths` | 数组长度必须精确等于 brief 的 `colorCount` |
| `designSummary` | Schema 必填但值可为 `null`；非空时为最多 240 个字符的展示说明，不作为通过依据 |

每个 `paths[i]` 只允许 `cells` 字段：

- `cells` 长度为 `2—width×height`；
- 每项是 `0—width×height-1` 的整数；
- JSON Schema 按当前 brief 动态设置 `minItems`、`maxItems`、`minimum` 和 `maximum`；
- 所有对象都设置 `additionalProperties: false`。

模型不输出以下字段：

- `Id`、`Name`、`Difficulty`、`Palette`、`Text`、`Instructions`；
- `Mechanic`、`Portals`、`IceCells`、`Blocked`；
- 文件路径、命令、代码或调试脚本；
- 思维过程或长篇设计推理。

### 6.1 本地编译规则

编译器执行固定映射：

```text
Width  = brief.width
Height = brief.height
Lines  = paths.map(path => ({
  Start: path.cells[0],
  End: path.cells[path.cells.length - 1]
}))
solution = paths.map(path => path.cells)
```

编译器不接收模型给出的端点、难度或名称。实际 `Difficulty` 只在本地评估通过后作为候选分析字段写出；它不能在验证前回填并影响评分。

第一版候选不含正式 `Id` 和正式 `Name`。本地 `runId` 只用于审计，绝不能复制为玩家存档 ID。

## 7. 确定性验证流水线

流水线必须按固定顺序执行，并为每一步写出结构化结果。失败后不能跳到更后面的门禁。

### 7.1 V0：brief 校验

在发生任何网络请求前校验 `LevelBriefV1`。

失败示例：

- `BRIEF_SCHEMA_VERSION_UNSUPPORTED`
- `BRIEF_MECHANIC_UNSUPPORTED`
- `BRIEF_BOARD_SIZE_UNSUPPORTED`
- `BRIEF_COLOR_COUNT_INVALID`
- `BRIEF_TARGET_GRADE_INVALID`
- `BRIEF_INTENT_INVALID`
- `BRIEF_UNKNOWN_FIELD`

这些错误全部是硬失败，不调用模型，不消耗候选次数。

### 7.2 V1：响应和 JSON Schema 校验

客户端先处理 Responses API 的传输与响应状态，再取得唯一的结构化输出：

- HTTP 响应必须成功；
- API `status` 不能是失败状态；
- `incomplete_details` 必须为空；
- 响应不能是 refusal；
- 必须恰好取得一个候选 JSON；
- 候选必须符合本次 brief 动态生成的严格 Schema。

不能用正则从自然语言中“抠出一段 JSON”，也不能静默删除未知字段、把字符串数字转成整数或截断数组来修复模型输出。

### 7.3 V2：路径静态语义校验

逐条检查：

- 路径数等于 `colorCount`；
- 每条路径至少两个格子；
- 所有 cell 都是范围内整数；
- 单条路径不能重复格子；
- 相邻两格的曼哈顿距离必须为 1；
- 不同路径不能共享格子；
- 每个棋盘格恰好出现一次；
- 每条路径首尾端点互不重复。

普通关不存在共享格。总访问次数必须严格等于 `width×height`，去重后也必须等于 `width×height`。

该模块只做候选数据合同校验，不复制撤销、胜负、Portal、冰封或其他 `GameRunner` 规则。

### 7.4 V3：编译与等价重复检查

编译出端点题面后生成布局指纹：

1. 对正方形应用 8 种二面体变换；对 `8×10` 应用保持尺寸不变的原图、180°旋转、水平镜像和垂直镜像；
2. 每条线内部将两个端点排序，忽略绘制方向；
3. 对全部端点对排序，忽略颜色编号；
4. 取全部合法尺寸保持变换中字典序最小者作为 `layoutKey`。

只与 `data/catalog-v2.js` 中相同尺寸的现有普通关比较。Portal 和冰封在相同端点下仍有不同机制，不在第一版普通题的硬重复集合中。

发现重复时返回现有稳定坐标和可用时的 `Id`／`Name`，但反馈给模型时只提供错误码和被拒绝布局指纹，不把整个正式关卡集发送给外部 API。

### 7.5 V4：`GameRunner` 真实规则回放

使用编译出的 level 和 `solution`，对每条路径依次调用：

```text
touchStart(first)
touchMove(each remaining cell)
touchEnd(last)
```

每次调用必须返回成功，最终必须满足：

```text
runner.outcome === GameRunner.OUTCOME.WON
runner.remainingCellCount() === 0
```

`GameRunner` 是运行时规则权威。Copilot 不直接读取或修改 Runner 的内部数组，不新增“AI 专用胜利规则”。

### 7.6 V5：独立精确搜索审计

对编译出的普通题调用现有 `solve-no-portal.js`，保留当前默认 `maxStates = 250000`：

| 搜索状态 | 处理 |
| --- | --- |
| `solved` | 记录独立搜索路径和状态数；审计通过 |
| `limit` | 记录 `SOLVER_INCONCLUSIVE` 警告；不能谎报无解，也不把它当成模型语义错误 |
| `unsatisfiable` | 若 V2 与 V4 已通过，说明本地验证器之间矛盾；立即硬失败，不向模型重试 |
| `invalid` | 说明编译器或边界接线错误；立即硬失败 |

V2 的完整路径加 V4 的真实回放已经构成可解性证明。V5 是独立交叉审计；`limit` 只是搜索预算内没有结论，不能覆盖已成功回放的证据。

第一版不修改搜索器，不增加唯一解枚举，也不把 `states` 直接解释为玩家难度。

### 7.7 V6：难度评估

调用现有 `evaluate-level-difficulty.js`，输入编译题面与完整解答。

- 只接受评估器返回的 `grade` 和 `score`；忽略模型的难度描述。
- `grade === brief.targetGrade` 才通过。
- 同时保存 `factors`、`easyLines`、`lengths`、`detourRate`、`bendsPerLine`、`competingColors` 和 `lineMetrics`。
- 不修改现有阈值 `[20, 40, 60, 75]`，不为提高 Copilot 命中率重标正式目录。
- 第一版 brief 只允许目标 1—3 级；4—5 级和 8×8 要在普通小棋盘数据稳定后另行开放。

### 7.8 V7：进入人工审核

全部硬门禁通过后，状态只能成为 `AWAITING_REVIEW`，不能自动成为正式或已采纳关卡。

如果独立搜索为 `limit`，审核记录必须突出显示 `SOLVER_INCONCLUSIVE`，但不能写成“无解”。

## 8. 错误分类与有限重试

### 8.1 两种重试预算

必须区分网络传输重试和新候选生成：

| 预算 | 上限 | 含义 |
| --- | ---: | --- |
| 候选次数 | 3 | 模型最多生成 3 份不同候选 |
| 单候选传输次数 | 2 | 首次请求加至多 1 次瞬时错误重试 |
| 单次运行 provider 总调用次数 | 5 | Responses 请求或 `codex exec` 都受同一上限约束 |
| 单次响应／事件输出 | 256 KiB | HTTP body、Codex JSONL 或最后消息超限立即中止 |
| 单次 provider 调用超时 | 60 秒 | 与运行总预算的剩余时间取较短值；普通超时进入有限传输重试 |
| 单次 `max_output_tokens` | 5×5／6×6 为 2048；大棋盘为 4096 | 为最多 80 格／10 线的结构化路径和必要推理留出余量，同时不放宽原 V1 请求 |
| 单次运行总时长 | 180 秒 | 流水线向进行中的 HTTPS 请求／Codex 子进程传入同一 deadline／AbortSignal；超限先取消并清理，再以 `RUN_TIME_BUDGET_EXHAUSTED` 失败 |

这些值是第一版安全上限，不开放由模型修改。CLI 若允许覆盖，只能在更小范围内减少预算，不能增大。

### 8.2 传输错误

| 情况 | 是否传输重试 | 说明 |
| --- | --- | --- |
| 网络断开、超时、HTTP 408 | 是，最多 1 次 | 使用短退避 |
| HTTP 429 | 是，最多 1 次 | 尊重但封顶处理 `Retry-After`；超过 30 秒则停止 |
| HTTP 5xx | 是，最多 1 次 | 不生成新的语义反馈 |
| HTTP 400 | 否 | 请求合同或 API 兼容问题，应修代码 |
| HTTP 401／403 | 否 | 密钥或权限问题，不重复消耗请求 |
| refusal／content filter | 否 | 记录原因，不用换措辞无限尝试 |
| 响应过大或非 JSON | 否 | 视为客户端边界失败 |

退避等待不得在测试中真实发生；时间和 transport 必须可注入。

### 8.3 候选错误

以下失败可以消耗下一次候选次数，重新生成整份路径覆盖：

- `CANDIDATE_SCHEMA_INVALID`
- `CANDIDATE_CELL_OUT_OF_RANGE`
- `CANDIDATE_CELL_DUPLICATE`
- `CANDIDATE_STEP_NON_ADJACENT`
- `CANDIDATE_COVERAGE_MISSING`
- `CANDIDATE_PATH_COUNT_MISMATCH`
- `CANDIDATE_REPEAT`
- `RUNTIME_REPLAY_REJECTED`
- `RUNTIME_NOT_WON`
- `LAYOUT_DUPLICATE`
- `DIFFICULTY_TOO_LOW`
- `DIFFICULTY_TOO_HIGH`

`CANDIDATE_REPEAT` 只表示候选内容 hash 已出现，不能据此把原候选未通过的门禁改写为通过。重复报告必须继承首份候选已经得出的 Schema／静态事实；只有首份候选确实通过静态规则时，重复项才能进入 duplicate failed，后续门禁仍保持 pending。

反馈只包含：错误码、少量数值摘要、目标等级、实际等级／分数、缺失格数量、重复布局指纹等受控信息。不得把堆栈、密钥、HTTP headers、本地绝对路径或整个正式目录发给模型。

后一轮是**重新生成**，不是让模型输出补丁。Responses 不使用上次 response 作为服务端对话上下文；Codex 每次使用 `--ephemeral` 启动独立执行，不延续上一候选的 thread。

### 8.4 不得自动重试的内部错误

- 编译后的普通题被搜索器报告 `invalid`；
- 已由 Runner 回放胜利的题被搜索器报告 `unsatisfiable`；
- 本地输出目录越界、符号链接异常或原子写入失败；
- 预算计数器发生不一致；
- 代码读取到了正式数据写权限路径；
- 当前 provider 合同与客户端解析不一致。

这些情况应停止运行并要求修复代码，不能用更多模型请求掩盖。

## 9. 状态机与结果合同

run 和 attempt 使用两层状态，避免把“生成下一份候选”错误表示成同一候选倒退。

run 级只允许：

```text
CREATED
  -> BRIEF_VALIDATED
  -> GENERATING
  -> AWAITING_REVIEW
  -> ACCEPTED | REJECTED
```

`BRIEF_VALIDATED` 或 `GENERATING` 可以进入 `FAILED`。每个候选 attempt 单独经历：

```text
REQUESTING
  -> RESPONSE_RECEIVED
  -> CANDIDATE_VALIDATED
  -> COMPILED
  -> DUPLICATE_CHECKED
  -> RUNTIME_VERIFIED
  -> SOLVER_AUDITED
  -> DIFFICULTY_VERIFIED
  -> REVIEWABLE
```

attempt 的任一步可以进入该 attempt 的 `REJECTED` 或 `FAILED` 终态。只有 `REJECTED` 且 `retryable: true` 时，pipeline 才能在第 8 节预算内创建一个编号更大的全新 attempt；旧 attempt 永不回退、覆盖或继续。状态不能倒退或跨越。

### 9.1 `ValidationReportV1`

每个候选至少记录：

```json
{
  "schemaVersion": 1,
  "status": "rejected",
  "retryable": true,
  "errorCodes": ["DIFFICULTY_TOO_LOW"],
  "warnings": [],
  "checks": {
    "schema": "passed",
    "staticRules": "passed",
    "duplicate": "passed",
    "runtime": "passed",
    "solver": "solved",
    "difficulty": "failed"
  },
  "difficulty": {
    "targetGrade": 2,
    "actualGrade": 1,
    "score": 14.2
  }
}
```

公开错误码应稳定；人类文案可以变化，测试不应依赖完整错误句子。

### 9.2 `RunRecordV1`

run 级记录包含：

- `runId`、`schemaVersion`、`implementationVersion`、`promptVersion`；
- brief 的规范化内容和 SHA-256；
- 明确的 provider；Responses 记录显式模型名，Codex 订阅路径的模型字段为 `null`；
- 开始／结束时间、最终状态和候选次数；
- 每次 provider 响应 ID／Codex thread ID、状态、延迟和 usage；失败响应只要带有 usage 也必须计入 run 汇总；
- 候选是否已经从响应中成功提取；该事实独立于本地验证报告是否成功生成；
- 每个候选的内容 hash、`layoutKey` 和验证报告；
- 总输入、输出和总 token；
- 可选成本估算及其价格快照 ID；
- 人工决定、原因分类和时间；

不得记录：

- `OPENAI_API_KEY` 或 `Authorization` header；
- 整个 `process.env`；
- 未裁剪的异常对象或网络库调试输出；
- 玩家信息、云端数据或本地其他项目内容。

## 10. OpenAI 请求合同

实现时构造的请求语义固定为：

```json
{
  "model": "<OPENAI_MODEL>",
  "store": false,
  "instructions": "<copilot-prompt-v5 的固定系统约束>",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "<规范化 brief 与受控失败反馈的 JSON>"
        }
      ]
    }
  ],
  "max_output_tokens": 2048,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "cleared_ordinary_path_cover_v1",
      "strict": true,
      "schema": "<按 brief 生成的 CandidatePathCoverV1 Schema>"
    }
  }
}
```

上例是 5×5／6×6 的原 V1 数值；动态 Schema 的单路径上限超过 36 格时，客户端固定改用 `max_output_tokens: 4096`。

`copilot-prompt-v5` 保留 v4 的目标等级分数区间、优选区间、普通关精确评分权重和容量感知难度 1 策略，并明确加入 row-major 编号及矩形棋盘不可跨行换列的约束。难度失败重试最多反馈 10 条路径的受控统计，覆盖大棋盘全部颜色；不会拼接任意错误正文、仓库内容或模型生成的指令。普通关的确定性评分仍只由本地 `evaluate-level-difficulty.js` 决定，模型不能自行宣称命中。版本 7 的历史 artifact 继续标记 `copilot-prompt-v4`，不得与新版本指标混算。

实际代码不得：

- 设置 `tools` 或接受模型工具调用；
- 把 API host 改成来自模型或 brief 的值；
- 支持任意 `OPENAI_BASE_URL` 环境变量；
- 自动选择模型或在失败时偷偷切换模型；
- 使用服务端对话状态连接多次候选；
- 将响应内容交给 `eval`、`Function`、shell、`require` 或动态模块加载。

`openai-client.js` 只负责 HTTPS、响应大小、超时、状态分类和抽取结构化输出，不得知道 Cleared 的路径、难度、目录或重试策略。

### 10.1 Codex CLI 执行合同

Codex provider 固定使用参数数组执行：

```text
codex exec --ephemeral --skip-git-repo-check \
  --ignore-user-config --ignore-rules --strict-config \
  --sandbox read-only --json \
  -c project_doc_max_bytes=0 \
  -c 'project_doc_fallback_filenames=[]' \
  -c 'model_provider="openai"' \
  -c 'mcp_servers={}' \
  -c 'features.<DISABLED_FEATURES 中的每个键>=false' \
  -c features.skip_host_skill_discovery=true \
  -c suppress_unstable_features_warning=true \
  -c orchestrator.skills.enabled=false \
  -c skills.include_instructions=false \
  -c tools.experimental_request_user_input.enabled=false \
  -c tools.update_plan.enabled=false \
  -c agents.enabled=false -c 'web_search="disabled"' \
  --output-schema <安全临时 Schema> \
  --output-last-message <安全临时候选> -
```

`DISABLED_FEATURES` 是 `codex-client.js` 中的固定拒绝列表，覆盖 Apps、插件、hook、shell、浏览器／电脑操作、图像、memory、Web、subagent、技能搜索／安装、workspace dependency、授权／请求与其他宿主扩展入口；每个键都展开为独立的 `-c features.<name>=false`。`code_mode=false` 是 code mode 的主门禁，因此不再同时传入会产生冗余提示的 `code_mode_host=false`。`skip_host_skill_discovery` 当前仍是不稳定功能，调用只压制这一个已知启用提示；真正的顶层 error、error item、未知事件或禁止活动仍失败关闭。`--strict-config` 使未知或已失效的隔离键直接导致启动失败。

prompt 通过标准输入提供；CLI 不得拼接 shell 字符串，不得传 `--model`，不得读取认证文件。每次调用必须先在仓库外创建独立 `0700` 工作目录，进程 `cwd`、Schema、最后消息、`HOME` 和 `TMPDIR` 都绑定该目录；真实用户 `HOME`、用户／项目配置、用户技能和 `AGENTS.md` 不进入上下文，`CODEX_HOME` 只用于定位既有 ChatGPT 登录。子进程环境不传 API key、provider key、代理或自定义 base URL。JSONL 与最终文件分别限长并逐事件检查，超时、取消或输出超限时先终止、必要时强制结束，再容错审计已经完整写出的 JSONL 前缀；若没有禁止活动，才返回原始终止原因。正常退出仍要求整份 JSONL 严格有效。无论退出状态如何都清理临时目录和强杀计时器。`turn.failed`、禁止的工具活动、未知事件、正常结束时损坏的 JSONL、缺少最后输出和非法候选 JSON 必须分类失败，不能切换到 Responses API。

## 11. 本地候选与审计文件

所有运行产物固定写入：

```text
scripts/level-copilot/runs/<runId>/
```

该目录位于现有微信 `packOptions.ignore` 的 `scripts/` 下；实施时再把 `/scripts/level-copilot/runs/` 加入 `.gitignore`，避免本地响应误提交。

单次成功或失败运行可以包含：

```text
brief.json                 规范化 brief
run.json                   run 级状态、模型和 usage
attempt-01.json            候选与验证报告
attempt-02.json            若发生第二次候选
attempt-03.json            若发生第三次候选
candidate.json             仅在达到 AWAITING_REVIEW 时生成
review.json                人工接受／拒绝记录；可后补
```

每次 smoke／full eval 另建一个同样由 UUID 标识的评测目录，其中 `eval.json` 持久化评测状态、版本、预算、指标以及完整的 `caseId → runId` 映射。每完成一例就原子更新一次，因此中断后仍能确认已经执行的案例。人工审核后可按映射读取最新 run／review 记录并离线重算 `human_acceptance_rate`，不依赖终端输出。

### 11.1 唯一写边界

只有计划中的 `run-store.js` 可以调用文件写入、目录创建、link 或 rename。其他 Copilot 模块全部返回普通对象。

写入规则：

- `runId` 由本地 `crypto.randomUUID()` 生成，不接受模型值；
- 所有路径由固定根目录与白名单文件名拼接；
- 拒绝绝对路径、`..`、路径分隔符和符号链接越界；
- `runs/` 根目录及每个 run／evaluation 目录固定为 `0700`，其中 JSON artifact 固定为 `0600`；访问历史目录时也会收紧目录权限并复核实际 mode；
- 可更新的 `run.json`／`eval.json` 先写同目录临时文件，再原子 rename；不可覆盖的 attempt、candidate、review 等 artifact 通过原子硬链接提交，目标已存在时必须失败，不能采用“先检查再覆盖”的竞态写法；
- 序列化前执行秘密字段拦截；
- 已完成 attempt 文件不得覆盖，重放只能生成新 run；
- `review.json` 只允许从不存在变为一次决定；跨进程并发审核时只有第一个原子提交能成功，相同决定的竞争方按首份记录幂等恢复，不同决定会报告 `REVIEW_CONFLICT`；改判需新建显式修订记录，不能静默覆盖。

候选文件不是正式数据源，任何运行时代码都不得读取 `runs/`。

## 12. 人工审核与正式纳入边界

### 12.1 人工审核表

每个 `AWAITING_REVIEW` 候选至少检查：

| 维度 | 人工问题 |
| --- | --- |
| 可读性 | 玩家能否识别合理起手，不是纯试错？ |
| 线路区分 | 端点是否过密、颜色是否容易视觉混淆？ |
| 解题节奏 | 难点是否集中在可理解的局部，而非无意义绕线？ |
| 难度感受 | 本地等级与实际体验是否大致一致？ |
| 新颖性 | 即使端点查重通过，体验是否仍像已有题的轻微变体？ |
| 意图符合度 | 是否满足 brief 中的软设计意图？ |
| 章节适配 | 若以后纳入主线，前后关节奏是否合理？ |

人工结果使用受控原因：

- `accepted`
- `reject_too_easy`
- `reject_too_hard`
- `reject_confusing`
- `reject_too_similar`
- `reject_intent_mismatch`
- `reject_not_fun`
- `reject_other`

自由说明可以附加，但统计使用原因代码。

### 12.2 第一版不提供自动正式导入

Copilot 的 `accepted` 只表示人工愿意保留候选。第一版没有 `publish`、`apply`、`append` 或 `sync` 命令。

把候选纳入项目必须另开一次明确的关卡内容任务，因为它需要决定：

- 目标章节和稳定 ID；
- 正式名称、Palette 和显示顺序；
- 是否影响旧关卡编号、解锁节奏和存档兼容；
- 解答应进入旧 set 数组还是 ID 索引表；
- 难度目录和专题文档如何同步；
- CloudBase 合法关卡目录是否需要扩展；
- 微信开发者工具、真机、云端和上传验收范围。

以后正式纳入时仍必须先改 `data/clearedset*.json`，再运行 `node scripts/generate-level-modules.js`；严禁手改带生成标记的 `data/clearedset*.js`。

## 13. 固定评测集与指标

### 13.1 评测集

计划新增 `scripts/level-copilot/eval-cases-v1.json`，包含 24 个固定 brief：

- 5×5 与 6×6 各 12 个；
- 1、2、3 级目标均衡分布；
- 4、5、6 色尽量均衡；
- 设计意图覆盖明显起手、少量绕行、较多竞争、恢复题等普通关表达；
- 不包含任何 Portal、冰封、障碍或唯一解要求。

评测集一旦用于正式比较就不可原位修改。改变 case 时新增 `v2`，并分别报告，不能把不同版本结果混为趋势。

版本 8 另增不可混算的 `scripts/level-copilot/eval-cases-large-v1.json`：7×7、8×8、8×10 各 8 例，合计 24 例；每种尺寸各有 2 例进入固定 6 例 smoke 子集。该评测集只覆盖无镂空普通题，并使用独立 `caseVersion=eval-cases-large-v1`。

### 13.2 两级评测

| 类型 | 数量 | 触发时机 |
| --- | ---: | --- |
| smoke eval | 固定 6 例 | prompt 或解析逻辑的小改动后 |
| full eval | 固定 24 例 | 阶段验收、模型切换或 promptVersion 升级前 |

实时评测不进入 `node tests/run.js`，不在 CI 自动调用。运行必须显式给出 `--live`、provider 和最大调用数；Responses 使用环境中的显式模型，Codex 使用当前已登录账户允许的配置。评测按单个 run 的 5 次最坏 provider 调用上限预留全局容量：6 例 smoke 至少 30 次，24 例 full 必须为 120 次；这不是要求实际消耗满额度，而是保证每例都能执行完整的三候选内重试闭环。

### 13.3 指标定义

| 指标 | 分子／分母 |
| --- | --- |
| `provider_response_rate` | 至少收到一个带 provider response ID／Codex thread ID 的响应 / 所有 run；失败 turn 只要已建立 thread 也属于已收到响应 |
| `api_response_rate` | 至少收到一个带 response ID 的 Responses 对象 / 所有 run；failed、incomplete、refusal 也属于已收到响应 |
| `candidate_received_rate` | 至少成功提取并进入本地验证的候选 / 所有 run |
| `schema_first_pass_rate` | 第 1 个成功提取的候选通过响应 Schema / 已收到候选的 run |
| `static_first_pass_rate` | 第 1 个成功提取的候选通过 V2 / 已收到候选的 run |
| `runtime_first_pass_rate` | 第 1 个成功提取的候选回放到 WON / 已收到候选的 run |
| `valid_within_3_rate` | 3 个候选内通过 V2—V5 / 所有 run |
| `difficulty_hit_within_3_rate` | 3 个候选内命中目标等级 / 所有 run |
| `duplicate_rejection_rate` | 被布局查重拒绝的候选 / 所有结构有效候选 |
| `reviewable_rate` | 达到 AWAITING_REVIEW / 所有 run |
| `human_acceptance_rate` | accepted / 已完成审核的候选 |
| `unique_reviewable_rate` | 去重后的 reviewable `layoutKey` / reviewable 数量 |
| `latency_p50/p95` | run 端到端毫秒数的中位数／95 分位 |
| `tokens_per_reviewable` | 总 token / reviewable 数量 |
| `estimated_cost_per_reviewable` | 可选总估算成本 / reviewable 数量 |

收到 provider 响应不等于成功提取候选：例如 Responses 的 incomplete／refusal 有 response ID 时计入 `provider_response_rate` 与 `api_response_rate`；Codex 的 failed turn 有 thread ID 时只计入 `provider_response_rate`。二者都不计入 `candidate_received_rate` 或首候选通过率分母。Codex 模式的 `api_response_rate` 必须为 `null`，不能伪造为 1。反过来，候选已成功提取但本地验证器内部失败时仍计入 `candidate_received_rate`；因为没有通过报告，它不会增加 Schema／静态／运行时通过分子。没有 provider 响应也不得算成模型格式错误。没有完成审核的候选不能进入人工采纳率分母。full eval 中不同 run 产出相同 `layoutKey` 时不反向改变单题结果，而是在 `unique_reviewable_rate` 中暴露批次多样性问题。

### 13.4 成本记录

Responses usage 中可用的输入、输出和总 token 应原样记录；成功、失败、refusal 或 incomplete 响应只要返回 usage，都必须在抛出分类错误前提取并计入 run 与评测总量。价格会变化，因此源码不得硬编码某个模型的当前单价。

如需金额统计，full eval 必须显式传入一份本次运行的价格快照，其中包含：

- 模型名；
- 输入／输出每百万 token 单价；
- 币种；
- 生效或查阅日期；
- 官方来源 URL；
- 本地 `pricingSnapshotId`。

没有价格快照时仍可运行 Responses 单题生成并记录 token，但金额字段必须为 `null` 和 `not_calculated`，不能填 0。Codex 订阅路径不接受价格快照，不估算 API 美元费用；其金额字段固定为 `null`，并使用 `not_applicable_subscription` 标记。

### 13.5 第一版建议门槛

以下是进入下一机制前的建议门槛，不是修改本地硬规则的理由：

- 24 例 full eval 中，任何 `reviewable` 候选静态与运行时误放行率为 0；
- 正式数据写入为 0，秘密泄漏为 0；
- `valid_within_3_rate >= 80%`；
- `difficulty_hit_within_3_rate >= 60%`；
- 已审核候选的 `human_acceptance_rate >= 30%`；
- 无未解释的客户端解析错误或验证器矛盾。

这些比例是 MVP 的去留门槛，应在首次完整基线运行前锁定。若没有达到，先分析失败分布：

- 大量结构错误：检查 Schema 和响应解析；
- 大量覆盖／相邻错误：改善路径生成 prompt；
- 大量难度偏差：使用评估分项做受控反馈；
- 大量“无趣”拒绝：增加确定性生成器或候选排序，不扩展机制；
- 大量重复：改进布局指纹反馈和候选多样性。

## 14. 严格代码施工白名单

本节是第一版完整实施的文件上限。若实现过程中发现必须修改白名单外文件，应停止并先更新方案／请求用户确认，不能以“顺手修复”为由扩大范围。

### 14.1 新增开发工具文件

| 文件 | 唯一职责 | 禁止职责 |
| --- | --- | --- |
| `scripts/level-copilot/contracts.js` | brief 校验、动态响应 Schema、稳定错误码 | 网络、文件写入、Runner、目录读取 |
| `scripts/level-copilot/candidate.js` | 路径静态校验、题面编译、正方形／矩形布局指纹 | 网络、文件写入、难度算法、运行时规则 |
| `scripts/level-copilot/validator.js` | 按固定顺序调用 catalog、Runner、搜索器和难度评估器，汇总报告 | 修改被调用模块、写正式数据、模型调用 |
| `scripts/level-copilot/prompt.js` | 版本化固定 prompt、brief、目标分数区间和受控失败反馈序列化 | 读取环境、网络、文件写入、拼接任意仓库内容 |
| `scripts/level-copilot/openai-client.js` | 固定 OpenAI HTTPS 请求、大小／超时限制、响应分类、usage 抽取 | 游戏规则、重试循环、文件写入、可配置任意 host |
| `scripts/level-copilot/codex-client.js` | 校验 ChatGPT 登录并以固定参数安全启动本机 `codex exec`、解析 JSONL／最后消息 | API key、模型选择、shell 拼接、规则与重试策略 |
| `scripts/level-copilot/run-store.js` | `runs/` 内的安全、原子 JSON 写入，以及 Codex Schema／最后消息临时文件生命周期 | 网络、模型调用、修改正式数据 |
| `scripts/level-copilot/pipeline.js` | 状态机、双重预算、候选重试和依赖编排 | 直接 HTTPS、直接 fs、复制规则实现 |
| `scripts/level-copilot/cli.js` | 命令参数、环境检查、依赖装配、退出码和简短输出 | 领域规则、隐式联网、自动发布 |
| `scripts/level-copilot/eval.js` | 固定 case 批量运行、指标聚合和报告 | CI 自动联网、修改评测集、绕过单 run 预算 |
| `scripts/level-copilot/eval-cases-v1.json` | 24 个固定、无秘密的评测 brief | 模型响应、正式关卡或可变运行结果 |
| `scripts/level-copilot/eval-cases-large-v1.json` | 24 个固定的大棋盘评测 brief，与 V1 指标隔离 | 模型响应、正式关卡、镂空每日题或可变运行结果 |

`runs/` 是运行时生成目录，不提交空目录或占位文件。

### 14.2 新增测试文件

| 文件 | 覆盖范围 |
| --- | --- |
| `tests/level-copilot-contracts.test.js` | brief、动态 Schema、未知字段和边界值 |
| `tests/level-copilot-candidate.test.js` | 覆盖、重复、相邻、编译、正方形 8 种与矩形 4 种几何指纹 |
| `tests/level-copilot-validator.test.js` | Runner、搜索状态、难度、查重和报告 |
| `tests/level-copilot-client.test.js` | 假 transport、HTTP 分类、超时、限长、refusal、incomplete 和 usage |
| `tests/level-copilot-codex-client.test.js` | 假子进程、ChatGPT 登录门禁、固定参数／环境清理、JSONL、超时、限长和订阅费用合同 |
| `tests/level-copilot-pipeline.test.js` | 状态机、两类重试预算、最大调用数、落盘内容和失败关闭 |
| `tests/level-copilot-eval.test.js` | 指标分母、p50/p95、价格缺失、报告可复现性 |

测试使用固定假响应和注入 transport／假子进程，不能读取真实 API key，不能访问网络或实际启动 Codex，也不能依赖真实模型的随机输出。

### 14.3 允许局部修改的既有文件

| 文件 | 允许修改范围 |
| --- | --- |
| `.gitignore` | 仅新增 `/scripts/level-copilot/runs/` |
| `tests/run.js` | 仅注册上述新增测试组；不改旧测试顺序和断言 |
| `tests/architecture-boundaries.test.js` | 仅追加第 14.5 节的隔离断言；不放宽现有规则 |
| `README.md` | 代码可用后增加“开发期关卡 Copilot”命令、范围和非运行时说明，并更新实际测试组数 |
| `docs/ai-level-copilot-implementation-plan.md` | 更新实施状态、实际验证结果和偏差说明 |

### 14.4 第一版绝对禁止修改

- `game.js`、`game.json`、`project.config.json`；
- `src/**`；
- `core/**`；
- `data/**`；
- `cloudfunctions/**`；
- `.github/**`；
- `scripts/solve-no-portal.js`；
- `scripts/evaluate-level-difficulty.js`；
- `scripts/generate-level-modules.js`；
- 任何主题、图片、音频、分包、存档、奖励或云配置；
- 新建 `package.json`、lockfile、`.env` 或通用配置框架。

这里的“禁止修改”不代表这些文件永远不能演进，而是第一版 Copilot 施工中没有授权。若现有模块暴露缺陷，先用最小复现报告问题，再另开修复范围。

### 14.5 必须新增的架构门禁

`tests/architecture-boundaries.test.js` 追加静态检查：

- `game.js`、`src/**/*.js`、`core/**/*.js`、`data/**/*.js` 不得依赖 `scripts/level-copilot`；
- Copilot 文件不得出现 `wx`、Canvas、CloudBase 或运行时 service 依赖；
- 只有 `openai-client.js` 可以包含 `api.openai.com`、`Authorization` 和 Node `https`；
- 只有 `run-store.js` 可以调用 `writeFile`、`mkdir`、`link`、`rename` 或 `unlink`；
- 只有 `codex-client.js` 可以依赖 `child_process`；它必须使用参数数组与 `shell: false`；
- 所有 Copilot 文件禁止 `eval`、`Function`、`vm` 和动态 `require(variable)`；
- 除 Node 内置模块和仓库相对路径外，不允许第三方 require；
- `validator.js` 对现有规则／数据模块只有读依赖；
- `runs/` 必须同时被 Git 忽略，且位于微信已忽略的 `scripts/` 目录内。

## 15. 分阶段实施顺序

每一阶段都必须保持上一阶段测试通过。不得先做实时 API，再补安全与验证。

### S0：合同与离线候选验证

允许文件：

- `contracts.js`
- `candidate.js`
- `validator.js`
- 前三份对应测试
- `tests/run.js`
- `tests/architecture-boundaries.test.js`

工作内容：

1. 固化 `LevelBriefV1`、`CandidatePathCoverV1` 和错误码。
2. 实现普通路径覆盖静态校验。
3. 实现题面编译与通用 5×5／6×6 几何指纹。
4. 接线现有 catalog、Runner、搜索器和难度评估器。
5. 用手写有效／无效候选证明验证流水线。

完成门禁：

- 有效 fixture 达到 `reviewable`；
- 每类单点错误都被对应错误码拒绝；
- 旋转、镜像、端点反向和颜色换序得到同一布局指纹；
- 不存在网络与文件写入代码；
- 全量测试通过。

### S1：OpenAI 客户端与单次结构化生成

新增允许文件：

- `prompt.js`
- `openai-client.js`
- `level-copilot-client.test.js`

工作内容：

1. 按官方 Responses API 实现固定 HTTPS 客户端。
2. 构造动态严格 JSON Schema。
3. 完整处理 HTTP、API status、incomplete、refusal、输出抽取和 usage。
4. 使用注入 transport 完成全部测试。
5. 仅在离线测试完成后，手动执行一条显式 `--live` 冒烟调用。

完成门禁：

- 没有密钥时安全失败且不发请求；
- 模型名缺失时安全失败；
- 所有 API 失败映射为稳定本地错误；
- 测试日志和 run 对象不含密钥／header；
- 官方接口文档已在实施当日重新核对。

### S2：状态机、有限重试和安全落盘

新增允许文件：

- `run-store.js`
- `pipeline.js`
- `cli.js`
- `.gitignore`
- `level-copilot-pipeline.test.js`

工作内容：

1. 实现第 9 节单向状态机。
2. 分离传输重试与候选重试计数。
3. 实现受控失败反馈和最大 provider 调用数。
4. 实现固定 `runs/` 根目录和原子写入。
5. 实现 `validate`、`generate --live`、`replay`、`review` 命令。

完成门禁：

- 每种失败都能在预算内停止；
- 第 3 个候选后不会发出第 4 个语义请求；
- provider 调用总次数永远不超过 5；Responses 的 HTTP 次数也不超过 5；
- 人为制造写盘失败时不产生半份“成功”记录；
- 全仓正式数据 hash 在运行前后完全一致。

### S2.1：Codex CLI 提供方

新增允许文件：

- `codex-client.js`
- `level-copilot-codex-client.test.js`

工作内容：

1. 保留 Responses 旧语义，并新增显式 `--provider codex` 路由；两者失败时均不互相回退。
2. 只在 ChatGPT 登录状态明确时，从仓库外独立 `0700` 临时目录以固定只读、ephemeral、严格配置、忽略用户配置／规则／AGENTS 和关闭宿主扩展入口的参数启动 Codex 执行。
3. 以最小环境允许列表保留 CLI 认证定位，真实 `HOME` 替换为隔离目录，固定 OpenAI provider，不让 API key、任意自定义 provider、用户技能、Apps、MCP、插件、hook、代理、Web 或 subagent 改变调用边界。
4. 复用同一动态 Candidate Schema；正常结束时全量严格检查 JSONL，终止场景只检查完整事件前缀，只解析 thread／turn／usage 与最后消息候选。
5. 复用 S2 的三候选、两次传输、五次 provider 调用，并让进行中的子进程响应同一 180 秒运行级取消信号。

完成门禁：

- 自动测试完全使用可注入假子进程，不读取凭据、不实际调用 Codex；
- API key、任意 provider key、代理和模型环境变量既不读取也不传入 Codex 子进程；真实 `HOME` 不传入，`--strict-config` 和完整隔离参数存在且没有 `--model`；
- 仓库内 `cwd`／临时根、failed turn、禁止工具事件、未知事件、正常结束时损坏的 JSONL、缺输出和非法候选都失败关闭；带截断尾行的超时、取消和输出超限保留已完成事件元数据并返回真实终止分类；所有路径都清理临时文件；
- `candidateReceived` 与本地验证解耦；订阅费用和评测指标使用 provider-neutral 合同。

### S3：固定评测与文档接入

新增允许文件：

- `eval.js`
- `eval-cases-v1.json`
- `level-copilot-eval.test.js`
- `README.md`
- 本文档

工作内容：

1. 建立 6 例 smoke 与 24 例 full 子集。
2. 实现准确分母、延迟分位、token 和可选价格快照统计。
3. 运行首次 full eval，保留报告和人工审核结果。
4. 在 README 增加已真实可用的开发命令；不把计划命令提前写成现状。
5. 将本文状态更新为本地实施完成或明确记录未达门槛项。

完成门禁：

- 相同固定输入和假响应产生字节稳定的指标内容；时间戳等运行元数据与指标主体分离；
- 没有价格快照时成本是 `null`，不是 0；
- full eval 结果明确写出模型、promptVersion、case 版本和日期；
- 未完成真人审核时不报告人工采纳率。

### S4：正式关卡纳入，另行授权

本阶段不属于第一版代码白名单。只有用户接受具体候选并明确要求纳入项目后才能开始。

开始前必须重新制定该候选的文件白名单、稳定 ID、目标章节、解答位置、排序与云目录范围，并按项目文档规则同步玩法／难度／专题文档。不能把 S4 作为 S3 命令的自动后续。

## 16. 计划中的 CLI

以下接口已经实现。`validate`、`replay` 和 `review` 保持离线；`generate` 与 `eval` 必须显式提供 `--live`。缺省 provider 仍是 Responses，并只从当前进程环境读取 `OPENAI_API_KEY` 和 `OPENAI_MODEL`；Codex 必须显式选择且不读取这两个变量。

```sh
# 只验证 brief，不联网、不写正式数据
node scripts/level-copilot/cli.js validate \
  --brief path/to/brief.json

# 显式实时生成；OPENAI_API_KEY 和 OPENAI_MODEL 必须由进程环境提供
node scripts/level-copilot/cli.js generate \
  --brief path/to/brief.json \
  --live

# 使用当前已确认的 ChatGPT Codex CLI 登录；不传模型、不使用 API key
node scripts/level-copilot/cli.js generate \
  --brief path/to/brief.json \
  --live \
  --provider codex

# 离线重放已保存候选的全部确定性门禁
node scripts/level-copilot/cli.js replay \
  --run <runId>

# 记录人工审核；不会修改正式关卡
node scripts/level-copilot/cli.js review \
  --run <runId> \
  --decision accepted \
  --reason "clear opening and good mid-board tension"

# 显式运行固定在线评测；不会由 CI 自动触发
# smoke：6 例 × 单例最多 5 次 HTTP
node scripts/level-copilot/eval.js \
  --cases scripts/level-copilot/eval-cases-v1.json \
  --smoke \
  --live \
  --max-calls 30

# Codex smoke：仍为 6 例 × 单例最多 5 次 provider 调用
node scripts/level-copilot/eval.js \
  --provider codex \
  --smoke \
  --live \
  --max-calls 30

# full：24 例 × 单例最多 5 次 HTTP
node scripts/level-copilot/eval.js \
  --cases scripts/level-copilot/eval-cases-v1.json \
  --live \
  --max-calls 120

# 人工审核后按 eval.json 中的 caseId → runId 映射离线重算
node scripts/level-copilot/eval.js \
  --recompute <evaluationId>
```

命令输出只打印：runId／evaluationId、最终状态、候选次数、主要错误码、实际难度、usage 摘要和本地结果目录。默认不打印完整模型响应或整个候选 JSON。

退出码建议：

| 退出码 | 含义 |
| ---: | --- |
| `0` | 命令目标完成；生成命令达到 `AWAITING_REVIEW` |
| `2` | brief 或 CLI 参数错误 |
| `3` | provider 配置／认证错误 |
| `4` | 候选预算耗尽，没有 reviewable 结果 |
| `5` | 本地内部合同矛盾或安全边界失败 |

## 17. 测试清单

### 17.1 合同与候选

- 5×5、6×6、7×7、8×8、8×10 合法 brief；
- 4—10 色边界；
- 5×6、7×8、8×9、10×8、目标 4 级、未知机制和未知字段拒绝；
- 中文／英文 `designIntent`，空字符串、过长文本和控制字符拒绝；
- 合法全覆盖路径；
- 严格 Schema 的三个顶层属性全部列入 `required`，`designSummary: null` 合法而缺字段非法；
- 越界 cell、浮点数、字符串数字、空路径、单格路径；
- 路径内部重复、跨路径重复、缺格、非相邻移动；
- 端点反向、颜色换序和八种几何变换指纹一致；
- 不同普通布局不误判为重复。

### 17.2 规则与难度

- 真实 GameRunner 回放为 WON；
- 任一步 start／move／end 被拒绝时立即失败；
- 最终未填满时不允许 reviewable；
- 搜索器 `solved`、`limit`、`invalid`、`unsatisfiable` 四分支；
- 难度恰好命中、偏低和偏高；
- 查重报告包含稳定坐标但不泄露正式目录到模型反馈；
- validator 不修改 level、solution、catalog 或 Runner 输入对象。

### 17.3 API 客户端

- 成功 JSON、usage 和 response ID；
- failed、incomplete 与 refusal 响应的 usage 和 response ID 在分类错误中仍保留；
- 200 但 API status 失败；
- incomplete：`max_output_tokens`、content filter 或未知原因；
- refusal；
- 400、401、403、408、429、500；
- 超时、连接重置、非 JSON、空 output、多个候选、响应超过 256 KiB；
- transport 重试最多一次，且不消耗语义候选次数；
- host、path、method、`store:false` 和 Schema 请求形状固定；
- 错误和日志不含 API key。

### 17.3.1 Codex CLI 客户端

- 只接受明确的 ChatGPT 登录状态，其他认证方式在 `codex exec` 前拒绝；
- 正常结构化候选、thread ID、turn 状态、input／cached input／output／reasoning token；
- 参数数组、`shell: false`、ephemeral、read-only、`--strict-config`、完整隔离参数、动态 Schema 和最后消息路径固定，且不传 `--model`；
- `skip_host_skill_discovery` 的已知不稳定功能提示被显式压制；`code_mode` 主门禁关闭时不再重复设置 `code_mode_host`，避免把无副作用配置提示误包装为 error item；真正的 error item 仍禁止；
- 生成 `cwd`、`HOME` 与 `TMPDIR` 是仓库外新建的同一 `0700` 临时目录；真实 `HOME`、仓库／全局 `AGENTS.md`、用户 config 和用户 skills fixture 不进入输入，仓库内临时根直接失败；
- 子进程环境是固定允许列表，不读取或包含 API key、任意 provider key、代理／base URL 或模型变量；用户自定义 provider、Apps、技能、MCP、插件和 hook 不能改变固定订阅路径；
- `turn.failed`、command／file／MCP／Web／subagent／未知工具活动、未知事件、损坏 JSONL、缺少最后输出、非法候选 JSON；
- 超时、取消、异常退出、JSONL／最后输出超限、强制终止和临时文件清理；超时、取消或输出超限即使留下截断 JSONL 尾行，也必须保留完整前缀中的 thread／状态／usage 并返回真实终止错误；
- 订阅模式成本为 `null`，失败不回退 Responses。

### 17.4 状态机与文件

- 每条合法状态转移；
- 倒退、跳阶段和终态再次写入拒绝；
- 三次语义失败后停止；
- 同一 run 重复返回相同候选时以 `CANDIDATE_REPEAT` 记录且仍消耗候选次数；重复项继承首份候选已经完成的 Schema／静态事实，不能把失败提升为通过；
- provider 总调用数封顶，Codex run 的直接 Responses HTTP 调用数为 0；
- 100 ms 总预算配合 300 ms 可取消 provider 的反例分别覆盖 Responses 与 Codex：接近 100 ms 时取消，usage 与 FAILED artifact 保留，慢任务／子进程／HTTPS 监听器和计时器均已清理；
- smoke 和 full 分别必须预留 30 和 120 次全局容量，24 例每例使用 5 次时仍完成 24/24；
- `runId`、文件名、绝对路径、`..` 和符号链接攻击；
- 临时写入失败、link／rename 失败和已有 attempt 文件；
- artifact 中秘密字段扫描；
- `review.json` 一次决定和显式修订；
- `review.json` 已写但 `run.json` 未更新时，相同决定重试可恢复且不同决定冲突；
- 两个进程并发提交不同审核决定时只有一份可落盘，另一份稳定返回 `REVIEW_CONFLICT`；
- 无论成功失败，正式数据文件内容 hash 不变。

### 17.5 评测

- `provider_response_rate` 对两个 provider 统一统计，Codex 的 `api_response_rate` 保持 `null`；
- `api_response_rate` 与 `candidate_received_rate` 分开统计；带 response ID 的 incomplete／refusal 只进入前者；
- 候选已提取但本地验证器异常时进入 `candidate_received_rate`，并以 0 而非缺失参与首候选通过率；
- 网络失败不进入 Schema 通过率分母；
- 未审核候选不进入人工采纳率分母；
- `eval.json` 持久化完整 `caseId → runId` 清单，审核后可离线重算人工采纳率；
- 偶数／奇数样本的 p50、p95；
- 0 个 reviewable 时不除零；
- usage 缺失与价格快照缺失；
- 输入／输出单价分别计算；
- smoke 和 full 使用固定 case ID；
- 不同 case 版本不能合并。

## 18. 验证命令与证据边界

每个代码阶段完成后至少运行：

```sh
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

还需要执行 Copilot 的离线 fixture 命令，并比较正式数据在运行前后的 hash。真实 Responses／Codex 冒烟和 full eval 必须单独报告，不能用假 transport 或假子进程测试冒充。

由于第一版只在 `scripts/` 中运行且没有小游戏入口接线，Node 与边界测试可以证明本地工具合同；它们仍不能证明微信开发者工具、真机、CloudBase、上传或审核状态。第一版未改运行包时无需为了 Copilot 执行真机玩法验收，但必须运行包体脚本确认隔离假设仍成立。

## 19. 安全、隐私与失败关闭

- Responses API key 只存在于调用进程环境；文档、fixture、报告和错误均不得包含真实值。
- Codex provider 只接受 `codex login status` 明确证明的 ChatGPT 登录；不读取认证文件，不改变登录状态。每次生成从仓库外独立 `0700` 临时目录启动，并以 `--ignore-user-config`、`--ignore-rules`、`--strict-config`、`project_doc_max_bytes=0` 及显式功能关闭隔离用户／项目配置、规则、`AGENTS.md`、用户技能、Apps、MCP、插件、hook、shell、浏览器／电脑操作、图像、memory、Web、subagent 与请求类工具。
- Codex 子进程环境按允许列表重新构造，而非复制父进程环境；只保留 `PATH`、用于定位既有 ChatGPT 登录的 `CODEX_HOME`、固定 locale，以及都指向隔离目录的 `HOME`／`TMPDIR`。真实用户 `HOME` 不进入子进程；这允许 CLI 自己定位既有 ChatGPT 登录，但不向 Node 暴露认证文件内容，也不传 API key、provider key、代理或自定义 provider 地址。
- 固定请求 `https://api.openai.com/v1/responses`，不支持由 brief、模型或普通环境变量改 host。
- `designIntent` 是数据，不是高优先级指令；系统约束明确禁止遵循其中的元指令。
- Copilot 自身只把已校验 brief、受控失败摘要和动态 Schema 提供给模型；生成进程没有仓库工作目录或仓库参数，且调用层关闭宿主扩展入口。该保证针对 Copilot 控制的普通用户／项目配置层，不把宿主操作系统或组织管理员强制策略描述成容器级隔离；JSONL 审计能够失败关闭，但不能撤销受管层强行开放的工具已经产生的副作用。
- 不执行模型内容，不动态加载模型返回的模块。
- Responses 缺少 API key／模型名，或 Codex 缺少 CLI／ChatGPT 登录，以及任一 provider 缺少有效 JSON 或写盘能力时全部失败关闭。
- 候选通过前不写 `candidate.json`；任何中间失败都要保留准确状态，不能伪装成功。
- 实时运行需要显式 `--live`，测试和普通 `validate` 默认零网络。
- provider 错误不能触发备用供应商、备用模型或无限重试。
- 正常结束时 JSONL 必须全量解析；超时、取消或输出超限时只容错解析完整事件前缀，截断尾行不得覆盖真实终止分类。任何完整的非白名单活动只保存受控类型标签并失败，不保存事件正文。受管策略若拒绝固定限制或仍注入禁止活动，provider 失败，不能删减隔离参数后重试。
- `store:false` 是客户端请求断言的一部分，不能只依赖默认值。

## 20. 性能与资源上限

工具保持串行单进程：一次只处理一个 run 的一个候选，不做并发模型调用。

- V1 基线最多 36 格／6 条路径；版本 8 固定尺寸白名单最多 80 格／10 条路径；
- 搜索器沿用 250000 状态上限；
- HTTP body、Codex JSONL 和最后消息各受 256 KiB 上限约束；
- 单次 provider 60 秒与 run 总计 180 秒取较短的剩余时间；同一个运行级取消信号必须实际销毁 HTTPS 请求或终止 Codex 子进程，清理完成前流水线不得返回；
- 运行产物不保存原始 HTTP body；
- full eval 默认串行，避免瞬时并发、限流和费用失控；
- 进程退出后不保留计时器、连接或后台任务。

如果 24 例 full eval 的总时间不可接受，可以在另一次评审中增加小并发，但必须先实现全局调用数、速率和成本预算；不能直接使用无上限 `Promise.all`。

## 21. 文档同步规则

第一版代码实施时：

- 必须更新本文的阶段状态和真实验证结果；
- 必须在 `README.md` 增加已可用的开发期命令和“不会进入小游戏运行时”的说明；
- 不修改 `docs/level-difficulty-system.md`，因为第一版只读取现有公式和阈值；若公式、阈值或解释发生变化则必须同步；
- 不修改 `docs/gameplay-extension-architecture.md`，因为第一版没有改变关卡／解答格式或运行时依赖；若以后增加新格式或运行时入口则必须同步；
- 不修改 Portal／冰封文档，因为第一版明确不支持这两种机制；
- 不修改 CloudBase、奖励、体力、主题、分包或发布文档，因为没有对应行为变化。

正式纳入候选时，应按实际目标同时更新 README、难度说明、关卡专题文档、数据测试和必要的云目录说明；不能只把 JSON 塞进目录。

## 22. 回滚策略

在第一版边界内，回滚应简单且不影响玩家：

1. 停止实时调用；
2. 移除 README 中 Copilot 开发命令；
3. 删除 `scripts/level-copilot/` 中已提交的工具代码与固定 fixture；
4. 删除对应 Copilot 测试注册与架构断言；
5. 删除 `.gitignore` 的 run 目录规则；
6. 本地 `runs/` 由用户决定保留或移入备份，不在未授权情况下删除；
7. 重新运行全量测试、包体检查和 `git diff --check`。

因为第一版不修改 `src/`、`core/`、`data/` 或云端，回滚不需要关卡迁移、存档迁移、玩家补偿或线上回退。

## 23. 扩展触发条件

### 23.1 何时考虑确定性生成器

若模型在完整路径覆盖上持续低于门槛，下一步不是删除验证，而是让模型只输出更高层设计意图，由本地确定性生成器负责构造路径。

只有满足以下任一条件才值得新增生成器：

- `valid_within_3_rate < 80%` 且主要失败是覆盖／相邻错误；
- token 或延迟成本明显高于可接受范围；
- 人工采纳率低但失败集中在可机械约束的布局问题；
- 需要批量枚举和稳定复现实验。

这会是新的算法模块和测试范围，不能塞入第一版的 `candidate.js`。

### 23.2 大棋盘扩展

普通 5×5／6×6 已达到 V1 门槛并积累人工审核数据，因此版本 8 已开放 7×7、8×8 和无镂空普通 8×10 的离线链路。新增尺寸仍需要独立重新测量：

- 响应长度和 token 上限；
- 搜索器 `limit` 比例；
- 难度 4—5 的命中率；
- 人工审核时间；
- 与现有 7×7／8×8 大目录的重复率。

在这些真实指标和人工审核完成前，只能声称“大棋盘离线合同与验证链路可用”，不能把 V1 的 5×5／6×6 通过率外推成大棋盘实用性结论。

### 23.3 何时考虑 Portal 或冰封

Portal 与冰封必须分别设计新合同：

- Portal 需要分段解答、入口／出口元数据和 `core/portal-validation.js`；
- 冰封需要共享格恰好两次、不同线路访问和 `ice@1` 合同；
- 两者都需要专属 prompt、Schema、错误码、fixture、评测集和文档同步；
- 不允许通过给 `mechanic` 放宽成任意字符串来“顺便支持”。

## 24. 实施者必须能解释的内容

完成第一版后，代码作者应能不依赖 AI 逐项解释：

1. 为什么模型输出完整路径而不是只输出端点；
2. JSON Schema 能保证什么，不能保证什么；
3. 为什么 `GameRunner` 回放是硬门禁；
4. 为什么搜索器的 `limit` 不能写成无解；
5. 为什么难度由本地评估器决定；
6. 如何忽略旋转、镜像、颜色顺序和端点方向查重；
7. 传输重试与候选重试为什么必须分开；
8. 为什么模型、密钥和运行产物不能进入小游戏包；
9. 人工 `accepted` 为什么仍不等于正式发布；
10. 每个指标的分母是什么，以及没有价格快照时为什么成本不是 0。

这十项既是代码评审清单，也是将该项目作为“AI + 游戏开发”作品展示时最有价值的工程说明。

## 25. 第一版离线实现检查表

- [x] 只修改第 14 节白名单文件。
- [x] 工作区原有未提交文件和改动全部保留。
- [x] `LevelBriefV1` 与 `CandidatePathCoverV1` 已固化并有边界测试。
- [x] 模型输出只包含完整路径与短说明。
- [x] 静态覆盖、编译、查重、Runner、搜索和难度门禁全部存在。
- [x] `store:false`、固定 host、显式模型、密钥不落盘均有测试。
- [x] 双重重试预算和 provider 总调用上限均有测试。
- [x] 只有 `openai-client.js` 能直接 HTTPS 联网，只有 `codex-client.js` 能启动本机 Codex CLI。
- [x] 只有 `run-store.js` 能写文件。
- [x] 所有运行产物只位于被忽略的 `scripts/level-copilot/runs/`。
- [x] 没有自动正式导入命令。
- [x] 普通测试入口在无 key、无网络环境下通过。
- [x] 包体检查证明 Copilot 未进入微信发布包。
- [x] 实时冒烟与 full eval 的证据和本地测试分开报告。
- [x] README 只描述已经真实实现的命令。
- [x] DevTools、真机、云端、上传和审核状态没有被本地证据夸大。
- [x] 使用选定 provider 完成修复后的真实单例冒烟。
- [x] 完成真实单例的真人审核记录。
- [x] 完成版本 4 的 6 例真实 smoke eval，并保留逐例 run 映射与批次指标。
- [x] 完成版本 4 smoke 候选真人审核并离线重算指标。
- [x] 完成版本 5 定量难度反馈修复、离线回归和第二轮 6 例真实 smoke eval。
- [x] 完成版本 5 smoke 候选真人审核并离线重算指标。
- [x] 使用本地合法路径森林搜索证明 6×6／4 色／难度 1 组合可达，并据此完成版本 7 容量感知提示修复与离线回归。
- [x] 完成版本 7 难度 1 的 5×5 与 6×6 定向真实复验，两例均一次命中目标等级并通过离线回放。
- [x] 完成版本 7 两个难度 1 定向候选的真人审核记录，两例均为 accepted。
- [x] 完成版本 7 当前 prompt 的 6 例真实 smoke，并保留逐例 run 映射与批次指标。
- [x] 完成版本 7 smoke 的 5 个候选真人审核并离线重算指标。
- [x] 完成版本 7 的 24/24 full eval，并保留逐例 run 映射与批次指标。
- [x] 完成版本 7 full 评测集的 22 个候选真人审核、离线重算和最终指标判定；开发期本地命令行工具 V1 已完成验收。
- [x] 完成版本 8 大棋盘固定 6 例真实 Codex smoke，并保留逐例 run 映射与批次指标。
- [x] 完成版本 8 smoke 的 5 个 reviewable 候选审核与离线重算。
- [x] 根据 smoke 审核结论确认版本 8 可以进入独立的 24 例 full eval 门禁。
- [x] 另行授权并完成版本 8 的 24 例 full eval、逐例映射和全部 reviewable 候选离线回放。
- [x] 审核版本 8 full eval 的 23 个 reviewable 候选，离线重算并完成最终指标判定。

## 26. 实施结果（2026-09-14）

### 26.1 已完成

- S0：brief／候选合同、完整覆盖语义、题面编译、正方形八种几何指纹、正式普通关查重、`GameRunner` 回放、精确求解审计和本地难度命中已经实现。
- S1：OpenAI Responses 客户端已按实施日官方文档核对并实现固定 `POST https://api.openai.com/v1/responses`、`store:false`、严格 `text.format` JSON Schema、60 秒超时、256 KiB 响应上限、状态／incomplete／refusal／usage 解析和安全错误分类。严格 Schema 的所有属性均为 required，短说明通过 `string | null` 表达；失败、refusal 与 incomplete 响应的 usage 会在抛错前保留。测试全部使用注入的假 transport。
- S2.1 Codex provider：已新增显式 `--provider codex`，通过已登录的 Codex CLI 运行结构化生成，不传模型、不读取或透传 API key／任意 provider key／代理／模型环境变量，不读取认证文件。每次生成从仓库外独立 `0700` 临时目录启动，真实 `HOME` 替换为该隔离目录，固定使用参数数组、`shell: false`、ephemeral、skip-git-check、ignore-user-config、ignore-rules、`--strict-config`、read-only sandbox，并显式禁用 AGENTS、用户技能、Apps、MCP、插件、hook、shell、浏览器／电脑操作、图像、memory、Web、subagent 与请求类工具。版本 4 保留 `code_mode` 主门禁但移除冗余 `code_mode_host` 子开关，并只压制启用 `skip_host_skill_discovery` 时已知的 CLI 不稳定功能提示；真正的 error item 仍失败关闭。正常完成时 JSONL 全量严格解析；超时、取消和输出超限时审计完整事件前缀后保留真实终止分类。复用的动态输出 Schema、受限最后消息文件、禁止活动、异常退出和清理均有假子进程反例，且失败时绝不回退 Responses。
- S2：run／attempt 单向状态、3 次候选、每候选最多 2 次传输、总计最多 5 次 provider 调用、60 秒单次上限、180 秒运行级硬期限、受控失败反馈、UUID 目录、秘密扫描、原子写入和离线重放已经实现。流水线把剩余时间与 AbortSignal 传给 Responses HTTPS 和 Codex 子进程，达到期限后等待请求／进程和计时器清理，再以 `RUN_TIME_BUDGET_EXHAUSTED` 落盘。不可覆盖 artifact 使用文件系统原子硬链接提交；两个进程并发审核时首份决定获胜，相同决定可幂等补齐，不同决定稳定冲突。重复候选会保留首份候选已经完成的 Schema／静态检查结果，不会把无效候选提升为结构有效。
- S2 难度闭环：版本 7／`copilot-prompt-v4` 将本地评分器的等级边界、精确普通关评分权重与优选区间作为固定数值合同，并在难度失败时回传经过白名单裁剪的整体及逐线路因子与调整方向。难度拒绝报告同时携带安全的 `layoutKey`，让下一候选既能定向增减复杂度，也能避开已经拒绝的端点布局。难度 1 的优选结构按棋盘容量分支：能由短线覆盖时优先均衡短线；面积超过 easy line 容量时，优先多条短直线加一条无竞争的剩余长线。评分器、候选预算和最终门禁均未放宽。
- S3 工具链：24 例 `eval-cases-v1` 与固定 6 例 smoke 子集、30／120 次容量门禁、`provider_response_rate`、Responses 专属 `api_response_rate`、`candidate_received_rate`、准确首候选指标分母、p50／p95、token、provider-aware 成本、逐例持久化 `eval.json`、审核后离线重算、README 命令和架构隔离门禁已经实现。Codex 订阅路径不估算美元费用；假客户端回归覆盖 24 例各使用 5 次调用仍完成 24/24。
- 运行时、正式关卡、解答、CloudBase、微信配置和发布状态均未修改；测试会对完整 `data/` 目录做运行前后 SHA-256 一致性检查。

### 26.2 本地验证

```text
node tests/run.js
104/104 组通过

node scripts/check-package-budget.js
主包 1.359 MiB / 1.60 MiB；总包 15.638 MiB / 18.00 MiB；通过

Copilot 离线 brief fixture
VALID

Copilot 离线完整候选 fixture
schema/staticRules/duplicate/runtime/difficulty 全部 passed；solver=solved；status=reviewable

Codex CLI 历史真实单例（隔离边界修复前，仅保留 artifact，不再是合格冒烟证据）
ChatGPT 登录已确认；未传 --model
runId=7821c412-d597-4e2f-bddb-c17a3e0fa7de
provider=codex-cli；model=null；status=AWAITING_REVIEW
candidateAttempts=1；providerCalls=1；httpCalls=0；candidateReceived=true
threadId=01a09b86-d16b-7452-a6c7-81eae07f79d2；turn=completed
input=22771；cached input=0；output=192；reasoning=101；total=22963 tokens
端到端延迟=16323 ms；provider 调用延迟=16311 ms
schema/staticRules/duplicate/runtime/difficulty 全部 passed；solver=solved
targetGrade=1；actualGrade=1；score=1.67；replay=reviewable
costAccounting=not_applicable_subscription；estimatedCostUsd=null
artifact 秘密扫描通过；未写 review；正式 data 哈希前后一致

Codex CLI 版本 3 真实诊断（不计作合格冒烟）
共执行 3 个单例 run，每个均为 providerCalls=1、httpCalls=0、turn=completed
runId=6a8dddb2-670d-4d63-852e-e171634584a1；total=7035 tokens；latency=14416 ms
runId=64a50ec3-9f8b-46b9-868b-6198d5a8bb42；total=7027 tokens；latency=13014 ms
runId=08fd3dd2-5ef7-4e80-a9d3-afa1c96eb829；total=7037 tokens；latency=12446 ms
三次均由 JSONL 白名单以 CODEX_FORBIDDEN_ACTIVITY 安全停止，没有回退 Responses
受控诊断确认 error item 只命中 skip_host_skill_discovery 不稳定功能提示与 code_mode/code_mode_host 冗余配置提示；消息正文未写入 artifact 或文档

Codex CLI 版本 4 配置提示兼容修复
保留技能发现与 code_mode 主门禁；只压制已知不稳定功能提示并移除冗余子开关
本机 --strict-config 配置解析通过；code_mode 主门禁、Apps、插件、shell 与技能搜索均为 false

Codex CLI 版本 4 真实单例（当前合格冒烟证据）
ChatGPT 登录已确认；未传 --model
runId=d48315e7-0403-40a2-8ef7-6699d232e361
provider=codex-cli；implementationVersion=4；model=null；生成后状态=AWAITING_REVIEW
candidateAttempts=1；providerCalls=1；httpCalls=0；candidateReceived=true
threadId=01a09f1c-84f4-7451-9d3c-a08736b36a8a；turn=completed
input=6891；cached input=0；output=136；reasoning=35；total=7027 tokens
端到端延迟=11268 ms；provider 调用延迟=11255 ms
schema/staticRules/duplicate/runtime/difficulty 全部 passed；solver=solved
targetGrade=1；actualGrade=1；score=1.67；replay=reviewable
costAccounting=not_applicable_subscription；estimatedCostUsd=null
artifact 均为 0600 且秘密扫描通过
正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb
真人审核：accepted；reason=null；decidedAt=2026-09-14T09:57:17.208Z；最终状态=ACCEPTED

Codex CLI 版本 4 的 6 例真实 smoke eval
evaluationId=3c98256b-f522-4c4f-a72d-f4a33ee9163e；status=COMPLETED
completed=6/6；providerCalls=15/30；项目直接 Responses HTTP 调用=0
provider_response_rate=1；api_response_rate=null；candidate_received_rate=1
schema_first_pass_rate=1；static_first_pass_rate=1；runtime_first_pass_rate=1；valid_within_3_rate=1
difficulty_hit_within_3_rate=0.5；reviewable_rate=0.5；unique_reviewable_rate=1
human_acceptance_rate=0.666667；reviewed=3；accepted=2
accepted：v1-5x5-02、v1-6x6-03；rejected：v1-6x6-02（reject_not_fun，解法过于条带化且缺少有效路线竞争）
failed：v1-5x5-01、v1-5x5-03、v1-6x6-01；15 个候选均通过 Schema、静态规则、GameRunner 与精确求解，失败只来自三候选内未命中目标难度
input=103801；cached input=5632；output=6817；reasoning=4880；total=110618 tokens
latency p50=51111.5 ms；p95=82644.5 ms；tokens_per_reviewable=36872.666667
costAccounting=not_applicable_subscription；estimatedCostUsd=null
评测目录与 6 个 run 共 31 份 JSON artifact 均为 0600，秘密扫描通过
正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb

Codex CLI 版本 5／copilot-prompt-v2 的 6 例真实 smoke eval
evaluationId=bcecd42f-7c61-4986-847c-c898ba8eacf9；status=COMPLETED
completed=6/6；providerCalls=14/30；项目直接 Responses HTTP 调用=0
provider_response_rate=1；api_response_rate=null；candidate_received_rate=1
schema_first_pass_rate=1；static_first_pass_rate=1；runtime_first_pass_rate=1；valid_within_3_rate=1
difficulty_hit_within_3_rate=0.666667；reviewable_rate=0.666667；unique_reviewable_rate=1
human_acceptance_rate=0.75；reviewed=4；accepted=3
accepted：v1-5x5-02、v1-6x6-02、v1-6x6-03；rejected：v1-5x5-03（reject_intent_mismatch，路线竞争为 0 且相邻端点过多）
failed：v1-5x5-01 为 CANDIDATE_BUDGET_EXHAUSTED；v1-6x6-01 为 RUN_TIME_BUDGET_EXHAUSTED
难度 1 两例均失败；5×5 的反馈把分数从 35.26 降至 23.06 但未进入低于 20 的区间，6×6 在第三候选传输阶段达到 180 秒硬期限
input=92413；cached input=16896；output=11339；reasoning=9776；total=103752 tokens
latency p50=86154.5 ms；p95=167958.25 ms；tokens_per_reviewable=25938
costAccounting=not_applicable_subscription；estimatedCostUsd=null
相对版本 4：难度命中率由 50% 升至 66.7%，reviewable 从 3 增至 4，providerCalls 从 15 降至 14，总 token 从 110618 降至 103752；但 p50／p95 延迟明显升高，难度 1 仍是系统性风险
评测目录与 6 个 run 在审核后共 34 份 JSON artifact，均为 0600，秘密扫描通过
正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb

版本 6／copilot-prompt-v3 难度 1 定向真实诊断（不计作当前合格复验）
5×5 runId=66d51ecd-96cf-4a69-badc-e78823be7043；两次传输均触发 CODEX_EXEC_TIMEOUT；没有候选或 usage，无法判断难度
6×6 runId=fded1d61-3cd5-466d-8816-25d18c6d2d23；首候选通过 Schema、静态、GameRunner 与求解器，但 score=25.03／grade=2；后续传输达到 RUN_TIME_BUDGET_EXHAUSTED
首候选已达到 easyLines=3，但“所有线路零绕行”的版本 6 偏好与 36 格／4 色容量冲突，促使模型把 12 格剩余长线做成高绕行路径
两次 run 均未回退 Responses；正式 data 哈希不变

版本 7／copilot-prompt-v4 离线难度 1 修复
本地随机合法路径森林加路径边交换搜索找到 6×6／4 色／4 条路径的 score=19.90／grade=1 反例，证明固定评测组合可达，不应删改评测用例或放宽 20 分边界
可达结构指标：easyLines=3；lengths=6,18,6,6；detourRate=0.31；bendsPerLine=1；competingColors=0
当前提示改为精确评分公式与容量感知策略：三条短直 easy line，一条承担剩余空间的长线，并优先消除端点最短路竞争
104/104 组离线测试通过；新增固定反例会以真实 Validator、GameRunner、求解器和难度评分器证明该组合仍为 reviewable／19.90 分

Codex CLI 版本 7／copilot-prompt-v4 难度 1 定向真实复验
ChatGPT 登录已确认；两个 run 均未传 --model；项目直接 Responses HTTP 调用=0
5×5 runId=f31d4486-bb5b-48d9-80c7-1abadeffabdc；candidateAttempts=1；providerCalls=1；score=17.42／grade=1；easyLines=3；lengths=5,5,5,10；端到端约 51.0 秒；total=8426 tokens
6×6 runId=83f1bdf9-4eac-45fb-a7af-700340367f7d；candidateAttempts=1；providerCalls=1；score=19.90／grade=1；easyLines=3；lengths=6,6,6,18；端到端约 46.9 秒；total=8283 tokens
两例 Schema、静态规则、对称查重、GameRunner、精确求解器和难度门禁均通过，离线 replay 均为 reviewable；没有触发修复重试或运行级期限
两例真人审核均为 accepted：5×5 的理由为“符合难度1入门恢复题意图，起手清晰”；6×6 的理由为“符合六乘六入门题意图，大部分空间可直接理解”
两个 run 在审核后共 10 份 JSON artifact，均为 0600，秘密扫描通过；正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb
审核只表示保留候选，不会导入正式关卡；定向成功只证明难度 1 生成链路恢复，不能代替当前 prompt 的 smoke 指标

Codex CLI 版本 7／copilot-prompt-v4 的 6 例真实 smoke eval
evaluationId=0477eb0c-2346-4e21-b404-4a6d297802ff；status=COMPLETED
completed=6/6；providerCalls=10/30；项目直接 Responses HTTP 调用=0
provider_response_rate=1；api_response_rate=null；candidate_received_rate=1
schema_first_pass_rate=1；static_first_pass_rate=1；runtime_first_pass_rate=1；valid_within_3_rate=1
difficulty_hit_within_3_rate=0.833333；reviewable_rate=0.833333；unique_reviewable_rate=1
reviewable：v1-5x5-01、v1-5x5-02、v1-6x6-01、v1-6x6-02、v1-6x6-03；五例离线 replay 均保持 reviewable
failed：v1-5x5-03；首候选通过结构、静态、GameRunner 与求解器但 score=28.84／grade=2 低于目标 3，后续两次传输均触发 CODEX_EXEC_TIMEOUT，最终按预算失败
真人审核：reviewed=5；accepted=3；human_acceptance_rate=0.6
accepted：v1-5x5-01、v1-5x5-02、v1-6x6-01
rejected：v1-6x6-02、v1-6x6-03；均为 reject_intent_mismatch，前者端点过度成排且求解路径与生成路径差异较大，后者要求多条竞争路线但 competingColors=0 且端点高度相邻
两道难度 1 用例均用一次 provider 调用命中；版本 5 中两例全部失败的系统性问题在本轮未复现
input=50680；cached input=5632；output=6848；reasoning=6034；total=57528 tokens
latency p50=48956 ms；p95=156397.25 ms；tokens_per_reviewable=11505.6
costAccounting=not_applicable_subscription；estimatedCostUsd=null
相对版本 5：难度命中率与 reviewable rate 从 66.7% 升至 83.3%，providerCalls 从 14 降至 10，总 token 从 103752 降至 57528，p50 从 86154.5 ms 降至 48956 ms；但一次三调用超时失败使 p95 仍达到 156397.25 ms
评测目录与 6 个 run 在审核后共 31 份 JSON artifact，均为 0600，秘密扫描通过；审核后离线重算完成
正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb

Codex CLI 版本 7／copilot-prompt-v4 的 24 例真实 full eval
evaluationId=ffea8248-66a0-4260-9686-36310024e1bc；status=COMPLETED
completed=24/24；providerCalls=41/120；项目直接 Responses HTTP 调用=0；总耗时约 30 分 23 秒
provider_response_rate=1；api_response_rate=null；candidate_received_rate=1
schema_first_pass_rate=1；static_first_pass_rate=1；runtime_first_pass_rate=1；valid_within_3_rate=1
difficulty_hit_within_3_rate=0.916667；reviewable_rate=0.916667；unique_reviewable_rate=0.909091
reviewable=22；22 例离线 replay 均保持 reviewable；uniqueReviewable=20
重复布局有两组：v1-5x5-01 与 v1-5x5-10；v1-6x6-01 与 v1-6x6-10。批内重复不会反向改变单例状态，但会降低 unique_reviewable_rate
failed=2：v1-5x5-03 的前两候选分别为 grade 1／2，第三候选达到 180 秒总期限后以 RUN_TIME_BUDGET_EXHAUSTED 停止；v1-5x5-12 的首候选为 grade 2，后续两次传输超时并以 CODEX_EXEC_TIMEOUT 停止
两个失败 run 的已接收候选都通过 Schema、静态规则、GameRunner 与精确求解器，没有客户端解析错误或验证器矛盾
input=217728；cached input=107008；output=26951；reasoning=23333；total=244679 tokens
latency p50=61966.5 ms；p95=167663.05 ms；tokens_per_reviewable=11121.772727
costAccounting=not_applicable_subscription；estimatedCostUsd=null
真人审核与最终离线重算：reviewed=22；accepted=13；rejected=9；human_acceptance_rate=0.590909
5×5 accepted：v1-5x5-01、v1-5x5-02、v1-5x5-04、v1-5x5-05、v1-5x5-06、v1-5x5-07、v1-5x5-09、v1-5x5-11
5×5 rejected：v1-5x5-08（reject_intent_mismatch）、v1-5x5-10（reject_too_similar）
6×6 accepted：v1-6x6-01、v1-6x6-05、v1-6x6-06、v1-6x6-07、v1-6x6-09
6×6 rejected：v1-6x6-02、v1-6x6-03、v1-6x6-08、v1-6x6-11、v1-6x6-12（reject_intent_mismatch）；v1-6x6-04、v1-6x6-10（reject_too_similar）
审核后 22 个候选离线 replay 全部保持 reviewable；评测目录与 24 个 run 共 125 份 JSON artifact，均为 0600，秘密扫描无命中
最终指标判定：valid_within_3_rate=100%（门槛 80%）；difficulty_hit_within_3_rate=91.67%（门槛 60%）；human_acceptance_rate=59.09%（门槛 30%）；reviewable 候选静态与运行时误放行、正式数据写入和秘密泄漏均为 0；没有未解释的客户端解析错误或验证器矛盾
正式 data 运行前后哈希一致：4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb

git diff --check
通过
```

### 26.3 V1 验收结论与未扩展边界

- 版本 3 的三个真实诊断 run 只作为安全拦截历史证据；版本 4 单例与首轮 smoke、版本 5 第二轮 smoke 及其全部候选审核均已完成。旧版本 artifact 均原样保留，不能混作同一 prompt 版本的指标。
- 版本 7 full eval 已完成 24/24，22 个 reviewable 候选已经全部真人审核并离线重算；`valid_within_3_rate=100%`、`difficulty_hit_within_3_rate=91.7%`、`human_acceptance_rate=59.1%` 均高于第 13.5 节建议门槛，且没有客户端解析错误、验证器矛盾、正式数据写入或秘密泄漏。两例失败原因已经归入目标难度未命中后发生的 provider 超时／运行总期限；p95 接近 180 秒上限与两组批内重复仍是后续优化信号，但不违反 V1 门槛。开发期本地命令行工具 V1 验收完成。
- 第一版没有修改小游戏运行包或玩法，按第 21 节边界无需为 Copilot 执行真机玩法验收；微信开发者工具、真机、CloudBase、上传和平台审核状态仍未执行，也不由本地 CLI 验收结论覆盖。
- S4 正式关卡纳入仍未授权，也没有实现 `publish`、`apply`、`append` 或 `sync` 命令。

## 27. 版本 8 大棋盘扩展（2026-09-14—2026-09-15）

### 27.1 当前能力

- `LevelBriefV1` 的尺寸白名单扩展为 `5×5`、`6×6`、`7×7`、`8×8`、`8×10`；颜色数为 `4—10`，目标难度仍为 `1—3`。
- `8×10` 固定解释为 `width=8`、`height=10` 的无镂空普通题；不接受转置的 `10×8`、任意 `8×9`，也不接收每日挑战的 `Blocked`／镂空合同。
- 正方形继续用完整 8 种二面体变换查重；矩形只用保持 `8×10` 尺寸的 4 种变换，端点方向与颜色编号仍被归一化。
- `GameRunner` 继续作为真实规则回放权威。作者用精确求解器只额外开放 `8×10`，前沿宽度仍不超过 8、默认状态上限仍为 250,000；达到上限只记录 `SOLVER_INCONCLUSIVE`，不谎报无解。
- 难度评估器额外接收普通 `8×10`，不扩大 Portal／冰封的尺寸合同。
- `copilot-prompt-v5` 明确 row-major 编号与矩形行边界，把失败反馈从最多 6 条线路扩到最多 10 条；Responses 仅对大于 36 格的棋盘把 `max_output_tokens` 从 2048 提高到 4096，5×5／6×6 保持原值，256 KiB 响应／事件硬上限、调用次数和时间预算均不变。
- 新增 `eval-cases-large-v1.json`：7×7、8×8、8×10 各 8 例，固定 smoke 为每种尺寸 2 例。原 `eval-cases-v1` 与 V1 指标原样保留。

### 27.2 严格代码边界

本扩展只允许修改：

- `scripts/level-copilot/contracts.js`、`candidate.js`、`prompt.js`、`openai-client.js`、`pipeline.js`、`eval.js`；
- `scripts/level-copilot/run-store.js`，仅用于把本地 run／evaluation 目录固定为 `0700` 并补充对应安全回归；
- 新增 `scripts/level-copilot/eval-cases-large-v1.json`；
- Copilot 对应测试，以及为 8×10 放开作者能力所必需的 `scripts/solve-no-portal.js`、`scripts/evaluate-level-difficulty.js` 和难度测试；
- `README.md`、本实施方案、V1 作品集报告的历史范围提示和难度专题文档。

禁止修改 `src/**`、`core/**`、`data/**`、CloudBase、微信配置和发布状态。禁止新增自动导入、镂空每日题、Portal、冰封、目标难度 4—5 或小游戏内 AI。

### 27.3 离线与真实 smoke 证据

- 手写行覆盖 fixture 已分别贯穿 7×7、8×8、8×10 的合同、静态覆盖、`GameRunner`、精确求解、难度评估和布局指纹；求解状态数分别为 50、65、81，均为 `solved`。
- 已对当前目录 166 个正方形题面比较版本 7 与版本 8 的布局指纹，漂移为 0。
- 两套固定评测集均能加载为 24 例 full／6 例 smoke，caseVersion 独立。
- 真实 Codex smoke：`evaluationId=74ce757e-0f8c-4ad9-9515-ad0d2965930a`，`status=COMPLETED`，6/6 例均留下 run 映射，实际使用 7/30 次 provider 调用，项目直接 Responses HTTP 调用为 0，总耗时约 5 分 25 秒。
- 5/6 例达到 `AWAITING_REVIEW`，分别覆盖 1 个 7×7、2 个 8×8 和 2 个 8×10；5 个候选的 Schema、静态规则、正式目录查重、`GameRunner`、精确求解器与目标难度均通过，离线 replay 全部保持 `reviewable`。
- 余下 `large-v1-7x7-02` 未收到候选：两次 Codex 传输达到单次超时，run 以 `CODEX_EXEC_TIMEOUT` 失败；这不是 Schema、规则、求解器或难度拒绝。
- 审核结果：5/5 已记录；接受 `large-v1-7x7-01`、`large-v1-8x8-02`、`large-v1-8x10-02`；拒绝 `large-v1-8x8-01`（`reject_intent_mismatch`，相邻端点暗示错误直连）和 `large-v1-8x10-01`（`reject_not_fun`，十条相同横线只有重复操作）。离线重算后的 `human_acceptance_rate=60%`。
- 最终 smoke 指标：`candidate_received_rate=83.33%`、`valid_within_3_rate=83.33%`、`difficulty_hit_within_3_rate=83.33%`、`reviewable_rate=83.33%`、`unique_reviewable_rate=100%`；p50 为 47.189 秒，p95 为 105.038 秒，总 token 41,005，Codex 订阅路径不估算美元成本。
- smoke 后安全复核发现 run／evaluation 目录沿用系统缺省 `0755`；`run-store.js` 已修复为根目录和子目录统一 `0700`、历史目录访问时自动收紧。审核后 5 个候选离线 replay 全部保持 `reviewable`；评测目录与 6 个 run 共 29 份 JSON artifact 均为 `0600`，秘密扫描无命中。该修复不改变候选、验证门禁或批次指标。
- 正式 `data/` 没有工作区差异；`src/**`、`core/**`、CloudBase、微信配置和发布状态均未修改。

版本 8 的 smoke 已证明三种新增尺寸都能由真实 Codex 生成并通过确定性门禁，5 个 reviewable 候选也已完成审核和离线重算。机器门禁命中率 83.33%、人工采纳率 60%，为后续 24 例 full eval 提供了继续依据；full eval 的独立证据与剩余审核门禁见下一节。

### 27.4 24 例 full eval、候选审核与最终判定

- 真实 Codex full eval：`evaluationId=d5628d62-b6f0-4053-bc34-caf04578c144`，`status=COMPLETED`，24/24 例均留下 run 映射，实际使用 36/120 次 provider 调用，项目直接 Responses HTTP 调用为 0，总耗时约 24 分 24 秒。
- 尺寸分组：7×7 为 8/8 reviewable、15 次调用；8×8 为 7/8 reviewable、12 次调用；8×10 为 8/8 reviewable、9 次调用。合计 23 个 reviewable 候选，全部离线 replay 后仍为 `reviewable`。
- 唯一失败是 `large-v1-8x8-06`：前两个候选均通过 Schema、静态规则、`GameRunner` 和精确求解器，但实际难度仍为 2、低于目标 3；第三候选在 180 秒总预算末端取消，run 以 `RUN_TIME_BUDGET_EXHAUSTED` 失败。没有客户端解析错误或验证器矛盾。
- 自动指标：`provider_response_rate=100%`、`candidate_received_rate=100%`、首候选 Schema／静态／运行时通过率均为 100%、`valid_within_3_rate=100%`、`difficulty_hit_within_3_rate=95.83%`、`reviewable_rate=95.83%`。
- 23 个 reviewable 中有 22 个唯一布局，`unique_reviewable_rate=95.65%`；`large-v1-8x10-01` 与 `large-v1-8x10-04` 产生同一条带式布局。批内重复没有反向覆盖单 run 状态；审核时前者因只有重复操作被拒绝，后者再以 `reject_too_similar` 拒绝。
- 性能与用量：p50 为 42.146 秒，p95 为 174.742 秒；input 211,986、cached input 50,688、output 27,037、reasoning 21,383、total 239,023 tokens；`tokens_per_reviewable=10,392.30`。Codex 订阅路径不估算美元成本。
- 23 个 reviewable 候选已经逐例审核并通过既有 `caseId → runId` 清单离线重算：接受 13 例、拒绝 10 例，`human_acceptance_rate=56.52%`。分尺寸为 7×7 接受 5/8（62.50%）、8×8 接受 5/7（71.43%）、8×10 接受 3/8（37.50%）；分目标难度为难度 1 接受 3/6（50.00%）、难度 2 接受 8/9（88.89%）、难度 3 接受 2/8（25.00%）。
- 拒绝原因包括 7 个 `reject_intent_mismatch`、1 个 `reject_not_fun`、1 个 `reject_too_similar` 和 1 个 `reject_confusing`。主要软质量问题是相邻端点被迫长绕行、独立矩形折返被评分成高难规划，以及 8×10 的条带化重复；这些候选都通过硬门禁，说明人工审核不能由难度分数替代。
- 审核后评测目录与 24 个 run 共 25 个目录、125 份 JSON artifact，目录均为 `0700`、文件均为 `0600`，秘密扫描无命中，仓库外 Codex 临时目录无残留。23 个候选再次离线 replay 后均保持 `reviewable`；正式 `data/` 哈希仍为 `4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb`。

版本 8 的总体指标达到第 13.5 节建议门槛：`valid_within_3_rate=100%`（门槛 80%）、`difficulty_hit_within_3_rate=95.83%`（门槛 60%）、`human_acceptance_rate=56.52%`（门槛 30%），且 reviewable 候选静态与运行时误放行、正式数据写入和秘密泄漏均为 0。因此大棋盘扩展的本地模型实用性验收通过。这个结论不等于 13 个候选已进入正式主线，也不覆盖小游戏运行时、真机、CloudBase、上传或发布验收；若继续优化，应优先针对难度 3 的相邻端点长绕行、8×10 条带化和批内多样性建立机械反馈，再重新运行独立版本评测。

## 28. 版本 9—15 双门 Portal 难度扩展（2026-09-15）

### 28.1 输入与候选合同

- `LevelBriefV1.mechanic` 现在只允许 `ordinary` 或 `portal`。ordinary 保持版本 8 的尺寸、颜色与 1—3 级合同；Portal 只接受 5×5、6×6、7×7、8×8 正方形和 2—5 级，不接受 Portal 8×10。
- Portal 颜色数仍在 4—10 内，并额外要求 `colorCount × 4 <= width × height`，保证每条线路至少 4 格的硬门槛有容量可达。
- Portal provider 输出的是连续 seed：顶层仍只有 `schemaVersion`、`paths`、`designSummary`，路径数精确为最终 `colorCount - 1`，每条 path 只有一个 `cells` 数组。这样模型只解决普通完整覆盖，不自行选择门或证明旁路。
- 本地扩展器在一条足够长的 seed path 上枚举两个内部切点；前缀与后缀组成唯一双段 Portal 路径，中间连续部分成为新增普通路径。最终双段路径的第一段末格和第二段首格是两个非相邻门格，两个门格只能出现在这两个边界。
- seed 与最终候选都要求全部格恰好覆盖一次、连续段四邻接；最终每条扁平线路 4 格起、最多占棋盘 35%，所有线路端点不相邻。未切分 seed 路径同样不能超过 35%；唯一待切分路径可以更长，但 Portal 前后缀合计与中间新增线路必须分别满足最终上限。无可行切点返回 `CANDIDATE_PORTAL_SEED_UNSPLITTABLE`，不会截断或补造模型数组。
- 模型不输出门格、`PortalId`、`Exit`、`Mechanic`、规则版本、正式 ID 或难度。本地编译器固定生成一个 `{ Id: "P1", Cells: [...] }` 的 `portal@2` 网络，并在唯一分段边界插入一次 `Exit`。

### 28.2 确定性门禁

1. 结构与覆盖校验通过后，使用现有 `core/portal-validation.js` 对编译题面和分段解答做 required-solution 校验；Copilot 不复制 Portal 状态机。
2. 等价查重把端点对与门格集合共同纳入正方形八种变换，忽略颜色编号、路径方向、门格顺序和内部 P1 名称；只与正式 Portal 题比较，ordinary 指纹保持版本 8 不变。
3. `GameRunner` 按每段真实执行。入口段 `touchEnd` 必须进入等待续接而不能错误宣告完成，最后一段才允许完成该颜色，最终必须为 `WON` 且剩余格为 0。
4. 无门求解器先把两个门格视为不可走格：`unsatisfiable` 分类为 `required`；若找到无门解，则固定官方解的其余颜色，分别只放开 Portal 线、或 Portal 线加任意一色再次精确搜索。任一局部搜索可解即返回 `PORTAL_BYPASS_TOO_CHEAP`；全部不可解才分类为 `optional_complex`。
5. 主搜索或局部搜索达到 250,000 状态上限时返回 `PORTAL_BYPASS_INCONCLUSIVE` 并拒绝候选，不能把超限当成无解。求解器结构异常仍是不可重试的 `SOLVER_INVALID`。
6. 最后复用 `scripts/evaluate-level-difficulty.js` 的五项既有公式。双门机制项基线为 6 分，目标必须精确命中 2—5 级；门距不进入难度公式。
7. 5 级 seed 若直接切分无法同时命中等级与旁路门禁，可在两条连续路径存在合法双连接时交换尾段。搜索固定为深度 5、beam 100、最多 1600 个 seed、最多 20 秒和 12 次完整门禁验证；每个变体重新做覆盖与切分检查，命中后仍执行本节全部门禁，并在报告中持久化方法、深度和评估数量。达到任一上限仍没有合格候选时，只返回原有可重试失败，不把优化未命中当成通过。

### 28.3 Prompt、评测与边界

- 当前实现为 `implementationVersion=15`、`copilot-prompt-v10`；普通 prompt 约束保持兼容，Portal 分支要求少一色的连续 seed。4 级同时提示路径与空间竞争信号；5 级只提供按面积和颜色数动态求和的长度轮廓，避免让模型自行证明难度，切点、一次跳转、线路长度、非相邻端点、必要性和五级分数均由本地代码决定。
- 版本 9／`copilot-prompt-v6` 的首轮 6 例直接分段诊断在 ordinary 的 60 秒单次预算内全部超时、候选接收率为 0。把 Portal 单次上限提高到 120 秒后，已有候选可在约 69—78 秒返回，但仍有 run 达到 180 秒总期限。版本 10 因此不继续抬高时限，而是把模型任务缩为连续 seed；ordinary 仍为 60 秒、Portal 单次 120 秒、run 总预算仍为 180 秒。请求端同时取机制上限、run 剩余时间和 client 上限的最小值，取消与清理合同不变。
- Responses 动态 Schema 名称区分 ordinary／Portal；8×8 Portal seed 的 cells 同样使用 4096 output token 上限。Codex provider 继续复用同一严格 Schema 与既有隔离边界。
- 新增不可与旧批次混算的 `eval-cases-portal-v1.json`：24 例均为 8×8 双门题，2、3、4、5 级各 6 例，固定 6 例 smoke 覆盖四个等级。实时评测仍需显式 `--live --provider codex` 和 30／120 次最坏调用预算。
- 版本 15 仍没有自动正式导入。`accepted` 只保留本地候选；不修改 `src/**`、`core/**`、`data/**`、CloudBase、微信配置、玩家数据、上传或发布状态。
- 当前离线反例覆盖正式 2 级 required、4 级 required 和 5 级 optional-complex 锚点、24 格长 seed 的安全切分、需要五层重连才能从低分／廉价旁路恢复的 5 级 seed，以及非法门格、多条分段路径、Portal 校验失败、廉价旁路、求解超限和求解器异常。
- 版本 15 固定真实 Codex smoke：`evaluationId=e6ffe001-4881-417a-b759-f03174cc74e3`，6/6 均为 `AWAITING_REVIEW`，共 9 次 provider 调用；`candidate_received_rate`、首候选 Schema／静态／运行时通过率、`valid_within_3_rate`、`difficulty_hit_within_3_rate`、`reviewable_rate` 和 `unique_reviewable_rate` 均为 100%。总 token 89,632，p50 为 107.928 秒、p95 为 174.148 秒。5 级样本为 78.20 分、`required`，有界重连深度 4、评估 1047 个 seed。
- 版本 15 独立 full：`evaluationId=6a998adc-e112-487e-97b2-c40e6b2f9459`，24/24 均留下 run 映射，共 26 次 provider 调用；23 例收到候选并进入审核，唯一失败为 `RUN_TIME_BUDGET_EXHAUSTED`。`candidate_received_rate`、`valid_within_3_rate`、`difficulty_hit_within_3_rate` 和 `reviewable_rate` 均为 95.83%，候选分母内首候选 Schema／静态／运行时通过率均为 100%；23 个候选有 22 个唯一布局，`unique_reviewable_rate=95.65%`。2、3、4 级各 6/6，5 级 5/6；总 token 230,198，p50 为 60.284 秒、p95 为 163.112 秒，Codex 订阅路径不估算美元成本。
- full 中唯一超时的 `portal-v1-g5-05` 随后使用相同 brief 做一次定向复验：`runId=cc096f5e-4b63-4366-92fd-4e933b2bf89b`，1 次调用进入审核，得分 76.44、分类 `required`，有界重连深度 3、评估 113 个 seed。这证明 6 色 5 级合同可达，但不能回填或改写已完成 full 的 95.83% 指标。
- full 中 `portal-v1-g5-04` 与 `portal-v1-g5-06` 的模型路径相同，仅摘要不同，本地得到相同 layout；批次指标因此诚实保留 22/23 唯一率。23 个候选的人工审核与正式纳入仍须作为独立证据记录，不能沿用机器门禁或版本 7、8 指标。
- full 的 23 个候选使用当前代码逐个离线 replay 后仍全部为 `reviewable` 且 layoutKey 不变。当前 smoke、full、定向复验及关联 run 共检查 34 个目录、133 份 artifact：目录均为 `0700`、文件均为 `0600`，秘密扫描无命中，仓库外 Codex 临时目录无残留；正式 `data/` 哈希保持 `4413a6ef66f634a3ceaebdb56b203537f5c5be393cec44c4fe76608c2cd87aeb`。
