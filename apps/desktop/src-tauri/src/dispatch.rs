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

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use refyard_contract::diff::DiffQuery;
use refyard_contract::history::HistoryQuery;
use refyard_contract::host::{ExecutionTargetKind, HostCapabilities};
use refyard_contract::problem::{Problem, ProblemCode, ProblemResponse};
use refyard_contract::reads::PreviewsRequest;
use refyard_host::service::{ApplicationService, StatusQuery, API_MAJOR};
use refyard_host::targets::CreateTargetRequest;
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
                require_target(service, selector.target_id.as_deref())?;
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
            // The service refuses a target it does not hold and a remote target's
            // directories, so this stays one call rather than a check here that could drift
            // from the one the reads already make.
            let entries = service
                .filesystem_entries_on(path.as_deref(), target_id.as_deref())
                .await
                .map_err(failed)?;
            to_value(entries)
        }
        GitReadRequest::RegisterRepository { path, target_id } => {
            let repositories = service
                .register_repository_on(&path, target_id.as_deref())
                .await
                .map_err(failed)?;
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
        GitReadRequest::Previews { query } => {
            let request: PreviewsRequest = decode_required(query, "previews")?;
            let response = service.previews(&request).await.map_err(failed)?;
            to_value(response)
        }
        unimplemented => Err(not_implemented(unimplemented.method())),
    }
}

/// Runs one host request.
///
/// SSH discovery answers now, and answers by reading files: it never connects, never runs
/// `ssh -G` and never evaluates a `Match`, so a list can be offered before any host is
/// trusted. Creating a target from that list is the one thing here that reaches the far
/// side, and it answers with the target whether or not the probe succeeded — a host that
/// cannot be reached is a target the caller must be able to see the failure next to, not an
/// error that leaves the session with nothing.
/// The one window-bound thing the host request surface can do: open the OS folder
/// picker and return the chosen full path (`None` when the person cancelled).
///
/// A trait so tests can drive `dispatch_host` without a window — a stub answers like a
/// cancelled dialog, or hands back a canned path to exercise the answer's shape. The real
/// implementation opens the plugin's dialog from the host process; the WebView holds no
/// `dialog:*` permission, so this host-side road is the only one to the picker.
pub trait FolderDialog {
    fn pick_folder_path(&self) -> Option<String>;
}

impl FolderDialog for tauri::WebviewWindow {
    fn pick_folder_path(&self) -> Option<String> {
        let (answer, receiver) = std::sync::mpsc::sync_channel(0);
        self.app_handle()
            .dialog()
            .file()
            // Parented to this window the panel is a visible sheet and window-modal:
            // the webview cannot take clicks while it is up, so requests cannot stack
            // into a pile of invisible panels that leave the app looking frozen. The
            // unparented floating panel did exactly that.
            .set_parent(self)
            .pick_folder(move |file| {
                let _ = answer.send(
                    file.and_then(|file| file.into_path().ok())
                        .map(|path| path.display().to_string()),
                );
            });
        receiver.recv().ok().flatten()
    }
}

/// Answers every picker request like a person who cancelled: the shape tests and
/// windowless callers need when there is no dialog to open.
pub struct CancelledDialog;

impl FolderDialog for CancelledDialog {
    fn pick_folder_path(&self) -> Option<String> {
        None
    }
}

/// Set while a folder panel is on screen. A second host request for the picker cannot
/// be served meanwhile — answering it like a cancellation keeps a burst of clicks from
/// queueing main-thread work behind the open panel.
static FOLDER_PICKER_OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub async fn dispatch_host(
    service: &ApplicationService,
    request: HostRequest,
    dialogs: &impl FolderDialog,
) -> Result<Value, ProblemResponse> {
    match request {
        HostRequest::Capabilities => to_value(host_capabilities()),
        HostRequest::Targets => to_value(service.targets()),
        HostRequest::SshHosts => {
            let hosts = service.ssh_hosts().await.map_err(failed)?;
            to_value(hosts)
        }
        HostRequest::PickLocalDirectory => {
            // The OS folder picker, opened here in the host process. The answer is the
            // one full path the person chose — the thing a browser cannot have — or
            // `null` for a cancelled dialog, which the adapter treats as an answer and
            // not a failure. The webview holds no dialog permission, so this is the
            // only road to the picker.
            if FOLDER_PICKER_OPEN.swap(true, std::sync::atomic::Ordering::AcqRel) {
                return to_value(Option::<String>::None);
            }
            let answer = dialogs.pick_folder_path();
            FOLDER_PICKER_OPEN.store(false, std::sync::atomic::Ordering::Release);
            to_value(answer)
        }
        HostRequest::CreateTarget { request } => {
            let request = decode_create_target(request)?;
            let target = service.create_target(request).await.map_err(failed)?;
            to_value(target)
        }
        HostRequest::DisconnectTarget { target_id } => {
            service.disconnect_target(&target_id).map_err(failed)?;
            // The adapter's `disconnectTarget` answers with no body.
            Ok(Value::Null)
        }
        HostRequest::AcknowledgeUncertainOperation { request } => {
            let acknowledgement = decode_acknowledgement(request)?;
            let record = service
                .acknowledge_uncertain_operation(
                    &acknowledgement.operation_id,
                    &acknowledgement.confirmed_snapshot_id,
                )
                .map_err(failed)?;
            to_value(record)
        }
    }
}

/// Decodes a `createTarget` request, naming the one variant this host does not serve.
///
/// The contract allows an alias typed by hand and bound to a source. This host refuses it by
/// name rather than letting serde report a missing `hostId`: the reason is not the shape of
/// the request, it is that an alias this host did not read from the source it lists is an
/// alias it will not hand to `ssh` on a caller's word.
fn decode_create_target(request: Value) -> Result<CreateTargetRequest, ProblemResponse> {
    let typed_by_hand = request.as_object().is_some_and(|fields| {
        fields.contains_key("manualAlias") || fields.contains_key("sourceId")
    });
    match serde_json::from_value::<CreateTargetRequest>(request) {
        Ok(request) => Ok(request),
        Err(_) if typed_by_hand => Err(failed(Problem::new(
            ProblemCode::UnsupportedOperation,
            "this host creates an SSH target only for a candidate it listed in sshHosts; a \
             manually typed alias is refused, because this host cannot tell which \
             configuration source it came from and will not connect on an unverified one",
        ))),
        Err(error) => Err(failed(Problem::new(
            ProblemCode::InvalidRequest,
            format!("the createTarget request is not one this host implements: {error}"),
        ))),
    }
}

/// The contract's acknowledgement, with the confirmation itself checked.
///
/// `confirmed` is published as the literal `true`. A request that carries `false` is a
/// caller asking *not* to confirm, and lifting the write block for it would be the host
/// inventing a confirmation nobody gave — so the field is read and refused, never ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UncertainAcknowledgement {
    operation_id: String,
    confirmed_snapshot_id: String,
    confirmed: bool,
}

fn decode_acknowledgement(request: Value) -> Result<UncertainAcknowledgement, ProblemResponse> {
    let acknowledgement: UncertainAcknowledgement =
        decode(request, "acknowledgeUncertainOperation")?;
    if !acknowledgement.confirmed {
        return Err(failed(Problem::new(
            ProblemCode::InvalidRequest,
            "acknowledgeUncertainOperation lifts a write block only for a caller that \
             confirms, so `confirmed` must be true; a request that says otherwise is refused \
             rather than treated as a confirmation",
        )));
    }
    Ok(acknowledgement)
}

/// Decodes a payload the union publishes as required.
///
/// The transport carries queries for the methods this build does not implement as optional
/// values, so an absent one is a shape error here rather than an empty answer.
fn decode_required<T: serde::de::DeserializeOwned>(
    query: Option<Value>,
    method: &str,
) -> Result<T, ProblemResponse> {
    match query {
        Some(query) => decode(query, method),
        None => Err(failed(Problem::new(
            ProblemCode::InvalidRequest,
            format!("{method} needs a query; it was called without one"),
        ))),
    }
}

fn decode<T: serde::de::DeserializeOwned>(
    payload: Value,
    method: &str,
) -> Result<T, ProblemResponse> {
    serde_json::from_value(payload).map_err(|error| {
        failed(Problem::new(
            ProblemCode::InvalidRequest,
            format!("the {method} request is not one this host implements: {error}"),
        ))
    })
}

/// What this process can do about targets and machines.
///
/// Three of these are properties of the *service*: whether it reads this machine's SSH
/// configuration, which targets it can create, and whether it can lift the write block an
/// uncertain outcome leaves behind. The last is true because the composition root registers
/// the write effects — an uncertain outcome is only reachable through a write, so a host that
/// advertised this while refusing every mutation would be promising an entry point nobody can
/// arrive at.
///
/// The fourth is a property of this process: the dialog plugin is linked and the picker is
/// the OS's own, opened by the host when a session asks. The WebView holds no `dialog:*`
/// permission, so the flag's promise and the reachable road are the same thing.
///
/// `targetKinds` names both because both can be created: `createTarget` builds an SSH target
/// from a listed candidate, probes it, and reports `unavailable` with the reason when the
/// host cannot be reached, so a UI that offers the control gets an answer either way.
fn host_capabilities() -> HostCapabilities {
    HostCapabilities {
        ssh_config: true,
        local_folder_picker: true,
        uncertain_operation_acknowledgement: true,
        target_kinds: vec![ExecutionTargetKind::Local, ExecutionTargetKind::SshConfig],
    }
}

/// Refuses a request that names a target this session does not hold.
///
/// The alternative — answering about the local machine because that is all there is — is how
/// a single-target host silently answers the wrong question. Reads that carry their own
/// target refuse it inside the service, with the same code and the same words, so this is
/// only for the calls whose answer has no target of its own.
fn require_target(
    service: &ApplicationService,
    target_id: Option<&str>,
) -> Result<(), ProblemResponse> {
    let Some(asked) = target_id else {
        return Ok(());
    };
    if service
        .targets()
        .iter()
        .any(|target| target.target_id == asked)
    {
        return Ok(());
    }
    Err(failed(Problem::new(
        ProblemCode::UnsupportedOperation,
        format!(
            "this session has no execution target {asked}; it is not a target this service \
             created, and answering from another one would misreport where Git runs"
        ),
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
