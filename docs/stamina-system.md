# 体力系统设计与严格实施边界

> 文档状态：本地体力已实施；阶段 5 云权威扩展已完成测试环境真机验收
> 目标仓库：`godwhere/ClearedMiniProgram`  
> 设计基线：`main@fe960ddd36e46f064871302a35a52d660d2d171f`  
> 编写日期：2026-09-03  
> 实施基线：`main@f88373c7768bf011724b76c202ca6845db107e4d`；分支 `feat/stamina-system`
> 当前运行链路：`game.js -> src/bootstrap.js -> src/app.js -> src/ui/canvas-renderer.js`

本文定义 Cleared 微信小游戏普通关卡体力系统的产品规则、状态模型、恢复算法、场景接入、Canvas 展示、测试要求和严格代码修改边界。

本文是后续实现的约束合同，不是概念性建议。实施时不得为了方便改变现有玩法核心、普通进度、每日挑战、Portal、账号、广告或分享边界。

实际实现和验证记录见第 20 节；阶段 5 云权威扩展见第 25 节。第 2.4、5—7 节的“仅本地/设备时间”描述属于初版本地阶段，启用阶段 5 测试门禁后由第 25 节补充，不改变体力产品规则。

2026-09-07 [8×8 难度重排](level-difficulty-system.md) 补充：永久解锁和退款资格始终绑定原 `setIndex:levelIndex`，不随显示号迁移。已完成或已付费解锁的旧题不受新顺序前置限制，重入不重复扣费；未解锁新题仍先检查前置，再走原体力权威。`isPermanentlyUnlocked` 仅查询当前有效状态/已验证存档，不结算时间、不写存储、不消费体力。零余额旧档继续与重启已加入回归；无云端部署或状态改写。

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
8. 首次进入满足顺序条件的新普通关卡，消耗 1 点体力永久解锁；解锁后再次进入、重玩或重启后继续均免费。
9. 普通关卡中的重置和失败重试不额外消耗体力。
10. 每日挑战继续使用独立的每日进入次数，本期不叠加普通体力消耗。
11. 自然恢复使用绝对时间戳计算，不使用 `setInterval`、后台计时器或逐秒存档。
12. 闪电使用 Canvas 2D 矢量绘制，不增加 PNG、SVG、字体或分包资源。
13. 每个普通关卡首次达成 **本次用时不超过 60000ms** 的通关时自动返还 1 点体力；不要求首次游玩或首次通关，此前超时不影响资格。
14. 每关仅返还一次，重复快通和重启不能重复领取；每日挑战不参与普通体力返还。返还余额可以超过 5。

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

体力用于永久解锁普通 catalog 关卡（含 Portal），每关只消费一次。顺序条件仍由 ProgressionService 管理：
前一关完成后获得下一关的可挑战资格，在首次进入时使用 1 点体力解锁；并非每次新建 Runner 都消费。

主页开始、选关卡片和结果页下一关都统一进入 `ClearedApp.openLevel()`：目标尚未取得永久资格时消费，已解锁时免费。
存档持久化成功前不提交解锁资格或新场景；不得在 action 分支分散扣费。

### 2.2 本期不消耗普通体力的内容

- 已解锁关卡重复进入、返回选关后再进入、成功结果重玩和重启游戏后再进入；
- 关卡内 `play:reset`；
- 普通失败结果的 `failure:retry`；
- App 切入后台再返回当前 Runner；
- 每日挑战入口、每日第 1 关到第 2 关的内部切换、每日失败重试和每日重玩；
- 首页、选关、账号、主题、回廊、特效等非普通关卡场景；
- 无效关卡、尚未满足顺序开放条件的关卡、无法创建 Runner 的关卡。

### 2.3 每日挑战不叠加普通体力

当前每日挑战已经有独立的进入次数合同：一次进入包含两个有序小关，第 1 关完成后进入第 2 关不再扣次数，当前关重置和失败重试免费。

本期若再对每日小关逐关扣普通体力，会产生两套资源的双重门槛，并可能在每日第 1 关结束后因普通体力不足而中断当前轮次。因此本期明确：

```text
普通 catalog 关卡       首次永久解锁消耗普通体力，之后免费
普通 Portal 关卡        同样每关只消费一次
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

```text
一个普通关卡的首次永久解锁 = 消耗 1 点体力
同一关卡的后续任何尝试 = 免费
```

| 用户行为 | 是否扣体力 | 说明 |
| --- | ---: | --- |
| 点击不存在或尚未满足顺序条件的关卡 | 否 | 入口校验先失败 |
| Runner 构造失败 | 否 | 没有形成可玩的关卡 |
| 首次进入可挑战的新关卡 | 是 | 持久化扣费与永久解锁记录后进入 |
| 已解锁关卡从首页或选关再进入 | 否 | 即使体力为 0 也可进入 |
| 普通 Portal 关卡 | 仅首次解锁 | 与其他普通关卡一致 |
| 当前关重置、失败重试 | 否 | 已有永久资格 |
| 成功结果页重玩 | 否 | 重玩已解锁关卡 |
| 成功结果页下一关 | 仅目标未解锁时 | 已解锁的下一关免费 |
| 最后一关返回列表 | 否 | 没有解锁新关卡 |
| 返回选关后再次进入、杀进程重启后再次进入 | 否 | 永久资格从独立体力存档恢复 |
| 进入每日挑战 | 否 | 使用每日挑战独立进入次数 |

顺序开放资格与永久体力解锁分开管理：不允许用体力跳过前置关卡。通关记录本身也证明已有访问资格，
包括启动后通过现有云同步到达的完成记录；这种重玩不扣体力。

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
  ordinaryUnlockCost: 1,
  quickClearLimitMs: 60 * 1000,
  quickClearRefundAmount: 1
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
  nextRecoveryAt: 1788469500000,
  unlockedLevels: ['0:0', '0:1'],
  refundedLevels: ['0:0']
}
```

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 存档版本 |
| `balance` | 非负安全整数 | 当前总余额，允许大于 5 |
| `nextRecoveryAt` | 毫秒时间戳或 `null` | 下一点自然体力恢复时间 |
| `unlockedLevels` | 去重的字符串数组 | 永久解锁关卡的 `setIndex:levelIndex`，例如 `0:1`；与扣费同一次写入 |
| `refundedLevels` | 去重的字符串数组 | 已成功返还的关卡键，必须属于 unlockedLevels；与余额增加同一次写入 |

不保存：

- `naturalCap`；
- `ordinaryUnlockCost`、`quickClearLimitMs` 和 `quickClearRefundAmount`；
- 每秒倒计时；
- 累计分钟数；
- 定时器句柄；
- UI 文案或场景状态；
- 活动 Runner、关卡题面、当前手势或游玩过程快照；
- 好友或广告奖励明细。

### 5.3 新安装和旧版本升级

当体力存储键不存在时初始化：

```js
{
  schemaVersion: 1,
  balance: 5,
  nextRecoveryAt: null,
  unlockedLevels: [],
  refundedLevels: []
}
```

因此：

- 新安装用户初始为 5；
- 从无体力系统的旧版本升级时也获得 5；
- 不改普通进度或每日进度 schema；永久体力资格只存放在独立体力键中；
- 清除小游戏本地数据或重新安装会重新获得初始体力，这是纯本地首版的已知限制。

迁移和恢复：

- 保持存储键和 `schemaVersion: 1`，增加可选字段 `unlockedLevels`、`refundedLevels`；缺失时补空数组，已有余额和恢复锚点按原规则保留。
- App 启动时从普通进度中提取已通关的有效 catalog 坐标，以及有效的 `lastPlayed`，交给服务恢复免费资格。
- 迁移与自然恢复一次落盘；保存失败保留待重试标记，`flush()` 重试。新解锁依然要求扣费和资格一起保存成功。
- 旧版本没有完整的未通关访问历史，因此只能恢复已通关和最后游玩记录能证明的资格，不按余额猜测曾进入哪些关卡。
- 新版记录每个付费解锁，即使未通关、后来玩过其他关卡、普通进度保存失败或进程重启，也不会重复收费。
- 已保存的永久资格在余额为 0 或存储暂时不可写时仍可免费进入；尚未解锁的新关必须保存成功。
- 解锁和返还记录均不参与云同步。降级到会丢弃字段的旧客户端会丢失对应记录，不保证这种往返降级。
- 已完成关卡的有效最佳时间不超过 1 分钟且尚无返还记录时，启动／回前台会补返一次，包括旧存档；缺少有效最佳用时不能推定快通。

### 5.4 加载规范化

加载时必须执行：

```text
存档不是普通对象                    → 初始化为 5
schemaVersion !== 1                 → 初始化为 5
balance 不是非负安全整数             → 初始化为 5
balance >= naturalCap               → nextRecoveryAt = null
balance < naturalCap 且时间非法       → nextRecoveryAt = now + interval
balance < naturalCap 且时间已到       → 立即按离线时间结算
unlockedLevels 缺失或不是数组        → 空数组，再恢复已知进度资格
unlockedLevels 含重复或非法键        → 保留合法键，去重排序
refundedLevels 缺失或不是数组        → 空数组
refundedLevels 含非法或未知关卡      → 保留 unlockedLevels 中的合法键，去重排序
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
- 校验关卡键，幂等地消费首次解锁成本，与永久资格一起保存；
- 接收 App 提供的已知进度键，免费恢复既有资格；
- 验证通关用时，按关卡记录并返还首次 1 分钟快通体力；
- 安全持久化；
- 返回只读快照；
- 在存储恢复后重试尚未落盘的自然恢复状态。

服务不得负责：

- 场景切换；
- 创建或持有 `GameRunner`；
- 判断关卡是否存在、前置关卡是否完成或开发者工具顺序门禁；
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
  restoreUnlockedLevels(levelKeys, now);
  unlockOrdinaryLevel(levelKey, now);
  refundQuickClear(levelKey, elapsedMs, now);
  quickClearRefundState(levelKey);
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
  ordinaryUnlockCost: 1,
  recovering: true,
  nextRecoveryAt: 1788469500000,
  remainingMs: 184000,
  overflow: 0,
  canUnlockOrdinaryLevel: true,
  persisted: true
}
```

规则：

1. 查询前先结算自然恢复。
2. `remainingMs = max(0, nextRecoveryAt - now)`。
3. `overflow = max(0, balance - naturalCap)`。
4. `canUnlockOrdinaryLevel = balance >= ordinaryUnlockCost`，只表示能否购买一个新解锁，不限制已解锁关卡的进入。
5. 返回新对象，调用者不能修改内部状态。
6. 只有余额、恢复锚点、解锁资格或非法状态修复发生变化时才尝试写存储。
7. 每帧调用 `snapshot()` 不能导致每帧或每秒写存储。

自然恢复已经在内存中正确结算，但本次存储写入失败时，可继续在当前进程使用已结算状态，并标记待重试；重启后会依据旧时间戳重新得出等价结果。消费操作则使用更严格的持久化规则。

### 7.4 `unlockOrdinaryLevel(levelKey, now)`

`levelKey` 是 App 完成 catalog 校验后传入的 `setIndex:levelIndex`，两部分必须为非负安全整数。
无效键返回 `invalid-level`，不扣费。服务不依赖 catalog、ProgressStore 或 Runner。

目标已在 `unlockedLevels` 时返回 `ok: true, spent: 0, before: balance, after: balance`，不要求余额大于 0，
也不为重复进入写存储；自然恢复造成的状态变化仍按原规则保存。

首次解锁成功：

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
1. 结算自然恢复，验证 levelKey
2. 已解锁直接返回成功，spent = 0
3. 未解锁时检查余额
4. 克隆候选状态，同时扣除成本并加入 unlockedLevels
5. 根据扣除后的余额维护 nextRecoveryAt
6. 一次持久化候选余额、恢复锚点和解锁列表
7. 保存成功后才提交内存状态，否则两者都不生效
8. 返回成功，spent = 1
```

首次解锁持久化失败时：

- 不得扣除体力或记录永久解锁；
- 不得启动新 Runner；
- 不得修改场景；
- 不得把失败当作免费进入。

该门控对新解锁采用 fail-closed，避免只扣费不发资格或只发资格不扣费。已有永久资格的免费游玩不依赖新写入。

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

`restoreUnlockedLevels(levelKeys, now)` 合并 App 提供的已知完成和最后游玩键，不消费体力；不能根据开发者工具全开标记批量赠送资格。
恢复资格与自然恢复可以保留待保存状态并由 flush 重试，新付费资格只在写入成功后生效。

### 7.6 `flush(now)`

- 重试尚未落盘的自然恢复、规范化、既有进度资格恢复及已达成的返还；
- `onHide()` 可调用一次；
- 不得循环写存储；
- 不得在 `tick()` 每帧调用；
- 不负责网络同步。

---

### 7.7 首次 1 分钟通关返还

`refundQuickClear(levelKey, elapsedMs, now)` 只接受有效普通关卡键及有限的非负用时；`elapsedMs <= 60000` 包含恰好 60 秒。
关卡必须已解锁、尚未在 `refundedLevels` 中。首次游玩超时、首次通关超时或失败都不会用掉返还资格；以后第一次达成快通仍能返还。

- 成功返回 `{ ok: true, refunded: 1, snapshot }`；超时、已返还或无解锁资格返回 `refunded: 0`。
- 用时由 App 从成功终局的 Runner 读取，与结果页本次计时一致，沿用现有暂停、重置及失败重试计时语义；不另造计时器或读取首次游玩时间。
- 返还增加余额和写入 `refundedLevels` 是同一个候选状态，一次保存成功后才提交；持久化失败时不增余额、不标记已领取，返回 `refund-persist-failed`。
- 返还后低于 5 保留原恢复锚点，达到或超过 5 清空锚点；不裁剪超额余额，不允许安全整数溢出。
- 失败返还暂存在内存去重集合中，hide/show 的 flush 可以合并重试；逐帧 snapshot 不反复写入。
- App 在启动／回前台用普通完成记录的有效最佳用时恢复遗漏返还，已领取标记防止重复。若体力和普通进度同时保存失败且进程被杀，未落盘的快通无法恢复，但资格未被扣除，之后仍能重新达成。
- `quickClearRefundState(levelKey)` 返回新的纯对象 `{ amount: 1, status }`，状态为 available、pending、claimed 或 unavailable，用于状态检查，结算面板不绘制该状态。

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

// knownLevelKeys 由有效 catalog 中的已通关和 lastPlayed 坐标构造。
this.stamina.restoreUnlockedLevels(knownLevelKeys, Date.now());
this.recoverStaminaRefunds(Date.now());
this.staminaSnapshot = this.stamina.snapshot(Date.now());
this.staminaFeedback = null;
this.lastStaminaSecond = -1;
```

直接构造 `ClearedApp` 的轻量宿主应与正式 bootstrap 有同样的体力默认行为。

已有非体力 App 测试会连续打开超过 5 个不同新关卡，因此这些测试必须显式注入测试专用固定体力 fixture；不得为保持旧测试通过而让生产构造默认禁用体力。

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
  6. 已通关目标免费；否则 stamina.unlockOrdinaryLevel(levelKey, now)，已解锁返回 spent = 0
  7. 新解锁体力不足或持久化失败 → 保持原场景和原 Runner，返回 false
  8. 已有资格或首次解锁成功后提交 runContext / runner / 索引
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

### 8.4 状态提交必须在已有资格或首次解锁成功后

以下状态修改必须位于 Runner 验证和解锁检查成功之后；已有永久资格不再扣费：

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

新关解锁体力不足时，例如普通成功结果页点击尚未付费解锁的“下一关”：

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

首次解锁持久化成功后，`ProgressStore.markOpened()` 或普通进度保存失败不回滚体力；永久资格已和扣费同存，重启后也不会再扣费。

首次解锁自身的存储失败必须阻止开局；已有永久资格的免费进入不要求重新保存体力。

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

这些位置不得扣费；入口 action 把进入意图路由到 `openLevel()`。`onPathCompleted()` 在确认普通胜利后可以编排一次快通返还，但仍不得扣体力；completion-policies 和 ProgressStore 不感知体力。

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
this.recoverStaminaRefunds(Date.now());
this.stamina.flush(Date.now());
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
    ordinaryUnlockCost: 1,
    recovering: true,
    nextRecoveryAt: 1788469500000,
    remainingMs: 184000,
    overflow: 0,
    canUnlockOrdinaryLevel: true,
    persisted: true
  },

  staminaFeedback: {
    reason: 'insufficient-stamina',
    until: 1788469322000
  },
  homeStaminaExpanded: false
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

| 状态 | 主行 | 副行（仅首页点击后） |
| --- | --- | --- |
| `balance < 5` | 闪电 + `当前体力` | `MM:SS` |
| `balance >= 5` | 闪电 + `当前体力` | `体力已满` |

示例：

```text
闪电 4
 03:27
```

```text
闪电 5
  体力已满
```

```text
闪电 8
  体力已满
```

按最新显示要求统一只显示 `当前体力`，例如 `5`、`8`。`naturalCap` 仍参与恢复规则，
但不在徽标中显示；合法的超额余额不裁剪。首页副行默认隐藏，点击后才按上表展示。

选关页的体力徽标只显示闪电及 `当前体力`，不显示倒计时或“体力已满”，也不注册 hit。普通游玩／结果顶部不显示体力徽标。首页按后续确认的交互要求注册 `home:stamina`，
只切换下方详情的展开状态；不显示加号、不打开新页面、不消费体力、不保存 UI 状态。

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

主页顶部布局（2026-09-03 调整）：

- 左侧账号头像；
- 最右侧为体力按钮；
- 音乐按钮在左、货币余额居中、体力按钮在右，三者保留独立区域。

体力按钮：

```js
{
  x: width - 78,
  y: safeTop + (skin.layout.homeTopUiOffset || 0) + 8,
  w: 64,
  h: 44
}
```

不改变 Logo、每日挑战、回廊和开始按钮的既有布局合同。

音乐按钮使用相同 y 和 44×44 点击区域；其 x 根据货币区宽度向左计算。货币区宽度随屏幕在 62–78px 之间变化，不注册充值命中。首页体力点击区域为 64×44，为 `当前体力` 留出空间；默认只显示闪电和当前数量；
点击体力按钮后，余额低于 5 时下方显示 `MM:SS`，余额大于等于 5 时显示“体力已满”。
再次点击收起，离开首页或切后台后恢复收起状态；不增加自动关闭计时器。
`homeStaminaExpanded` 由 App 持有并通过纯 ViewModel 传入 Renderer，下方详情文字不额外注册 hit。

### 11.5 选关页位置

选关页左上已有主页按钮，中间为标题，右上可显示体力。

建议：

```js
{
  x: width - 100,
  y: headerTop + 4,
  w: 86,
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

选关卡片沿用顺序开放状态：尚未满足前置条件的关卡锁定；已满足顺序条件的新关可点击并尝试首次解锁。
已有永久解锁或完成记录的关卡在 0 体力时直接免费进入，不显示不足反馈；仅新解锁余额不足时显示反馈。

### 11.6 普通游玩页和结果页

普通游玩及普通结果页顶部不显示体力 UI。返回、居中的关卡编号、音乐和重置按钮保持同一水平线，
用时位于关卡编号下方。首页、选关页仍显示体力；普通结果面板不显示快通返还的规则说明或到账状态文案。

不得修改：

- `headerHeight`；
- `boardTop` 和 `boardBottom`；
- Portal 提示带；
- 棋盘单元格尺寸；
- 底部提示和回撤按钮；
- 棋盘层的布局；普通结果面板采用收紧后的常规高度，不为已移除的返还文案留白。

普通结果页通过 `drawPlay()` 绘制底层后再叠加 `drawResult()`，两层顶部均不增加体力徽标。

普通成功结果只显示完成标记、“新纪录／完成”、本次与最佳用时，以及选关、重玩、下一关和可用的分享按钮。
不固定显示快通规则、“已返还1点体力”或其他返还状态；到账及保存异常仍使用全局短暂反馈。
面板目标高度为 246px，有分享按钮时为 300px，并受安全区限制；取消为原两行文案增加的 32px 空间。
返还状态和本次到账数量仍可通过纯数据检查，体力返还与去重逻辑不受此展示调整影响。

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

本期支持快通返还及 `balance > 5`，不提前实现好友助力接口或 UI。

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

本期不增加没有调用者的 `applyFriendGrant()`、好友面板或外部奖励队列。快通返还仅依赖本地普通胜利及去重存档，不连接分享／广告 RewardService。

---

## 14. 严格文件实施边界

### 14.1 允许新增的生产文件

| 文件 | 唯一允许内容 |
| --- | --- |
| `src/config/stamina.js` | 初始值、自然恢复上限、恢复间隔、普通首次解锁成本、快通阈值及返还数量 |
| `src/services/stamina-service.js` | 独立存储、规范化、恢复、普通永久解锁、快通返还、幂等存档、快照、flush |
| `docs/stamina-system.md` | 本实施合同 |

### 14.2 允许修改的生产文件

| 文件 | 允许修改范围 |
| --- | --- |
| `src/bootstrap.js` | 导入配置和服务、创建实例、注入 App |
| `src/app.js` | 构造注入、体力快照、tick、buildModel、openLevel、onHide、onShow、不足反馈，以及首页展开、普通胜利快通返还与恢复编排 |
| `src/ui/canvas-renderer.js` | 闪电图标、徽标、倒计时格式、不足／返还提示、普通成功结果规则文案及场景调用 |
| `README.md` | 用户可见规则、存档说明和本文链接 |

### 14.3 `src/app.js` 的方法级边界

仅允许修改：

```text
文件顶部 require
constructor()
tick()
buildModel()
performAction()：仅首页体力展开／收起与离开页面时收起
onPathCompleted()：仅普通胜利后的体力返还编排
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
recoverStaminaRefunds()
```

禁止顺手重构：

- 每日挑战状态机；
- 账号登录与同步；
- 分享；
- 提示解锁；
- 广告；
- 普通结算策略及进度协议（App 可编排快通返还）；
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
drawResult()：仅结算文案和收紧后的面板高度
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

所有普通关卡首次解锁成本统一为 1，不给 92 个关卡逐个增加字段，不改变 ID、坐标、解锁顺序或解答。

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
20. `balance`、时间戳和配置的整数边界得到校验；
21. 同一关重复解锁返回 spent = 0，0 体力和重启后仍然免费；
22. 扣费与永久资格原子落盘，失败不发资格、不扣费；
23. 旧字段迁移、合法键去重、非法键拒绝、存储数组副本与已知资格恢复；
24. 59999／60000／60001ms 边界、先慢后快、重复快通去重、跨重启去重；
25. 返还保存失败不增内存余额，多笔待返还合并 flush，恢复锚点及超额余额正确。

### 15.2 `stamina-app.test.js`

必须覆盖：

1. 首次成功进入新关消耗 1，重复进入免费；
2. 顺序未开放、无效目标、Runner 创建失败不消耗；
3. 重置、失败重试、成功结果重玩免费；
4. 下一关仅在目标尚未解锁时消耗，最后一关返回列表免费；
5. 新解锁不足或保存失败时保持场景、Runner、result、进度及选关位置；
6. 普通 Portal 同样只支付一次，未完成即离开再进入也免费；
7. 永久记录在 0 体力、存储暂时不可写、进程重启、最后游玩已变更时仍然有效；
8. 旧存档的完成和最后游玩记录恢复免费资格，不改变原余额；
9. 每日挑战、完整两关切换、每日重试与重玩均不消费普通体力；
10. hide/show 正确恢复体力且不重复扣费；
11. 普通进度保存失败不撤销已保存的永久资格；
12. 首页开始、选关、重玩和下一关均经过同一幂等入口；
13. 不足反馈清理帧、首页体力只读展开／收起保持正确；
14. 先超时通关、再重玩首次快通返还一次，firstClear 为 false 仍可返还；
15. 快速失败不返还，普通 Portal 快通返还，每日不返还；
16. 返还保存失败仍保留结果，重启或回前台利用已保存的快通证明重试；
17. 返还状态仍可查询，但结算面板不显示规则或状态文案；短屏与分享按钮不重叠。

### 15.3 `stamina-renderer.test.js`

必须覆盖：

1. 主页显示体力徽标；
2. 选关页显示体力徽标；
3. 普通游玩页不显示体力徽标；
4. 普通结果页顶部不显示体力徽标，面板不显示快通返还说明或状态文案；
5. 每日挑战页不显示普通体力徽标；
6. 只有首页体力按钮注册 `home:stamina`，其他徽标与详情文字不注册 hit；
7. 4 点显示倒计时，首页默认隐藏且点击后在按钮下方显示；
8. 5 点显示 `5`，展开后显示“体力已满”；
9. 8 点显示 `8`，展开后同样显示“体力已满”，不显示额外数量说明；
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
| 首次启动 | 首页最右侧显示 `5`，点击体力后下方显示“体力已满” |
| 首页点击体力 | 展开详情，再次点击或离开首页后收起；不扣费、不保存展开状态；低于 5 显示倒计时，达到或超过 5 显示“体力已满” |
| 首次解锁 5 个不同普通关卡 | 体力依次降到 0 |
| 第 6 个新关解锁 | 保持当前页并显示不足提示 |
| 0 点重复进入已解锁关卡 | 免费进入，不显示不足提示 |
| 0 点等待 5 分钟 | 恢复到 1 |
| 2 点切后台 12 分钟 | 返回为 4，下一点约剩 3 分钟 |
| 4 点时首次解锁另一个新关 | 变为 3，原倒计时不重置 |
| 当前关点击重置 | 不扣体力 |
| 失败后重试 | 不扣体力 |
| 通关后重玩 | 免费；本关尚未返还时，首次达成 1 分钟快通仍可返还 |
| 首次通关 61 秒，重玩 45 秒 | 只在 45 秒这次返还 1 点 |
| 已返还后再用 30 秒通关 | 不重复返还 |
| 恰好 60 秒／超过 60 秒 | 前者可返还，后者保留挑战资格 |
| 通关后下一关 | 仅尚未永久解锁时扣 1 |
| 最后一关返回列表 | 不扣体力 |
| 进入每日挑战 | 普通体力不变 |
| 测试存档手动设为 8 | 显示 8，停止恢复 |
| 8 连续消费到 5 | 始终没有自然恢复倒计时 |
| 5 再消费到 4 | 出现完整 5:00 倒计时 |
| 杀掉小游戏后再启动 | 根据时间戳补算，永久解锁列表保留，重入免费 |
| 切换任意主题 | 闪电和文字仍可读 |
| 普通 Portal 关卡 | 棋盘、提示和触摸区域不变 |
| 首次解锁存储失败 | 拒绝解锁，余额和资格都不提交，原页面保持可用 |
| 已解锁关卡遇到存储写入失败 | 仍可免费进入 |

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

- 所有普通入口按关卡幂等解锁，每关终身只扣一次（当前本地存档内）；
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

- 首页、选关显示体力，普通游玩／结果顶部不显示体力；
- 每日场景不展示；
- 无图片资源；
- 仅首页只读 `home:stamina` 交互，无领取或购买入口；
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
- 所有普通关卡只在 `openLevel()` 首次解锁时消费，重复进入、重玩和重启后再进入免费；
- 永久资格与扣费在独立体力键内一次落盘，旧已知访问资格保留；
- 每关首次达成 1 分钟快通返还 1 点，余额与去重标记同存，重玩和重启不重复领取；
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
[ ] 体力消费只存在于 openLevel()，且每个关卡只扣一次
[ ] 0 体力也能重入已解锁关，重启不丢永久资格
[ ] 旧完成／最后游玩资格保留，扣费与新增资格同存
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
[ ] 仅首页体力按钮有 hit，其他体力徽标和详情文字没有 hit
[ ] 不增加尚不可用的加体力按钮
[ ] 未来分享/广告不能直接修改余额
[ ] node tests/run.js 通过
[ ] node scripts/check-package-budget.js 通过
[ ] git diff --check 通过
[ ] 开发者工具和真机验收结果已记录
```

## 20. 初版实施记录（2026-09-03；消费规则已由第 22 节调整）

以下保留初版实施记录；最新消费和存档规则以当前第 1—8、15—19、22 节为准。第 16 节的设备验收仍未执行，不能由 Node 结果代替。

| 实现文件 | 实际职责 |
| --- | --- |
| `src/config/stamina.js` | 冻结 5 / 5 / 300000ms / 1 四项配置，无生产无限体力开关 |
| `src/services/stamina-service.js` | 独立键加载与规范化、绝对时间恢复、消费候选状态先落盘后提交、快照副本和待保存状态 flush |
| `src/bootstrap.js` | 创建并注入体力服务 |
| `src/app.js` | 仅 `openLevel()` 扣费；先验证并创建局部 Runner，再消费并提交场景；复用既有可注入时钟、tick 与生命周期 |
| `src/ui/canvas-renderer.js` | Canvas path 闪电、三处普通场景徽标、结果沿用徽标、全局 2200ms 无 hit 反馈 |
| `tests/stamina-service.test.js` | 恢复／超额余额／异常存档与整数边界／存储失败／低频落盘／重启等价性 |
| `tests/stamina-app.test.js` | 入口扣费、免费重试／重置、失败原子性、每日两关与重玩隔离、生命周期和反馈清理帧 |
| `tests/stamina-renderer.test.js` | 11 套主题 × 320px／390px，标题／按钮避让、棋盘与 Portal 布局不变、每日不展示、文案与无 hit |
| `tests/helpers/stamina-fixture.js` | 注入时钟、存储故障和仅供旧测试使用的固定体力 fixture |
| `tests/architecture-boundaries.test.js`、`tests/run.js` | 架构边界与三组新测试注册 |

`tests/app-smoke.test.js` 和 `tests/theme-system.test.js` 仅增加 fixture 注入，保留全部原步骤和断言。
前者的长流程超过 5 次开局；后者重开普通关后仍对全部存储做主题恢复不写入断言，需要隔离无关体力消费。
没有修改玩法核心、gameplay、关卡数据、普通／每日／云同步协议、平台适配、资源、发布配置或旧页面。

实现细节：服务仅对真实状态变化或修复写入，失败后保持待保存状态，`flush()` 显式重试；高频 snapshot 不重试失败写入。
消费写入失败不提交候选余额和恢复锚点，普通进度保存失败不会阻止已付费的有效尝试进入。
App 使用现有 `clock` 注入点和 `clockNow()`；生产默认仍为设备时间，不全局修改 `Date.now()`。
时间戳限定为非负安全整数且在 JavaScript Date 范围内，异常输入回退；边界处为完整恢复间隔预留加法空间。
选关页徽标使用右侧 86px 区域，避免 320px 时覆盖中心标题；游玩页保留全部原棋盘与提示带计算。

自动化验证：

- `node tests/run.js`：59 组全部通过（原 56 组 + 3 组体力测试）。
- `node scripts/check-package-budget.js`：通过；主包 2,694,221 字节（2.569 MiB / 3.2 MiB），最大分包 1.451 MiB / 3.5 MiB，总包 15,985,161 字节（15.245 MiB / 18 MiB）。这是源码字节估算。
- `git diff --check`：通过；修改范围检查确认无关卡、资源、旧页面或无关格式化变更。

尚未执行的微信开发者工具／Android／iOS 验收：

- 首页安全区，选关页右上徽标，普通游玩／结果顶部和 Portal 布局；
- 约 320px 窄屏的真实字体与触控，主题切换后的图标颜色；
- 后台停留 5 分钟以上的恢复，杀进程重启后的离线补算；
- 各入口体力不足反馈及到期清除；
- 真实设备时钟调整行为，以及开发者工具最终代码包分析。

## 21. 首页体力交互调整（2026-09-03）

根据后续确认，将首页体力移到原音乐按钮的位置，音乐按钮左移；首页详情默认收起，点击展开。
体力在规定页面显示当前数值；最新格式见第 24 节，统一为 `当前体力`，不显示自然恢复上限或“额外 +N”。
闪电图标放大：紧凑布局为 22px，常规布局为 24px；数量文字、按钮位置和点击区域不变。
修改仅涉及 App 展示状态、Canvas 首页与徽标绘制、相应回归断言和文档。自然恢复、消费与持久化合同不变。
原第 20 节“无 hit”约束继续适用于全局反馈和非首页徽标；首页 `home:stamina` 是本次明确增加的只读查询入口。

`node tests/run.js` 59 组通过，覆盖首页点击展开／收起、离开与后台收起、存档不变，以及 11 套主题在 320px／390px 下的按钮避让。
包预算和 `git diff --check` 通过；首页安全区、真实字体、音乐与体力按钮触控仍待开发者工具／真机验证。

## 22. 体力改为永久解锁费用（2026-09-03）

根据后续确认，体力从“每次开局消费”改为“每个新关首次解锁消费 1 点”。本地同一关解锁后长期免费，
覆盖重玩、返回选关再进、未通关离开再进及进程重启后的进入；每日挑战规则不变。

- `StaminaService.unlockOrdinaryLevel(levelKey, now)` 根据独立存档中的永久列表幂等消费；配置及快照字段改为 `ordinaryUnlockCost`／`canUnlockOrdinaryLevel`。
- 同一个 `cleared:minigame:stamina:v1` 保存 `unlockedLevels`，扣费与新增资格一次提交；保留余额、自然恢复和合法超额余额规则。
- App 在启动时恢复已完成和最后游玩关卡的资格；顺序开放条件继续由原 ProgressionService 决定，不用体力跳关。
- 未修改普通进度、每日进度、云同步、玩法核心、关卡数据或平台协议；首页位置、点击详情、实际超额数量与放大图标继续保留。
- 尚需开发者工具／真机验证：0 体力重玩、未通关退出重进、杀进程后免费再进、新关保存失败、旧存档升级和每日隔离。

自动化验证：`node tests/run.js` 59/59 组通过；`node scripts/check-package-budget.js` 通过，
当前本地源码主包 2.610 MiB / 3.2 MiB、总包 15.286 MiB / 18 MiB；`git diff --check` 通过。
普通进度、每日进度、云同步和关卡数据均无改动；既有首页 UI 调整继续保留。

## 23. 首次 1 分钟通关返还及结果页（2026-09-03）

按用户确认，以“本关第一次达成 1 分钟内通关”为条件，不要求第一次玩或第一次通关。
普通关卡包含 Portal，每关最多返还 1 点；此前超时、失败、离开或重玩均不消耗快通资格。
旧存档中已有有效快通最佳时间、但尚无返还标记的关卡可补返一次；没有有效用时的记录不能推断为快通。

按后续确认，结算面板已移除“本关首次在1分钟内通关，返还1点体力”及“已返还1点体力”等固定文案，
并收回两行文案的额外空间。首次快通返还和一次性领取逻辑保留，正常到账仍有短暂的“1分钟内通关，体力 +1”反馈。
新增 `refundedLevels` 与余额同存，返还失败不增加内存余额；启动／前台恢复从普通最佳记录重试，且不改普通进度 schema。

自动化覆盖 60 秒边界、先慢后快、重复／重启去重、恢复与超额余额、失败退款、Portal／每日隔离，
以及 320×568 下含分享按钮的结算排版。开发者工具／真机仍需验证真实用时、结算字体与安全区、保存失败恢复及杀进程重开。

## 24. 体力徽标显示调整（2026-09-03，2026-09-04 更新）

体力徽标统一只显示当前实际余额，例如 4、5，合法超额为 6；自然恢复上限不显示。
选关页只显示闪电及当前数量，不显示上限、倒计时或“体力已满”，与标题及主页按钮水平对齐。普通游玩／结果顶部已移除体力 UI，关卡编号和用时居中；棋盘及 Portal 提示位置不变。
首页默认收起详情；点击时余额低于 5 显示倒计时，余额大于等于 5 显示“体力已满”。再次点击或离开首页收起。
保留放大的 Canvas 闪电，首页体力按钮扩为 64×44，仍位于最右；音乐按钮在左侧且相隔 8px。
只改展示与点击区域，不修改体力总余额、自然恢复、首次解锁或快通返还规则。

第 23—24 节累计验证：`node tests/run.js` 59/59 组通过；包预算通过，当前本地源码主包 2.615 MiB / 3.2 MiB、
总包 15.291 MiB / 18 MiB；`git diff --check` 通过。结算文案、首页体力点击详情和首次快通返还仍待开发者工具／真机验收。
主页顶部当前顺序为“音乐按钮 → 货币余额 → 体力按钮”，头像保留在左侧独立区域。货币区没有充值或体力兑换入口；体力的数值、展开详情、恢复计时和命中 ID 均保持原合同。布局继续按动态宽度和安全区计算，并覆盖 320／375／390 宽度自动测试。

2026-09-04 更新只改变徽标文案与紧凑宽度：移除 `/naturalCap`，首页及选关页均只显示当前余额；
同时移除首页金币区域的灰色底板。最新自动化为 `node tests/run.js` 64/64 组通过，另以 280／320／390
宽度进行 Canvas 离屏排版检查；微信开发者工具和真机视觉／触控仍待验收。

## 25. 阶段 5 云权威扩展（2026-09-06）

阶段 5 保留同一个本地存档键和全部产品规则，只在已完成旧存档迁移、且测试开关明确开启的账号上增加云端权威：

- 首次联网通过 `STAMINA_BOOTSTRAP` 上传本机现有余额、恢复锚点、永久解锁和返还键，成功后不再重复初始化；
- 服务器使用相同的自然上限 5、恢复间隔 5 分钟和快通上限 60000ms，并以服务器时间惰性结算恢复；
- `STAMINA_LEVEL_UNLOCKED` 在事务中按 levelKey 只扣一次；多设备同时解锁同一关最多扣 1 点；
- `STAMINA_QUICK_CLEAR_REFUNDED` 要求服务器已有该关完成记录，并按 levelKey 只返一次；
- 客户端仍先本地反馈并把操作写入账号隔离的 outbox，服务器回执到达后再应用权威快照；
- state.read 对已初始化的体力域始终返回服务器时间推导后的紧凑快照，因此回到前台可自然收敛。

冲突政策有意保持轻量：玩家通常在单设备、联网状态下游玩。若两台设备长时间离线后同时消费同一份体力，恢复联网后允许服务器接受顺序决定结果，并用权威快照覆盖少数乐观差异；不建设补偿流水、设备租约或复杂反作弊。普通通关事实使用独立进度 operation，不会因为体力冲突被删除。

客户端自动化覆盖超额余额、首次初始化、离线队列、同关去重、权威覆盖和偏好共存；后端集成测试覆盖同关并发、服务器时间恢复、一次快通返还和账本。测试环境真机已验证账号 A 首次 bootstrap 后体力 8、冷启动恢复、iPhone/iPad 对第 10 关只扣一次且只返一次，以及离线进入第 11 关后恢复联网只同步一笔 8→7 解锁；三次前后台切换未重复结算。低余额精确 5 分钟恢复和故意制造的双设备长期离线冲突保留为自动化覆盖，不扩建重型补偿系统；账号 B 未进入写白名单。
