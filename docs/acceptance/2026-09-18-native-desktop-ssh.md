# Refyard Native Desktop + SSH 验收规范

日期：2026-09-18。状态：待实现的测试规范，所有结果初始均为 NOT RUN。

配套plan：`../superpowers/plans/2026-09-18-native-desktop-ssh.md`。

## 1. 交付物与禁止冒充

必须提交：真实release App、独立native CLI、准确artifact路径和hash、下列测试结果、剩余parity矩阵。

- `cargo check`不是App运行验证。
- Vitest mock invoke不是Tauri真实IPC验证。
- 浏览器Playwright不是macOS WebView真实渲染验证。
- fake ssh不是网络SSH验证。
- 能显示history不是“支持远程控制”的完整验证；最小写闭环必须单独通过。
- 远端已装Node但没有调用Node，只能证明“不调用”；容器确认不存在runtime且真实完成操作才证明该fixture下“不需要安装”。
- built包没有Node binary，但启动时自动寻找系统Node，仍不满足目标。

每个case记录：ID、PASS/FAIL/BLOCKED/NOT RUN、command、exit code、artifact/evidence路径、平台、Git/SSH版本。BLOCKED不等于PASS。

## 2. 可复现fixture设计

### 2.1 local Git fixture

在系统临时目录创建，独立HOME、Git global/system config、known_hosts、SSH config，不继承用户Git重定向环境。固定author/date以便重建OID。

每组至少包含：

- 普通已提交文本a.txt、第二个未选中修改b.txt；
- 已stage和未stage同时存在的文件；
- 未跟踪文件、删除文件、rename；
- Unicode、空格、单引号、`$`、`;`、`:(glob)**`、leading dash文件名；
- 二进制文件、8MiB以上文件、长行diff；
- symlink与symlink父目录、worktree、bare/shallow/unborn/detached；
- SHA-256 object format fixture（目标Git支持时必须跑，否则标feature unsupported而非假定40字节）。

所有清理由fixture句柄负责，删除前验证路径位于创建的scratchRoot。不要使用生产repo创建测试commit。

### 2.2 Linux SSH fixture

使用可用Docker/Podman创建隔离sshd服务，image仅含OpenSSH server/client、Git与必要POSIX工具，不含Node/Bun/Deno/Refyard/python。基础镜像和软件版本在首次构建时锁定并记录，不用漂移latest作为可复现证据。

fixture准备SSH测试key和server host key，host public key直接写入测试known_hosts。只bind本机ephemeral端口；使用容器内非root测试用户和专用目录。测试生成的私钥不写进repo、日志或zip，不调用用户1Password。product流程不上传任何自定义binary/script；fixture预置Git内容属于测试准备，不代表产品安装要求。

本机临时配置：

```sshconfig
Host fixture-direct
  HostName 127.0.0.1
  User fixture
  Port <fixture assigned port>
  IdentityFile <temporary fixture private key>
  IdentitiesOnly yes
  UserKnownHostsFile <temporary known_hosts>

Include conf.d/*.conf
```

该模板由`native-ssh-fixture.ts`根据真实端口/路径写出，尖括号内容不是待用户手填步骤。

后续增加bastion fixture测试ProxyJump；不需要为basic direct SSH等待bastion成功。实际本机OpenSSH版本和目标sshd版本均记录。

### 2.3 无runtime证据

容器内检查结果（命令名称均不存在）：

```sh
for program in node bun deno refyard refyard-native; do
  if command -v "$program" >/dev/null 2>&1; then
    printf 'unexpected runtime: %s\n' "$program"
    exit 1
  fi
done
git --version
```

随后必须实际通过App完成status/history/diff/stage/commit，再检查没有Refyard进程、未新增产品helper文件。不能仅跑版本检查。

## 3. 必需验收矩阵

### A. 架构与运行时

| ID  | 测试                    | 通过条件                                                                         |
| --- | ----------------------- | -------------------------------------------------------------------------------- |
| A01 | release App从Finder启动 | 不要求终端先启动后端，无Node executable设置，无白屏                              |
| A02 | 最小PATH运行            | PATH不含JS runtime仍显示local repo                                               |
| A03 | 依赖/资源扫描           | 无Node/Bun/Deno/JS VM/backend bundle/Electron；允许frontend JS                   |
| A04 | 进程树                  | 正常fixture只有native宿主、WebView与Git/SSH/system helpers，不存在Refyard JS服务 |
| A05 | IPC                     | native读取/写入经Tauri commands；不打开Refyard localhost HTTP listener           |
| A06 | 独立CLI                 | nativeCLI dependency tree不含Tauri/WebView；可运行doctor/serve                   |
| A07 | 同UI                    | HTTP与native使用同一Svelte组件，无desktop复制版页面                              |
| A08 | 原有形态                | Node localhost现有tests及Cloudflare静态build仍通过                               |

### B. Adapter/生命周期

| ID  | 测试                  | 通过条件                                            |
| --- | --------------------- | --------------------------------------------------- |
| B01 | native ready无bearer  | UI正常加载，不生成fake token                        |
| B02 | DTO错误               | HTTP/Tauri均拒绝schema错误，不渲染假空列表          |
| B03 | mutation exactly once | 断开响应不导致第二次submit                          |
| B04 | 请求迟到              | 切target/backend后旧响应不污染新页面                |
| B05 | cache namespace       | 相同path不同target不共享repo/snapshot/preview缓存   |
| B06 | 订阅竞态              | handshake期间event无重复/漏交付，或准确gap并refresh |
| B07 | Event isolation       | 窗口B收到不到A的repository事件，借用A session也拒绝 |
| B08 | Dispose               | 幂等释放listener/timer，不关闭其他session的SSH连接  |
| B09 | Feature gating        | 未支持read不后台轮询，未支持write不显示enabled      |
| B10 | Legacy host           | 新UI接旧Node1.1.0工作，不发送其不认识的target query |

### C. SSH config发现与信任

| ID  | 测试              | 通过条件                                                     |
| --- | ----------------- | ------------------------------------------------------------ |
| C01 | 默认选择          | Open Repo首次默认Local，未自动SSH连接                        |
| C02 | 搜索Host          | 可搜索alias并选中，source/alias清楚                          |
| C03 | 多alias/裸Host    | 一行多alias和没有option的Host都能列出                        |
| C04 | 通配符/negation   | 不显示`*`、`*.corp`、`!blocked`为具体机器                    |
| C05 | Include           | 基本全局Include、顺序、quoted path、relative base正确        |
| C06 | Bounded parsing   | 循环/过深/超大不会hang；结果有准确warning                    |
| C07 | Passive discovery | 打开picker不执行ssh/Match exec/ProxyCommand，不读取key bytes |
| C08 | Manual alias      | discovery不完整时能手填具体alias，仍经过token验证            |
| C09 | Alias原样执行     | 原始alias交OpenSSH，不用不完整手写resolver扁平化             |
| C10 | 配置刷新          | 新增Host后刷新可见；配置revision变更使旧target重新确认/探测  |
| C11 | 已知host key      | 使用系统/测试known_hosts严格验证                             |
| C12 | 新key/更换key     | 不自动关闭checking，不覆盖known_hosts；明确告知连接未完成    |
| C13 | 外部配置          | repo提供的ssh_config不会自动导入执行                         |
| C14 | API权限           | HTTP host discovery未enable/未授权时不可枚举backend hosts    |

### D. SSH执行及读取

| ID  | 测试             | 通过条件                                                  |
| --- | ---------------- | --------------------------------------------------------- |
| D01 | 真实无部署服务器 | 无Refyard/JS runtime，App显示真实status/history/diff      |
| D02 | 无PTY            | stdout/stderr分离，binary/NUL输出无终端转换               |
| D03 | Quoting          | 路径含空格/quote/metacharacters不改变argv、不执行额外命令 |
| D04 | stdin            | commit message和NUL pathspec完整到达，不被-n吞掉          |
| D05 | 目标正确         | 远端路径不用本机realpath/stat；同名local path不被访问     |
| D06 | Unborn/detached  | 不报不存在HEAD为general failure；UI语义准确               |
| D07 | History分页      | tips固定，分页不混入移动HEAD后的历史                      |
| D08 | Binary/large     | marked binary/oversize/truncated，不把不完整patch当完整   |
| D09 | Bare/worktree    | 支持部分按capability；不把`.git`文件误当目录失败          |
| D10 | 连接丢失         | UI失联可重连；失败读取不缓存成empty repo                  |
| D11 | 远端shell        | 非验证过的shell明确unsupported，不假装POSIX               |
| D12 | SSH复用          | 只关闭App持有master，不影响用户既有terminal连接           |
| D13 | 最小依赖         | product没有远端npx/curl-install/文件上传/helper启动       |
| D14 | 凭据生态         | 真实1Password/key agent单独验收；没测不写已支持           |

### E. 最小写入闭环

| ID  | 测试                | 通过条件                                              |
| --- | ------------------- | ----------------------------------------------------- |
| E01 | Selected stage      | 只选a.txt，b.txt未被stage                             |
| E02 | Staged diff         | 与直接Git输出和服务DTO一致                            |
| E03 | Unstage             | 只改index，工作文件不被恢复                           |
| E04 | Unborn unstage      | 无HEAD仍可安全取消暂存或明确feature拒绝，不丢文件     |
| E05 | Commit              | 提交当前index，不自动stage；远端git log有同OID        |
| E06 | Hook/signing        | hook失败被保留，未添加no-verify或关闭signing          |
| E07 | Preview stale       | 内容改而status仍M，stage拒绝StalePreview              |
| E08 | Snapshot stale      | HEAD/index变动，整批拒绝，无部分写入                  |
| E09 | Unsupported path    | symlink/submodule/无法编码/超限路径整批拒绝并解释     |
| E10 | Duplicate request   | 同id同payload不再执行；同id不同payload冲突            |
| E11 | SSH中断             | 不确定结果为unknown，不自动retry                      |
| E12 | Crash/restart       | running记录恢复为unknown并block相关后续写             |
| E13 | Explicit ack        | 新snapshot确认后解除block，但unknown不被改写成success |
| E14 | 取消                | queued可cancel；running不被谎称回滚                   |
| E15 | Non-destructive首轮 | discard/force/push/amend等未实现按钮不能执行          |
| E16 | Local/SSH一致       | E01–E15两种provider共用相同tests/业务流程             |

### F. 原生HTTP与兼容

| ID  | 测试         | 通过条件                                                      |
| --- | ------------ | ------------------------------------------------------------- |
| F01 | 认证读取     | 所有业务读取保持既有认证要求；不新增匿名health或discovery例外 |
| F02 | Host/Origin  | 错误authority/origin拒绝；无`*`CORS                           |
| F03 | ticket       | 单次/expiry/清理保持既有语义                                  |
| F04 | SPA/API分离  | 错误/api路径JSON404，不能fallback成HTML200                    |
| F05 | SSE          | bearer在header，不在URL；gap/reconnect正确                    |
| F06 | Host目标授权 | 跨session targetId/repoId/operationId拒绝                     |
| F07 | same service | HTTP与Tauri调用同一Rust service，operation结果一致            |
| F08 | browser能力  | 网页不直接SSH/读本机key/接UDS；Cloudflare不接管credentials    |

## 4. UI真实操作脚本

1. 打开release App，选择Local，使用已存在的Browse选择临时fixture。
2. 验证History、Working Copy、Diff，不启用Node后端。
3. 点Open Repo，Location仍默认Local；改选SSH，搜索`fixture-direct`。
4. 连接后输入容器中的repo路径；打开后Tab始终显示SSH alias。
5. 再打开本地同名repo，切换两tab；内容不得串台。
6. 在SSH repo完成E01–E05，使用容器内Git独立读回结果。
7. 制造fixture网络中断，确认不重复写，恢复后能读状态并按需ack unknown。
8. 关闭App，确认不存在App-owned backend/SSH孤儿进程。

保存真实截图与命令记录到`docs/evidence/native-desktop-ssh/`。无需为每个矩阵单元生成截图；关键窗口、SSH状态、写入结果和故障状态必须可核对。

## 5. 大小与性能预算

以下是**初始工程预算，不是测量结果，也不是对Tauri大小的保证**。

- macOS arm64 installed `.app`目标≤30 MiB，超过50 MiB必须提供依赖/资源分解和下一步；不能仅报compressed DMG。
- 独立CLI目标≤20 MiB；超过30 MiB分析是否误带WebView/assets/HTTP非必要feature。
- 不因预算失败删除安全检查或换成系统Node；先检查debug symbols、重复assets、HTTP feature与link profile。
- startup/local status/history/diff latency全部实测，无先验PASS数字。记录fixture规模与至少3次结果。
- idle内存包含native进程及WebView相关进程的观测方法；RSS求和可能重复计算shared pages，明确说明。
- 远端性能记录RTT、Git执行次数、SSH连接复用情况；不是拿本地fast fixture结果当远端体验。

## 6. 最小测试命令集

这些native脚本在实施计划中创建；文档生成时尚不存在，不声称已运行。

```sh
pnpm check
pnpm check:boundaries
pnpm check:contract
pnpm test:unit
pnpm test:integration
pnpm build:web
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm exec vitest run tests/adapters tests/native
pnpm native:ssh:fixture -- start
cargo test -p refyard-host --test ssh_exec --test ssh_mutations -- --ignored --test-threads=1
pnpm native:ssh:fixture -- stop
pnpm desktop:build
pnpm native:verify
pnpm native:bench
```

异常退出也要finally停止fixture；没有环境时在report里明确BLOCKED，不能跳过后让聚合脚本返回“all passed”。Desktop平台依赖缺失时可分开跑headless crates，但desktop gate仍未通过。

## 7. 提交报告模板

```text
Baseline commit:
Implementation commit:
Test platform / Git / SSH:
A Local desktop: PASS | PARTIAL | BLOCKED
B Agentless SSH reads: PASS | PARTIAL | BLOCKED
C Local + SSH writes: PASS | PARTIAL | BLOCKED
D Native CLI / HTTP: PASS | PARTIAL | BLOCKED
Artifact .app absolute path + SHA-256 + installed bytes:
Artifact CLI absolute path + SHA-256 + bytes:
No-Node proof:
Remote no-install proof:
Commands actually run and exit codes:
Existing regression failures:
Not-run matrix cells:
Next executable task:
```

## 8. 安全边界说明

此产品接受的是用户已信任的机器、SSH身份及repo操作权限；不是对恶意本机同UID进程、远端root或仓库内任意代码的完整sandbox。hooks/filters执行保留用户语义。初始scope检查与preview不是跨进程事务锁，不能宣称隔离其他IDE/terminal写入。

不因为这份边界说明而忽略实际可防止的错误：命令注入、错误target、重复写、未经授权访问、secret泄露、host-key降级、错误解析和失真结果都属于release gate。

---

## 9. 阶段结果（增量记录，2026-09-18）

本节只记录**已经运行过**的结果，格式与第 7 节一致。C、D 两节尚未实现，因此没有行被标记为 PASS；D14 会用完整报告替换本节。平台与版本一次性写在这里，各行不再重复：macOS 26.6 / arm64；本机 git 2.50.1 (Apple Git-155)、OpenSSH_10.3p1；远端 fixture 为 Alpine 3.20 + git 2.45.4 + OpenSSH 9.7p1（容器）；测试与构建用 Node v26.8.2、cargo 1.98.0。

```text
Baseline commit: 5692787 (feat(ssh): execute git remotely through system openssh)
Implementation commit: 73a1ff0 (feat(workbench): open local and ssh repositories through one ui)
                       004539c (fix(git-ui): stop calling a complete diff listing truncated)
                       88832cb (fix(native): run the ssh fixture's child processes through node)
                       93ee1e0 (feat(native): enforce preview freshness and durable mutation state)
                       D11 (feat(native): support safe local and ssh staging and commits)
                       D12 (feat(cli): expose the native service without a desktop runtime)
Test platform / Git / SSH: macOS 26.6 arm64 · git 2.50.1 · OpenSSH 10.3p1 → Alpine 3.20 sshd 9.7p1
A Local desktop: PASS
B Agentless SSH reads: PARTIAL（本地 App 真实读取通过；凭据生态 D14、远端浏览 P01 未做）
C Local + SSH writes: PARTIAL（真实 App 两种 provider 完成 stage/unstage/commit 并被服务器 Git 验证；E13 阻塞解除面板已完成（见 9.5）；E06 hook 失败、E11 断线、E12 crash/restart（App 内）、E14 取消 尚未在 App 内实测）
D Native CLI / HTTP: PARTIAL（refyard-native doctor/serve/open 已实现并被真实套件验证：票据→bearer、Host/Origin 精确校验、JSON 404、授权仓库、幂等重放；SSE 已有线上的帧序列与 since 重放用例，两边界并排比较一致（F01–F08 全 PASS）；hosted 形式按构造拒绝；MCP/OpenAPI/Scalar 未实现）
Artifact .app absolute path + SHA-256 + installed bytes:
  /Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh/apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app
  254a2ac122578c9cb0f7fa157173267b31d13bb5a769c42b144c9aaf8e55c53c · 13535328 bytes executable · 13.3 MiB installed · 未签名（含 E13 解除面板与原生文件夹选择器/拖拽，见 9.11）
Artifact CLI absolute path + SHA-256 + bytes:
  /Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh/target/release/refyard-native
  27b5a6b6c462ea7bc498f9f5e5aba08738af5865a347b76aba20588b9d811fc1 · 4360464 bytes（D13 重建：journal 种子修复；哈希随代码变化，见 9.9）
No-Node proof: 见 A02/A04 与 B、D 记录；App 以 PATH=/usr/bin:/bin 启动并完成读取与写入，进程树无 JS runtime 子进程；refyard-native 链接仅 libSystem/libiconv，依赖树无 JS runtime 与 WebView；`pnpm native:verify` 对 .app 与 CLI 全量扫描（9.9）
Remote no-install proof: 见 D01/D13；容器内无 node/bun/deno/refyard/python3/npx/curl，/ 下唯一 refyard 命名路径是种子仓库目录
Commands actually run and exit codes: 见下方逐行表与 B、C 记录“本轮跑过的闸门”
Existing regression failures: chromium 项目无失败（`pnpm test:e2e` 全引擎跑：170 passed / 2 skipped / 2 failed——失败为 context-menu.spec 在 firefox+webkit，已在未含本改动的已提交树上复现，属既有引擎问题，非本轮引入；root Rust 539 / desktop 25 / native vitest 49 均 0 failed）
Not-run matrix cells: A06；B01–B04、B06–B09；C03–C06、C08、C10、C12–C14；D06–D12、D14；E06、E08、E09、E11、E12（App 内）、E14、E15；断网场景；第 5 节除 app/CLI 字节、延迟与 RSS 外的预算项
Next executable task: D 轨收官；后续为 P01（完整只读 parity 与远端目录浏览），进入条件——releaseApp 可用且核心 SSH 不回归（均满足）
```

### 9.1 A 节（架构与运行时）

| ID  | 结果    | 证据                                                                                                                         |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A01 | PASS    | `open Refyard.app`（无终端、无后端）打开窗口并渲染 launcher → `docs/evidence/native-desktop-ssh/a-local-app.md`              |
| A02 | PASS    | `env -i PATH=/usr/bin:/bin …` 启动同一 bundle，`ps eww` 确认环境只有 PATH/HOME/TMPDIR，读取成功 → 同上                       |
| A03 | PASS    | bundle 内单个可执行文件 + Info.plist + 图标；`otool -L` 只列系统框架，无 JS 引擎 → 同上                                      |
| A04 | PASS    | 进程树 = host + 系统 WebView XPC 服务 + 瞬时 git 子进程；无 Node/Bun/Deno/Electron/sidecar → 同上                            |
| A05 | PASS    | `lsof -nP -a -p <pid> -i` 与 `-iTCP -sTCP:LISTEN` 均为空；读取全部走 Tauri IPC → 同上                                        |
| A06 | NOT RUN | native CLI 尚不存在（D12）                                                                                                   |
| A07 | PASS    | bundle 由 `apps/web` 经 `scripts/build-desktop.ts` 生成；无 desktop 专用页面副本 → 同上                                      |
| A08 | PASS    | `pnpm build:web` 写出 `build/200.html`；`pnpm test:unit` 428 passed；`pnpm test:integration` 418 passed；`pnpm check` exit 0 |

### 9.2 B 节与 C/D 节的已测行

| ID            | 结果    | 证据                                                                                                                                                                                                           |
| ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B05           | PASS    | 同路径不同 target 产生不同 tab 与不同 cache namespace：`tests/unit/target-cache.test.ts` 6 passed；`tests/e2e/ssh-repository-launcher.spec.ts` 15 passed（chromium/firefox/webkit）                            |
| B10           | PASS    | 新 UI 接无 host 路由的 Node 服务：探测 `/api/v1/host/capabilities` 得 404 即本地模式（`packages/backend-http/src/legacy-capabilities.ts`），此后不再发送 target 请求；整个 e2e 套件 56 passed 即在该服务上运行 |
| C01           | PASS    | launcher 首次默认 `This machine`，未选 SSH 主机前不建立连接 → B 记录                                                                                                                                           |
| C02           | PASS    | 主机列表显示 `refyard-ssh-fixture · source_603a99b1…`，可搜索选择 → B 记录                                                                                                                                     |
| C07           | PASS    | 打开 picker 期间进程树中没有任何 `ssh`；所有 `ssh` 都是带 Git 命令的读取 → B 记录                                                                                                                              |
| C09           | PASS    | alias 原样交给 OpenSSH（argv 中为 `refyard-ssh-fixture`，非展开后的地址） → B 记录                                                                                                                             |
| C11           | PASS    | `StrictHostKeyChecking=yes` + 客户端自带 `known_hosts`；host key 由本机生成，连接成功 → B 记录                                                                                                                 |
| D01           | PASS    | 容器内无 Refyard artifact、无任何 runtime；App 显示真实 status/history/diff，与容器内 Git 输出逐项一致 → B 记录                                                                                                |
| D02           | PASS    | argv 中 `RequestTTY=no`、`StdinNull=no`，读取为 `status --porcelain=v2 --branch -z` → B 记录                                                                                                                   |
| D03           | PASS    | 含空格、单引号与 `ë` 的远端路径被单引号编码为单个 argv（`'"'"'`） → B 记录                                                                                                                                     |
| D05           | PASS    | 远端路径未在本机 realpath/stat；显示为远端自己的拼写 → B 记录                                                                                                                                                  |
| D13           | PASS    | 远端只收到命令：无上传、无 installer、无 helper、无 npx/curl（容器内均不存在） → B 记录                                                                                                                        |
| 其余 B/C/D 行 | NOT RUN | 逐行原因见第 9.4 节                                                                                                                                                                                            |

### 9.3 本轮跑过的闸门（命令与退出状态）

| 命令                                                                                         | 退出 | 结果                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo test --workspace`                                                                     | 0    | 494 passed / 0 failed / 20 ignored（D11 后重跑；此前 397 / 14）                                                                                                      |
| `cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1`（fixture 已启动） | 0    | 14 passed                                                                                                                                                            |
| `cargo test`（`apps/desktop/src-tauri`，独立 workspace）                                     | 0    | 24 passed（新增 D11 写入与 journal 用例）                                                                                                                            |
| `cargo clippy --workspace --all-targets -- -D warnings` / `cargo fmt --all -- --check`       | 0    | 无输出                                                                                                                                                               |
| `pnpm check`                                                                                 | 0    | 11 tasks 通过，根 `tsc` 干净，svelte-check 0 error 0 warning                                                                                                         |
| `pnpm test:unit`                                                                             | 0    | 47 files / 428 tests passed                                                                                                                                          |
| `pnpm test:integration`                                                                      | 0    | 32 files / 418 tests passed                                                                                                                                          |
| `pnpm check:boundaries` / `pnpm check:contract`                                              | 0    | 3 portable 包无 host 依赖；500 个 schema `$ref` 全部解析                                                                                                             |
| `pnpm exec playwright test --project=chromium`                                               | 0    | 56 passed（首次运行 55 passed / 1 failed 的竞态已定位并修复，见 B 记录）                                                                                             |
| `pnpm exec playwright test tests/e2e/ssh-repository-launcher.spec.ts`                        | 0    | 15 passed（chromium + firefox + webkit）                                                                                                                             |
| **D14 后追加轮（原生文件夹选择器 + 拖拽，2026-09-19）：**                                    |      |                                                                                                                                                                      |
| `cargo test`（apps/desktop，独立 workspace）                                                 | 0    | 26 passed / 0 failed（新增 picker 形状用例）                                                                                                                         |
| `cargo clippy --all-targets`（apps/desktop）                                                 | 0    | 无警告                                                                                                                                                               |
| `pnpm exec playwright test tests/e2e/native-folder-picker.spec.ts`                           | 0    | chromium+firefox 各 2 passed；webkit 2 skipped（注明原因）                                                                                                           |
| `pnpm desktop:build`（含选择器/拖拽重建）                                                    | 0    | `Refyard.app` 254a2ac1…，13.3 MiB（dialog 插件 +0.7 MiB）；`native:verify` 仍绿                                                                                      |
| `cargo test -p refyard-http`                                                                 | 0    | 22 unit + 10 gate passed（gate 走真实 socket + fixture 仓库）                                                                                                        |
| `pnpm exec vitest run tests/native`                                                          | 0    | 44 passed（security 10 + contract 24 + helper；release binary 驱动）                                                                                                 |
| `cargo build -p refyard-native --release`                                                    | 0    | 4304496 bytes（≤20 MiB 预算）                                                                                                                                        |
| `pnpm desktop:build`                                                                         | 0    | `Refyard.app`，12 MiB installed                                                                                                                                      |
| **D13 轮追加：**                                                                             |      |                                                                                                                                                                      |
| `cargo test --workspace`（D13 后重跑）                                                       | 0    | 537 passed / 0 failed / 20 ignored（含 journal 种子新用例）                                                                                                          |
| `cargo test`（`apps/desktop/src-tauri`）                                                     | 0    | 25 passed / 0 failed / 1 ignored                                                                                                                                     |
| `pnpm exec vitest run tests/native`                                                          | 0    | 46 passed（新增 http-shutdown：SIGKILL 未知结果 + SIGTERM 优雅关闭）                                                                                                 |
| `pnpm native:verify`                                                                         | 0    | .app 12.6 MiB / CLI 4.16 MiB，系统链接，无 JS runtime（≤30/≤20 MiB 预算）                                                                                            |
| `pnpm native:bench`                                                                          | 0    | ready 52ms · first status 44–49ms · history 144–154ms · idle RSS ~4.5MB · 工作后 4592 kB（`docs/evidence/native-runtime.json`）                                      |
| **D12 补齐轮追加：**                                                                         |      |                                                                                                                                                                      |
| `cargo test -p refyard-http`                                                                 | 0    | 22 unit + 10 gate + 2 two-boundaries passed                                                                                                                          |
| `pnpm exec vitest run tests/native`                                                          | 0    | 49 passed（新增 http-events：线上 SSE 3 例）                                                                                                                         |
| **D11 收尾（E13 面板）轮追加：**                                                             |      |                                                                                                                                                                      |
| `pnpm test:e2e`（全引擎）                                                                    | 1    | 170 passed / 2 skipped（webkit 注明原因）/ 2 failed——失败为 context-menu.spec firefox+webkit，已在未含本改动的提交树上复现（stash 后 bundle 重跑仍失败），属既有问题 |
| `pnpm exec playwright test tests/e2e/uncertain-outcome.spec.ts --project=chromium`           | 0    | 2 passed                                                                                                                                                             |
| `pnpm exec playwright test tests/e2e/uncertain-outcome.spec.ts --project=firefox`            | 0    | 2 passed                                                                                                                                                             |
| `pnpm desktop:build`（含面板重建）                                                           | 0    | `Refyard.app` b3eb30a2…，12.6 MiB；`native:verify` 仍绿                                                                                                              |
| **D14 收官轮：**                                                                             |      |                                                                                                                                                                      |
| `pnpm build`                                                                                 | 0    | 全 workspace 构建                                                                                                                                                    |
| `pnpm exec playwright test --project=chromium`                                               | 0    | 58 passed（56 + uncertain-outcome 2）                                                                                                                                |

### 9.4 未测行及原因

- **B01–B04、B06–B09**：这些行由既有测试与本次改动共同覆盖（native ready 无 bearer、DTO 错误拒绝、exactly once、迟到响应、订阅竞态、事件隔离、dispose、feature gating），但本轮没有把每一项单独作为 case 记录，因此不标 PASS。
- **C 节（C03–C06、C08、C10、C12–C14）**：D07 记录了对真实 29 个别名的比对与 include/通配符处理的实测（`docs/evidence/native-desktop-ssh/ssh-config-discovery.md`），但本节尚未逐行归档。
- **D 节剩余行**：D04 需要写入路径（D11）；D06/D09 需要 unborn/detached/bare/worktree fixture；D07 需要分页压力用例；D08 需要 binary/超大 fixture；D10（连接丢失）需要 UI 断线用例；D11（非 POSIX 远端 shell）没有对应 fixture；D12（SSH 复用/不影响用户既有连接）需要与用户终端并存测量；D14（凭据生态）需要真实 1Password/key agent。
- **E、F 两节**（本节为 D11/D12 之前的轮次记录；两节现状见 9.5–9.10）：E01–E05、E07、E10、E13、E16 与 F01–F08 已测，其余行见下方各节。
- **第 5 节预算**（本节为早期记录；app/CLI 字节、压缩体积、延迟与 RSS 已于 9.9 测量，其余预算项仍未测）。

### 9.5 D11 结果（E 节最小写入闭环，2026-09-18）

真实 App（release bundle，哈希见上）在一个窗口内同时打开远端 fixture 与本地临时 repo，
两者都完成「看 diff → stage → 看 staged diff → unstage → stage → commit → history 看到新
commit」，随后用服务器/本机自己的 `git` 读回。完整过程、argv 采样与关闭检查见
`docs/evidence/native-desktop-ssh/c-local-and-ssh-writes.md`。

| ID  | 结果    | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | PASS    | 只选中的路径进入 index：`A. c.txt`，其余不变；本地与远端同流程；`ssh_mutations.rs`、`session_owner.rs` 覆盖单文件与批量                                                                                                                                                                                                                                                                                                               |
| E02 | PASS    | staged diff 由同一 status/diff 读取给出；窗口显示 `Staged Files 1 · A. c.txt` 并与 `git diff --cached --name-only` 一致                                                                                                                                                                                                                                                                                                               |
| E03 | PASS    | unstage 走 `git restore --staged --pathspec-from-file=- --pathspec-file-nul`（argv 实测），窗口提示 `unstaged 1 path (working tree untouched)`，工作文件内容未变                                                                                                                                                                                                                                                                      |
| E04 | PASS    | unborn 分支 unstage 由 `ssh_mutations.rs` 用例覆盖（不退回 `git restore`，不删工作文件）                                                                                                                                                                                                                                                                                                                                              |
| E05 | PASS    | 远端 `git log` 显示 app 提交的同一 OID（`459b43f9…`），作者/提交者是容器自身身份；本地为 `5314383a…`；commit 不自动 stage                                                                                                                                                                                                                                                                                                             |
| E07 | PASS    | preview 绑定内容指纹，内容变动即 `StalePreview` 拒绝（D10 用例 + 桌面命令层）                                                                                                                                                                                                                                                                                                                                                         |
| E10 | PASS    | 同 clientRequestId + 同 payload 返回 `duplicate` 与原记录，不重复写入；桌面用例断言 Git 侧无第二次写入                                                                                                                                                                                                                                                                                                                                |
| E13 | PASS    | 被阻塞仓库的解除入口已落地：`UncertainOutcomePanel`（git-ui，纯 props）+ 控制器 ack 流（读新快照 → `confirmed: true` → 记录保持 `unknown`，若被改写则报错不信任）；e2e 真浏览器点击验证面板出现、勾选前按钮禁用、ack 请求体、解除后真正可写（chromium/firefox；webkit 因拦截限制跳过并注明）。Tauri 命令层由 `session_owner.rs` 覆盖；窗口内人工点击未自动化（WKWebView 无 WebDriver），证据链为共享 UI 组件的 e2e + Tauri 命令层测试 |
| E16 | PARTIAL | 本地与远端共用同一 planner/effect/队列代码路径，并各自被真实 Git 验证；但 E06/E11/E12/E14 未在两种 provider 上逐一实测，故不标 PASS                                                                                                                                                                                                                                                                                                   |

其余 E 行未测，原因见 9.4。

### 9.6 D12 结果（F 节原生 HTTP 入口，2026-09-18）

`refyard-native serve`（API-only）与 `open`（API + 静态 workbench）已实现，同一
`ApplicationService` 经 Tauri 与 HTTP 两个边界服务。完整测量与逐条证据见
`docs/evidence/native-desktop-ssh/d-native-http-entry.md`。

| ID  | 结果 | 证据                                                                                                                                                                                                                                                                                                       |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | PASS | 所有读取需 bearer（含 capabilities）：无票据 401，`http_gate.rs` + `http-security.test.ts`                                                                                                                                                                                                                 |
| F02 | PASS | Host/Origin 精确匹配；`attacker.example`/外源 Origin/`null` 均 403 且先于鉴权；无通配 CORS；线上由 `node:http` 设 Host 验证                                                                                                                                                                                |
| F03 | PASS | 票据单次（二次 401，Rust+线上）、60s TTL、超量/过期清理（Rust 单测）、常量时间比较、绑定 origin+instance（错配即焚）                                                                                                                                                                                       |
| F04 | PASS | 未知 `/api` 路径：先鉴权后 JSON 404，绝不回退 SPA（Rust+线上）；缺失 asset 同为 JSON 404；shell 仅给 route 形路径                                                                                                                                                                                          |
| F05 | PASS | 线上 SSE：真实 socket 订阅 release binary，写入时帧序列 `id`/`event`/`data` 单调且过 `eventEnvelopeSchema`，`retry: 3000` 在重放后、首 tick keep-alive 注释帧被忽略；`?since=0` 重放游标之后全部事件、游标处无重放（`tests/native/http-events.test.ts` 3 passed）                                          |
| F06 | PASS | 仓库级授权：第二会话读第一会话的仓库 403（Rust）；线上未授权 id 403；target 级由 host 拒绝（`createTarget` 无 HTTP 路由，默认关）                                                                                                                                                                          |
| F07 | PASS | 并排比较（`crates/refyard-http/tests/two_boundaries.rs`）：同一 fixture 六个读取（capabilities/repositories/status/history/refs/diff）HTTP JSON 与 service 直答完全一致（仅差每次调用自带的 `readAt`/`snapshotId`）；线上提交的 operation 在 service journal 视图中逐字段相同；direct 边界接受同一请求类型 |
| F08 | PASS | SSH host 列表无 HTTP 路由（默认关；D13 决定继续不加路由，见 9.9 末行）；网页不接触本机密钥；票据仅 loopback                                                                                                                                                                                                |

### 9.7 D12 未完成项（不得当作已实现）

- F05/F07 已于 2026-09-18 补齐并标 PASS（见 9.6）；此节余下两条仍成立：
- **hosted 形式**按构造拒绝（`pairing_url` 拒绝非 loopback origin），不是实现。
- **`/mcp`、`/openapi.json`、`/scalar`** 未实现，由静态 404 兜底；不得称为支持。

### 9.8 D11 未完成项（不得当作已实现）

- **E13 的 UI 入口（已于 2026-09-18 补齐，见 9.5 与 E13 行）**：`UncertainOutcomePanel`
  组件 + 控制器 ack 流 + e2e（chromium/firefox）+ `session_owner.rs` 命令层。仍缺的只是
  窗口内的人工点击演示（WKWebView 无 WebDriver，无法自动化驱动 Tauri 窗口），面板与
  桌面命令共享同一适配器接口。
- **`tests/e2e/native-mutations.spec.ts`**：计划里列的 native e2e 未创建。macOS 上 WKWebView
  没有可用的 WebDriver，桌面端 e2e 无法用 Playwright 驱动；本轮以 `session_owner.rs`（直接
  调用生产 command body）作为等价覆盖，理由与差距同时记录在此，不用一份假 spec 充数。
- **E06**：hook 失败的保留只由 host 层用例覆盖（无 `--no-verify`，失败即失败），未在真实 App
  里用 fixture hook 演示。
- **E11/E12/E14**：断线、crash/restart、取消未在真实 App 内制造。命令行层的对应行为由
  `uncertain.rs`、`journal.rs`、`recovery.rs` 用例覆盖；D13 又在 CLI/HTTP 层实测了 kill/restart
  与优雅关闭（9.9）。App 内实测仍缺，见 9.8 末条。
- **App 的 journal 位置**（本轮修复）：窗口进程此前把 journal 放在内存里，退出即忘；现已改为
  平台每用户目录（`REFYARD_STATE_DIR` 可覆盖），并有 `state_root.rs` 单测、桌面用例与两次真实
  启动实测（`…/Library/Application Support/refyard/journal/records` 在写入前即存在）。
- **E12 的 App 内实测**仍缺：D13 已在 CLI/HTTP 层用 release binary 实测 kill/restart（9.9），
  但桌面窗口内的 crash/restart 演示没有做。

### 9.9 D13 结果（打包、无 Node 证明、预算与退出，2026-09-18）

完整测量与逐条证据见 `docs/evidence/native-desktop-ssh/e-native-artifacts-shutdown.md`；
原始运行数据在 `docs/evidence/native-runtime.json`。

| 项                       | 结果           | 证据                                                                                                                                                                                     |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打包扫描                 | PASS           | `pnpm native:verify`：.app 12.6 MiB（≤30 MiB）、CLI 4.16 MiB（≤20 MiB），Mach-O 按 magic 识别、`otool -L` 仅系统库、内嵌前端按引擎 marker 扫描且不误报 Svelte 产物                       |
| 压缩体积                 | PASS           | `ditto -c -k` zip 3,585,815 bytes（非签名分发产物，仅作对比数字）                                                                                                                        |
| minimal PATH 启动        | PASS           | bench 以仅含 git/ssh 的 PATH 三次启动 release CLI；无任何 JS runtime 可达                                                                                                                |
| 缺 git                   | PASS           | `doctor` 退出 2 并打印诊断；`serve` 退出 2 `git was not found on PATH`——诊断而非白屏                                                                                                     |
| 缺 ssh（有 git）         | PASS           | `doctor` 退出 0：七个读取与三个操作全部列出，仅 ssh 目标被拒——缺 ssh 只禁用 ssh                                                                                                          |
| 断网                     | NOT RUN        | 需要切断本机网络接口，本轮未做；127.0.0.1 绑定与本地仓库不经过网络是构造性说明，不是测量                                                                                                 |
| 启动/读取延迟与内存      | PASS           | ready 52ms、first status 44–49ms、history 144–154ms、idle RSS ~4.5MB、status+diff 后 4592 kB；App 注册 66ms（window-ready 未脚本化）；无 PSS/总量虚构，CLI 无 WebView 故无共享页重复计数 |
| SIGKILL 中途写           | PASS           | release binary 被杀后重启：操作 `unknown`、仓库写被拒、三步 ack（400/404/200 且不改写 unknown）、此后写 202；暴露并修复重启后 `op_1` 撞号的种子 bug（`next_operation_seed` + 单测）      |
| SIGTERM 优雅关闭         | PASS           | 退出码 0；停机期间端口拒绝连接；重启后已完成操作仍 `succeeded`（优雅关闭绝不把完成改写为 unknown）、无需 ack 即可继续写                                                                  |
| SSH 子进程清理（关机时） | NOT RUN        | 关闭用例为本地仓库，无 SSH 子进程可清理；不标 PASS                                                                                                                                       |
| 读取消除（关机时）       | NOT RUN        | 优雅排水内没有可观测的进行中读；不标 PASS                                                                                                                                                |
| SSH host 列表 HTTP 路由  | 决定：保持关闭 | D13 未添加任何 host 列表路由；F08 的「待 D13 决定」以维持默认关告终                                                                                                                      |

### 9.10 D11 收尾结果（E13 阻塞解除面板，2026-09-18）

被阻塞仓库的解除入口已落地。`UncertainOutcomePanel`（`packages/git-ui`，纯 props、无 `$app/*`）
展示服务给出的原因与 uncertain 操作 id；解除按钮在复选框勾选前禁用（确认是显式的）。控制器
流（`apps/web/src/lib/workbench/mutations.svelte.ts`）：写被拒且 `code === "UncertainOutcome"`
时按详情里的 `operations` 建立面板状态 → 解除时重读 status 取新 `snapshotId` → 逐个调用
`host.acknowledgeUncertainOperation({confirmed: true})` → 回答若不是 `unknown` 则作为
InternalError 拒绝（绝不信任改写）→ 成功后清面板并刷新读取。写成功也会清除面板。

配套客户端修正：`packages/backend-http` 的 `acknowledgeUncertainOperation` 不再以 host
extension 探测为前置——ack 是 _service_ 路由，native HTTP 边界有该路由而没有 host 路由；
先探测 host 能力会在最需要 ack 的服务上错误地拒绝它。没有该路由的服务（旧 Node 服务）由
其自身的 JSON 404 拒绝，仍然诚实。

e2e（`tests/e2e/uncertain-outcome.spec.ts`，chromium+firefox 各 2 例）：真实浏览器 + 真实
Node 服务，仅拦截两条需要“杀进程才能产生”的回答（阻塞拒绝与 ack 应答）；断言面板出现、
原因与操作 id 可见、未勾选时按钮禁用、ack 请求体为契约形状（新快照 + `confirmed: true`）、
解除后面板消失且同一 stage 对真实服务成功。webkit 因拦截不可靠跳过并注明。

### 9.11 原生文件夹选择器与拖拽打开（用户指示，2026-09-19）

桌面 App 的 open repo 流程改为桌面原生的方式，Web 的目录浏览保留为后备：

- **原生 folder picker**：desktop 链接 `tauri-plugin-dialog`（仅 Rust 侧调用；WebView 不授予
  任何 `dialog:*` 权限），`pickLocalDirectory` 经 `refyard_host_request` → `FolderDialog`
  trait 打开系统面板，回答完整路径或 `null`（取消是回答不是错误）。`hostCapabilities`
  的 `localFolderPicker` 相应翻为 `true`，launcher 以该 flag 决定是否提供
  「Choose folder…」按钮；Web（HTTP 适配器无法打开对话框）保持 flag=false、无按钮，
  且点击被拒时在表单旁显示服务原话。
- **拖拽文件夹**：`HostService` 增加可选 `onDragDropPaths`（phase: enter/over/leave/drop +
  完整路径）；Tauri 组合根用官方 `getCurrentWebview().onDragDropEvent` 实现该端口，页面监听
  后全窗口高亮、drop 即在本机 target 打开（Finder 拖入的是本机路径，即使当前选中 SSH
  target 也按本机开）。浏览器适配器不含该方法，UI 相应不提供该可供性。
- **真机验证**：AX 实测——按钮出现 → 点击弹出系统 open panel → Cmd+Shift+G 定位 fixture
  仓库 → Open → App 直接进入该仓库工作台（历史/变更面板渲染正常）。拖拽的手势本身无法
  自动化合成，链路（端口→适配器→页面→打开）为类型化代码，真机可用性待用户拖一次确认。
- **测试**：`native-folder-picker.spec.ts`（chromium+firefox，webkit 因拦截不可靠跳过）钉住
  flag 两个方向的门控与拒绝显示；`session_owner.rs` 新增 picker 形状用例（选择→路径、
  取消→null）。bundle 增至 13.3 MiB（dialog 插件），`native:verify` 仍绿（预算 ≤30 MiB）。

### 9.12 E14 crash/restart 演示（运行中的 App，2026-09-19）

目标：证明"进程死在写操作中途 → 重启后该仓库写入被阻塞、结果按 unknown 记录 → 经显式
三步确认解除"这条链在真实 App 里端到端成立（此前只有 host 级测试覆盖）。

**Fixture**（`/tmp/refyard-crash-demo/{repo,home,state}`，全程隔离，不碰任何真实仓库）：
repo 基线提交 `5a27097`（"base"），README.md 已修改未暂存；`.git/hooks/pre-commit` 为
`sleep 10`，给杀进程一个确定性窗口；repo 本地 config 写入 user.name/user.email——host 剥离
`GIT_*` 环境变量，净环境下提交身份只能来自 repo 配置（这也被本演示顺带证实：漏配时提交以
"Author identity unknown" 快速失败，被拒发生在写入之前）。App 以净环境启动：

```sh
env -i HOME=/tmp/refyard-crash-demo/home TMPDIR=/tmp/refyard-crash-demo \
  PATH=/usr/bin:/bin REFYARD_STATE_DIR=/tmp/refyard-crash-demo/state LANG=C \
  apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app/Contents/MacOS/refyard-desktop
```

**过程**（AX 驱动真实 macOS App；WKWebView 无 WebDriver，无法用 Playwright）：

1. App 内 stage README.md、填提交信息、点 Commit（journal 记为 `op_5`，状态 running）。
   提交卡在 pre-commit 的 sleep 期间时对整个 App 进程 `kill -9`——此刻 git 尚未写入任何
   对象或引用。
2. 重新启动 App（journal 载入 op_1…op_5，op_5 停在 running）。经原生 folder picker 重开同一
   仓库，点 Stage README.md：写被拒，`UncertainOutcome: process restarted with the
operation in flight`，同时出现 UncertainOutcomePanel（role=alert）："Writes are blocked:
   an operation's outcome is unknown"，列出 `op_5` 与原因；确认按钮在复选框勾选前禁用。
3. 勾选复选框 → 点「Confirm and unblock writes」→ 面板消失；再点 Stage README.md 成功
   （"staged 1 path"，Staged Files 1）。

**磁盘证据**：

- `state/journal/records/op_5.json`：`status: "unknown"`、`result: null`、
  `problem.code: "UncertainOutcome"`、`unknownReason: "process restarted with the operation
in flight"`、`acknowledgedAtMs: 1789758750313`——ack 只记录确认，不改写已记录的结果。
- `op_6.json`（解除后的 stage）：`status: "succeeded"`，summary "staged 1 path"。
- `git -C repo log --oneline` 仅 `5a27097 base`——被杀的提交没有落地；`git status --short`
  为 `M  README.md`（解除后那次 stage）。

**诚实备注**：窗口期内共四次实例迭代。较早一次杀晚了（工具往返超过 hook 的 10s 窗口），
提交落在了磁盘上——这恰好演示同一语义的另一面：无论提交是否落地，重启后该 op 都必须按
unknown 处理、不得自动重试，两条路都汇入同一个阻塞+确认流程；该次 fixture 随后重置。最终
记录的这一次用后台 watcher 实现确定性（等待 journal 出现 op_5 文件后再 sleep ≈1.5s 杀）。
E14 的 host 级自动化覆盖不变：`tests/native/http-shutdown.test.ts`（SIGKILL→unknown→阻塞→
三步 ack；SIGTERM 优雅退出）与本轮 e2e；本节补上"运行中的 App 里可见"这一环。

### 9.13 关机时 owned SSH 子进程清理实测（真实 App + SSH fixture，2026-09-19）

D13 清单遗留项的实测。结论先行：**进程内的 kill-and-reap 是实的（deadline/cancel/被取代的
读都被杀干净并 reap）；但 App 的两条退出路径都会把在途的 ssh 子进程孤儿化**——这是一个
named gap（见 remaining-tasks 与 status 文档），不是 PASS。

**设置**：release 版 App，净环境 + `REFYARD_STATE_DIR=/tmp/refyard-ssh-demo/state` +
`REFYARD_SSH_CONFIG` 指向 fixture 配置；真实 Docker SSH fixture（容器
`refyard-native-ssh-fixture`，端口 32788）上的远端仓库在 App 内打开（历史 2 提交、工作副本
3 变更，全部经 SSH）。读进程可精确计数：App 派生的每个 `ssh` 都带
`-F …/native-ssh-fixture/home/.ssh/config`。停顿手段：`docker pause` 冻结容器——TCP 握手仍
由内核完成，sshd 不再应答，于是新的 ssh 在 banner exchange 处挂起；OpenSSH 把
ConnectTimeout（此处固定选项策略里的 15s）同样应用于 banner，所以每个挂起子进程 ~15s 后
自断。

**进程内行为（不关机，作为对照）**：挂起批次的子进程在读被取代/取消时 ~2s 内消失——与
runner 文档一致（deadline 或 cancellation 即 kill **and reap**，`process/runner.rs` 的
`kill_on_drop(true)` + `cleanup.rs` 的 terminate）；未被取代的挂起读则活满 15s 自断。停顿
期间 UI 的表现也符合设计：读失败如实呈现（"Could not read history — GitCommandFailed:
for-each-ref exited with status 255" + Retry），全部写按钮禁用（fail-closed）。

**Cmd+Q（优雅退出）**：挂起读在途时 Cmd+Q——App 退出，**至少一个 ssh 子进程被孤儿化**
（ppid=1，非僵尸、活动睡眠态），存活直到它自己的 15s 客户端超时到期后才消失。Tauri 的
退出路径没有经过 Tokio runtime 的 drop，`kill_on_drop` 不触发。

**SIGTERM**：无 handler（App 未装任何信号处理），进程即刻死亡，**全部 4 个在途子进程孤儿
化**（ppid=1，状态 `SN`），各自在 ~15s（按生成时间错开）自断；此后无残留，解冻容器后一切
正常。换言之：孤儿的寿命由 ssh 自己的固定选项（ConnectTimeout 15s / ServerAlive 15×2）
兜底，有界但不受我们控制；若连接停在已认证后的通道读上，孤儿可活到 ~30s 以上。

**边界与未测**：native CLI 无法进入本测量——SSH target 是进程内状态（`TargetRegistry`
纯内存），只能由桌面 App 的 host request 创建，CLI 的 HTTP 边界没有该路由，因此
"CLI + SSH 子进程" 无法构成；CLI 自身的优雅退出（exit 0、在途写不丢单）已由
`http-shutdown.test.ts` 覆盖。本节全部实测于 macOS arm64；Windows/Linux 未测。修复方向
（后续任务，先写失败测试）：装 SIGTERM/SIGINT handler 并在 Tauri 退出钩子里触发一个服务级
cancellation，接入每次读已预留的 `cancel` 槽位——runner 的杀+reap 逻辑已经存在，缺的只是
退出时的一跳。

### 9.14 单层顶部条与 Settings sheet；全引擎 e2e 转绿（用户指示，2026-09-19）

**顶部重构**（用户以 GitKraken 为参照：最上面就是 tabs，不要多层）。桌面窗口的标题栏改为
Overlay（`titleBarStyle: "Overlay"` + `hiddenTitle`，红绿灯叠在页面上），工作台 header 收成
**一条**：仓库 tabs 领先（不再占第二行），其后是仓库胶囊、诚实徽标（write operations、
connection-state），尾部一个 gear。原 header 里的 logo/字标、git 版本、服务实例 id、
backend 标签、Theme 按钮和亮暗下拉全部撤下：appearance（Light/Dark/System、accent、背景、
毛玻璃）进 `SettingsDialog`（git-ui 新组件，触发器是 gear）的 Appearance 区；机器细节进其
About & connection 区（Disconnect 随之移入）。顶条即拖拽区（`data-tauri-drag-region`），
WebView 能力仅新增 `core:window:allow-start-dragging`；macOS 桌面运行时头部让出红绿灯内衬
（浏览器表单不变）。真机验证：AX + 截图确认单行、红绿灯叠合、拖拽移动窗口成功、
Settings 打开且亮暗切换生效（aria 状态往返翻转）；`build-badge`/`connection-state` 文本
原样保留，故既有断言不变。

**context-menu 失败根因与修复**（2c7dd73）：firefox/webkit 失败不在被测功能，而在
`grantPermissions(["clipboard-read"])`——Firefox 直接拒绝该权限名，测试在第一个断言前就死。
commit 菜单的建分支/建标签动作留在全员用例；"Copy SHA" 的系统剪贴板副作用拆成
chromium-only 用例，skip 理由写明（剪贴板读回是 Playwright 里 Chromium 独有的能力）。断言
没有放松，只是把只能在 Chromium 验证的那条放到 Chromium。

**全引擎结果**：chromium 60/60；firefox+webkit 全量 116 passed / 6 skipped（跳过项全部
in-spec 注明：剪贴板读回 ×2、uncertain-outcome 与 folder-picker 的 webkit 拦截不可靠
×4），0 failed。`pnpm check`、`test:unit` 428、desktop crate 25+1 全绿。

### 9.15 离线（无网络）本地仓库回路实测（2026-09-19）

D13 清单最后一项。"network cut" 不需要拔网线：macOS Seatbelt 沙箱可以把网络禁在**这一个
App 进程**上，比切断整机网络更干净（变量只落在 App 上，其余一切照常）。会话不中断，用户
的网络不受影响。

**禁网强制的证明（对照组设计）**：`sandbox-exec -n no-network curl https://example.com` 在
沙箱内 DNS 直接失败（exit 6），同一台机器不套沙箱的 curl 返回 200——沙箱确实禁网。App 以

```sh
sandbox-exec -n no-network env -i HOME=<scratch> PATH=/usr/bin:/bin \
  REFYARD_STATE_DIR=<scratch-state> …/Refyard.app/Contents/MacOS/refyard-desktop
```

启动。`lsof -a -p <pid> -i` 在启动时与提交后两次采样均为**零网络套接字**（对照组进程可见
套接字，lsof 语义正常）。

**完整回路（全部在该禁网 App 内完成）**：Recent 打开本地 fixture 仓库 → 历史 3 提交、工作
副本 3 变更全部正常渲染 → Stage README.md 成功（"staged 1 path"，journal `op_1`
succeeded）→ 提交。第一次提交被 git 拒绝：该 fixture 仓库没有本地身份，App 的净环境
（scratch HOME + 剥离 `GIT_*`）正确地隔离了用户全局配置，UI 如实显示
"failed: git refused the operation: Author identity unknown"，journal `op_2` 记
`GitCommandFailed`，无半写、无自动重试——失败路径同样是证据。给 fixture 写入 repo 本地身份
后再次提交：**`b603b9d "commit made with no network at all"` 落盘**（2 文件，本地身份
Offline Fixture），journal `op_3` succeeded。

**结论**：桌面 App 的读取与写入（stage/commit）在进程级断网下完整可用；App 平时即不持有
任何网络套接字。"离线"从清单上的 not exercised 变为实测 PASS。e2e 的 offline.spec 继续以
`context.setOffline` 覆盖浏览器表单的断网行为，与本测量互补。全部实测于 macOS arm64。

### 9.16 自动更新（Item 2）实施与实测（2026-09-19）

按 release spec §4（用户确认 endpoint = GitHub Releases 托管 latest.json；交互 = Settings
手动检查 + 可选启动检查默认关）实施：

- **密钥**：`tauri signer generate --ci` 生成 minisign 密钥对；公钥提交进
  `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥留在 `~/.tauri/`（不入库），待 owner
  写入 `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`) secrets。
- **配置与能力**：`bundle.createUpdaterArtifacts: true`；endpoint
  `https://github.com/HuakunShen/refyard/releases/latest/download/latest.json`（强制
  HTTPS）；WebView 能力新增 `updater:default` 与 `process:allow-restart`——前者只在用户
  于 Settings 请求检查时使用，后者只用于安装后重启。
- **前端**：状态机（idle/checking/up-to-date/available/installing/ready/error）在
  `git-ui`（`lib/updates.ts`，5 个 vitest 钉住：不可重入、三种诚实终态、安装路径）；Tauri
  壳在 `apps/web/src/lib/runtime/updates.ts`（懒加载插件，浏览器构建不携带更新器代码）；
  Settings 的 UPDATES 区块 + 可选启动检查开关；启动检查发现的更新以 banner 提供
  "Install and restart"，绝不自动下载。
- **实测**：`cargo check`/`desktop:build` 全绿；带私钥构建产出 `Refyard.app.tar.gz` +
  `.sig`（16.4 MiB 安装后，预算 ≤30 MiB 内）；真机 AX：Settings 出现 UPDATES 区块，点击
  Check for updates，插件打到真实 GitHub feed（尚无 release）→ UI 如实显示 feed 的
  "Could not fetch a valid release JSON from the remote"。整条 IPC→插件→endpoint→错误
  呈现链路成立；剩余一步是 owner 配 secrets 后推 `app-v0.1.0`，届时 latest.json 存在，
  同一路径应给出 offer（旧版本 App 消费新 release 的完整验证随之可做）。

### 9.17 0.1.0 → 0.1.1 发布线与更新器完整循环实测（2026-09-19）

- **发布线**：`app-v0.1.0`（run 35405708085）与 `app-v0.1.1`（run 35409845310）两次 release
  run 均 6/6 全绿（gate + mac aarch64/x64 + ubuntu x64/arm64 + windows NSIS），产物含
  DMG/deb/AppImage/NSIS 与 `latest.json` + 各自 `.sig`。0.1.0 首跑在 Windows 失败于
  tauri-build 缺 `icons/icon.ico`（`ccc1e39` 修复后重打 tag 验证）；0.1.0 的 mac x64 失败于
  `rust-toolchain.toml` 钉死版本号在 cross 目标上的解析（`c94911e` 改 `channel = "stable"`）。
- **更新器完整循环（真机 AX 驱动，此前 §9.16 的"剩余一步"）**：从 release 资产取
  `Refyard_0.1.0_aarch64.app.tar.gz` 解包到 `/tmp/refyard-upd-e2e/` 并启动（Info.plist
  0.1.0）；Settings → Check for updates 从线上 feed 拿到 offer（按钮变为 "Download and
  install v0.1.1"）；点击后下载、minisign 验签、就地替换 bundle（Info.plist 变 0.1.1），
  按钮变 "Restart to finish"；点击后旧进程退出、新进程自替换后的 bundle 重启且工作台
  完整可用。即：**endpoint → 验签 → 安装 → 重启全链路在真实 release 上成立**。测后清理：
  退出实例、删除 `/tmp/refyard-upd-e2e`。
- **冷启动白闪消除（用户指示 B+C+A，`500b36c`+`d28cea7`，随 0.1.1 发布）**：
  (C) `app.html` 内联预绘脚本读 `mode-watcher-mode` ?? 系统外观，在首帧前给 `<html>` 上
  正确主题类（Playwright 五组合验证：存深/存浅/未存 × 系统深/浅，底色精确
  `rgb(10,10,10)`/`rgb(250,250,250)`）；(B) 窗口 `visible:false` + Rust 侧
  `on_page_load(Finished)` 才 `show()`，另有 4s 守卫线程兜底（debug 冷启动实测窗口
  1165ms 首次可见，此前从创建即白窗可见）；(A) `window.theme()` + `ThemeChanged` 跟随
  运行时设置窗口底色（`set_background_color`；静态 `backgroundColor` 配置键在
  tauri-utils 2.9.3 不存在）。用户真机确认首帧即深色画布。
- **VS Code 扩展随 release 分发**：打包脚本去掉硬编码版本（`-o refyard-$npm_package_version.vsix`，
  扩展版本 bump 0.1.1）；`release.yml` 新增 `vsix` job（`f81ce16`：从 tag 取版本、打包、
  等待 release 出现后 `gh release upload --clobber`，仅 tag 触发）；0.1.1 的
  `refyard-0.1.1.vsix` 已手工挂上 release，并经 `code --install-extension` 装入本机
  VS Code（`huakunshen.refyard-vscode@0.1.1`）。在 VS Code 里打开工作台的人工确认仍待
  owner 执行。
- **Homebrew**：cask 0.1.1 已推 `HuakunShen/homebrew-tap`（`brew fetch` 校验通过）；
  Homebrew 7 弃用 `depends_on macos: :catalina` 与 `url` 的 `verified:`，均已移除。

### 9.18 文件选择器请求堆积冻结全 App（用户报告，2026-09-19 修复）

**现象**（用户真机）：在启动器连点 Choose folder… 数次后整个 App 冻结——拖拽区、一切交互
均无响应。用户强退并重启后，冻结进程已被销毁，未能采样到现场；修复前的代码审查给出充分
的结构性原因：`blocking_pick_folder` 的 unparented 浮动面板不模态到窗口，webview 在面板
存续期间仍可点击，每次点击把一个新的 main-thread 任务排到队列，并与 `run_on_main_thread`
的运行模式相互等待；请求与面板随即堆积，App 呈现全局冻结。

**修复**（`ae264ad`）：① 面板 `set_parent` 到发起请求的窗口——成为可见的、window-modal
的 sheet，面板存续期间 webview 收不到点击，天然不会堆积；② 增加进程级在飞守卫
（`FOLDER_PICKER_OPEN`），并发第二个请求直接按取消（`null`）作答；③ 不再使用
`blocking_pick_folder`，改为回调 + channel 接收答案。

**实测**（AX 驱动真实 release 构建，用户处复现路径不可用后以结构验证代替）：点击
Choose folder… 出现附着于主窗口的 "Open" 面板（`list_windows` 可见、onscreen）；Escape
取消后面板关闭、主窗口重获焦点、请求按 `null` 作答；连续两次点击只存在一个面板（第二个
请求被守卫吸收）；在面板中选中目录点 Open，路径经 IPC 回填并作为仓库打开（历史、工作
副本正常渲染），全程无冻结。测试后关闭该仓库标签恢复原状。随后的第二轮用户冻结（选文件夹后点 Browse）把根因指向面板的可见性而非请求堆积：
`set_parent` 后面板是窗口模态的，但当 App 不在前台时它附着于一个背景窗口——用户看不到
它，面板却吞掉该窗口的一切点击，App 呈现"整体冻结"。最终修复（`8fc906a`）：打开面板前
先 `show()` + `set_focus()` 把窗口带到前台，面板永远可见。**实测**（AX 驱动）：把 App 压到
后台（Chrome 前台）后点击 Choose folder…，App 自动带到前台、面板以可见 sheet 呈现
（截屏确认），Cancel 后窗口恢复正常交互。debug 实例（临时 eprintln 插桩 + 正式 app 壳）
上全链路验证：请求到达 → 面板可见 → Escape 取消按 null 作答 → 连点只存一个面板（守卫）
→ 选目录点 Open 路径经 IPC 回填。Browse 空路径在 Rust 侧立即按 InvalidRequest 拒绝
（`reads/filesystem.rs` 回落主目录），无挂起。插桩已移除。
