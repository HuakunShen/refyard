//! Transport-neutral embedding facade for Refyard.
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use refyard_contract::diff::{DiffQuery, DiffResponse};
use refyard_contract::history::{HistoryPage, HistoryQuery};
use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{
    CapabilitiesResponse, EventEnvelope, FilesystemEntriesQuery, FilesystemEntriesResponse,
    MutationKind, OperationRecord, OperationsListResponse, PreviewsRequest, PreviewsResponse,
    RepositoriesResponse, StashesResponse, StatusSnapshot, SubmodulesResponse, WorkspaceRootId,
    WorktreesResponse,
};
use refyard_contract::refs::RefsSnapshot;

use crate::events::EventSubscription;
use crate::jobs::queue::QueueLimits;
use crate::jobs::{ClientRequestLookup, MutationRequest, SubmitResult};
use crate::providers::local::LocalGit;
use crate::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

#[derive(Debug, Clone)]
pub struct EmbedLimits {
    pub queue: QueueLimits,
    pub structured_stdout_max_bytes: usize,
    pub stderr_diagnostic_max_bytes: usize,
    pub event_ring_max_events: usize,
    pub event_ring_max_bytes: usize,
    pub repository_max_count: usize,
    pub output_max_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct EmbedConfig {
    pub state_root: PathBuf,
    pub home: PathBuf,
    pub git: LocalGit,
    pub limits: EmbedLimits,
    pub enabled_mutations: BTreeSet<MutationKind>,
    pub service_instance_id: String,
    pub target_id: String,
    pub target_generation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbedRecoveryState {
    pub operation_ids: Vec<String>,
    pub reason: String,
    pub since_ms: i64,
}

#[derive(Clone)]
pub struct EmbeddedRefyard {
    service: Arc<ApplicationService>,
}

impl EmbeddedRefyard {
    pub fn open(config: EmbedConfig) -> Result<Self, Problem> {
        if config.state_root.as_os_str().is_empty() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                "embedded Refyard requires an explicit non-empty state_root",
            ));
        }
        std::fs::create_dir_all(&config.state_root).map_err(|error| {
            Problem::new(
                ProblemCode::Unavailable,
                format!("cannot create embedded state root: {error}"),
            )
        })?;
        let limits = config.limits;
        let service = ApplicationService::new(ApplicationServiceConfig {
            git: config.git.with_output_limits(
                limits
                    .structured_stdout_max_bytes
                    .min(limits.output_max_bytes),
                limits.stderr_diagnostic_max_bytes,
            ),
            service_instance_id: config.service_instance_id,
            target_id: config.target_id,
            target_generation: config.target_generation,
            home: config.home,
        })
        .with_embed_options(
            limits.queue,
            limits.event_ring_max_events,
            limits.event_ring_max_bytes,
            limits.repository_max_count,
            config.enabled_mutations,
        )
        .with_state_root(config.state_root)?;
        Ok(Self {
            service: Arc::new(service),
        })
    }

    pub async fn close(self) -> Result<(), Problem> {
        self.service.engine_shutdown().await?;
        drop(self);
        Ok(())
    }

    pub fn capabilities(&self) -> Result<CapabilitiesResponse, Problem> {
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|error| {
                        Problem::new(
                            ProblemCode::InternalError,
                            format!("capability runtime: {error}"),
                        )
                    })
                    .and_then(|runtime| runtime.block_on(self.service.capabilities()))
            });
            handle.join().map_err(|_| {
                Problem::new(
                    ProblemCode::InternalError,
                    "capability probe thread panicked",
                )
            })?
        })
    }

    pub async fn repositories(&self) -> RepositoriesResponse {
        self.service.repositories().await
    }
    pub async fn register_repository(&self, path: &str) -> Result<RepositoriesResponse, Problem> {
        self.service.register_repository(path).await
    }
    pub async fn revoke_repository(
        &self,
        repository_id: &str,
    ) -> Result<RepositoriesResponse, Problem> {
        self.service.revoke_repository(repository_id).await
    }
    pub async fn remove_workspace_root(
        &self,
        allowed_root_id: &WorkspaceRootId,
    ) -> Result<RepositoriesResponse, Problem> {
        self.service.remove_workspace_root(allowed_root_id).await?;
        Ok(self.service.repositories().await)
    }
    pub async fn status(&self, query: &StatusQuery) -> Result<StatusSnapshot, Problem> {
        self.service.status(query).await
    }
    pub async fn history(&self, query: &HistoryQuery) -> Result<HistoryPage, Problem> {
        self.service.history(query).await
    }
    pub async fn refs(&self, repository_id: &str) -> Result<RefsSnapshot, Problem> {
        self.service.refs(repository_id).await
    }
    pub async fn refs_for_worktree(
        &self,
        repository_id: &str,
        worktree_id: &str,
    ) -> Result<RefsSnapshot, Problem> {
        self.service
            .refs_for_worktree(repository_id, worktree_id)
            .await
    }
    pub async fn stashes_for_worktree(
        &self,
        repository_id: &str,
        worktree_id: &str,
    ) -> Result<StashesResponse, Problem> {
        self.service
            .stashes_for_worktree(repository_id, worktree_id)
            .await
    }
    pub async fn submodules_for_worktree(
        &self,
        repository_id: &str,
        worktree_id: &str,
    ) -> Result<SubmodulesResponse, Problem> {
        self.service
            .submodules_for_worktree(repository_id, worktree_id)
            .await
    }
    pub async fn diff(&self, query: &DiffQuery) -> Result<DiffResponse, Problem> {
        self.service.diff(query).await
    }
    pub async fn worktrees(&self, repository_id: &str) -> Result<WorktreesResponse, Problem> {
        self.service
            .worktrees_with_root_bindings(repository_id)
            .await
            .map(|result| result.response)
    }
    pub async fn worktrees_with_root_bindings(
        &self,
        repository_id: &str,
    ) -> Result<crate::reads::worktrees::WorktreesWithRootBindings, Problem> {
        self.service
            .worktrees_with_root_bindings(repository_id)
            .await
    }
    pub async fn filesystem_entries(
        &self,
        query: &FilesystemEntriesQuery,
    ) -> Result<FilesystemEntriesResponse, Problem> {
        self.service
            .filesystem_entries_on(query.path.as_deref(), query.target_id.as_deref())
            .await
    }
    pub async fn previews(&self, query: &PreviewsRequest) -> Result<PreviewsResponse, Problem> {
        self.service.previews(query).await
    }
    pub async fn submit_mutation(
        &self,
        actor: &str,
        request: MutationRequest,
    ) -> Result<SubmitResult, Problem> {
        self.service.submit_mutation(actor, request).await
    }
    pub fn operation_for(
        &self,
        actor: &str,
        operation_id: &str,
    ) -> Result<OperationRecord, Problem> {
        self.service.operation_for(actor, operation_id)
    }
    pub fn get_by_client_request_id(
        &self,
        actor: &str,
        client_request_id: &str,
    ) -> Result<ClientRequestLookup, Problem> {
        self.service
            .get_by_client_request_id(actor, client_request_id)
    }
    pub fn operations(&self, actor: &str, limit: usize) -> OperationsListResponse {
        self.service.operations(actor, limit)
    }
    pub fn cancel_operation(
        &self,
        actor: &str,
        operation_id: &str,
    ) -> Result<OperationRecord, Problem> {
        self.service.cancel_operation(actor, operation_id)
    }

    pub fn recovery_for_repository(
        &self,
        repository_id: &str,
    ) -> Result<Option<EmbedRecoveryState>, Problem> {
        self.service.recovery_for_repository(repository_id)
    }
    pub fn acknowledge_uncertain_operation(
        &self,
        operation_id: &str,
        confirmed_snapshot_id: &str,
    ) -> Result<OperationRecord, Problem> {
        self.service
            .acknowledge_uncertain_operation(operation_id, confirmed_snapshot_id)
    }
    pub fn subscribe_events(&self) -> EventSubscription {
        self.service.subscribe_events()
    }
    pub fn replay_events(&self, since: Option<u64>) -> Vec<EventEnvelope> {
        self.service.events().replay(since)
    }
}
