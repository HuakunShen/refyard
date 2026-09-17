# Refyard BackendAdapter：统一前端服务与双层适配契约

日期：2026-09-18。状态：规范设计；配套主设计 `2026-09-18-native-desktop-ssh-design.md`。

用户明确要求：**同一套前端，替换 adapter 即可连接 HTTP 或 Tauri IPC；不要求所有后端经过 HTTP。**

## 1. 不可违反的依赖方向

```text
Svelte components / workbench controllers
                    |
             BackendSession
        git / mutations / host / events
                    |
        +-----------+-----------+
        |                       |
 HttpBackendAdapter      TauriBackendAdapter
 HTTP + authenticated    invoke + scoped events
 fetch-SSE               [Channel only when needed]
        |                       |
 Node legacy or Rust     Rust application service
 HTTP application                |
        +-------------+----------+
                      |
                Git workflows
                      |
             ExecutionProvider
               Local / SSH
               [future XrossExec]
```

不得在组件中判断 `isTauri()`。不得在 workbench controller 内创建 HTTP client、读取 bearer、调用 `invoke` 或 `EventSource`。Adapter selection 仅在 `apps/web/src/lib/runtime/bootstrap.ts`。

未来 Xross 可能出现在两个不同位置：提供完整 GitService 时是 UI adapter；只提供远端 exec 时是 Rust execution provider。**二者不同，不要现在创建一个混合的 XrossBackend。**

## 2. 新 TS 包

- `packages/git-service/src/service.ts`：GitReadService / MutationService。
- `packages/git-service/src/backend.ts`：BackendAdapter / BackendSession。
- `packages/git-service/src/host.ts`：目标选择、SSH配置候选与能力。
- `packages/git-service/src/events.ts`：EventService / subscription。
- `packages/git-service/src/errors.ts`：BackendError / normalizeProblem。
- `packages/git-service/src/index.ts`：exports。
- `packages/backend-http/src/{adapter,session,events,legacy-capabilities}.ts`。
- `packages/backend-tauri/src/{adapter,commands,events}.ts`。

`git-service` 只依赖 `git-contract` 的类型与验证。`git-client` 可以依赖并 re-export `git-service`；反向依赖禁止，防止循环。

## 3. 服务方法：提取，不另造一套业务 API

从当前 GitClient 提取以下方法，完整保留原 DTO。`exchangeTicket` 不属于 GitReadService，移入 HttpBackendAdapter 的连接实现。

```ts
import type {
  CapabilitiesResponse, DiffResponse, EventEnvelope,
  FilesystemEntriesResponse, HealthResponse, HistoryPage, HistoryQuery,
  OperationAccepted, OperationRecord, ParsedMutationRequest, Problem,
  PreviewsResponse, RefsSnapshot, RepositoriesResponse,
  StashesResponse, StatusSnapshot, SubmodulesResponse, WorktreesResponse,
} from '@refyard/git-contract';

export interface TargetSelector {
  readonly targetId?: string;
  readonly repositoryId?: string;
}
export interface GitReadService {
  health(): Promise<HealthResponse>;
  capabilities(query?: TargetSelector): Promise<CapabilitiesResponse>;
  repositories(): Promise<RepositoriesResponse>;
  filesystemEntries(query?: {
    readonly path?: string;
    readonly targetId?: string;
  }): Promise<FilesystemEntriesResponse>;
  registerRepository(
    path: string,
    options?: { readonly targetId: string },
  ): Promise<RepositoriesResponse>;
  revokeRepository(repositoryId: string): Promise<RepositoriesResponse>;
  status(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
    readonly includeIgnored?: boolean;
  }): Promise<StatusSnapshot>;
  history(query: HistoryQuery): Promise<HistoryPage>;
  refs(query: { readonly repositoryId: string }): Promise<RefsSnapshot>;
  diff(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
    readonly kind: 'unstaged' | 'staged' | 'untracked' | 'commit' | 'range';
    readonly oid?: string;
    readonly from?: string;
    readonly to?: string;
    readonly pathId?: string;
    readonly maxBytes?: number;
  }): Promise<DiffResponse>;
  worktrees(query: { readonly repositoryId: string }): Promise<WorktreesResponse>;
  submodules(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
  }): Promise<SubmodulesResponse>;
  stashes(query: { readonly repositoryId: string }): Promise<StashesResponse>;
  previews(query: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly pathIds: readonly string[];
  }): Promise<PreviewsResponse>;
}

export type SubmitResult =
  | { readonly kind: 'accepted'; readonly accepted: OperationAccepted }
  | { readonly kind: 'duplicate'; readonly record: OperationRecord };
export interface MutationService {
  submit(request: ParsedMutationRequest): Promise<SubmitResult>;
  get(operationId: string): Promise<OperationRecord>;
  list(limit?: number): Promise<{ readonly operations: readonly OperationRecord[] }>;
  cancel(operationId: string): Promise<OperationRecord>;
}
```

检查执行时 GitClient 最新签名；若在本基线之后新增方法，应把它加入同一个接口和适配测试，不删掉功能。`readonly`数组与Zod生成的mutable数组需要边界复制，不准 `as unknown as`。

在 `packages/git-contract/src/host.ts` 定义可校验的新 HostService DTO，并加入 `registry.ts`；不要仅定义 TypeScript interface 却让 Rust 返回任意对象。

## 4. HostService：能力发现、SSH Host与目标

```ts
export interface HostCapabilities {
  readonly sshConfig: boolean;
  readonly localFolderPicker: boolean;
  readonly uncertainOperationAcknowledgement: boolean;
  readonly targetKinds: readonly ('local' | 'ssh-config')[];
}
export interface HostWarning {
  readonly code: string;
  readonly message: string;
}
export interface SshHostCandidate {
  readonly hostId: string;       // 由host登记；不是连接凭据
  readonly sourceId: string;
  readonly alias: string;
  readonly displayLabel: string;
  readonly discoveryIncomplete: boolean;
}
export interface SshHostList {
  readonly hosts: readonly SshHostCandidate[];
  readonly warnings: readonly HostWarning[];
  readonly revision: string;
}
export interface ExecutionTargetSummary {
  readonly targetId: string;
  readonly kind: 'local' | 'ssh-config';
  readonly label: string;
  readonly state: 'idle' | 'connecting' | 'ready' | 'unavailable';
  readonly remotePathBrowse: boolean;
  readonly generation: string;
}
export type CreateTargetRequest =
  | { readonly kind: 'local' }
  | { readonly kind: 'ssh-config'; readonly hostId: string }
  | {
      readonly kind: 'ssh-config';
      readonly sourceId: string;
      readonly manualAlias: string;
    };
export interface HostService {
  capabilities(): Promise<HostCapabilities>;
  sshHosts(): Promise<SshHostList>;
  targets(): Promise<readonly ExecutionTargetSummary[]>;
  createTarget(request: CreateTargetRequest): Promise<ExecutionTargetSummary>;
  disconnectTarget(targetId: string): Promise<void>;
  pickLocalDirectory(): Promise<string | null>;
  acknowledgeUncertainOperation(request: {
    readonly operationId: string;
    readonly confirmedSnapshotId: string;
    readonly confirmed: true;
  }): Promise<OperationRecord>;
}
```

接口刻意不含 password、privateKey、arbitrary executable、raw argv、remote shell text。选择自定义 SSH config 文件属于可信宿主设置，不通过远端网页传任意本机文件路径；设置改变后生成新的 sourceId/revision。

`pickLocalDirectory` 在普通浏览器/remote HTTP中返回 UnsupportedOperation，UI使用已有 `filesystemEntries` path picker。只有本机 native adapter有真正OS folder dialog。远端 target不能调用本机 folder dialog冒充远端浏览。

`registerRepository` 请求可以增加可选 targetId；RepositorySummary可增加可选 targetId（legacy absence映射为此session的local目标）。保持其他DTO不变。新Rust host只支持新UI，旧Node host仍可被新UI使用。

## 5. BackendSession与连接状态

```ts
export type ConnectionPhase =
  'connecting' | 'ready' | 'reconnecting' | 'disconnected' | 'failed';
export interface ConnectionState {
  readonly phase: ConnectionPhase;
  readonly problem: Problem | null;
}
export interface SessionMetadata {
  readonly sessionId: string;
  readonly serviceInstanceId: string;
  readonly cacheNamespace: string; // 随session/授权轮次变化；不是secret
  readonly backendLabel: string;
}
export interface BackendSession {
  readonly metadata: SessionMetadata;
  readonly git: GitReadService;
  readonly mutations: MutationService;
  readonly host: HostService;
  readonly events: EventService;
  state(): ConnectionState;
  onState(listener: (state: ConnectionState) => void): () => void;
  dispose(): Promise<void>;
}
export interface BackendConnectOptions {
  readonly ticket?: string;
  readonly password?: string;
}
export interface BackendAdapter {
  readonly kind: 'http' | 'tauri' | 'kunkun' | 'xross';
  connect(options: BackendConnectOptions): Promise<BackendSession>;
}
```

只有 HTTP 和 Tauri adapter被本轮 registry实际注册。future enum不等于已支持。Http factory注入 `baseUrl/fetch`；Tauri factory注入invoke/listen端口以便测试。仅HTTP connect接受ticket/password；Tauri拒绝提供这些HTTP-only字段。

规则：

- ready表示服务会话就绪，不代表每个execution target都在线。
- HTTP bearer仅保存在adapter闭包，保持当前认证要求；不放进公共session、组件、URL或query key。
- Tauri绑定真实native session和发起WebView，**不生成假的bearer让旧UI继续工作**。
- dispose幂等：停止events、取消未派发读请求、解除此session资源、关闭它拥有的target引用；不杀其他session使用中的SSH master。
- 切backend或切连接generation时使旧请求结果失效，不把迟到结果写入新repo的UI。
- 两个标签页可以共享一个BackendSession，但每个repo始终绑定自己target；断开某host不应清空其他host的结果。
- 查询enabled是连接ready + feature可用 + 选择有效，不再是token存在。

## 6. 统一错误，不把HTTP status当业务码

```ts
export class BackendError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.message);
    this.name = 'BackendError';
  }
}
```

HttpAdapter将现有GitClientError转换为BackendError并保留ProblemCode、retryable和redacted details；HTTP status只留adapter诊断。Tauri command错误为标准 `{ problem: Problem }`，adapter验证后构造同一Error。

`invoke<T>()` 的泛型不是运行时验证。每个成功响应必须经过对应Zod schema。错误对象不符合schema时返回InternalError与correlation，不依据英文消息猜Forbidden/NeedsAttention。

AbortSignal/transport timeout与服务端operation cancellation是不同事情。读请求被中止可以丢弃结果；写请求等待被中止后仍需查询已有operationId，不能以取消fetch表示Git回滚。

## 7. Tauri命令表

采用少量**闭合语义dispatcher**，不是通用字符串RPC执行器。Rust每个request枚举使用serde tagged enum，并对payload进行结构和语义验证。

| Command | 请求/响应 | 责任 |
|---|---|---|
| `refyard_connect` | `{}` → SessionMetadata | 绑定calling WebView，不返回HTTP token |
| `refyard_disconnect` | `{sessionId}` → void | session资源释放 |
| `refyard_git_read` | `{sessionId, request: GitReadRequest}` → 对应DTO | 闭合枚举分派 |
| `refyard_mutation_submit` | `{sessionId, request: ParsedMutationRequest}` → SubmitResult | shared coordinator，绝不直接spawn |
| `refyard_operation_get` | `{sessionId, operationId}` → OperationRecord | 当前actor可见操作 |
| `refyard_operation_list` | `{sessionId, limit?}` → operations | 当前actor范围 |
| `refyard_operation_cancel` | `{sessionId, operationId}` → OperationRecord | queued/running语义分离 |
| `refyard_host_request` | `{sessionId, request: HostRequest}` → 对应Host DTO | discovery/target/select/ack |
| `refyard_events_subscribe` | `{sessionId, subscriptionId, afterSequence}` → SubscriptionAck | 校验owner，订阅和replay |
| `refyard_events_unsubscribe` | `{sessionId, subscriptionId}` → void | 清理此owner订阅 |

GitReadRequest明确成员为第3节方法（`health`、`capabilities`、`repositories`、`filesystemEntries`、`registerRepository`、`revokeRepository`、`status`、`history`、`refs`、`diff`、`worktrees`、`submodules`、`stashes`、`previews`），并使用各自请求schema。HostRequest明确成员为第4节方法。未知method一律拒绝，不使用反射寻找Rust函数。

调用示例（设计代码，不是当前已存在实现）：

```ts
async function status(query: Parameters<GitReadService['status']>[0]) {
  const response: unknown = await ports.invoke('refyard_git_read', {
    sessionId,
    request: { method: 'status', query },
  });
  return statusSnapshotSchema.parse(response);
}
```

这组command名字、payload和Rust函数必须由同一测试表覆盖，防止camelCase/snake_case漂移。纯application methods不带 `#[tauri::command]`。

## 8. EventService：events不是请求返回值替代品

```ts
export interface EventObserver {
  onEvent(event: EventEnvelope): void;
  onGap(gap: { readonly fromSequence: number; readonly toSequence: number }): void;
  onState(state: 'connecting' | 'live' | 'reconnecting' | 'closed'): void;
  onError(problem: Problem): void;
}
export interface EventSubscription {
  dispose(): Promise<void>;
}
export interface EventService {
  subscribe(observer: EventObserver): Promise<EventSubscription>;
}
export interface SubscriptionAck {
  readonly subscriptionId: string;
  readonly serviceInstanceId: string;
  readonly highWatermark: number;
  readonly replay: readonly EventEnvelope[];
}
export interface ScopedEventFrame {
  readonly sessionId: string;
  readonly subscriptionId: string;
  readonly serviceInstanceId: string;
  readonly event: EventEnvelope;
}
```

Tauri event名固定为 `refyard://event`，**emit_to调用者WebView**，禁止App-wide广播repository内容。server检查subscription所有权；client仍检查session/subscription/serviceInstanceId。

### 8.1 订阅顺序

1. Adapter生成随机subscriptionId，先注册本窗口listener。
2. 调用subscribe command；host在一个锁定窗口里记录highWatermark并注册live delivery。
3. command返回highWatermark之前的replay；live event在adapter内暂存。
4. replay与live按sequence去重排序；highWatermark后连续交付。
5. 环形缓冲不足或超过adapter缓存（256 events）时发送gap，丢弃不可靠连续性假设并refresh。
6. 断线重连只恢复订阅/读取；不重发mutation。服务实例变化清空旧sequence。
7. dispose先使本地subscription inactive，再unsubscribe，最后unlisten；失败也必须unlisten。

首次没有历史的订阅可以从当前highWatermark开始；不得把首次订阅之前所有事件的缺席误报为数据丢失。

HTTP包装当前createEventStream；既有authenticated fetch-SSE、Last-Event-ID/replay、gap、Unauthenticated停止策略保留。不能改用带token query的EventSource。

Events只发送轻量状态和invalidation。大的diff走bounded command返回；未来有大体积连续流时，在Tauri adapter内部改用Channel，不改变EventService或组件API。Tauri官方对channels的顺序/传输定位有专门说明；不要使用全局events持续广播原始Git stdout。

## 9. HTTP扩展与旧服务兼容

现有业务routes保持不变。新增host能力以单独endpoint实现：

```text
GET  /api/v1/host/capabilities
GET  /api/v1/host/ssh-hosts
GET  /api/v1/host/targets
POST /api/v1/host/targets                 CreateTargetRequest
POST /api/v1/host/targets/disconnect      {targetId}
POST /api/v1/operations/acknowledge       explicit confirmed request
```

这些不是匿名discovery：读取SSH hosts也需要authorization。HTTP operator必须显式enable ssh targets；远端网页不得默认枚举backend的全部host配置。API鉴权主体与target grant每次检查。原Node版404仅说明扩展不存在；adapter降级为legacy HostService，不将所有404吞掉。

添加capability query时新HTTP host接受targetId/repositoryId；旧HTTP host只发送空query并把能力视为默认local。新UI不对旧服务发送native-only字段。

localFolderPicker永远不是HTTP API；HTTP host capabilities返回false。

## 10. UI实际改造点

| 文件 | 具体改动 |
|---|---|
| `apps/web/src/routes/+page.svelte` | 通过bootstrap连接adapter，注入session；去掉createGitClient和直接bearer生命周期 |
| `apps/web/src/lib/workbench/queries.svelte.ts` | 参数改为session/client getter、ready和cacheNamespace；按reads与target能力启用 |
| `apps/web/src/lib/workbench/mutations.svelte.ts` | 注入MutationService，不再内部createMutationClient |
| `apps/web/src/lib/workbench/session.ts` | HTTP pairing逻辑留在HTTP adapter；UI只观察ConnectionState |
| `apps/web/src/lib/operation-follow.ts` | 只依赖MutationService.get，不依赖fetch或URL |
| `apps/web/src/lib/workbench/repository-tabs.ts` | targetId/label/generation进入identity与显示 |
| `packages/git-ui/src/components/RepositoryLauncher.svelte` | Local默认，Host选择器、target相关path/browse、busy/error |
| `packages/git-ui/src/components/RepositoryTabs.svelte` | 显示Local/SSH alias，避免同名repo混淆 |
| `apps/web/src/lib/workbench/repository-launcher.ts` | Recent按target分组和搜索 |
| `apps/web/src/lib/storage-policy.ts` | 允许connection metadata，禁止credential持久化 |

HTTP连接配置页面仍存在。Tauri默认本地adapter，但可显式切为HTTP backend连接现有server；这次切换不改变UI代码。普通网页不能通过URL参数激活Tauri权限。

避免一次性迁移整个UI到新包。保留SvelteKit composition，先注入服务；未来嵌Kunkun再按真实需要抽出完整Workbench组合组件。

## 11. 必须通过的adapter一致性测试

相同的scenario运行HttpAdapter与TauriAdapter两次；Tauri unit用注入invoke/listen端口，native acceptance另测真实command边界。

- ready时没有HTTP token也能读取；HTTP未认证仍不能读取。
- status/history/diff/operations的正常DTO一致。
- malformed successful response均抛BackendError，不把JSON shape错误渲染成空数据。
- unsupported capability不触发后台read storm。
- mutation submit exactly once；丢响应不重复写。
- 两个session、两个target同path不混cache或event。
- subscribe握手时的event不丢失/不重复，gap触发refresh。
- dispose后无listener、无retry timer，不影响其他session。
- window B不能用window A的session/subscription。
- HTTP Origin/Host/认证错误不因为有native路径而变宽松。
- browser bundle中不存在node builtin、Rust server、tauri boot side effect。

## 12. 对Xross和Kunkun的预留到此为止

保留命名、依赖倒置和contract conformance测试。不要现在添加空的Xross连接按钮、空SDK目录或返回success的stub。

Xross接入时提供受授权的exec lease，不导出Vault私钥；Kunkun接入时提供KKRPC service proxy。它们都不应该迫使git-ui重新实现业务或HTTP轮询。
