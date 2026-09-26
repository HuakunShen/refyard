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
use super::{
    clean_exit, invalid_payload, refused, require_confirmed, wrong_payload, WriteHost, WriteTarget,
};

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
    let target = match host.resolve(request.request).await {
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

/// `git worktree lock` — lock a linked worktree, with an optional reason.
pub struct LockWorktreeEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git worktree unlock` — unlock a locked worktree.
pub struct UnlockWorktreeEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for LockWorktreeEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::LockWorktree
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { lock_worktree(&host, &request).await })
    }
}

impl MutationEffect for UnlockWorktreeEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::UnlockWorktree
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { unlock_worktree(&host, &request).await })
    }
}

/// Resolve a host-minted worktree id to the live worktree it names.
///
/// The id is a deterministic function of the path (`worktree_id_for_path`), so this reads
/// `git worktree list` and matches — no registry to go stale. A worktree that is gone (or
/// an id this repository never had) is `not found`, not a guess.
async fn resolve_worktree_entry(
    target: &WriteTarget,
    worktree_id: &str,
) -> Result<refyard_core::plan::worktrees::WorktreeEntry, Problem> {
    let outcome = run_step(target, &refyard_core::plan::worktrees::plan_worktree_list()).await?;
    if !clean_exit(&outcome) {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "could not list this repository's worktrees; nothing was changed",
        ));
    }
    for entry in refyard_core::plan::worktrees::parse_worktree_list(&outcome.stdout) {
        if refyard_core::plan::worktrees::worktree_id_for_path(&entry.path) == worktree_id {
            return Ok(entry);
        }
    }
    Err(Problem::new(
        ProblemCode::NotFound,
        format!("no worktree {worktree_id} in this repository; reload the worktrees and retry"),
    ))
}

async fn lock_worktree(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::LockWorktree {
        worktree_id,
        reason,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "lockWorktree");
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let entry = match resolve_worktree_entry(&target, worktree_id).await {
        Ok(entry) => entry,
        Err(problem) => return refused(operation_id, problem),
    };
    if entry.locked {
        return refused(
            operation_id,
            Problem::new(ProblemCode::Conflict, "that worktree is already locked"),
        );
    }
    let plan =
        match refyard_core::plan::worktrees::plan_worktree_lock(&entry.path, reason.as_deref()) {
            Ok(plan) => plan,
            Err(error) => return invalid_payload(operation_id, error.to_string()),
        };
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded("locked the worktree".to_string(), None);
    }
    network_failure(operation_id, "git worktree lock", &outcome)
}

async fn unlock_worktree(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::UnlockWorktree { worktree_id } = &request.request.operation else {
        return wrong_payload(operation_id, "unlockWorktree");
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let entry = match resolve_worktree_entry(&target, worktree_id).await {
        Ok(entry) => entry,
        Err(problem) => return refused(operation_id, problem),
    };
    if !entry.locked {
        return refused(
            operation_id,
            Problem::new(ProblemCode::Conflict, "that worktree is not locked"),
        );
    }
    let plan = match refyard_core::plan::worktrees::plan_worktree_unlock(&entry.path) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded("unlocked the worktree".to_string(), None);
    }
    network_failure(operation_id, "git worktree unlock", &outcome)
}

/// `git worktree remove` — remove a clean, non-primary, unlocked linked worktree.
pub struct RemoveWorktreeEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for RemoveWorktreeEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::RemoveWorktree
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { remove_worktree(&host, &request).await })
    }
}

async fn remove_worktree(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::RemoveWorktree {
        worktree_id,
        confirmed,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "removeWorktree");
    };
    // Removing a worktree is destructive: it takes an explicit confirmation.
    if let Err(outcome) = require_confirmed(operation_id, *confirmed, "removing a worktree") {
        return outcome;
    }
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let entry = match resolve_worktree_entry(&target, worktree_id).await {
        Ok(entry) => entry,
        Err(problem) => return refused(operation_id, problem),
    };
    if entry.is_primary {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::InvalidRequest,
                "the main worktree cannot be removed",
            ),
        );
    }
    if entry.locked {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "that worktree is locked; unlock it before removing it",
            ),
        );
    }
    // Back up what can be lost first: the commit and branch the worktree holds are the
    // recreation info. A clean worktree's files are all in Git, so this is everything
    // needed to rebuild it — and if it cannot be read, the remove fails closed rather
    // than destroying something that could not be restored.
    let Some(head_oid) = entry.head_oid.clone() else {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::NeedsAttention,
                "could not read the worktree's commit to back it up; nothing was removed",
            ),
        );
    };
    let what = match &entry.branch {
        Some(branch) => format!("it held {head_oid} on {branch}"),
        None => format!("it held {head_oid}"),
    };
    let plan = match refyard_core::plan::worktrees::plan_worktree_remove(&entry.path) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded(format!("removed the worktree ({what})"), None);
    }
    // Never forced: Git's own refusal (a dirty worktree — untracked or uncommitted files)
    // is reported as-is, and no recursive delete is ever attempted in its place. An
    // unfinished run is unknown and never retried.
    network_failure(operation_id, "git worktree remove", &outcome)
}
