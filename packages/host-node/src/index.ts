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
export { resolveGitPath } from "./process/git-path.js";
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
export { expandUserPath } from "./filesystem/user-path.js";
export {
  controlDirectory,
  listServiceInstances,
  requestPairingUrl,
  startPairingControl,
  type PairingControlOptions,
  type PairingControlServer,
  type RequestPairingOptions,
  type ServiceInstanceRecord,
} from "./control/pairing-socket.js";
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
  defaultStateRoot,
  type RegisterRootOptions,
  type RootRecord,
  type RootRegistry,
  type RootRegistryOptions,
} from "./registry/roots.js";
export {
  createRepositoryApprovalManager,
  type RepositoryApproval,
  type RepositoryApprovalManager,
  type RepositoryApprovalManagerOptions,
  type RepositoryApprovalResult,
  type RepositoryRevocationResult,
} from "./registry/managed.js";
export {
  createDirectoryPins,
  DEFAULT_PIN_BUDGET,
  type DirectoryPin,
  type DirectoryPins,
  type DirectoryState,
} from "./registry/identity.js";
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
export { inlineScriptHashes, policyWithInlineScripts } from "./http/csp.js";
export {
  DEFAULT_HTTP_LIMITS,
  logLine,
  parseQuery,
  readJsonRequest,
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
export {
  createHonoHttpApp,
  type HonoHttpApp,
  type HonoHttpAppOptions,
} from "./http/hono-app.js";
export {
  createJournalStore,
  canonicalJson,
  canonicalPayloadDigest,
  entryFromRecord,
  journalExists,
  journalPathFor,
  type AppendOutcome,
  type JournalEntry,
  type JournalStore,
  type JournalStoreOptions,
} from "./journal/store.js";
export {
  DEFAULT_RETENTION,
  decideRetention,
  exceedsEntryBound,
  isTerminalStatus,
  mayPruneRecord,
  type RetentionDecision,
  type RetentionPolicy,
} from "./journal/retention.js";
export {
  createRecovery,
  type Recovery,
  type RecoveryOptions,
  type RecoveryReport,
  type WriteBlock,
} from "./journal/recovery.js";
export {
  createAccessJournal,
  type AccessAction,
  type AccessJournal,
  type AccessJournalEntry,
  type AccessJournalOptions,
} from "./journal/access.js";
export {
  createQueue,
  DEFAULT_QUEUE_LIMITS,
  type EnqueueResult,
  type Queue,
  type QueueLimits,
  type QueueMode,
  type QueueOptions,
  type QueueTicket,
} from "./coordinator/queue.js";
export {
  checkPreconditions,
  indexFingerprint,
  type PreconditionContext,
  type PreconditionOutcome,
} from "./coordinator/preconditions.js";
export {
  createEffect,
  createJobEngine,
  type EffectOutcome,
  type JobEngine,
  type JobEngineOptions,
  type JobEvent,
  type MutationEffect,
  type SubmitResult,
} from "./coordinator/jobs.js";
export {
  createStagingEffects,
  STAGING_MUTATION_KINDS,
  type RecoveryBackupWriter,
  type StagingEffectsOptions,
} from "./coordinator/previews.js";
export {
  createRepositoryEffects,
  REPOSITORY_MUTATION_KINDS,
  type RepositoryEffectsOptions,
} from "./coordinator/repository-effects.js";
export {
  createStashTagEffects,
  STASH_TAG_MUTATION_KINDS,
  type StashTagEffectsOptions,
} from "./coordinator/stash-tag-effects.js";
export {
  createWorktreeEffects,
  WORKTREE_MUTATION_KINDS,
  type WorktreeEffectsOptions,
} from "./coordinator/worktree-effects.js";
export {
  createMergeEffects,
  MERGE_MUTATION_KINDS,
  type MergeEffectsOptions,
} from "./coordinator/merge-effects.js";
export {
  createCherryPickEffects,
  CHERRY_PICK_MUTATION_KINDS,
  type CherryPickEffectsOptions,
} from "./coordinator/cherry-pick-effects.js";
export {
  createRebaseEffects,
  REBASE_MUTATION_KINDS,
  type RebaseEffectsOptions,
} from "./coordinator/rebase-effects.js";
export {
  kindsBlockedByGitFeatures,
  unavailableForGitFeatures,
  unavailableMutations,
} from "./coordinator/capabilities.js";
export {
  createMutationCoordinator,
  currentIndexKey,
  repositoryIdOfTarget,
  type MutationCoordinator,
  type MutationCoordinatorOptions,
} from "./coordinator/submit.js";
export { DEFAULT_SERVICE_PORT, PortInUseError } from "./http/server.js";
export {
  createEventRing,
  createSseSession,
  sseFrame,
  type EventRing,
  type EventRingOptions,
  type SseSession,
} from "./http/events.js";
export {
  createProviderManager,
  createProviderStore,
  type ConnectOutcome,
  type ProviderManager,
  type ProviderStore,
  type StoredProviderConnection,
} from "./provider/manager.js";
export {
  createProviderService,
  type ConnectResult,
  type ProviderService,
} from "./provider/service.js";
export {
  assembleService,
  type AssembleOptions,
  type ServiceAssembly,
} from "./service/assembly.js";
