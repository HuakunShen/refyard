//! Branch and tag creation, and switching branches.
//!
//! These are the ref-shape writes: they move names, and only `switch` also moves HEAD
//! and the index. The command is the planner's — the name validated against the
//! contract's ref rules before any command exists — and the read-back is the evidence:
//! a name Git refused (the branch already exists, the tag already exists, the switch
//! conflicts with local changes) changed nothing, and the unchanged read-back proves it.
//! No planner adds `--force`: overwriting a name is a decision this build does not make.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::{
    classify_write, effect_outcome, invalid_payload, refused, wrong_payload, Postcondition,
    Verdict, WriteHost,
};

/// `git branch -- <name>` — or `git switch --create <name>` when the request says the
/// new branch is checked out immediately.
pub struct CreateBranchEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git switch -- <name>` — never forced.
pub struct SwitchBranchEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git tag` — lightweight, or annotated with the message on stdin.
pub struct CreateTagEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for CreateBranchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::CreateBranch
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { create_branch(&host, &request).await })
    }
}

impl MutationEffect for SwitchBranchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::SwitchBranch
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { switch_branch(&host, &request).await })
    }
}

impl MutationEffect for CreateTagEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::CreateTag
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { create_tag(&host, &request).await })
    }
}

/// `git branch --delete <name>` — merged branches only; no force form.
pub struct DeleteBranchEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git branch --move <old> <new>`.
pub struct RenameBranchEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git branch --set-upstream-to=<remote>/<branch> <name>` — or `--unset-upstream`.
pub struct SetBranchUpstreamEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git tag --delete <name>` — local tags only.
pub struct DeleteTagEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for DeleteBranchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::DeleteBranch
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { delete_branch(&host, &request).await })
    }
}

impl MutationEffect for RenameBranchEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::RenameBranch
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { rename_branch(&host, &request).await })
    }
}

impl MutationEffect for SetBranchUpstreamEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::SetBranchUpstream
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { set_branch_upstream(&host, &request).await })
    }
}

impl MutationEffect for DeleteTagEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::DeleteTag
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { delete_tag(&host, &request).await })
    }
}

/// The shared ref-write shape: validate the name into a plan, run, and let the
/// read-back decide — Git's refusal for an unmerged branch, a missing tag or a bad
/// upstream leaves the refs exactly as they were, which is the evidence.
async fn run_ref_write(
    host: &Arc<WriteHost>,
    request: &EffectRequest<'_>,
    plan: Result<refyard_core::plan::GitPlan, refyard_core::problem::CoreError>,
    command: &'static str,
    summary: String,
) -> EffectOutcome {
    let operation_id = request.operation_id;
    let plan = match plan {
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
    let verdict = classify_write(
        command,
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    effect_outcome(verdict, summary, None)
}

async fn delete_branch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::DeleteBranch { branch_name, .. } = &request.request.operation else {
        return wrong_payload(operation_id, "deleteBranch");
    };
    run_ref_write(
        host,
        request,
        refyard_core::plan::branches::plan_branch_delete(branch_name),
        "git branch --delete",
        format!("deleted branch {branch_name}"),
    )
    .await
}

async fn rename_branch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::RenameBranch {
        branch_name,
        new_name,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "renameBranch");
    };
    run_ref_write(
        host,
        request,
        refyard_core::plan::branches::plan_branch_rename(branch_name, new_name),
        "git branch --move",
        format!("renamed branch {branch_name} to {new_name}"),
    )
    .await
}

async fn set_branch_upstream(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::SetBranchUpstream {
        branch_name,
        upstream,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "setBranchUpstream");
    };
    let plan = refyard_core::plan::branches::plan_branch_set_upstream(
        branch_name,
        upstream
            .as_ref()
            .map(|upstream| (upstream.remote_name.as_str(), upstream.branch_name.as_str())),
    );
    let summary = match upstream {
        Some(upstream) => format!(
            "set the upstream of {branch_name} to {}/{}",
            upstream.remote_name, upstream.branch_name
        ),
        None => format!("cleared the upstream of {branch_name}"),
    };
    run_ref_write(host, request, plan, "git branch", summary).await
}

async fn delete_tag(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::DeleteTag { tag_name, .. } = &request.request.operation else {
        return wrong_payload(operation_id, "deleteTag");
    };
    run_ref_write(
        host,
        request,
        refyard_core::plan::tags::plan_tag_delete(tag_name),
        "git tag --delete",
        format!("deleted tag {tag_name}"),
    )
    .await
}

async fn create_branch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::CreateBranch {
        branch_name,
        start_oid,
        switch_to_it,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "createBranch");
    };
    let plan = match if *switch_to_it {
        refyard_core::plan::branches::plan_branch_create_and_switch(
            branch_name,
            start_oid.as_deref(),
        )
    } else {
        refyard_core::plan::branches::plan_branch_create(branch_name, start_oid.as_deref())
    } {
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
    if outcome.state == refyard_core::outcome::ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git branch", &outcome),
            },
            "create branch".to_string(),
            None,
        );
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git branch",
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let summary = match &verdict {
        Verdict::Succeeded { .. } if *switch_to_it => {
            format!("created and checked out branch {branch_name}")
        }
        Verdict::Succeeded { .. } => format!("created branch {branch_name}"),
        _ => "create branch".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn switch_branch(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::SwitchBranch { branch_name } = &request.request.operation else {
        return wrong_payload(operation_id, "switchBranch");
    };
    let plan = match refyard_core::plan::branches::plan_branch_switch(branch_name) {
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
    if outcome.state == refyard_core::outcome::ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git switch", &outcome),
            },
            "switch branch".to_string(),
            None,
        );
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git switch",
        // Switching to the branch already checked out succeeds and moves nothing, so
        // the honest postcondition is "the index may be unchanged" with a clean exit
        // accepted as Git's word — the same read-back rule a stage runs under.
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let summary = match &verdict {
        Verdict::Succeeded { new_head_oid } => {
            if new_head_oid.as_deref() == before.head.oid.as_deref() {
                format!("already on {branch_name}")
            } else {
                format!("checked out {branch_name}")
            }
        }
        _ => "switch branch".to_string(),
    };
    effect_outcome(verdict, summary, None)
}

async fn create_tag(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::CreateTag {
        tag_name,
        target_oid,
        annotation,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "createTag");
    };
    let plan = match annotation {
        Some(annotation) => refyard_core::plan::tags::plan_tag_create_annotated(
            tag_name,
            target_oid.as_deref(),
            annotation.message.as_bytes(),
        ),
        None => {
            refyard_core::plan::tags::plan_tag_create_lightweight(tag_name, target_oid.as_deref())
        }
    };
    let plan = match plan {
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
    if outcome.state == refyard_core::outcome::ExecutionState::NotStarted {
        return effect_outcome(
            Verdict::Failed {
                problem: super::refusal_problem("git tag", &outcome),
            },
            "create tag".to_string(),
            None,
        );
    }
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git tag",
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let summary = match &verdict {
        Verdict::Succeeded { .. } if annotation.is_some() => {
            format!("created tag {tag_name} (annotated)")
        }
        Verdict::Succeeded { .. } => format!("created tag {tag_name}"),
        _ => "create tag".to_string(),
    };
    effect_outcome(verdict, summary, None)
}
