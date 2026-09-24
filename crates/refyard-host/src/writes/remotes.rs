//! Remote configuration and the network writes: add/update/remove a remote, and
//! fetch/push/pull/pushTag over one explicit ref. The config writes never leave the
//! machine; the network writes contact exactly one named remote after its *configured*
//! URL has been safety-checked.
//!
//! The one security-critical rule is that a remote URL can name a *command* (Git's
//! `ext::` transport helper, an `--upload-pack=` option), so every URL is validated at
//! the planner before it can reach `git`. The one honesty-critical rule is partial
//! state: `updateRemote` runs up to three commands (rename, set fetch URL, set push
//! URL), and a later failure after an earlier success leaves the remote half-changed.
//! That is reported as `needsAttention` with a "re-read the remotes" instruction — a
//! bare `failed` would suggest nothing changed when the name may already have moved.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;
use refyard_core::outcome::{ExecutionState, RunOutcome};

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, FetchTagMode, MutationEffect, MutationOperation, PullMode};
use refyard_core::parse::network::parse_fetch_porcelain;

use super::{
    clean_exit, diagnostic_of, effect_outcome, invalid_payload, refusal_problem, refused,
    require_confirmed, unknown_problem, wrong_payload, Verdict, WriteHost, WriteTarget,
};

/// `git remote add <name> <fetchUrl>` (+ `set-url --push` when a push URL is given).
pub struct AddRemoteEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git remote rename` + `git remote set-url` as one update.
pub struct UpdateRemoteEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git remote remove <name>`. Removes remote-tracking refs; local branches survive.
pub struct RemoveRemoteEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for AddRemoteEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::AddRemote
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { add_remote(&host, &request).await })
    }
}

impl MutationEffect for UpdateRemoteEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::UpdateRemote
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { update_remote(&host, &request).await })
    }
}

impl MutationEffect for RemoveRemoteEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::RemoveRemote
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { remove_remote(&host, &request).await })
    }
}

/// Run one remote command in the target's worktree. `Err` is only a host failure to
/// start the executor; a started run comes back as its `RunOutcome` to classify.
async fn run_step(
    target: &WriteTarget,
    plan: &refyard_core::plan::GitPlan,
) -> Result<RunOutcome, Problem> {
    target
        .executor
        .try_run(
            target.record.location.canonical_worktree.as_str(),
            plan,
            None,
        )
        .await
}

fn succeeded(summary: String, head: Option<String>) -> EffectOutcome {
    effect_outcome(Verdict::Succeeded { new_head_oid: head }, summary, None)
}

fn partial(operation_id: &str, command: &'static str, outcome: &RunOutcome) -> EffectOutcome {
    EffectOutcome::NeedsAttention {
        problem: Problem::new(
            ProblemCode::NeedsAttention,
            format!(
                "the remote update did not complete: {}; the remote may have been renamed before the change failed — re-read the remotes",
                if diagnostic_of(outcome).trim().is_empty() {
                    format!("{command} exited without a diagnostic")
                } else {
                    diagnostic_of(outcome)
                }
            ),
        )
        .for_operation(operation_id.to_string()),
    }
}

async fn add_remote(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AddRemote {
        remote_name,
        fetch_url,
        push_url,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "addRemote");
    };
    let add = match refyard_core::plan::remotes::plan_remote_add(remote_name, fetch_url) {
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
    let head = before.head.oid.clone();

    let outcome = match run_step(&target, &add).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git remote add", &outcome));
    }
    if !clean_exit(&outcome) {
        // Nothing was added, so this is a plain refusal.
        return refused(operation_id, refusal_problem("git remote add", &outcome));
    }

    let Some(push_url) = push_url else {
        return succeeded(format!("added remote {remote_name}"), head);
    };
    // The push URL is a second command. A failure here leaves the remote added with a
    // fetch URL only — a real partial state, reported as such rather than as "failed".
    let set_push =
        match refyard_core::plan::remotes::plan_remote_set_url(remote_name, push_url, true) {
            Ok(plan) => plan,
            Err(error) => return invalid_payload(operation_id, error.to_string()),
        };
    let outcome = match run_step(&target, &set_push).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if !clean_exit(&outcome) {
        return EffectOutcome::NeedsAttention {
            problem: Problem::new(
                ProblemCode::NeedsAttention,
                format!(
                    "the remote {remote_name} was added with its fetch URL, but its push URL could not be set; re-read the remotes: {}",
                    diagnostic_of(&outcome)
                ),
            )
            .for_operation(operation_id.to_string()),
        };
    }
    succeeded(
        format!("added remote {remote_name} with a separate push URL"),
        head,
    )
}

async fn update_remote(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::UpdateRemote {
        remote_name,
        new_name,
        fetch_url,
        push_url,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "updateRemote");
    };
    if new_name.is_none() && fetch_url.is_none() && push_url.is_none() {
        return invalid_payload(
            operation_id,
            "a remote update must rename the remote or change a URL".to_string(),
        );
    }
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    let head = before.head.oid.clone();

    let mut current_name = remote_name.clone();
    let mut any_changed = false;

    // Rename first so the URL changes land under the final name.
    if let Some(new_name) = new_name {
        let plan = match refyard_core::plan::remotes::plan_remote_rename(remote_name, new_name) {
            Ok(plan) => plan,
            Err(error) => return invalid_payload(operation_id, error.to_string()),
        };
        match run_step(&target, &plan).await {
            Ok(outcome) if clean_exit(&outcome) => {
                any_changed = true;
                current_name = new_name.clone();
            }
            Ok(outcome) => {
                // The rename is the first action: it failing means nothing changed.
                return refused(operation_id, refusal_problem("git remote rename", &outcome));
            }
            Err(problem) => return refused(operation_id, problem),
        }
    }

    for (url, push, command) in [
        (fetch_url.as_ref(), false, "git remote set-url"),
        (push_url.as_ref(), true, "git remote set-url --push"),
    ] {
        let Some(url) = url else { continue };
        let plan = match refyard_core::plan::remotes::plan_remote_set_url(&current_name, url, push)
        {
            Ok(plan) => plan,
            Err(error) => return invalid_payload(operation_id, error.to_string()),
        };
        match run_step(&target, &plan).await {
            Ok(outcome) if clean_exit(&outcome) => any_changed = true,
            Ok(outcome) => {
                // An earlier step already changed the remote, so this is partial.
                return if any_changed {
                    partial(operation_id, command, &outcome)
                } else {
                    refused(operation_id, refusal_problem(command, &outcome))
                };
            }
            Err(problem) => return refused(operation_id, problem),
        }
    }

    succeeded(format!("updated remote {remote_name}"), head)
}

async fn remove_remote(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::RemoveRemote {
        remote_name,
        confirmed,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "removeRemote");
    };
    if let Err(outcome) = require_confirmed(operation_id, *confirmed, "remove a remote") {
        return outcome;
    }
    let plan = match refyard_core::plan::remotes::plan_remote_remove(remote_name) {
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
    let head = before.head.oid.clone();
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if outcome.state == ExecutionState::NotStarted {
        return refused(operation_id, refusal_problem("git remote remove", &outcome));
    }
    if !clean_exit(&outcome) {
        return refused(operation_id, refusal_problem("git remote remove", &outcome));
    }
    succeeded(format!("removed remote {remote_name}"), head)
}

/// `git push --porcelain --no-follow-tags` one explicit ref to one remote.
pub struct PushEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git fetch --porcelain` one remote: tracking refs only.
pub struct FetchEffect {
    pub(super) host: Arc<WriteHost>,
}

/// Pull as its two real halves — fetch, then `--ff-only` — keeping the facts separate.
pub struct PullEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for FetchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Fetch
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { fetch(&host, &request).await })
    }
}

impl MutationEffect for PullEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Pull
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { pull(&host, &request).await })
    }
}

/// `git push` one tag by name.
pub struct PushTagEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for PushEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Push
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { push(&host, &request).await })
    }
}

impl MutationEffect for PushTagEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::PushTag
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { push_tag(&host, &request).await })
    }
}

/// Refuse to contact a remote whose *configured* URL names a command.
///
/// A remote configured outside this app (a hand-edited `.git/config`, a shared repo)
/// could carry an `ext::` or `--upload-pack=` URL that runs code when pushed to. This
/// reads the URL the push would actually use and safety-checks it first — a URL that
/// names a command is refused before anything is sent.
async fn check_configured_remote(
    target: &WriteTarget,
    name: &str,
    push: bool,
) -> Result<String, Problem> {
    let plan = refyard_core::plan::remotes::plan_remote_get_url(name, push)
        .map_err(|error| Problem::new(ProblemCode::InvalidRequest, error.to_string()))?;
    let outcome = run_step(target, &plan).await?;
    if !clean_exit(&outcome) {
        return Err(Problem::new(
            ProblemCode::NotFound,
            format!("remote {name} is not configured in this repository"),
        ));
    }
    let text = String::from_utf8(outcome.stdout).unwrap_or_default();
    let url = text
        .split(['\n', '\r'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if let Err(error) = refyard_core::plan::remotes::validated_remote_url(&url) {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            format!("remote {name} has an unsafe configured URL, so it was not contacted: {error}"),
        ));
    }
    Ok(url)
}

/// A push that did not finish cleanly: a clean non-zero is a refusal (the single ref
/// was rejected), while a timeout, signal or truncated stream is `unknown` — a network
/// write may have half-reached the remote and is never retried.
fn network_failure(
    operation_id: &str,
    command: &'static str,
    outcome: &RunOutcome,
) -> EffectOutcome {
    let finished = outcome.state == ExecutionState::Completed && outcome.output_complete;
    if finished || outcome.state == ExecutionState::NotStarted {
        refused(operation_id, refusal_problem(command, outcome))
    } else {
        EffectOutcome::Unknown {
            reason: format!("{command} did not finish cleanly"),
            problem: unknown_problem(
                command,
                "the push did not finish cleanly; whether it reached the remote is not known, and nothing was retried",
            )
            .for_operation(operation_id.to_string()),
        }
    }
}

/// A success whose `changed_refs` names the refs that actually moved — the honest
/// per-ref answer a fetch owes the user, not a bare "done".
fn succeeded_with_refs(
    summary: String,
    changed_refs: Vec<String>,
    head: Option<String>,
) -> EffectOutcome {
    EffectOutcome::Succeeded {
        result: super::result_of_refs(summary, changed_refs, None, head),
    }
}

/// The first line of stdout, trimmed — for the one-line answers `rev-parse` gives.
fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

async fn fetch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Fetch {
        remote_name,
        prune,
        tags,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "fetch");
    };
    let tags_following = matches!(tags, FetchTagMode::Following);
    let plan = match refyard_core::plan::remotes::plan_fetch(remote_name, *prune, tags_following) {
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
    let head = before.head.oid.clone();
    if let Err(problem) = check_configured_remote(&target, remote_name, false).await {
        return refused(operation_id, problem);
    }
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        let parsed = parse_fetch_porcelain(&outcome.stdout);
        let moved: Vec<String> = parsed
            .refs
            .iter()
            .filter(|r| r.moved())
            .map(|r| r.local_ref.clone())
            .collect();
        let summary = if moved.is_empty() {
            format!("fetch {remote_name}: already up to date")
        } else {
            format!(
                "fetch {remote_name}: {} remote-tracking ref(s) updated",
                moved.len()
            )
        };
        return succeeded_with_refs(summary, moved, head);
    }
    network_failure(operation_id, "git fetch", &outcome)
}

async fn pull(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Pull { remote_name, mode } = &request.request.operation else {
        return wrong_payload(operation_id, "pull");
    };
    // `ff-only` is the only mode this build offers; a divergence fails, never merges.
    let PullMode::FfOnly = mode;
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    // Pull fast-forwards the *current branch*; on a detached HEAD there is none.
    if before.head.detached || before.head.branch_name.is_none() {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                "there is no branch to pull into; HEAD is detached or unborn — switch to a branch first",
            ),
        );
    }
    let branch_name = before.head.branch_name.clone().unwrap_or_default();
    if let Err(problem) = check_configured_remote(&target, remote_name, false).await {
        return refused(operation_id, problem);
    }

    // Which ref the branch tracks is Git's answer, not ours.
    let upstream_plan = match refyard_core::plan::remotes::plan_branch_upstream_ref(&branch_name) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let upstream_outcome = match run_step(&target, &upstream_plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if !clean_exit(&upstream_outcome) {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                format!("the branch {branch_name} has no upstream to pull from"),
            ),
        );
    }
    let upstream_ref = first_line(&upstream_outcome.stdout);
    let upstream_remote = upstream_ref.split('/').next().unwrap_or("");
    if upstream_remote != remote_name {
        return refused(
            operation_id,
            Problem::new(
                ProblemCode::Conflict,
                format!(
                    "the branch {branch_name} tracks {upstream_ref}, which is on {upstream_remote}; the pull named {remote_name}"
                ),
            ),
        );
    }

    // The fetch half: tracking refs only, no tag sweep, no prune.
    let fetch_plan = match refyard_core::plan::remotes::plan_fetch(remote_name, false, false) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let fetch_outcome = match run_step(&target, &fetch_plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if !clean_exit(&fetch_outcome) {
        return network_failure(operation_id, "git fetch", &fetch_outcome);
    }
    let parsed = parse_fetch_porcelain(&fetch_outcome.stdout);
    let moved: Vec<String> = parsed
        .refs
        .iter()
        .filter(|r| r.moved())
        .map(|r| r.local_ref.clone())
        .collect();

    // The branch half: fast-forward only.
    let ff_plan = match refyard_core::plan::remotes::plan_fast_forward_merge(&upstream_ref) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let ff_outcome = match run_step(&target, &ff_plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&ff_outcome) {
        let after = host.read_facts(&target).await.ok();
        let new_head = after.and_then(|facts| facts.head.oid.clone());
        let summary = if moved.is_empty() {
            format!("pulled {remote_name}: already up to date")
        } else {
            format!(
                "pulled {remote_name}: {} tracking ref(s) updated and the branch fast-forwarded",
                moved.len()
            )
        };
        return succeeded_with_refs(summary, moved, new_head);
    }
    // The two facts, kept apart: the fetch half moved tracking refs, the branch half did
    // not (diverged or dirty). This build never merges or rebases implicitly, so there is
    // work for a human here — not a silent "failed".
    EffectOutcome::NeedsAttention {
        problem: Problem::new(
            ProblemCode::NeedsAttention,
            format!(
                "the fetch updated {} remote-tracking ref(s), but the branch {branch_name} was not fast-forwarded (diverged or dirty); nothing was merged or rebased: {}",
                moved.len(),
                diagnostic_of(&ff_outcome)
            ),
        )
        .for_operation(operation_id.to_string()),
    }
}

async fn push(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::Push {
        remote_name,
        source_ref,
        destination_ref,
        set_upstream,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "push");
    };
    let plan = match refyard_core::plan::remotes::plan_push(
        remote_name,
        source_ref,
        destination_ref,
        *set_upstream,
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
    let head = before.head.oid.clone();
    if let Err(problem) = check_configured_remote(&target, remote_name, true).await {
        return refused(operation_id, problem);
    }
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded(
            format!("pushed {source_ref} to {remote_name} {destination_ref}"),
            head,
        );
    }
    network_failure(operation_id, "git push", &outcome)
}

async fn push_tag(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::PushTag {
        remote_name,
        tag_name,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "pushTag");
    };
    let plan = match refyard_core::plan::remotes::plan_push_tag(remote_name, tag_name) {
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
    let head = before.head.oid.clone();
    if let Err(problem) = check_configured_remote(&target, remote_name, true).await {
        return refused(operation_id, problem);
    }
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded(format!("pushed tag {tag_name} to {remote_name}"), head);
    }
    network_failure(operation_id, "git push", &outcome)
}
