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

| ID | 测试 | 通过条件 |
|---|---|---|
| A01 | release App从Finder启动 | 不要求终端先启动后端，无Node executable设置，无白屏 |
| A02 | 最小PATH运行 | PATH不含JS runtime仍显示local repo |
| A03 | 依赖/资源扫描 | 无Node/Bun/Deno/JS VM/backend bundle/Electron；允许frontend JS |
| A04 | 进程树 | 正常fixture只有native宿主、WebView与Git/SSH/system helpers，不存在Refyard JS服务 |
| A05 | IPC | native读取/写入经Tauri commands；不打开Refyard localhost HTTP listener |
| A06 | 独立CLI | nativeCLI dependency tree不含Tauri/WebView；可运行doctor/serve |
| A07 | 同UI | HTTP与native使用同一Svelte组件，无desktop复制版页面 |
| A08 | 原有形态 | Node localhost现有tests及Cloudflare静态build仍通过 |

### B. Adapter/生命周期

| ID | 测试 | 通过条件 |
|---|---|---|
| B01 | native ready无bearer | UI正常加载，不生成fake token |
| B02 | DTO错误 | HTTP/Tauri均拒绝schema错误，不渲染假空列表 |
| B03 | mutation exactly once | 断开响应不导致第二次submit |
| B04 | 请求迟到 | 切target/backend后旧响应不污染新页面 |
| B05 | cache namespace | 相同path不同target不共享repo/snapshot/preview缓存 |
| B06 | 订阅竞态 | handshake期间event无重复/漏交付，或准确gap并refresh |
| B07 | Event isolation | 窗口B收到不到A的repository事件，借用A session也拒绝 |
| B08 | Dispose | 幂等释放listener/timer，不关闭其他session的SSH连接 |
| B09 | Feature gating | 未支持read不后台轮询，未支持write不显示enabled |
| B10 | Legacy host | 新UI接旧Node1.1.0工作，不发送其不认识的target query |

### C. SSH config发现与信任

| ID | 测试 | 通过条件 |
|---|---|---|
| C01 | 默认选择 | Open Repo首次默认Local，未自动SSH连接 |
| C02 | 搜索Host | 可搜索alias并选中，source/alias清楚 |
| C03 | 多alias/裸Host | 一行多alias和没有option的Host都能列出 |
| C04 | 通配符/negation | 不显示`*`、`*.corp`、`!blocked`为具体机器 |
| C05 | Include | 基本全局Include、顺序、quoted path、relative base正确 |
| C06 | Bounded parsing | 循环/过深/超大不会hang；结果有准确warning |
| C07 | Passive discovery | 打开picker不执行ssh/Match exec/ProxyCommand，不读取key bytes |
| C08 | Manual alias | discovery不完整时能手填具体alias，仍经过token验证 |
| C09 | Alias原样执行 | 原始alias交OpenSSH，不用不完整手写resolver扁平化 |
| C10 | 配置刷新 | 新增Host后刷新可见；配置revision变更使旧target重新确认/探测 |
| C11 | 已知host key | 使用系统/测试known_hosts严格验证 |
| C12 | 新key/更换key | 不自动关闭checking，不覆盖known_hosts；明确告知连接未完成 |
| C13 | 外部配置 | repo提供的ssh_config不会自动导入执行 |
| C14 | API权限 | HTTP host discovery未enable/未授权时不可枚举backend hosts |

### D. SSH执行及读取

| ID | 测试 | 通过条件 |
|---|---|---|
| D01 | 真实无部署服务器 | 无Refyard/JS runtime，App显示真实status/history/diff |
| D02 | 无PTY | stdout/stderr分离，binary/NUL输出无终端转换 |
| D03 | Quoting | 路径含空格/quote/metacharacters不改变argv、不执行额外命令 |
| D04 | stdin | commit message和NUL pathspec完整到达，不被-n吞掉 |
| D05 | 目标正确 | 远端路径不用本机realpath/stat；同名local path不被访问 |
| D06 | Unborn/detached | 不报不存在HEAD为general failure；UI语义准确 |
| D07 | History分页 | tips固定，分页不混入移动HEAD后的历史 |
| D08 | Binary/large | marked binary/oversize/truncated，不把不完整patch当完整 |
| D09 | Bare/worktree | 支持部分按capability；不把`.git`文件误当目录失败 |
| D10 | 连接丢失 | UI失联可重连；失败读取不缓存成empty repo |
| D11 | 远端shell | 非验证过的shell明确unsupported，不假装POSIX |
| D12 | SSH复用 | 只关闭App持有master，不影响用户既有terminal连接 |
| D13 | 最小依赖 | product没有远端npx/curl-install/文件上传/helper启动 |
| D14 | 凭据生态 | 真实1Password/key agent单独验收；没测不写已支持 |

### E. 最小写入闭环

| ID | 测试 | 通过条件 |
|---|---|---|
| E01 | Selected stage | 只选a.txt，b.txt未被stage |
| E02 | Staged diff | 与直接Git输出和服务DTO一致 |
| E03 | Unstage | 只改index，工作文件不被恢复 |
| E04 | Unborn unstage | 无HEAD仍可安全取消暂存或明确feature拒绝，不丢文件 |
| E05 | Commit | 提交当前index，不自动stage；远端git log有同OID |
| E06 | Hook/signing | hook失败被保留，未添加no-verify或关闭signing |
| E07 | Preview stale | 内容改而status仍M，stage拒绝StalePreview |
| E08 | Snapshot stale | HEAD/index变动，整批拒绝，无部分写入 |
| E09 | Unsupported path | symlink/submodule/无法编码/超限路径整批拒绝并解释 |
| E10 | Duplicate request | 同id同payload不再执行；同id不同payload冲突 |
| E11 | SSH中断 | 不确定结果为unknown，不自动retry |
| E12 | Crash/restart | running记录恢复为unknown并block相关后续写 |
| E13 | Explicit ack | 新snapshot确认后解除block，但unknown不被改写成success |
| E14 | 取消 | queued可cancel；running不被谎称回滚 |
| E15 | Non-destructive首轮 | discard/force/push/amend等未实现按钮不能执行 |
| E16 | Local/SSH一致 | E01–E15两种provider共用相同tests/业务流程 |

### F. 原生HTTP与兼容

| ID | 测试 | 通过条件 |
|---|---|---|
| F01 | 认证读取 | 所有业务读取保持既有认证要求；不新增匿名health或discovery例外 |
| F02 | Host/Origin | 错误authority/origin拒绝；无`*`CORS |
| F03 | ticket | 单次/expiry/清理保持既有语义 |
| F04 | SPA/API分离 | 错误/api路径JSON404，不能fallback成HTML200 |
| F05 | SSE | bearer在header，不在URL；gap/reconnect正确 |
| F06 | Host目标授权 | 跨session targetId/repoId/operationId拒绝 |
| F07 | same service | HTTP与Tauri调用同一Rust service，operation结果一致 |
| F08 | browser能力 | 网页不直接SSH/读本机key/接UDS；Cloudflare不接管credentials |

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
