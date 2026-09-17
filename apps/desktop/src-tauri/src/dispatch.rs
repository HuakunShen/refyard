//! The closed read surface: one tagged request in, one contract DTO out.
//!
//! `GitReadRequest` is the Rust half of the union `packages/backend-tauri/src/commands.ts`
//! builds, and every payload denies unknown fields, so a renderer can neither reach a method
//! by inventing a name nor smuggle a field past the host. Nothing here builds a Git command
//! line: each arm calls one method on the application service, which is the only place argv
//! exists in this process.
//!
//! A read this build does not implement is refused with `UnsupportedOperation` and is absent
//! from `capabilities().reads`. The two go together on purpose: a client that gates on
//! capabilities never asks, and one that asks anyway is told the truth instead of receiving
//! an empty panel that looks like a repository with nothing in it.

use refyard_contract::diff::DiffQuery;
use refyard_contract::history::HistoryQuery;
use refyard_contract::problem::{Problem, ProblemCode, ProblemResponse};
use refyard_host::service::{ApplicationService, StatusQuery, API_MAJOR};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The host's own liveness answer, as `HealthResponse` publishes it in
/// `packages/git-contract/src/reads.ts`. The native host can answer it without touching Git,
/// so it stays true while a repository read would fail — which is exactly what a client
/// needs in order to tell "the host is gone" from "the repository is unreadable".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub alive: bool,
    pub api_major: u32,
    pub service_instance_id: String,
}

/// A query that names which target it is about.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetSelector {
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub repository_id: Option<String>,
}

/// A query addressed to one repository, optionally through one of its worktrees.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryQuery {
    pub repository_id: String,
    #[serde(default)]
    pub worktree_id: Option<String>,
}

/// The status query as the transport carries it. `includeIgnored` defaults to false: an
/// ignored build directory is not something a read should enumerate unless asked.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusPayload {
    pub repository_id: String,
    #[serde(default)]
    pub worktree_id: Option<String>,
    #[serde(default)]
    pub include_ignored: Option<bool>,
}

/// The local picker's query. `path` absent means the host's home directory.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemQuery {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
}

/// One read the adapter asked for.
///
/// The variants a build does not implement still carry their payload so the request
/// deserializes and can be refused by name: the method, not its arguments, is what is
/// missing.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitReadRequest {
    Health,
    Capabilities {
        #[serde(default)]
        query: Option<TargetSelector>,
    },
    Repositories,
    FilesystemEntries {
        #[serde(default)]
        query: Option<FilesystemQuery>,
    },
    RegisterRepository {
        path: String,
        #[serde(default)]
        target_id: Option<String>,
    },
    RevokeRepository {
        repository_id: String,
    },
    Status {
        query: StatusPayload,
    },
    History {
        query: HistoryQuery,
    },
    Refs {
        query: RepositoryQuery,
    },
    Diff {
        query: DiffQuery,
    },
    Worktrees {
        #[serde(default)]
        query: Option<Value>,
    },
    Submodules {
        #[serde(default)]
        query: Option<Value>,
    },
    Stashes {
        #[serde(default)]
        query: Option<Value>,
    },
    Previews {
        #[serde(default)]
        query: Option<Value>,
    },
}

impl GitReadRequest {
    /// The method name as the union spells it, for refusals and diagnostics.
    pub fn method(&self) -> &'static str {
        match self {
            Self::Health => "health",
            Self::Capabilities { .. } => "capabilities",
            Self::Repositories => "repositories",
            Self::FilesystemEntries { .. } => "filesystemEntries",
            Self::RegisterRepository { .. } => "registerRepository",
            Self::RevokeRepository { .. } => "revokeRepository",
            Self::Status { .. } => "status",
            Self::History { .. } => "history",
            Self::Refs { .. } => "refs",
            Self::Diff { .. } => "diff",
            Self::Worktrees { .. } => "worktrees",
            Self::Submodules { .. } => "submodules",
            Self::Stashes { .. } => "stashes",
            Self::Previews { .. } => "previews",
        }
    }
}

/// The host surface, the second closed union the adapter builds.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostRequest {
    Capabilities,
    SshHosts,
    Targets,
    CreateTarget { request: Value },
    DisconnectTarget { target_id: String },
    PickLocalDirectory,
    AcknowledgeUncertainOperation { request: Value },
}

impl HostRequest {
    /// The method name as the union spells it.
    pub fn method(&self) -> &'static str {
        match self {
            Self::Capabilities => "capabilities",
            Self::SshHosts => "sshHosts",
            Self::Targets => "targets",
            Self::CreateTarget { .. } => "createTarget",
            Self::DisconnectTarget { .. } => "disconnectTarget",
            Self::PickLocalDirectory => "pickLocalDirectory",
            Self::AcknowledgeUncertainOperation { .. } => "acknowledgeUncertainOperation",
        }
    }
}

/// Runs one read against the service.
pub async fn dispatch_read(
    service: &ApplicationService,
    request: GitReadRequest,
) -> Result<Value, ProblemResponse> {
    match request {
        GitReadRequest::Health => to_value(HealthResponse {
            alive: true,
            api_major: API_MAJOR,
            service_instance_id: service.service_instance_id().to_owned(),
        }),
        GitReadRequest::Capabilities { query } => {
            if let Some(selector) = &query {
                refuse_foreign_target(service, selector.target_id.as_deref())?;
            }
            let capabilities = service.capabilities().await.map_err(failed)?;
            to_value(capabilities)
        }
        GitReadRequest::Repositories => to_value(service.repositories().await),
        GitReadRequest::FilesystemEntries { query } => {
            let (path, target_id) = match query {
                Some(query) => (query.path, query.target_id),
                None => (None, None),
            };
            refuse_foreign_target(service, target_id.as_deref())?;
            let entries = service
                .filesystem_entries(path.as_deref())
                .await
                .map_err(failed)?;
            to_value(entries)
        }
        GitReadRequest::RegisterRepository { path, target_id } => {
            refuse_foreign_target(service, target_id.as_deref())?;
            let repositories = service.register_repository(&path).await.map_err(failed)?;
            to_value(repositories)
        }
        GitReadRequest::RevokeRepository { repository_id } => {
            let repositories = service
                .revoke_repository(&repository_id)
                .await
                .map_err(failed)?;
            to_value(repositories)
        }
        GitReadRequest::Status { query } => {
            let mut status = StatusQuery::new(query.repository_id);
            status.worktree_id = query.worktree_id;
            status.include_ignored = query.include_ignored.unwrap_or(false);
            let snapshot = service.status(&status).await.map_err(failed)?;
            to_value(snapshot)
        }
        GitReadRequest::History { query } => {
            let page = service.history(&query).await.map_err(failed)?;
            to_value(page)
        }
        GitReadRequest::Refs { query } => {
            let snapshot = service.refs(&query.repository_id).await.map_err(failed)?;
            to_value(snapshot)
        }
        GitReadRequest::Diff { query } => {
            let response = service.diff(&query).await.map_err(failed)?;
            to_value(response)
        }
        unimplemented => Err(not_implemented(unimplemented.method())),
    }
}

/// Runs one host request. Target creation and SSH discovery are not part of this build, and
/// `capabilities` says so, so a UI that asks for them is refused rather than answered with an
/// empty list that looks like "this machine has no SSH hosts".
pub async fn dispatch_host(
    service: &ApplicationService,
    request: HostRequest,
) -> Result<Value, ProblemResponse> {
    match request {
        HostRequest::Capabilities => to_value(host_capabilities()),
        HostRequest::Targets => to_value(vec![target_summary(service)]),
        unimplemented => Err(not_implemented(unimplemented.method())),
    }
}

/// A target kind, as `executionTargetKindSchema` publishes the two values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetKind {
    Local,
    SshConfig,
}

/// One target a session can run Git against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTargetSummary {
    pub target_id: String,
    pub kind: TargetKind,
    pub label: String,
    /// `ready` because this answer came from the service that runs the target's Git.
    pub state: &'static str,
    /// False for this machine: there is no remote path to browse.
    pub remote_path_browse: bool,
    pub generation: String,
}

/// What this build can do about targets and machines.
///
/// `targetKinds` lists only the local target because that is the only provider this build
/// has. A false here removes a control from the UI; a true would add one that fails.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCapabilities {
    pub ssh_config: bool,
    pub local_folder_picker: bool,
    pub uncertain_operation_acknowledgement: bool,
    pub target_kinds: Vec<TargetKind>,
}

fn host_capabilities() -> HostCapabilities {
    HostCapabilities {
        ssh_config: false,
        local_folder_picker: false,
        uncertain_operation_acknowledgement: false,
        target_kinds: vec![TargetKind::Local],
    }
}

fn target_summary(service: &ApplicationService) -> ExecutionTargetSummary {
    ExecutionTargetSummary {
        target_id: service.target_id().to_owned(),
        kind: TargetKind::Local,
        label: "This machine".to_owned(),
        state: "ready",
        remote_path_browse: false,
        generation: service.target_generation().to_owned(),
    }
}

/// Refuses a request that names a target this host is not.
///
/// The alternative — answering about the local machine because that is all there is — is how
/// a single-target host silently answers the wrong question. The Node host refuses with the
/// same code and the same words, so a client sees one behaviour whichever transport it uses.
fn refuse_foreign_target(
    service: &ApplicationService,
    target_id: Option<&str>,
) -> Result<(), ProblemResponse> {
    let Some(asked) = target_id else {
        return Ok(());
    };
    if asked == service.target_id() {
        return Ok(());
    }
    Err(failed(Problem::new(
        ProblemCode::UnsupportedOperation,
        "this service has a single local execution target and cannot address a targetId",
    )))
}

/// A read that exists in the contract and not in this build.
fn not_implemented(method: &str) -> ProblemResponse {
    failed(Problem::new(
        ProblemCode::UnsupportedOperation,
        format!(
            "this build does not implement {method}; capabilities does not list it, \
             and it is refused here rather than answered with an empty result"
        ),
    ))
}

fn failed(problem: Problem) -> ProblemResponse {
    ProblemResponse { problem }
}

/// Serializing a contract DTO cannot fail for the types the service answers with. If it ever
/// did, the honest answer is an internal error rather than a half-written JSON body.
fn to_value<T: Serialize>(value: T) -> Result<Value, ProblemResponse> {
    serde_json::to_value(value).map_err(|error| {
        failed(Problem::new(
            ProblemCode::InternalError,
            format!("the answer could not be serialized: {error}"),
        ))
    })
}
