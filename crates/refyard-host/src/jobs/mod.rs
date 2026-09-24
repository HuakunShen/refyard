//! The write path's substrate: a request that is journalled before it runs, a bound
//! queue, and an effect seam.
//!
//! This module is where a mutation *becomes* an operation. It owns the order the design
//! requires — accepted on disk, then running, then a terminal state — and it owns the two
//! rules that keep a retry from becoming a second write: an operation is identified by its
//! payload digest, and a repository an unresolved operation touched accepts nothing until
//! someone confirms its state.
//!
//! It does not own any Git semantics. An effect is a trait this module defines and a later
//! slice implements; the engine only journals what an effect answered, including the
//! answer "nobody knows", and it never retries one. This build registers **no** effects, so
//! `implemented_kinds` is empty and every submission is refused with `UnsupportedOperation`
//! before anything is journalled — which is what `capabilities().operations` being empty
//! promises.

pub mod journal;
pub mod queue;
pub mod recovery;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{
    EventPayload, MutationKind, MutationTarget, OperationRecord, OperationStatus,
    OperationsListResponse,
};
use refyard_core::preconditions::{check_preconditions, PreconditionContext, RestartWriteBlock};
use serde::{Deserialize, Serialize};

use crate::clock::now_millis;
use crate::events::EventSink;
use crate::jobs::journal::{canonical_payload_digest, EffectOutcome, Journal, JournalRecord};
use crate::jobs::queue::{EnqueueRefusal, Queue, QueueLimits, QueueMode, QueueTicket};
use crate::jobs::recovery::{Recovery, WriteBlock};
use crate::paths::base36;

/// The value the operation-id counter starts from, given the journal's records.
///
/// Ids are `op_<base36 counter>`, so the seed is the largest suffix any durable record
/// already uses. An id in another shape is skipped rather than guessed at; the counter
/// only has to avoid repeating what is demonstrably there.
fn next_operation_seed(records: &[JournalRecord]) -> u64 {
    records
        .iter()
        .filter_map(|record| record.operation_id.strip_prefix("op_"))
        .filter_map(|suffix| u64::from_str_radix(suffix, 36).ok())
        .max()
        .unwrap_or(0)
}

/// The merge modes the contract's merge operation carries, as the wire spells them.
///
/// The spellings are pinned per variant: a derived case conversion turns `NoFF` into
/// `no-f-f`, which no client sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MergeMode {
    /// Git's own decision: fast-forward when the history allows it.
    #[serde(rename = "default")]
    Default,
    /// `--no-ff`: the merge is a merge commit even when a fast-forward is possible.
    #[serde(rename = "no-ff")]
    NoFF,
}

/// The reset modes the contract offers — the two that cannot lose working-tree content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    /// The branch moves; the index stays exactly as it is.
    Soft,
    /// The branch and the index move to the target; staged work becomes unstaged.
    Mixed,
}

/// The remote and branch an upstream names, as the contract's `setUpstream` carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpstreamSpec {
    pub remote_name: String,
    pub branch_name: String,
}

/// The message of an annotated tag, as the contract's `annotation` object carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagAnnotation {
    pub message: String,
}

/// A stash entry: the object name it resolved to, plus the reflog locator it was listed
/// under. `stash@{n}` is a moving label — anyone's `git stash` shifts every position
/// after it — so every write re-resolves the locator and compares it to `oid` before
/// touching anything. A mismatch is a stale request, never a different entry to act on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StashRef {
    pub oid: String,
    pub locator: String,
}

/// The mutation the write path can carry, as the host understands it.
///
/// A projection of the contract's closed union: only the operations this slice can reason
/// about are here, unknown fields are refused, and an operation kind that is absent fails
/// to deserialize rather than becoming a request the host half-understands. The variants
/// this build cannot run are added by the task that implements them; naming one today is
/// an `InvalidRequest`, which is the honest answer to a request this host cannot parse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MutationOperation {
    StagePaths {
        path_ids: Vec<String>,
        preview_tokens: Vec<String>,
    },
    UnstagePaths {
        path_ids: Vec<String>,
    },
    Commit {
        message: String,
    },
    AmendCommit {
        message: Option<String>,
        confirmed: bool,
    },
    CreateBranch {
        branch_name: String,
        start_oid: Option<String>,
        switch_to_it: bool,
    },
    SwitchBranch {
        branch_name: String,
    },
    RenameBranch {
        branch_name: String,
        new_name: String,
    },
    DeleteBranch {
        branch_name: String,
        confirmed: bool,
    },
    SetBranchUpstream {
        branch_name: String,
        upstream: Option<UpstreamSpec>,
    },
    AddRemote {
        remote_name: String,
        fetch_url: String,
        push_url: Option<String>,
    },
    UpdateRemote {
        remote_name: String,
        new_name: Option<String>,
        fetch_url: Option<String>,
        push_url: Option<String>,
    },
    RemoveRemote {
        remote_name: String,
        confirmed: bool,
    },
    CreateStash {
        message: Option<String>,
        include_untracked: bool,
        keep_index: bool,
    },
    ApplyStash {
        stash: StashRef,
        restore_index: bool,
    },
    PopStash {
        stash: StashRef,
        restore_index: bool,
        confirmed: bool,
    },
    DropStash {
        stash: StashRef,
        confirmed: bool,
    },
    CreateTag {
        tag_name: String,
        target_oid: Option<String>,
        annotation: Option<TagAnnotation>,
    },
    DeleteTag {
        tag_name: String,
        confirmed: bool,
    },
    Merge {
        source_oid: String,
        mode: MergeMode,
        message: Option<String>,
    },
    ContinueMerge {
        message: Option<String>,
    },
    AbortMerge {
        confirmed: bool,
    },
    RevertCommit {
        oid: String,
    },
    ResetBranch {
        oid: String,
        mode: ResetMode,
    },
    CherryPick {
        oid: String,
    },
    ContinueCherryPick {},
    AbortCherryPick {
        confirmed: bool,
    },
    Rebase {
        upstream_oid: String,
    },
    ContinueRebase {},
    AbortRebase {
        confirmed: bool,
    },
    DropCommit {
        oid: String,
        confirmed: bool,
    },
    SquashCommit {
        message: Option<String>,
    },
}

impl MutationOperation {
    pub fn kind(&self) -> MutationKind {
        match self {
            Self::StagePaths { .. } => MutationKind::StagePaths,
            Self::UnstagePaths { .. } => MutationKind::UnstagePaths,
            Self::Commit { .. } => MutationKind::Commit,
            Self::AmendCommit { .. } => MutationKind::AmendCommit,
            Self::CreateBranch { .. } => MutationKind::CreateBranch,
            Self::SwitchBranch { .. } => MutationKind::SwitchBranch,
            Self::RenameBranch { .. } => MutationKind::RenameBranch,
            Self::DeleteBranch { .. } => MutationKind::DeleteBranch,
            Self::SetBranchUpstream { .. } => MutationKind::SetBranchUpstream,
            Self::AddRemote { .. } => MutationKind::AddRemote,
            Self::UpdateRemote { .. } => MutationKind::UpdateRemote,
            Self::RemoveRemote { .. } => MutationKind::RemoveRemote,
            Self::CreateStash { .. } => MutationKind::CreateStash,
            Self::ApplyStash { .. } => MutationKind::ApplyStash,
            Self::PopStash { .. } => MutationKind::PopStash,
            Self::DropStash { .. } => MutationKind::DropStash,
            Self::CreateTag { .. } => MutationKind::CreateTag,
            Self::DeleteTag { .. } => MutationKind::DeleteTag,
            Self::Merge { .. } => MutationKind::Merge,
            Self::ContinueMerge { .. } => MutationKind::ContinueMerge,
            Self::AbortMerge { .. } => MutationKind::AbortMerge,
            Self::RevertCommit { .. } => MutationKind::RevertCommit,
            Self::ResetBranch { .. } => MutationKind::ResetBranch,
            Self::CherryPick { .. } => MutationKind::CherryPick,
            Self::ContinueCherryPick { .. } => MutationKind::ContinueCherryPick,
            Self::AbortCherryPick { .. } => MutationKind::AbortCherryPick,
            Self::Rebase { .. } => MutationKind::Rebase,
            Self::ContinueRebase { .. } => MutationKind::ContinueRebase,
            Self::AbortRebase { .. } => MutationKind::AbortRebase,
            Self::DropCommit { .. } => MutationKind::DropCommit,
            Self::SquashCommit { .. } => MutationKind::SquashCommit,
        }
    }

    /// The paths this operation selected, for a precondition check that needs them.
    pub fn path_ids(&self) -> Vec<String> {
        match self {
            Self::StagePaths { path_ids, .. } | Self::UnstagePaths { path_ids } => path_ids.clone(),
            Self::Commit { .. }
            | Self::CreateBranch { .. }
            | Self::SwitchBranch { .. }
            | Self::CreateTag { .. }
            | Self::Merge { .. }
            | Self::RevertCommit { .. }
            | Self::ResetBranch { .. }
            | Self::CherryPick { .. }
            | Self::RenameBranch { .. }
            | Self::DeleteBranch { .. }
            | Self::SetBranchUpstream { .. }
            | Self::DeleteTag { .. }
            | Self::ContinueMerge { .. }
            | Self::AbortMerge { .. }
            | Self::ContinueCherryPick { .. }
            | Self::AbortCherryPick { .. }
            | Self::Rebase { .. }
            | Self::ContinueRebase { .. }
            | Self::AbortRebase { .. }
            | Self::DropCommit { .. }
            | Self::SquashCommit { .. }
            | Self::AmendCommit { .. }
            | Self::CreateStash { .. }
            | Self::ApplyStash { .. }
            | Self::PopStash { .. }
            | Self::DropStash { .. }
            | Self::AddRemote { .. }
            | Self::UpdateRemote { .. }
            | Self::RemoveRemote { .. } => Vec::new(),
        }
    }

    /// The preview tokens this operation presented, in the order of [`Self::path_ids`].
    pub fn preview_tokens(&self) -> Vec<String> {
        match self {
            Self::StagePaths { preview_tokens, .. } => preview_tokens.clone(),
            _ => Vec::new(),
        }
    }
}

/// One mutation request: an idempotency key, the resource it addresses, and the operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationRequest {
    pub client_request_id: String,
    pub target: MutationTarget,
    pub operation: MutationOperation,
}

impl MutationRequest {
    /// The repository this request addresses, when it addresses one.
    pub fn repository_id(&self) -> Option<&str> {
        match &self.target {
            MutationTarget::Repository { repository_id, .. }
            | MutationTarget::Worktree { repository_id, .. } => Some(repository_id),
            MutationTarget::Workspace { .. } => None,
        }
    }

    /// The worktree this request addresses, when it addresses one.
    pub fn worktree_id(&self) -> Option<&str> {
        match &self.target {
            MutationTarget::Worktree { worktree_id, .. } => Some(worktree_id),
            _ => None,
        }
    }
}

/// What one effect is given when it runs.
#[derive(Debug)]
pub struct EffectRequest<'a> {
    pub operation_id: &'a str,
    pub actor: &'a str,
    /// The key the operation serialises under. An effect that shells out uses it to read
    /// the state it is about to change.
    pub write_key: &'a str,
    pub request: &'a MutationRequest,
}

/// One implemented mutation.
///
/// The future is boxed by hand rather than by a dependency: the workspace has no
/// `async-trait`, and one `Pin<Box<…>>` per call is not worth adding one.
pub trait MutationEffect: Send + Sync {
    fn kind(&self) -> MutationKind;
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>>;
}

/// The facts the write path cannot read on its own.
///
/// The journal, the queue and the block live here; whether the repository moved, whether an
/// operation is in progress and whether the previewed content is still the same is the
/// service's to answer, because it needs the reads.
pub trait PreconditionSource: Send + Sync {
    /// The key this request serialises and blocks under.
    ///
    /// For a repository or worktree target it is the repository's own stable identity
    /// (its target and common Git directory), not the id this process minted: a block has
    /// to be findable again after a restart, when the minted id is gone.
    fn write_key(&self, request: &MutationRequest) -> Result<String, Problem>;

    fn context<'a>(
        &'a self,
        request: &'a MutationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<PreconditionContext, Problem>> + Send + 'a>>;
}

/// The answer to one submission.
#[cfg(test)]
mod seed_tests {
    use super::*;

    fn record_with_id(operation_id: &str) -> JournalRecord {
        JournalRecord {
            operation_id: operation_id.to_string(),
            client_request_id: format!("crid-{operation_id}"),
            actor: "owner".to_string(),
            kind: MutationKind::Commit,
            target: MutationTarget::Worktree {
                repository_id: "repo_1".to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Accepted,
            sequence: 1,
            accepted_at_ms: 1,
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: "digest".to_string(),
            write_key: "repo_1".to_string(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        }
    }

    #[test]
    fn the_seed_is_one_above_the_largest_durable_id() {
        assert_eq!(
            next_operation_seed(&[
                record_with_id("op_1"),
                record_with_id("op_2"),
                record_with_id("op_1a"),
            ]),
            u64::from_str_radix("1a", 36).unwrap()
        );
    }

    #[test]
    fn an_empty_or_unparseable_journal_seeds_at_zero() {
        assert_eq!(next_operation_seed(&[]), 0);
        // A foreign id is skipped, not parsed as zero: the counter only avoids what is
        // demonstrably present.
        assert_eq!(next_operation_seed(&[record_with_id("operation-9")]), 0);
    }

    #[test]
    fn a_merge_payload_round_trips_with_the_wire_spelling_the_contract_publishes() {
        // Prevents: a payload the browser could send and the host could not read (or the
        // reverse), because the projection's field or mode spelling drifted from the
        // contract's `merge` operation.
        let json = serde_json::json!({
            "kind": "merge",
            "sourceOid": "0123456789abcdef0123456789abcdef01234567",
            "mode": "no-ff",
            "message": null
        });
        let parsed: MutationOperation =
            serde_json::from_value(json.clone()).expect("the contract's merge payload parses");
        assert_eq!(
            parsed,
            MutationOperation::Merge {
                source_oid: "0123456789abcdef0123456789abcdef01234567".to_string(),
                mode: MergeMode::NoFF,
                message: None,
            }
        );
        assert_eq!(
            serde_json::from_value::<MutationOperation>(serde_json::json!({
                "kind": "merge",
                "sourceOid": "0123456789abcdef0123456789abcdef01234567",
                "mode": "default",
                "message": "merge it"
            }))
            .expect("the default mode parses"),
            MutationOperation::Merge {
                source_oid: "0123456789abcdef0123456789abcdef01234567".to_string(),
                mode: MergeMode::Default,
                message: Some("merge it".to_string()),
            }
        );
        assert_eq!(serde_json::to_value(&parsed).unwrap(), json);
        // An unknown field is a payload the host does not understand, not one it
        // half-understands.
        assert!(
            serde_json::from_value::<MutationOperation>(serde_json::json!({
                "kind": "merge",
                "sourceOid": "0123456789abcdef0123456789abcdef01234567",
                "mode": "no-ff",
                "message": null,
                "extra": true
            }))
            .is_err()
        );
    }

    #[test]
    fn the_branch_tag_revert_reset_and_pick_payloads_round_trip_on_the_wire() {
        // Prevents: a browser sending a payload the host cannot read (or the reverse),
        // because one of these projections drifted from the contract's spelling.
        let oid = "0123456789abcdef0123456789abcdef01234567";
        for (json, expected) in [
            (
                serde_json::json!({
                    "kind": "createBranch",
                    "branchName": "feature",
                    "startOid": oid,
                    "switchToIt": true
                }),
                MutationOperation::CreateBranch {
                    branch_name: "feature".to_string(),
                    start_oid: Some(oid.to_string()),
                    switch_to_it: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "switchBranch",
                    "branchName": "main"
                }),
                MutationOperation::SwitchBranch {
                    branch_name: "main".to_string(),
                },
            ),
            (
                serde_json::json!({
                    "kind": "createTag",
                    "tagName": "v1",
                    "targetOid": null,
                    "annotation": { "message": "release" }
                }),
                MutationOperation::CreateTag {
                    tag_name: "v1".to_string(),
                    target_oid: None,
                    annotation: Some(TagAnnotation {
                        message: "release".to_string(),
                    }),
                },
            ),
            (
                serde_json::json!({ "kind": "revertCommit", "oid": oid }),
                MutationOperation::RevertCommit {
                    oid: oid.to_string(),
                },
            ),
            (
                serde_json::json!({ "kind": "resetBranch", "oid": oid, "mode": "mixed" }),
                MutationOperation::ResetBranch {
                    oid: oid.to_string(),
                    mode: ResetMode::Mixed,
                },
            ),
            (
                serde_json::json!({ "kind": "cherryPick", "oid": oid }),
                MutationOperation::CherryPick {
                    oid: oid.to_string(),
                },
            ),
            (
                serde_json::json!({
                    "kind": "deleteBranch",
                    "branchName": "feature",
                    "confirmed": true
                }),
                MutationOperation::DeleteBranch {
                    branch_name: "feature".to_string(),
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "deleteTag",
                    "tagName": "v1",
                    "confirmed": true
                }),
                MutationOperation::DeleteTag {
                    tag_name: "v1".to_string(),
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "renameBranch",
                    "branchName": "old",
                    "newName": "new"
                }),
                MutationOperation::RenameBranch {
                    branch_name: "old".to_string(),
                    new_name: "new".to_string(),
                },
            ),
            (
                serde_json::json!({
                    "kind": "setBranchUpstream",
                    "branchName": "main",
                    "upstream": { "remoteName": "origin", "branchName": "main" }
                }),
                MutationOperation::SetBranchUpstream {
                    branch_name: "main".to_string(),
                    upstream: Some(UpstreamSpec {
                        remote_name: "origin".to_string(),
                        branch_name: "main".to_string(),
                    }),
                },
            ),
            (
                serde_json::json!({
                    "kind": "setBranchUpstream",
                    "branchName": "main",
                    "upstream": null
                }),
                MutationOperation::SetBranchUpstream {
                    branch_name: "main".to_string(),
                    upstream: None,
                },
            ),
            (
                serde_json::json!({
                    "kind": "continueMerge",
                    "message": null
                }),
                MutationOperation::ContinueMerge { message: None },
            ),
            (
                serde_json::json!({ "kind": "abortMerge", "confirmed": true }),
                MutationOperation::AbortMerge { confirmed: true },
            ),
            (
                serde_json::json!({ "kind": "continueCherryPick" }),
                MutationOperation::ContinueCherryPick {},
            ),
            (
                serde_json::json!({ "kind": "abortCherryPick", "confirmed": true }),
                MutationOperation::AbortCherryPick { confirmed: true },
            ),
            (
                serde_json::json!({ "kind": "rebase", "upstreamOid": oid }),
                MutationOperation::Rebase {
                    upstream_oid: oid.to_string(),
                },
            ),
            (
                serde_json::json!({ "kind": "continueRebase" }),
                MutationOperation::ContinueRebase {},
            ),
            (
                serde_json::json!({ "kind": "abortRebase", "confirmed": true }),
                MutationOperation::AbortRebase { confirmed: true },
            ),
            (
                serde_json::json!({ "kind": "dropCommit", "oid": oid, "confirmed": true }),
                MutationOperation::DropCommit {
                    oid: oid.to_string(),
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({ "kind": "squashCommit", "message": null }),
                MutationOperation::SquashCommit { message: None },
            ),
            (
                serde_json::json!({ "kind": "amendCommit", "message": null, "confirmed": true }),
                MutationOperation::AmendCommit {
                    message: None,
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "createStash",
                    "message": "wip",
                    "includeUntracked": true,
                    "keepIndex": false
                }),
                MutationOperation::CreateStash {
                    message: Some("wip".to_string()),
                    include_untracked: true,
                    keep_index: false,
                },
            ),
            (
                serde_json::json!({
                    "kind": "applyStash",
                    "stash": { "oid": oid, "locator": "stash@{0}" },
                    "restoreIndex": true
                }),
                MutationOperation::ApplyStash {
                    stash: StashRef {
                        oid: oid.to_string(),
                        locator: "stash@{0}".to_string(),
                    },
                    restore_index: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "popStash",
                    "stash": { "oid": oid, "locator": "stash@{1}" },
                    "restoreIndex": false,
                    "confirmed": true
                }),
                MutationOperation::PopStash {
                    stash: StashRef {
                        oid: oid.to_string(),
                        locator: "stash@{1}".to_string(),
                    },
                    restore_index: false,
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "dropStash",
                    "stash": { "oid": oid, "locator": "stash@{2}" },
                    "confirmed": true
                }),
                MutationOperation::DropStash {
                    stash: StashRef {
                        oid: oid.to_string(),
                        locator: "stash@{2}".to_string(),
                    },
                    confirmed: true,
                },
            ),
            (
                serde_json::json!({
                    "kind": "addRemote",
                    "remoteName": "origin",
                    "fetchUrl": "https://e.com/r",
                    "pushUrl": null
                }),
                MutationOperation::AddRemote {
                    remote_name: "origin".to_string(),
                    fetch_url: "https://e.com/r".to_string(),
                    push_url: None,
                },
            ),
            (
                serde_json::json!({
                    "kind": "updateRemote",
                    "remoteName": "origin",
                    "newName": "upstream",
                    "fetchUrl": "ssh://e.com/r",
                    "pushUrl": null
                }),
                MutationOperation::UpdateRemote {
                    remote_name: "origin".to_string(),
                    new_name: Some("upstream".to_string()),
                    fetch_url: Some("ssh://e.com/r".to_string()),
                    push_url: None,
                },
            ),
            (
                serde_json::json!({
                    "kind": "removeRemote",
                    "remoteName": "origin",
                    "confirmed": true
                }),
                MutationOperation::RemoveRemote {
                    remote_name: "origin".to_string(),
                    confirmed: true,
                },
            ),
        ] {
            assert_eq!(
                serde_json::from_value::<MutationOperation>(json.clone())
                    .unwrap_or_else(|error| panic!("{json} must parse: {error}")),
                expected,
                "{json}"
            );
            assert_eq!(
                serde_json::to_value(&expected).unwrap(),
                json,
                "the host's own payload must round-trip"
            );
        }
    }
}

#[derive(Debug, Clone)]
pub struct SubmitResult {
    pub record: OperationRecord,
    /// True when this request id and payload were already submitted and the effect did not
    /// run again.
    pub duplicate: bool,
}

/// The write path: journal, queue, effects and the rules that join them.
pub struct MutationEngine {
    journal: Arc<Journal>,
    recovery: Arc<Recovery>,
    effects: Vec<Box<dyn MutationEffect>>,
    queue: Queue<MutationRequest>,
    next_operation: AtomicU64,
    /// Where state changes are announced. `None` is an engine nobody subscribed to —
    /// tests, and a host that has not wired its event transport — and it changes nothing
    /// about what is journalled.
    events: Option<Arc<EventSink>>,
}

impl MutationEngine {
    /// Builds the engine. The effects are what this build can actually run; an empty set
    /// means no mutation is accepted, which is the honest state of a read-only slice.
    pub fn new(
        journal: Arc<Journal>,
        recovery: Arc<Recovery>,
        effects: Vec<Box<dyn MutationEffect>>,
    ) -> Arc<Self> {
        Self::with_event_sink(journal, recovery, effects, None)
    }

    /// The same engine, announcing every state change to `events`.
    ///
    /// The id counter starts **above every id the journal already holds**: the journal is
    /// the durable record, and a restarted process that minted `op_1` a second time would
    /// collide with the first process's `op_1` on its very next write — turning a person's
    /// recovery into a `ResourceBusy`.
    pub fn with_event_sink(
        journal: Arc<Journal>,
        recovery: Arc<Recovery>,
        effects: Vec<Box<dyn MutationEffect>>,
        events: Option<Arc<EventSink>>,
    ) -> Arc<Self> {
        let next_operation = next_operation_seed(&journal.records());
        Arc::new(Self {
            journal,
            recovery,
            effects,
            queue: Queue::new(QueueLimits::default()),
            next_operation: AtomicU64::new(next_operation),
            events,
        })
    }

    /// Publishes one record's state as an operation event, and — for an outcome that
    /// changed the repository — the invalidation a client needs to re-read.
    ///
    /// This is a hint, never the evidence: the record itself is in the journal, and a
    /// client that never subscribed reads it there.
    fn publish(&self, record: &JournalRecord) {
        let Some(events) = &self.events else {
            return;
        };
        events.publish(EventPayload::Operation {
            operation: record.to_operation_record(),
        });
        if matches!(
            record.status,
            OperationStatus::Succeeded | OperationStatus::NeedsAttention
        ) {
            if let Some(payload) = repository_changed(record) {
                events.publish(payload);
            }
        }
    }

    /// The kinds this build can run, in the order the contract lists them.
    pub fn implemented_kinds(&self) -> Vec<MutationKind> {
        refyard_contract::reads::MUTATION_KINDS
            .iter()
            .copied()
            .filter(|kind| self.effects.iter().any(|effect| effect.kind() == *kind))
            .collect()
    }

    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    pub fn recovery(&self) -> &Recovery {
        &self.recovery
    }

    /// Submits one request, journalling it before it may run.
    ///
    /// The facts the write path cannot read on its own come from `source`, which the
    /// caller passes: it borrows the reads for the length of this call and is not stored,
    /// which is what keeps the service from having to hold a reference to itself.
    pub async fn submit(
        self: &Arc<Self>,
        actor: &str,
        request: MutationRequest,
        source: &dyn PreconditionSource,
    ) -> Result<SubmitResult, Problem> {
        let digest = canonical_payload_digest(&request);

        // Idempotency: the same client request id and the same payload is the same
        // operation, and the answer is the record that already exists.
        if let Some(existing) = self
            .journal
            .find_client_request(actor, &request.client_request_id)
        {
            if existing.payload_digest != digest {
                return Err(Problem::new(
                    ProblemCode::IdempotencyConflict,
                    "that client request id was already used with a different payload; use a new id for the changed request",
                )
                .for_operation(existing.operation_id));
            }
            return Ok(SubmitResult {
                record: existing.to_operation_record(),
                duplicate: true,
            });
        }

        let kind = request.operation.kind();
        if !self.effects.iter().any(|effect| effect.kind() == kind) {
            // Nothing is journalled: an operation this build cannot run is not an
            // operation, and a record for one would be a claim it was accepted.
            return Err(Problem::new(
                ProblemCode::UnsupportedOperation,
                format!("{kind:?} is not implemented in this build; no operation was accepted"),
            ));
        }

        let write_key = source.write_key(&request)?;

        // Freshness and the write block. The block is filled in here from the recovery —
        // never from the source — so an effect cannot be accepted for a repository that is
        // blocked because a source forgot to look.
        let block = self.recovery.block_for(&write_key);
        let mut context = source.context(&request).await?;
        context.restart_block = block.as_ref().map(restart_block_of);
        check_preconditions(&context)?;

        let operation_id = format!(
            "op_{}",
            base36(self.next_operation.fetch_add(1, Ordering::SeqCst) + 1)
        );
        let accepted = JournalRecord {
            operation_id: operation_id.clone(),
            client_request_id: request.client_request_id.clone(),
            actor: actor.to_string(),
            kind,
            target: request.target.clone(),
            status: OperationStatus::Accepted,
            // The journal assigns the sequence: it is the one that knows the highest one
            // it has written.
            sequence: 0,
            accepted_at_ms: now_millis(),
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: digest,
            write_key: write_key.clone(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        };
        // Persist `accepted` before the operation may run. A failure here means the
        // operation is refused, not accepted-and-forgotten.
        if let Err(problem) = self.journal.append(accepted) {
            return Err(Problem::new(
                ProblemCode::ResourceBusy,
                format!(
                    "the operation journal could not record this request: {}",
                    problem.message
                ),
            )
            .retryable());
        }
        if let Some(record) = self.journal.get(&operation_id) {
            self.publish(&record);
        }

        if let Err(refusal) = self.queue.enqueue(
            operation_id.clone(),
            actor,
            &write_key,
            QueueMode::Write,
            request,
        ) {
            let (code, message, retryable) = match refusal {
                EnqueueRefusal::QueueFull => (
                    ProblemCode::ResourceBusy,
                    "this session already has the maximum number of operations waiting; wait for them to finish".to_string(),
                    true,
                ),
                EnqueueRefusal::AlreadyQueued => (
                    ProblemCode::Conflict,
                    "that operation is already queued".to_string(),
                    false,
                ),
            };
            let problem = Problem::new(code, message);
            let finished =
                self.journal
                    .finish_without_start(&operation_id, problem.clone(), now_millis())?;
            self.publish(&finished);
            return Err(if retryable {
                problem.retryable()
            } else {
                problem
            });
        }

        self.pump();
        let record = self.journal.get(&operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::InternalError,
                "the operation was journalled but cannot be read back",
            )
        })?;
        Ok(SubmitResult {
            record: record.to_operation_record(),
            duplicate: false,
        })
    }

    /// One operation, as its client may read it.
    pub fn get(&self, actor: &str, operation_id: &str) -> Result<OperationRecord, Problem> {
        let record = self.journal.get(operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.actor != actor {
            // An operation belongs to the session that submitted it; another session's
            // record is not this one's to read.
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            ));
        }
        Ok(record.to_operation_record())
    }

    /// This actor's recent operations, newest first.
    pub fn list(&self, actor: &str, limit: usize) -> OperationsListResponse {
        let records = self.journal.list_for(actor, limit);
        OperationsListResponse {
            truncated: records.len() >= limit,
            operations: records
                .into_iter()
                .map(|record| record.to_operation_record())
                .collect(),
        }
    }

    /// Cancels an operation that has not started.
    pub fn cancel(&self, actor: &str, operation_id: &str) -> Result<OperationRecord, Problem> {
        let record = self.journal.get(operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.actor != actor {
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            ));
        }
        if record.status != OperationStatus::Accepted {
            // A running mutation is never relabelled: it may already have changed the
            // repository, and calling that "cancelled" would hide the change.
            return Err(Problem::new(
                ProblemCode::Conflict,
                if record.status == OperationStatus::Running {
                    "that operation is already running; a running mutation cannot be cancelled in this version"
                } else {
                    "that operation already finished"
                },
            )
            .for_operation(operation_id));
        }
        if !self.queue.cancel(operation_id) {
            // The queue no longer has it, so it has started between the two reads.
            return Err(Problem::new(
                ProblemCode::Conflict,
                "that operation is already running; a running mutation cannot be cancelled in this version",
            )
            .for_operation(operation_id));
        }
        let cancelled = self.journal.mark_cancelled(operation_id, now_millis())?;
        self.publish(&cancelled);
        Ok(cancelled.to_operation_record())
    }

    /// Starts every queued operation the limits allow.
    fn pump(self: &Arc<Self>) {
        for ticket in self.queue.take_startable() {
            let engine = Arc::clone(self);
            tokio::spawn(async move {
                engine.run_ticket(ticket).await;
            });
        }
    }

    /// Runs one operation: `running` on disk, then the effect, then its outcome.
    ///
    /// The queue slot is released by a guard, so a failure anywhere in here — including a
    /// panic in an effect — cannot leave a repository looking permanently busy.
    async fn run_ticket(self: Arc<Self>, ticket: QueueTicket<MutationRequest>) {
        let _guard = QueueSlot {
            queue: &self.queue,
            id: ticket.id.clone(),
        };
        let operation_id = ticket.id.clone();
        let started = match self.journal.mark_started(&operation_id, now_millis()) {
            Ok(record) => record,
            Err(_) => {
                // The record is not in a state that may start; leaving it accepted is what
                // the next restart reconciles, and inventing a terminal state here would
                // claim an outcome nobody observed.
                return;
            }
        };
        self.publish(&started);
        let Some(effect) = self
            .effects
            .iter()
            .find(|effect| effect.kind() == ticket.job.operation.kind())
        else {
            return;
        };
        let outcome = effect
            .run(EffectRequest {
                operation_id: &operation_id,
                actor: &ticket.actor,
                write_key: &ticket.repository_id,
                request: &ticket.job,
            })
            .await;
        if let Ok(record) = self.journal.finish(&operation_id, outcome, now_millis()) {
            self.publish(&record);
            if record.status == OperationStatus::Unknown {
                // An unknown outcome blocks the repository exactly as a restart does: the
                // next write would be made on top of a change nobody has confirmed.
                self.recovery.block(&record, now_millis());
            }
        }
    }
}

/// Releases one queue slot when it goes out of scope, whatever happened.
struct QueueSlot<'a> {
    queue: &'a Queue<MutationRequest>,
    id: String,
}

impl Drop for QueueSlot<'_> {
    fn drop(&mut self) {
        self.queue.release(&self.id);
    }
}

fn restart_block_of(block: &WriteBlock) -> RestartWriteBlock {
    RestartWriteBlock {
        reason: block.reason.clone(),
        operation_ids: block.operation_ids.clone(),
    }
}

/// The invalidation a finished operation produces, when it can name a repository.
///
/// A workspace operation's write key names the approved root it wrote into, and there is
/// no repository id to publish — the contract's `repositoryChanged` carries one, and
/// inventing a value there would be a lie a client can validate. Nothing is published for
/// it: the client learns about the new repository from its own re-read of the list.
fn repository_changed(record: &JournalRecord) -> Option<EventPayload> {
    match &record.target {
        MutationTarget::Worktree {
            repository_id,
            worktree_id,
            ..
        } => Some(EventPayload::RepositoryChanged {
            repository_id: repository_id.clone(),
            // Naming the worktree is more than the journal must know and exactly what a
            // client needs: only this worktree's cached reads are stale.
            worktree_ids: vec![worktree_id.clone()],
            snapshot_invalidated: true,
        }),
        MutationTarget::Repository { repository_id, .. } => Some(EventPayload::RepositoryChanged {
            repository_id: repository_id.clone(),
            worktree_ids: Vec::new(),
            snapshot_invalidated: true,
        }),
        MutationTarget::Workspace { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mutation_request_refuses_a_field_or_a_kind_it_does_not_know() {
        let parsed: Result<MutationRequest, _> = serde_json::from_value(serde_json::json!({
            "clientRequestId": "crid-1",
            "target": {
                "kind": "worktree",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "expectedSnapshotId": "snap_1",
            },
            "operation": { "kind": "stagePaths", "pathIds": ["path_1"], "previewTokens": ["pt_1"] },
        }));
        let request = parsed.expect("the contract's shape parses");
        assert_eq!(request.operation.kind(), MutationKind::StagePaths);
        assert_eq!(request.operation.path_ids(), vec!["path_1".to_string()]);
        assert_eq!(request.operation.preview_tokens(), vec!["pt_1".to_string()]);

        // A field the host does not know is not silently ignored: it could be a rule the
        // caller believes it stated.
        let extra: Result<MutationRequest, _> = serde_json::from_value(serde_json::json!({
            "clientRequestId": "crid-1",
            "target": {
                "kind": "worktree",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "expectedSnapshotId": "snap_1",
            },
            "operation": { "kind": "stagePaths", "pathIds": ["path_1"], "previewTokens": ["pt_1"], "force": true },
        }));
        assert!(extra.is_err());
    }

    #[test]
    fn a_request_names_the_repository_or_the_workspace_it_addresses_but_never_both() {
        let request = MutationRequest {
            client_request_id: "crid-1".to_string(),
            target: MutationTarget::Worktree {
                repository_id: "repo_1".to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            operation: MutationOperation::Commit {
                message: "message".to_string(),
            },
        };
        assert_eq!(request.repository_id(), Some("repo_1"));
        assert_eq!(request.worktree_id(), Some("wt_1"));
    }
}
