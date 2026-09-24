//! Creating a linked worktree: `git worktree add` in its three checkout forms.
//!
//! The destination is the repository's approved root plus a confined relative path (no
//! `..`, never absolute), so a new worktree can only land inside the approved root. `add`
//! never forces and never re-checks-out a branch already checked out elsewhere — Git's
//! own refusal is reported as-is.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation, WorktreeReference};

use super::remotes::{network_failure, run_step, succeeded};
use super::{clean_exit, invalid_payload, refused, wrong_payload, WriteHost};

/// `git worktree add` — check out an existing branch, a new branch at a commit, or a
/// detached commit, at a destination inside the repository's approved root.
pub struct CreateWorktreeEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for CreateWorktreeEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::CreateWorktree
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { create_worktree(&host, &request).await })
    }
}

async fn create_worktree(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::CreateWorktree {
        relative_destination,
        reference,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "createWorktree");
    };
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    // The destination is the approved root plus the request's relative path. Confined
    // (no `..`, never absolute), so the join cannot leave the root.
    if let Err(error) =
        refyard_core::plan::submodules::validated_relative_path(relative_destination)
    {
        return invalid_payload(operation_id, error.to_string());
    }
    let joined = target.record.root_path.join(relative_destination);
    let destination = match joined.to_str() {
        Some(text) => text.to_string(),
        None => {
            return refused(
                operation_id,
                Problem::new(
                    ProblemCode::UnsupportedPathEncoding,
                    "the worktree destination's bytes cannot be represented on this host",
                ),
            )
        }
    };
    let planned = match reference {
        WorktreeReference::ExistingBranch { branch_name } => {
            refyard_core::plan::worktrees::plan_worktree_add_existing(&destination, branch_name)
        }
        WorktreeReference::NewBranch {
            branch_name,
            start_oid,
        } => refyard_core::plan::worktrees::plan_worktree_add_new_branch(
            &destination,
            branch_name,
            start_oid,
        ),
        WorktreeReference::Detached { oid } => {
            refyard_core::plan::worktrees::plan_worktree_add_detached(&destination, oid)
        }
    };
    let plan = match planned {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    // Creating a linked worktree leaves this repository's HEAD where it was.
    let head = before.head.oid.clone();
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded(
            format!("created a worktree at {relative_destination}"),
            head,
        );
    }
    // `worktree add` is local: a real refusal (branch checked out elsewhere, destination
    // taken) is failed; an unfinished run is unknown and never retried.
    network_failure(operation_id, "git worktree add", &outcome)
}
