//! Adding a submodule: `git submodule add` from an approved remote or local path.
//!
//! The URL is safety-checked before it is contacted (a transport-helper or option-like
//! URL names a command and is refused), and the destination is confined to the working
//! tree. `git submodule add` clones, so an unfinished run is `unknown`, never retried.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use refyard_contract::reads::MutationKind;

use crate::jobs::journal::EffectOutcome;
use crate::jobs::{EffectRequest, MutationEffect, MutationOperation};

use super::remotes::{network_failure, run_step, succeeded};
use super::{clean_exit, invalid_payload, refused, wrong_payload, WriteHost};

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
