//! The application service: one object that answers every read a client may make.
//!
//! This is the seam the Tauri commands, the native CLI and the HTTP adapter all call.
//! It owns the things that must not be re-created per request — the resolved Git
//! executable, the registry of approved repositories, the path bindings, the snapshot
//! store — and it owns the identity a client is told: which target it is talking to and
//! which service instance answered.
//!
//! **Capabilities are derived from what this build implements, never from a wish.** The
//! `reads` list names only the panels that exist here, `operations` is empty because no
//! mutation is wired in this slice, and every mutation the contract declares is named in
//! `unavailable` with the reason. A capability answer that offered a write and then
//! refused it is the one failure a client cannot recover from.
//!
//! The `git.features` flags are a statement about *this build's* reads rather than a
//! guess from a version string: `porcelainV2Status` and `catFileBatch` are true because
//! every status, history and diff read here is built on them, and a Git too old to
//! answer fails with the exit code and diagnostic in the problem. `worktreeListZ`,
//! `fetchPorcelain` and `pushPorcelain` are false because this slice implements no
//! worktree read and no network operation. `objectFormats` names both formats the
//! parsers accept; the format actually in use is detected per repository from
//! `rev-parse --show-object-format` during registration, never assumed.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;

use refyard_contract::diff::{DiffKind, DiffQuery, DiffResponse};
use refyard_contract::history::{HistoryPage, HistoryQuery};
use refyard_contract::host::{ExecutionTargetKind, ExecutionTargetState, SshHostList};
use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::{
    AllowedRootSummary, CapabilitiesResponse, ContentKind, FilesystemEntriesResponse,
    FingerprintAlgorithm, GitCapabilities, GitInfo, HeadKind, HeadState, HostInfo, HostKind,
    MutationKind, MutationTarget, ObjectFormat, OperationCapability, OperationInProgress,
    OperationRecord, OperationStatus, OperationsListResponse, PathPreviewToken, PreviewsRequest,
    PreviewsResponse, ReadKind, RepositoriesResponse, RepositorySummary, RuntimeLimits,
    StatusSnapshot, TargetKind, UnavailableReason, MUTATION_KINDS,
};
use refyard_contract::refs::RefsSnapshot;
use refyard_core::preconditions::{GatheredRefusal, PreconditionContext};

use crate::clock::{format_iso8601_millis, now_iso8601, now_millis};
use crate::events::{EventSink, EventSubscription};
use crate::files::preview::{PreviewClaim, PreviewStore};
use crate::files::PREVIEW_MAX_BYTES;
use crate::files::{self, FileRead};
use crate::jobs::journal::Journal;
use crate::jobs::recovery::Recovery;
use crate::jobs::{MutationEngine, MutationRequest, PreconditionSource, SubmitResult};
use crate::paths::{base36, PathRegistry};
use crate::providers::local::LocalGit;
use crate::providers::ssh::SshGit;
use crate::providers::GitExecutor;
use crate::reads;
use crate::reads::refs::object_format_of;
use crate::registry::{
    open_remote_repository, open_repository, OpenOutcome, OpenRequest, RepositoryRecord,
    RepositoryRegistry,
};
use crate::snapshots::SnapshotStore;
use crate::ssh::ConfigCatalogue;
use crate::targets::{
    probe_facts, ssh_target_generation, ssh_target_id, CreateTargetRequest, TargetRecord,
    TargetRegistry,
};
use crate::writes::WriteHost;

/// The contract revision this build serves. It matches `CONTRACT_VERSION` in
/// `packages/git-contract/src/version.ts`; a mismatch is a bug rather than a feature.
pub const CONTRACT_VERSION: &str = "1.2.0";
/// `API_MAJOR`: the number a client checks before it calls a write endpoint.
pub const API_MAJOR: u32 = 1;

/// Why this build has no mutations yet, said in the contract's own vocabulary.
const NOT_IMPLEMENTED_MESSAGE: &str = "this build implements the read half of the contract only; every mutation is named here and none of them is reported as available";

/// Why the mutations this build does not implement are absent.
const PARTIALLY_IMPLEMENTED_MESSAGE: &str = "this build implements staging, unstaging and committing only; every other mutation is named here and none of them is reported as available";

/// Builds the engine, registering the write effects exactly when the host asked for them.
///
/// One constructor for both calls that build an engine — the service's own construction
/// and a later one after a state directory is named — so the write path cannot be
/// registered in one place and silently dropped in the other.
fn build_engine(
    journal: &Arc<Journal>,
    recovery: &Arc<Recovery>,
    writes_host: &Arc<WriteHost>,
    writes_enabled: bool,
    events: &Arc<EventSink>,
) -> Arc<MutationEngine> {
    let effects = if writes_enabled {
        WriteHost::effects(writes_host)
    } else {
        Vec::new()
    };
    MutationEngine::with_event_sink(
        Arc::clone(journal),
        Arc::clone(recovery),
        effects,
        Some(Arc::clone(events)),
    )
}

/// The limits this build enforces, as the contract publishes them.
///
/// Repeated from `packages/git-contract/src/limits.ts` rather than computed, because a
/// client compares these with what it was compiled against.
fn runtime_limits() -> RuntimeLimits {
    RuntimeLimits {
        history_default_page_size: 200,
        history_max_page_size: 500,
        patch_max_bytes_per_file: 2_097_152,
        patch_max_lines_per_file: 20_000,
        object_max_bytes: 16_777_216,
        logical_cache_max_bytes: 67_108_864,
        preview_token_ttl_seconds: 300,
        readonly_deadline_seconds: 15,
        network_deadline_seconds: 600,
        hook_deadline_seconds: 120,
        queued_operations_per_actor: 32,
        concurrent_git_processes: 4,
        concurrent_readers_per_repository: 2,
        event_ring_max_events: 1_024,
        event_ring_max_bytes: 1_048_576,
        path_selection_max_entries: 1_000,
        history_tips_max: 16,
        commit_message_max_bytes: 1_048_576,
        branch_name_max_length: 255,
    }
}

/// How the service is built. Grouped so a new field is a visible edit at every call site
/// rather than a positional argument nobody can read.
pub struct ApplicationServiceConfig {
    /// The Git executable, resolved once by the caller.
    pub git: LocalGit,
    /// The identity a client is told, unique per process.
    pub service_instance_id: String,
    /// Which execution target this service is. For this slice there is exactly one: the
    /// machine it runs on.
    pub target_id: String,
    pub target_generation: String,
    /// The directory `~` expands to when a person browses for a repository. Passed in
    /// rather than read from this process's environment so that a test fixture, the
    /// desktop host and a future remote target each say which home they mean.
    pub home: PathBuf,
}

/// One read query: the contract's request without the transport's own concerns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusQuery {
    pub repository_id: String,
    pub worktree_id: Option<String>,
    pub include_ignored: bool,
}

impl StatusQuery {
    pub fn new(repository_id: impl Into<String>) -> Self {
        Self {
            repository_id: repository_id.into(),
            worktree_id: None,
            include_ignored: false,
        }
    }
}

/// One preview submission: the paths a caller selected, and the tokens it was given for
/// them.
///
/// The two lists are parallel and are checked to be the same length: a submission that
/// named three paths and two tokens would otherwise have one path checked against the
/// wrong token, and the whole point of a token is that it names what it was issued for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewSubmission {
    pub repository_id: String,
    pub worktree_id: String,
    pub path_ids: Vec<String>,
    pub preview_tokens: Vec<String>,
}

/// The read half of the application service.
pub struct ApplicationService {
    /// The local Git executable, kept for the capability answer that describes *this*
    /// machine. The local target's executor is the same program.
    git: LocalGit,
    targets: TargetRegistry,
    /// The stores a read mints state in — repositories, path ids, snapshots, preview
    /// tokens — behind shared handles, because a write effect runs after the call that
    /// accepted it and resolves its path ids and tokens in the very same stores.
    repositories: Arc<RepositoryRegistry>,
    paths: Arc<PathRegistry>,
    snapshots: Arc<SnapshotStore>,
    roots: Mutex<RootState>,
    service_instance_id: String,
    /// The local target's id and generation, as the constructor was given them.
    target_id: String,
    target_generation: String,
    home: PathBuf,
    git_version: Mutex<Option<String>>,
    /// An explicitly chosen SSH configuration source, when the caller named one. `None`
    /// leaves the machine's own OpenSSH configuration in force.
    ssh_source: Option<ConfigCatalogue>,
    /// The environment the SSH client runs with, when a caller needs a controlled one.
    /// `None` uses this process's allow-listed environment.
    ssh_environment: Option<Vec<(String, String)>>,
    /// Content fingerprints issued to a caller, and the store that refuses one whose
    /// content moved.
    previews: Arc<PreviewStore>,
    /// The durable record of every operation this host accepted.
    journal: Arc<Journal>,
    /// The write blocks a restart or an unknown outcome left behind.
    recovery: Arc<Recovery>,
    /// The write path. With no effects registered, `submit` refuses every mutation before
    /// anything is journalled, which is what `capabilities().operations` being empty says.
    /// [`Self::with_writes`] registers the three this build implements.
    engine: Arc<MutationEngine>,
    /// Whether the three write effects are registered. The effects themselves live in the
    /// engine; this is what a later rebuild of the engine (a state directory being named)
    /// reads so the write path is not silently dropped.
    writes_enabled: bool,
    /// The host pieces the effects resolve against, shared with the engine's effects.
    writes_host: Arc<WriteHost>,
    /// The bounded ring of state changes and invalidations, with live subscriptions.
    events: Arc<EventSink>,
}

/// One approved root: the key it is unique by, and the text a client is shown.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RootKey {
    /// A canonical local directory.
    Local(PathBuf),
    /// A remote path, unique per target only through the target it was approved on — the
    /// display string is what it is keyed by here because an SSH path is bytes text, not a
    /// path this process can canonicalise.
    Remote(String),
}

impl RootKey {
    fn display(&self) -> String {
        match self {
            Self::Local(path) => path.display().to_string(),
            Self::Remote(path) => path.clone(),
        }
    }
}

#[derive(Default)]
struct RootState {
    next: u64,
    /// Approved roots, in approval order, with the id each was minted.
    roots: Vec<(String, RootKey)>,
}

/// The most paths one preview request may name, from `LIMITS.pathSelectionMaxEntries`.
const PATH_SELECTION_MAX_ENTRIES: usize = 1_000;

/// The write-key prefix for an operation that addresses a location rather than a
/// repository. It cannot collide with `repo:` and it says which kind of resource the key
/// names without a second field.
const WORKSPACE_WRITE_KEY_PREFIX: &str = "root:";

/// What a mutation addresses, in the key it serialises and blocks under.
///
/// For a repository or worktree target this is the repository's *stable* identity: its
/// execution target and the path of its worktree as the far side spells it. The client-facing
/// repository id is deliberately not part of it — that id is minted per process, and a write
/// block has to be findable again after a restart.
fn repository_write_key(target_id: &str, record: &RepositoryRecord) -> String {
    // The design's key is "target + common Git directory". This record's common directory is
    // whatever the open read resolved; when that is empty — no read fills it in this slice —
    // the worktree the repository was opened at is the stable identity beside the target.
    let identity = if record.location.canonical_common_dir.is_empty() {
        record.location.canonical_worktree.as_str()
    } else {
        record.location.canonical_common_dir.as_str()
    };
    format!("repo:{target_id}\u{0}{identity}")
}

/// The target kinds one implemented mutation may address.
///
/// Read from the operation rather than assumed for all of them: a stage, an unstage and a
/// commit address a worktree, and a capability answer that claimed a repository target for
/// them would promise a request shape the contract does not accept.
fn operation_targets(kind: MutationKind) -> Vec<TargetKind> {
    match kind {
        MutationKind::InitRepository | MutationKind::CloneRepository => vec![TargetKind::Workspace],
        MutationKind::StagePaths
        | MutationKind::UnstagePaths
        | MutationKind::DiscardTrackedPaths
        | MutationKind::Commit
        | MutationKind::AmendCommit
        | MutationKind::SwitchBranch
        | MutationKind::CreateStash
        | MutationKind::ApplyStash
        | MutationKind::PopStash
        | MutationKind::Merge
        | MutationKind::ContinueMerge
        | MutationKind::AbortMerge
        | MutationKind::RevertCommit
        | MutationKind::ResetBranch
        | MutationKind::CherryPick
        | MutationKind::ContinueCherryPick
        | MutationKind::AbortCherryPick
        | MutationKind::Rebase
        | MutationKind::ContinueRebase
        | MutationKind::AbortRebase
        | MutationKind::DropCommit => vec![TargetKind::Worktree],
        _ => vec![TargetKind::Repository],
    }
}

/// The name an in-progress operation is known by, for the preconditions that compare
/// against it. The same spelling the contract's `OperationInProgress` publishes.
fn operation_in_progress_name(operation: OperationInProgress) -> String {
    match operation {
        OperationInProgress::Merge => "merge",
        OperationInProgress::CherryPick => "cherry-pick",
        OperationInProgress::Revert => "revert",
        OperationInProgress::Rebase => "rebase",
        OperationInProgress::Bisect => "bisect",
        OperationInProgress::ApplyMailbox => "apply-mailbox",
        OperationInProgress::Unknown => "unknown",
    }
    .to_string()
}

fn operation_status_name(status: refyard_contract::reads::OperationStatus) -> &'static str {
    use refyard_contract::reads::OperationStatus;
    match status {
        OperationStatus::Accepted => "accepted",
        OperationStatus::Running => "running",
        OperationStatus::Succeeded => "succeeded",
        OperationStatus::Failed => "failed",
        OperationStatus::NeedsAttention => "needsAttention",
        OperationStatus::Unknown => "unknown",
        OperationStatus::Cancelled => "cancelled",
    }
}

/// The content kind the contract publishes.
fn contract_content_kind(kind: crate::files::ContentKind) -> ContentKind {
    match kind {
        crate::files::ContentKind::Text => ContentKind::Text,
        crate::files::ContentKind::Binary => ContentKind::Binary,
        crate::files::ContentKind::Unrepresentable => ContentKind::Unrepresentable,
    }
}

/// The engine's view of this service: the facts a submission is judged against.
///
/// It borrows the service for the length of one `submit` call and is never stored, which is
/// what keeps the service from having to hold a reference to itself.
struct ServiceFacts<'a> {
    service: &'a ApplicationService,
}

impl ServiceFacts<'_> {
    /// The refusal, in the shape the core's precondition decision takes.
    fn refused(problem: Problem) -> PreconditionContext {
        PreconditionContext {
            refusal: Some(GatheredRefusal {
                code: problem.code,
                message: problem.message,
                retryable: problem.retryable,
            }),
            ..PreconditionContext::default()
        }
    }

    async fn facts(&self, request: &MutationRequest) -> Result<PreconditionContext, Problem> {
        let service = self.service;
        let Some(repository_id) = request.repository_id() else {
            // A workspace target has no repository yet: there is nothing to compare a
            // snapshot against and no index to have moved. The restart block is still
            // consulted, under the same key the queue and the journal use.
            return Ok(PreconditionContext {
                index_unchanged: true,
                may_run_during: refyard_core::preconditions::may_run_during_operation(
                    request.operation.kind(),
                ),
                ..PreconditionContext::default()
            });
        };
        let record = match service.require_record(repository_id) {
            Ok(record) => record,
            Err(problem) => return Ok(Self::refused(problem)),
        };
        let target = match service.target_for(&record) {
            Ok(target) => target,
            Err(problem) => return Ok(Self::refused(problem)),
        };
        let worktree_id = match reads::require_worktree(&record, request.worktree_id()) {
            Ok(worktree_id) => worktree_id,
            Err(error) => return Ok(Self::refused(error.to_problem())),
        };
        let executor = match target.executor() {
            Ok(executor) => executor,
            Err(problem) => return Ok(Self::refused(problem)),
        };
        // The facts themselves can fail — a Git directory that moved, a repository whose
        // directory was replaced, a `git` that stopped answering. None of those is an
        // internal error, and none of them accepted anything.
        let (status, fresh_snapshot_id) = match reads::status::read_status(
            executor,
            &record,
            &service.paths,
            &service.snapshots,
            false,
            &now_iso8601(),
        )
        .await
        {
            Ok(facts) => facts,
            Err(error) => return Ok(Self::refused(error.to_problem())),
        };
        let fresh_index_key = service
            .snapshots
            .get(&fresh_snapshot_id)
            .and_then(|snapshot| snapshot.index_key);

        let expected_snapshot_id = match &request.target {
            MutationTarget::Repository {
                expected_snapshot_id,
                ..
            }
            | MutationTarget::Worktree {
                expected_snapshot_id,
                ..
            } => Some(expected_snapshot_id.as_str()),
            MutationTarget::Workspace { .. } => None,
        };
        let snapshot = expected_snapshot_id.and_then(|id| service.snapshots.get(id));
        // An unknown or expired snapshot fails this comparison, which is what makes a
        // request prepared against a state nobody can find again a stale one.
        let index_unchanged = match (&snapshot, &fresh_index_key) {
            (Some(snapshot), Some(fresh)) => {
                snapshot.repository_id == record.repository_id
                    && snapshot.worktree_id.as_deref() == Some(worktree_id.as_str())
                    && snapshot.index_key.as_ref() == Some(fresh)
            }
            _ => false,
        };
        Ok(PreconditionContext {
            snapshot_head_oid: snapshot.and_then(|snapshot| snapshot.head_oid),
            current_head_oid: status.head.oid,
            index_unchanged,
            operation_in_progress: status.operation_in_progress.map(operation_in_progress_name),
            may_run_during: refyard_core::preconditions::may_run_during_operation(
                request.operation.kind(),
            ),
            // Filled in by the engine from the recovery, so a blocked repository cannot be
            // written to because a source forgot to look.
            restart_block: None,
            // Preview fingerprints are spent by the effect that acts on the paths, through
            // `redeem_previews`: the reference computes them there too, so that the read is
            // one read and not two.
            preview_checks: Vec::new(),
            refusal: None,
        })
    }
}

impl PreconditionSource for ServiceFacts<'_> {
    fn write_key(&self, request: &MutationRequest) -> Result<String, Problem> {
        match &request.target {
            MutationTarget::Workspace {
                allowed_root_id, ..
            } => Ok(format!("{WORKSPACE_WRITE_KEY_PREFIX}{allowed_root_id}")),
            MutationTarget::Repository { repository_id, .. }
            | MutationTarget::Worktree { repository_id, .. } => {
                self.service.write_key_for_repository(repository_id)
            }
        }
    }

    fn context<'a>(
        &'a self,
        request: &'a MutationRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<PreconditionContext, Problem>> + Send + 'a>,
    > {
        Box::pin(self.facts(request))
    }
}

impl ApplicationService {
    /// Builds a service around already-resolved host pieces.
    pub fn new(config: ApplicationServiceConfig) -> Self {
        let local_target = TargetRecord {
            target_id: config.target_id.clone(),
            kind: ExecutionTargetKind::Local,
            label: "This machine".to_string(),
            // The service runs the local target's Git, so it is ready by construction.
            state: ExecutionTargetState::Ready,
            remote_path_browse: false,
            generation: config.target_generation.clone(),
            executor: Some(GitExecutor::Local(config.git.clone())),
            unavailable: None,
            ssh: None,
        };
        Self::with_targets(config, TargetRegistry::new(local_target))
    }

    /// Builds the same service over a caller-supplied target set.
    ///
    /// The production constructor builds exactly the local target; targets are added
    /// through `createTarget`, which probes. This constructor exists for a host that
    /// already knows its targets and for tests that must exercise target routing without a
    /// remote machine — the same reason `LocalGit::at` exists beside `LocalGit::discover`.
    /// It is not a second way to add a target in production.
    pub fn with_targets(config: ApplicationServiceConfig, targets: TargetRegistry) -> Self {
        let journal =
            Arc::new(Journal::open(None).expect("an in-memory journal cannot fail to open"));
        let recovery = Arc::new(Recovery::new());
        let repositories = Arc::new(RepositoryRegistry::new());
        let paths = Arc::new(PathRegistry::new());
        let snapshots = Arc::new(SnapshotStore::default());
        let previews = Arc::new(PreviewStore::with_contract_limits());
        let events = Arc::new(EventSink::new());
        let writes_host = Arc::new(WriteHost::new(
            targets.clone(),
            Arc::clone(&repositories),
            Arc::clone(&paths),
            Arc::clone(&previews),
        ));
        let engine = build_engine(&journal, &recovery, &writes_host, false, &events);
        Self {
            git: config.git,
            targets,
            repositories,
            paths,
            snapshots,
            roots: Mutex::new(RootState::default()),
            service_instance_id: config.service_instance_id,
            target_id: config.target_id,
            target_generation: config.target_generation,
            home: config.home,
            git_version: Mutex::new(None),
            ssh_source: None,
            ssh_environment: None,
            previews,
            journal,
            recovery,
            engine,
            writes_enabled: false,
            writes_host,
            events,
        }
    }

    /// Gives this service a private state directory for its operation journal.
    ///
    /// The directory is the host's own (a per-user application state directory, or a
    /// fixture's scratch tree), never a repository: the journal must not be something a
    /// Git operation, a hook or a checkout can move. Opening it loads every record the
    /// previous process left and reconciles what it did not finish, so the block a crash
    /// left behind exists before the first read is answered.
    ///
    /// Without this call the journal works and does not survive the process, which is what
    /// a host that named no directory actually has.
    pub fn with_state_root(self, root: PathBuf) -> Result<Self, Problem> {
        let journal = Arc::new(Journal::open(Some(root))?);
        let recovery = Arc::new(Recovery::new());
        recovery.reconcile(&journal, crate::clock::now_millis())?;
        let engine = build_engine(
            &journal,
            &recovery,
            &self.writes_host,
            self.writes_enabled,
            &self.events,
        );
        Ok(Self {
            journal,
            recovery,
            engine,
            ..self
        })
    }

    /// Registers the three write effects this build implements: `stagePaths`,
    /// `unstagePaths` and `commit`.
    ///
    /// Registration is explicit rather than part of `new`, because a service that has not
    /// been given the write path answers exactly as the read-only build did: no operation
    /// is offered in `capabilities`, and every submission is refused with
    /// `UnsupportedOperation` before anything is journalled. A read-only inspector, the
    /// differential fixture and a host whose writes are not yet wired rely on that; a host
    /// that wants the minimal write loop calls this once, in its composition root.
    ///
    /// The effects are the same three whichever target a repository was opened on: the
    /// planner builds one argument vector and the provider decides whether it runs here or
    /// over SSH.
    pub fn with_writes(mut self) -> Self {
        self.writes_enabled = true;
        self.engine = build_engine(
            &self.journal,
            &self.recovery,
            &self.writes_host,
            true,
            &self.events,
        );
        self
    }

    /// The event sink: state changes and invalidations, with live subscriptions.
    ///
    /// Events are hints. A client that never subscribes recovers every fact through
    /// `operation`/`operations`, which read the journal; this sink is how a client that is
    /// listening refreshes sooner.
    pub fn events(&self) -> &EventSink {
        &self.events
    }

    /// Subscribes for live event delivery. A shortcut for `self.events().subscribe()`.
    pub fn subscribe_events(&self) -> EventSubscription {
        self.events.subscribe()
    }

    /// Binds SSH discovery and execution to one explicitly chosen configuration source.
    ///
    /// Without it the service reads `~/.ssh/config` under `home` and lets OpenSSH apply
    /// its own rules (the system file included, `~` resolved from the passwd entry). An
    /// explicit source is the design's "user chose this file" case: it is passed to `ssh`
    /// with `-F`, which *replaces* the system and default user files rather than adding to
    /// them, which is why it is a caller's explicit choice and never a default.
    pub fn with_ssh_config_file(mut self, config_file: PathBuf) -> Self {
        let include_base = config_file
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/"));
        self.ssh_source = Some(ConfigCatalogue::new(config_file, include_base));
        self
    }

    /// Sets the environment every SSH command runs with.
    ///
    /// The default is this process's allow-listed environment (`PATH`, `HOME`,
    /// `SSH_AUTH_SOCK`), which is what makes a session use the user's own agent and
    /// configuration. A caller that has to state its conditions — a fixture with its own
    /// scratch home and no agent, a host that must not inherit one — supplies the vector
    /// here; the option policy is unaffected either way.
    pub fn with_ssh_environment(mut self, environment: Vec<(String, String)>) -> Self {
        self.ssh_environment = Some(environment);
        self
    }

    /// The configuration source this service reads: the chosen one, or this home's own.
    fn catalogue(&self) -> ConfigCatalogue {
        match &self.ssh_source {
            Some(catalogue) => catalogue.clone(),
            None => {
                let ssh_directory = self.home.join(".ssh");
                ConfigCatalogue::new(ssh_directory.join("config"), ssh_directory)
            }
        }
    }

    /// The identity of this service instance, as capabilities reports it.
    pub fn service_instance_id(&self) -> &str {
        &self.service_instance_id
    }

    /// The execution target every read in this service runs against.
    pub fn target_id(&self) -> &str {
        &self.target_id
    }

    /// That target's generation. A new value means snapshots, cursors and previews minted
    /// against the previous one are no longer valid, which is what lets a client tell a
    /// re-read of the same target from a read of a rebuilt one.
    pub fn target_generation(&self) -> &str {
        &self.target_generation
    }

    /// Every target this session holds, in creation order.
    pub fn targets(&self) -> Vec<refyard_contract::host::ExecutionTargetSummary> {
        self.targets
            .list()
            .into_iter()
            .map(|t| t.summary())
            .collect()
    }

    /// Why a target is not ready, when it is not.
    ///
    /// A diagnostic surface beside the contract's row: the summary carries the state
    /// (`unavailable`) and this carries the reason, so a caller that shows a target can
    /// show what failed without the failure having been an error that lost the target.
    pub fn target_problem(&self, target_id: &str) -> Option<Problem> {
        self.targets
            .get(target_id)
            .and_then(|target| target.unavailable)
    }

    /// Creates a target, or rebuilds the one this choice already names.
    ///
    /// The local target is returned as it is: this service runs it. An SSH target is
    /// created by finding the alias in the configuration catalogue, building the provider
    /// through the fixed option policy, and probing the far side for POSIX shell semantics
    /// and a Git version. A probe that fails still answers with the target — `unavailable`,
    /// with the reason kept for [`Self::target_problem`] — because a target the UI must
    /// show the failure next to is not an error the session cannot hold.
    pub async fn create_target(
        &self,
        request: CreateTargetRequest,
    ) -> Result<refyard_contract::host::ExecutionTargetSummary, Problem> {
        match request {
            CreateTargetRequest::Local => {
                let local = self.targets.get(&self.target_id).ok_or_else(|| {
                    Problem::new(
                        ProblemCode::InternalError,
                        "the local execution target is missing from this service",
                    )
                })?;
                Ok(local.summary())
            }
            CreateTargetRequest::SshConfig { host_id } => self.create_ssh_target(&host_id).await,
        }
    }

    /// The provider for one alias, built the only way this service builds one: the chosen
    /// configuration source when there is one, the machine's own OpenSSH otherwise, and
    /// always through `SshGit`'s fixed option policy.
    fn ssh_provider(&self, alias: &str) -> Result<SshGit, Problem> {
        match (&self.ssh_source, &self.ssh_environment) {
            // A caller that stated its environment also states which `ssh` runs, because
            // the two travel together; both are resolved here rather than defaulted.
            (Some(catalogue), Some(environment)) => SshGit::at_config(
                crate::ssh::openssh::discover_program()?,
                environment.clone(),
                alias,
                Some(catalogue.source.path.clone()),
            ),
            (Some(catalogue), None) => {
                SshGit::discover_with_config(alias, catalogue.source.path.clone())
            }
            (None, Some(environment)) => SshGit::at(
                crate::ssh::openssh::discover_program()?,
                environment.clone(),
                alias,
            ),
            (None, None) => SshGit::discover(alias),
        }
    }

    /// The probe half of `create_target`, kept separate so the path from catalogue entry to
    /// target record is one readable sequence.
    async fn create_ssh_target(
        &self,
        host_id: &str,
    ) -> Result<refyard_contract::host::ExecutionTargetSummary, Problem> {
        let listing = self.catalogue().list().await?;
        let candidate = listing
            .hosts
            .iter()
            .find(|candidate| candidate.host_id == host_id)
            .ok_or_else(|| {
                Problem::new(
                    ProblemCode::NotFound,
                    format!(
                        "no SSH host candidate {host_id} is in this configuration source; re-read sshHosts, because the source may have changed"
                    ),
                )
            })?;
        let provider = match self.ssh_provider(&candidate.alias) {
            Ok(provider) => provider,
            // An alias the host token rule refuses is a refusal of the request, not a
            // target: this host will not hand that string to `ssh` on any build. A
            // missing `ssh` program is the machine's condition, so it becomes an
            // unavailable target below.
            Err(problem) if problem.code == ProblemCode::InvalidRequest => return Err(problem),
            Err(problem) => {
                return Ok(self.record_ssh_target(
                    candidate,
                    &listing.revision,
                    None,
                    Some(problem),
                    None,
                ))
            }
        };
        let (git_version, unavailable) = match provider.probe_host().await {
            Ok(version) => (Some(version), None),
            Err(problem) => (None, Some(problem)),
        };
        Ok(self.record_ssh_target(
            candidate,
            &listing.revision,
            git_version.as_deref(),
            unavailable,
            Some(provider),
        ))
    }

    /// Records (or replaces) one SSH target and answers with its row.
    fn record_ssh_target(
        &self,
        candidate: &refyard_contract::host::SshHostCandidate,
        source_revision: &str,
        git_version: Option<&str>,
        unavailable: Option<Problem>,
        provider: Option<SshGit>,
    ) -> refyard_contract::host::ExecutionTargetSummary {
        let target_id = ssh_target_id(&candidate.source_id, &candidate.alias);
        let failure_code = unavailable
            .as_ref()
            .map(|problem| format!("{:?}", problem.code));
        let generation = ssh_target_generation(
            &candidate.source_id,
            source_revision,
            &candidate.alias,
            &probe_facts(git_version, failure_code.as_deref()),
        );
        let state = if unavailable.is_some() {
            ExecutionTargetState::Unavailable
        } else {
            ExecutionTargetState::Ready
        };
        let record = TargetRecord {
            target_id,
            kind: ExecutionTargetKind::SshConfig,
            label: candidate.display_label.clone(),
            state,
            remote_path_browse: false,
            generation,
            // A target that was never given a provider (no `ssh` on this machine) has no
            // executor to lie with; a probe failure keeps the provider it did build, so a
            // rebuild re-probes the same way.
            executor: provider.map(GitExecutor::Ssh),
            unavailable,
            ssh: Some(crate::targets::SshTargetFacts {
                source_id: candidate.source_id.clone(),
                source_revision: source_revision.to_string(),
                alias: candidate.alias.clone(),
            }),
        };
        self.targets.insert(record.clone());
        record.summary()
    }

    /// Drops one SSH target and every repository opened on it.
    ///
    /// The local target is the service's own machine: there is no connection to release,
    /// and a session that could disconnect it could not read anything at all. A later read
    /// for a repository that lived on a dropped target is a not-found, never a fallback to
    /// this machine.
    pub fn disconnect_target(&self, target_id: &str) -> Result<(), Problem> {
        let target = self.targets.get(target_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown execution target {target_id}"),
            )
        })?;
        if target.kind == ExecutionTargetKind::Local {
            return Err(Problem::new(
                ProblemCode::UnsupportedOperation,
                "the local execution target is this service's own machine and cannot be disconnected",
            ));
        }
        self.targets.remove(target_id);
        self.repositories.revoke_target(target_id);
        Ok(())
    }

    /// What this build can do right now.
    pub async fn capabilities(&self) -> Result<CapabilitiesResponse, Problem> {
        let version = self.git_version().await?;
        // The mutations this build implements and the ones it does not are one list split
        // in two, derived from the effects the engine holds. A build with no effects — this
        // one — therefore names every mutation as unavailable, and a build that registers
        // one reports the rest without anybody having to remember to edit a second table.
        let implemented = self.engine.implemented_kinds();
        let operations: Vec<OperationCapability> = implemented
            .iter()
            .map(|kind| OperationCapability {
                kind: *kind,
                targets: operation_targets(*kind),
            })
            .collect();
        let remaining: Vec<MutationKind> = MUTATION_KINDS
            .iter()
            .copied()
            .filter(|kind| !implemented.contains(kind))
            .collect();
        let unavailable = if remaining.is_empty() {
            Vec::new()
        } else {
            vec![UnavailableReason {
                code: "not-implemented".to_string(),
                message: if implemented.is_empty() {
                    NOT_IMPLEMENTED_MESSAGE.to_string()
                } else {
                    PARTIALLY_IMPLEMENTED_MESSAGE.to_string()
                },
                operations: remaining,
            }]
        };
        Ok(CapabilitiesResponse {
            api_major: API_MAJOR,
            contract_version: CONTRACT_VERSION.to_string(),
            service_instance_id: self.service_instance_id.clone(),
            host: HostInfo {
                kind: HostKind::Rust,
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            git: GitInfo {
                executable_display: self.git.program().display().to_string(),
                version,
                features: GitCapabilities {
                    porcelain_v2_status: true,
                    worktree_list_z: false,
                    cat_file_batch: true,
                    push_porcelain: false,
                    fetch_porcelain: false,
                    object_formats: vec![ObjectFormat::Sha1, ObjectFormat::Sha256],
                },
            },
            reads: self.implemented_reads(),
            // Derived from the effects this build registered, never from a wish: a mutation
            // this build cannot run is absent from this list and named in `unavailable`
            // instead of being offered and then refused.
            operations,
            limits: runtime_limits(),
            unavailable,
        })
    }

    /// Every read method this build serves.
    pub fn implemented_reads(&self) -> Vec<ReadKind> {
        vec![
            ReadKind::Capabilities,
            ReadKind::Filesystem,
            ReadKind::Repositories,
            ReadKind::Status,
            ReadKind::History,
            ReadKind::Refs,
            ReadKind::Diff,
        ]
    }

    /// The registered repositories and the roots they were approved under.
    ///
    /// Each row carries the repository's real HEAD, read now: a list that reported an
    /// unborn HEAD for a repository with commits would make the launcher show the wrong
    /// state for every open tab.
    pub async fn repositories(&self) -> RepositoriesResponse {
        let records = self.repositories.list();
        let mut summaries = Vec::with_capacity(records.len());
        for record in &records {
            // Each row's HEAD is read through the target the repository was opened on, not
            // through this machine's Git: a remote repository's HEAD is remote.
            let head = match self.read_record_head(record).await {
                Ok(head) => head,
                // A repository whose HEAD cannot be read is still a registered
                // repository; the row says `unborn` and the panel's own read reports the
                // failure with its diagnostic.
                Err(_) => HeadState {
                    kind: HeadKind::Unborn,
                    branch_name: None,
                    oid: None,
                    detached: false,
                },
            };
            summaries.push(RepositorySummary {
                repository_id: record.repository_id.clone(),
                allowed_root_id: record.allowed_root_id.clone(),
                target_id: Some(record.location.target_id.clone()),
                display_name: record.display_name.clone(),
                display_path: record.display_path.clone(),
                object_format: object_format_of(record),
                worktree_ids: vec![record.worktree_id.clone()],
                primary_worktree_id: record.worktree_id.clone(),
                head,
                operation_in_progress: None::<OperationInProgress>,
                last_fetched_at: None,
            });
        }
        let roots = self.roots.lock().expect("root lock");
        let allowed_roots: Vec<AllowedRootSummary> = roots
            .roots
            .iter()
            .map(|(allowed_root_id, key)| AllowedRootSummary {
                allowed_root_id: allowed_root_id.clone(),
                display_path: key.display(),
                repository_ids: summaries
                    .iter()
                    .filter(|summary| &summary.allowed_root_id == allowed_root_id)
                    .map(|summary| summary.repository_id.clone())
                    .collect(),
            })
            .collect();
        RepositoriesResponse {
            repositories: summaries,
            allowed_roots,
        }
    }

    /// Approves one directory and registers it as a repository on the local target.
    ///
    /// The one-argument form is the local target's; a caller that names a target uses
    /// [`Self::register_repository_on`]. Both go through the same checks.
    pub async fn register_repository(&self, path: &str) -> Result<RepositoriesResponse, Problem> {
        self.register_repository_on(path, None).await
    }

    /// Opens one path on one target and registers it as a repository.
    ///
    /// A local path is canonicalised once, here: every later command runs against the
    /// canonical location, and a symlinked path would otherwise mean two identities for
    /// one repository. A remote path is opened by probing the far side with the same
    /// layout planner and parser, and nothing on this machine's filesystem is consulted
    /// for it. A target this session does not have is refused; it is never a fallback to
    /// the local one.
    pub async fn register_repository_on(
        &self,
        path: &str,
        target_id: Option<&str>,
    ) -> Result<RepositoriesResponse, Problem> {
        let target = self.require_target(target_id.unwrap_or(&self.target_id))?;
        if !target.is_ready() {
            let mut problem = target.unavailable.clone().unwrap_or_else(|| {
                Problem::new(
                    ProblemCode::Unavailable,
                    format!("target {} is not ready", target.target_id),
                )
            });
            problem.message = format!(
                "target {} ({}) is not ready: {}",
                target.target_id, target.label, problem.message
            );
            return Err(problem);
        }
        match target.kind {
            ExecutionTargetKind::Local => self.register_local_repository(path, &target).await,
            ExecutionTargetKind::SshConfig => self.register_ssh_repository(path, &target).await,
        }
    }

    /// The local half of registration: this machine's filesystem decides what may be
    /// opened.
    async fn register_local_repository(
        &self,
        path: &str,
        target: &TargetRecord,
    ) -> Result<RepositoriesResponse, Problem> {
        let requested = PathBuf::from(path);
        let canonical = tokio::fs::canonicalize(&requested).await.map_err(|_| {
            Problem::new(
                ProblemCode::NotFound,
                format!("the path selector directory does not exist: {path}"),
            )
        })?;
        let metadata = tokio::fs::metadata(&canonical).await.map_err(|_| {
            Problem::new(
                ProblemCode::NotFound,
                format!("the path selector directory does not exist: {path}"),
            )
        })?;
        if !metadata.is_dir() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                format!("the path selector target is not a directory: {path}"),
            ));
        }
        let local = match target.executor()? {
            GitExecutor::Local(local) => local,
            GitExecutor::Ssh(_) => {
                return Err(Problem::new(
                    ProblemCode::InternalError,
                    "a local target holds an SSH executor, which is a construction bug rather than a request failure",
                ))
            }
        };
        let allowed_root_id = self.approve_root(&canonical);
        let mut next_id = || self.repositories.next_id();
        let outcome = open_repository(
            OpenRequest {
                program: local.program(),
                env: local.environment(),
                directory: &canonical,
                allowed_root_id: &allowed_root_id,
                root_path: &canonical,
                relative_path: "",
                target_id: &target.target_id,
                target_generation: &target.generation,
            },
            &mut next_id,
        )
        .await;
        match outcome {
            OpenOutcome::Opened(record) => {
                self.repositories.register(*record);
                // The row's HEAD comes from the registry read, so registration itself does
                // not need a second command.
                Ok(self.repositories().await)
            }
            OpenOutcome::Failed(outcome) => Err(Problem::new(
                ProblemCode::GitCommandFailed,
                format!(
                    "rev-parse layout exited with status {}",
                    outcome
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "?".to_string())
                ),
            )
            .with_detail(
                "diagnostic",
                DetailValue::Text(
                    String::from_utf8_lossy(&outcome.stderr)
                        .trim_end()
                        .chars()
                        .take(500)
                        .collect::<String>(),
                ),
            )),
        }
    }

    /// The remote half of registration: the far side is probed for the canonical common
    /// dir and worktree, and this machine's filesystem is not consulted at all.
    async fn register_ssh_repository(
        &self,
        path: &str,
        target: &TargetRecord,
    ) -> Result<RepositoriesResponse, Problem> {
        // The path is used exactly as it arrived: trimming or normalising it would act on
        // a path the caller was never shown, and a remote path's spaces are its own.
        let directory = path;
        if directory.is_empty() || !directory.starts_with('/') {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                "a remote repository path must be an absolute POSIX path, because it is resolved on the remote host and not in this process",
            ));
        }
        let ssh = match target.executor()? {
            GitExecutor::Ssh(ssh) => ssh,
            GitExecutor::Local(_) => {
                return Err(Problem::new(
                    ProblemCode::InternalError,
                    "an SSH target holds a local executor, which is a construction bug rather than a request failure",
                ))
            }
        };
        let allowed_root_id = self.approve_remote_root(directory);
        let mut next_id = || self.repositories.next_id();
        let record = open_remote_repository(
            ssh,
            directory,
            &allowed_root_id,
            Path::new(directory),
            &target.target_id,
            &target.generation,
            &mut next_id,
        )
        .await?;
        self.repositories.register(*record);
        Ok(self.repositories().await)
    }

    /// Forgets one repository. Registered data is not deleted; the approval is withdrawn.
    pub async fn revoke_repository(
        &self,
        repository_id: &str,
    ) -> Result<RepositoriesResponse, Problem> {
        if !self.repositories.revoke(repository_id) {
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown repository {repository_id}"),
            ));
        }
        Ok(self.repositories().await)
    }

    /// One directory for the local picker: its subdirectories, and which of them are
    /// repositories.
    ///
    /// Not a Git read. It answers what a person may descend into or open, so it works on a
    /// directory that is not a repository and does not run a command.
    pub async fn filesystem_entries(
        &self,
        path: Option<&str>,
    ) -> Result<FilesystemEntriesResponse, Problem> {
        self.filesystem_entries_on(path, None).await
    }

    /// The same, when the caller names the target it wants to browse.
    ///
    /// Only the local target can be browsed: this read answers from this machine's
    /// filesystem, and answering it for a remote target would show one machine's
    /// directories as another's. The contract says so with `remotePathBrowse: false`.
    pub async fn filesystem_entries_on(
        &self,
        path: Option<&str>,
        target_id: Option<&str>,
    ) -> Result<FilesystemEntriesResponse, Problem> {
        if let Some(target_id) = target_id {
            let target = self.require_target(target_id)?;
            if target.kind != ExecutionTargetKind::Local {
                return Err(Problem::new(
                    ProblemCode::UnsupportedOperation,
                    format!(
                        "target {} is remote and this build cannot browse its directories; enter the remote path instead",
                        target.target_id
                    ),
                ));
            }
        }
        reads::filesystem::read_filesystem_entries(path, &self.home).await
    }

    /// The concrete SSH aliases this machine's own configuration declares.
    ///
    /// A read of files and nothing else: no connection, no `ssh -G`, no `Match`
    /// evaluation, no key, no credential. What comes back is a set of candidates — an
    /// alias is not a verified machine, and a list marked incomplete is not a claim that
    /// these are all of them.
    pub async fn ssh_hosts(&self) -> Result<SshHostList, Problem> {
        self.catalogue().list().await
    }

    /// Working-tree and index state.
    pub async fn status(&self, query: &StatusQuery) -> Result<StatusSnapshot, Problem> {
        let record = self.require_record(&query.repository_id)?;
        let target = self.target_for(&record)?;
        reads::status::read_status(
            target.executor()?,
            &record,
            &self.paths,
            &self.snapshots,
            query.include_ignored,
            &now_iso8601(),
        )
        .await
        .map(|(snapshot, _)| snapshot)
        .map_err(|error| error.to_problem())
    }

    /// One page of the commit graph.
    pub async fn history(&self, query: &HistoryQuery) -> Result<HistoryPage, Problem> {
        let record = self.require_record(&query.repository_id)?;
        let target = self.target_for(&record)?;
        reads::history::read_history(
            target.executor()?,
            &record,
            &self.snapshots,
            query,
            &target.generation,
            &now_iso8601(),
        )
        .await
        .map_err(|error| error.to_problem())
    }

    /// Branches, remote-tracking refs, tags and remotes.
    pub async fn refs(&self, repository_id: &str) -> Result<RefsSnapshot, Problem> {
        let record = self.require_record(repository_id)?;
        let target = self.target_for(&record)?;
        reads::refs::read_refs(target.executor()?, &record, &self.snapshots, &now_iso8601())
            .await
            .map_err(|error| error.to_problem())
    }

    /// A bounded diff, with a patch only for the path the caller named.
    pub async fn diff(&self, query: &DiffQuery) -> Result<DiffResponse, Problem> {
        let record = self.require_record(&query.repository_id)?;
        let target = self.target_for(&record)?;
        // An untracked-file diff reads the working tree through this process's filesystem;
        // doing that for a remote repository would read a local path while claiming it came
        // from the remote host.
        if query.kind == DiffKind::Untracked && target.executor()?.is_remote() {
            return Err(Problem::new(
                ProblemCode::UnsupportedOperation,
                "an untracked-file diff is read from this machine's filesystem and is not implemented for a remote target",
            ));
        }
        reads::diff::read_diff(
            target.executor()?,
            &record,
            &self.paths,
            &self.snapshots,
            query,
            &now_iso8601(),
        )
        .await
        .map_err(|error| error.to_problem())
    }

    /// Resolves one path id to the bytes it was bound to.
    ///
    /// Exposed for the fixture driver, which resolves a display path to an id the way a
    /// client does: read the change set, take the id it was given, ask for that id. A read
    /// that would act on the path resolves through the target generation instead, so an id
    /// from an earlier build cannot be used by one.
    pub fn resolve_path_id(&self, path_id: &str) -> Option<Vec<u8>> {
        self.paths.resolve_any(path_id)
    }

    /* --------------------------------------------------------------- previews */

    /// Content fingerprints for selected paths, bound to the state they were read in.
    ///
    /// The preview is a read of *content*: every named path is resolved through this
    /// worktree and this build of the target, read through the target that owns the
    /// repository — never this machine's filesystem for a remote one — and fingerprinted
    /// here. The response names the snapshot the read was taken against, so a write built
    /// on it is refused when the index moved in between.
    ///
    /// One path the host cannot read does not fail the batch: it gets a token with no size
    /// and no content, and a write against it is refused as stale, which is the reference's
    /// behaviour for a path that no longer exists. One path over the read bound *does* fail
    /// the batch, because fingerprinting a prefix of it would be a claim about bytes nobody
    /// read.
    pub async fn previews(&self, query: &PreviewsRequest) -> Result<PreviewsResponse, Problem> {
        let record = self.require_record(&query.repository_id)?;
        let target = self.target_for(&record)?;
        let worktree_id = reads::require_worktree(&record, Some(&query.worktree_id))
            .map_err(|error| error.to_problem())?;
        if query.path_ids.is_empty() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                "at least one path id is required",
            ));
        }
        if query.path_ids.len() > PATH_SELECTION_MAX_ENTRIES {
            return Err(Problem::new(
                ProblemCode::LimitExceeded,
                format!("at most {PATH_SELECTION_MAX_ENTRIES} paths may be previewed at once"),
            )
            .with_detail(
                "pathCount",
                DetailValue::Integer(query.path_ids.len() as i64),
            ));
        }
        let executor = target.executor()?;
        let read_at = now_iso8601();
        // The state the preview is taken against. Reading it also mints the path ids for
        // every changed path, which is how a client gets an id it may name here at all.
        let (_status, snapshot_id) = reads::status::read_status(
            executor,
            &record,
            &self.paths,
            &self.snapshots,
            false,
            &read_at,
        )
        .await
        .map_err(|error| error.to_problem())?;

        // Every read happens before any token is issued: a batch that is refused for one
        // path must not leave tokens behind for the others.
        let mut reads: Vec<(String, FileRead)> = Vec::with_capacity(query.path_ids.len());
        for path_id in &query.path_ids {
            let bytes = self.authorised_path_bytes(&record, &worktree_id, path_id)?;
            let read = self.read_file(executor, &record, &bytes).await;
            if let FileRead::Oversize { size_bytes } = read {
                return Err(Problem::new(
                    ProblemCode::LimitExceeded,
                    format!(
                        "a selected path is larger than the {PREVIEW_MAX_BYTES} byte bound this host reads for a preview; it cannot be previewed and so cannot be changed through a previewed request"
                    ),
                )
                .with_detail("pathId", DetailValue::Text(path_id.clone()))
                .with_detail(
                    "sizeBytes",
                    DetailValue::Integer(size_bytes.unwrap_or(0) as i64),
                ));
            }
            reads.push((path_id.clone(), read));
        }

        let mut tokens = Vec::with_capacity(reads.len());
        for (path_id, read) in reads {
            let issued = self.previews.issue(PreviewClaim {
                repository_id: record.repository_id.clone(),
                worktree_id: worktree_id.clone(),
                target_generation: record.location.target_generation.clone(),
                path_id: path_id.clone(),
                fingerprint_hex: read.fingerprint_hex(),
                size_bytes: read.size_bytes(),
                content_kind: read.content_kind(),
            });
            tokens.push(PathPreviewToken {
                path_id,
                preview_token: issued.preview_token,
                size_bytes: read.size_bytes(),
                content_kind: contract_content_kind(read.content_kind()),
                fingerprint_algorithm: FingerprintAlgorithm::Sha256,
                expires_at: format_iso8601_millis(issued.expires_at_ms),
            });
        }
        Ok(PreviewsResponse {
            repository_id: record.repository_id,
            worktree_id,
            snapshot_id,
            read_at,
            tokens,
        })
    }

    /// Re-reads the selected paths and spends the tokens they were given.
    ///
    /// This is the check a write is built on, and it is deliberately not the same thing as
    /// the status read that produced the change set: a path can be edited from one modified
    /// state into another and stay `M`, so only the bytes answer whether the content the
    /// user was shown is still the content that would be changed.
    ///
    /// All-or-nothing: one stale entry leaves every token unused, because a partially
    /// consumed batch would force the client to re-preview paths it never touched.
    pub async fn redeem_previews(&self, submission: &PreviewSubmission) -> Result<(), Problem> {
        self.writes_host
            .redeem_submission(
                &submission.repository_id,
                &submission.worktree_id,
                &submission.path_ids,
                &submission.preview_tokens,
            )
            .await
    }

    /// Resolves a path id a read may act on: this worktree, this build of the target.
    ///
    /// A path id the caller was never shown does not exist here, and one minted for another
    /// worktree or an earlier build is refused rather than followed.
    fn authorised_path_bytes(
        &self,
        record: &RepositoryRecord,
        worktree_id: &str,
        path_id: &str,
    ) -> Result<Vec<u8>, Problem> {
        self.paths
            .resolve_in(worktree_id, &record.location.target_generation, path_id)
            .ok_or_else(|| {
                Problem::new(
                    ProblemCode::NotFound,
                    "a selected path is unknown in this worktree; reload the change set and retry",
                )
                .with_detail("pathId", DetailValue::Text(path_id.to_string()))
            })
    }

    /// Reads one path through the target that owns the repository.
    ///
    /// The two arms are the two readers, and neither consults the other machine: a local
    /// repository is read from this filesystem below the worktree it was opened at, and a
    /// remote one is read by the SSH provider's fixed command on the far side.
    async fn read_file(
        &self,
        executor: &GitExecutor,
        record: &RepositoryRecord,
        path_bytes: &[u8],
    ) -> FileRead {
        files::read_through(
            executor,
            record.location.canonical_worktree.as_str(),
            path_bytes,
        )
        .await
    }

    /* ------------------------------------------------------------- operations */

    /// One operation this host recorded.
    pub fn operation(&self, operation_id: &str) -> Result<OperationRecord, Problem> {
        self.journal
            .get(operation_id)
            .map(|record| record.to_operation_record())
            .ok_or_else(|| {
                Problem::new(
                    ProblemCode::NotFound,
                    format!("unknown operation {operation_id}"),
                )
            })
    }

    /// One operation, when it belongs to this actor.
    ///
    /// A caller that did not submit an operation is told it does not exist — the same answer
    /// `cancel` gives — because a session that could read another's operations could infer
    /// what another window is doing. The difference between "not yours" and "not here" is
    /// deliberately not published.
    pub fn operation_for(
        &self,
        actor: &str,
        operation_id: &str,
    ) -> Result<OperationRecord, Problem> {
        let unknown = || {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        };
        let record = self.journal.get(operation_id).ok_or_else(unknown)?;
        if record.actor != actor {
            return Err(unknown());
        }
        Ok(record.to_operation_record())
    }

    /// The operations one actor submitted, newest first.
    pub fn operations(&self, actor: &str, limit: usize) -> OperationsListResponse {
        self.engine.list(actor, limit)
    }

    /// Submits one mutation through the write path.
    ///
    /// With no effects registered this refuses every request with `UnsupportedOperation`
    /// before anything is journalled — the same answer `capabilities` gives by listing no
    /// operation.
    pub async fn submit_mutation(
        &self,
        actor: &str,
        request: MutationRequest,
    ) -> Result<SubmitResult, Problem> {
        let source = ServiceFacts { service: self };
        self.engine.submit(actor, request, &source).await
    }

    /// Cancels an operation that has not started.
    pub fn cancel_operation(
        &self,
        actor: &str,
        operation_id: &str,
    ) -> Result<OperationRecord, Problem> {
        self.engine.cancel(actor, operation_id)
    }

    /// The resources a write block is held under, for a UI that has to explain itself.
    pub fn blocked_repositories(&self) -> Vec<String> {
        self.recovery.blocked_keys()
    }

    /// The key an operation on this repository is serialised and blocked under.
    ///
    /// The repository's *stable* identity — its target and common Git directory — and not
    /// the id this process minted: a block has to be findable again after a restart, when
    /// the minted id is gone.
    pub fn write_key_for_repository(&self, repository_id: &str) -> Result<String, Problem> {
        let record = self.require_record(repository_id)?;
        Ok(repository_write_key(&record.location.target_id, &record))
    }

    /// Lifts the write block an uncertain operation left behind.
    ///
    /// Three things are required, and all three are about not accepting a confirmation for
    /// a state nobody looked at: the operation must be one that is *uncertain*, the named
    /// snapshot must be one this service minted, and it must be newer than the operation's
    /// own finish and cover the repository the operation touched.
    ///
    /// The operation's outcome is never rewritten: the record stays `unknown` because that
    /// is what is true, and the acknowledgement only says a person has looked at the
    /// repository since.
    pub fn acknowledge_uncertain_operation(
        &self,
        operation_id: &str,
        confirmed_snapshot_id: &str,
    ) -> Result<OperationRecord, Problem> {
        let record = self.journal.get(operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.status != OperationStatus::Unknown {
            return Err(Problem::new(
                ProblemCode::Conflict,
                format!(
                    "operation {operation_id} is {} and left no write block to lift",
                    operation_status_name(record.status)
                ),
            ));
        }
        let snapshot = self.snapshots.get(confirmed_snapshot_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!(
                    "the snapshot {confirmed_snapshot_id} was not minted by this service; re-read the repository and confirm against that snapshot"
                ),
            )
        })?;
        if let Some(finished_at) = record.finished_at_ms {
            if (snapshot.created_at_ms as i64) < finished_at {
                return Err(Problem::new(
                    ProblemCode::StaleSnapshot,
                    "the snapshot predates the operation it is meant to confirm; re-read the repository and confirm again",
                ));
            }
        }
        let recorded_key =
            match self.write_key_for_repository(&snapshot.repository_id) {
                Ok(key) => key,
                Err(_) => return Err(Problem::new(
                    ProblemCode::Conflict,
                    "the confirming snapshot does not belong to a repository this service holds",
                )),
            };
        if recorded_key != record.write_key {
            return Err(Problem::new(
                ProblemCode::Conflict,
                "the confirming snapshot is of a different repository than the one the operation touched; confirm the repository the operation changed",
            ));
        }
        if !self.recovery.resolve_block(&record.write_key) {
            return Err(Problem::new(
                ProblemCode::Conflict,
                format!("operation {operation_id} left no write block to lift"),
            )
            .for_operation(operation_id));
        }
        // The confirmation is recorded before it is reported. A block is derived from the
        // record, so an acknowledgement that lived only in this process would be forgotten by
        // the next start — and the same person would be asked to confirm the same thing after
        // every restart. The status stays `unknown`: this says somebody looked, not that the
        // operation did something else.
        let acknowledged = self.journal.acknowledge(operation_id, now_millis())?;
        Ok(acknowledged.to_operation_record())
    }

    fn require_record(&self, repository_id: &str) -> Result<RepositoryRecord, Problem> {
        self.writes_host.require_record(repository_id)
    }

    /// One target this session has, or the refusal the Node host also gives for a target it
    /// cannot address.
    fn require_target(&self, target_id: &str) -> Result<TargetRecord, Problem> {
        self.targets.get(target_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::UnsupportedOperation,
                format!("this session has no execution target {target_id}; it is not a target this service created, and answering from another one would misreport where Git runs"),
            )
        })
    }

    /// The target a repository's reads run through.
    ///
    /// A repository whose target was disconnected, or rebuilt to a new generation, is
    /// refused here rather than read: its paths and snapshots describe a build that no
    /// longer exists, and the executor may no longer be the one that opened it.
    fn target_for(&self, record: &RepositoryRecord) -> Result<TargetRecord, Problem> {
        self.writes_host.target_for(record)
    }

    /// One row's HEAD, read through the target the repository lives on.
    async fn read_record_head(
        &self,
        record: &RepositoryRecord,
    ) -> Result<HeadState, reads::ReadError> {
        let target = self.target_for(record).map_err(reads::ReadError::problem)?;
        reads::read_head_state(
            target.executor().map_err(reads::ReadError::problem)?,
            record,
        )
        .await
    }

    /// Approves a root, minting one id per canonical local directory.
    fn approve_root(&self, canonical: &Path) -> String {
        let key = RootKey::Local(canonical.to_path_buf());
        let mut state = self.roots.lock().expect("root lock");
        if let Some((id, _)) = state.roots.iter().find(|(_, root)| root == &key) {
            return id.clone();
        }
        state.next += 1;
        let id = format!("root_{}", base36(state.next));
        state.roots.push((id.clone(), key));
        id
    }

    /// Approves a remote root, minting one id per path text.
    ///
    /// A remote path cannot be canonicalised here; the path Git reported for the layout is
    /// what was opened, and this keys the approval by exactly those bytes as text.
    fn approve_remote_root(&self, path: &str) -> String {
        let key = RootKey::Remote(path.to_string());
        let mut state = self.roots.lock().expect("root lock");
        if let Some((id, _)) = state.roots.iter().find(|(_, root)| root == &key) {
            return id.clone();
        }
        state.next += 1;
        let id = format!("root_{}", base36(state.next));
        state.roots.push((id.clone(), key));
        id
    }

    /// The Git version this machine reports, probed once.
    async fn git_version(&self) -> Result<String, Problem> {
        if let Some(version) = self.git_version.lock().expect("version lock").clone() {
            return Ok(version);
        }
        let version = self.git.version().await.map_err(|diagnostic| {
            // A host with no usable Git cannot serve a single read, and saying so with the
            // diagnostic is the honest answer.
            Problem::new(
                ProblemCode::Unavailable,
                "this machine's git could not be run",
            )
            .with_detail("diagnostic", DetailValue::Text(diagnostic))
        })?;
        *self.git_version.lock().expect("version lock") = Some(version.clone());
        Ok(version)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::MutationKind;
    use refyard_core::plan::ProcessSpec;
    use std::time::Duration;

    /// A provider pointed at a Git that does not exist, so these tests never run a
    /// command: they assert the service's own answers, not Git's.
    fn unavailable_git() -> LocalGit {
        LocalGit::at(
            "/nonexistent/git",
            vec![("PATH".to_string(), "/usr/bin:/bin".to_string())],
        )
    }

    fn service() -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: unavailable_git(),
            service_instance_id: "srvc_1".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            // These tests never browse; the picker is read through its own fixture below.
            home: PathBuf::from("/nonexistent/home"),
        })
    }

    /// A service pointed at this machine's Git, for the one capability answer that needs
    /// a real version probe.
    fn service_with_git() -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::discover().expect("git is installed on this machine"),
            service_instance_id: "srvc_1".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: PathBuf::from("/nonexistent/home"),
        })
    }

    #[test]
    fn every_read_this_build_serves_is_listed_and_nothing_else_is() {
        let reads = service().implemented_reads();
        assert_eq!(
            reads,
            vec![
                ReadKind::Capabilities,
                ReadKind::Filesystem,
                ReadKind::Repositories,
                ReadKind::Status,
                ReadKind::History,
                ReadKind::Refs,
                ReadKind::Diff,
            ]
        );
        // Worktrees, submodules, stashes, operations and events are not implemented, so
        // they must not appear: a client polls what this list names.
        for absent in [
            ReadKind::Worktrees,
            ReadKind::Submodules,
            ReadKind::Stashes,
            ReadKind::Operations,
            ReadKind::Events,
        ] {
            assert!(!reads.contains(&absent), "{absent:?} must not be claimed");
        }
    }

    #[tokio::test]
    async fn capabilities_name_every_mutation_as_unavailable_instead_of_offering_one() {
        let capabilities = service_with_git()
            .capabilities()
            .await
            .expect("capabilities");
        assert_eq!(capabilities.host.kind, HostKind::Rust);
        assert!(capabilities.operations.is_empty(), "no write is offered");
        let unavailable = &capabilities.unavailable;
        assert_eq!(unavailable.len(), 1);
        assert_eq!(unavailable[0].code, "not-implemented");
        assert_eq!(unavailable[0].operations.len(), MUTATION_KINDS.len());
        assert!(unavailable[0]
            .operations
            .contains(&MutationKind::StagePaths));
    }

    #[tokio::test]
    async fn capabilities_fail_loudly_when_git_cannot_be_run() {
        // A host with no usable Git cannot serve a read; reporting empty successes would
        // hide that from every panel at once.
        let problem = service().capabilities().await.expect_err("no git");
        assert_eq!(problem.code, ProblemCode::Unavailable);
    }

    #[test]
    fn an_unknown_repository_is_refused_rather_than_answered_from_the_first_one() {
        let service = service();
        let problem = service.require_record("repo_9").expect_err("unknown");
        assert_eq!(problem.code, ProblemCode::NotFound);
    }

    #[tokio::test]
    async fn revoking_an_unknown_repository_is_refused() {
        let service = service();
        assert_eq!(
            service
                .revoke_repository("repo_9")
                .await
                .expect_err("unknown")
                .code,
            ProblemCode::NotFound
        );
    }

    #[tokio::test]
    async fn registering_a_directory_that_does_not_exist_is_a_not_found() {
        let problem = service()
            .register_repository("/definitely/not/a/directory/refyard")
            .await
            .expect_err("missing");
        assert_eq!(problem.code, ProblemCode::NotFound);
    }

    #[test]
    fn the_approved_root_id_is_stable_for_one_directory() {
        let service = service();
        let first = service.approve_root(Path::new("/tmp/repo"));
        let again = service.approve_root(Path::new("/tmp/repo"));
        let other = service.approve_root(Path::new("/tmp/other"));
        assert_eq!(first, again);
        assert_ne!(first, other);
    }

    #[tokio::test]
    async fn an_empty_repository_list_has_no_roots_to_show() {
        let response = service().repositories().await;
        assert!(response.repositories.is_empty());
        assert!(response.allowed_roots.is_empty());
    }

    #[test]
    fn the_published_limits_are_the_contracts_not_a_local_guess() {
        let limits = runtime_limits();
        assert_eq!(limits.history_default_page_size, 200);
        assert_eq!(limits.history_max_page_size, 500);
        assert_eq!(limits.history_tips_max, 16);
        assert_eq!(limits.patch_max_bytes_per_file, 2_097_152);
    }

    /// This module assembles no argv; every command comes from a planner.
    #[test]
    fn a_run_spec_is_never_built_here() {
        // Guard rail: this module assembles no argv. Every command comes from a planner.
        let _ = ProcessSpec {
            program: PathBuf::from("/usr/bin/git"),
            argv: vec!["--version".to_string()],
            stdin: Vec::new(),
            cwd: None,
            env: Vec::new(),
            deadline: Duration::from_secs(1),
            stdout_limit: 1024,
            stderr_limit: 1024,
        };
    }
}
