//! The workbench's data store: one opened repository's capabilities, status, refs,
//! history, diffs and mutations, driven through the tokio bridge and refreshed by the
//! host's event stream.
//!
//! Every background result crosses a `smol` channel into one consuming `cx.spawn` loop
//! ([`RepoStore::pump`]). The loop ends when the entity is gone; each message carries
//! the generation of the request that produced it, and stale messages are dropped. The
//! event pump ([`RepoStore::pump_events`]) turns host events into refreshes: events are
//! hints, so the affected reads are re-issued rather than patched.
//!
//! Mutations go through [`RepoStore::submit`]: the composition root registered the write
//! effects, so `capabilities` and this submit path describe the same set. Destructive
//! requests are only ever built by the views after an explicit confirmation.

use std::collections::HashMap;
use std::sync::Arc;

use gpui_kit::*;
use refyard_contract::diff::{DiffKind, DiffQuery, DiffResponse};
use refyard_contract::history::{HistoryPage, HistoryQuery};
use refyard_contract::reads::{
    CapabilitiesResponse, EventPayload, MutationKind, MutationTarget, OperationStatus,
    PreviewsRequest, ReadKind, RepositorySummary, StatusEntry,
    StatusEntryKind, StatusSnapshot,
};
use refyard_contract::refs::RefsSnapshot;
use refyard_graph::layout::{
    default_palette, layout_graph, ref_color_for, GraphCommit, GraphRow, LaneRef, LayoutOptions,
};
use refyard_host::events::SubscriberEvent;
use refyard_host::jobs::{MutationOperation, MutationRequest, SubmitResult};
use refyard_host::service::StatusQuery;
use smol::channel;

use crate::composition::{Host, ACTOR};

/// What the store announces to the views that observe it.
pub enum StoreEvent {
    /// Some cached read changed; re-render from the store.
    Changed,
}

/// One background message, tagged with the generation that asked for it.
pub enum StoreMsg {
    Booted {
        generation: u64,
        capabilities: Result<CapabilitiesResponse, String>,
    },
    Status {
        generation: u64,
        snapshot: Result<StatusSnapshot, String>,
    },
    Refs {
        generation: u64,
        refs: Result<RefsSnapshot, String>,
    },
    History {
        generation: u64,
        mode: HistoryFetch,
        page: Result<HistoryPage, String>,
    },
    PathDiff {
        generation: u64,
        path_id: Option<String>,
        diff: Result<DiffResponse, String>,
    },
    CommitDetail {
        generation: u64,
        detail: Result<(Option<HistoryPage>, Option<DiffResponse>), String>,
    },
    Submitted {
        describe: &'static str,
        result: Result<SubmitResult, String>,
    },
}

/// Whether a history fetch restarts the graph or continues it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HistoryFetch {
    Reset,
    Append,
}

/// The history cache: accumulated commits, their laid-out rows, and the continuation
/// lanes that bind the next page to this one.
#[derive(Default)]
pub struct HistoryState {
    pub commits: Vec<refyard_contract::history::CommitSummary>,
    pub rows: Vec<GraphRow>,
    pub continuation: Vec<LaneRef>,
    pub cursor: Option<String>,
    pub lane_count: usize,
    pub loading_more: bool,
    pub filters: HistoryFilters,
    /// Short ref name → fully qualified name, rebuilt on every refs read, so the graph
    /// colours branches and tags the way the web renderer does.
    pub full_names: HashMap<String, String>,
    /// HEAD's lane colour token, set by the last layout.
    pub head_token: Option<String>,
}

/// The literal-text filters the host applies to history.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct HistoryFilters {
    pub message: Option<String>,
    pub author: Option<String>,
}

pub struct RepoStore {
    host: Arc<Host>,
    pub repository: RepositorySummary,
    pub capabilities: Option<CapabilitiesResponse>,
    pub status: Option<StatusSnapshot>,
    pub refs: Option<RefsSnapshot>,
    pub history: HistoryState,
    /// The diff behind the changes view's selected path.
    pub path_diff: Option<DiffResponse>,
    pub selected_path: Option<String>,
    /// The selected history commit: the full message page plus its changed files.
    pub commit_detail: Option<CommitDetailState>,
    /// The oid of the selected history commit, if it is still on screen.
    pub selected_commit: Option<String>,
    /// The most recent mutation, as the status bar reports it.
    pub running: Option<(String, MutationKind)>,
    pub last_problem: Option<String>,
    pub booted: bool,
    status_generation: u64,
    refs_generation: u64,
    history_generation: u64,
    diff_generation: u64,

    request_counter: u64,
    msg_tx: Option<channel::Sender<StoreMsg>>,
    _tasks: Vec<Task<()>>,
}

/// A history commit's detail: the message page and the commit's changed files.
#[derive(Clone)]
pub struct CommitDetailState {
    pub message_page: Option<HistoryPage>,
    pub files: Option<DiffResponse>,
}

impl EventEmitter<StoreEvent> for RepoStore {}

impl RepoStore {
    pub fn new(host: Arc<Host>, repository: RepositorySummary, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            host,
            repository,
            capabilities: None,
            status: None,
            refs: None,
            history: HistoryState::default(),
            path_diff: None,
            selected_path: None,
            commit_detail: None,
            selected_commit: None,
            running: None,
            last_problem: None,
            booted: false,
            status_generation: 0,
            refs_generation: 0,
            history_generation: 0,
            diff_generation: 0,

            request_counter: 0,
            msg_tx: None,
            _tasks: Vec::new(),
        };
        this.start_pump(cx);
        this.boot(cx);
        this.start_event_pump(cx);
        this
    }

    /// One channel in, one loop out: every background result is applied here.
    fn start_pump(&mut self, cx: &mut Context<Self>) {
        let (tx, rx) = channel::unbounded::<StoreMsg>();
        self.msg_tx = Some(tx);
        cx.spawn(async move |this, cx| {
            loop {
                let Ok(message) = rx.recv().await else {
                    break;
                };
                if this
                    .update(cx, |this, cx| this.apply(message, cx))
                    .is_err()
                {
                    // The store is gone; stop consuming.
                    break;
                }
            }
        })
        .detach();
    }

    /// The session's first reads: what the host can do, then the three cheap reads.
    fn boot(&mut self, cx: &mut Context<Self>) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        let generation = self.next_generation();
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let capabilities = service.capabilities().await;
            let _ = tx
                .send(StoreMsg::Booted {
                    generation,
                    capabilities: capabilities.map_err(|problem| problem.to_string()),
                })
                .await;
        });
        self.refresh_status(cx);
        self.refresh_refs(cx);
        self.refresh_history(HistoryFetch::Reset, cx);
    }

    /// The host event stream, bridged to the store. Events are hints: an operation
    /// record invalidates exactly what its result says changed, and anything the pump
    /// cannot classify falls back to a full refresh of the cheap reads.
    fn start_event_pump(&mut self, cx: &mut Context<Self>) {
        let (tx, rx) = channel::unbounded::<SubscriberEvent>();
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let mut subscription = service.subscribe_events();
            loop {
                match subscription.recv().await {
                    Some(event) => {
                        if tx.send(event).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        });
        cx.spawn(async move |this, cx| loop {
            let Ok(event) = rx.recv().await else {
                break;
            };
            if this.update(cx, |this, cx| this.handle_event(event, cx)).is_err() {
                break;
            }
        })
        .detach();
    }

    fn next_generation(&mut self) -> u64 {
        self.request_counter = self.request_counter.wrapping_add(1);
        self.request_counter
    }

    fn apply(&mut self, message: StoreMsg, cx: &mut Context<Self>) {
        match message {
            StoreMsg::Booted { generation, capabilities } if generation == self.request_counter => {
                self.booted = true;
                self.capabilities = capabilities.ok();
                cx.notify();
            }
            StoreMsg::Status { generation, snapshot } if generation == self.status_generation => {
                match snapshot {
                    Ok(snapshot) => {
                        self.status = Some(snapshot);
                        self.last_problem = None;
                    }
                    Err(problem) => self.last_problem = Some(problem),
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            StoreMsg::Refs { generation, refs } if generation == self.refs_generation => {
                match refs {
                    Ok(refs) => {
                        self.history.full_names = full_name_map(&refs);
                        self.refs = Some(refs);
                        self.last_problem = None;
                    }
                    Err(problem) => self.last_problem = Some(problem),
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            StoreMsg::History { generation, mode, page } if generation == self.history_generation => {
                self.history.loading_more = false;
                match page {
                    Ok(page) => self.ingest_history(page, mode),
                    Err(problem) => self.last_problem = Some(problem),
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            StoreMsg::PathDiff { generation, path_id, diff } if generation == self.diff_generation => {
                match diff {
                    Ok(diff) => {
                        self.path_diff = Some(diff);
                        self.selected_path = path_id;
                        self.last_problem = None;
                    }
                    Err(problem) => self.last_problem = Some(problem),
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            StoreMsg::CommitDetail { generation, detail }
                if generation == self.history_generation =>
            {
                match detail {
                    Ok((page, files)) => {
                        self.commit_detail = Some(CommitDetailState { message_page: page, files });
                        self.last_problem = None;
                    }
                    Err(problem) => self.last_problem = Some(problem),
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            StoreMsg::Submitted { describe, result } => {
                match result {
                    Ok(submit) => {
                        self.last_problem = None;
                        // The event stream reports the operation's progress; seed the
                        // status bar from the accepted record right away.
                        self.running =
                            Some((submit.record.operation_id.clone(), submit.record.kind));
                        let _ = describe;
                    }
                    Err(problem) => {
                        self.last_problem = Some(problem);
                    }
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            // Anything from a stale generation is dropped silently: a newer request of
            // the same stream has superseded it.
            _ => {}
        }
    }

    /// Fold one history page into the graph. A reset replaces the cache; an append lays
    /// the new page out with the previous page's continuation lanes, which is what
    /// keeps a merge line running across a page boundary.
    fn ingest_history(&mut self, page: HistoryPage, mode: HistoryFetch) {
        // The colour rule needs HEAD's branch and its remote twin; extract them first so
        // the closure owns its data instead of borrowing the store it is about to mutate.
        let head_branch = self.status.as_ref().and_then(|status| {
            status.head.branch_name.clone().map(|branch| format!("refs/heads/{branch}"))
        });
        let head_remote = self.refs.as_ref().and_then(|refs| {
            let branch =
                self.status.as_ref().and_then(|status| status.head.branch_name.clone())?;
            refs.remote_branches
                .iter()
                .find(|remote| remote.name.ends_with(&format!("/{branch}")))
                .map(|remote| remote.full_name.clone())
        });
        let color_for_ref = move |commit: &GraphCommit| {
            if commit.ref_names.iter().any(|name| {
                Some(name) == head_branch.as_ref() || Some(name) == head_remote.as_ref()
            }) {
                return Some("lane-current".to_owned());
            }
            let others: Vec<String> = commit
                .ref_names
                .iter()
                .filter(|name| !name.ends_with("/HEAD"))
                .cloned()
                .collect();
            ref_color_for(&others, default_palette())
        };

        let commits: Vec<GraphCommit> = page
            .commits
            .iter()
            .map(|commit| GraphCommit {
                id: commit.oid.clone(),
                parent_ids: commit.parents.clone(),
                ref_names: commit
                    .ref_names
                    .iter()
                    .filter_map(|name| self.history.full_names.get(name).cloned())
                    .collect(),
            })
            .collect();

        let continuation = if mode == HistoryFetch::Append {
            std::mem::take(&mut self.history.continuation)
        } else {
            Vec::new()
        };
        let options = LayoutOptions {
            color_for_ref: Some(&color_for_ref),
            continuation,
            ..LayoutOptions::default()
        };
        let layout = layout_graph(&commits, &options);
        self.history.head_token = layout.rows.first().map(|row| row.lane_color.clone());

        match mode {
            HistoryFetch::Reset => {
                self.history.commits = page.commits.clone();
                self.history.rows = layout.rows;
                self.history.lane_count = layout.lane_count;
            }
            HistoryFetch::Append => {
                self.history.commits.extend(page.commits.iter().cloned());
                self.history.rows.extend(layout.rows);
                self.history.lane_count = self.history.lane_count.max(layout.lane_count);
            }
        }
        self.history.continuation = layout.continuation;
        self.history.cursor = page.next_cursor.clone();
    }

fn handle_event(
        &mut self,
        event: refyard_host::events::SubscriberEvent,
        cx: &mut Context<Self>,
    ) {
        let envelope = match event {
            SubscriberEvent::Event(envelope) => envelope,
            SubscriberEvent::Missed { count: _ } => {
                // The subscription fell behind: re-read everything cheap instead of
                // guessing which frames were lost.
                self.refresh_status(cx);
                self.refresh_refs(cx);
                self.refresh_history(HistoryFetch::Reset, cx);
                return;
            }
        };
        match envelope.payload {
            EventPayload::Operation { operation } => {
                let terminal = matches!(
                    operation.status,
                    OperationStatus::Succeeded
                        | OperationStatus::Failed
                        | OperationStatus::NeedsAttention
                        | OperationStatus::Unknown
                        | OperationStatus::Cancelled
                );
                if terminal {
                    if let Some((running_id, _)) = &self.running {
                        if *running_id == operation.operation_id {
                            self.running = None;
                        }
                    }
                    match &operation.status {
                        OperationStatus::Succeeded => {
                            self.last_problem = None;
                            self.refresh_status(cx);
                            self.refresh_refs(cx);
                            self.refresh_history(HistoryFetch::Reset, cx);
                            self.refresh_selected_diff(cx);
                        }
                        OperationStatus::Failed | OperationStatus::NeedsAttention => {
                            if let Some(problem) = &operation.problem {
                                self.last_problem = Some(problem.to_string());
                            }
                            // A failed write may still have moved state; re-read.
                            self.refresh_status(cx);
                        }
                        // An unknown result blocks further writes inside the host; the
                        // banner says what happened and the next submit reports the
                        // block. The UI never acknowledges on the user's behalf.
                        OperationStatus::Unknown => {
                            self.last_problem = Some(format!(
                                "the operation's result is unknown: {}. Further writes are \
                                 blocked until it is acknowledged.",
                                operation
                                    .result
                                    .as_ref()
                                    .map(|result| result.summary.clone())
                                    .unwrap_or_else(|| "Git may have changed things".to_owned())
                            ));
                        }
                        _ => {}
                    }
                }
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            EventPayload::RepositoryChanged { repository_id, worktree_ids: _, snapshot_invalidated: _ }
                if repository_id == self.repository.repository_id =>
            {
                self.refresh_status(cx);
                self.refresh_refs(cx);
                cx.emit(StoreEvent::Changed);
                cx.notify();
            }
            EventPayload::RepositoryChanged { .. } => {}
            EventPayload::EventGap { .. } => {
                self.refresh_status(cx);
                self.refresh_refs(cx);
                self.refresh_history(HistoryFetch::Reset, cx);
            }
            EventPayload::Session { .. } => {}
        }
    }

    /* ------------------------------------------------------------------ reads */

    pub fn refresh_status(&mut self, _cx: &mut Context<Self>) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.status_generation += 1;
        let generation = self.status_generation;
        let Some(status) = self.status.clone() else {
            let query = StatusQuery {
                repository_id: self.repository.repository_id.clone(),
                worktree_id: Some(self.repository.primary_worktree_id.clone()),
                include_ignored: false,
            };
            let service = self.host.service.clone();
            self.host.runtime.spawn(async move {
                let snapshot = service.status(&query).await;
                let _ = tx
                    .send(StoreMsg::Status {
                        generation,
                        snapshot: snapshot.map_err(|problem| problem.to_string()),
                    })
                    .await;
            });
            return;
        };
        let query = StatusQuery {
            repository_id: self.repository.repository_id.clone(),
            worktree_id: Some(status.worktree_id.clone()),
            include_ignored: false,
        };
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let snapshot = service.status(&query).await;
            let _ = tx
                .send(StoreMsg::Status {
                    generation,
                    snapshot: snapshot.map_err(|problem| problem.to_string()),
                })
                .await;
        });
    }

    pub fn refresh_refs(&mut self, _cx: &mut Context<Self>) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.refs_generation += 1;
        let generation = self.refs_generation;
        let repository_id = self.repository.repository_id.clone();
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let refs = service.refs(&repository_id).await;
            let _ = tx
                .send(StoreMsg::Refs { generation, refs: refs.map_err(|problem| problem.to_string()) })
                .await;
        });
    }

    /// Fetch a history page. `Reset` starts from HEAD with the current filters;
    /// `Append` continues the pinned page with its cursor and continuation lanes.
    pub fn refresh_history(&mut self, mode: HistoryFetch, cx: &mut Context<Self>) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.history_generation += 1;
        let generation = self.history_generation;
        let query = HistoryQuery {
            repository_id: self.repository.repository_id.clone(),
            worktree_id: Some(self.repository.primary_worktree_id.clone()),
            cursor: match mode {
                HistoryFetch::Reset => None,
                HistoryFetch::Append => self.history.cursor.clone(),
            },
            limit: None,
            detail_oid: None,
            first_parent_only: None,
            message: self.history.filters.message.clone(),
            author: self.history.filters.author.clone(),
            oid_prefix: None,
            ref_full_name: None,
            committed_after: None,
            committed_before: None,
            path_id: None,
        };
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let page = service.history(&query).await;
            let _ = tx
                .send(StoreMsg::History {
                    generation,
                    mode,
                    page: page.map_err(|problem| problem.to_string()),
                })
                .await;
        });
        if mode == HistoryFetch::Append {
            self.history.loading_more = true;
        }
        cx.emit(StoreEvent::Changed);
                cx.notify();
    }

    /// Set the filters and restart the history from HEAD.
    pub fn apply_filters(&mut self, message: Option<String>, author: Option<String>, cx: &mut Context<Self>) {
        self.history.filters = HistoryFilters { message, author };
        self.refresh_history(HistoryFetch::Reset, cx);
    }

    /// Auto-pagination: fetch the next page when the list approaches its end. The
    /// `loading_more` guard makes repeated calls idempotent.
    pub fn request_more_history_if_needed(&mut self, visible_end: usize, cx: &mut Context<Self>) {
        if self.history.loading_more || self.history.cursor.is_none() {
            return;
        }
        if visible_end + 30 >= self.history.rows.len() && !self.history.rows.is_empty() {
            self.refresh_history(HistoryFetch::Append, cx);
        }
    }

    /// Fetch the diff behind one changed path. `kind` is the section the path was
    /// clicked in, because the same path can differ between the index and the worktree.
    pub fn select_path(&mut self, path_id: String, kind: DiffKind, _cx: &mut Context<Self>) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.diff_generation += 1;
        let generation = self.diff_generation;
        let worktree_id = self
            .status
            .as_ref()
            .map(|status| status.worktree_id.clone())
            .or_else(|| Some(self.repository.primary_worktree_id.clone()));
        let query = DiffQuery {
            repository_id: self.repository.repository_id.clone(),
            worktree_id,
            kind,
            oid: None,
            from: None,
            to: None,
            path_id: Some(path_id.clone()),
            max_bytes: None,
        };
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let diff = service.diff(&query).await;
            let _ = tx
                .send(StoreMsg::PathDiff {
                    generation,
                    path_id: Some(path_id),
                    diff: diff.map_err(|problem| problem.to_string()),
                })
                .await;
        });
    }

    /// Refresh whatever path diff is currently shown (after a mutation changed it).
    fn refresh_selected_diff(&mut self, cx: &mut Context<Self>) {
        if let (Some(path_id), Some(diff)) =
            (self.selected_path.clone(), self.path_diff.as_ref().map(|d| d.request.kind))
        {
            self.select_path(path_id, diff, cx);
        }
    }

    /// Select a history commit: its full message and its changed files, in one round.
    pub fn select_commit(&mut self, oid: String, _cx: &mut Context<Self>) {
        self.selected_commit = Some(oid.clone());
        let _ = &oid;
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.history_generation += 1;
        let generation = self.history_generation;
        let repository_id = self.repository.repository_id.clone();
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let detail_query = HistoryQuery {
                repository_id: repository_id.clone(),
                detail_oid: Some(oid.clone()),
                ..HistoryQuery::for_repository(repository_id.clone())
            };
            let detail = service.history(&detail_query).await;
            let files_query = DiffQuery {
                repository_id: repository_id.clone(),
                kind: DiffKind::Commit,
                oid: Some(oid.clone()),
                ..DiffQuery::for_repository(repository_id.clone())
            };
            let files = service.diff(&files_query).await;
            let outcome = match (detail, files) {
                (Ok(page), Ok(files)) => Ok((Some(page), Some(files))),
                (Err(problem), _) | (_, Err(problem)) => Err(problem.to_string()),
            };
            let _ = tx
                .send(StoreMsg::CommitDetail { generation, detail: outcome })
                .await;
        });
    }

    /* -------------------------------------------------------------- mutations */

    fn submit(
        &mut self,
        describe: &'static str,
        target: MutationTarget,
        operation: MutationOperation,
        _cx: &mut Context<Self>,
    ) {
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.request_counter = self.request_counter.wrapping_add(1);
        let request = MutationRequest {
            client_request_id: format!("ui_{}_{:x}", millis_since_epoch(), self.request_counter),
            target,
            operation,
        };
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let result = service.submit_mutation(ACTOR, request).await;
            let _ = tx
                .send(StoreMsg::Submitted {
                    describe,
                    result: result.map_err(|problem| problem.to_string()),
                })
                .await;
        });
    }

    /// The worktree target every index/working-tree operation addresses, bound to the
    /// live status snapshot. `None` means the snapshot is not loaded yet, so the
    /// precondition could not be stated — the caller refuses instead of guessing.
    fn worktree_target(&self) -> Option<MutationTarget> {
        let status = self.status.as_ref()?;
        Some(MutationTarget::Worktree {
            repository_id: status.repository_id.clone(),
            worktree_id: status.worktree_id.clone(),
            expected_snapshot_id: status.snapshot_id.clone(),
        })
    }

    /// Stage paths: fingerprints first (the host refuses stale ones), then the stage.
    pub fn stage_paths(&mut self, path_ids: Vec<String>, cx: &mut Context<Self>) {
        let Some(target) = self.worktree_target() else {
            self.last_problem = Some("the status snapshot is not loaded yet".to_owned());
            cx.emit(StoreEvent::Changed);
                cx.notify();
            return;
        };
        let Some(tx) = self.msg_tx.clone() else {
            return;
        };
        self.request_counter = self.request_counter.wrapping_add(1);
        let previews = PreviewsRequest {
            repository_id: self.repository.repository_id.clone(),
            worktree_id: self
                .status
                .as_ref()
                .map(|status| status.worktree_id.clone())
                .unwrap_or_default(),
            path_ids: path_ids.clone(),
        };
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let outcome = match service.previews(&previews).await {
                Ok(response) => {
                    let tokens: Vec<String> = response
                        .tokens
                        .iter()
                        .map(|token| token.preview_token.clone())
                        .collect();
                    service
                        .submit_mutation(
                            ACTOR,
                            MutationRequest {
                                client_request_id: format!(
                                    "ui_{}_{:x}",
                                    millis_since_epoch(),
                                    std::process::id()
                                ),
                                target,
                                operation: MutationOperation::StagePaths {
                                    path_ids,
                                    preview_tokens: tokens,
                                },
                            },
                        )
                        .await
                }
                Err(problem) => Err(problem),
            };
            let _ = tx
                .send(StoreMsg::Submitted {
                    describe: "stage",
                    result: outcome.map_err(|problem| problem.to_string()),
                })
                .await;
        });
    }

    pub fn unstage_paths(&mut self, path_ids: Vec<String>, cx: &mut Context<Self>) {
        let Some(target) = self.worktree_target() else {
            self.last_problem = Some("the status snapshot is not loaded yet".to_owned());
            cx.emit(StoreEvent::Changed);
                cx.notify();
            return;
        };
        self.submit(
            "unstage",
            target,
            MutationOperation::UnstagePaths { path_ids },
            cx,
        );
    }

    /// Commit the index. Refused when nothing is staged or the message is empty — the
    /// host would refuse too, and refusing here keeps the queue clean.
    pub fn commit(&mut self, message: String, cx: &mut Context<Self>) {
        if message.trim().is_empty() {
            return;
        }
        let Some(target) = self.worktree_target() else {
            self.last_problem = Some("the status snapshot is not loaded yet".to_owned());
            cx.emit(StoreEvent::Changed);
                cx.notify();
            return;
        };
        self.submit("commit", target, MutationOperation::Commit { message }, cx);
    }

    pub fn switch_branch(&mut self, branch_name: String, cx: &mut Context<Self>) {
        let Some(target) = self.worktree_target() else {
            self.last_problem = Some("the status snapshot is not loaded yet".to_owned());
            cx.emit(StoreEvent::Changed);
                cx.notify();
            return;
        };
        self.submit(
            "switch",
            target,
            MutationOperation::SwitchBranch { branch_name },
            cx,
        );
    }

    pub fn create_branch(
        &mut self,
        branch_name: String,
        switch_to_it: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(target) = self.worktree_target() else {
            self.last_problem = Some("the status snapshot is not loaded yet".to_owned());
            cx.emit(StoreEvent::Changed);
                cx.notify();
            return;
        };
        self.submit(
            "create branch",
            target,
            MutationOperation::CreateBranch {
                branch_name,
                start_oid: None,
                switch_to_it,
            },
            cx,
        );
    }

    pub fn delete_branch(&mut self, branch_name: String, cx: &mut Context<Self>) {
        let target = MutationTarget::Repository {
            repository_id: self.repository.repository_id.clone(),
            expected_snapshot_id: self
                .status
                .as_ref()
                .map(|status| status.snapshot_id.clone())
                .unwrap_or_default(),
        };
        self.submit(
            "delete branch",
            target,
            MutationOperation::DeleteBranch { branch_name, confirmed: true },
            cx,
        );
    }

    /* ----------------------------------------------------------- view helpers */

    /// The capability answer for one mutation kind: is it offered by this host build?
    pub fn can(&self, kind: MutationKind) -> bool {
        self.capabilities
            .as_ref()
            .is_some_and(|capabilities| {
                capabilities.operations.iter().any(|operation| operation.kind == kind)
            })
    }

    pub fn can_read(&self, kind: ReadKind) -> bool {
        self.capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.reads.contains(&kind))
    }

    /// Split the status entries into the three sections the changes view shows.
    pub fn status_sections(&self) -> (Vec<StatusEntry>, Vec<StatusEntry>, Vec<StatusEntry>) {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let Some(status) = &self.status else {
            return (staged, unstaged, untracked);
        };
        for entry in &status.entries {
            match entry.kind {
                StatusEntryKind::Untracked => untracked.push(entry.clone()),
                StatusEntryKind::Unmerged => unstaged.push(entry.clone()),
                _ => {
                    // Porcelain letters: `.` means "no change on this side". The UI
                    // presents them; it never re-parses them into meaning.
                    let index_changed = entry.index_status != "." && !entry.index_status.is_empty();
                    let worktree_changed =
                        entry.worktree_status != "." && !entry.worktree_status.is_empty();
                    if index_changed {
                        staged.push(entry.clone());
                    }
                    if worktree_changed {
                        unstaged.push(entry.clone());
                    }
                }
            }
        }
        (staged, unstaged, untracked)
    }
}

/// A short constructor the two `..Default()` queries above rely on.
trait QueryDefaults {
    fn for_repository(repository_id: String) -> Self;
}

impl QueryDefaults for HistoryQuery {
    fn for_repository(repository_id: String) -> Self {
        Self {
            repository_id,
            worktree_id: None,
            cursor: None,
            limit: None,
            detail_oid: None,
            first_parent_only: None,
            message: None,
            author: None,
            oid_prefix: None,
            ref_full_name: None,
            committed_after: None,
            committed_before: None,
            path_id: None,
        }
    }
}

impl QueryDefaults for DiffQuery {
    fn for_repository(repository_id: String) -> Self {
        Self {
            repository_id,
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        }
    }
}

/// Short ref name → fully qualified name, from the refs read. Decorations in history
/// are short names; the layout's colour rules speak full names.
fn full_name_map(refs: &RefsSnapshot) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for branch in &refs.branches {
        map.insert(branch.name.clone(), branch.full_name.clone());
    }
    for remote in &refs.remote_branches {
        map.insert(remote.name.clone(), remote.full_name.clone());
    }
    for tag in &refs.tags {
        map.insert(tag.name.clone(), tag.full_name.clone());
    }
    map
}

fn millis_since_epoch() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}
