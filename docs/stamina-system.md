# 体力系统设计与严格实施边界

> 文档状态：设计合同，尚未实施代码  
> 目标仓库：`godwhere/ClearedMiniProgram`  
> 设计基线：`main@fe960ddd36e46f064871302a35a52d660d2d171f`  
> 编写日期：2026-09-03  
> 当前运行链路：`game.js -> src/bootstrap.js -> src/app.js -> src/ui/canvas-renderer.js`

本文定义 Cleared 微信小游戏普通关卡体力系统的产品规则、状态模型、恢复算法、场景接入、Canvas 展示、测试要求和严格代码修改边界。

本文是后续实现的约束合同，不是概念性建议。实施时不得为了方便改变现有玩法核心、普通进度、每日挑战、Portal、账号、广告或分享边界。

---

## 1. 最终决策

体力系统使用一个独立的本地域服务接入：

```text
CanvasRenderer
      ↑ 只读取纯 ViewModel
ClearedApp
      ↓ 查询、消费、处理不足反馈
StaminaService
      ↓ 只读写独立本地存档
WechatPlatform.getStorage / setStorage
```

本期固定规则：

1. 初始体力为 **5 点**。
2. 自然恢复上限为 **5 点**。
3. 当前总余额允许大于 5；未来好友助力、活动或其他授权奖励可以突破自然恢复上限。
4. 只有当当前体力 `< 5` 时才自然恢复。
5. 每经过完整 **5 分钟**恢复 1 点。
6. 当前体力 `>= 5` 时停止自然恢复，并且不保留未完成的恢复进度。
7. 从 5 或更高余额消费到 4 时，从消费成功的时刻重新开始完整的 5 分钟倒计时。
8. 每次成功创建一个新的普通关卡尝试，消耗 1 点体力。
9. 普通关卡中的重置和失败重试不额外消耗体力。
10. 每日挑战继续使用独立的每日进入次数，本期不叠加普通体力消耗。
11. 自然恢复使用绝对时间戳计算，不使用 `setInterval`、后台计时器或逐秒存档。
12. 闪电使用 Canvas 2D 矢量绘制，不增加 PNG、SVG、字体或分包资源。

核心语义必须始终保持：

```text
5 是 naturalCap，不是 maxBalance。
```

严禁通过以下方式规范体力余额：

```js
balance = Math.min(balance, naturalCap);
```

否则未来好友助力得到的第 6、7 点体力会被错误删除。

---

## 2. 本期范围与非目标

### 2.1 本期纳入体力消耗的内容

以下入口均属于新的普通关卡尝试，成功进入时消耗 1 点：

- 主页“开始游戏”或“继续游戏”；
- 选关页进入任意已解锁普通关卡；
- 已完成普通关卡再次进入；
- 普通 Portal 关卡；
- 普通成功结果页点击“重玩”；
- 普通成功结果页点击“下一关”；
- 离开普通关卡后，从选关页再次进入同一关。

这些入口必须最终统一进入 `ClearedApp.openLevel()`，体力消费不得分散在各个 action 分支。

### 2.2 本期不消耗普通体力的内容

- 关卡内 `play:reset`；
- 普通失败结果的 `failure:retry`；
- App 切入后台再返回当前 Runner；
- 每日挑战入口、每日第 1 关到第 2 关的内部切换、每日失败重试和每日重玩；
- 首页、选关、账号、主题、回廊、特效等非普通关卡场景；
- 无效关卡、未解锁关卡、无法创建 Runner 的关卡。

### 2.3 每日挑战不叠加普通体力

当前每日挑战已经有独立的进入次数合同：一次进入包含两个有序小关，第 1 关完成后进入第 2 关不再扣次数，当前关重置和失败重试免费。

本期若再对每日小关逐关扣普通体力，会产生两套资源的双重门槛，并可能在每日第 1 关结束后因普通体力不足而中断当前轮次。因此本期明确：

```text
普通 catalog 关卡       消耗普通体力
普通 Portal 关卡        消耗普通体力
每日挑战                只消耗每日进入次数
```

未来确需让每日挑战消耗体力时，应另行评审为“每轮每日挑战消耗 1 点”，不得直接把普通关卡逐关扣费规则套到每日两个子关。

### 2.4 本期明确不做

- 好友助力 UI 和分享链路；
- 看广告增加普通体力；
- 分享完成后客户端直接增加普通体力；
- 购买体力、礼包、商城、支付或虚拟货币；
- 体力邮件、运营补偿、每日领取或签到；
- 服务端时间、防改时钟或服务端权威余额；
- 跨设备体力同步；
- 恢复完成的系统通知或订阅消息；
- 体力详情页、加号按钮或尚不可用的入口；
- 为不同普通关卡配置不同体力成本；
- 在关卡数据中逐关增加 `Cost: 1`；
- 将体力写入普通进度或每日挑战存档。

---

## 3. 消费语义

本期采用：

```text
一次成功创建的新普通关卡尝试 = 消耗 1 点体力
```

不是“每次点击都扣”，也不是“通关才扣”。

| 用户行为 | 是否扣体力 | 说明 |
| --- | ---: | --- |
| 点击不存在的关卡 | 否 | 无法形成合法 RunContext |
| 点击未解锁关卡 | 否 | 解锁校验先失败 |
| Runner 构造失败 | 否 | 尚未形成可玩的尝试 |
| 主页开始/继续游戏 | 是 | 新建普通关卡尝试 |
| 选关进入普通关卡 | 是 | 新建普通关卡尝试 |
| 进入普通 Portal 关卡 | 是 | 仍属于普通 catalog 进度域 |
| 当前关点击重置 | 否 | 仍在同一次尝试中 |
| 失败后重新开始 | 否 | 原地重置当前 Runner |
| 成功后重玩 | 是 | 创建全新的尝试 |
| 成功后下一关 | 是 | 创建新的下一关尝试 |
| 最后一关返回关卡列表 | 否 | 未创建新 Runner |
| 返回选关后再次进入 | 是 | 上一尝试已终止 |
| App 切后台再回来 | 否 | 当前 Runner 没有重建 |
| App 被关闭后重新启动并进入 | 是 | 本期不恢复活动关卡快照 |
| 进入每日挑战 | 否 | 使用每日挑战独立进入次数 |

这一语义使玩家消耗 1 点进入某一关后，可以在当前关内反复重置或失败重试；只有结束该尝试并新建一次普通关卡运行时，才再次扣费。

---

## 4. 配置合同

新增文件：

```text
src/config/stamina.js
```

推荐内容：

```js
'use strict';

module.exports = Object.freeze({
  initialBalance: 5,
  naturalCap: 5,
  recoveryIntervalMs: 5 * 60 * 1000,
  ordinaryAttemptCost: 1
});
```

约束：

- `naturalCap` 只表示自然恢复上限；
- 不得增加 `maxBalance: 5`；
- 不得从远程配置读取本期参数；
- 不得引入新的环境变量；
- 不得增加生产“无限体力”开关；
- 测试需要绕过体力时，只能注入测试 fixture；
- 本期普通关卡成本统一为 1，不增加逐关配置。

---

## 5. 独立存档合同

### 5.1 存储键

新增：

```text
cleared:minigame:stamina:v1
```

体力不得写入：

```text
cleared:minigame:progress:v2
cleared:minigame:daily:v1
cleared:minigame:sync:v1
```

原因：

- 普通进度只负责完成集合、最佳时间、最后游玩位置、设置和统计；
- 每日挑战有自己的日期、进入次数和完成状态；
- 当前普通云存档使用完成集合与最短时间的合并规则，该规则不适用于会被消费的余额；
- 把体力混入 ProgressStore 会无谓升级普通存档 schema，并增加回滚与云合并风险。

### 5.2 存储结构

```js
{
  schemaVersion: 1,
  balance: 4,
  nextRecoveryAt: 1788469500000
}
```

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 存档版本 |
| `balance` | 非负安全整数 | 当前总余额，允许大于 5 |
| `nextRecoveryAt` | 毫秒时间戳或 `null` | 下一点自然体力恢复时间 |

不保存：

- `naturalCap`；
- `ordinaryAttemptCost`；
- 每秒倒计时；
- 累计分钟数；
- 定时器句柄；
- UI 文案或场景状态；
- 当前普通关卡信息；
- 好友或广告奖励明细。

### 5.3 新安装和旧版本升级

当体力存储键不存在时初始化：

```js
{
  schemaVersion: 1,
  balance: 5,
  nextRecoveryAt: null
}
```

因此：

- 新安装用户初始为 5；
- 从无体力系统的旧版本升级时也获得 5；
- 老版本回滚时会忽略独立体力键，不影响普通进度；
- 清除小游戏本地数据或重新安装会重新获得初始体力，这是纯本地首版的已知限制。

### 5.4 加载规范化

加载时必须执行：

```text
存档不是普通对象                    → 初始化为 5
schemaVersion !== 1                 → 初始化为 5
balance 不是非负安全整数             → 初始化为 5
balance >= naturalCap               → nextRecoveryAt = null
balance < naturalCap 且时间非法       → nextRecoveryAt = now + interval
balance < naturalCap 且时间已到       → 立即按离线时间结算
```

合法的 `balance = 6、7、8……` 必须原样保留。

不得因为 `nextRecoveryAt` 非法而把一个合法的超额余额裁剪到 5。

---

## 6. 自然恢复状态机

### 6.1 状态规则

```text
balance >= 5
  ├─ 不自然恢复
  └─ nextRecoveryAt = null

balance < 5
  ├─ nextRecoveryAt 必须存在
  └─ 每经过完整 5 分钟恢复 1 点，最多恢复到 5
```

### 6.2 结算算法

推荐使用一个纯计算函数或服务内私有方法：

```js
function settleNaturalRecovery(state, now, config) {
  const naturalCap = config.naturalCap;
  const interval = config.recoveryIntervalMs;

  if (state.balance >= naturalCap) {
    state.nextRecoveryAt = null;
    return state;
  }

  if (!Number.isFinite(state.nextRecoveryAt)) {
    state.nextRecoveryAt = now + interval;
    return state;
  }

  if (now < state.nextRecoveryAt) return state;

  const elapsedTicks =
    1 + Math.floor((now - state.nextRecoveryAt) / interval);
  const missing = naturalCap - state.balance;
  const recovered = Math.min(elapsedTicks, missing);

  state.balance += recovered;

  if (state.balance >= naturalCap) {
    state.nextRecoveryAt = null;
  } else {
    state.nextRecoveryAt += recovered * interval;
  }

  return state;
}
```

### 6.3 不使用定时器

禁止：

```js
setInterval(() => addStamina(1), 5 * 60 * 1000);
```

原因：

- 微信小游戏进入后台后帧循环和 JS 定时器不可靠；
- 进程可能被系统销毁；
- 长时间休眠后定时器不能准确补算；
- 重复绑定容易导致多重恢复；
- 逐秒定时器会增加无意义运行和存档写入。

正确方式是保存一个绝对时间戳，在启动、前台恢复、查询快照和消费前统一结算。

### 6.4 关键例子

#### 首次消费

```text
10:00  体力 5
进入关卡，消费 1
体力变为 4
nextRecoveryAt = 10:05
```

#### 恢复期间再次消费

```text
10:00  5 → 4，下一点 10:05
10:02  4 → 3
下一点仍为 10:05，不重置为 10:07
```

#### 离线恢复

```text
10:00  体力 2，下一点 10:05
10:12  再次打开

10:05  恢复到 3
10:10  恢复到 4
下一点为 10:15
当前倒计时约 3:00
```

#### 达到自然上限

```text
10:00  体力 2
10:30  再次打开

最终体力为 5
nextRecoveryAt = null
多出来的恢复时间不储存
```

#### 未来奖励突破上限

```text
当前体力 4，下一点还有 2 分钟
授权奖励 +3
体力变为 7
nextRecoveryAt = null
```

随后：

```text
7 → 6   不启动自然恢复
6 → 5   不启动自然恢复
5 → 4   从消费成功时重新开始完整 5 分钟
```

#### 未来奖励后仍低于 5

```text
体力 1，下一点还有 2 分钟
授权奖励 +2
体力变为 3
```

因为仍低于 5，原有的 2 分钟倒计时继续，不得重置。

### 6.5 设备时钟调整

本地首版以设备时间为准：

- 时钟向后调整时，不额外赠送体力，只会让下一点等待更久；
- 时钟向前调整可能提前恢复，这是纯客户端状态无法完全防止的限制；
- 本期不因为该限制引入服务端时间或网络依赖；
- 未来把好友助力、广告奖励或商业化奖励接入普通体力时，应再评审服务端权威时间和状态版本。

---

## 7. `StaminaService` 合同

新增文件：

```text
src/services/stamina-service.js
```

### 7.1 唯一职责

服务只负责：

- 加载和规范化独立体力存档；
- 按时间戳结算自然恢复；
- 消耗一次普通关卡尝试成本；
- 安全持久化；
- 返回只读快照；
- 在存储恢复后重试尚未落盘的自然恢复状态。

服务不得负责：

- 场景切换；
- 创建或持有 `GameRunner`；
- 关卡解锁；
- 关卡结算；
- Canvas 绘制；
- 微信登录；
- 分享、广告、好友助力；
- 每日挑战进入次数；
- 普通云存档；
- 行为分析事件。

### 7.2 推荐接口

```js
class StaminaService {
  constructor(platform, options);

  snapshot(now);
  consumeOrdinaryAttempt(now);
  flush(now);
}
```

可选的内部私有方法：

```text
load()
normalize(saved, now)
settle(now)
persist(candidate)
cloneState()
```

不得暴露内部可变 `state` 对象给 App 或 Renderer。

### 7.3 `snapshot(now)`

返回新对象：

```js
{
  enabled: true,
  balance: 4,
  naturalCap: 5,
  ordinaryAttemptCost: 1,
  recovering: true,
  nextRecoveryAt: 1788469500000,
  remainingMs: 184000,
  overflow: 0,
  canStartOrdinaryAttempt: true,
  persisted: true
}
```

规则：

1. 查询前先结算自然恢复。
2. `remainingMs = max(0, nextRecoveryAt - now)`。
3. `overflow = max(0, balance - naturalCap)`。
4. `canStartOrdinaryAttempt = balance >= ordinaryAttemptCost`。
5. 返回新对象，调用者不能修改内部状态。
6. 只有余额、恢复锚点或非法状态修复发生变化时才尝试写存储。
7. 每帧调用 `snapshot()` 不能导致每帧或每秒写存储。

自然恢复已经在内存中正确结算，但本次存储写入失败时，可继续在当前进程使用已结算状态，并标记待重试；重启后会依据旧时间戳重新得出等价结果。消费操作则使用更严格的持久化规则。

### 7.4 `consumeOrdinaryAttempt(now)`

成功：

```js
{
  ok: true,
  spent: 1,
  before: 5,
  after: 4,
  snapshot: { /* 最新快照 */ }
}
```

体力不足：

```js
{
  ok: false,
  reason: 'insufficient-stamina',
  snapshot: { /* 最新快照 */ }
}
```

存储失败：

```js
{
  ok: false,
  reason: 'persist-failed',
  snapshot: { /* 未扣费快照 */ }
}
```

消费顺序必须是：

```text
1. 结算当前时间前已经获得的自然体力
2. 检查余额
3. 克隆临时候选状态
4. 在候选状态扣除成本
5. 根据扣除后的余额维护 nextRecoveryAt
6. 持久化候选状态
7. 持久化成功后才提交内存状态
8. 返回成功
```

持久化失败时：

- 不得扣除体力；
- 不得启动新 Runner；
- 不得修改场景；
- 不得把失败当作免费进入。

该门控采用 fail-closed，避免存储异常形成无限免费开局。

### 7.5 消费后的恢复锚点

```text
扣除前 >= 5，扣除后仍 >= 5
  → nextRecoveryAt = null

扣除前 >= 5，扣除后 < 5
  → nextRecoveryAt = now + interval

扣除前 < 5，扣除后仍 < 5
  → 保留已有 nextRecoveryAt
```

当前成本固定为 1，但实现不能通过硬编码“只有 5→4”推导所有状态；应以扣除前后是否跨越 `naturalCap` 判断。

### 7.6 `flush(now)`

- 只用于重试尚未落盘的自然恢复或规范化状态；
- `onHide()` 可调用一次；
- 不得循环写存储；
- 不得在 `tick()` 每帧调用；
- 不负责网络同步。

---

## 8. App 接入和唯一扣费边界

### 8.1 组合根

`src/bootstrap.js` 是正式运行时的组合根。

新增：

```js
const StaminaService = require('./services/stamina-service.js');
const staminaConfig = require('./config/stamina.js');
```

在 `start()` 中：

```js
const stamina = new StaminaService(platform, staminaConfig);
```

注入：

```js
const app = new ClearedApp(platform, {
  // existing dependencies
  stamina
});
```

不得由 Renderer 自行创建服务。

### 8.2 `ClearedApp` 构造

`src/app.js` 推荐增加：

```js
const StaminaService = require('./services/stamina-service.js');
const staminaConfig = require('./config/stamina.js');
```

构造：

```js
this.stamina = opts.stamina ||
  new StaminaService(platform, opts.staminaConfig || staminaConfig);

this.staminaSnapshot = this.stamina.snapshot(Date.now());
this.staminaFeedback = null;
this.lastStaminaSecond = -1;
```

直接构造 `ClearedApp` 的轻量宿主应与正式 bootstrap 有同样的体力默认行为。

已有大量非体力 App 测试会连续打开超过 5 次关卡，因此这些测试必须显式注入测试专用固定体力 fixture；不得为保持旧测试通过而让生产构造默认禁用体力。

### 8.3 唯一消费入口：`openLevel()`

所有普通入口已经统一调用 `openLevel(setIndex, levelIndex)`，因此该方法必须成为唯一体力消费边界。

实施后的顺序：

```text
openLevel(setIndex, levelIndex)
  1. createCatalogRunContext()
  2. context 不存在 → 返回 false，不扣体力
  3. progression.isUnlocked() 失败 → 返回 false，不扣体力
  4. 在局部变量中构造 GameRunner
  5. Runner 构造失败 → 返回 false，不扣体力
  6. stamina.consumeOrdinaryAttempt(now)
  7. 体力不足或持久化失败 → 保持原场景和原 Runner，返回 false
  8. 扣费成功后提交 runContext / runner / 索引
  9. markOpened() 并保存普通进度
 10. 切换到 play
```

推荐增加局部方法：

```js
createOrdinaryRunner(context) {
  try {
    return new GameRunner(
      context.level,
      context.set.Palette || [],
      () => this.invalidate()
    );
  } catch (error) {
    return null;
  }
}
```

### 8.4 状态提交必须在扣费成功后

以下现有状态修改必须位于 Runner 验证和体力消费成功之后：

```js
this.clearHintRequest();
this.runContext = context;
this.setIndex = context.setIndex;
this.levelIndex = context.levelIndex;
this.levelPageIndex = this.levelPageForTarget(context);
this.runner = runner;
this.boardInput.setRunner(runner);
this.scene = 'play';
```

体力不足时，例如在普通成功结果页点击“下一关”：

```text
scene             保持 result
runner            保持刚完成的 Runner
runContext        不变
result            不清空
progress          不变
stamina           不变
staminaFeedback   设置不足原因
```

不能先离开结果页、清空结果或替换 Runner，再发现体力不足。

### 8.5 普通进度保存失败的处理

体力持久化成功并创建尝试后，`ProgressStore.markOpened()` 或普通进度保存失败不应回滚已经消耗的体力，因为玩家已经获得并进入本次尝试。

但体力自身的消费存储失败必须阻止尝试开始。

### 8.6 严禁在其他位置扣体力

以下位置不得调用任何扣体力方法：

```text
performAction('home:start')
performAction('level:*')
performAction('result:replay')
performAction('result:next')
onPathCompleted()
completionPolicies.settle()
ProgressStore.recordCompletion()
GameRunner 构造函数内部
CanvasRenderer 按钮或命中处理
```

这些位置只负责把业务意图路由到 `openLevel()`。

否则容易出现：

- 同一动作重复扣费；
- 点击无效关卡也扣费；
- Runner 创建失败但已经扣费；
- 新增入口时遗漏扣费；
- 结果页状态被提前清空。

---

## 9. Tick 和生命周期

### 9.1 不增加第二套循环

项目已有统一 `ClearedApp.tick(now)` 和脏帧渲染机制。体力倒计时必须复用该循环，不创建：

- `setInterval`；
- `setTimeout` 倒计时链；
- 独立 requestAnimationFrame；
- 后台 Worker。

### 9.2 `refreshStamina(now)`

允许在 `src/app.js` 增加：

```js
refreshStamina(now) {
  const next = this.stamina.snapshot(now);
  const nextSecond = next.recovering
    ? Math.ceil(next.remainingMs / 1000)
    : -1;

  const changed =
    !this.staminaSnapshot ||
    next.balance !== this.staminaSnapshot.balance ||
    next.recovering !== this.staminaSnapshot.recovering ||
    nextSecond !== this.lastStaminaSecond;

  this.staminaSnapshot = next;
  this.lastStaminaSecond = nextSecond;

  if (changed) this.dirty = true;
  return changed;
}
```

`tick(now)` 每帧可以读取时间，但只有以下情况触发重绘：

- 倒计时显示秒数变化；
- 体力余额变化；
- 恢复状态变化；
- 不足反馈出现或过期；
- 持久化状态提示变化。

禁止每秒保存存档。

### 9.3 `onHide()`

增加：

```js
this.stamina.flush(Date.now());
```

不需要在后台保持计时器运行。

### 9.4 `onShow()`

在恢复 Runner、音频和 Canvas 后补算：

```js
this.refreshStamina(Date.now());
```

切后台本身不扣体力，当前 Runner 不重建。

### 9.5 `dispose()`

如果服务没有事件监听、定时器或平台回调，则不需要新增 `dispose()`。

不得为了一个纯存储服务引入无用生命周期抽象。

---

## 10. ViewModel 合同

`buildModel()` 的基础模型增加：

```js
{
  stamina: {
    enabled: true,
    balance: 4,
    naturalCap: 5,
    ordinaryAttemptCost: 1,
    recovering: true,
    nextRecoveryAt: 1788469500000,
    remainingMs: 184000,
    overflow: 0,
    canStartOrdinaryAttempt: true,
    persisted: true
  },

  staminaFeedback: {
    reason: 'insufficient-stamina',
    until: 1788469322000
  }
}
```

约束：

- Renderer 只能读取纯对象；
- Renderer 不得接收 `StaminaService` 实例；
- Renderer 不得自己读取存储或计算持久化状态；
- App 不得暴露服务内部可变对象；
- 体力为 0 不改变关卡的 `unlocked` 字段。

---

## 11. Canvas UI 合同

### 11.1 闪电图标

不得直接使用 Unicode Emoji `⚡`，因为不同系统字体可能显示为不同大小、不同色彩的彩色 Emoji。

在 `CanvasRenderer.drawIcon()` 中增加矢量分支：

```js
} else if (type === 'stamina') {
  ctx.beginPath();
  ctx.moveTo(size * 0.10, -size * 0.50);
  ctx.lineTo(-size * 0.30, size * 0.05);
  ctx.lineTo(-size * 0.02, size * 0.05);
  ctx.lineTo(-size * 0.16, size * 0.50);
  ctx.lineTo(size * 0.34, -size * 0.10);
  ctx.lineTo(size * 0.05, -size * 0.10);
  ctx.closePath();
  ctx.fill();
}
```

图标继承当前主题的 `skin.colors.icon`，不增加图片和分包资源。

### 11.2 体力徽标

允许新增纯渲染方法：

```js
drawStaminaStatus(stamina, rect, options)
```

显示规则：

| 状态 | 主行 | 副行 |
| --- | --- | --- |
| `balance < 5` | 闪电 + 当前数量 | `MM:SS` |
| `balance === 5` | 闪电 + `5` | `已满` |
| `balance > 5` | 闪电 + 当前数量 | `额外 +N` |

示例：

```text
闪电 4
 03:27
```

```text
闪电 5
  已满
```

```text
闪电 8
额外 +3
```

不得显示 `8 / 5`，因为 5 不是总上限。

体力徽标仅展示状态，不注册 hit，不显示加号，不打开任何新页面。

### 11.3 倒计时格式

允许在 `formatTime()` 附近增加：

```js
function formatStaminaCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
```

使用 `Math.ceil`，避免剩余 1—999 毫秒时提前显示 `00:00`。

### 11.4 主页位置

主页顶部现有：

- 左侧账号头像；
- 右侧音效按钮；
- 中间可用于体力状态。

建议：

```js
{
  x: (width - 104) / 2,
  y: safeTop + (skin.layout.homeTopUiOffset || 0) + 8,
  w: 104,
  h: 44
}
```

不改变 Logo、每日挑战、回廊和开始按钮的既有布局合同。

### 11.5 选关页位置

选关页左上已有主页按钮，中间为标题，右上可显示体力。

建议：

```js
{
  x: width - 108,
  y: headerTop + 8,
  w: 94,
  h: 44
}
```

体力为 0 时，已解锁关卡卡片仍保持已解锁视觉和 hit：

```js
// 正确
this.addHit(action, rect, unlocked);

// 禁止
this.addHit(action, rect, unlocked && stamina.balance > 0);
```

“关卡未解锁”和“体力不足”是不同状态。点击已解锁关卡后由 App 显示体力不足反馈，不能把关卡重新画成锁定。

### 11.6 普通游玩页和结果页位置

普通游玩页建议把紧凑徽标放在返回按钮右侧：

```js
{
  x: 56,
  y: topUi + 12,
  w: 52,
  h: 44
}
```

不得修改：

- `headerHeight`；
- `boardTop` 和 `boardBottom`；
- Portal 提示带；
- 棋盘单元格尺寸；
- 底部提示和回撤按钮；
- 普通结果面板布局。

普通结果页通过 `drawPlay()` 绘制底层后再叠加 `drawResult()`，可沿用同一徽标。

### 11.7 每日挑战页

本期不在 `drawDaily()` 或 `drawDailyResult()` 中展示普通体力，避免用户误以为每日挑战也会消费该资源。

主页仍可显示全局体力状态。

---

## 12. 体力不足和存储失败反馈

App 记录机器状态：

```js
{
  reason: 'insufficient-stamina',
  until: now + 2200
}
```

或：

```js
{
  reason: 'persist-failed',
  until: now + 2200
}
```

Renderer 在场景绘制完成后统一叠加一个不注册 hit 的短提示。

推荐文案：

```text
体力不足，04:32 后恢复 1 点
```

当余额为 0 但恢复时间不可用时：

```text
体力不足，请稍后再试
```

存储失败时：

```text
体力状态保存失败，请重试
```

要求：

- 提示不注册 hit；
- 提示约 2.2 秒后消失；
- 提示过期时必须绘制一次清理帧；
- 结果页下一关失败时仍留在结果页；
- 不调用微信原生 Toast；
- 不为此修改 `src/platform/wechat.js`；
- 不新增尚无功能的 `stamina:add`、`stamina:open` 等 action。

---

## 13. 未来好友助力与奖励边界

本期只保证数据模型允许 `balance > 5`，不提前实现好友助力接口或 UI。

未来正确流程：

```text
用户创建助力邀请
  ↓
ShareService 创建服务端分享意图
  ↓
好友进入并完成服务端归因
  ↓
服务端校验
  - 不是本人
  - 未重复助力
  - 未超过每日限制
  - 邀请仍有效
  ↓
服务端 Reward Ledger 创建唯一 grant
  ↓
RewardService 拉取已授权 grant
  ↓
ClearedApp 校验当前账号、grantId、stateVersion
  ↓
StaminaService 应用授权增量
```

严禁未来这样实现：

```js
shareResult().then(() => {
  stamina.balance += 1;
});
```

也不得在 `onShow(query)` 中仅凭分享 query 直接增加体力。

分享和广告只能产生行为结果，耐久资产必须经过服务端幂等奖励结算。

未来 grant 可使用类似结构：

```js
{
  grantId: 'grant_xxx',
  action: 'stamina_friend_assist',
  amount: 1,
  stateVersion: 18,
  grantedAt: 1788469000000
}
```

未来应用增量时的恢复规则：

```text
增加后仍 < 5       保留原 nextRecoveryAt
增加后达到或超过 5  清除 nextRecoveryAt
增加后 > 5          保留完整超额余额
相同 grantId         只能应用一次
```

当前 `RewardService` 的客户端合同只允许每日额外进入次数，未来接普通体力奖励时必须单独扩展 action、context、grant 响应、服务端 ledger 和测试，不能绕过现有校验。

本期不要提前增加没有调用者的 `applyFriendGrant()`、好友面板或奖励队列。

---

## 14. 严格文件实施边界

### 14.1 允许新增的生产文件

| 文件 | 唯一允许内容 |
| --- | --- |
| `src/config/stamina.js` | 初始值、自然恢复上限、恢复间隔、普通尝试成本 |
| `src/services/stamina-service.js` | 独立存储、规范化、恢复、普通尝试消费、快照、flush |
| `docs/stamina-system.md` | 本实施合同 |

### 14.2 允许修改的生产文件

| 文件 | 允许修改范围 |
| --- | --- |
| `src/bootstrap.js` | 导入配置和服务、创建实例、注入 App |
| `src/app.js` | 构造注入、体力快照、tick、buildModel、openLevel、onHide、onShow、不足反馈 |
| `src/ui/canvas-renderer.js` | 闪电图标、徽标、倒计时格式、不足提示及普通场景调用 |
| `README.md` | 用户可见规则、存档说明和本文链接 |

### 14.3 `src/app.js` 的方法级边界

仅允许修改：

```text
文件顶部 require
constructor()
tick()
buildModel()
openLevel()
onHide()
onShow()
```

允许新增：

```text
createOrdinaryRunner()
refreshStamina()
showStaminaFeedback()
clearStaminaFeedback()
```

禁止顺手重构：

- 每日挑战状态机；
- 账号登录与同步；
- 分享；
- 提示解锁；
- 广告；
- 普通结算；
- Portal；
- 主题和特效。

### 14.4 `src/ui/canvas-renderer.js` 的方法级边界

仅允许修改：

```text
formatTime 附近增加 formatStaminaCountdown
render()
drawIcon()
drawHome()
drawLevels()
drawPlay()
```

允许新增：

```text
drawStaminaStatus()
drawStaminaFeedback()
```

`render()` 只允许在每个场景主绘制完成后统一调用反馈叠加，不得改变场景分派逻辑。

禁止修改：

```text
BoardRenderer
PortalOverlay
InteractionMap
棋盘单元格计算
路径绘制和清除动画
Portal 提示状态
Daily UI
Theme UI
Effect UI
```

### 14.5 允许新增和修改的测试文件

新增：

```text
tests/stamina-service.test.js
tests/stamina-app.test.js
tests/stamina-renderer.test.js
tests/helpers/stamina-fixture.js
```

修改：

```text
tests/run.js
tests/architecture-boundaries.test.js
```

现有非体力 App 测试如果累计进入超过 5 次，只允许注入：

```js
stamina: createUnlimitedStaminaFixture()
```

禁止：

- 删除原有断言；
- 减少原有游玩步骤；
- 在生产配置增加无限体力；
- 全局改写 `Date.now()`；
- 因体力测试弱化 Portal、每日挑战、结算或存档测试。

### 14.6 玩法核心禁止修改

```text
core/**
src/gameplay/run-context.js
src/gameplay/completion-policies.js
src/gameplay/board-input-controller.js
src/mechanics/**
```

原因：体力是普通关卡入口资源，不是连线规则、输入规则或结算规则。

`GameRunner` 不得知道：

- 余额；
- 本地存储；
- 时间；
- 分享或广告；
- Canvas UI。

### 14.7 关卡数据禁止修改

```text
data/catalog-v2.js
data/clearedset*.json
data/clearedset*.js
data/solutions.js
data/portal-solutions.js
```

所有普通关卡成本统一为 1，不给 92 个关卡逐个增加字段，不改变 ID、坐标、解锁顺序或解答。

### 14.8 普通进度和云同步禁止修改

```text
src/services/progress-store.js
src/services/progress-sync-service.js
src/services/sync-store.js
src/services/api-client.js
```

禁止：

- 把体力加进 `progress:v2`；
- 修改普通云存档 schema；
- 用完成集合的 union/min 合并规则合并体力；
- 因体力系统升级 ProgressStore schemaVersion；
- 增加普通体力 API 路径。

### 14.9 每日挑战禁止修改

```text
src/services/daily-progress-store.js
src/services/daily-challenge-service.js
src/config/daily.js
data/daily-challenges.js
data/daily-solutions.js
```

普通体力和每日进入次数是两个独立资源，不得互相复制、换算或共享恢复时间。

### 14.10 分享、广告和奖励本期禁止修改

```text
src/services/share-service.js
src/services/ads-service.js
src/services/engagement-service.js
src/services/reward-service.js
src/config/ads.js
src/config/engagement.js
```

本期不接普通体力奖励，仅在本文记录未来边界。

### 14.11 平台、资源和发布配置禁止修改

```text
src/platform/wechat.js
assets/**
game.json
project.config.json
src/skins/**
src/effects/**
pages/**
根目录旧小程序 app.js / app.json / app.wxss
```

闪电使用 Canvas 矢量绘制，因此不增加资源、不增加分包、不修改忽略配置。

---

## 15. 自动化测试合同

### 15.1 `stamina-service.test.js`

必须覆盖：

1. 无存档时初始化为 5；
2. 5 点时没有恢复时间；
3. 5→4 后下一点恰好为 5 分钟后；
4. 4→3 不重置已有倒计时；
5. 到达首个恢复时间时只恢复 1 点；
6. 离线 12 分钟从 2 恢复到 4；
7. 离线足够久最多自然恢复到 5；
8. 达到 5 后清除 `nextRecoveryAt`；
9. 存档中的 7 点不会被裁剪；
10. 7→6 和 6→5 不启动恢复；
11. 5→4 才启动新的完整恢复周期；
12. 0 点消费返回 `insufficient-stamina`；
13. 存储失败时消费不生效；
14. 非法存档安全回退；
15. 倒退时钟不会赠送体力；
16. `snapshot()` 逐帧调用不会逐帧写存储；
17. 多个离线恢复点一次结算，只写一次存储；
18. 自然恢复写入失败后，`flush()` 可以重试；
19. 返回快照不能修改内部状态；
20. `balance`、时间戳和配置的整数边界得到校验。

### 15.2 `stamina-app.test.js`

必须覆盖：

1. 成功 `openLevel()` 消耗 1；
2. 未解锁关卡不消耗；
3. 无效关卡不消耗；
4. Runner 创建失败不消耗；
5. `play:reset` 不消耗；
6. `failure:retry` 不消耗；
7. `result:replay` 消耗；
8. `result:next` 有下一关时消耗；
9. 最后一关返回列表不消耗；
10. 体力不足时保持当前场景；
11. 体力不足时不替换 Runner；
12. 体力不足时不清空 result；
13. 普通 Portal 关卡正常消费；
14. 每日挑战不消费普通体力；
15. `onHide/onShow` 补算离线恢复；
16. 后台恢复不会重复扣费；
17. 体力存储失败阻止进入；
18. 普通进度保存失败不回滚已形成的尝试；
19. 主页开始、选关卡片、结果重玩、结果下一关均只扣一次；
20. 不足反馈到期后清除。

### 15.3 `stamina-renderer.test.js`

必须覆盖：

1. 主页显示体力徽标；
2. 选关页显示体力徽标；
3. 普通游玩页显示体力徽标；
4. 普通结果页显示体力徽标；
5. 每日挑战页不显示普通体力徽标；
6. 徽标不注册 hit；
7. 4 点显示倒计时；
8. 5 点显示“已满”；
9. 8 点显示“额外 +3”；
10. 闪电不依赖图片加载；
11. 320px 等窄屏不覆盖标题；
12. 普通棋盘尺寸不变；
13. Portal 提示区域位置不变；
14. 不足提示不留下永久 hit；
15. 提示过期后绘制清理帧；
16. `00:01` 到 `00:00` 的向上取整行为正确。

### 15.4 架构测试

在 `tests/architecture-boundaries.test.js` 增加检查：

```text
core/** 不得依赖 stamina-service
src/gameplay/** 不得依赖 stamina-service
src/ui/** 不得 require stamina-service
canvas-renderer.js 只能读取 model.stamina
StaminaService 不得访问 wx 全局
StaminaService 不得依赖 GameRunner、Canvas、账号、分享、广告或每日存档
```

### 15.5 全量命令

完成后运行：

```bash
node tests/run.js
node scripts/check-package-budget.js
git diff --check
```

Node 测试不能替代微信开发者工具和真机验收。

---

## 16. 人工验收矩阵

| 场景 | 预期 |
| --- | --- |
| 首次启动 | 显示 5 点、已满 |
| 连续进入 5 次普通关卡 | 体力依次降到 0 |
| 第 6 次进入 | 保持当前页并显示不足提示 |
| 0 点等待 5 分钟 | 恢复到 1 |
| 2 点切后台 12 分钟 | 返回为 4，下一点约剩 3 分钟 |
| 4 点时再次进入关卡 | 变为 3，原倒计时不重置 |
| 当前关点击重置 | 不扣体力 |
| 失败后重试 | 不扣体力 |
| 通关后重玩 | 扣 1 |
| 通关后下一关 | 扣 1 |
| 最后一关返回列表 | 不扣体力 |
| 进入每日挑战 | 普通体力不变 |
| 测试存档手动设为 8 | 显示 8，停止恢复 |
| 8 连续消费到 5 | 始终没有自然恢复倒计时 |
| 5 再消费到 4 | 出现完整 5:00 倒计时 |
| 杀掉小游戏后再启动 | 根据时间戳正确补算 |
| 切换任意主题 | 闪电和文字仍可读 |
| 普通 Portal 关卡 | 棋盘、提示和触摸区域不变 |
| 存储写入失败 | 拒绝新开局，原页面保持可用 |

至少需要验证：

- 微信开发者工具；
- 一台 Android 真机；
- 一台 iOS 真机；
- 安全区和窄屏；
- 切后台与进程被杀；
- 体力不足时的各入口；
- Portal 页面布局；
- 主包预算无新增素材。

---

## 17. 分阶段实施顺序

### 提交 1：体力领域层

只允许：

```text
src/config/stamina.js
src/services/stamina-service.js
tests/stamina-service.test.js
tests/run.js
```

验收：

- 所有恢复、超上限和持久化测试通过；
- 不修改 App 和 UI；
- 不增加任何资源。

### 提交 2：普通关卡门控

只允许：

```text
src/bootstrap.js
src/app.js
tests/stamina-app.test.js
tests/helpers/stamina-fixture.js
tests/run.js
```

验收：

- 所有普通入口只扣一次；
- 无效关卡和 Runner 失败不扣；
- 失败重试和重置免费；
- 每日挑战不受影响；
- 体力不足不破坏当前场景。

### 提交 3：Canvas UI

只允许：

```text
src/ui/canvas-renderer.js
tests/stamina-renderer.test.js
tests/architecture-boundaries.test.js
tests/run.js
```

验收：

- 主页、选关、普通游玩和普通结果正确展示；
- 每日场景不展示；
- 无图片资源；
- 无新增交互 action；
- 不改变棋盘和 Portal 布局。

### 提交 4：文档和全量回归

只允许：

```text
README.md
docs/stamina-system.md
```

执行全量测试、包预算、开发者工具和真机验收，并在交付说明中明确尚未完成的设备检查。

---

## 18. 完成定义

只有同时满足以下条件，才能认为本期体力系统完成：

- 体力存档与普通进度、每日进度完全独立；
- 初始体力为 5；
- 每 5 分钟恢复 1；
- 自然恢复最多到 5；
- 总余额可以合法大于 5；
- `balance >= 5` 时没有自然恢复；
- 从 5 或更高余额消费到 4 时重新开始完整 5 分钟；
- 所有普通关卡入口只在 `openLevel()` 消费；
- 无效、锁定或无法创建 Runner 的关卡不消费；
- 体力不足不破坏原场景、Runner 或结果；
- 普通失败重试和当前关重置不额外消费；
- 每日挑战不叠加普通体力；
- 无 `setInterval`；
- 无直接 `wx.*`；
- 无新增图片资源；
- 无生产无限体力开关；
- Renderer 只消费纯 ViewModel；
- `core/**`、玩法、Portal、关卡数据和普通云存档未被修改；
- 全量测试和包预算通过；
- 微信开发者工具与必要真机流程完成验收；
- README、本文和最终代码行为一致。

---

## 19. 实施者最终检查清单

在提交代码前逐项确认：

```text
[ ] 5 是 naturalCap，而不是 maxBalance
[ ] 存档中的 6、7、8 点不会被裁剪
[ ] 体力消费只存在于 openLevel()
[ ] Runner 构造成功后才尝试消费
[ ] 消费持久化成功后才提交场景
[ ] 结果页体力不足时仍留在结果页
[ ] failure:retry 和 play:reset 不消费
[ ] 每日挑战完全不读取或消费普通体力
[ ] 4→3 不重置已有倒计时
[ ] 5→4 才启动新倒计时
[ ] 不使用 setInterval
[ ] 不每秒写存储
[ ] 不修改 ProgressStore 和 DailyProgressStore
[ ] 不修改 core、gameplay、mechanics 和关卡数据
[ ] 闪电由 Canvas 绘制，无新素材
[ ] 体力徽标没有 hit
[ ] 不增加尚不可用的加体力按钮
[ ] 未来分享/广告不能直接修改余额
[ ] node tests/run.js 通过
[ ] node scripts/check-package-budget.js 通过
[ ] git diff --check 通过
[ ] 开发者工具和真机验收结果已记录
```
