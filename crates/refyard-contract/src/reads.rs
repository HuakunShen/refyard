//! Read responses, their requests, and the shared value vocabulary they use.
//!
//! This is a projection of `packages/git-contract/src/reads.ts`, plus the mutation
//! kinds from `operations.ts` and the mutation targets from `targets.ts` that
//! `OperationRecord` carries. The TypeScript schemas are the specification; this
//! module may not add, rename or re-type a field.
//!
//! The contract has two ways to say "no value", and they are ported differently:
//!
//! - `.nullable()` requires the key and allows `null`, so the Rust field is
//!   `Option<T>` with no `skip_serializing_if` and `None` is written as `null`.
//! - `.optional()` lets the key disappear, so the field carries
//!   `skip_serializing_if = "Option::is_none"`.
//!
//! Response objects deliberately do not use `deny_unknown_fields`: a newer service
//! may add a field, and an older client must still be able to read the answer.
//! Requests do use it, because the contract rejects unknown keys there.
//!
//! One asymmetry follows from serde rather than from the contract: serde's derive
//! also accepts an *absent* key for `Option<T>`, so deserializing is slightly more
//! permissive than the `strictObject` schemas. Serializing — the direction the wire
//! uses — is exact.

use serde::{Deserialize, Serialize};

use crate::problem::Problem;

/* ------------------------------------------------------------------ constants */

/// Hash format of a repository, as reported by Git, never assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectFormat {
    /// SHA-1 object names: 40 hexadecimal characters.
    Sha1,
    /// SHA-256 object names: 64 hexadecimal characters.
    Sha256,
}

/// `unborn` is a repository with no commits yet — not an error, and not a missing
/// branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HeadKind {
    Born,
    Unborn,
}

/// What a repository's HEAD currently is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadState {
    pub kind: HeadKind,
    /// Null while HEAD is detached or the branch is unborn: a branch name exists
    /// only when a branch is checked out.
    pub branch_name: Option<String>,
    /// Null on an unborn branch.
    pub oid: Option<String>,
    pub detached: bool,
}

/// A Git operation left in progress by a stopped command, or by one whose outcome
/// the service could not determine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationInProgress {
    Merge,
    #[serde(rename = "cherry-pick")]
    CherryPick,
    Revert,
    Rebase,
    Bisect,
    #[serde(rename = "apply-mailbox")]
    ApplyMailbox,
    Unknown,
}

/* -------------------------------------------------------------------- session */

/// Liveness only. A 200 here does not prove the listener is this service, so the CLI
/// verifies identity out of band before opening a browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    /// The schema is the literal `true`; the service has no "not alive" answer on
    /// this endpoint, it simply does not respond.
    pub alive: bool,
    pub api_major: u32,
    pub service_instance_id: String,
}

/* -------------------------------------------------------------- capabilities */

/// One read the service implements. Reports only what this build actually serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadKind {
    Capabilities,
    Filesystem,
    Repositories,
    Status,
    History,
    Refs,
    Diff,
    Worktrees,
    Submodules,
    Stashes,
    Operations,
    Events,
}

/// Machine formats probed on this machine, not inferred from a version string. A
/// missing format removes the dependent feature from `operations`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCapabilities {
    pub porcelain_v2_status: bool,
    pub worktree_list_z: bool,
    pub cat_file_batch: bool,
    pub push_porcelain: bool,
    pub fetch_porcelain: bool,
    pub object_formats: Vec<ObjectFormat>,
}

/// The runtime answering this API. Reported, never inferred by a client: the UI must
/// not claim that a node service is native, or the reverse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKind {
    Node,
    Rust,
}

/// Which runtime is answering, and its version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub kind: HostKind,
    pub version: String,
}

/// The Git executable this build found, and what it can do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub executable_display: String,
    pub version: String,
    pub features: GitCapabilities,
}

/// Limits the service enforces on reads, requests, queues and event streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLimits {
    pub history_default_page_size: u64,
    pub history_max_page_size: u64,
    pub patch_max_bytes_per_file: u64,
    pub patch_max_lines_per_file: u64,
    pub object_max_bytes: u64,
    pub logical_cache_max_bytes: u64,
    pub preview_token_ttl_seconds: u64,
    pub readonly_deadline_seconds: u64,
    pub network_deadline_seconds: u64,
    pub hook_deadline_seconds: u64,
    pub queued_operations_per_actor: u64,
    pub concurrent_git_processes: u64,
    pub concurrent_readers_per_repository: u64,
    pub event_ring_max_events: u64,
    pub event_ring_max_bytes: u64,
    pub path_selection_max_entries: u64,
    pub history_tips_max: u64,
    pub commit_message_max_bytes: u64,
    pub branch_name_max_length: u64,
}

/// One mutation this build can perform, with the target kinds it accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationCapability {
    pub kind: MutationKind,
    pub targets: Vec<TargetKind>,
}

/// Why some operations are absent from this build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableReason {
    pub code: String,
    pub message: String,
    pub operations: Vec<MutationKind>,
}

/// What this build can do right now. An operation missing from `operations` is not
/// implemented or not safe on this machine; it is never reported as available and
/// then refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitiesResponse {
    pub api_major: u32,
    pub contract_version: String,
    pub service_instance_id: String,
    pub host: HostInfo,
    pub git: GitInfo,
    pub reads: Vec<ReadKind>,
    pub operations: Vec<OperationCapability>,
    pub limits: RuntimeLimits,
    pub unavailable: Vec<UnavailableReason>,
}

/* -------------------------------------------------------------- repositories */

/// One registered repository, as shown in the repository list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub repository_id: String,
    pub allowed_root_id: String,
    /// Optional so a repository list from a service that predates execution targets
    /// stays readable; absence means the session's default local target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub display_name: String,
    pub display_path: String,
    pub object_format: ObjectFormat,
    pub worktree_ids: Vec<String>,
    pub primary_worktree_id: String,
    pub head: HeadState,
    pub operation_in_progress: Option<OperationInProgress>,
    pub last_fetched_at: Option<String>,
}

/// A root the session was approved for, and the repositories registered under it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowedRootSummary {
    pub allowed_root_id: String,
    pub display_path: String,
    pub repository_ids: Vec<String>,
}

/// Registered repositories and the roots they were approved under. Registration is
/// explicit; nothing is discovered by scanning the disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoriesResponse {
    pub repositories: Vec<RepositorySummary>,
    pub allowed_roots: Vec<AllowedRootSummary>,
}

/// A person-entered local path to browse. The host expands a leading `~/` against
/// its own home directory and returns directories only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemEntriesQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Which execution target's filesystem to list. A host that has only its own
    /// refuses the request rather than listing the wrong machine's directories.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

/// Which kind of thing a directory entry is: something to descend into, or something
/// to open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilesystemEntryKind {
    Directory,
    Repository,
}

/// One directory the authenticated local path selector may navigate to or open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemEntry {
    pub name: String,
    pub path: String,
    pub kind: FilesystemEntryKind,
}

/// Bounded directory entries for the explicit local repository picker; file contents
/// are never returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemEntriesResponse {
    pub path: String,
    /// Null at the top of what this host may browse.
    pub parent_path: Option<String>,
    pub entries: Vec<FilesystemEntry>,
    pub truncated: bool,
}

/// The exact absolute path or `~/` shorthand a person selected for runtime approval.
/// The host checks repository-ness and containment; it never scans for candidates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterRepositoryRequest {
    pub path: String,
    /// Which execution target the path is on. Omitted means the session's default
    /// local target, which is what a service without execution targets assumes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

/// Revokes one registered repository. The access audit is written before the live
/// registry entry disappears.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeRepositoryRequest {
    pub repository_id: String,
}

/* -------------------------------------------------------------------- status */

/// Whether this path can be handed back for execution. `unrepresentable` paths are
/// readable metadata only; operations mentioning them are rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathEncoding {
    Utf8,
    Unrepresentable,
}

/// Submodule flags from porcelain v2's `sub` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleStatus {
    pub commit_changed: bool,
    pub modified: bool,
    pub untracked: bool,
}

/// Which index stage of a conflicted path a copy came from: base, ours, theirs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "u8", try_from = "u8")]
pub enum StageNumber {
    Base = 1,
    Ours = 2,
    Theirs = 3,
}

/// The value an unmerged stage number other than 1, 2 or 3 would have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("an unmerged index stage is 1, 2 or 3, not {0}")]
pub struct InvalidStageNumber(pub u8);

impl From<StageNumber> for u8 {
    fn from(stage: StageNumber) -> Self {
        match stage {
            StageNumber::Base => 1,
            StageNumber::Ours => 2,
            StageNumber::Theirs => 3,
        }
    }
}

impl TryFrom<u8> for StageNumber {
    type Error = InvalidStageNumber;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(StageNumber::Base),
            2 => Ok(StageNumber::Ours),
            3 => Ok(StageNumber::Theirs),
            other => Err(InvalidStageNumber(other)),
        }
    }
}

/// One index stage of a conflicted path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmergedStage {
    pub stage: StageNumber,
    pub mode: String,
    pub oid: String,
}

/// How a changed path relates to the index and to its original name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusEntryKind {
    Ordinary,
    Renamed,
    Copied,
    Unmerged,
    Untracked,
    Ignored,
}

/// The mode triple porcelain v2 reports for a changed path. Any of the three may be
/// null when that side does not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntryModes {
    pub head: Option<String>,
    pub index: Option<String>,
    pub worktree: Option<String>,
}

/// One changed path. Status characters are Git's own (`.`, `M`, `A`, `D`, `R`, `U`,
/// …); the UI decides presentation, never re-parses them into meaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path_id: String,
    pub display_path: String,
    pub path_encoding: PathEncoding,
    pub kind: StatusEntryKind,
    pub index_status: String,
    pub worktree_status: String,
    /// Set only for a rename or copy, and only while the path is representable.
    pub original_path_id: Option<String>,
    pub original_display_path: Option<String>,
    pub head_oid: Option<String>,
    pub index_oid: Option<String>,
    pub modes: Option<StatusEntryModes>,
    pub submodule: Option<SubmoduleStatus>,
    /// The index stages of a conflicted path; null when the path is not unmerged.
    pub stages: Option<Vec<UnmergedStage>>,
}

/// The tracked branch's local remote-tracking ref and how far it has diverged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusUpstream {
    pub name: String,
    pub ahead: u64,
    pub behind: u64,
}

/// Working-tree and index state at a point in time. `ahead`/`behind` describe local
/// remote-tracking refs only — they are not the server's state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub snapshot_id: String,
    pub repository_id: String,
    pub worktree_id: String,
    pub read_at: String,
    pub head: HeadState,
    /// Null when no upstream is configured.
    pub upstream: Option<StatusUpstream>,
    pub operation_in_progress: Option<OperationInProgress>,
    pub entries: Vec<StatusEntry>,
    pub entry_count: u64,
    pub truncated: bool,
}

/* ------------------------------------------------------------------ previews */

/// Ask for content fingerprints of selected paths before a stage or discard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewsRequest {
    pub repository_id: String,
    pub worktree_id: String,
    pub path_ids: Vec<String>,
}

/// What kind of content a fingerprint was taken over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Text,
    Binary,
    Unrepresentable,
}

/// The only fingerprint algorithm this contract version issues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FingerprintAlgorithm {
    #[serde(rename = "sha256")]
    Sha256,
}

/// A content fingerprint bound to one path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPreviewToken {
    pub path_id: String,
    pub preview_token: String,
    /// Null when the size is not knowable, for example for a path that cannot be
    /// represented for execution.
    pub size_bytes: Option<u64>,
    pub content_kind: ContentKind,
    pub fingerprint_algorithm: FingerprintAlgorithm,
    pub expires_at: String,
}

/// Content fingerprints bound to paths. The tokens expire, and a token whose file
/// changed is stale rather than silently still valid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewsResponse {
    pub repository_id: String,
    pub worktree_id: String,
    pub snapshot_id: String,
    pub read_at: String,
    pub tokens: Vec<PathPreviewToken>,
}

/* ------------------------------------------------------------- mutations */

/// Every mutation this contract version can submit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MutationKind {
    InitRepository,
    CloneRepository,
    StagePaths,
    UnstagePaths,
    DiscardTrackedPaths,
    Commit,
    AmendCommit,
    CreateBranch,
    SwitchBranch,
    RenameBranch,
    DeleteBranch,
    SetBranchUpstream,
    AddRemote,
    UpdateRemote,
    RemoveRemote,
    Fetch,
    Push,
    Pull,
    CreateStash,
    ApplyStash,
    PopStash,
    DropStash,
    CreateTag,
    DeleteTag,
    PushTag,
    CreateWorktree,
    RemoveWorktree,
    LockWorktree,
    UnlockWorktree,
    AddSubmodule,
    UpdateSubmodule,
    SyncSubmodule,
    Merge,
    ContinueMerge,
    AbortMerge,
    RevertCommit,
}

/// Which kind of resource a mutation addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    Workspace,
    Repository,
    Worktree,
}

/// Every mutation kind the contract declares, in the order the published list uses.
///
/// The projection of `MUTATION_KINDS`/`OPERATION_TARGET_LIST` in
/// `packages/git-contract/src/operations.ts`. A capability answer that has to name what
/// this build does *not* implement needs the complete list, and deriving it from the
/// contract rather than from a second hand-written table is what keeps the two from
/// disagreeing.
pub const MUTATION_KINDS: [MutationKind; 36] = [
    MutationKind::InitRepository,
    MutationKind::CloneRepository,
    MutationKind::StagePaths,
    MutationKind::UnstagePaths,
    MutationKind::DiscardTrackedPaths,
    MutationKind::Commit,
    MutationKind::AmendCommit,
    MutationKind::CreateBranch,
    MutationKind::SwitchBranch,
    MutationKind::RenameBranch,
    MutationKind::DeleteBranch,
    MutationKind::SetBranchUpstream,
    MutationKind::AddRemote,
    MutationKind::UpdateRemote,
    MutationKind::RemoveRemote,
    MutationKind::Fetch,
    MutationKind::Push,
    MutationKind::Pull,
    MutationKind::CreateStash,
    MutationKind::ApplyStash,
    MutationKind::PopStash,
    MutationKind::DropStash,
    MutationKind::CreateTag,
    MutationKind::DeleteTag,
    MutationKind::PushTag,
    MutationKind::CreateWorktree,
    MutationKind::RemoveWorktree,
    MutationKind::LockWorktree,
    MutationKind::UnlockWorktree,
    MutationKind::AddSubmodule,
    MutationKind::UpdateSubmodule,
    MutationKind::SyncSubmodule,
    MutationKind::Merge,
    MutationKind::ContinueMerge,
    MutationKind::AbortMerge,
    MutationKind::RevertCommit,
];

/// What a mutation is allowed to touch, discriminated by `kind`. An operation
/// accepts only the kinds it declares.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MutationTarget {
    /// A location inside an approved root, for operations that create repositories.
    Workspace {
        allowed_root_id: String,
        relative_destination: String,
    },
    /// A repository-level change: refs, remotes, tags, worktrees, submodule wiring.
    Repository {
        repository_id: String,
        expected_snapshot_id: String,
    },
    /// A worktree-level change: index, working files, HEAD, merges, stashes.
    Worktree {
        repository_id: String,
        worktree_id: String,
        expected_snapshot_id: String,
    },
}

/* ---------------------------------------------------------------- operations */

/// Terminal states are `succeeded`, `failed`, `needsAttention`, `unknown` and
/// `cancelled`. `unknown` means Git may have changed things and the service will not
/// guess or retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationStatus {
    Accepted,
    Running,
    Succeeded,
    Failed,
    NeedsAttention,
    Unknown,
    Cancelled,
}

/// What a finished operation reports: re-read facts and the invalidation the UI must
/// act on, not Git's stdout text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub summary: String,
    pub changed_refs: Vec<String>,
    /// Null when the operation cannot know how many paths it touched.
    pub changed_paths: Option<u64>,
    pub snapshot_invalidated: bool,
    pub new_head_oid: Option<String>,
}

/// A journal entry as the client sees it. The journal itself stores metadata and
/// payload digests, never diffs, messages, tokens or credentials.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub operation_id: String,
    pub client_request_id: String,
    pub kind: MutationKind,
    pub target: MutationTarget,
    pub status: OperationStatus,
    pub sequence: u64,
    pub accepted_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Present only once the operation reached a terminal state that has one.
    pub result: Option<OperationResult>,
    /// Present only on failure or on an outcome that needs a human decision.
    pub problem: Option<Problem>,
}

/// Recent operations for the requesting actor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationsListResponse {
    pub operations: Vec<OperationRecord>,
    /// Capped by the idempotency record limit and retention, restated here for the
    /// client.
    pub truncated: bool,
}

/// Cancel an operation that has not started. A running mutation is not cancellable
/// in this version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelOperationRequest {
    pub operation_id: String,
}

/* -------------------------------------------------------------------- events */

/// SSE payload. Events are hints that invalidate cached reads; they are never the
/// only source of truth.
///
/// `Operation` holds the whole record unboxed even though it dwarfs the other
/// variants: this is a shape on the wire, not a hot collection, and `Box` would be a
/// Rust-only indirection that every construction site had to spell out.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EventPayload {
    Operation {
        operation: OperationRecord,
    },
    RepositoryChanged {
        repository_id: String,
        worktree_ids: Vec<String>,
        snapshot_invalidated: bool,
    },
    /// The stream resumed past a point the ring no longer holds, so the client must
    /// re-read what it missed instead of assuming nothing happened.
    EventGap {
        from_sequence: u64,
        to_sequence: u64,
    },
    Session {
        expires_at: String,
    },
}

/// One event with its monotonic sequence number, so a client can detect a gap and
/// re-read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub sequence: u64,
    pub emitted_at: String,
    pub payload: EventPayload,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A 40-character SHA-1-shaped object name.
    const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
    /// A second 40-character SHA-1-shaped object name.
    const OID_B: &str = "fedcba9876543210fedcba9876543210fedcba98";

    /// The values `RUNTIME_LIMITS` publishes today, spelled out so a field renamed
    /// on one side and not the other fails here rather than in the browser.
    fn published_limits() -> RuntimeLimits {
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

    #[test]
    fn status_snapshot_serializes_the_shape_the_contract_publishes() {
        let snapshot = StatusSnapshot {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            worktree_id: "wt_1".to_string(),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            head: HeadState {
                kind: HeadKind::Born,
                branch_name: Some("main".to_string()),
                oid: Some(OID_A.to_string()),
                detached: false,
            },
            upstream: Some(StatusUpstream {
                name: "origin/main".to_string(),
                ahead: 2,
                behind: 1,
            }),
            operation_in_progress: None,
            entries: vec![StatusEntry {
                path_id: "path_1".to_string(),
                display_path: "src/lib.rs".to_string(),
                path_encoding: PathEncoding::Utf8,
                kind: StatusEntryKind::Unmerged,
                index_status: "U".to_string(),
                worktree_status: "U".to_string(),
                original_path_id: None,
                original_display_path: None,
                head_oid: Some(OID_A.to_string()),
                index_oid: None,
                modes: Some(StatusEntryModes {
                    head: Some("100644".to_string()),
                    index: None,
                    worktree: Some("100644".to_string()),
                }),
                submodule: Some(SubmoduleStatus {
                    commit_changed: true,
                    modified: false,
                    untracked: false,
                }),
                stages: Some(vec![UnmergedStage {
                    stage: StageNumber::Theirs,
                    mode: "100644".to_string(),
                    oid: OID_B.to_string(),
                }]),
            }],
            entry_count: 1,
            truncated: false,
        };

        assert_eq!(
            serde_json::to_value(&snapshot).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "head": {
                    "kind": "born",
                    "branchName": "main",
                    "oid": OID_A,
                    "detached": false,
                },
                "upstream": { "name": "origin/main", "ahead": 2, "behind": 1 },
                "operationInProgress": null,
                "entries": [{
                    "pathId": "path_1",
                    "displayPath": "src/lib.rs",
                    "pathEncoding": "utf8",
                    "kind": "unmerged",
                    "indexStatus": "U",
                    "worktreeStatus": "U",
                    "originalPathId": null,
                    "originalDisplayPath": null,
                    "headOid": OID_A,
                    "indexOid": null,
                    "modes": { "head": "100644", "index": null, "worktree": "100644" },
                    "submodule": { "commitChanged": true, "modified": false, "untracked": false },
                    "stages": [{ "stage": 3, "mode": "100644", "oid": OID_B }],
                }],
                "entryCount": 1,
                "truncated": false,
            })
        );
    }

    #[test]
    fn keeps_nullable_keys_present_and_drops_absent_optionals() {
        // `head.branchName`, `lastFetchedAt` and `operationInProgress` are
        // `.nullable()`: sending `null` is the only correct spelling. `targetId` is
        // `.optional()`: the key must not appear at all.
        let repository = RepositorySummary {
            repository_id: "repo_1".to_string(),
            allowed_root_id: "root_1".to_string(),
            target_id: None,
            display_name: "refyard".to_string(),
            display_path: "~/code/refyard".to_string(),
            object_format: ObjectFormat::Sha256,
            worktree_ids: vec!["wt_1".to_string()],
            primary_worktree_id: "wt_1".to_string(),
            head: HeadState {
                kind: HeadKind::Unborn,
                branch_name: None,
                oid: None,
                detached: false,
            },
            operation_in_progress: None,
            last_fetched_at: None,
        };

        assert_eq!(
            serde_json::to_value(&repository).expect("serializes"),
            json!({
                "repositoryId": "repo_1",
                "allowedRootId": "root_1",
                "displayName": "refyard",
                "displayPath": "~/code/refyard",
                "objectFormat": "sha256",
                "worktreeIds": ["wt_1"],
                "primaryWorktreeId": "wt_1",
                "head": { "kind": "unborn", "branchName": null, "oid": null, "detached": false },
                "operationInProgress": null,
                "lastFetchedAt": null,
            })
        );
    }

    #[test]
    fn capabilities_response_serializes_the_shape_the_contract_publishes() {
        let capabilities = CapabilitiesResponse {
            api_major: 1,
            contract_version: "1.2.0".to_string(),
            service_instance_id: "srvc_1".to_string(),
            host: HostInfo {
                kind: HostKind::Rust,
                version: "0.1.0".to_string(),
            },
            git: GitInfo {
                executable_display: "/usr/bin/git".to_string(),
                version: "2.51.0".to_string(),
                features: GitCapabilities {
                    porcelain_v2_status: true,
                    worktree_list_z: true,
                    cat_file_batch: true,
                    push_porcelain: false,
                    fetch_porcelain: false,
                    object_formats: vec![ObjectFormat::Sha1, ObjectFormat::Sha256],
                },
            },
            reads: vec![
                ReadKind::Capabilities,
                ReadKind::Repositories,
                ReadKind::Status,
                ReadKind::History,
                ReadKind::Refs,
                ReadKind::Diff,
                ReadKind::Operations,
                ReadKind::Events,
            ],
            operations: vec![
                OperationCapability {
                    kind: MutationKind::StagePaths,
                    targets: vec![TargetKind::Worktree],
                },
                OperationCapability {
                    kind: MutationKind::CreateBranch,
                    targets: vec![TargetKind::Repository],
                },
            ],
            limits: published_limits(),
            unavailable: vec![UnavailableReason {
                code: "git-push-porcelain".to_string(),
                message: "this git build has no --porcelain push".to_string(),
                operations: vec![MutationKind::Push, MutationKind::PushTag],
            }],
        };

        assert_eq!(
            serde_json::to_value(&capabilities).expect("serializes"),
            json!({
                "apiMajor": 1,
                "contractVersion": "1.2.0",
                "serviceInstanceId": "srvc_1",
                "host": { "kind": "rust", "version": "0.1.0" },
                "git": {
                    "executableDisplay": "/usr/bin/git",
                    "version": "2.51.0",
                    "features": {
                        "porcelainV2Status": true,
                        "worktreeListZ": true,
                        "catFileBatch": true,
                        "pushPorcelain": false,
                        "fetchPorcelain": false,
                        "objectFormats": ["sha1", "sha256"],
                    },
                },
                "reads": [
                    "capabilities",
                    "repositories",
                    "status",
                    "history",
                    "refs",
                    "diff",
                    "operations",
                    "events",
                ],
                "operations": [
                    { "kind": "stagePaths", "targets": ["worktree"] },
                    { "kind": "createBranch", "targets": ["repository"] },
                ],
                "limits": {
                    "historyDefaultPageSize": 200,
                    "historyMaxPageSize": 500,
                    "patchMaxBytesPerFile": 2_097_152,
                    "patchMaxLinesPerFile": 20_000,
                    "objectMaxBytes": 16_777_216,
                    "logicalCacheMaxBytes": 67_108_864,
                    "previewTokenTtlSeconds": 300,
                    "readonlyDeadlineSeconds": 15,
                    "networkDeadlineSeconds": 600,
                    "hookDeadlineSeconds": 120,
                    "queuedOperationsPerActor": 32,
                    "concurrentGitProcesses": 4,
                    "concurrentReadersPerRepository": 2,
                    "eventRingMaxEvents": 1_024,
                    "eventRingMaxBytes": 1_048_576,
                    "pathSelectionMaxEntries": 1_000,
                    "historyTipsMax": 16,
                    "commitMessageMaxBytes": 1_048_576,
                    "branchNameMaxLength": 255,
                },
                "unavailable": [{
                    "code": "git-push-porcelain",
                    "message": "this git build has no --porcelain push",
                    "operations": ["push", "pushTag"],
                }],
            })
        );
    }

    #[test]
    fn operation_record_serializes_the_shape_the_contract_publishes() {
        let record = OperationRecord {
            operation_id: "op_1".to_string(),
            client_request_id: "req-1".to_string(),
            kind: MutationKind::StagePaths,
            target: MutationTarget::Worktree {
                repository_id: "repo_1".to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Succeeded,
            sequence: 7,
            accepted_at: "2026-09-18T10:00:00.000Z".to_string(),
            started_at: Some("2026-09-18T10:00:00.100Z".to_string()),
            finished_at: Some("2026-09-18T10:00:01.000Z".to_string()),
            result: Some(OperationResult {
                summary: "staged 2 paths".to_string(),
                changed_refs: vec!["refs/heads/main".to_string()],
                changed_paths: Some(2),
                snapshot_invalidated: true,
                new_head_oid: None,
            }),
            problem: None,
        };

        assert_eq!(
            serde_json::to_value(&record).expect("serializes"),
            json!({
                "operationId": "op_1",
                "clientRequestId": "req-1",
                "kind": "stagePaths",
                "target": {
                    "kind": "worktree",
                    "repositoryId": "repo_1",
                    "worktreeId": "wt_1",
                    "expectedSnapshotId": "snap_1",
                },
                "status": "succeeded",
                "sequence": 7,
                "acceptedAt": "2026-09-18T10:00:00.000Z",
                "startedAt": "2026-09-18T10:00:00.100Z",
                "finishedAt": "2026-09-18T10:00:01.000Z",
                "result": {
                    "summary": "staged 2 paths",
                    "changedRefs": ["refs/heads/main"],
                    "changedPaths": 2,
                    "snapshotInvalidated": true,
                    "newHeadOid": null,
                },
                "problem": null,
            })
        );
    }

    #[test]
    fn an_event_envelope_carries_the_tagged_payload_the_contract_publishes() {
        let envelope = EventEnvelope {
            sequence: 12,
            emitted_at: "2026-09-18T10:00:02.000Z".to_string(),
            payload: EventPayload::RepositoryChanged {
                repository_id: "repo_1".to_string(),
                worktree_ids: vec!["wt_1".to_string()],
                snapshot_invalidated: true,
            },
        };

        assert_eq!(
            serde_json::to_value(&envelope).expect("serializes"),
            json!({
                "sequence": 12,
                "emittedAt": "2026-09-18T10:00:02.000Z",
                "payload": {
                    "kind": "repositoryChanged",
                    "repositoryId": "repo_1",
                    "worktreeIds": ["wt_1"],
                    "snapshotInvalidated": true,
                },
            })
        );

        // The unit payloads have no fields beyond the discriminant.
        assert_eq!(
            serde_json::to_value(EventPayload::Session {
                expires_at: "2026-09-18T10:05:00.000Z".to_string(),
            })
            .expect("serializes"),
            json!({ "kind": "session", "expiresAt": "2026-09-18T10:05:00.000Z" })
        );
    }

    #[test]
    fn a_strict_request_refuses_a_key_the_contract_does_not_have() {
        // A typo in a registration path must be an error, not a silently ignored
        // field that registers something else.
        let parsed: Result<RegisterRepositoryRequest, _> =
            serde_json::from_value(json!({ "path": "/tmp/repo", "targtId": "tgt_1" }));
        assert!(
            parsed.is_err(),
            "an unknown request key must not deserialize"
        );

        let parsed: RegisterRepositoryRequest =
            serde_json::from_value(json!({ "path": "/tmp/repo" })).expect("path is enough");
        assert_eq!(parsed.target_id, None);
    }

    #[test]
    fn refuses_a_mutation_kind_that_is_not_in_the_contract() {
        let parsed: Result<MutationKind, _> = serde_json::from_str("\"teleport\"");
        assert!(parsed.is_err(), "an unknown mutation kind must not parse");
    }

    #[test]
    fn the_mutation_list_names_every_kind_the_contract_declares() {
        // A capability answer says "none of these is available", so a kind missing from
        // this list would be silently advertised as supported by omission.
        assert_eq!(MUTATION_KINDS.len(), 36);
        let mut names: Vec<String> = MUTATION_KINDS
            .iter()
            .map(|kind| serde_json::to_string(kind).expect("serializes"))
            .collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), MUTATION_KINDS.len(), "no kind is repeated");
        assert!(names.contains(&"\"stagePaths\"".to_string()));
        assert!(names.contains(&"\"abortMerge\"".to_string()));
    }

    #[test]
    fn refuses_an_index_stage_that_is_not_one_of_the_three() {
        // Stage 0 would mean "no conflict", and a fourth stage does not exist; both
        // must fail rather than be read as a stage.
        let parsed: Result<UnmergedStage, _> =
            serde_json::from_value(json!({ "stage": 4, "mode": "100644", "oid": OID_A }));
        assert!(parsed.is_err(), "an unknown index stage must not parse");

        let parsed: UnmergedStage =
            serde_json::from_value(json!({ "stage": 1, "mode": "100644", "oid": OID_A }))
                .expect("stage 1 is the base");
        assert_eq!(parsed.stage, StageNumber::Base);
    }
}
