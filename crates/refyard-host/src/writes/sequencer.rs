//! Ending the stopped writes: continue and abort for merge, cherry-pick and rebase.
//!
//! These six effects exist so a conflict is a state the UI can walk the user through
//! rather than a dead end. Each pair ends only its own operation — the precondition
//! layer allows exactly that pair to run while it stands — and each refuses when
//! nothing stands, which is the honest answer to "continue" with nothing to continue.
//!
//! The commit-shaped continues (`commit` for a merge, `cherry-pick --continue` for a
//! pick) run the user's hooks exactly as any commit does; the rebase's resume carries
//! the process-scoped `core.editor=true` the planner spells, because a bare continue
//! would open an editor this host does not have.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::{
    classify_write, effect_outcome, invalid_payload, probe, refused, wrong_payload, Postcondition,
    Verdict, WriteHost,
};

/// `git commit` — the step that records a resolved merge.
pub struct ContinueMergeEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git merge --abort`.
pub struct AbortMergeEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git cherry-pick --continue`.
pub struct ContinueCherryPickEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git cherry-pick --abort`.
pub struct AbortCherryPickEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git -c core.editor=true rebase --continue`.
pub struct ContinueRebaseEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git rebase --abort`.
pub struct AbortRebaseEffect {
    pub(super) host: Arc<WriteHost>,
}

macro_rules! sequencer_effect {
    ($effect:ty, $kind:expr, $run:ident) => {
        impl MutationEffect for $effect {
            fn kind(&self) -> MutationKind {
                $kind
            }

            fn run<'a>(
                &'a self,
                request: EffectRequest<'a>,
            ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
                let host = Arc::clone(&self.host);
                Box::pin(async move { $run(&host, &request).await })
            }
        }
    };
}

sequencer_effect!(
    ContinueMergeEffect,
    MutationKind::ContinueMerge,
    continue_merge
);
sequencer_effect!(AbortMergeEffect, MutationKind::AbortMerge, abort_merge);
sequencer_effect!(
    ContinueCherryPickEffect,
    MutationKind::ContinueCherryPick,
    continue_cherry_pick
);
sequencer_effect!(
    AbortCherryPickEffect,
    MutationKind::AbortCherryPick,
    abort_cherry_pick
);
sequencer_effect!(
    ContinueRebaseEffect,
    MutationKind::ContinueRebase,
    continue_rebase
);
sequencer_effect!(AbortRebaseEffect, MutationKind::AbortRebase, abort_rebase);

/// `git rev-parse --verify --quiet <marker>` for the three markers this build starts.
fn standing_plan(marker: &str) -> refyard_core::plan::GitPlan {
    refyard_core::plan::GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        marker.to_string(),
    ])
}

/// Requires the named marker to stand, refusing with the Node reference's words when
/// nothing does — "continue" with nothing to continue is a caller mistake, not a no-op.
async fn require_standing(
    operation_id: &str,
    target: &super::WriteTarget,
    marker: &str,
    noun: &str,
) -> Result<(), EffectOutcome> {
    match probe(target, &standing_plan(marker)).await {
        None => Err(refused(
            operation_id,
            Problem::new(
                ProblemCode::Unavailable,
                format!(
                    "whether a {noun} is in progress could not be read, so the operation was not started"
                ),
            ),
        )),
        Some(false) => Err(refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                format!("no {noun} is in progress in this worktree, so there is nothing to continue or abort"),
            ),
        )),
        Some(true) => Ok(()),
    }
}

async fn run_plan(
    host: &Arc<WriteHost>,
    request: &EffectRequest<'_>,
    plan: &refyard_core::plan::GitPlan,
    command: &'static str,
    postcondition: Postcondition,
    summary: String,
) -> EffectOutcome {
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(request.operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(request.operation_id, problem),
    };
    let outcome = match target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            plan,
            None,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(problem) => return refused(request.operation_id, problem),
    };
    if outcome.state == refyard_core::outcome::ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem(command, &outcome),
            },
            summary,
            None,
        );
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(command, postcondition, &outcome, &before, after.as_ref());
    effect_outcome(verdict, summary, None)
}

async fn continue_merge(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::ContinueMerge { message } = &request.request.operation else {
        return wrong_payload(operation_id, "continueMerge");
    };
    let plan =
        match refyard_core::plan::merge::plan_merge_continue(message.as_deref().map(str::as_bytes))
        {
            Ok(plan) => plan,
            Err(error) => return invalid_payload(operation_id, error.to_string()),
        };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) = require_standing(operation_id, &target, "MERGE_HEAD", "merge").await {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git commit",
        Postcondition::HeadMustMove,
        "completed the merge".to_string(),
    )
    .await
}

async fn abort_merge(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AbortMerge { .. } = &request.request.operation else {
        return wrong_payload(operation_id, "abortMerge");
    };
    let plan = refyard_core::plan::merge::plan_merge_abort();
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) = require_standing(operation_id, &target, "MERGE_HEAD", "merge").await {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git merge --abort",
        Postcondition::IndexMayBeUnchanged,
        "aborted the merge; the branch is where it started".to_string(),
    )
    .await
}

async fn continue_cherry_pick(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::ContinueCherryPick {} = &request.request.operation else {
        return wrong_payload(operation_id, "continueCherryPick");
    };
    let plan = refyard_core::plan::replay::plan_cherry_pick_continue();
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) =
        require_standing(operation_id, &target, "CHERRY_PICK_HEAD", "cherry-pick").await
    {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git cherry-pick --continue",
        Postcondition::HeadMustMove,
        "completed the cherry-pick with the original message".to_string(),
    )
    .await
}

async fn abort_cherry_pick(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AbortCherryPick { .. } = &request.request.operation else {
        return wrong_payload(operation_id, "abortCherryPick");
    };
    let plan = refyard_core::plan::replay::plan_cherry_pick_abort();
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) =
        require_standing(operation_id, &target, "CHERRY_PICK_HEAD", "cherry-pick").await
    {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git cherry-pick --abort",
        Postcondition::IndexMayBeUnchanged,
        "aborted the cherry-pick; the branch is where it started".to_string(),
    )
    .await
}

async fn continue_rebase(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::ContinueRebase {} = &request.request.operation else {
        return wrong_payload(operation_id, "continueRebase");
    };
    let plan = refyard_core::plan::replay::plan_rebase_continue();
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) = require_standing(operation_id, &target, "REBASE_HEAD", "rebase").await {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git rebase --continue",
        Postcondition::IndexMayBeUnchanged,
        "resumed the rebase".to_string(),
    )
    .await
}

async fn abort_rebase(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AbortRebase { .. } = &request.request.operation else {
        return wrong_payload(operation_id, "abortRebase");
    };
    let plan = refyard_core::plan::replay::plan_rebase_abort();
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(outcome) = require_standing(operation_id, &target, "REBASE_HEAD", "rebase").await {
        return outcome;
    }
    run_plan(
        host,
        request,
        &plan,
        "git rebase --abort",
        Postcondition::IndexMayBeUnchanged,
        "aborted the rebase; the branch is where it started".to_string(),
    )
    .await
}
