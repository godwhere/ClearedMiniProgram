<p align="center">
  <img src="assets/logo.png" width="160" alt="Cleared Logo">
</p>

# Cleared · 清空每一格

Cleared 是一款连线填格益智游戏：连接颜色相同的两个端点，并让所有格子都被合法路径覆盖。

项目使用原生微信小游戏实现，并加入 Portal、冰封格、每日挑战、体力、提示、奖励、主题、分包加载和 CloudBase 存档等完整功能。客户端使用 CommonJS JavaScript 和单 Canvas 2D，不依赖 Cocos、Unity、DOM 或 npm 运行依赖。

> 项目尚未正式上线。主线关卡会持续更新，目前已收录 168 关，客户端与现有 CloudBase 关卡目录已经对齐；最新关卡仍需完成微信开发者工具、真机和上传审核验证。

## 玩法介绍

- 从一个彩色端点开始，只能上下左右经过相邻格子，连接到同色的另一个端点。
- 路径不能穿过其他端点或已经占用的格子；拖回本次路径中的旧格可以回退。
- 一条路径连接成功后会淡出，但经过的格子仍算被占用。
- 所有格子都被合法路径覆盖时过关；如果端点已经全部连接但还有空格，则本关失败。
- 游玩中可以撤销、重置或查看提示，已完成关卡会记录最快通关时间。

项目还包含两种扩展机制：

- **Portal**：路径进入传送门后暂停，松手并从同一网络中的另一个出口继续。入口、出口、分段手势、撤销和提示都由同一套规则状态维护。
- **冰封格**：第一次经过只会破冰，第二次经过才真正占用地板；关卡仍需覆盖全部可走格才能完成。

## 项目内容

| 部分 | 当前内容 |
| --- | --- |
| 主线关卡 | 持续更新，目前已收录 168 关，从教学小棋盘逐步扩展到 8×8；当前目录包含 129 个普通题、26 个 Portal 题和 13 个冰封题 |
| 难度节奏 | 每关有 1—5 级设计难度；高难关后安排恢复题，并通过固定顺序保持旧关卡 ID 和存档兼容 |
| 每日挑战 | 每天两小关：3×3 热身和 8×10 镂空挑战；使用独立次数、日期和进度域 |
| 成长系统 | 顺序解锁、最佳时间、体力恢复与快通返还、分级提示、首次通关奖励和永久解锁 |
| 外观与声音 | 经典主题加 10 套可选主题、两种消除效果、本地 BGM 与操作音效 |
| 账号与存档 | 本地存档、CloudBase 身份和云同步、跨设备体力与偏好、失败重试和冲突保护 |
| 发布适配 | 安全区和受控 DPR、主题普通分包、主包预算检查、开发者工具与正式包配置隔离 |

主题素材按需下载。主包只保留经典主题和轻量预览，因此主题加载失败不会阻断启动和游玩；成功加载后才会切换并保存选择。

## 技术结构

实际入口是 `game.js -> src/bootstrap.js -> src/app.js`。`bootstrap` 只负责创建并注入依赖，`app` 负责场景和结算编排，规则、输入、渲染、平台和存档各自有明确边界。

```text
game.js
└── src/bootstrap.js                 组合根与环境配置
    └── src/app.js                   场景、反馈和结算编排
        ├── src/gameplay/            关卡上下文、输入控制和完成策略
        ├── src/services/            进度、体力、奖励、提示、同步等领域服务
        ├── src/ui/                  Canvas 场景和纯棋盘 ViewModel 渲染
        ├── src/platform/wechat.js   微信 API 的唯一适配边界
        └── core/                    不依赖 wx、Canvas 或存档的纯规则

data/                                关卡、解答、难度和每日题面
src/mechanics/                       Portal、冰封等 data-only 机制声明
src/skins/ 与 src/effects/           只影响表现的主题和消除效果声明
assets/                              Logo、音频、图标、预览与主题精灵表
tests/                               规则、服务、渲染、同步和启动回归测试
```

几个重要的实现约束：

- `core/game-runner.js` 是棋盘状态和规则权威，只返回结构化手势结果与只读查询，不读取 Canvas 或微信 API。
- 关卡来源和棋盘机制分开表达。普通主线、每日挑战与试玩决定进度和结算；Portal、冰封只决定规则与展示。
- Renderer 只消费 ViewModel，输入控制器只把触摸转换成棋盘坐标，二者都不复制胜负判断。
- 存档 key、关卡 ID 和机制版本保持稳定；奖励、体力和云端操作使用去重记录，保存失败不会先行发奖或破坏内存状态。
- 原始关卡保存在 JSON 中，提交到小游戏的是生成后的 JavaScript 模块；发布测试会回放正式解答并校验目录、难度和兼容关系。
- `pages/` 及根目录旧小程序文件只是迁移参考，已从小游戏包中排除。

更完整的依赖方向和扩展规则见 [玩法拓展架构](docs/gameplay-extension-architecture.md)。

## 本地运行

项目没有常规构建步骤，可以直接导入微信开发者工具：

1. 打开微信开发者工具并选择“导入项目”。
2. 选择本仓库根目录，项目类型为小游戏。
3. 若使用其他微信账号，在 `project.config.json` 中换成对应的小游戏 AppID。
4. 点击编译即可运行。

开发者工具模拟器会开放全部主线关卡，方便检查内容；真机和上传包仍按正常顺序解锁。具体差异见 [开发者工具说明](docs/dev-tools.md)。

## 验证

Node.js 只用于测试和离线工具，不是小游戏运行依赖。

```sh
node tests/run.js
node scripts/validate-theme-assets.js
node scripts/validate-gallery-previews.js
node scripts/check-package-budget.js
git diff --check
```

当前测试入口包含 93 组回归测试，覆盖棋盘规则、Portal 与冰封回放、现有 168 关目录数据、触摸采样、Canvas 渲染、进度与体力、奖励去重、主题分包、CloudBase 配置选择、同步冲突和小游戏启动烟雾流程。

修改 `data/clearedset*.json` 后，需要运行下面的命令更新提交到工程中的关卡模块：

```sh
node scripts/generate-level-modules.js
```

自动化测试不能代替微信开发者工具的包体分析，也不能代替 Android/iOS 真机上的触控、视觉、音频、弱网、前后台和跨设备验证。

## 当前联网方式

当前候选配置使用“本地保存 + 低频批量云结算”：游玩结果先可靠写入本机，金币到账和货币购买仍由云端确认；同步在启动、回到首页、进入账号页、前后台切换或待办达到阈值时按冷却规则触发，不使用定时轮询。

“本地直接结算 + 偶尔上传一份最新云备份”的历史兼容代码和测试仍保留，但 `game.js -> bootstrap.start()` 正常入口已不再加载、创建或注入该备份服务，所有运行环境的配置解析也固定关闭该入口；后端备份开关保持关闭。当前行为、恢复和冲突边界见 [CloudBase 联网模式](docs/cloudbase-local-first-sync.md)，本次入口收敛见 [单方案结算实施记录](docs/single-mode-settlement-plan.md)。

广告位、资料授权和部分分享奖励也保持默认关闭，需要真实平台配置和单独验收后才能启用。

## 相关文档

- [玩法拓展架构](docs/gameplay-extension-architecture.md)：规则层、输入、提示、渲染和结算的职责边界。
- [Portal 机制](docs/portal-mechanic.md)：传送门状态机、分段手势、数据与解答格式。
- [冰封玩法](docs/ice-trial.md)：两层地板规则、提示流程及主线接入边界。
- [关卡难度系统](docs/level-difficulty-system.md)：评分方法、排序规则和舒缓关节奏。
- [每日挑战](docs/daily-challenge-mode.md)：日期、次数、镂空棋盘和独立存档。
- [体力系统](docs/stamina-system.md)：消费、恢复、返还、回滚和跨设备规则。
- [主题系统](docs/theme-system.md)：主题 manifest、精灵表、画廊和异常回退。
- [分包方案](docs/package-splitting.md)：主包预算、主题下载和失败重试。
- [CloudBase 接入计划](docs/cloudbase-integration-execution-plan.md)：身份、同步、迁移与发布阶段。
