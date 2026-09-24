//! One commit: the index as it stands, with the message the user wrote.
//!
//! The command is the planner's; this module adds the two checks the exit code cannot
//! make. Before it runs, the index must hold something to commit — an empty commit is not
//! offered by this build, and `git commit` on a clean index is a confusing failure for a
//! state the host can name. After it runs, HEAD is read back: a commit that exists while
//! Git complained (a failing post-commit hook, a signer that exited non-zero) is
//! `needsAttention` with the complaint kept, not a failure and not a success; a clean exit
//! whose HEAD did not move is `unknown`, because Git said something the repository does
//! not show.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use refyard_core::outcome::ExecutionState;

use super::{
    classify_write, clean_exit, diagnostic_of, effect_outcome, invalid_payload, refusal_problem,
    refused, require_confirmed, wrong_payload, Postcondition, Verdict, WriteHost,
};

/// `git commit --cleanup=verbatim --file=-` over the current index.
pub struct CommitEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for CommitEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Commit
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { commit(&host, &request).await })
    }
}

/// `git commit --amend` over the tip commit.
///
/// Amending rewrites history, so it is confirmed and it never runs during a stopped
/// merge, cherry-pick or rebase. The rewrite is judged against HEAD: a hook that
/// complains after the new commit exists is `needsAttention` (the rewrite is real, the
/// complaint is kept), and a clean exit whose HEAD did not move is `unknown`.
pub struct AmendCommitEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for AmendCommitEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::AmendCommit
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { amend_commit(&host, &request).await })
    }
}

async fn amend_commit(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AmendCommit { message, confirmed } = &request.request.operation else {
        return wrong_payload(operation_id, "amendCommit");
    };
    if let Err(outcome) = require_confirmed(operation_id, *confirmed, "amend the tip commit") {
        return outcome;
    }
    let plan = match refyard_core::plan::commit::plan_amend_commit(
        message.as_deref().map(str::as_bytes),
    ) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    // There must be a tip commit to rewrite. On an unborn branch Git's own error would
    // be cryptic; naming it here is the honest answer to "amend" with nothing there.
    if before.head.oid.is_none() {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "this branch has no commits yet, so there is nothing to amend",
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
    let after = host.read_facts(&target).await.ok();
    let new_head = after
        .as_ref()
        .and_then(|facts| facts.head.oid.clone())
        .or_else(|| before.head.oid.clone());
    // An amend rewrites the tip, but a rewrite that reproduces a byte-identical commit
    // (nothing changed and the timestamps collided) leaves HEAD unmoved — that is a
    // success, not uncertainty. What must never be called success is a rewrite that
    // moved HEAD while Git complained (a failing post-commit hook or signer): the new
    // commit is real and the complaint is kept for the user.
    if clean_exit(&outcome) {
        let summary = match &new_head {
            Some(oid) => format!("amended the tip commit (history rewritten) as {oid}"),
            None => "amended the tip commit".to_string(),
        };
        return effect_outcome(
            Verdict::Succeeded {
                new_head_oid: new_head,
            },
            summary,
            None,
        );
    }
    let head_moved = after
        .as_ref()
        .map(|facts| facts.head.oid != before.head.oid)
        .unwrap_or(false);
    if outcome.state == ExecutionState::Completed && outcome.output_complete && head_moved {
        return EffectOutcome::NeedsAttention {
            problem: Problem::new(
                ProblemCode::NeedsAttention,
                format!(
                    "the tip was rewritten ({}) but git exited with a complaint: {}",
                    new_head.unwrap_or_default(),
                    diagnostic_of(&outcome)
                ),
            )
            .for_operation(operation_id.to_string()),
        };
    }
    refused(
        operation_id,
        refusal_problem("git commit --amend", &outcome),
    )
}

async fn commit(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Commit { message } = &request.request.operation else {
        return wrong_payload(operation_id, "commit");
    };
    // The payload is validated before anything is read: an empty or blank message is not
    // a commit this host can make, and Git would open an editor this host does not have.
    let plan = match refyard_core::plan::commit::plan_commit(message.as_bytes()) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    // Something must be staged. This is not a violation of "commit only the index" — it
    // is what makes that promise visible before Git runs, instead of an empty commit or
    // a bare "nothing to commit, working tree clean" relayed as a Git failure.
    let staged = before
        .records
        .iter()
        .any(|record| record.index_status != ".");
    if !staged {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "the index holds no change to commit; stage something first",
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
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git commit",
        Postcondition::HeadMustMove,
        &outcome,
        &before,
        after.as_ref(),
    );
    let head = match &verdict {
        super::Verdict::Succeeded { new_head_oid } => new_head_oid.clone(),
        _ => None,
    };
    let summary = match &head {
        Some(oid) => format!("created commit {oid}"),
        None => "created commit".to_string(),
    };
    effect_outcome(verdict, summary, None)
}
