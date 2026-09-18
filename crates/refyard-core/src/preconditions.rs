//! What must be true before an operation may run.
//!
//! These are the checks that turn "the user asked" into "the user asked about the state
//! that still exists". Each one exists because of a specific way a Git operation
//! silently affects the wrong thing:
//!
//! - **Snapshot freshness.** The request names a snapshot; if the repository's HEAD or
//!   index moved since, the plan the user confirmed is not the plan that would run.
//! - **Preview fingerprints.** For a stage or a discard, the content fingerprint must
//!   still match what was previewed. A `git status` marker is not evidence: a file can
//!   be edited and still show `M`.
//! - **No operation in progress.** A merge, rebase or cherry-pick in flight means Git
//!   will refuse or, worse, do something surprising; the user must resolve it first.
//! - **Write block after a restart.** A repository with an unresolved operation is
//!   blocked until a human confirms its state, because writing on top of an unresolved
//!   write is how a repository ends up in a state nobody can explain.
//!
//! Every check produces a `Problem` or nothing, and the caller stops at the first
//! failure: preconditions are all-or-nothing, so a batch is never half-authorised.
//!
//! This module is pure: it is a decision over facts a host gathered, not a reader of
//! them. That is what lets the same rules be tested without a repository and applied
//! identically by the local and the SSH paths.

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

/// A refusal established while gathering the facts themselves.
///
/// An unknown repository or worktree, or a state that could not be read, is checked
/// before anything else so the submit path can answer with the real code instead of an
/// internal error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatheredRefusal {
    pub code: ProblemCode,
    pub message: String,
    /// Only a failure that changed nothing and may pass on its own (a deadline) is
    /// retryable.
    pub retryable: bool,
}

/// One preview fingerprint that must still match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewFingerprintCheck {
    pub path_id: String,
    pub expected_fingerprint: Option<String>,
    /// `None` when the path could not be read at all now, which is a refusal rather than
    /// an equality: content nobody could read is content nobody confirmed.
    pub current_fingerprint: Option<String>,
}

/// The write block a restart left behind for one repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestartWriteBlock {
    pub reason: String,
    pub operation_ids: Vec<String>,
}

/// The facts a precondition decision is made over.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PreconditionContext {
    /// HEAD object name the request was prepared against, or `None` when unborn.
    pub snapshot_head_oid: Option<String>,
    /// HEAD object name now.
    pub current_head_oid: Option<String>,
    /// Whether the snapshot's index fingerprint still matches.
    pub index_unchanged: bool,
    /// The operation Git reports as in progress, if any.
    pub operation_in_progress: Option<String>,
    /// In-progress operations this request may run alongside.
    pub may_run_during: Vec<String>,
    /// A restart left an unresolved operation for this repository.
    pub restart_block: Option<RestartWriteBlock>,
    /// Preview fingerprints that must still match.
    pub preview_checks: Vec<PreviewFingerprintCheck>,
    /// A refusal established while gathering the facts.
    pub refusal: Option<GatheredRefusal>,
}

/// Decides whether the operation may run, or names the fact that refuses it.
pub fn check_preconditions(context: &PreconditionContext) -> Result<(), Problem> {
    if let Some(refusal) = &context.refusal {
        let problem = Problem::new(refusal.code, refusal.message.clone());
        return Err(if refusal.retryable {
            problem.retryable()
        } else {
            problem
        });
    }

    if let Some(block) = &context.restart_block {
        // The code is `UncertainOutcome` and not a generic conflict: what blocks the write
        // is that nobody knows what the previous one did, and the answer is a person
        // looking, not a retry.
        return Err(Problem::new(
            ProblemCode::UncertainOutcome,
            format!(
                "{}; confirm the repository state before submitting new work",
                block.reason
            ),
        )
        .with_detail("reason", DetailValue::Text(block.reason.clone()))
        .with_detail(
            "operations",
            DetailValue::Text(block.operation_ids.join(",")),
        ));
    }

    if let Some(in_progress) = &context.operation_in_progress {
        if !context
            .may_run_during
            .iter()
            .any(|allowed| allowed == in_progress)
        {
            return Err(Problem::new(
                ProblemCode::Conflict,
                format!(
                    "a {in_progress} is in progress in this worktree; finish or abort it before other operations"
                ),
            )
            .with_detail("operation", DetailValue::Text(in_progress.clone())));
        }
    }

    if context.snapshot_head_oid != context.current_head_oid {
        return Err(Problem::new(
            ProblemCode::StaleSnapshot,
            "the repository moved since this request was prepared; reload and confirm again",
        )
        .with_detail(
            "expectedHead",
            DetailValue::Text(
                context
                    .snapshot_head_oid
                    .clone()
                    .unwrap_or_else(|| "(unborn)".to_string()),
            ),
        )
        .with_detail(
            "currentHead",
            DetailValue::Text(
                context
                    .current_head_oid
                    .clone()
                    .unwrap_or_else(|| "(unborn)".to_string()),
            ),
        ));
    }

    if !context.index_unchanged {
        return Err(Problem::new(
            ProblemCode::StaleSnapshot,
            "the index changed since this request was prepared; reload and confirm again",
        ));
    }

    for check in &context.preview_checks {
        let Some(current) = &check.current_fingerprint else {
            return Err(Problem::new(
                ProblemCode::StalePreview,
                "a selected path could no longer be read; re-preview it before changing it",
            )
            .with_detail("pathId", DetailValue::Text(check.path_id.clone())));
        };
        if Some(current) != check.expected_fingerprint.as_ref() {
            return Err(Problem::new(
                ProblemCode::StalePreview,
                "the content of a selected path changed since it was previewed; re-preview it before changing it",
            )
            .with_detail("pathId", DetailValue::Text(check.path_id.clone())));
        }
    }

    Ok(())
}

/// In-progress operations each mutation may run alongside.
///
/// While `merge` is unfinished, four kinds stay available, because they are the
/// documented way through a conflict:
///
/// - `stagePaths` **is** the resolution step. Git's own workflow is "resolve the files,
///   `git add` them, commit", so blocking staging would leave the repository with no way
///   to record the resolution the UI asks the user to perform.
/// - `unstagePaths` is that step in reverse — taking a wrong stage back out before
///   continuing — and it cannot discard working-tree content.
/// - `continueMerge` and `abortMerge` are the two ways to end the merge.
///
/// Everything else stays blocked, `commit` and `discardTrackedPaths` included: a plain
/// commit would write the wrong history in place of the merge commit, and a discard
/// fights the conflict state. A rebase, cherry-pick, bisect, revert or mailbox apply is
/// not on any list either — this build did not start it and must not be the thing that
/// ends it.
pub fn may_run_during_operation(kind: MutationKind) -> Vec<String> {
    match kind {
        MutationKind::StagePaths
        | MutationKind::UnstagePaths
        | MutationKind::ContinueMerge
        | MutationKind::AbortMerge => vec!["merge".to_string()],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> PreconditionContext {
        PreconditionContext {
            index_unchanged: true,
            ..PreconditionContext::default()
        }
    }

    #[test]
    fn an_unchanged_repository_passes_every_check() {
        assert_eq!(check_preconditions(&fresh()), Ok(()));
    }

    #[test]
    fn a_gathered_refusal_is_answered_before_anything_is_compared() {
        // The submit path learned the repository does not exist; comparing snapshot fields
        // would report a stale snapshot for a repository nobody could read.
        let context = PreconditionContext {
            refusal: Some(GatheredRefusal {
                code: ProblemCode::NotFound,
                message: "unknown repository repo_9".to_string(),
                retryable: false,
            }),
            snapshot_head_oid: Some("a".to_string()),
            current_head_oid: Some("b".to_string()),
            ..fresh()
        };
        let problem = check_preconditions(&context).expect_err("refused");
        assert_eq!(problem.code, ProblemCode::NotFound);
    }

    #[test]
    fn a_repository_with_a_write_block_refuses_with_the_uncertain_code() {
        let context = PreconditionContext {
            restart_block: Some(RestartWriteBlock {
                reason: "an operation was in flight when the service stopped".to_string(),
                operation_ids: vec!["op_1".to_string()],
            }),
            index_unchanged: false,
            ..fresh()
        };
        let problem = check_preconditions(&context).expect_err("blocked");
        assert_eq!(problem.code, ProblemCode::UncertainOutcome);
        assert!(!problem.retryable, "an unknown outcome is never retried");
        assert!(problem.message.contains("confirm the repository state"));
    }

    #[test]
    fn an_unfinished_merge_refuses_a_commit_but_allows_the_way_through_it() {
        let context = PreconditionContext {
            operation_in_progress: Some("merge".to_string()),
            may_run_during: may_run_during_operation(MutationKind::Commit),
            ..fresh()
        };
        let problem = check_preconditions(&context).expect_err("a merge is in progress");
        assert_eq!(problem.code, ProblemCode::Conflict);

        let staging = PreconditionContext {
            operation_in_progress: Some("merge".to_string()),
            may_run_during: may_run_during_operation(MutationKind::StagePaths),
            ..fresh()
        };
        assert_eq!(
            check_preconditions(&staging),
            Ok(()),
            "staging is how a conflicted path is resolved"
        );

        // A rebase this build did not start is not on any list.
        assert!(may_run_during_operation(MutationKind::Commit).is_empty());
        assert!(may_run_during_operation(MutationKind::Merge).is_empty());
    }

    #[test]
    fn a_moved_head_or_index_is_a_stale_snapshot() {
        let moved = PreconditionContext {
            snapshot_head_oid: Some("a".to_string()),
            current_head_oid: Some("b".to_string()),
            ..fresh()
        };
        let problem = check_preconditions(&moved).expect_err("head moved");
        assert_eq!(problem.code, ProblemCode::StaleSnapshot);
        assert_eq!(
            problem
                .details
                .as_ref()
                .and_then(|map| map.get("expectedHead")),
            Some(&DetailValue::Text("a".to_string()))
        );

        // An unborn HEAD is a state, not a missing fingerprint: an initial commit must be
        // refused when the index moved underneath it.
        let unborn_matches = PreconditionContext {
            snapshot_head_oid: None,
            current_head_oid: None,
            index_unchanged: true,
            ..fresh()
        };
        assert_eq!(check_preconditions(&unborn_matches), Ok(()));
        let unborn_moved = PreconditionContext {
            index_unchanged: false,
            ..unborn_matches
        };
        let problem = check_preconditions(&unborn_moved).expect_err("index moved");
        assert_eq!(problem.code, ProblemCode::StaleSnapshot);
        assert!(problem.message.contains("index"));
    }

    #[test]
    fn a_preview_whose_content_moved_is_stale_even_though_the_path_is_the_same() {
        let context = PreconditionContext {
            preview_checks: vec![PreviewFingerprintCheck {
                path_id: "path_1".to_string(),
                expected_fingerprint: Some("aa".to_string()),
                current_fingerprint: Some("bb".to_string()),
            }],
            ..fresh()
        };
        let problem = check_preconditions(&context).expect_err("content moved");
        assert_eq!(problem.code, ProblemCode::StalePreview);
        assert_eq!(
            problem.details.as_ref().and_then(|map| map.get("pathId")),
            Some(&DetailValue::Text("path_1".to_string()))
        );
    }

    #[test]
    fn a_preview_of_a_path_that_can_no_longer_be_read_is_stale_rather_than_equal() {
        // An unreadable path fingerprints to nothing; treating two nothings as equal would
        // authorise a write against content nobody has seen.
        let context = PreconditionContext {
            preview_checks: vec![PreviewFingerprintCheck {
                path_id: "path_1".to_string(),
                expected_fingerprint: None,
                current_fingerprint: None,
            }],
            ..fresh()
        };
        let problem = check_preconditions(&context).expect_err("unreadable");
        assert_eq!(problem.code, ProblemCode::StalePreview);
        assert!(problem.message.contains("no longer be read"));
    }
}
