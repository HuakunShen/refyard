# Refyard：原生桌面、Agentless SSH 与统一后端设计

日期：2026-09-18。状态：实现设计，**不是已实现或测试通过的报告**。

## 1. 已确定的产品决策

用户的最新要求取代旧文档中「只用 Node / 不做 Tauri / 不做原生宿主」的限制，但不取代仓库安全规则。

1. **Rust + Tauri 2**。正式桌面运行不携带、不寻找、不下载 Node、Bun、Deno 或额外 JS VM。
2. Rust 后端是可独立使用的库；Tauri 与原生 CLI 是它的两个入口，不是两套业务实现。
3. Svelte UI 保留。组件只调用服务接口；Tauri adapter 使用 commands/events，HTTP adapter 使用 HTTP/认证 SSE。
4. 桌面不通过 localhost HTTP 调用自身后端。Vite 开发服务器不算产品后端，release 不依赖它。
5. Git 使用目标机器的 Git CLI。SSH 使用宿主机器已有的 OpenSSH；不自行实现 SSH 协议，不引入 libgit2/gix 重写 Git 语义。
6. 打开仓库默认 Local，可搜索并选择 SSH config 中的具体 Host，再输入远端路径。
7. SSH 目标不安装 Refyard、Node 或自定义常驻 helper。允许发送固定、经测试的一次性 shell 命令，不写入远端可执行文件。
8. Cloudflare 静态网站、localhost web UI、远端 Refyard 服务继续存在；迁移期间保留 Node 参考实现，不把它带入桌面产品。
9. 今晚执行的关键路径先产出真实可启动 App、SSH 读取，再完成最小写入闭环；全量后端 parity 不阻塞前两个交付物。
10. Xross/Kunkun 只保留清晰接口；不把生态授权、Vault 或 SDK 实现塞进此次关键路径。

不保证一个晚上迁移所有既有操作。实现者必须交付真实产物和准确的完成矩阵，不能把「能编译」「界面有按钮」写成「功能完成」。

## 2. 源码检查基线

实现前重新检查 HEAD 和工作树。本设计检查到：

- Refyard：`/Users/hk/ExtDev/refyard`，实际路径 `/Volumes/Portable2TB/ExtDev/refyard`，HEAD `ded64b15c773de9bb7c00d766f59ae8b0431a3c9`。
- KK Terminal：`/Users/hk/Dev/kkterminal`，HEAD `6910017`，remote `kunkunsh/kkterminal`。
- 旧 CrossCopy：`/Users/hk/Dev/CrossCopy`，HEAD `c6cb6c334`，包含独立 Rust SSH config 模块。
- Xross 当前树：`/Users/hk/Dev/xross-dev`，本次上文检查的 HEAD `e93d81e4c`。只作为未来接口参考，不修改。
- 宿主工具链实读：Rust/Cargo 1.98.0；`/usr/bin/ssh`、`/usr/bin/git`。这不是跨平台验证。

### 2.1 值得保留的资产

| 当前文件/目录 | 用途 |
|---|---|
| `packages/git-contract/src/` | Zod public DTO、错误、操作与约束的唯一规范源 |
| `packages/git-contract/generated/contract.schema.json` | 跨语言 wire schema；Rust 响应必须通过其验证 |
| `packages/git-core/src/parse/` | 字节 parser 参考与差分 oracle |
| `packages/git-core/src/plan/` | 已有 Git argv / stdin 策略 |
| `packages/git-core/src/workflows/` | 状态、历史、diff、写操作的业务参考 |
| `packages/host-node/src/coordinator/` | 快照、预检、写队列、操作状态机参考 |
| `packages/host-node/src/filesystem/`、`registry/` | 路径身份、指纹、作用域与备份语义参考 |
| `packages/git-client/src/{client,mutations,events}.ts` | HTTP adapter 现成实现基础；SSE 已使用带认证的 fetch |
| `packages/git-ui/src/` | 可复用 Svelte 组件 |
| `apps/web/src/lib/workbench/` | 查询、选择、变更流程，需要去除 HTTP-specific 耦合 |
| `tests/support/{repo,service}.ts` | 隔离 Git fixture 与真实 Node service oracle |
| `tests/core/{formats,plans,history-search}.test.ts` | parser/argv/history 迁移基线 |

### 2.2 必须修复而非绕过的耦合

- `reads.ts` 的 `capabilitiesResponseSchema.host.kind` 当前是 `z.literal("node")`。
- `capabilitiesQuerySchema` 当前是空 strict object，不能直接加 query 参数而不改契约。
- `queries.svelte.ts` 用 `token !== null` 作为整个 UI 的 enabled 条件，query keys 还包含 token。
- `mutations.svelte.ts` 内部自行创建 HTTP MutationClient。
- `+page.svelte` 直接创建 HTTP client 和 HTTP pairing 状态。
- RepositoryLauncher 当前假定 path 是 local；Browse 已在最新提交存在，不能删掉或退回原来的文本输入。
- Node 仓库身份和预览直接读本地 fs；不能把它们用于 SSH 路径。

**禁止用假 token、假 baseUrl、fake fetch 或 Tauri-to-localhost 代理掩盖这些耦合。**

## 3. 为什么此次选 Rust，不选另一个受管 JS sidecar

这不是重新比较所有框架的研究任务。Rust 满足用户「不带 JS backend runtime」的目标，还能直接链接进 Tauri，并提供独立 CLI。

Go + Wails 同样可做小型原生应用，但本任务已选 Rust：避免引入 Go 后又需要 Rust 桥，后续也更容易与已有 Rust 工程交流。不得同时开发 Rust 和 Go 两个 backend。

`napi-rs` 是给 Node-API 宿主用的原生 addon 入口，不是让 Tauri 脱离 Node 的必需品。先完成 Rust library + executable；真正有 JS in-process 消费者再增加 N-API binding。

`npx` 是可选分发入口：薄 JS launcher 选择平台 Rust binary 并启动它。通过 npx 启动本身需要 npm/Node 环境；直接运行原生 CLI 或 App 不需要。不要把「Rust 后端可以通过 npx 分发」写成「npx 无需 Node」。

构建 Svelte 和运行旧测试可以用现有 Node/Bun；**构建时依赖不等于产品运行时依赖**。

## 4. 三个必须分开的边界

### 4.1 UI → 服务：BackendAdapter

负责连接建立、认证、请求/响应、事件订阅、取消、错误归一化和释放资源。

- `HttpBackendAdapter`：包装当前 HTTP/SSE client。
- `TauriBackendAdapter`：`invoke` + scoped events；不监听 TCP port。
- 未来 `KunkunBackendAdapter`：KKRPC。
- 未来 `XrossBackendAdapter`：仅当 Xross 给 UI 提供完整 GitService 时才有必要。

完整 TS 形状、事件规则和命令表见同目录 `2026-09-18-backend-adapter-contract.md`。

### 4.2 服务 → Git 执行环境：ExecutionProvider

Rust application service 调用它；它不暴露给 renderer。

- LocalProvider：在本机 spawn Git，使用本机 fs。
- SshProvider：由本机 OpenSSH 在服务器执行 Git；远端文件读取同样经受限 provider。
- 未来 XrossExecProvider：通过本地 Xross broker 调用远端结构化 exec。

**Tauri/HTTP 是 UI transport；SSH/Xross exec 是 Git transport。** 四种组合天然成立：Tauri+Local、Tauri+SSH、HTTP+Local、HTTP+SSH。

连接「远端 Refyard server」是换 BackendAdapter 的服务端点，而不是再加一个 shell provider。

### 4.3 业务 → 操作系统：平台辅助接口

进程生命周期、私有状态目录、时间/随机数、目录选择、凭据存储只存在于 host 层。Git parser/planner 不依赖 Tauri、Axum、Node 或 UI。

## 5. 文件与依赖边界

```text
packages/git-contract/                 保留：Zod + generated JSON Schema
packages/git-service/                  新：transport-neutral TS service/interfaces/error
packages/backend-http/                 新：包装当前 git-client
packages/backend-tauri/                新：唯一允许导入 @tauri-apps/api 的 adapter
packages/git-ui/                       保留：纯 UI，禁止 import Tauri/fetch/EventSource
apps/web/                             保留：composition root、路由、adapter selection
apps/desktop/                         新：Tauri package；不复制一套 Svelte 页面
  src-tauri/src/commands.rs            薄命令入口
  src-tauri/src/events.rs              有 owner/session 约束的事件注册
  src-tauri/src/lib.rs                 native composition root
crates/refyard-contract/               Rust DTO 的受校验投影；不是第二套协议规范
crates/refyard-core/                   pure bytes/parsers/planners/preconditions
crates/refyard-host/                   Local/SSH、registry、jobs、journal、GitService
crates/refyard-http/                   可选 Axum adapter；不被 desktop 默认依赖
crates/refyard-cli/                    原生 doctor/open/serve 与 test harness 入口
```

根 Cargo workspace：`resolver = "2"`、edition 2021、此次 `rust-version = "1.98"`。按实际可安装版本锁定 Cargo.lock，不猜 latest patch。Default members 是 native crates，Tauri 单独构建；不能让 headless CLI 依赖 WebView。

基本依赖限于 serde/serde_json、tokio、thiserror、sha2、随机数、base64、平台必要进程控制、tempfile（测试）、Axum（HTTP feature）与 Tauri。CLI 可用 clap。只在确需 trait object 时用 async-trait。不要引入 JS 引擎、SSH 重实现或新的 ORM。

Release profile 首先 `opt-level = "s"`, `lto = "thin"`, `codegen-units = 1`, `strip = "debuginfo"`；不要为了小包先启用可能改变故障语义的 panic=abort。完整 App、CLI 和依赖实际测量后再调优。

## 6. 契约迁移策略

### 6.1 Canonical wire schema

继续以 Zod 与 checked-in JSON Schema 为规范。Rust 先手写此次切片的 serde DTO，并在 CI 中把每个 Rust 输出通过同一个 Zod/JSON Schema 验证。禁止使用自由 `serde_json::Value` 绕过领域类型。

不在首轮引入一个大型 schema code generator；也不把 Rust DTO 反向导出成另一套与 Zod 竞争的权威。未来可替换为可靠 codegen，前提是 fixture 一致。

将 contract revision 从本次基线 `1.1.0` 增至 `1.2.0`（如果执行时已有更新，使用更高、唯一的 additive revision），API_MAJOR 保持 1。新增 `rust` host kind、可选 target query 与 HostService schemas。

新 UI 继续接受旧 Node 1.1.0；HTTP adapter 只有探测到扩展后才发送 target 参数。旧 UI 不保证可以连接新 Rust host，明确提示升级，不伪装 `host.kind=node`。

### 6.2 功能能力不能全局写死

- 握手与 launcher 不依赖本地 Git 存在；本地 Git 缺失时仍可选择 SSH。
- `capabilities({targetId?, repositoryId?})` 必须按实际选中目标返回 reads/operations。
- 两个选择器同时提供时必须一致，否则 InvalidRequest。
- 空查询保留旧语义：默认 local target。它失败不应关闭整个 launcher。
- Node 旧服务没有 host discovery 扩展时，HTTP adapter 宣告 `sshConfig=false`，不伪造空列表为“支持”。
- 未实现的 read 面板不自动轮询；未实现的写操作不显示为 enabled。
- 复杂 history filter 尚未移植时拒绝该 filter，不能静默忽略。

### 6.3 ID 与缓存

仓库授权身份至少绑定：服务实例、授权主体、execution target generation、canonical common Git dir、worktree。

SSH target generation 绑定 config source identity/revision、alias、有效 user/host/port/jump 诊断摘要；这些只辅助区分目标，**不是对 SSH 主机身份的加密证明**。信任由 OpenSSH known_hosts 策略承担。连接重建/配置变更时 revalidate 并使旧 snapshot/cursor/preview 失效；更换 host key 不静默迁移授权。

UI cache key 使用 `session.cacheNamespace + targetId + repositoryId + query`，不包含 token，不仅使用 path。

Recent 保存连接元数据和明确打开过的路径，不保存 token/密码/key bytes。不同服务器的同名路径显示为不同条目，标签页始终展示 `Local` 或 SSH alias。

## 7. SSH config：枚举与执行分开

### 7.1 可参考的现有实现

KK Terminal：
- `packages/node/src/ssh/ssh-config.ts`
- `apps/web/src/lib/components/HostList.svelte`
- `e2e/tests/workbench.spec.ts` 的 config picker case

它能作为交互与 fixture 参考，但注释和代码显示其解析只支持 OpenSSH 的子集。不要把它移植后声称支持所有 Match/ProxyJump 语义。

旧 CrossCopy：
- `packages/crosscopy-ssh-config/src/expansion.rs`
- `packages/crosscopy-ssh-config/src/parser.rs`
- `packages/crosscopy-ssh-config/tests/{security,openssh_fixtures}.rs`
- `packages/crosscopy-openssh-runtime/src/lib.rs`

它包含 Include 深度/字节/循环限制、相对目录语义和安全测试；同时因为它原本要投影连接配置，会拒绝某些高级配置。Refyard 只枚举 Host，不应复制全部投影限制。旧根 Cargo.toml 的 license 为 MIT；复制具体文件前仍核对来源头、许可证并记录 attribution。不要直接 path-depend 整个 Xross/CrossCopy workspace。KK Terminal 许可证未在本轮确认，只借鉴交互，复制前必须核对。

### 7.2 Host 列表是静态候选，不是完整解析结果

读取 `~/.ssh/config`；可增加用户明确选择的 config source。首轮列出具体 alias：

- `Host production staging` 产生两个候选。
- `Host *`、`Host *.internal`、`Host !blocked` 不变成可连接机器。
- 无任何 option 的具体 Host 也必须列出。
- 大小写关键字、引号、空白、注释和 `Host=foo` 需要 fixture。
- 支持普通全局 Include（多参数、引号路径、glob、词典序、相对路径以用户 SSH 目录为基准）；设置 depth=8、files=128、totalBytes=2 MiB 上限。
- 当前无法可靠枚举的 conditional Include、token/env-dependent Include 给出 `discoveryIncomplete` 警告和手填 alias 入口，不把截断当完整列表。
- 循环 Include 或不安全可写 config 拒绝相关 source，不能卡死 UI。
- 只读 config。不读取 private key 内容，不枚举 known_hosts 来猜用户服务器。
- 本轮不主动扫描所有 system config/网络；实际 OpenSSH 仍按自身规则读取系统配置。使用自定义 `-F` 会改变系统配置读取语义，设置页说明并测试。

**打开 Host picker 不能执行 ssh，也不能执行 config 中的任何命令。** 只在用户明确点击连接、认可所选本地配置来源后，按需用 `ssh -G alias` 做有效配置诊断；它会评估 Match，因此不应被当成无副作用的批量枚举命令。实际连接仍传原始 alias，不能把诊断结果扁平化成另一份配置替代 OpenSSH。

## 8. SSH 执行约束

### 8.1 首轮支持范围

验收目标：macOS arm64 桌面 → Linux POSIX SSH server；local macOS。Linux/Windows desktop 构建可继续，但未跑真实验收的不能宣称已支持。Windows 远端 shell 单列后续兼容任务，不用 POSIX quoting 冒充支持。

已有 key / ssh-agent / IdentityAgent / 已知 host key 是首轮连接路径。1Password 的授权由其 agent 完成；Refyard 不导出 key，真实兼容单独验收。密码、键盘交互认证、图形化首次 host-key 确认不作为首轮前置；已知配置连不上时给出原因及标准终端验证指引。

### 8.2 进程与参数

本机使用 `Command` 参数向量；never `sh -c` 启动本机 ssh。alias 限定为具体 host token，禁止 leading `-`、控制字符、shell 元字符；手填复杂 user/port 用独立字段，不拼成任意 option。

执行策略由可信 Rust host 构造，renderer 不能修改：

```text
-T
-o BatchMode=yes
-o RequestTTY=no
-o RemoteCommand=none
-o SessionType=default
-o StdinNull=no
-o ForkAfterAuthentication=no
-o ClearAllForwardings=yes
-o ForwardAgent=no
-o ForwardX11=no
-o PermitLocalCommand=no
-o StrictHostKeyChecking=yes
-o ConnectTimeout=15
-o ServerAliveInterval=15
-o ServerAliveCountMax=2
```

这里是策略清单，不是无条件对所有旧 OpenSSH 生硬套用的字符串：doctor 对固定选项集做兼容测试，不支持必要安全选项则 typed unavailable。普通 key agent 的外部批准可比 TCP connect timeout 更长：整个 connect deadline 设为 90 秒并可取消。

不启用 sshpass，不关闭 host verification，不改全局 SSH config，不改用户的 known_hosts 内容。首次信任先由用户在正常 OpenSSH 路径完成；连接失败明确呈现，不无限等待提示。

用户原有 ProxyCommand/Match exec/KnownHostsCommand 可能执行本地程序。配置来源是用户授权的代码信任边界；不得从仓库自动导入并执行这些配置，也不得宣称 PermitLocalCommand=no 可以关闭所有这类行为。

### 8.3 远端 quoting

SSH exec command 是 command string，不是跨网络传输的 argv。所有语义参数必须经过 POSIX 单引号编码；远端按固定模板调用 `git -C <path> ...`。

- 单引号编码为 `'` 结束、`"'"`、重新开始单引号。
- NUL 一律拒绝；根路径中的不支持控制字符在打开时明确拒绝，不 trim 改名。
- 文件路径优先通过 `--literal-pathspecs` 和 NUL stdin 传递；保留字节。
- commit message 通过 stdin `-F -`；绝不拼进 command string。
- 禁止任何 `eval`；不读取远端 shell profile 来拼脚本。
- 默认 server 登录 shell须能接受所验证的 POSIX command syntax。非 POSIX登录 shell需要单独 adapter/测试，不能只在内层加 `sh -c` 就声称解决所有外层解析。

### 8.4 原始字节、退出与取消

stdout/stderr 并行 drain，stdout 不按行 decode。输出有上限，超限不能把不完整协议当正常结果。PTY/ANSI/终端画面不进入 parser。

`ssh` 退出码 255 可能是连接错误，也可能来自远端命令；无可靠完成证据时写操作一律 unknown。关闭本地 ssh 不证明远端进程已被回滚或全部终止。不自动重试写入。

SSH provider 返回执行状态和输出完整性两个维度。未来 Xross output-limit 可能只是截断而命令已经完成，不能把枚举同名当语义相同。

### 8.5 连接复用

先完成非复用正确性，再增加 macOS/Linux 受管 ControlMaster。控制 socket 放短路径、0700 私有目录，key 包含 alias/config generation/user/host/port。socket/PID 只管理 App 创建的实例，不使用或关闭用户已有 terminal master。

首轮可采用 foreground master + app lifecycle 管理；崩溃回收要记录 owner，不能靠随便 unlink 路径。连接重试限于已确认未派发的读取。Windows 不支持同等机制时明确降级为逐命令连接，不能卡住基础功能。

## 9. 远端文件能力与最小写入闭环

只执行 Git 足以覆盖核心读取，却不足以自动复刻现有目录句柄、文件预览和安全备份。

M0：远端 repo path 输入 + status/history/refs/staged/unstaged/commit diff。远端 Browse 可以暂时 disabled 并解释；本地 Browse 必须保留。Untracked 可先显示列表，对无法安全读取的文件返回 `unavailable`，不返回空内容假装成功。

M1：为 `previews` 实现受限 remote file read：用户授权仓库内、选中 pathId、普通文件；绝不使用本机 fs 打开远端路径。固定 POSIX命令检查 symlink/类型/父路径，按 bytes 返回有限内容，再在本地 Rust SHA-256；上限初始 8 MiB/文件，超限使这条操作明确 unavailable。删除路径使用现有 fixture 的缺失文件指纹语义，不能编造零字节文件。

预览 token 绑定 session、target generation、repo、worktree、path、fingerprint、expiry；stage 前重新读取比对。Snapshot 绑定 HEAD 与 indexKey，沿用已有 preconditions。检查所有选中路径后才发写命令；某路径不支持则整批拒绝。

这些检查不是对恶意远端 root/同 UID 攻击者的完整 sandbox，也无法跨多个进程消除所有 TOCTOU。报告保证范围，破坏性操作继续关闭，不能以有一次 realpath 检查宣称强隔离。

最小受支持写操作：`stagePaths`、`unstagePaths`、`commit`；必须是 local 和 SSH 共用 workflow，不分叉。默认不 amend、不 push、不自动 stage、不 clean、不 force。普通 Git hooks、filters 和 signing 不绕过；可能需要额外运行时的用户 hook 是用户环境依赖，不是 Refyard 自带 Node。

读取可以使用经验证的 `--no-ext-diff` / `--no-textconv` / 不启动 fsmonitor 的策略；写入不通过禁用 hooks 来换取测试通过。

## 10. 操作状态、恢复与持久化

Rust 重用已有 `OperationRecord`、状态名称和 submit/get/list/cancel 契约。所有写入都先记录 accepted，再 running，最后按事实记录结果。使用私有状态目录内按 operation 分文件的 atomic JSON metadata 与索引；不要新引入数据库迁移。

状态不存 commit message、diff、文件内容、token 或 private key；使用 payload digest 去重。相同 clientRequestId + 同摘要返回原记录，不同摘要 IdempotencyConflict。写队列按 target + commonGitDir 串行。

崩溃时 accepted/running 的已派发操作恢复为 unknown 并 block dependent writes。增加语义化 `acknowledgeUncertainOperation(operationId, confirmedSnapshotId, confirmed=true)`：先读当前状态，再显式确认；只解除 block，不把 unknown 改为 succeeded，也不再执行原操作。Node legacy adapter不支持此新入口时明确 unavailable。

取消 queued job 可标 cancelled；running mutation只能记录已知结果或 unknown/needsAttention。事件只是提示；get/read始终是事实来源。

## 11. 原生 CLI 与网页兼容

原生 CLI 二进制迁移期名 `refyard-native`，子命令：

```text
refyard-native doctor --json
refyard-native open --repo <path>
refyard-native open --ssh-host <alias> --repo <remote-path>
refyard-native serve --repo <path> --no-open --json
```

Rust HTTP adapter调用相同 application service，复刻 authentication、Origin/Host、scope、SSE 和静态 SPA fallback。API-only serve 继续无 UI；open 通过同源 host提供 UI。桌面 crate不链接HTTP server feature。

HTTP hosted origin模式和广泛部署在完整安全验收后开放；本地默认 loopback，没有 `*` CORS。普通 browser不直接SSH，不把私钥发 Cloudflare，也不试图从网站直接连接本地 UDS。

浏览器通过 HTTP host访问 SSH时，使用的是 **backend机器** 的 SSH config/agent，不是浏览器所在机器的。UI以主机名标示，避免误导。

## 12. 迁移完成的定义

在 Rust parity达标前保留Node源码、测试和legacy入口；桌面不调用它。每个 Rust操作用已有fixture比较实际效果，不能按文件名机械翻译后算完成。

完整替代Node需同时满足：
- 既有读取、history filters、写入、恢复、安全语义和分页一致；
- 原生CLI可独立运行及HTTP客户端兼容；
- npm/native分发通过隔离安装与退出测试；
- 已有Node实现不再被正式入口使用，旧实现只保留为明确测试oracle或在替代测试建立后移除；
- Kunkun和Xross现有集成改用新入口时仍保持授权与数据契约。

N-API不是该完成定义的一部分。需要程序内JS绑定时再新增薄binding，业务逻辑仍只有Rust一份。

## 13. 外部依据（2026-09-18核对；实现前按锁定版本确认）

以下文档只确认平台机制；本文的架构、预算与任务优先级是本项目设计决定。

- Tauri commands：<https://v2.tauri.app/develop/calling-rust/>
- Tauri frontend events/channels：<https://v2.tauri.app/develop/calling-frontend/>
- Tauri capabilities：<https://v2.tauri.app/security/capabilities/>
- Tauri SvelteKit：<https://v2.tauri.app/start/frontend/sveltekit/>
- OpenSSH命令语义：<https://man.openbsd.org/ssh>
- OpenSSH配置、Include、Match：<https://man.openbsd.org/ssh_config>
- Git机器格式：<https://git-scm.com/docs/git-status>、<https://git-scm.com/docs/git-cat-file>
- Git diff选项：<https://git-scm.com/docs/git-diff>
- 1Password agent兼容：<https://www.1password.dev/ssh/agent/compatibility>
- N-API宿主与产物：<https://napi.rs/docs/introduction/getting-started>
