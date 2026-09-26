//! Merge: the one write that can legitimately stop in the middle.
//!
//! The command is the planner's; this module owns the judgement Git's exit code cannot
//! make alone. A merge that stops for conflicts leaves `MERGE_HEAD` and a three-way
//! index behind — the merge is *unfinished, not undone* — so the outcome is
//! `needsAttention` with the conflicted-path count, never `failed`. A non-zero exit
//! without `MERGE_HEAD` was refused before anything happened, and the read-back proves
//! it. Whether a merge stands is decided by re-reading the marker after the command, not
//! by predicting it from the exit code: a stop for a reason this build does not model
//! still leaves a state the next request must refuse to walk into.
//!
//! Nothing here resolves a conflict, continues a merge or aborts one: those are their
//! own operations, and a conflicted path is a path a human has to look at.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::{HeadKind, MutationKind};

use refyard_core::outcome::ExecutionState;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MergeMode, MutationEffect, MutationOperation};

use super::{
    classify_write, conflicted_count, diagnostic_of, effect_outcome, invalid_payload, probe,
    refused, wrong_payload, Postcondition, Verdict, WriteHost,
};

/// `git merge [--no-ff] (--no-edit | -m <message>) <object>`.
pub struct MergeEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for MergeEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Merge
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { merge(&host, &request).await })
    }
}

async fn merge(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Merge {
        source_oid,
        mode,
        message,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "merge");
    };
    // The payload is validated before anything is read: an option-shaped source would
    // reach `git merge`'s argv as the option it spells, and an empty explicit message is
    // not a message this host can carry.
    let no_ff = *mode == MergeMode::NoFF;
    let plan = match refyard_core::plan::merge::plan_merge(
        source_oid,
        no_ff,
        message.as_deref().map(str::as_bytes),
    ) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    if before.head.kind == HeadKind::Unborn {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "this repository has no commit yet, so there is nothing to merge into",
            ),
        );
    }

    // The state probes are reads, and a merge never runs against a state that could not
    // be read: a probe that cannot run refuses the operation before anything can change.
    let merge_in_progress = refyard_core::plan::merge::plan_merge_in_progress();
    match probe(&target, &merge_in_progress).await {
        None => {
            return refused(
                operation_id,
                Problem::new(
                    ProblemCode::Unavailable,
                    "whether a merge is in progress could not be read, so the merge was not started",
                ),
            );
        }
        Some(true) => {
            return refused(
                operation_id,
                Problem::new(
                    ProblemCode::Conflict,
                    "a merge is already in progress in this worktree; continue or abort it first",
                ),
            );
        }
        Some(false) => {}
    }
    let resolve = refyard_core::plan::merge::plan_resolve_commit(source_oid);
    if probe(&target, &resolve).await != Some(true) {
        // A well-formed object name that is missing — or names a blob or a tree — is a
        // caller mistake, and Git's own refusal for it says less than this does.
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::InvalidRequest,
                "that merge source is not a commit in this repository; refresh the branch list and choose again",
            ),
        );
    }

    let outcome = match target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &plan,
            None,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };

    // A completed non-zero exit is the one shape a conflict takes: Git finished its run
    // and left the merge standing. That is confirmed by re-reading the marker, not from
    // the exit code, so a stop this build does not model is not mislabelled either.
    if outcome.state == ExecutionState::Completed
        && outcome.output_complete
        && outcome.exit_code != Some(0)
        && probe(&target, &merge_in_progress).await == Some(true)
    {
        let diagnostic = diagnostic_of(&outcome);
        let mut problem = Problem::new(
            ProblemCode::NeedsAttention,
            conflicted_message(&target).await,
        )
        .with_detail("diagnostic", DetailValue::Text(diagnostic));
        if let Some(count) = conflicted_count(&target).await {
            problem = problem.with_detail("conflictedPaths", DetailValue::Integer(count as i64));
        }
        return EffectOutcome::NeedsAttention { problem };
    }

    if outcome.state == ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git merge", &outcome),
            },
            "merge".to_string(),
            None,
        );
    }

    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git merge",
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let summary = match &verdict {
        Verdict::Succeeded { new_head_oid } => {
            if new_head_oid.as_deref() == before.head.oid.as_deref() {
                "merge: already up to date".to_string()
            } else {
                match new_head_oid {
                    Some(head) => format!("merged {source_oid} as {head}"),
                    None => format!("merged {source_oid}"),
                }
            }
        }
        _ => "merge".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

/// The message a stopped merge reports, with the distinct conflicted-path count when the
/// unmerged listing can be read. The count is evidence from the index, not from Git's
/// prose.
async fn conflicted_message(target: &super::WriteTarget) -> String {
    match conflicted_count(target).await {
        Some(1) => "the merge stopped with conflicts: 1 conflicted path; resolve it, stage the resolution, and continue the merge".to_string(),
        Some(count) => format!(
            "the merge stopped with conflicts: {count} conflicted paths; resolve them, stage the resolution, and continue the merge"
        ),
        None => "the merge stopped with conflicts; resolve them, stage the resolution, and continue the merge".to_string(),
    }
}
