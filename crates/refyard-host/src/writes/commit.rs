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

use super::{
    classify_write, effect_outcome, invalid_payload, refused, wrong_payload, Postcondition,
    WriteHost,
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
    let target = match host.resolve(request.request).await {
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
