//! The writes that replay or move history: cherry-pick, revert, reset.
//!
//! Cherry-pick and revert share the merge's lifecycle, so they share its judgement too:
//! the stop is decided by re-reading the sequencer marker after the command, not by the
//! exit code. The two differ in what a stop means —
//!
//! - **a cherry-pick's stop is a state a human finishes**: with unmerged paths it is
//!   `needsAttention` and the pick stands, exactly like a merge;
//! - **a revert's stop is aborted before it is reported**: its conflict state offers the
//!   user nothing this build can finish, so leaving `REVERT_HEAD` and a staged inverse
//!   patch behind would only hand them a trap. The abort restores the exact pre-revert
//!   state, and the failure names what conflicted;
//! - **an empty pick is aborted too**: "this change is already present" with the branch
//!   exactly as it was beats a sequencer state nothing can commit.
//!
//! Reset refuses to run while a merge or revert stands — moving the branch away is the
//! one thing that makes finishing them impossible — and plans only the modes that
//! cannot lose working-tree content.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

use refyard_core::outcome::ExecutionState;
use refyard_core::plan::GitPlan;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation, ResetMode};

use super::{
    classify_write, conflicted_count, diagnostic_of, effect_outcome, invalid_payload, probe,
    refused, wrong_payload, Postcondition, Verdict, WriteHost,
};

/// `git cherry-pick --no-edit <oid>`.
pub struct CherryPickEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git revert --no-edit <oid>`.
pub struct RevertCommitEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git reset --soft|--mixed <oid>`.
pub struct ResetBranchEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for CherryPickEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::CherryPick
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { cherry_pick(&host, &request).await })
    }
}

impl MutationEffect for RevertCommitEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::RevertCommit
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { revert_commit(&host, &request).await })
    }
}

impl MutationEffect for ResetBranchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::ResetBranch
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { reset_branch(&host, &request).await })
    }
}

/// One sequencer state's probe plan: the marker that says a stop is standing.
enum Sequencer {
    Merge,
    Revert,
    CherryPick,
}

impl Sequencer {
    fn plan(&self) -> GitPlan {
        match self {
            Sequencer::Merge => refyard_core::plan::merge::plan_merge_in_progress(),
            Sequencer::Revert => refyard_core::plan::replay::plan_revert_in_progress(),
            Sequencer::CherryPick => refyard_core::plan::replay::plan_cherry_pick_in_progress(),
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Sequencer::Merge => "merge",
            Sequencer::Revert => "revert",
            Sequencer::CherryPick => "cherry-pick",
        }
    }
}

/// Refuses while any of the named sequencer states stands, in the Node reference's own
/// words: finishing one is a human's decision, and a second history write walking into
/// it would only guess.
async fn refuse_standing_sequencers(
    operation_id: &str,
    target: &super::WriteTarget,
    states: &[Sequencer],
) -> Option<EffectOutcome> {
    for state in states {
        match probe(target, &state.plan()).await {
            // A state that cannot be read is a precondition that cannot be
            // established, and the write never runs against an unknown start.
            None => {
                return Some(refused(
                    operation_id,
                    Problem::new(
                        ProblemCode::Unavailable,
                        format!(
                            "whether a {} is in progress could not be read, so the operation was not started",
                            state.label()
                        ),
                    ),
                ));
            }
            Some(true) => {
                return Some(refused(
                    operation_id,
                    Problem::new(
                        ProblemCode::Conflict,
                        format!(
                            "a {} is already in progress in this worktree; continue or abort it first",
                            state.label()
                        ),
                    ),
                ));
            }
            Some(false) => {}
        }
    }
    None
}

/// Everything the three effects share before their commands differ: resolve, read, and
/// refuse to run against a standing sequencer state.
async fn prepare(
    host: &Arc<WriteHost>,
    request: &EffectRequest<'_>,
    states: &[Sequencer],
) -> Result<(super::WriteTarget, super::WriteFacts), EffectOutcome> {
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return Err(refused(request.operation_id, problem)),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return Err(refused(request.operation_id, problem)),
    };
    if let Some(outcome) = refuse_standing_sequencers(request.operation_id, &target, states).await {
        return Err(outcome);
    }
    Ok((target, before))
}

/// The shared tail: a non-started command is a typed failure, everything else is judged
/// by the read-back.
fn classify_or_not_started(
    command: &'static str,
    outcome: &refyard_core::outcome::RunOutcome,
    before: &super::WriteFacts,
    after: Option<&super::WriteFacts>,
    postcondition: Postcondition,
) -> Verdict {
    if outcome.state == ExecutionState::NotStarted {
        return Verdict::Failed {
            problem: super::refusal_problem(command, outcome),
        };
    }
    classify_write(command, postcondition, outcome, before, after)
}

async fn cherry_pick(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::CherryPick { oid } = &request.request.operation else {
        return wrong_payload(operation_id, "cherryPick");
    };
    let plan = match refyard_core::plan::replay::plan_cherry_pick(oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) = match prepare(
        host,
        request,
        &[Sequencer::Merge, Sequencer::Revert, Sequencer::CherryPick],
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(outcome) => return outcome,
    };
    let cherry_pick_in_progress = refyard_core::plan::replay::plan_cherry_pick_in_progress();
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
    let diagnostic = diagnostic_of(&outcome);

    // Git finished its run and left the pick standing: a conflict, or the pick that
    // would commit nothing because the change is already present. The two are told
    // apart by the index, which is evidence, not prose.
    if outcome.state == ExecutionState::Completed
        && outcome.output_complete
        && outcome.exit_code != Some(0)
        && probe(&target, &cherry_pick_in_progress).await == Some(true)
    {
        match conflicted_count(&target).await {
            Some(count) if count > 0 => {
                let mut problem = Problem::new(
                    ProblemCode::NeedsAttention,
                    format!(
                        "the cherry-pick stopped with conflicts: {} resolve them, stage the resolution, and continue the cherry-pick or abort it",
                        conflicted_clause(count)
                    ),
                )
                .with_detail("diagnostic", DetailValue::Text(diagnostic));
                problem =
                    problem.with_detail("conflictedPaths", DetailValue::Integer(count as i64));
                return EffectOutcome::NeedsAttention { problem };
            }
            _ => {
                // A stop with a clean index is Git's "the previous cherry-pick is now
                // empty": nothing can be committed, so the stop is aborted — the branch
                // exactly as it was beats a sequencer state no request can finish.
                let abort = refyard_core::plan::replay::plan_cherry_pick_abort();
                if probe(&target, &abort).await.is_none() {
                    return effect_outcome(
                        Verdict::Unknown {
                            reason: "the empty cherry-pick's abort did not report cleanly"
                                .to_string(),
                            problem: super::unknown_problem(
                                "git cherry-pick --abort",
                                "the empty pick could not be confirmed aborted; whether the sequencer state was cleared is not known, and nothing was retried",
                            ),
                        },
                        "cherry-pick".to_string(),
                        None,
                    );
                }
                return refused(
                    operation_id,
                    Problem::new(
                        ProblemCode::Conflict,
                        format!(
                            "the cherry-pick would be empty — this change is already present — and was aborted, so the branch is unchanged: {diagnostic}"
                        ),
                    ),
                );
            }
        }
    }

    if diagnostic.contains("is a merge but no -m option") {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                format!(
                    "that commit is a merge, and picking which parent to keep is a decision this build does not make: {diagnostic}"
                ),
            ),
        );
    }

    let after = host.read_facts(&target).await.ok();
    let verdict = classify_or_not_started(
        "git cherry-pick",
        &outcome,
        &before,
        after.as_ref(),
        Postcondition::HeadMustMove,
    );
    let summary = match &verdict {
        Verdict::Succeeded {
            new_head_oid: Some(head),
        } => format!("cherry-picked {oid} as {head}"),
        Verdict::Succeeded { .. } => format!("cherry-picked {oid}"),
        _ => "cherry-pick".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn revert_commit(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::RevertCommit { oid } = &request.request.operation else {
        return wrong_payload(operation_id, "revertCommit");
    };
    let plan = match refyard_core::plan::replay::plan_revert_commit(oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) =
        match prepare(host, request, &[Sequencer::Merge, Sequencer::Revert]).await {
            Ok(prepared) => prepared,
            Err(outcome) => return outcome,
        };
    let revert_in_progress = refyard_core::plan::replay::plan_revert_in_progress();
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
    let diagnostic = diagnostic_of(&outcome);

    // The contract's promise for a revert: it either completes or leaves nothing
    // behind. A stop is therefore aborted before it is reported — a `REVERT_HEAD` and
    // a staged inverse patch handed to the user would be a trap this build cannot
    // finish for them.
    if outcome.state == ExecutionState::Completed
        && outcome.output_complete
        && outcome.exit_code != Some(0)
        && probe(&target, &revert_in_progress).await == Some(true)
    {
        let abort = refyard_core::plan::replay::plan_revert_abort();
        if probe(&target, &abort).await.is_none() {
            return effect_outcome(
                Verdict::Unknown {
                    reason: "the conflicted revert's abort did not report cleanly".to_string(),
                    problem: super::unknown_problem(
                        "git revert --abort",
                        "the stopped revert could not be confirmed aborted; whether the repository was restored is not known, and nothing was retried",
                    ),
                },
                "revert".to_string(),
                None,
            );
        }
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                format!(
                    "the revert stopped with a conflict and was aborted, so nothing was left behind; a human has to resolve this one: {diagnostic}"
                ),
            ),
        );
    }

    let after = host.read_facts(&target).await.ok();
    let verdict = classify_or_not_started(
        "git revert",
        &outcome,
        &before,
        after.as_ref(),
        Postcondition::HeadMustMove,
    );
    let summary = match &verdict {
        Verdict::Succeeded {
            new_head_oid: Some(head),
        } => format!("reverted {oid} as {head}"),
        Verdict::Succeeded { .. } => format!("reverted {oid}"),
        _ => "revert".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn reset_branch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::ResetBranch { oid, mode } = &request.request.operation else {
        return wrong_payload(operation_id, "resetBranch");
    };
    let plan = match refyard_core::plan::replay::plan_reset_branch(oid, *mode == ResetMode::Soft) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) =
        match prepare(host, request, &[Sequencer::Merge, Sequencer::Revert]).await {
            Ok(prepared) => prepared,
            Err(outcome) => return outcome,
        };
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
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_or_not_started(
        "git reset",
        &outcome,
        &before,
        after.as_ref(),
        // Resetting to the commit already checked out succeeds and moves nothing, so
        // "the index may be unchanged" is the honest postcondition; a clean exit is
        // Git's word, judged by the same read-back a stage runs under.
        Postcondition::IndexMayBeUnchanged,
    );
    let summary = match &verdict {
        Verdict::Succeeded { new_head_oid } => {
            let moved = match new_head_oid {
                Some(head) => format!("reset the branch to {head}"),
                None => "reset the branch".to_string(),
            };
            if *mode == ResetMode::Soft {
                format!("{moved} (soft; the index is untouched)")
            } else {
                format!("{moved} (mixed; staged work is now unstaged)")
            }
        }
        _ => "reset branch".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

/// The count clause of a conflicted message, singular when there is exactly one path.
fn conflicted_clause(count: u64) -> String {
    if count == 1 {
        "1 conflicted path;".to_string()
    } else {
        format!("{count} conflicted paths;")
    }
}
