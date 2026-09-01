# 开发者工具运行时解锁

## 当前范围

小游戏运行在微信开发者工具模拟器时，普通关卡全部可直接进入；不需要额外入口，也不需要修改存档。

## 工作方式

- `src/platform/wechat.js` 的 `isDevTools()` 读取平台标记 `platform === 'devtools'`。
- `src/bootstrap.js` 只在该标记为真时，把 `unlockAllLevelsInDevTools: true` 注入本次运行的 `ProgressionService`。
- 该开关是内存中的运行时门禁，不写入 `completed`、`bestMs`、`lastPlayed` 或 `stats.totalClears`；真实通关统计保持不变。
- 真机运行、体验版和发布包不会得到该注入，继续使用原来的顺序解锁。即使设备沿用了开发存档，也不会因为存档内容而全开。

在微信开发者工具中导入项目并点击编译后，打开“选择关卡”即可看到所有关卡可进入。

这里使用的是微信系统信息里的 `platform` 合法值 `devtools`，不是浏览器特判；可参阅 [微信 `getSystemInfoSync` 平台字段说明](https://intl.cloud.tencent.com/zh/document/product/1219/57697)。

开发者工具的 CLI/HTTP 接口用于 IDE 的打开、预览、上传等操作，不会直接修改游戏运行时状态；本地命令调用还需要在“设置 → 安全设置”中开启服务端口。

## 发布检查

发布前应检查 `src/config/progression.js` 中的 `unlockAllLevelsInDevTools` 保持 `false`。真正的运行时开关由 bootstrap 的平台检测决定，不要把它改成无条件 `true`。

