//! Stash operations: create, apply, pop and drop one entry.
//!
//! The safety-critical rule is that `stash@{n}` is a *position in a reflog*, not a
//! stable identifier. Anyone's `git stash` — including the user's own terminal —
//! shifts every position after it. So apply, pop and drop first re-resolve the
//! locator through `rev-parse <locator>^{commit}` and compare the object name to the
//! one the request carried; a mismatch is a stale request and refuses rather than
//! acting on a different entry. `pop` and `drop` are destructive and gate on an
//! explicit `confirmed`, and `pop` drops only when Git applied cleanly — a conflicted
//! pop leaves the entry in place, which this module reports as `needsAttention` (work
//! for a human) rather than a failure that would suggest nothing happened.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;
use refyard_core::outcome::{ExecutionState, RunOutcome};

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::{
    clean_exit, conflicted_count, diagnostic_of, invalid_payload, refusal_problem, refused,
    require_confirmed, result_of, unknown_problem, wrong_payload, WriteHost, WriteTarget,
};

/// `git stash push` — save the working-tree changes.
pub struct CreateStashEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git stash apply` — restore an entry and keep it.
pub struct ApplyStashEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git stash pop` — restore and drop, but only on a clean apply.
pub struct PopStashEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git stash drop` — discard one entry. Destructive.
pub struct DropStashEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for CreateStashEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::CreateStash
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { create_stash(&host, &request).await })
    }
}

impl MutationEffect for ApplyStashEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::ApplyStash
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { apply_stash(&host, &request).await })
    }
}

impl MutationEffect for PopStashEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::PopStash
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { pop_stash(&host, &request).await })
    }
}

impl MutationEffect for DropStashEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::DropStash
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { drop_stash(&host, &request).await })
    }
}

/// Where a stash locator points now, versus the object the request named.
enum LocatorCheck {
    Matches,
    Moved,
    Unresolvable,
}

/// Re-resolve the locator and compare it to the object the request carried.
async fn check_stash_locator(target: &WriteTarget, locator: &str, oid: &str) -> LocatorCheck {
    let Ok(plan) = refyard_core::plan::commit::plan_stash_resolve(locator) else {
        return LocatorCheck::Unresolvable;
    };
    let Ok(outcome) = target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &plan,
            None,
        )
        .await
    else {
        return LocatorCheck::Unresolvable;
    };
    if !clean_exit(&outcome) {
        return LocatorCheck::Unresolvable;
    }
    // The object name is ASCII hex plus a newline; byte-level extraction is exact.
    let text = String::from_utf8(outcome.stdout).unwrap_or_default();
    let resolved = text.split(['\n', '\r']).next().unwrap_or("").trim();
    if resolved == oid {
        LocatorCheck::Matches
    } else {
        LocatorCheck::Moved
    }
}

/// The refusal a locator mismatch carries: a stale request, never a different entry.
fn locator_problem(operation_id: &str, check: LocatorCheck) -> Option<EffectOutcome> {
    match check {
        LocatorCheck::Matches => None,
        LocatorCheck::Unresolvable => Some(refused(
            operation_id,
            Problem::new(
                ProblemCode::NotFound,
                "that stash entry no longer exists; reload the stash list",
            ),
        )),
        LocatorCheck::Moved => Some(refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "the stash list moved since this request was prepared, and the locator now points at a different entry; reload and select the stash again",
            ),
        )),
    }
}

/// Reads back the current head so a success can name it (stash leaves HEAD alone, so
/// this is the same oid the request was prepared against — reported as evidence, not
/// as a claim that anything moved).
async fn head_oid(target: &WriteTarget) -> Option<String> {
    probe_head(target).await
}

async fn probe_head(target: &WriteTarget) -> Option<String> {
    let plan = refyard_core::plan::GitPlan::read(vec!["rev-parse".to_string(), "HEAD".to_string()]);
    let outcome = target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            &plan,
            None,
        )
        .await
        .ok()?;
    if !clean_exit(&outcome) {
        return None;
    }
    let text = String::from_utf8(outcome.stdout).unwrap_or_default();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// A started-but-not-clean run's outcome, without a conflict case: a clean non-zero
/// is a refusal, and a timeout, signal or truncated stream is `unknown` because the
/// change may be half-applied and is never retried.
fn started_failure(
    operation_id: &str,
    command: &'static str,
    outcome: &RunOutcome,
) -> EffectOutcome {
    let finished = outcome.state == ExecutionState::Completed && outcome.output_complete;
    if finished {
        refused(operation_id, refusal_problem(command, outcome))
    } else {
        EffectOutcome::Unknown {
            reason: format!("{command} did not finish cleanly"),
            problem: unknown_problem(
                command,
                "the command did not finish cleanly; whether it changed anything is not known, and nothing was retried",
            )
            .for_operation(operation_id.to_string()),
        }
    }
}

fn succeeded(summary: String, new_head_oid: Option<String>) -> EffectOutcome {
    EffectOutcome::Succeeded {
        result: result_of(summary, None, new_head_oid),
    }
}

fn needs_attention(operation_id: &str, message: String) -> EffectOutcome {
    EffectOutcome::NeedsAttention {
        problem: Problem::new(ProblemCode::NeedsAttention, message)
            .for_operation(operation_id.to_string()),
    }
}

async fn create_stash(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::CreateStash {
        message,
        include_untracked,
        keep_index,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "createStash");
    };
    let plan = match refyard_core::plan::commit::plan_stash_push(
        message.as_deref(),
        *include_untracked,
        *keep_index,
    ) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
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
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git stash push", &outcome));
    }
    if clean_exit(&outcome) {
        let head = head_oid(&target).await;
        let label = message
            .as_deref()
            .and_then(|m| m.split('\n').next())
            .map(|first| format!(" ({first})"))
            .unwrap_or_default();
        return succeeded(format!("created a stash{label}"), head);
    }
    started_failure(operation_id, "git stash push", &outcome)
}

async fn apply_stash(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::ApplyStash {
        stash,
        restore_index,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "applyStash");
    };
    let plan = match refyard_core::plan::commit::plan_stash_apply(&stash.locator, *restore_index) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Some(mismatch) = locator_problem(
        operation_id,
        check_stash_locator(&target, &stash.locator, &stash.oid).await,
    ) {
        return mismatch;
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
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git stash apply", &outcome));
    }
    if clean_exit(&outcome) {
        let head = head_oid(&target).await;
        return succeeded(
            format!("applied {}; the stash is kept", stash.locator),
            head,
        );
    }
    // A clean non-zero: a conflicted apply leaves conflicts for a human and keeps the
    // entry; anything else is Git refusing outright.
    let finished = outcome.state == ExecutionState::Completed && outcome.output_complete;
    if finished {
        let conflicts = conflicted_count(&target).await.unwrap_or(0);
        if conflicts > 0 {
            let plural = if conflicts == 1 { "path" } else { "paths" };
            return needs_attention(
                operation_id,
                format!(
                    "the apply left conflicts in the working tree and the stash is kept (nothing was dropped): {conflicts} conflicted {plural}: {}",
                    diagnostic_of(&outcome)
                ),
            );
        }
    }
    started_failure(operation_id, "git stash apply", &outcome)
}

async fn pop_stash(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::PopStash {
        stash,
        restore_index,
        confirmed,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "popStash");
    };
    if let Err(outcome) = require_confirmed(operation_id, *confirmed, "pop a stash") {
        return outcome;
    }
    let plan = match refyard_core::plan::commit::plan_stash_pop(&stash.locator, *restore_index) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Some(mismatch) = locator_problem(
        operation_id,
        check_stash_locator(&target, &stash.locator, &stash.oid).await,
    ) {
        return mismatch;
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
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git stash pop", &outcome));
    }
    if clean_exit(&outcome) {
        let head = head_oid(&target).await;
        return succeeded(
            format!("popped {}; the entry was dropped", stash.locator),
            head,
        );
    }
    let finished = outcome.state == ExecutionState::Completed && outcome.output_complete;
    if finished {
        let conflicts = conflicted_count(&target).await.unwrap_or(0);
        if conflicts > 0 {
            // Git's own rule is that a conflicted pop leaves the entry in place; the
            // re-check is what makes "still there" evidence rather than a belief.
            let preserved = matches!(
                check_stash_locator(&target, &stash.locator, &stash.oid).await,
                LocatorCheck::Matches
            );
            let diagnostic = diagnostic_of(&outcome);
            let message = if preserved {
                format!(
                    "the pop left conflicts in the working tree and the stash is still there (nothing was dropped): {diagnostic}"
                )
            } else {
                format!(
                    "the pop left conflicts and the stash could no longer be found afterwards — check the stash list before retrying: {diagnostic}"
                )
            };
            return needs_attention(operation_id, message);
        }
    }
    // A timeout or signal on a pop is unknown: whether it applied (or dropped) is not
    // known, and nothing is ever continued past it.
    started_failure(operation_id, "git stash pop", &outcome)
}

async fn drop_stash(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::DropStash { stash, confirmed } = &request.request.operation else {
        return wrong_payload(operation_id, "dropStash");
    };
    if let Err(outcome) = require_confirmed(operation_id, *confirmed, "drop a stash") {
        return outcome;
    }
    let plan = match refyard_core::plan::commit::plan_stash_drop(&stash.locator) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let target = match host.resolve(request.request).await {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Some(mismatch) = locator_problem(
        operation_id,
        check_stash_locator(&target, &stash.locator, &stash.oid).await,
    ) {
        return mismatch;
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
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git stash drop", &outcome));
    }
    if clean_exit(&outcome) {
        let head = head_oid(&target).await;
        return succeeded(format!("dropped {}", stash.locator), head);
    }
    started_failure(operation_id, "git stash drop", &outcome)
}
