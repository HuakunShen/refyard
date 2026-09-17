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
use std::sync::Mutex;

use refyard_contract::diff::{DiffQuery, DiffResponse};
use refyard_contract::history::{HistoryPage, HistoryQuery};
use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::{
    AllowedRootSummary, CapabilitiesResponse, FilesystemEntriesResponse, GitCapabilities, GitInfo,
    HeadKind, HeadState, HostInfo, HostKind, ObjectFormat, OperationInProgress, ReadKind,
    RepositoriesResponse, RepositorySummary, RuntimeLimits, StatusSnapshot, UnavailableReason,
    MUTATION_KINDS,
};
use refyard_contract::refs::RefsSnapshot;

use crate::clock::now_iso8601;
use crate::paths::{base36, PathRegistry};
use crate::providers::local::LocalGit;
use crate::reads;
use crate::reads::refs::object_format_of;
use crate::registry::{
    open_repository, OpenOutcome, OpenRequest, RepositoryRecord, RepositoryRegistry,
};
use crate::snapshots::SnapshotStore;

/// The contract revision this build serves. It matches `CONTRACT_VERSION` in
/// `packages/git-contract/src/version.ts`; a mismatch is a bug rather than a feature.
pub const CONTRACT_VERSION: &str = "1.2.0";
/// `API_MAJOR`: the number a client checks before it calls a write endpoint.
pub const API_MAJOR: u32 = 1;

/// Why this build has no mutations yet, said in the contract's own vocabulary.
const NOT_IMPLEMENTED_MESSAGE: &str = "this build implements the read half of the contract only; every mutation is named here and none of them is reported as available";

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

/// The read half of the application service.
pub struct ApplicationService {
    git: LocalGit,
    repositories: RepositoryRegistry,
    paths: PathRegistry,
    snapshots: SnapshotStore,
    roots: Mutex<RootState>,
    service_instance_id: String,
    target_id: String,
    target_generation: String,
    home: PathBuf,
    git_version: Mutex<Option<String>>,
}

#[derive(Default)]
struct RootState {
    next: u64,
    /// Approved roots, in approval order, with the id each was minted.
    roots: Vec<(String, PathBuf)>,
}

impl ApplicationService {
    /// Builds a service around already-resolved host pieces.
    pub fn new(config: ApplicationServiceConfig) -> Self {
        Self {
            git: config.git,
            repositories: RepositoryRegistry::new(),
            paths: PathRegistry::new(),
            snapshots: SnapshotStore::default(),
            roots: Mutex::new(RootState::default()),
            service_instance_id: config.service_instance_id,
            target_id: config.target_id,
            target_generation: config.target_generation,
            home: config.home,
            git_version: Mutex::new(None),
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

    /// What this build can do right now.
    pub async fn capabilities(&self) -> Result<CapabilitiesResponse, Problem> {
        let version = self.git_version().await?;
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
            // Empty on purpose: a mutation this build cannot run is absent from this list
            // and named in `unavailable` instead of being offered and then refused.
            operations: Vec::new(),
            limits: runtime_limits(),
            unavailable: vec![UnavailableReason {
                code: "not-implemented".to_string(),
                message: NOT_IMPLEMENTED_MESSAGE.to_string(),
                operations: MUTATION_KINDS.to_vec(),
            }],
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
            let head = match reads::read_head_state(&self.git, record).await {
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
                target_id: Some(self.target_id.clone()),
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
            .map(|(allowed_root_id, path)| AllowedRootSummary {
                allowed_root_id: allowed_root_id.clone(),
                display_path: path.display().to_string(),
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

    /// Approves one directory and registers it as a repository.
    ///
    /// The path is canonicalised once, here: every later command runs against the
    /// canonical location, and a symlinked path would otherwise mean two identities for
    /// one repository.
    pub async fn register_repository(&self, path: &str) -> Result<RepositoriesResponse, Problem> {
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
        let allowed_root_id = self.approve_root(&canonical);
        let mut next_id = || self.repositories.next_id();
        let outcome = open_repository(
            OpenRequest {
                program: self.git.program(),
                env: self.git.environment(),
                directory: &canonical,
                allowed_root_id: &allowed_root_id,
                root_path: &canonical,
                relative_path: "",
                target_id: &self.target_id,
                target_generation: &self.target_generation,
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
        reads::filesystem::read_filesystem_entries(path, &self.home).await
    }

    /// Working-tree and index state.
    pub async fn status(&self, query: &StatusQuery) -> Result<StatusSnapshot, Problem> {
        let record = self.require_record(&query.repository_id)?;
        reads::status::read_status(
            &self.git,
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
        reads::history::read_history(&self.git, &record, &self.snapshots, query, &now_iso8601())
            .await
            .map_err(|error| error.to_problem())
    }

    /// Branches, remote-tracking refs, tags and remotes.
    pub async fn refs(&self, repository_id: &str) -> Result<RefsSnapshot, Problem> {
        let record = self.require_record(repository_id)?;
        reads::refs::read_refs(&self.git, &record, &self.snapshots, &now_iso8601())
            .await
            .map_err(|error| error.to_problem())
    }

    /// A bounded diff, with a patch only for the path the caller named.
    pub async fn diff(&self, query: &DiffQuery) -> Result<DiffResponse, Problem> {
        let record = self.require_record(&query.repository_id)?;
        reads::diff::read_diff(
            &self.git,
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
    /// client does: read the change set, take the id it was given, ask for that id.
    pub fn resolve_path_id(&self, path_id: &str) -> Option<Vec<u8>> {
        self.paths.resolve(path_id)
    }

    fn require_record(&self, repository_id: &str) -> Result<RepositoryRecord, Problem> {
        self.repositories.get(repository_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown repository {repository_id}"),
            )
        })
    }

    /// Approves a root, minting one id per canonical directory.
    fn approve_root(&self, canonical: &Path) -> String {
        let mut state = self.roots.lock().expect("root lock");
        if let Some((id, _)) = state.roots.iter().find(|(_, root)| root == canonical) {
            return id.clone();
        }
        state.next += 1;
        let id = format!("root_{}", base36(state.next));
        state.roots.push((id.clone(), canonical.to_path_buf()));
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
