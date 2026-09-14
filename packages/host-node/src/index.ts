/**
 * `@refyard/host-node` — everything that touches the machine.
 *
 * The package exists to keep one boundary honest: the portable packages
 * (`git-core`, `git-graph`, `git-contract`) describe *what* Git should be asked
 * and *what its answers mean*, and this package is where those intentions meet a
 * real process, a real filesystem and a real clock. Nothing here is importable
 * from the browser bundle, and nothing here is exposed over HTTP.
 *
 * The exports are grouped by the capability they provide rather than by file
 * layout, because a caller should be able to tell from the import whether it is
 * doing something privileged:
 *
 * - process: `createGitHost`, `runDoctor` — the only ways Git is executed;
 * - filesystem: handles, codec, metadata, recovery, previews — authorised paths;
 * - everything else (the coordinator, HTTP server, journal) arrives in later tasks
 *   on top of these primitives.
 */
export {
  createGitHost,
  type GitHost,
  type GitHostOptions,
} from "./process/git-host.js";
export {
  runGit,
  isCleanExit,
  describeTermination,
  defaultLimits,
  DEFAULT_DEADLINES_MS,
  type RunnerLimits,
  type RunGitOptions,
  type RunGitOutcome,
} from "./process/runner.js";
export {
  buildGitEnvironment,
  blockedVariableNames,
  BLOCKED_ENV_VARS,
  HOST_SET_ENV_VARS,
  INHERITED_ENV_VARS,
  type BuildGitEnvironmentOptions,
} from "./process/environment.js";
export {
  signalProcessGroup,
  cleanupIsCertain,
  type CleanupReport,
  type SignalOptions,
} from "./process/cleanup.js";
export {
  runDoctor,
  versionAtLeast,
  MINIMUM_GIT_VERSION,
  type DoctorOptions,
  type DoctorProbe,
  type DoctorReport,
} from "./process/doctor.js";
export {
  createHandleRegistry,
  isInsideOrEqual,
  isSafeRelativePath,
  HandleError,
  type ApprovedRoot,
  type HandleRegistry,
  type ResolvedHandle,
} from "./filesystem/handles.js";
export { createTextCodec, encodeExecutionPath } from "./filesystem/codec.js";
export {
  createRecoveryStore,
  DEFAULT_RECOVERY_BUDGET,
  directorySize,
  fingerprintFile,
  isDiscardableKind,
  parentName,
  PathRefusedError,
  readPathMetadata,
  sniffContentKind,
  type BackupOutcome,
  type BackupRecord,
  type ContentFingerprint,
  type PathKind,
  type PathMetadata,
  type RecoveryBudget,
  type RecoveryStore,
  type RecoveryStoreOptions,
} from "./filesystem/metadata.js";
export {
  createPreviewStore,
  expiresAtIso,
  fingerprintBytes,
  type IssuedPreview,
  type PreviewCheck,
  type PreviewClaim,
  type PreviewRequest,
  type PreviewStore,
  type PreviewStoreOptions,
} from "./filesystem/preview.js";
export {
  createRootRegistry,
  type RegisterRootOptions,
  type RootRecord,
  type RootRegistry,
  type RootRegistryOptions,
} from "./registry/roots.js";
export {
  createRepositoryRegistry,
  type RegisterRepositoryInput,
  type RepositoryRecord,
  type RepositoryRegistry,
  type RepositoryRegistryOptions,
} from "./registry/repositories.js";
export {
  createWorktreeRegistry,
  type HostWorktree,
  type WorktreeRegistry,
  type WorktreeRegistryOptions,
} from "./registry/worktrees.js";
export {
  createPathRegistry,
  type PathBinding,
  type PathRegistry,
  type PathRegistryOptions,
} from "./registry/paths.js";
export {
  createSnapshotStore,
  type CursorPayload,
  type CursorResult,
  type SnapshotKind,
  type SnapshotRecord,
  type SnapshotStore,
  type SnapshotStoreOptions,
} from "./coordinator/snapshots.js";
export {
  createReadService,
  ReadProblem,
  type DiffQuery,
  type HistoryQuery,
  type ReadService,
  type ReadServiceOptions,
  type StatusQuery,
} from "./coordinator/reads.js";
export {
  createGitDirLookup,
  fileExistsIn,
  isoFromMs,
  isoFromSeconds,
  readOperationMarkers,
  redactRemoteUrl,
  synthesizeUntrackedPatch,
  type GitDirLookup,
  type SynthesizedPatch,
} from "./coordinator/read-support.js";
export {
  startHttpHost,
  type HttpHost,
  type HttpHostOptions,
} from "./http/server.js";
export {
  createAuthStore,
  type AuthStore,
  type AuthorizeResult,
  type BootstrapTicket,
  type ExchangeResult,
  type Session,
  type SessionGrants,
} from "./http/auth.js";
export {
  createOriginPolicy,
  loopbackAuthorities,
  originsFor,
  type OriginPolicy,
  type OriginPolicyOptions,
  type OriginVerdict,
} from "./http/origins.js";
export {
  createAssetServer,
  HTML_HEADERS,
  type AssetServer,
  type AssetServerOptions,
} from "./http/assets.js";
export {
  DEFAULT_HTTP_LIMITS,
  logLine,
  parseQuery,
  readJsonBody,
  redactUrl,
  validate,
  type HttpLimits,
} from "./http/json.js";
export {
  STATUS_BY_CODE,
  problemBody,
  problemFor,
  statusForProblem,
} from "./http/errors.js";
export { readRoutes, type RouteDefinition } from "./http/router.js";
