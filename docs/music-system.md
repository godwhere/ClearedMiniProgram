# 音乐选择与《漫步》

回廊 → 音乐复用 2 列 × 3 行画廊与现有奖励弹窗。默认《格间微光》继续免费；《漫步》（Stroll）花费 **10000 金币永久解锁**。购买与应用分开，可以先解锁、稍后播放；不改变连线、关卡、主题、特效或奖励数值。

## 曲目与资源

| 项目 | 默认曲目 | 新曲 |
| --- | --- | --- |
| 曲目 ID | `grid-glow` | `candy-day-stroll` |
| 名称 | 格间微光 | 漫步 / Stroll |
| 奖励 ID | 免费，无购买项 | `music:candy-day-stroll` |
| 音频 | `assets/audio/bgm/cleared-bgm.m4a` | `assets/audio/candy-day-stroll/stroll.m4a` |
| 普通分包 | `audio-bgm` | `audio-candy-day-stroll` |
| 预览 | Canvas 音符 | `assets/music-previews/candy-day-stroll.png` |
| 音量 | 0.28 | 0.28 |

`src/config/audio.js` 的 `tracks` 集中控制顺序，`bgm` 仍引用默认曲目；`rewards.js` 只增加货币解锁项，不改默认资产。`game.json` 与 `src/config/subpackages.js` 同时声明新资源根，复用已有 `SubpackageService`。

《漫步》是原创旋律、和声与编曲，104 BPM、D 大调、80 小节，时长约 **184.615 秒（3:05）**。木琴主旋律配规律的钢琴／拨弦、轻低音与打击乐，八音盒和长笛分段回应；结构为引子、A、B、留白、A 回归、B 回归、循环过渡。尾部与开头按完整乐句衔接，无损母版折回混响尾音并作循环均衡；游戏版导出 AAC-LC、44.1 kHz、双声道、目标 80 kbps、1,908,036 bytes。微信播放器的实际循环接缝仍需真机听验。

## 购买、保存与下载

- 锁定卡片可显示主包封面和价格；点击打开确认弹窗，不下载新音频。音乐奖励 ID 与棋子主题 `theme:music` 独立。
- 微信使用同一云确认钱包，提交 `economy.purchase` 的 `kind:'music'`。扣款与永久拥有权同事务确认；超时、重启与重放沿用持久化 operationId，重复购买不再扣款。离线不能推断购买成功。2026-10-08 已部署到现有 CloudBase 环境，三个函数 Active，完整代码及依赖回读匹配测试包；完整配置与门禁不变。
- 本地模式沿用 `RewardUnlockService.purchase/purchaseAsync`，写失败不提交扣款或拥有权。已有永久拥有权允许离线使用已就绪的资源。
- 解锁后应用通过 `ClearedApp.setMusic()` 下载目标包，展示进度和失败重试；成功后保存 `settings.musicId` 并切换。下载或保存失败保留旧曲与永久拥有权，不再次收钱。关闭应用弹窗、快速改选、账号变化或销毁后，旧回调不得覆盖新选择。
- 永久拥有权通过既有 entitlements 域同步；选曲仅保存在本设备。云偏好及备份使用既有 `skinId/clearEffectId/soundEnabled` 和支持新客户端的 `clearMode`，选曲不新增同步字段或存储 key。非法／无权的选曲回退默认曲。
- 选曲不打开声音。启动播放仍需声音开启和首次有效交互；后台、音频中断、静音与销毁继续走 `AudioService` 生命周期。包就绪状态仅在进程内保存，宿主清理缓存后可重新下载。

## 账号页音量

主页声音按钮已移除。账号页“游戏设置”的消除方式下方提供 0–100% 滑条，同时控制 BGM、点击、连线、逐格消除及结果提示音；实际音量为素材基础音量乘主音量，100% 保留原混音比例。新旧存档缺字段使用 100%，原静音账号显示 0%，非法值回退安全默认。

`AudioService` 持有试听值；拖动更新现有 BGM 和音效池，不重建上下文或重启正在播放的音乐，后续创建的声音同样使用当前音量。0% 暂停声音并取消剩余消除触发；首次交互、分包加载、后台、音频中断及销毁门禁继续有效。

松手时 `ProgressStore` 在既有 v2 存档中一次提交 `settings.soundVolume` 与 `soundEnabled`，失败保留内存和持久化确认值并恢复试听。`soundVolume` 记录本设备最后保存的正音量，0% 仅将 `soundEnabled` 设为 false；云端重新开启声音时恢复本设备原音量。百分比不进入云偏好或云备份，静音变化才通过既有单字段偏好操作同步。独立 App 使用同一异步持久化事务，保存中禁止第二次拖动，不新增存档 key 或云合同。

## 封面与音源记录

封面由内置 **imagegen** 生成，糖果小径、阳光和音符采用透明贴纸构图；运行时仅做等比缩小及 PNG-8 导出，没有重新绘制生成内容。成品为 128×128、32 色含透明、2,502 bytes，卡片名称、价格和锁图标由 Canvas 绘制。加载／尺寸失败时回退双音符。规格沿用 [回廊预览合同](corridor-preview-assets.md)，并纳入 `scripts/validate-gallery-previews.js`。

封面提示词（供复用；生成时使用工作名，图片不含文字，当前显示名为《漫步》）：

> Use case: stylized-concept. Asset type: a single square transparent music cover icon for the mobile puzzle game Cleared, for an original cheerful relaxing track called Candy Day Stroll / 晴糖漫步. Create a charming compact winding little path made from pastel candy-like rounded tiles, leading toward a small warm golden sun, with two simple musical-note shapes integrated beside the path. Polished casual-game illustrated sticker, clean rounded forms, soft dimensional cel shading, peach pink, mint, cream and gentle yellow, cheerful and easygoing. One centered cohesive icon, readable at 128x128 pixels, with 8% clear padding around the artwork. Real transparent background and clean alpha edges. No people, no background scenery, no frame, no lettering, no logo, no watermark, no UI, no coins or price.

音频使用 S. Christian Collins 的 GeneralUser GS **2.0.3** 演奏，由 FluidSynth 渲染。作者许可允许私人／商业音乐创作，同时披露部分早期采样来源不能完全追溯；这里保留该披露，不声明全部采样来源均已独立核实。完整许可见 [GeneralUser-GS-LICENSE.txt](music-assets/GeneralUser-GS-LICENSE.txt)，固定源记录见 [asset-sources.json](music-assets/asset-sources.json)。音源库及编曲工具不进入游戏包；无损母版、MP3、MIDI 与 MusicXML 保留在独立音乐交付目录。

## 验证与发布边界

运行 `node tests/run.js` 和 `node scripts/validate-gallery-previews.js`；`node scripts/check-package-budget.js` 检查主包 ≤1.63 MiB、各分包 ≤3.50 MiB、总包 ≤18 MiB。相邻后端运行 unit/integration/concurrency、语法和 catalog parity 校验。回归覆盖 10000 定价、余额不足、原子购买、共享钱包竞争、超时重启重试、重复购买、封面失败回退、下载失败重试、保存失败、改选／关闭竞态和无权存档回退。

开发者工具普通编译与音乐卡片／购买弹窗已检查。独立只读媒体检查成功加载新分包，临时 `InnerAudioContext` 触发 `canplay`，读取时长 184.615 秒，随后销毁；未切换玩家音乐或实际扣除金币。macOS 原生 AAC 解码也通过。生产云函数已支持 `music:candy-day-stroll`；客户端 116 组、后端 101 项与三个实际线上候选包各 11 项回归通过，管理端负向调用继续拒绝缺少原生微信身份的请求。小游戏上传、真机实际购买及重进恢复、iOS/Android 试听与弱网／后台恢复／循环接缝验收仍待执行。玩家入口和音频需随包含音乐包的新客户端上传，不由后端部署下发。

账号页音量调整后的客户端 119 组回归通过，覆盖新旧／非法存档、已有与新建音频上下文的缩放、BGM 连续播放、静音、触点归属、越界、取消／导航／后台／尺寸变化、同步及异步写入失败回退和原子提交。中英文、280×568／390×844／844×390、普通／备份模式共 12 个离线 Canvas 布局已检查；微信开发者工具普通编译后主页声音按钮已消失。过程中曾出现堆栈指向工具内部的 `worker path empty`，重新编译后已清除，最终为 0 错误、1 条基础库平台提示。该证据不代表真机试听或新客户端上传。
