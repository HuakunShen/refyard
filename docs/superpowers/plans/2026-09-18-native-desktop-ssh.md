# Refyard 原生桌面与 Agentless SSH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付不依赖 Node/Bun/Deno 的 Tauri App，复用现有 Svelte UI，通过本机 OpenSSH 操作远端 Git repo，远端不安装 Refyard。

**Architecture:** 独立 Rust Git application service 同时供 Tauri IPC 与原生 CLI/HTTP 使用。前端 BackendAdapter 将 HTTP/SSE、Tauri commands/events 隔离在边界；Rust ExecutionProvider 将 Local 与 SSH 隔离在另一条边界。Node 实现只在迁移期保留作为现有产品路径与差分参考，不参与 native runtime。

**Tech Stack:** Rust 1.98 / Tokio / serde / Tauri 2 / existing Svelte 5 + SvelteKit static / system Git + OpenSSH / optional Axum / Vitest + Cargo tests + isolated SSH fixtures.

**Spec:**
- `docs/superpowers/specs/2026-09-18-native-desktop-ssh-design.md`
- `docs/superpowers/specs/2026-09-18-backend-adapter-contract.md`
- `docs/acceptance/2026-09-18-native-desktop-ssh.md`

## Global Constraints

- 正式desktop不包含、不寻找、不下载Node/Bun/Deno或backend JS VM；build/test仍可使用现有JS工具链。
- Tauri前后端使用commands/events，不使用localhost HTTP桥。
- 所有UI共享同一个GitService，所有native入口共享同一个Rust application service。
- UI不接触raw argv、shell text、env、SSH key bytes或HTTP bearer。
- 远端不安装Refyard/Node/helper；只有经验证的SSH server、Git与普通POSIX用户环境要求。
- 现有Node CLI、localhost UI和Cloudflare构建不回归；不得为了native移除这些入口。
- 首轮实测平台是macOS arm64本地及Linux POSIX远端，其他平台证据单列。
- 所有写测试只用新建isolated fixture，禁止在真实repo、真实SSH config、真实known_hosts上做写入实验。
- 不绕过hooks/signing/host-key checking、不删Git lock、不自动重试mutation。
- no-op、hardcoded example、mock-only测试、cargo check都不能代替真实功能验收。
- 文档的预算与阈值是设计约束，不是已测性能或完成时间承诺。
- 本计划只要求实现上述决定；不重新讨论Rust/Go/Electron/Node sidecar，不因旧AGENTS禁止native而停下。

---

## 0. 执行节奏和依赖

每项均执行 RED → GREEN → REVIEW → 单独commit。禁止一次生成所有代码后才运行测试。

### 可见交付物优先

1. **A / 本地App**：D00–D06，真实App打开本地repo并显示status/history/diff。
2. **B / Agentless SSH**：加D07–D09，从配置Host打开远端repo，相同UI读取真实数据。
3. **C / 最小控制**：加D10–D11，local/SSH均可stage、unstage、commit，含预检、日志、unknown语义。
4. **D / 原生CLI与验收**：D12–D14，独立CLI/HTTP兼容、release产物、无Node及真实SSH证据。
5. **E / 全量替代**：P01–P05，在A–D均有可运行产物之后继续；不阻塞A–C。

每完成A/B/C，立即构建一次release App并记录绝对路径。不要等所有复杂Git操作迁移完才第一次打开桌面窗口。

### 并行拆分（可用subagent时）

D01冻结接口后，可以让：
- Agent R：D03–D04 Rust process/reads；
- Agent S：D07–D08 SSH config/provider；
- Agent U：D02、D05–D06 adapters/desktop/UI；
- integration owner：D00/D01/shared contract、D09集成、D10–D14。

只允许owner改 `git-contract`、Cargo workspace、lockfiles、`+page.svelte` 集成部分。子agent在独立worktree工作；禁止多个agent同时改同一个工作树。无subagent时按D00→D14串行。

## D00 — 基线与native范围修订

**Files:** Modify `AGENTS.md`, `docs/product/north-star.md`; Create `docs/evidence/2026-09-18-native-baseline.md`.

**Consumes:** 两份spec、当前真实HEAD。
**Produces:** 该分支允许native迁移，但原安全规则全部保留的说明，以及执行前基线。

- [ ] 记录working tree、HEAD、Rust/Node/pnpm/Git/SSH版本。保护未提交更改，创建`feat/native-desktop-ssh`独立worktree；已有同名则使用唯一后缀，不reset旧分支。

```sh
git status --short --branch
git rev-parse HEAD
git worktree list
rustc --version; cargo --version; git --version; ssh -V
```

- [ ] 在AGENTS加2026-09-18范围修订：Rust native允许；Node-only/no-Tauri条款仅是历史阶段。不得删安全、scope、fixture、capability-honesty要求。
- [ ] 执行已有基线；失败先记录是否先存，不能为了迁移weakening断言。

```sh
pnpm check:boundaries
pnpm check:contract
pnpm test:unit
pnpm test:integration
pnpm build:web
```

- [ ] 记录Cloudflare build仍为static，当前API_MAJOR=1/CONTRACT_VERSION=1.1.0（若已有新值则如实记录）。
- [ ] Commit: `docs(architecture): authorize native desktop and agentless ssh migration`。

## D01 — 契约与transport-neutral接口先冻结

**Files:** Create `packages/git-service/{package.json,tsconfig.json,src/service.ts,src/backend.ts,src/host.ts,src/events.ts,src/errors.ts,src/index.ts}`; Create `packages/git-contract/src/host.ts`; Modify `packages/git-contract/src/{reads,registry,index,version}.ts`, generated artifacts, root package workspace依赖; Test `tests/contract/native-backend.test.ts`.

**Consumes:** adapter spec第3–8节完整接口。
**Produces:** GitReadService、MutationService、BackendSession、HostService与Zod扩展；契约1.2.0。

- [ ] RED：为rust host kind、target query、非法host create union、privateKey未知字段、legacy Node DTO写测试。

```ts
it('accepts native capability kind without pretending to be node', () => {
  const value = { ...validCapabilities(), host: { kind: 'rust', version: '0.1.0' } };
  expect(capabilitiesResponseSchema.safeParse(value).success).toBe(true);
});
it('rejects raw credentials in target creation', () => {
  expect(createTargetRequestSchema.safeParse({
    kind: 'ssh-config', hostId: 'h1', privateKey: 'not-a-key',
  }).success).toBe(false);
});
```

`validCapabilities()`是在此测试文件内从现有contract fixture构造的完整合法DTO，不读取用户配置、不靠类型cast。将其抽到`tests/support/contract-factories.ts`供后续测试重用。

- [ ] 运行`pnpm exec vitest run tests/contract/native-backend.test.ts`确认缺字段/错误enum导致失败。
- [ ] 提取而非复制HTTP业务接口；保持既有方法和错误码。为host DTO/ack请求添加strict schema；新target字段可选，Node旧响应合法。
- [ ] `bun scripts/generate-schema.ts && pnpm check:contract && pnpm check:boundaries`；验证所有扩展无raw argv/shell/password入口。
- [ ] Commit: `feat(contract): define native backend and target-aware service interfaces`。

## D02 — HTTP adapter与adapter一致性测试

**Files:** Create `packages/backend-http/{package.json,tsconfig.json,src/adapter.ts,src/session.ts,src/events.ts,src/legacy-capabilities.ts,src/index.ts}`; Modify `packages/git-client/src/{client,mutations,index}.ts`; Test `tests/adapters/{http,conformance}.test.ts`; Create `tests/support/adapter-harness.ts`.

**Consumes:** BackendAdapter/GitReadService/MutationService/EventService。
**Produces:** `createHttpBackendAdapter(options: {baseUrl: string; fetch: typeof fetch}): BackendAdapter`。

- [ ] RED：same methods DTO、一次submit、session.dispose停止events、无token泄露、旧host扩展404降级。

```ts
it('does not expose the bearer through session metadata', async () => {
  const session = await harness.connectHttp();
  expect(JSON.stringify(session.metadata)).not.toContain(harness.secretToken);
  expect(session.state().phase).toBe('ready');
  await session.dispose();
  expect(harness.activeSubscriptions()).toBe(0);
});
```

`adapter-harness.ts`提供`createAdapterHarness()`；返回`connectHttp()`、`secretToken`、`activeSubscriptions()`、`requestLog`、`dispose()`。底层使用现有`tests/support/service.ts`与temporary repo，不能仅stub所有HTTP。

- [ ] RED验证后，包装现有HTTP client、MutationClient、fetch-SSE，不重写其协议细节。
- [ ] 将HTTP bearer留闭包，返回non-secret cacheNamespace；legacy Node没有扩展时返回准确HostCapabilities。
- [ ] 运行`pnpm exec vitest run tests/adapters/http.test.ts tests/adapters/conformance.test.ts`及既有client/session安全测试。
- [ ] Commit: `refactor(client): expose http through the shared backend session`。

## D03 — Rust workspace、typed contract和进程runner

**Files:** Create root `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`; Create `crates/refyard-contract/{Cargo.toml,src/lib.rs,src/{reads,operations,host,problem}.rs}`; Create `crates/refyard-core/{Cargo.toml,src/lib.rs,src/{plan,bytes,problem}.rs}`; Create `crates/refyard-host/{Cargo.toml,src/lib.rs,src/process/{mod,runner,environment,cleanup}.rs}`; Tests `crates/refyard-host/tests/process.rs`.

**Consumes:** JSON schema、Node runner与limits。
**Produces:** typed GitPlan/RunOutcome、受限ProcessRunner；不依赖Tauri或Axum的host库。

```rust
pub struct GitPlan {
    pub argv: Vec<String>,
    pub stdin: Vec<u8>,
    pub deadline_class: DeadlineClass,
}
pub enum DeadlineClass { Read, Network, Hook }
pub enum ExecutionState { NotStarted, Completed, Interrupted, Unknown }
pub struct RunOutcome {
    pub state: ExecutionState,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub output_complete: bool,
}
```

这些类型仅在可信backend中使用。metadata duration/termination原因可追加，但不能把output_complete折叠进exitCode。

- [ ] RED：stdin EOF、同时输出stdout/stderr、NUL保存、bounded output、spawn失败、timeout、process cleanup测试。
- [ ] `cargo test -p refyard-host --test process`先失败，再实现Tokio子进程并发drain；不能用阻塞read堵塞事件循环。
- [ ] 环境allowlist保留必要PATH/HOME/agent/signer信息，清理可重定向Git目标的环境；fixture自己的HOME独立。local用`Command.args`，无shell。
- [ ] Serde request使用deny_unknown_fields，Rust DTO响应交给JSON schema/Zod验证；不要新增Node依赖。
- [ ] `cargo fmt --check && cargo test -p refyard-core -p refyard-host`；Commit `feat(native): add typed rust core and bounded process runner`。

## D04 — Rust本地读取vertical slice与差分oracle

**Files:** Create `crates/refyard-core/src/parse/{mod,status,refs,cat_file,patch,worktree}.rs`, `src/plan/{mod,status,history,diff}.rs`; Create `crates/refyard-host/src/{service,registry,snapshots}.rs`, `src/providers/{mod,local}.rs`, `src/reads/{mod,status,history,diff,refs}.rs`; Create `scripts/export-native-fixtures.ts`, `tests/native/differential.test.ts`, `tests/fixtures/native/`.

**Consumes:** 当前TS parsers/planners/workflows、Node oracle。
**Produces:** `ApplicationService::new(config)`和local register/status/history/refs/diff/capabilities；有效分页snapshot/cursor。

```rust
pub struct RepositoryLocation {
    pub target_id: String,
    pub target_generation: String,
    pub canonical_worktree: String,
    pub canonical_common_dir: String,
}
#[async_trait::async_trait]
pub trait RepositoryAccess: Send + Sync {
    async fn open(&self, path: &str) -> Result<RepositoryLocation, HostError>;
    async fn run_git(&self, repo: &RepositoryLocation, plan: &GitPlan)
        -> Result<RunOutcome, HostError>;
    async fn read_selected_file(&self, repo: &RepositoryLocation,
        relative_path: &[u8], limit: usize) -> Result<FileRead, HostError>;
}
```

`HostError`映射现有Problem；`FileRead`为`Missing`或`Regular {bytes}`或`Unsupported {reason}`，不把未支持伪装空文件。M0可以显式返回Unsupported，D10再完成预览。

- [ ] RED：capture同一fixture的原始bytes与Node归一化结果，保存内容而非函数运行承诺；覆盖unborn、detached、renames、unicode、binary、shallow、worktree、SHA-256。
- [ ] 定义`refyard-fixture-driver` Cargo example（`crates/refyard-host/examples/fixture_driver.rs`）：从stdin读闭合test request，在临时fixture执行或解析bytes，stdout只输出DTO，stderr diagnostics。不出现在release。
- [ ] `pnpm exec vitest run tests/native/differential.test.ts`；只normalize随机ID/时间，不能normalize掉路径、OID、错误类型、缺失parent或truncation。
- [ ] 移植status/refs/history/diff相关模块，不一次翻译所有40个Git操作。history固定tips，page cursor绑intent，继续沿用graph TS渲染；尚未支持filter明确拒绝。
- [ ] 本地registry支持用户选择的root和canonical路径；不把`.git`当总是目录。local filesystemEntries保留已有folder-picker语义。
- [ ] `cargo test -p refyard-core -p refyard-host && pnpm exec vitest run tests/native/differential.test.ts`；Commit `feat(native): implement local git read workflows with differential tests`。

## D05 — Tauri薄宿主与IPC adapter

**Files:** Create `apps/desktop/{package.json,src-tauri/Cargo.toml,src-tauri/build.rs,src-tauri/tauri.conf.json,src-tauri/src/main.rs,src-tauri/src/lib.rs,src-tauri/src/commands.rs,src-tauri/src/events.rs,src-tauri/capabilities/main.json}`; Create `packages/backend-tauri/{package.json,tsconfig.json,src/{adapter,commands,events,index}.ts}`; Test `tests/adapters/tauri.test.ts`, `apps/desktop/src-tauri/tests/session_owner.rs`.

**Consumes:** BackendSession、ApplicationService、adapter spec命令表。
**Produces:** real native commands + `createTauriBackendAdapter(ports): BackendAdapter`。

- [ ] RED：一个status请求必须调用`refyard_git_read`而不是fetch；响应schema错误拒绝；windowB复用windowA session拒绝。

```ts
it('uses native IPC, never localhost HTTP', async () => {
  const session = await createTauriBackendAdapter(nativePorts).connect({});
  await session.git.status({ repositoryId: 'repo_fixture' });
  expect(nativePorts.calls.at(-1)?.command).toBe('refyard_git_read');
  expect(httpCalls).toHaveLength(0);
});
```

`nativePorts`是测试中注入的记录型invoke/listen端口，并返回完整schema-valid fixture；另由Rust tests验证真实dispatcher/owner gate。

- [ ] 实现闭合request enums和command到application service的调用，不能在commands.rs写Git argv/parser。
- [ ] main窗口capability只允许这些commands及所需目录选择；禁止通用shell/fs插件，拒绝远程web content拿native capability。app导航external link走系统浏览器。
- [ ] event按adapter spec注册listener→subscribe ack→replay/live→cleanup，Rust使用emit_to owner。no global repository event。
- [ ] `pnpm exec vitest run tests/adapters/tauri.test.ts && cargo test -p refyard-desktop`；Commit `feat(desktop): add tauri ipc host and native backend adapter`。

## D06 — 同一前端注入服务，交付本地App

**Files:** Create `apps/web/src/lib/runtime/{bootstrap,backend-registry}.ts`, `scripts/build-desktop.ts`; Modify `apps/web/src/routes/+page.svelte`, `apps/web/src/lib/workbench/{queries.svelte,mutations.svelte,session,repository-tabs}.ts`, `apps/web/src/lib/{operation-follow,session-negotiation}.ts`, `apps/web/svelte.config.js`, root scripts; Tests `tests/adapters/workbench-injection.test.ts`, `tests/e2e/native-workbench.spec.ts`。

**Consumes:** 两个BackendAdapter、现有UI。
**Produces:** UI在无token的native session正常工作；同源HTTP仍工作；App release产物A。

- [ ] RED：替换token enabled条件后，native ready session无bearer依旧发status读取；unready不发；缺少read能力不轮询。

```ts
expect(queryState({ phase: 'ready', supportsRead: true, hasSelection: true }).enabled)
  .toBe(true);
expect(queryState({ phase: 'ready', supportsRead: false, hasSelection: true }).enabled)
  .toBe(false);
```

`queryState`是新增纯函数，置于`apps/web/src/lib/workbench/query-state.ts`，输入仅上面三个字段；controller统一调用，测试不是独立死代码。

- [ ] controller注入GitReadService/MutationService/cacheNamespace，HTTP-specific session迁入adapter，操作事件走EventService；Error展示只认识BackendError。
- [ ] desktop复用`apps/web`，不fork页面。desktop build输出`apps/web/build-desktop/index.html`；web build保留`apps/web/build/200.html`。区分SvelteKit临时输出避免并发覆盖。
- [ ] 根`desktop:build`调用`bun scripts/build-desktop.ts`：先`pnpm --dir apps/web build:desktop`，再在`apps/desktop`运行`pnpm exec tauri build`；Tauri frontendDist为`../../web/build-desktop`。builder检测产物缺失报错，不启动Node backend。
- [ ] 运行两种frontend build和既有HTTP e2e，再从Finder或`open <actual.app>`启动真实App。显示本地修改和history，记录窗口截图/进程树/实际app路径。测试机不能用tauri-driver的平台使用真实GUI人工或可用原生自动化验证，浏览器mock不代替native窗口。
- [ ] Commit `feat(web): inject backend adapters and ship the local native workbench`。更新A的evidence后再继续。

## D07 — Rust SSH config候选目录与Local默认选择

**Files:** Create `crates/refyard-host/src/ssh/{mod,config_catalogue,config_lex,source}.rs`; Tests `crates/refyard-host/tests/ssh_config.rs`; Create `tests/fixtures/ssh-config/`; Modify `packages/git-ui/src/components/RepositoryLauncher.svelte`; Create `packages/git-ui/src/components/ExecutionTargetPicker.svelte`。

**Consumes:** HostService/SshHostList；KK Terminal交互、旧CrossCopy Include tests。
**Produces:** 静态Host候选列表；Local默认；明确的incomplete discovery warning。

```rust
pub fn concrete_aliases(text: &str) -> Result<Vec<String>, ConfigError>;
pub struct ConfigSource {
    pub id: String,
    pub path: std::path::PathBuf,
    pub include_base: std::path::PathBuf,
    pub revision: String,
}
pub struct IncludeLimits {
    pub depth: usize,
    pub files: usize,
    pub bytes: usize,
}
pub struct ConfigCatalogue {
    pub source: ConfigSource,
    pub limits: IncludeLimits,
}
// impl ConfigCatalogue adds:
// pub async fn list(&self) -> Result<SshHostList, HostError>
```

`ConfigCatalogue`没有执行器字段：候选枚举只依赖文件读取。`ConfigError`使用typed variants表达语法、权限、循环与预算错误，映射到HostWarning或HostError。

- [ ] RED：多Host、纯Host无option、通配符/negation排除、Include循环、quoted path、正确relative base、无文件、partial Include。

```rust
#[test]
fn concrete_aliases_are_not_wildcard_rules() {
    let names = concrete_aliases("Host prod staging\nHost *.corp !blocked\nHost bare\n").unwrap();
    assert_eq!(names, vec!["prod", "staging", "bare"]);
}
```

- [ ] parser只读取文本/文件，不得调用`ssh -G`或执行Match；alias source数据只用于display/selection，不自行解析credential。
- [ ] UI使用现有Command风格搜索；初始Local，不自动连接上次SSH；点击Recent可明确恢复其target。关闭再打开picker可以刷新配置。
- [ ] `cargo test -p refyard-host --test ssh_config`；UI测试mock HostService但验证Local default、search、warning和no-network-on-open。
- [ ] Commit `feat(ssh): discover config hosts without executing configuration`。

## D08 — 系统OpenSSH provider与远端repo读取

**Files:** Create `crates/refyard-host/src/ssh/{openssh,quote,probe,connection,policy}.rs`, `src/providers/ssh.rs`; Tests `crates/refyard-host/tests/{ssh_quote,ssh_exec}.rs`; Create `tests/native/ssh-fixture/{Dockerfile,sshd_config,README.md}`, `scripts/native-ssh-fixture.ts`。

**Consumes:** RepositoryAccess、GitPlan/RunOutcome、明确选中hostId/config source。
**Produces:** `SshProvider`实现RepositoryAccess.open/run_git；真实fixture不含Refyard或JS runtime。

```rust
pub fn quote_posix(value: &str) -> Result<String, HostError>;
pub fn remote_git_command(repo_path: &str, plan: &GitPlan) -> Result<String, HostError>;
```

- [ ] RED：quotes/metacharacters/Unicode/space不改变远端argv；NUL拒绝，stdin二进制完好。

```rust
#[test]
fn rejects_nul_before_a_process_can_start() {
    assert!(quote_posix("bad\0path").is_err());
}
#[test]
fn single_quote_is_one_argument() {
    assert_eq!(quote_posix("a'b").unwrap(), "'a'\"'\"'b'");
}
```

- [ ] 可用Docker/Podman fixture以private network、本机ephemeral port起sshd；服务镜像只有Git/OpenSSH/POSIX环境。SSH host key在fixture本地生成并直接构造known_hosts，禁止盲信ssh-keyscan。无container环境则使用用户已授权的disposable target；无目标时标记真实验收blocked，继续其他任务，不伪造成功。
- [ ] 按spec策略构造OpenSSH参数，保留alias/config，不导入私钥。先strict known host连接，`ssh -G`只在显式信任/连接阶段用于diagnostic，不作全局扫描。
- [ ] probe Git版本/格式/执行shell语义；同一Rust reads通过SSH跑status/history/diff，stdin不被`-n`/StdinNull吞掉。
- [ ] 真实测试命令`pnpm native:ssh:fixture -- start`、`cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1`、fixture stop在finally。记录无runtime证明，Commit `feat(ssh): execute git remotely through system openssh`。

## D09 — SSH目标接入统一launcher、tabs和缓存

**Files:** Modify `crates/refyard-host/src/{service,registry,snapshots}.rs`, `src/ssh/connection.rs`; Modify `apps/web/src/lib/workbench/{repository-launcher,repository-tabs,queries.svelte,mutations.svelte}.ts`, `packages/git-ui/src/components/{RepositoryLauncher,RepositoryTabs}.svelte`; Tests `tests/e2e/ssh-repository-launcher.spec.ts`, `tests/unit/target-cache.test.ts`。

**Consumes:** HostService.createTarget、SshProvider、现有registerRepository。
**Produces:** visible交付物B，Local/SSH同UI，无远端后端。

- [ ] RED：同路径、不同target产生不同tabs/cache；inactive target断线不影响local；远端browse不回落本机。

```ts
expect(repositoryCacheKey('s1', 'local1', '/repo'))
  .not.toEqual(repositoryCacheKey('s1', 'ssh1', '/repo'));
```

`repositoryCacheKey(sessionNamespace,targetId,path)`新增于repository-tabs.ts，返回数组或序列化stable key，页面必须实际使用。

- [ ] 新target绑定配置revision/generation，open时probe canonical common dir/worktree。旧pathId、snapshot、cursor不可用于新generation。
- [ ] Local路径保留Browse；SSH提供路径输入、连接进度、host label、明确error。M0 remote browse=false则禁用解释，不删本地picker。
- [ ] 将target capability加入query enabled；new UI连接旧Node服务仍可使用本地功能；native切HTTP可连接已有server。
- [ ] release重新构建，从App实际打开fixture SSH repo；验证server上没有Refyard进程。Commit `feat(workbench): open local and ssh repositories through one ui`。

## D10 — 文件预览、持久化写队列与结果未知恢复

**Files:** Create `crates/refyard-host/src/files/{mod,local,remote,preview}.rs`, `src/jobs/{mod,queue,journal,recovery}.rs`; Create `crates/refyard-core/src/preconditions.rs`; Tests `crates/refyard-host/tests/{previews,journal,uncertain}.rs`。

**Consumes:** 当前Node preview/preconditions/journal语义、FileRead、MutationService。
**Produces:** shared previews、snapshot/index freshness、journal idempotency、acknowledgeUncertainOperation。

- [ ] RED：内容改了但status仍为M→StalePreview；跨repo token拒绝；已派发写断线→unknown；重启后block；重复request不执行两次。

```ts
it('does not mistake the same status letter for unchanged content', async () => {
  const preview = await native.git.previews(selected);
  await fixture.write('a.txt', 'changed after preview');
  const result = await native.mutations.submit(stageRequest(preview));
  await expectTerminalProblem(result, 'StalePreview');
});
```

此测试追加到`tests/native/mutations.test.ts`；`native`由fixture driver或D12 HTTP native harness提供，D10先用driver；`stageRequest`用当前contract工厂组装，不省略snapshot/previewTokens。

- [ ] local与remote file reads都仅服务选中的已授权pathId。remote固定shell检查普通文件/父目录/symlink，byte limit遵守8MiB。SHA-256在本地Rust计算，不要求远端sha256sum/python。
- [ ] 缺失文件、换行/非UTF8路径、目录/symlink/submodule、超限均有typed结果。不能用本地fs对远端路径做检查。
- [ ] journal atomic metadata不含payload敏感内容；start/finish顺序、same-key digest conflict、crash recovery与explicit ack真实落盘测试。
- [ ] `cargo test -p refyard-host --test previews --test journal --test uncertain`；Commit `feat(native): enforce preview freshness and durable mutation state`。

## D11 — local/SSH stage、unstage、commit与事件

**Files:** Create `crates/refyard-core/src/plan/{paths,commit}.rs`, `crates/refyard-host/src/writes/{mod,stage,commit}.rs`; Modify service/commands/event ring；Tests `tests/native/mutations.test.ts`, `crates/refyard-host/tests/ssh_mutations.rs`, `tests/e2e/native-mutations.spec.ts`。

**Consumes:** D10、现有UI controller和当前TS对应planners。
**Produces:** 交付物C；两个execution providers共享的最小写操作。

- [ ] RED：单文件stage/unstage不动其他文件；unborn unstage保留工作文件；commit只提交index；hook失败保留错误；断线不重试。
- [ ] 移植当前`planStage/planUnstage/planUnstageUnborn`的literal-pathspec/NUL stdin策略；commit用stdin。批量前检查所有pathId和preview，失败则不启动Git。
- [ ] writes按target+commonDir排队，postcondition读回HEAD/index；Git nonzero不能一概宣称没有副作用。unknown通过operation记录显示并提供ack入口。
- [ ] Event只发送operation change/invalidation。UI关闭event流也能通过get/read正确恢复。事件不作为唯一成功证据。
- [ ] 真实App在临时SSH repo完成「看diff→stage→看staged diff→unstage→stage→commit→history看新commit」，服务器直接git log验证。对照local同流程。
- [ ] 运行Cargo/Vitest/e2e，release重建；Commit `feat(native): support safe local and ssh staging and commits`。

## D12 — 原生CLI/HTTP入口证明不与Tauri绑定

**Files:** Create `crates/refyard-http/{Cargo.toml,src/{lib,router,auth,events,assets}.rs}`, `crates/refyard-cli/{Cargo.toml,src/{main,args,doctor,serve}.rs}`; Tests `tests/native/{http-contract,http-security}.test.ts`; Modify root scripts。

**Consumes:** 同一个ApplicationService、现有HTTP contract/auth rules。
**Produces:** `refyard-native`单binary，doctor/open/serve；新UI可选HttpAdapter连接native服务。

- [ ] RED：unauthenticated读取拒绝、错误Origin/Host拒绝、ticket一次性、API错路径不返回SPA、remote target未授权拒绝。
- [ ] native CLI没有Tauri依赖；HTTP feature在desktop默认关闭。复刻current routes，不把UI通过URL绕回本地HTTP作为native adapter。
- [ ] native `open`提供同源static UI，`serve`API-only；通过JSON readiness暴露临时endpoint/ticket策略，不把token写普通log。桌面默认不bind socket。
- [ ] Host SSH discovery API默认关闭，CLI需要explicit enable；peer/remote website access不能枚举所有用户SSH hosts。
- [ ] `cargo build -p refyard-cli --release && pnpm exec vitest run tests/native/http-contract.test.ts tests/native/http-security.test.ts`；同一fixture经HttpAdapter和Tauri boundary比较DTO。Commit `feat(cli): expose the native service without a desktop runtime`。

## D13 — 打包、无Node证明、资源预算与退出

**Files:** Create `scripts/{verify-native-artifacts,measure-native-runtime}.ts`; Modify `scripts/build-desktop.ts`, desktop packaging config; Create `docs/evidence/2026-09-18-native-desktop-ssh.md` and `.json`。

**Consumes:** releaseApp、native CLI、acceptance matrix。
**Produces:** 可打开App与CLI绝对路径、hash、大小、进程树、真实SSH证据。

- [ ] 打包测试扫描依赖/资源：不含node/bun/deno binary、JS backend bundle/VM、Electron；Svelte frontend JS正常存在，不误报。
- [ ] 用minimal PATH（含git/ssh/系统工具，不含JS runtimes）启动实际release可执行文件；使用fixture避免用户hooks意外依赖Node。查看进程树，确认无Refyard JS runtime子进程。
- [ ] 断网打开local repo仍工作；缺Git提示诊断而非白屏；缺本地Git仍允许SSH目标；缺ssh仅禁用SSH。
- [ ] 测量安装App总字节、compressed artifact、nativeCLI字节、startup ready/first status/history latency、idle内存、同fixture diff后内存。注明WebView共享进程与RSS重复计数限制，不虚构PSS或精确总量。
- [ ] 测试关闭时取消读、queued mutation处理、running mutation确认/unknown记录、ownedSSH进程清理；不关闭用户终端连接。
- [ ] `pnpm desktop:build && pnpm native:verify && pnpm native:bench`；artifact预算见acceptance，不通过时提交报告而非隐藏数字。Commit `test(native): verify runtime independence and release artifacts`。

## D14 — 总体验收、状态交接与继续parity的闸门

**Files:** Update evidence、README、docs/installation.md；Create `docs/handoffs/native-desktop-ssh-implementation-status.md`。

**Consumes:** acceptance每项结果。
**Produces:** 可接手的产品状态，不以“开发完成”概括未测区域。

- [ ] 对A/B/C/D分别标PASS/PARTIAL/BLOCKED；逐项命令、退出状态、实际artifact路径、未测平台、baseline regression列清楚。
- [ ] 跑完整既有check/test/build与native suite，Cloudflare build不部署。禁止push/publish/deploy。
- [ ] 没有真实SSH或实际native窗口证据时不写“SSH desktop完成”。提供已做内容和剩余可执行步骤。
- [ ] 仅当releaseApp可用且核心SSH不回归后进入P01；每个P任务也保持App产物可运行。
- [ ] Commit `docs(native): record desktop ssh acceptance and remaining parity`。

---

## 后续全量替代任务（A–D之后，不抢关键路径）

### P01 — 完整只读功能和远端目录浏览

**Files:** Rust `reads/{history,worktrees,stashes,submodules}.rs`、remote filesystem provider，`tests/native/read-parity.test.ts`。

- [ ] RED：把现有Node全部reads/history filters fixture列成case index；remote browse没有工具能力时明确unsupported。
- [ ] 补齐筛选、拓扑、bounds、cursor mismatch、stashes/worktrees/submodules。Remote browse使用独立SFTP或严格framed固定POSIX操作，不能parse `ls -l`。
- [ ] 与Node以同一schema及repo状态比较，不忽略差异；通过后更新capabilities。
- [ ] Commit `feat(native): complete read parity and remote path browsing`。

### P02 — 普通仓库/分支/远端网络操作

**Files:** Rust `writes/{repository,branches,network,tags}.rs`；`tests/native/write-parity.test.ts`。

- [ ] RED：init/clone、branches/upstream/remotes/tags、fetch/pull/push使用隔离bare remote；禁止真实push。
- [ ] 移植现有URL验证、feature probes、fast-forward和hooks/signing语义；不改全局config。
- [ ] 远端Git的上游credential是server环境，不默认forward笔记本agent。真实网络auth另做用户授权验收。
- [ ] Commit `feat(native): migrate standard repository and network operations`。

### P03 — 破坏性操作、stash、worktree和merge恢复

**Files:** Rust `writes/{discard,stash,worktrees,merge}.rs`, files recovery store；`tests/native/destructive-parity.test.ts`。

- [ ] RED：backup失败不写、preview过期拒绝、绝不clean/untracked discard、未知结果不推进下一步。
- [ ] 先完成backend作用域内可验证backup/read-back/retention，再开放对应capability。SSH安全保证不够的操作继续不可用。
- [ ] 每个操作验证最终refs/index/worktree/备份，而不仅比较响应。
- [ ] Commit `feat(native): complete guarded destructive workflows and recovery`。

### P04 — npm原生分发与Node退役

**Files:** `packages/npm-dist`迁移、platform packages、launcher、pack-smoke、release scripts。

- [ ] RED：实际平台binary选择、unsupported platform、被篡改/缺失artifact、signal/exit传播测试。
- [ ] 薄JSlauncher启动Rust executable，optional per-platform artifacts；不下载未校验“latest”，不增加install-time编译。用户直接CLI/App不需Node；npx入口需要其既有环境。
- [ ] 更新Kunkun/Xross旧服务启动器使用新CLI，真实集成单测/端到端分别记录。
- [ ] Rust所有承诺功能与安全parity通过后正式入口停用Node后端。保留test oracle或由等价golden替代，不维护永久双业务引擎。
- [ ] Commit `feat(distribution): publish-ready native cli packaging and retire node runtime path`。这里只准备，不发布。

### P05 — Xross/Kunkun授权集成与可选N-API

**Files:** 独立integration plan，不在此次关键路径创建stub。

- [ ] 先实读最新SDK与授权接口。Xross优先结构化exec，不读Terminal画面、不导出Vault key。
- [ ] 基于当前BackendSession或RepositoryAccess接入；client identity、scope、revocation、target policy必须真实验证。
- [ ] N-API只在真实JS in-process consumer需要时新增binding；Rust core唯一，不成为桌面runtime依赖。
- [ ] 分别提交集成spec与验收，不在本任务提前宣称支持。

## 自检清单（实施agent每轮提交前）

- [ ] 这次修改是否把HTTP/Tauri判断漏进组件？
- [ ] 是否偷塞JS runtime、generic shell API或localhost桥？
- [ ] Node现有功能是否被删掉以掩盖未移植能力？
- [ ] SSH是否只依赖已说明的远端环境，并对特殊路径/断线/host key做了真实验证？
- [ ] 是否在capabilities里准确表达已实现且安全的功能？
- [ ] 测试是否真的运行、是否使用临时repo、是否保留失败证据？
- [ ] 本轮是否已经给出可运行App而不是只增加后台抽象？
