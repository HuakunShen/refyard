//! Staging and unstaging: the two path-scoped writes.
//!
//! Both follow the shared order (resolve, redeem, read, run, read back) and differ in two
//! places: a stage requires a preview token per selected path because it can move content
//! between the working tree and the index, and an unstage chooses its plan from the HEAD
//! the read-back found, because `git restore --staged` has nothing to restore from in a
//! repository with no commits.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::reads::{HeadKind, MutationKind};

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::{
    classify_write, effect_outcome, invalid_payload, refused, selected_paths, stage_paths,
    unstage_plan, wrong_payload, Postcondition, WriteHost, PATH_SELECTION_MAX_ENTRIES,
};

/// `git add` for exactly the paths the request selected.
pub struct StageEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for StageEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::StagePaths
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { stage(&host, &request).await })
    }
}

/// `git restore --staged` (or `git rm --cached` on an unborn branch) for the selection.
pub struct UnstageEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for UnstageEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::UnstagePaths
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { unstage(&host, &request).await })
    }
}

async fn stage(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::StagePaths {
        path_ids,
        preview_tokens,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "stagePaths");
    };
    if path_ids.is_empty() || path_ids.len() > PATH_SELECTION_MAX_ENTRIES {
        return invalid_payload(
            operation_id,
            format!(
                "a stage names between 1 and {PATH_SELECTION_MAX_ENTRIES} paths; this request names {}",
                path_ids.len()
            ),
        );
    }
    if preview_tokens.len() != path_ids.len() {
        return invalid_payload(
            operation_id,
            "one preview token is required per selected path".to_string(),
        );
    }
    // Everything that can refuse the batch happens before Git is started: the path ids
    // are resolved in the registry this worktree minted them in, and the preview tokens
    // are redeemed against freshly read content. A refusal here means no command ran and
    // the repository is exactly as it was.
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let selected = match host.resolve_paths(&target, path_ids) {
        Ok(selected) => selected,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(problem) = host
        .redeem_previews(&target, &selected, preview_tokens)
        .await
    {
        return refused(operation_id, problem);
    }

    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    let paths = stage_paths(&selected, &before.records);
    let plan = refyard_core::plan::paths::plan_stage(&paths);
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
        // A command this host cannot encode never started; the refusal is the answer.
        Err(problem) => return refused(operation_id, problem),
    };
    let after = host.read_facts(&target).await.ok();
    let verdict = classify_write(
        "git add",
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let count = selected.len() as u64;
    effect_outcome(
        verdict,
        format!("staged {count} path{}", if count == 1 { "" } else { "s" }),
        Some(count),
    )
}

async fn unstage(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::UnstagePaths { path_ids } = &request.request.operation else {
        return wrong_payload(operation_id, "unstagePaths");
    };
    if path_ids.is_empty() || path_ids.len() > PATH_SELECTION_MAX_ENTRIES {
        return invalid_payload(
            operation_id,
            format!(
                "an unstage names between 1 and {PATH_SELECTION_MAX_ENTRIES} paths; this request names {}",
                path_ids.len()
            ),
        );
    }
    let target = match host.resolve(request.request) {
        Ok(target) => target,
        Err(problem) => return refused(operation_id, problem),
    };
    let selected = match host.resolve_paths(&target, path_ids) {
        Ok(selected) => selected,
        Err(problem) => return refused(operation_id, problem),
    };
    let before = match host.read_facts(&target).await {
        Ok(facts) => facts,
        Err(problem) => return refused(operation_id, problem),
    };
    let paths = selected_paths(&selected);
    let head_is_unborn = before.head.kind == HeadKind::Unborn;
    let plan = unstage_plan(head_is_unborn, &paths);
    let command = if head_is_unborn {
        "git rm --cached"
    } else {
        "git restore --staged"
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
    let verdict = classify_write(
        command,
        Postcondition::IndexMayBeUnchanged,
        &outcome,
        &before,
        after.as_ref(),
    );
    let count = selected.len() as u64;
    effect_outcome(
        verdict,
        format!(
            "unstaged {count} path{} (working tree untouched)",
            if count == 1 { "" } else { "s" }
        ),
        Some(count),
    )
}
