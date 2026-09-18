//! The write path's substrate: a request that is journalled before it runs, a bound
//! queue, and an effect seam.
//!
//! This module is where a mutation *becomes* an operation. It owns the order the design
//! requires — accepted on disk, then running, then a terminal state — and it owns the two
//! rules that keep a retry from becoming a second write: an operation is identified by its
//! payload digest, and a repository an unresolved operation touched accepts nothing until
//! someone confirms its state.
//!
//! It does not own any Git semantics. An effect is a trait this module defines and a later
//! slice implements; the engine only journals what an effect answered, including the
//! answer "nobody knows", and it never retries one. This build registers **no** effects, so
//! `implemented_kinds` is empty and every submission is refused with `UnsupportedOperation`
//! before anything is journalled — which is what `capabilities().operations` being empty
//! promises.

pub mod journal;
pub mod queue;
pub mod recovery;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{
    MutationKind, MutationTarget, OperationRecord, OperationStatus, OperationsListResponse,
};
use refyard_core::preconditions::{check_preconditions, PreconditionContext, RestartWriteBlock};
use serde::{Deserialize, Serialize};

use crate::clock::now_millis;
use crate::jobs::journal::{canonical_payload_digest, EffectOutcome, Journal, JournalRecord};
use crate::jobs::queue::{EnqueueRefusal, Queue, QueueLimits, QueueMode, QueueTicket};
use crate::jobs::recovery::{Recovery, WriteBlock};
use crate::paths::base36;

/// The mutation the write path can carry, as the host understands it.
///
/// A projection of the contract's closed union: only the operations this slice can reason
/// about are here, unknown fields are refused, and an operation kind that is absent fails
/// to deserialize rather than becoming a request the host half-understands. The variants
/// this build cannot run are added by the task that implements them; naming one today is
/// an `InvalidRequest`, which is the honest answer to a request this host cannot parse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MutationOperation {
    StagePaths {
        path_ids: Vec<String>,
        preview_tokens: Vec<String>,
    },
    UnstagePaths {
        path_ids: Vec<String>,
    },
    Commit {
        message: String,
    },
}

impl MutationOperation {
    pub fn kind(&self) -> MutationKind {
        match self {
            Self::StagePaths { .. } => MutationKind::StagePaths,
            Self::UnstagePaths { .. } => MutationKind::UnstagePaths,
            Self::Commit { .. } => MutationKind::Commit,
        }
    }

    /// The paths this operation selected, for a precondition check that needs them.
    pub fn path_ids(&self) -> Vec<String> {
        match self {
            Self::StagePaths { path_ids, .. } | Self::UnstagePaths { path_ids } => path_ids.clone(),
            Self::Commit { .. } => Vec::new(),
        }
    }

    /// The preview tokens this operation presented, in the order of [`Self::path_ids`].
    pub fn preview_tokens(&self) -> Vec<String> {
        match self {
            Self::StagePaths { preview_tokens, .. } => preview_tokens.clone(),
            _ => Vec::new(),
        }
    }
}

/// One mutation request: an idempotency key, the resource it addresses, and the operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationRequest {
    pub client_request_id: String,
    pub target: MutationTarget,
    pub operation: MutationOperation,
}

impl MutationRequest {
    /// The repository this request addresses, when it addresses one.
    pub fn repository_id(&self) -> Option<&str> {
        match &self.target {
            MutationTarget::Repository { repository_id, .. }
            | MutationTarget::Worktree { repository_id, .. } => Some(repository_id),
            MutationTarget::Workspace { .. } => None,
        }
    }

    /// The worktree this request addresses, when it addresses one.
    pub fn worktree_id(&self) -> Option<&str> {
        match &self.target {
            MutationTarget::Worktree { worktree_id, .. } => Some(worktree_id),
            _ => None,
        }
    }
}

/// What one effect is given when it runs.
#[derive(Debug)]
pub struct EffectRequest<'a> {
    pub operation_id: &'a str,
    pub actor: &'a str,
    /// The key the operation serialises under. An effect that shells out uses it to read
    /// the state it is about to change.
    pub write_key: &'a str,
    pub request: &'a MutationRequest,
}

/// One implemented mutation.
///
/// The future is boxed by hand rather than by a dependency: the workspace has no
/// `async-trait`, and one `Pin<Box<…>>` per call is not worth adding one.
pub trait MutationEffect: Send + Sync {
    fn kind(&self) -> MutationKind;
    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = EffectOutcome> + Send + 'a>>;
}

/// The facts the write path cannot read on its own.
///
/// The journal, the queue and the block live here; whether the repository moved, whether an
/// operation is in progress and whether the previewed content is still the same is the
/// service's to answer, because it needs the reads.
pub trait PreconditionSource: Send + Sync {
    /// The key this request serialises and blocks under.
    ///
    /// For a repository or worktree target it is the repository's own stable identity
    /// (its target and common Git directory), not the id this process minted: a block has
    /// to be findable again after a restart, when the minted id is gone.
    fn write_key(&self, request: &MutationRequest) -> Result<String, Problem>;

    fn context<'a>(
        &'a self,
        request: &'a MutationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<PreconditionContext, Problem>> + Send + 'a>>;
}

/// The answer to one submission.
#[derive(Debug, Clone)]
pub struct SubmitResult {
    pub record: OperationRecord,
    /// True when this request id and payload were already submitted and the effect did not
    /// run again.
    pub duplicate: bool,
}

/// The write path: journal, queue, effects and the rules that join them.
pub struct MutationEngine {
    journal: Arc<Journal>,
    recovery: Arc<Recovery>,
    effects: Vec<Box<dyn MutationEffect>>,
    queue: Queue<MutationRequest>,
    next_operation: AtomicU64,
}

impl MutationEngine {
    /// Builds the engine. The effects are what this build can actually run; an empty set
    /// means no mutation is accepted, which is the honest state of a read-only slice.
    pub fn new(
        journal: Arc<Journal>,
        recovery: Arc<Recovery>,
        effects: Vec<Box<dyn MutationEffect>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            journal,
            recovery,
            effects,
            queue: Queue::new(QueueLimits::default()),
            next_operation: AtomicU64::new(0),
        })
    }

    /// The kinds this build can run, in the order the contract lists them.
    pub fn implemented_kinds(&self) -> Vec<MutationKind> {
        refyard_contract::reads::MUTATION_KINDS
            .iter()
            .copied()
            .filter(|kind| self.effects.iter().any(|effect| effect.kind() == *kind))
            .collect()
    }

    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    pub fn recovery(&self) -> &Recovery {
        &self.recovery
    }

    /// Submits one request, journalling it before it may run.
    ///
    /// The facts the write path cannot read on its own come from `source`, which the
    /// caller passes: it borrows the reads for the length of this call and is not stored,
    /// which is what keeps the service from having to hold a reference to itself.
    pub async fn submit(
        self: &Arc<Self>,
        actor: &str,
        request: MutationRequest,
        source: &dyn PreconditionSource,
    ) -> Result<SubmitResult, Problem> {
        let digest = canonical_payload_digest(&request);

        // Idempotency: the same client request id and the same payload is the same
        // operation, and the answer is the record that already exists.
        if let Some(existing) = self
            .journal
            .find_client_request(actor, &request.client_request_id)
        {
            if existing.payload_digest != digest {
                return Err(Problem::new(
                    ProblemCode::IdempotencyConflict,
                    "that client request id was already used with a different payload; use a new id for the changed request",
                )
                .for_operation(existing.operation_id));
            }
            return Ok(SubmitResult {
                record: existing.to_operation_record(),
                duplicate: true,
            });
        }

        let kind = request.operation.kind();
        if !self.effects.iter().any(|effect| effect.kind() == kind) {
            // Nothing is journalled: an operation this build cannot run is not an
            // operation, and a record for one would be a claim it was accepted.
            return Err(Problem::new(
                ProblemCode::UnsupportedOperation,
                format!("{kind:?} is not implemented in this build; no operation was accepted"),
            ));
        }

        let write_key = source.write_key(&request)?;

        // Freshness and the write block. The block is filled in here from the recovery —
        // never from the source — so an effect cannot be accepted for a repository that is
        // blocked because a source forgot to look.
        let block = self.recovery.block_for(&write_key);
        let mut context = source.context(&request).await?;
        context.restart_block = block.as_ref().map(restart_block_of);
        check_preconditions(&context)?;

        let operation_id = format!(
            "op_{}",
            base36(self.next_operation.fetch_add(1, Ordering::SeqCst) + 1)
        );
        let accepted = JournalRecord {
            operation_id: operation_id.clone(),
            client_request_id: request.client_request_id.clone(),
            actor: actor.to_string(),
            kind,
            target: request.target.clone(),
            status: OperationStatus::Accepted,
            // The journal assigns the sequence: it is the one that knows the highest one
            // it has written.
            sequence: 0,
            accepted_at_ms: now_millis(),
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: digest,
            write_key: write_key.clone(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        };
        // Persist `accepted` before the operation may run. A failure here means the
        // operation is refused, not accepted-and-forgotten.
        if let Err(problem) = self.journal.append(accepted) {
            return Err(Problem::new(
                ProblemCode::ResourceBusy,
                format!(
                    "the operation journal could not record this request: {}",
                    problem.message
                ),
            )
            .retryable());
        }

        if let Err(refusal) = self.queue.enqueue(
            operation_id.clone(),
            actor,
            &write_key,
            QueueMode::Write,
            request,
        ) {
            let (code, message, retryable) = match refusal {
                EnqueueRefusal::QueueFull => (
                    ProblemCode::ResourceBusy,
                    "this session already has the maximum number of operations waiting; wait for them to finish".to_string(),
                    true,
                ),
                EnqueueRefusal::AlreadyQueued => (
                    ProblemCode::Conflict,
                    "that operation is already queued".to_string(),
                    false,
                ),
            };
            let problem = Problem::new(code, message);
            self.journal
                .finish_without_start(&operation_id, problem.clone(), now_millis())?;
            return Err(if retryable {
                problem.retryable()
            } else {
                problem
            });
        }

        self.pump();
        let record = self.journal.get(&operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::InternalError,
                "the operation was journalled but cannot be read back",
            )
        })?;
        Ok(SubmitResult {
            record: record.to_operation_record(),
            duplicate: false,
        })
    }

    /// One operation, as its client may read it.
    pub fn get(&self, actor: &str, operation_id: &str) -> Result<OperationRecord, Problem> {
        let record = self.journal.get(operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.actor != actor {
            // An operation belongs to the session that submitted it; another session's
            // record is not this one's to read.
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            ));
        }
        Ok(record.to_operation_record())
    }

    /// This actor's recent operations, newest first.
    pub fn list(&self, actor: &str, limit: usize) -> OperationsListResponse {
        let records = self.journal.list_for(actor, limit);
        OperationsListResponse {
            truncated: records.len() >= limit,
            operations: records
                .into_iter()
                .map(|record| record.to_operation_record())
                .collect(),
        }
    }

    /// Cancels an operation that has not started.
    pub fn cancel(&self, actor: &str, operation_id: &str) -> Result<OperationRecord, Problem> {
        let record = self.journal.get(operation_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.actor != actor {
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            ));
        }
        if record.status != OperationStatus::Accepted {
            // A running mutation is never relabelled: it may already have changed the
            // repository, and calling that "cancelled" would hide the change.
            return Err(Problem::new(
                ProblemCode::Conflict,
                if record.status == OperationStatus::Running {
                    "that operation is already running; a running mutation cannot be cancelled in this version"
                } else {
                    "that operation already finished"
                },
            )
            .for_operation(operation_id));
        }
        if !self.queue.cancel(operation_id) {
            // The queue no longer has it, so it has started between the two reads.
            return Err(Problem::new(
                ProblemCode::Conflict,
                "that operation is already running; a running mutation cannot be cancelled in this version",
            )
            .for_operation(operation_id));
        }
        let cancelled = self.journal.mark_cancelled(operation_id, now_millis())?;
        Ok(cancelled.to_operation_record())
    }

    /// Starts every queued operation the limits allow.
    fn pump(self: &Arc<Self>) {
        for ticket in self.queue.take_startable() {
            let engine = Arc::clone(self);
            tokio::spawn(async move {
                engine.run_ticket(ticket).await;
            });
        }
    }

    /// Runs one operation: `running` on disk, then the effect, then its outcome.
    ///
    /// The queue slot is released by a guard, so a failure anywhere in here — including a
    /// panic in an effect — cannot leave a repository looking permanently busy.
    async fn run_ticket(self: Arc<Self>, ticket: QueueTicket<MutationRequest>) {
        let _guard = QueueSlot {
            queue: &self.queue,
            id: ticket.id.clone(),
        };
        let operation_id = ticket.id.clone();
        if self
            .journal
            .mark_started(&operation_id, now_millis())
            .is_err()
        {
            // The record is not in a state that may start; leaving it accepted is what the
            // next restart reconciles, and inventing a terminal state here would claim an
            // outcome nobody observed.
            return;
        }
        let Some(effect) = self
            .effects
            .iter()
            .find(|effect| effect.kind() == ticket.job.operation.kind())
        else {
            return;
        };
        let outcome = effect
            .run(EffectRequest {
                operation_id: &operation_id,
                actor: &ticket.actor,
                write_key: &ticket.repository_id,
                request: &ticket.job,
            })
            .await;
        if let Ok(record) = self.journal.finish(&operation_id, outcome, now_millis()) {
            if record.status == OperationStatus::Unknown {
                // An unknown outcome blocks the repository exactly as a restart does: the
                // next write would be made on top of a change nobody has confirmed.
                self.recovery.block(&record, now_millis());
            }
        }
    }
}

/// Releases one queue slot when it goes out of scope, whatever happened.
struct QueueSlot<'a> {
    queue: &'a Queue<MutationRequest>,
    id: String,
}

impl Drop for QueueSlot<'_> {
    fn drop(&mut self) {
        self.queue.release(&self.id);
    }
}

fn restart_block_of(block: &WriteBlock) -> RestartWriteBlock {
    RestartWriteBlock {
        reason: block.reason.clone(),
        operation_ids: block.operation_ids.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mutation_request_refuses_a_field_or_a_kind_it_does_not_know() {
        let parsed: Result<MutationRequest, _> = serde_json::from_value(serde_json::json!({
            "clientRequestId": "crid-1",
            "target": {
                "kind": "worktree",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "expectedSnapshotId": "snap_1",
            },
            "operation": { "kind": "stagePaths", "pathIds": ["path_1"], "previewTokens": ["pt_1"] },
        }));
        let request = parsed.expect("the contract's shape parses");
        assert_eq!(request.operation.kind(), MutationKind::StagePaths);
        assert_eq!(request.operation.path_ids(), vec!["path_1".to_string()]);
        assert_eq!(request.operation.preview_tokens(), vec!["pt_1".to_string()]);

        // A field the host does not know is not silently ignored: it could be a rule the
        // caller believes it stated.
        let extra: Result<MutationRequest, _> = serde_json::from_value(serde_json::json!({
            "clientRequestId": "crid-1",
            "target": {
                "kind": "worktree",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "expectedSnapshotId": "snap_1",
            },
            "operation": { "kind": "stagePaths", "pathIds": ["path_1"], "previewTokens": ["pt_1"], "force": true },
        }));
        assert!(extra.is_err());
    }

    #[test]
    fn a_request_names_the_repository_or_the_workspace_it_addresses_but_never_both() {
        let request = MutationRequest {
            client_request_id: "crid-1".to_string(),
            target: MutationTarget::Worktree {
                repository_id: "repo_1".to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            operation: MutationOperation::Commit {
                message: "message".to_string(),
            },
        };
        assert_eq!(request.repository_id(), Some("repo_1"));
        assert_eq!(request.worktree_id(), Some("wt_1"));
    }
}
