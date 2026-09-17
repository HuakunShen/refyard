# 给本地AI的执行入口：Refyard Native Desktop + SSH

2026-09-18。此handoff与配套文档是**计划**，不是实现报告。

## 先读哪几个文件

按顺序读取：

1. `docs/superpowers/specs/2026-09-18-native-desktop-ssh-design.md`
2. `docs/superpowers/specs/2026-09-18-backend-adapter-contract.md`
3. `docs/superpowers/plans/2026-09-18-native-desktop-ssh.md`
4. `docs/acceptance/2026-09-18-native-desktop-ssh.md`
5. 当前仓库`AGENTS.md`、`docs/product/north-star.md`及实际工作树。

本轮用户明确授权的方向取代旧文档中的Node-only/no-native/no-Tauri限制。其他安全和验证规则不变。D00负责把旧规则更新得不矛盾；不要因为旧禁止条款停在询问，也不要粗暴删除整个AGENTS。

## 已决定，不重新选型

- Rust后端 + Tauri 2，不做Wails/Go/Node-sidecar比较实验。
- 正式App不带Node/Bun/Deno/QuickJS，也不要求用户配置runtime。
- 同一Svelte UI、BackendAdapter：HTTP/SSE与Tauri commands/events分开，native不走localhost HTTP。
- Rust库同时供Tauri与nativeCLI使用；CLI不会被Tauri绑定。
- 系统Git + 系统OpenSSH；远端不安装Refyard或JS runtime。
- Open Repo默认Local，可搜索SSH config Host，选后输入remote path；Local Browse保留。
- Xross/Kunkun只预留接口，napi-rs/全量npm分发不阻塞本轮。

## 首先交付什么

执行D00–D06先拿到可运行的local `.app`；D07–D09完成真实SSH读取；D10–D11完成stage/unstage/commit控制；D12–D14补齐nativeCLI/HTTP与验收。

每到一个阶段就构建release App并记录路径，不要直到所有backend迁移完才打开UI。全量write/read parity进入P01–P05。不要因为完整版很多而停做前面已确定的切片，也不要把read-only成果描述成完整Git客户端。

## 当前基线和参考

Refyard路径：`/Users/hk/ExtDev/refyard`，canonical `/Volumes/Portable2TB/ExtDev/refyard`。
本次检查HEAD：`ded64b15c773de9bb7c00d766f59ae8b0431a3c9`。先检查当前HEAD，后来的真实修改不能覆盖。

KK Terminal：`/Users/hk/Dev/kkterminal`，配置候选/搜索UI在：
- `packages/node/src/ssh/ssh-config.ts`
- `apps/web/src/lib/components/HostList.svelte`
- `e2e/tests/workbench.spec.ts`

旧CrossCopy的Rust参考：`/Users/hk/Dev/CrossCopy/packages/crosscopy-ssh-config/`，尤其`expansion.rs`与tests。可借鉴Include处理与测试，不可把完整旧workspace引入依赖。不完整手写resolver不能替代OpenSSH实际连接语义。

现有Refyard的重要陷阱：
- capabilities.host.kind写死node；要修契约，不能伪造node。
- UI enabled/cache keys绑定token；要改成ready/cacheNamespace，不能fake token。
- mutations.svelte内部创建HTTP client；必须改成依赖注入。
- 本地fs/realpath不能用于remote path。
- 普通SSH exec的remote command仍需quoting；本机argv不会自动跨网络保持。
- ssh -G可评估Match exec；Host picker必须被动读取。
- Stage需要content preview，不只是status的M字母相同。
- Write断线结果可能unknown，禁止自动retry。

## 执行和提交规则

先创建独立worktree，保护未提交内容。按任务写失败测试、运行确认、最小实现、运行验证、审查、单独commit。允许并行时按plan分配互不重叠文件，shared contracts只由integration owner维护。

测试只用临时repo/temporary SSH config/known_hosts和disposable server；不在项目repo或用户真实服务器上创建测试commit、改config或运行破坏性命令。

不push、不publish、不deploy。没有真实SSH环境时记录BLOCKED，继续非依赖任务，不伪造PASS。所有产物大小/耗时/内存数据必须实测。

最终报告写到`docs/handoffs/native-desktop-ssh-implementation-status.md`，包含App/CLI绝对路径、hash、实际功能矩阵、命令退出码、未测平台及下一任务。

## 可直接粘贴给本地AI的指令

```text
请在当前Refyard仓库执行
  docs/handoffs/2026-09-18-native-desktop-ssh-START-HERE.md
及它链接的两份spec、implementation plan和acceptance文档。

不要重新选型。已确定Rust + Tauri，无Node/Bun/Deno runtime；同一UI通过
BackendAdapter支持HTTP/SSE和Tauri commands/events，native不绕localhost HTTP。
系统OpenSSH从SSH config选择Host，远端不安装Refyard。

先检查工作树并创建独立worktree，从D00开始按TDD执行。先交付可运行local App，
随后真实SSH读取，再stage/unstage/commit，随后nativeCLI和完整验收；不要等
所有parity迁移完才打包App。A–D成功后可按顺序继续P任务，保持每阶段产物可运行。

旧AGENTS中的Node-only/no-native约束已经由用户2026-09-18的新要求取代，
请在D00做最小准确修订，其余安全规则全部保留。不要绕过安全检查，不在真实repo
做写入测试，不自动重试mutation，不导出SSH key，不push/publish/deploy。

完成每个milestone后记录实际App路径和验收结果；没有真实测试的项目标未验证，
不能把mock/cargo check当功能完成。最终按acceptance模板交付状态报告。
```
