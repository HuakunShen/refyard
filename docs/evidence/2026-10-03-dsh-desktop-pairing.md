# DSH 桌面插件配对修复 journal — 2026-10-03

## 最终结果

**PASS：用户在已安装的 DeepSeek Harness 桌面窗口中确认工作台正常显示。**

用户在本次会话中提交了实际桌面截图，Git 面板已经显示仓库、未暂存数量、提交历史及
工作区面板，并明确回复「可以显示了」。这一步才是实际桌面验收；此前独立 Electron
诊断窗口的成功不能替代它。用户截图保留在会话附件中，未假称已保存到仓库。

修复提交：`c23335b1ee570b40ab3e66d8fdc7026e38d639bf`
（`fix(dsh): keep embedded pairing on the renderer transport`）。未推送、发布或部署。

## 症状及调查过程

1. 插件已安装并启用，但桌面面板显示：
   `Unauthenticated: InternalError: the workbench hit an unexpected failure and cannot describe it`。
2. 早先的 loopback 地址别名修复及错误展示修复没有解决实际桌面故障；关闭并重新打开
   Git 面板也没有改变结果。不能把 curl 配对成功视作桌面成功。
3. 按用户要求，在独立 `web` profile 配置本地插件并启动 `127.0.0.1:19388`。
   真实 Chromium 页面能够配对，session exchange、repositories、status、refs、history
   请求返回 200，工作台正常显示。差异因此定位到桌面承载方式。
4. 对已安装 Harness 归档进行只读检查：版本 `0.2.0-rc.2`，构建提交
   `5e9e301dd9dc8923b2762f76dacfc5751f6ca851`。桌面 renderer 使用 `dsh-app://app`。
   自定义协议 forwarder 检查 renderer Origin，移除 Origin/Host/Cookie/Fetch-Site 等
   请求头并注入 shell cookie，通过 HTTP Host 转发；响应保留 CSP，没有 bypassCSP。
5. 独立 Electron 40.4.1 窗口复制该转发语义（插件路由无需 shell cookie，因此诊断
   cookie 为空），在未改传输规则时复现相同错误。控制台明确记录 HTTP session
   exchange 被 `connect-src 'self'` 拦截。这是 Electron 实际执行证据，但不是当时
   已安装桌面窗口的截图。

## 根因：两个连续的传输问题

### 1. 绝对 HTTP API 脱离了桌面同源承载

原始 iframe：`dsh-app://app/refyard/`。
插件重定向写入的 API：`http://127.0.0.1:19387/refyard`。

页面 CSP 为 `connect-src 'self'`。桌面页面的 self 是 `dsh-app://app`，不是 HTTP
carrier，因此浏览器在请求到达服务之前就阻止了配对。普通浏览器的页面和 API 都是
HTTP 同源，所以不会触发此问题。底层 fetch 抛出的普通传输错误被包装成了上述
InternalError/Unauthenticated，掩盖了 CSP 根因。

### 2. 同源请求经桌面转发后缺少配对 Origin

即使 API 改成同源路径，桌面 forwarder 仍会在检查后去掉 Origin。Refyard 的配对票据
绑定于插件的 HTTP carrier Origin，session exchange 原来把缺失 Origin 当作空字符串，
会拒绝兑换。需要在插件可信传输层恢复已校验的 HTTP 身份，而不是关闭票据来源绑定。

## 最小修复

- [插件 Host](<../../integrations/dsh/src/host.ts>)：重定向写入 `api=/refyard`，不再写绝对
  HTTP carrier 地址。浏览器自然使用 HTTP，同一 SPA 在桌面自然使用 `dsh-app://app`。
- [连接配置](<../../apps/web/src/lib/connection.ts>)：允许安全的根相对 API mount，保留
  原有 HTTP(S) 支持。拒绝 `//` 网络路径、反斜杠、控制字符、原始或百分号编码的点段；
  去掉 query/fragment 和末尾斜杠。显式 `/` 规范化为空前缀，供已有 `/api` 请求拼接。
  URL 的 `/refyard` 覆盖旧 localStorage 中的绝对 HTTP 地址，无需清除全部缓存。
- [插件代理](<../../integrations/dsh/src/host.ts>)：**先执行原有 Origin/Host/Fetch-Site
  检查**，只有通过检查后才使用 `req.headers.origin ?? origin` 转发，其中 `origin`
  来自已校验的 HTTP authority。显式来源原样保留；外站、opaque/null、不允许的 Host、
  缺少 Origin 的 cross-site 请求仍先拒绝。
- 没有修改 Harness 安装包，没有增加 custom-scheme allowlist，没有放宽 CSP/CORS，
  没有取消 bearer、票据一次性或过期检查，没有新增 Git 引擎。
- [插件说明](<../../integrations/dsh/README.md>)记录了传输约束。Host bundle 每个 Harness
  进程只导入一次，所以重建后必须完整退出并重启；切换面板无法加载新的 Host 代码。

## Test-first 与验证记录

新增测试在生产修复前运行，**exit 1，3 个预期失败**：

- 根相对 override 被忽略，仍选中旧 HTTP 地址。
- 插件 redirect 的 API 仍为绝对 HTTP，而不是 `/refyard`。
- Origin-stripping carrier 的 session exchange 返回 403，而不是 200。

安全测试必须用原始 Node HTTP 请求验证 Host/Fetch-Site：Fetch 会规范化相关头，曾使
测试未真正发送预期的拒绝条件。改用原始 request 后验证真实策略，未降低断言。

| 验证 | 实测结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/unit/connection.test.ts tests/integration/dsh-plugin.test.ts` | exit 0，20 tests passed |
| `node node_modules/vitest/vitest.mjs run tests/unit tests/integration tests/security tests/node` | exit 0，85 files / 803 tests passed |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun scripts/check-boundaries.ts` | exit 0 |
| `bun scripts/build-dsh-plugin.ts` | exit 0，SPA、Host、Client 构建完成 |
| 重启独立 web Host 后的 Chromium 页面 | 配对与仓库/状态/历史请求 200，工作台显示 |
| 原样 installed-forwarder 语义的 Electron 40.4.1 窗口 | exit 0，`dsh-app://app/refyard/api/v1/session/exchange` 与读取请求 200，无配对 CSP 阻断 |
| 用户实际已安装桌面窗口 | 用户截图 +「可以显示了」，PASS |

[连接配置测试](<../../tests/unit/connection.test.ts>)覆盖根相对 override 优先级与危险地址拒绝。
[插件集成测试](<../../tests/integration/dsh-plugin.test.ts>)使用隔离临时 Git 仓库及状态根，覆盖
同源 redirect、无 Origin 配对、有效 bearer 读取、重复票据拒绝、无 bearer 读取拒绝，以及
foreign/null Origin、foreign Host、originless cross-site 拒绝。原有认证套件亦通过。

诊断读取没有在真实仓库进行 Git mutation；全部 Git-write 测试使用隔离 fixture。
本次提交仅包含修复、回归测试与插件说明，保留用户原有的无关改动。

## 证据边界及剩余现象

- 本地诊断脚本/截图位于被忽略的 `.refyard-dev`，未提交。故障前后截图在会话中已查看；
  本 journal 不把这些临时文件当成永久仓库附件。
- 页面还出现 `/host/capabilities` 404 及 provider pull-requests 409；这些不是配对失败，
  不声称本次已修复。
- 本轮实际执行平台为 macOS；独立诊断 Electron 为 40.4.1。没有声称 Windows/Linux
  或其他 Harness 版本已执行。
- 独立 web 测试实例留在 `http://127.0.0.1:19388`。桌面插件不依赖此实例。

此文档是工程修复 journal，不是 Refyard 的运行时 Git 操作审计 journal；没有手工改写
运行时审计记录，也没有保存 pairing ticket、bearer、Host bootstrap token 或供应商凭据。
