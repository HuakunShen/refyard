//! Adding a submodule: `git submodule add` from an approved remote or local path.
//!
//! The URL is safety-checked before it is contacted (a transport-helper or option-like
//! URL names a command and is refused), and the destination is confined to the working
//! tree. `git submodule add` clones, so an unfinished run is `unknown`, never retried.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::remotes::{network_failure, run_step, succeeded};
use super::{
    clean_exit, invalid_payload, refused, wrong_payload, ResolvedPath, WriteHost, WriteTarget,
};

/// `git submodule add [-b <branch>] -- <url> <path>`.
pub struct AddSubmoduleEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for AddSubmoduleEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::AddSubmodule
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { add_submodule(&host, &request).await })
    }
}

async fn add_submodule(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::AddSubmodule {
        remote_url,
        relative_path,
        branch_name,
        initialize,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "addSubmodule");
    };
    // `initialize` is carried by `git submodule add` itself for a fresh submodule: it
    // registers the URL and checks the working tree out regardless. Were this false the
    // entry would still be added to `.gitmodules`, which is Git's own `add` behaviour —
    // the honest thing to report rather than pretend the flag changes the outcome.
    let _ = initialize;
    let plan = match refyard_core::plan::submodules::plan_submodule_add(
        remote_url,
        relative_path,
        branch_name.as_deref(),
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
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        return succeeded(
            format!("added submodule {relative_path} from {remote_url}"),
            head,
        );
    }
    network_failure(operation_id, "git submodule add", &outcome)
}

/// `git submodule update --checkout` — check out the commit the parent records.
pub struct UpdateSubmoduleEffect {
    pub(super) host: Arc<WriteHost>,
}

/// `git submodule sync` — copy the parent's configured URLs into the submodules.
pub struct SyncSubmoduleEffect {
    pub(super) host: Arc<WriteHost>,
}

impl MutationEffect for UpdateSubmoduleEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::UpdateSubmodule
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { update_submodules(&host, &request).await })
    }
}

impl MutationEffect for SyncSubmoduleEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::SyncSubmodule
    }
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>> {
        let host = Arc::clone(&self.host);
        Box::pin(async move { sync_submodules(&host, &request).await })
    }
}

/// Refuse to run against a `.gitmodules` that names a command URL.
///
/// `git submodule update`/`sync` contact the URLs a crafted `.gitmodules` declares. A
/// transport-helper (`ext::`) or option-like URL names a command, so the configured
/// URLs are safety-checked *before* either runs — the same URL gate as every remote.
/// A scan that cannot run fails closed rather than updating blind.
async fn safe_submodule_urls(target: &WriteTarget) -> Result<(), Problem> {
    let outcome = run_step(
        target,
        &refyard_core::plan::submodules::plan_submodule_config(),
    )
    .await?;
    match outcome.exit_code {
        Some(0) => {
            for url in refyard_core::plan::submodules::submodule_config_urls(&outcome.stdout) {
                if let Err(error) = refyard_core::plan::remotes::validated_remote_url(&url) {
                    return Err(Problem::new(
                        ProblemCode::InvalidRequest,
                        format!("a submodule has an unsafe configured URL, so it was not contacted: {error}"),
                    ));
                }
            }
            Ok(())
        }
        // `--get-regexp` exits 1 when nothing matches: no configured submodule URL to
        // contact, so nothing here can be unsafe.
        Some(1) => Ok(()),
        _ => Err(Problem::new(
            ProblemCode::InvalidRequest,
            "could not read .gitmodules to check its submodule URLs; nothing was changed",
        )),
    }
}

/// The selected paths as argv fields. A path whose bytes are not representable refuses
/// the batch rather than silently mangling a filename.
fn path_strings(resolved: Vec<ResolvedPath>) -> Result<Vec<String>, Problem> {
    let mut paths = Vec::with_capacity(resolved.len());
    for entry in resolved {
        match String::from_utf8(entry.bytes) {
            Ok(path) => paths.push(path),
            Err(_) => {
                return Err(Problem::new(
                    ProblemCode::UnsupportedPathEncoding,
                    "a selected submodule path's bytes cannot be represented on this host, so the whole batch is refused",
                ))
            }
        }
    }
    Ok(paths)
}

async fn update_submodules(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::UpdateSubmodule {
        path_ids,
        initialize,
        recursive,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "updateSubmodule");
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
    let resolved = match host.resolve_paths(&target, path_ids) {
        Ok(resolved) => resolved,
        Err(problem) => return refused(operation_id, problem),
    };
    let count = resolved.len();
    let paths = match path_strings(resolved) {
        Ok(paths) => paths,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(problem) = safe_submodule_urls(&target).await {
        return refused(operation_id, problem);
    }
    let plan = match refyard_core::plan::submodules::plan_submodule_update(
        &paths,
        *initialize,
        *recursive,
    ) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        let noun = if count == 1 {
            "submodule"
        } else {
            "submodules"
        };
        return succeeded(
            format!("updated {count} {noun} to the commit the parent records"),
            head,
        );
    }
    // Updating clones what is missing, so an unfinished run is unknown, never retried.
    network_failure(operation_id, "git submodule update", &outcome)
}

async fn sync_submodules(host: &Arc<WriteHost>, request: &EffectRequest<'_>) -> EffectOutcome {
    let operation_id = request.operation_id;
    let MutationOperation::SyncSubmodule {
        path_ids,
        recursive,
    } = &request.request.operation
    else {
        return wrong_payload(operation_id, "syncSubmodule");
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
    let resolved = match host.resolve_paths(&target, path_ids) {
        Ok(resolved) => resolved,
        Err(problem) => return refused(operation_id, problem),
    };
    let count = resolved.len();
    let paths = match path_strings(resolved) {
        Ok(paths) => paths,
        Err(problem) => return refused(operation_id, problem),
    };
    if let Err(problem) = safe_submodule_urls(&target).await {
        return refused(operation_id, problem);
    }
    let plan = match refyard_core::plan::submodules::plan_submodule_sync(&paths, *recursive) {
        Ok(plan) => plan,
        Err(error) => return invalid_payload(operation_id, error.to_string()),
    };
    let outcome = match run_step(&target, &plan).await {
        Ok(outcome) => outcome,
        Err(problem) => return refused(operation_id, problem),
    };
    if clean_exit(&outcome) {
        let noun = if count == 1 {
            "submodule"
        } else {
            "submodules"
        };
        return succeeded(
            format!("synced {count} {noun} URL(s) from the parent"),
            head,
        );
    }
    network_failure(operation_id, "git submodule sync", &outcome)
}
