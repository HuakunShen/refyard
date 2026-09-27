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

use refyard_core::outcome::{ExecutionState, RunOutcome};
use refyard_core::plan::GitPlan;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation, ResetMode};

use super::{
    classify_write, clean_exit, conflicted_count, diagnostic_of, effect_outcome, invalid_payload,
    probe, refused, wrong_payload, Postcondition, Verdict, WriteFacts, WriteHost, WriteTarget,
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
    Rebase,
}

impl Sequencer {
    fn plan(&self) -> GitPlan {
        match self {
            Sequencer::Merge => refyard_core::plan::merge::plan_merge_in_progress(),
            Sequencer::Revert => refyard_core::plan::replay::plan_revert_in_progress(),
            Sequencer::CherryPick => refyard_core::plan::replay::plan_cherry_pick_in_progress(),
            Sequencer::Rebase => refyard_core::plan::replay::plan_rebase_in_progress(),
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Sequencer::Merge => "merge",
            Sequencer::Revert => "revert",
            Sequencer::CherryPick => "cherry-pick",
            Sequencer::Rebase => "rebase",
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
    let target = match host.resolve(request.request).await {
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

/// `git rebase <upstreamOid>` — replay this branch's own commits onto upstream.
pub struct RebaseEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for RebaseEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Rebase
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { rebase(&host, &request).await })
    }
}

/// `git rebase --onto <parent> <oid>` — drop one commit from the checked-out branch.
pub struct DropCommitEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for DropCommitEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::DropCommit
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { drop_commit(&host, &request).await })
    }
}

/// `git reset --soft HEAD^` + `git commit --amend` — fold the top commit down.
pub struct SquashCommitEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for SquashCommitEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::SquashCommit
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { squash_commit(&host, &request).await })
    }
}

const EVERY_SEQUENCER: &[Sequencer] = &[
    Sequencer::Merge,
    Sequencer::Revert,
    Sequencer::CherryPick,
    Sequencer::Rebase,
];

/// Reads a probe's stdout, for the one probe whose answer is an object name.
async fn probe_stdout(target: &WriteTarget, plan: &GitPlan) -> Option<String> {
    let outcome = target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            plan,
            None,
        )
        .await
        .ok()?;
    if !clean_exit(&outcome) {
        return None;
    }
    let text = String::from_utf8(outcome.stdout).ok()?;
    Some(text.trim().to_string())
}

/// The shared stop judgement of a replaying command: a completed non-zero exit that
/// left the rebase standing is a conflict when the index holds unmerged paths, and a
/// pause nothing can advance (an empty patch) is aborted rather than handed over.
async fn judge_rebase_stop(
    operation_id: &str,
    target: &WriteTarget,
    outcome: &RunOutcome,
    noun: &str,
) -> Option<EffectOutcome> {
    if !(outcome.state == ExecutionState::Completed
        && outcome.output_complete
        && outcome.exit_code != Some(0))
    {
        return None;
    }
    if probe(
        target,
        &refyard_core::plan::replay::plan_rebase_in_progress(),
    )
    .await
        != Some(true)
    {
        return None;
    }
    let diagnostic = diagnostic_of(outcome);
    match conflicted_count(target).await {
        Some(count) if count > 0 => {
            let plural = if count == 1 { "path" } else { "paths" };
            let mut problem = Problem::new(
                ProblemCode::NeedsAttention,
                format!(
                    "the {noun} stopped with conflicts: {count} conflicted {plural}; resolve them, stage the resolution, and continue the {noun} or abort it"
                ),
            )
            .with_detail("diagnostic", DetailValue::Text(diagnostic));
            problem = problem.with_detail("conflictedPaths", DetailValue::Integer(count as i64));
            Some(EffectOutcome::NeedsAttention { problem })
        }
        _ => {
            let abort = refyard_core::plan::replay::plan_rebase_abort();
            if probe(target, &abort).await.is_none() {
                return Some(effect_outcome(
                    Verdict::Unknown {
                        reason: format!("the stopped {noun}'s abort did not report cleanly"),
                        problem: super::unknown_problem(
                            "git rebase --abort",
                            "the stopped rebase could not be confirmed aborted; whether the branch was restored is not known, and nothing was retried",
                        ),
                    },
                    noun.to_string(),
                    None,
                ));
            }
            Some(refused(
                operation_id,
                Problem::new(
                    ProblemCode::Conflict,
                    format!(
                        "the {noun} stopped for a reason this build does not model and was aborted, so the branch is unchanged: {diagnostic}"
                    ),
                ),
            ))
        }
    }
}

async fn rebase(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Rebase { upstream_oid } = &request.request.operation else {
        return wrong_payload(operation_id, "rebase");
    };
    let plan = match refyard_core::plan::replay::plan_rebase(upstream_oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) = match prepare_for_replay(operation_id, host, request).await {
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
    if let Some(stop) = judge_rebase_stop(operation_id, &target, &outcome, "rebase").await {
        return stop;
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_or_not_started(
        "git rebase",
        &outcome,
        &before,
        after.as_ref(),
        Postcondition::IndexMayBeUnchanged,
    );
    let summary = match &verdict {
        Verdict::Succeeded { new_head_oid } => {
            if new_head_oid.as_deref() == before.head.oid.as_deref() {
                "rebase: already up to date".to_string()
            } else {
                format!("rebased onto {upstream_oid}")
            }
        }
        _ => "rebase".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn drop_commit(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::DropCommit { oid, .. } = &request.request.operation else {
        return wrong_payload(operation_id, "dropCommit");
    };
    let plan = match refyard_core::plan::replay::plan_drop_commit_ancestry(oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) = match prepare_for_replay(operation_id, host, request).await {
        Ok(prepared) => prepared,
        Err(outcome) => return outcome,
    };

    // The commit must be this branch's history: dropping a foreign commit would
    // rewrite the branch onto a base it never had.
    if probe(&target, &plan).await != Some(true) {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::InvalidRequest,
                "that commit is not on the checked-out branch, so it cannot be dropped from it",
            ),
        );
    }
    // A merge cannot be replayed linearly; a second parent is the merge marker.
    let second_parent = match refyard_core::plan::replay::plan_drop_commit_second_parent(oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    if probe(&target, &second_parent).await == Some(true) {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "that commit is a merge; dropping it is not a decision this build makes",
            ),
        );
    }
    // The parent is what the descendants replay onto; the branch root has none.
    let parent_plan = match refyard_core::plan::replay::plan_drop_commit_parent(oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let Some(parent_oid) = probe_stdout(&target, &parent_plan).await else {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::InvalidRequest,
                "that commit has no parent — it is the branch's first commit, and dropping it would remove the branch's base",
            ),
        );
    };
    let rebase_plan = match refyard_core::plan::replay::plan_drop_commit_rebase(oid, &parent_oid) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };

    let outcome = match target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &rebase_plan,
            None,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Some(stop) = judge_rebase_stop(operation_id, &target, &outcome, "drop's replay").await {
        return stop;
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_or_not_started(
        "git rebase --onto",
        &outcome,
        &before,
        after.as_ref(),
        Postcondition::IndexMayBeUnchanged,
    );
    let summary = match &verdict {
        Verdict::Succeeded { .. } => format!("dropped {oid}"),
        _ => "drop commit".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn squash_commit(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::SquashCommit { message } = &request.request.operation else {
        return wrong_payload(operation_id, "squashCommit");
    };
    let amend = match refyard_core::plan::commit::plan_amend_commit(
        message.as_deref().map(str::as_bytes),
    ) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let (target, before) = match prepare_for_replay(operation_id, host, request).await {
        Ok(prepared) => prepared,
        Err(outcome) => return outcome,
    };
    if before.head.oid.is_none() {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "this branch has no commits yet, so there is nothing to squash",
            ),
        );
    }
    // A top commit whose tree equals its parent's would squash into a pointless
    // rewrite; exit 1 means there are changes to fold, and any other exit (HEAD^ not
    // resolving on a single-commit branch) is the soft reset's own refusal to state.
    let empty_probe = refyard_core::plan::GitPlan::read(vec![
        "diff".to_string(),
        "--quiet".to_string(),
        "HEAD^".to_string(),
        "HEAD".to_string(),
    ]);
    let empty_outcome = target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &empty_probe,
            None,
        )
        .await;
    if let Ok(outcome) = &empty_outcome {
        if outcome.state == ExecutionState::Completed
            && outcome.output_complete
            && outcome.exit_code == Some(0)
        {
            return refused(
                operation_id,
                Problem::new(
                    ProblemCode::Conflict,
                    "the top commit adds no changes over its parent, so there is nothing to squash",
                ),
            );
        }
    }

    let reset = refyard_core::plan::commit::plan_squash_soft_reset();
    let reset_outcome = match target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &reset,
            None,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if reset_outcome.state == ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git reset", &reset_outcome),
            },
            "squash commit".to_string(),
            None,
        );
    }
    // From here the branch is at the parent and the combined change is staged — a
    // state that is known and visible, so the commit step is judged against the
    // facts the reset produced, not the ones the request was prepared against.
    let Some(after_reset) = host.read_facts(&target).await.ok() else {
        return effect_outcome(
            Verdict::Unknown {
                reason: "the soft reset could not be confirmed by a re-read".to_string(),
                problem: super::unknown_problem(
                    "git reset --soft",
                    "the branch moved but the repository could not be re-read; whether the squash completed is not known, and nothing was retried",
                ),
            },
            "squash commit".to_string(),
            None,
        );
    };
    let commit_outcome = match target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &amend,
            None,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if commit_outcome.state == ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git commit", &commit_outcome),
            },
            "squash commit".to_string(),
            None,
        );
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git commit --amend",
        Postcondition::HeadMustMove,
        &commit_outcome,
        &after_reset,
        after.as_ref(),
    );
    let summary = match &verdict {
        Verdict::Succeeded { new_head_oid } => match new_head_oid {
            Some(head) => format!("squashed the top commit into its parent as {head}"),
            None => "squashed the top commit into its parent".to_string(),
        },
        Verdict::Failed { problem } if problem.code == ProblemCode::GitCommandFailed => {
            format!(
                "the soft reset landed but the combined commit was refused: {}; the branch is at the parent with the combined change staged",
                problem.message
            )
        }
        _ => "squash commit".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn prepare_for_replay(
    operation_id: &str,
    host: &Arc<WriteHost>,
    request: &EffectRequest<'_>,
) -> Result<(WriteTarget, WriteFacts), EffectOutcome> {
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return Err(refused(operation_id, problem)),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return Err(refused(operation_id, problem)),
    };
    for state in EVERY_SEQUENCER {
        match probe(&target, &state.plan()).await {
            None => {
                return Err(refused(
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
                return Err(refused(
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
    Ok((target, before))
}

/// The count clause of a conflicted message, singular when there is exactly one path.
fn conflicted_clause(count: u64) -> String {
    if count == 1 {
        "1 conflicted path;".to_string()
    } else {
        format!("{count} conflicted paths;")
    }
}
