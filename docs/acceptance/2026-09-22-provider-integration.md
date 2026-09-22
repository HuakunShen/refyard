# Provider integration (P1: GitHub, read-only) 验收矩阵

日期：2026-09-22。配套 spec：`../superpowers/specs/2026-09-22-provider-integration-design.md`；配套 plan：`../superpowers/plans/2026-09-22-provider-integration.md`。

状态约定沿用 native-desktop 验收文档：每一格报告 PASS / FAIL / BLOCKED / NOT RUN，BLOCKED 永不写成 PASS。**本 P1 的上游证据全部来自本地 stub（`tests/support/github-stub.ts`，一个本地 `node:http` 服务器冒充 api.github.com）；真实 api.github.com 的连通性未被本机产品路径演练过，统一记为 NOT RUN，属 owner 手动步骤。**

## 1. 门禁结果（2026-09-22 实测）

| 检查 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 全仓类型检查 | `pnpm check` | PASS（exit 0，13/13 项目，svelte-check 0 错误） | task 记录 |
| 便携边界 | `pnpm check:boundaries` | PASS（3 portable packages / 68 source files；171 test/script files） | task 记录 |
| 契约产物 | `pnpm check:contract` | PASS（558 named schemas，artifacts match） | task 记录 |
| 单元/契约/节点 | `pnpm vitest run tests/unit tests/node tests/contract` | PASS（55 files / 550 tests） | task 记录 |
| 集成 | `pnpm test:integration` | PASS（48 files / 526 tests） | task 记录 |
| Rust 工作区（未改动，回归确认） | `cargo test --workspace` | PASS（0 failed） | task 记录 |
| Web 构建 | `pnpm build:web` | PASS（exit 0） | task 记录 |
| CLI 打包 | `bun scripts/bundle-cli.ts` | PASS（`.refyard-dev/cli.mjs` + `web`） | task 记录 |
| Playwright（Chromium） | `pnpm exec playwright test --project=chromium` | PASS（73/75：71 passed + provider 2；`offline.spec.ts:92` 为已知既有失败；`read-only.spec.ts:158` 全量负载下 flake，隔离重跑两次均 PASS） | task 记录 |
| Playwright（Firefox） | — | NOT RUN（本机 Firefox 无法启动，既有已知限制） | — |

## 2. P1 行为矩阵（stub 上游）

| ID | 案例 | 结果 | 证据 |
| --- | --- | --- | --- |
| PV-A | 合法 token 连接：host 校验（GET /user 200）后存储，status 报账号与 scopes | PASS | `tests/integration/provider.test.ts` "connects a valid token…"（integration 10/10） |
| PV-B | 被拒 token（401）：502 + `ProviderUnauthorized`，且不存储任何记录 | PASS | 同文件 "refuses a rejected token…" |
| PV-C | PR 列表：upstream 优先，随后同数据来自缓存并带 `cachedAt` | PASS | 同文件 "serves pull requests upstream first…" |
| PV-D | 未连接即读 PR：409 `ProviderNotConnected`，且零上游请求 | PASS | 同文件 "answers ProviderNotConnected…" |
| PV-E | 仓库无 GitHub remote：409 `NoProviderRemote` | PASS | 同文件 "answers NoProviderRemote…" |
| PV-F | origin 优先于第二个 GitHub remote | PASS | 同文件 "prefers origin…" |
| PV-G | 无 `provider:manage` scope 的会话：connect/status 均 403 | PASS | 同文件 "refuses the connect route…" |
| PV-H | 断开：状态回空、幂等 | PASS | 同文件 "disconnects…" + `tests/node/provider-connections.test.ts` idempotent case |
| PV-I | token 永不入响应（capabilities/connection/pull-requests 三读全扫），上游只见 Authorization header | PASS | 同文件 "never writes the token into any response…" |
| PV-J | `capabilities.providers = ["github"]` | PASS | 同文件 "reports the provider module…" + 手动 CLI curl 实测（见 §3） |
| PV-K | token 文件 0600 / 目录 0700、损坏文件拒绝加载、先校验后存储、journal 无 token 字节 | PASS | `tests/node/provider-connections.test.ts`（8/8） |
| PV-L | REST client 错误分类（unauthorized/forbidden/rateLimited/refused/malformed/network）+ 分页上限 + URL 无 token | PASS | `tests/unit/provider-github-rest.test.ts`（13/13，本地 `node:http` stub） |
| PV-M | remote→forge 解析矩阵（https/scp/ssh、恶意 host、非 GitHub 拒绝） | PASS | `tests/unit/provider-remotes.test.ts`（11/11）+ 既有 avatars 测试不回退 |
| PV-N | 浏览器：capability 门控出现 Pull Requests 视图、连接流程、PR 行（含 draft 标记）、token 不落 localStorage | PASS（Chromium） | `tests/e2e/provider.spec.ts` 2/2 |
| PV-O | 浏览器：被拒 token 后表单保持可用 | PASS（Chromium） | 同文件第二例 |
| PV-P | 浏览器宿主无 provider 模块时视图完全缺席 | PASS（单测门控） | `tests/unit/workbench-sidebar-navigation.test.ts` "appears only when the provider module is present" |
| PV-Q | 真实 api.github.com 全流程（owner 提供的 fine-grained PAT，仅授权一个仓库） | **PASS（2026-09-22 实测）** | `bun scripts/live-github-probe.ts`：GET /user → `HuakunShen (User)`；/user/repos 自动发现 `HuakunShen/refyard`；workflow runs 返回真实数据（ci #37 failure、release #7 success 等 5 条，含 name/status/conclusion/head_branch/event/created_at）；rate limit `5000/5000 remaining`。fine-grained token 按预期不报告 x-oauth-scopes。补充探针：`pulls?state=all` 与 `issues?state=all` 均 200（该仓库历史上无 PR/issue，条目级映射的活体证据由 workflow runs 与 stub 测试共同覆盖） |
| PV-Q2 | 语义注记：细粒度 token 对**公开仓库**的只读不受单仓库授权限制（对未授权公开仓库的 issues 读取返回 200） | PASS（观察记录） | 同一探针对 `octocat/Hello-World` 的请求返回 200。单仓库授权真正约束的是私有仓库与写操作——这是 GitHub 的 token 语义，不是本实现的边界；产品 UI 不依赖它做隔离 |
| PV-R | 桌面（Rust/Tauri）端 provider 缺席的 `capabilities` 如实报告 | PASS（间接） | Rust `capabilities` 无 providers 字段（optional），Rust 测试 0 failed；UI 门控在 `capabilities.providers` 缺省时隐藏面板（PV-P） |

## 3. 设计红线核查

- token 只存 host 私有状态（`<stateRoot>/provider/connections.json`，0600/0700）：PV-K。
- 连接/断开记入 access journal（`provider-connect` / `provider-disconnect`），journal 内容断言不含 token 字节：PV-K/H。
- CSP 未新增任何 origin：provider 调用全部 host 侧，浏览器无 forge 网络请求（架构决定，无对应测试——浏览器内不发 api.github.com 请求由"无该域 CSP 授权 + client 不在浏览器 bundle"共同保证）。
- 出站 URL 仅由固定 API base + `encodeURIComponent(owner/repo)` 构成：PV-L 的 URL 断言。
- provider 读不进后台轮询：`queries.svelte.ts` 中 providerPullRequests 仅有 30s staleTime，未注册进 `background-poll.ts`（代码审查证据，非测试）。

## 4. 已知边界与本轮不做

- GitLab / Gitea / Bitbucket：P4。
- OAuth device flow：P3（需 owner 注册 OAuth App）。
- issues、PR↔分支/commit 关联标记：P2。
- 写操作（评论/合并）：不在本轴，未来需独立 scope 与决策。
- Settings 内的 Connections 区块：P1 由面板内 connect/disconnect 承担，计划文档同步注明。
