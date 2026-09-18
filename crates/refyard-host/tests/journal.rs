//! The journal: what this service did, persisted before it did it, and read back
//! exactly as it was left.
//!
//! Every case here exercises real files under a temporary state directory. A journal is
//! the one artifact whose whole purpose is surviving a process that died, so a mock of
//! the filesystem would test the mock: the cases below kill the process they have
//! (drop the store), reopen the directory, and judge what the next process sees.
//!
//! Two rules are load-bearing and both are asserted against the bytes on disk rather
//! than against an in-memory copy: a record is written atomically (a write in progress
//! is a temporary file, never a half-written record), and nothing in the metadata is
//! the payload (a commit message must not be findable in the journal that describes the
//! commit).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{MutationKind, MutationTarget, OperationResult, OperationStatus};
use refyard_core::preconditions::PreconditionContext;
use refyard_host::jobs::journal::EffectOutcome;
use refyard_host::jobs::journal::{canonical_payload_digest, Journal, JournalRecord};
use refyard_host::jobs::queue::{EnqueueRefusal, Queue, QueueLimits, QueueMode};
use refyard_host::jobs::recovery::Recovery;
use refyard_host::jobs::{
    EffectRequest, MutationEffect, MutationEngine, MutationOperation, MutationRequest,
    PreconditionSource, SubmitResult,
};

/* ------------------------------------------------------------------ fixture */

/// A worktree target, which is what a staging or commit request names.
fn worktree_target(repository_id: &str) -> MutationTarget {
    MutationTarget::Worktree {
        repository_id: repository_id.to_string(),
        worktree_id: "wt_1".to_string(),
        expected_snapshot_id: "snap_1".to_string(),
    }
}

/// A commit request whose message is the payload *content* that must never reach disk.
fn commit_request(client_request_id: &str, message: &str) -> MutationRequest {
    MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: worktree_target("repo_1"),
        operation: MutationOperation::Commit {
            message: message.to_string(),
        },
    }
}

fn succeeded() -> EffectOutcome {
    EffectOutcome::Succeeded {
        result: OperationResult {
            summary: "committed".to_string(),
            changed_refs: Vec::new(),
            changed_paths: Some(1),
            snapshot_invalidated: true,
            new_head_oid: Some("head2".to_string()),
        },
    }
}

/// An effect that counts how many times it ran, so "does not execute twice" is a count
/// and not an inference.
struct CountingEffect {
    runs: Arc<AtomicUsize>,
}

impl MutationEffect for CountingEffect {
    fn kind(&self) -> MutationKind {
        MutationKind::Commit
    }

    fn run<'a>(
        &'a self,
        _request: EffectRequest<'a>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = EffectOutcome> + Send + 'a>> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { succeeded() })
    }
}

/// Every precondition true: these cases are about the journal, not about freshness.
struct AlwaysFresh;

impl PreconditionSource for AlwaysFresh {
    fn write_key(&self, _request: &MutationRequest) -> Result<String, Problem> {
        Ok("repo_1".to_string())
    }

    fn context<'a>(
        &'a self,
        _request: &'a MutationRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<PreconditionContext, Problem>> + Send + 'a>,
    > {
        Box::pin(async {
            Ok(PreconditionContext {
                snapshot_head_oid: None,
                current_head_oid: None,
                index_unchanged: true,
                operation_in_progress: None,
                may_run_during: Vec::new(),
                restart_block: None,
                preview_checks: Vec::new(),
                refusal: None,
            })
        })
    }
}

/// A journal on a fresh state root inside `temp`.
fn journal_at(temp: &tempfile::TempDir) -> Journal {
    Journal::open(Some(temp.path().join("state"))).expect("the journal directory is writable")
}

/// Every file the journal wrote, for the on-disk assertions.
fn journal_files(journal: &Journal) -> Vec<PathBuf> {
    journal.on_disk_files()
}

fn read_all(files: &[PathBuf]) -> String {
    let mut text = String::new();
    for file in files {
        text.push_str(&std::fs::read_to_string(file).expect("the journal file is readable"));
        text.push('\n');
    }
    text
}

/// Waits for an operation to reach a terminal state, then returns the record.
async fn wait_terminal(
    engine: &Arc<MutationEngine>,
    operation_id: &str,
) -> refyard_contract::reads::OperationRecord {
    for _ in 0..500 {
        let record = engine
            .get("owner", operation_id)
            .unwrap_or_else(|problem| panic!("the operation must exist: {problem:?}"));
        if record.finished_at.is_some() {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation {operation_id} never reached a terminal state");
}

/* ------------------------------------------------------------------ durability and content */

#[tokio::test]
async fn a_record_is_on_disk_before_it_is_reported_and_holds_no_payload_content() {
    let temp = tempfile::tempdir().expect("temp dir");
    let journal = Arc::new(journal_at(&temp));
    let runs = Arc::new(AtomicUsize::new(0));
    let engine = MutationEngine::new(
        Arc::clone(&journal),
        Arc::new(Recovery::new()),
        vec![Box::new(CountingEffect {
            runs: Arc::clone(&runs),
        })],
    );

    // A commit message is the payload here: the journal must be able to say that this
    // operation happened without becoming a second copy of what it committed.
    let secret = "message only the client should hold";
    let submitted = engine
        .submit("owner", commit_request("crid-1", secret), &AlwaysFresh)
        .await
        .expect("accepted");
    let accepted: SubmitResult = submitted;
    assert!(!accepted.duplicate);
    let operation_id = accepted.record.operation_id.clone();
    assert_eq!(accepted.record.status, OperationStatus::Accepted);

    let finished = wait_terminal(&engine, &operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);
    assert!(finished.started_at.is_some());
    assert!(finished.finished_at.is_some());
    assert_eq!(
        finished
            .result
            .as_ref()
            .map(|result| result.summary.as_str()),
        Some("committed")
    );

    // The record is on disk, and the payload content is not.
    let files = journal_files(&journal);
    assert!(!files.is_empty(), "the journal wrote nothing");
    let text = read_all(&files);
    assert!(
        text.contains(&operation_id),
        "the record must name the operation"
    );
    assert!(
        !text.contains(secret),
        "the journal metadata contains payload content: {text}"
    );
    let digest = canonical_payload_digest(&commit_request("crid-1", secret));
    assert!(
        text.contains(&digest),
        "the payload digest is the identity the journal keeps instead of the payload"
    );

    // Atomicity: a write in progress is a temporary file and the rename is what publishes
    // it, so no `.tmp` may be left behind by a completed append.
    let records = journal
        .records_dir()
        .expect("a persistent journal has a records directory");
    let leftovers: Vec<String> = std::fs::read_dir(&records)
        .expect("read the records directory")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temporary files were left: {leftovers:?}"
    );
}

#[tokio::test]
async fn a_restart_reads_back_every_record_from_the_directory_alone() {
    let temp = tempfile::tempdir().expect("temp dir");
    let root = temp.path().join("state");
    {
        let journal = Journal::open(Some(root.clone())).expect("open");
        let first = committed_record("op_1", "crid-1", "repo_1", 1, OperationStatus::Succeeded);
        let second = committed_record("op_2", "crid-2", "repo_1", 2, OperationStatus::Failed);
        journal.append(first).expect("append the first");
        journal.append(second).expect("append the second");
        assert_eq!(journal.records().len(), 2);
    }
    // A new process, reading only what the previous one left.
    let reopened = Journal::open(Some(root)).expect("reopen");
    assert_eq!(reopened.records().len(), 2);
    let first = reopened.get("op_1").expect("the first record survives");
    assert_eq!(first.client_request_id, "crid-1");
    assert_eq!(first.status, OperationStatus::Succeeded);
    let listed = reopened.list_for("owner", 10);
    assert_eq!(
        listed.first().map(|record| record.operation_id.as_str()),
        Some("op_2"),
        "the newest operation is listed first"
    );
    assert!(reopened.unfinished().is_empty());

    // A temporary file that was never renamed is a write that did not happen, not a
    // record: reading it would attribute a state nobody observed.
    let records = reopened.records_dir().expect("records dir");
    std::fs::write(records.join("torn.json.tmp"), "{ this is not a record").expect("write");
    let after =
        Journal::open(Some(reopened.state_root().expect("root").to_path_buf())).expect("reopen");
    assert_eq!(after.records().len(), 2, "a torn write is not a record");

    // A published record that cannot be read is a different thing: the file was written
    // by something that is not this service, and guessing which records are real is worse
    // than refusing to interpret the directory.
    let victim = reopened
        .on_disk_files()
        .into_iter()
        .find(|path| path.to_string_lossy().contains("op_1"))
        .expect("a record file for op_1");
    std::fs::write(&victim, "not json at all").expect("corrupt the record");
    let refused = Journal::open(Some(reopened.state_root().expect("root").to_path_buf()))
        .expect_err("an unreadable record is refused");
    assert_eq!(refused.code, ProblemCode::InternalError, "{refused:?}");
}

/* ------------------------------------------------------------------ ordering */

#[test]
fn start_must_precede_finish_and_a_finished_operation_is_never_rewritten() {
    let temp = tempfile::tempdir().expect("temp dir");
    let journal = journal_at(&temp);
    let record = committed_record("op_1", "crid-1", "repo_1", 1, OperationStatus::Accepted);
    journal.append(record).expect("append accepted");

    // Finishing something that never started would claim an outcome for a run whose start
    // was never recorded — exactly the ordering the journal exists to make visible.
    let early = journal
        .finish(
            "op_1",
            EffectOutcome::Succeeded {
                result: OperationResult {
                    summary: "committed".to_string(),
                    changed_refs: Vec::new(),
                    changed_paths: None,
                    snapshot_invalidated: true,
                    new_head_oid: None,
                },
            },
            10,
        )
        .expect_err("a finish without a start is a bug, not a state");
    assert_eq!(early.code, ProblemCode::InternalError, "{early:?}");

    let started = journal.mark_started("op_1", 5).expect("start");
    assert_eq!(started.status, OperationStatus::Running);
    assert_eq!(started.started_at_ms, Some(5));

    // A second start is two runs of one operation.
    let twice = journal
        .mark_started("op_1", 6)
        .expect_err("only one start per operation");
    assert_eq!(twice.code, ProblemCode::InternalError, "{twice:?}");

    let finished = journal
        .finish(
            "op_1",
            EffectOutcome::Failed {
                problem: Problem::new(ProblemCode::GitCommandFailed, "hook refused"),
            },
            20,
        )
        .expect("finish");
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(finished.finished_at_ms, Some(20));

    // A terminal state is terminal: the journal is what a client reads as fact, so a later
    // write must not be able to revise it.
    let again = journal
        .finish(
            "op_1",
            EffectOutcome::Succeeded {
                result: OperationResult {
                    summary: "committed".to_string(),
                    changed_refs: Vec::new(),
                    changed_paths: None,
                    snapshot_invalidated: true,
                    new_head_oid: None,
                },
            },
            30,
        )
        .expect_err("a terminal record is not rewritten");
    assert_eq!(again.code, ProblemCode::InternalError, "{again:?}");
}

fn committed_record(
    operation_id: &str,
    client_request_id: &str,
    write_key: &str,
    sequence: u64,
    status: OperationStatus,
) -> JournalRecord {
    JournalRecord {
        operation_id: operation_id.to_string(),
        client_request_id: client_request_id.to_string(),
        actor: "owner".to_string(),
        kind: MutationKind::Commit,
        target: worktree_target(write_key),
        status,
        sequence,
        accepted_at_ms: 1_000,
        started_at_ms: None,
        finished_at_ms: None,
        payload_digest: canonical_payload_digest(&commit_request(client_request_id, "x")),
        write_key: write_key.to_string(),
        result: None,
        problem: None,
        unknown_reason: None,
        acknowledged_at_ms: None,
    }
}

/* ------------------------------------------------------------------ idempotency */

#[tokio::test]
async fn the_same_request_id_and_payload_is_the_same_operation_and_runs_once() {
    let temp = tempfile::tempdir().expect("temp dir");
    let journal = Arc::new(journal_at(&temp));
    let runs = Arc::new(AtomicUsize::new(0));
    let engine = MutationEngine::new(
        Arc::clone(&journal),
        Arc::new(Recovery::new()),
        vec![Box::new(CountingEffect {
            runs: Arc::clone(&runs),
        })],
    );

    let request = commit_request("crid-1", "first message");
    let first = engine
        .submit("owner", request.clone(), &AlwaysFresh)
        .await
        .expect("accepted");
    assert!(!first.duplicate);
    let operation_id = first.record.operation_id.clone();
    let finished = wait_terminal(&engine, &operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);

    // A client that lost the response retries: the same id and the same payload is the same
    // operation, and the answer is the record that already exists.
    let retried = engine
        .submit("owner", request.clone(), &AlwaysFresh)
        .await
        .expect("duplicate");
    assert!(retried.duplicate);
    assert_eq!(retried.record.operation_id, operation_id);
    assert_eq!(retried.record.status, OperationStatus::Succeeded);
    assert_eq!(
        runs.load(Ordering::SeqCst),
        1,
        "the effect ran a second time for one client request"
    );

    // The same id with a different payload is a different request wearing a used key.
    let conflicting = engine
        .submit(
            "owner",
            commit_request("crid-1", "a different message"),
            &AlwaysFresh,
        )
        .await
        .expect_err("one id cannot name two payloads");
    assert_eq!(
        conflicting.code,
        ProblemCode::IdempotencyConflict,
        "{conflicting:?}"
    );
    assert_eq!(
        conflicting.operation_id.as_deref(),
        Some(operation_id.as_str()),
        "the refusal names the operation the key already belongs to"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // Serialising the same values in a different key order is the same payload, not a
    // conflict: a client's JSON key order is not part of what it asked for.
    let reordered = serde_json::json!({
        "operation": { "message": "first message", "kind": "commit" },
        "clientRequestId": "crid-1",
        "target": {
            "expectedSnapshotId": "snap_1",
            "worktreeId": "wt_1",
            "repositoryId": "repo_1",
            "kind": "worktree",
        },
    });
    let parsed: MutationRequest = serde_json::from_value(reordered).expect("the wire shape parses");
    let duplicate = engine
        .submit("owner", parsed, &AlwaysFresh)
        .await
        .expect("the same payload in another key order");
    assert!(duplicate.duplicate);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

/* ------------------------------------------------------------------ the queue */

#[test]
fn the_queue_bounds_each_actor_and_serialises_writers_of_one_repository() {
    let queue: Queue<&'static str> = Queue::new(QueueLimits {
        max_queued_per_actor: 4,
        max_global_git_processes: 4,
        max_readers_per_repository: 2,
    });

    // The per-actor bound: a client that submits faster than work completes is told the
    // queue is full rather than growing the process until it dies.
    queue
        .enqueue("op_1", "owner", "repo_1", QueueMode::Write, "first")
        .expect("the first write is queued");
    let duplicate = queue
        .enqueue("op_1", "owner", "repo_1", QueueMode::Write, "again")
        .expect_err("one operation id is one queued job");
    assert_eq!(duplicate, EnqueueRefusal::AlreadyQueued);
    queue
        .enqueue("op_2", "owner", "repo_1", QueueMode::Write, "second")
        .expect("a second write is a queue, not a conflict");
    queue
        .enqueue("op_3", "owner", "repo_2", QueueMode::Read, "elsewhere")
        .expect("another repository is unaffected by a busy one");
    queue
        .enqueue("op_4", "owner", "repo_3", QueueMode::Read, "and another")
        .expect("queued");
    let full = queue
        .enqueue("op_5", "owner", "repo_1", QueueMode::Write, "third")
        .expect_err("four queued operations are the bound this actor stated");
    assert_eq!(full, EnqueueRefusal::QueueFull);

    // One writer per repository, and a read of a repository being written waits for it.
    // A job that cannot start does not block the one behind it, so the reads of the other
    // repositories start in the same pass.
    let started = queue.take_startable();
    let ids: Vec<&str> = started.iter().map(|ticket| ticket.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["op_1", "op_3", "op_4"],
        "the second write of repo_1 must not start beside the first"
    );
    queue
        .enqueue(
            "op_6",
            "owner",
            "repo_1",
            QueueMode::Read,
            "read of the busy repository",
        )
        .expect("a read is queued");
    assert!(
        queue.take_startable().is_empty(),
        "a read must not run beside a write of the same repository"
    );

    // Cancellation only applies to work that has not started.
    assert!(!queue.cancel("op_1"), "a running job is not cancellable");
    assert!(queue.cancel("op_2"), "a queued job is");

    // Once the writer finishes, the read that was waiting starts.
    queue.release("op_1");
    let after = queue.take_startable();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, "op_6");
    queue.release("op_3");
    queue.release("op_4");
    queue.release("op_6");
    assert_eq!(queue.running_count(), 0);
    assert_eq!(queue.pending_count(), 0);
}

/* ------------------------------------------------------------------ the same through the service */

#[test]
fn a_state_directory_is_the_only_thing_a_journal_needs_to_be_durable() {
    // A memory-only journal is what a host that named no state directory gets: it works,
    // and it says so rather than pretending to be durable.
    let memory = Journal::open(None).expect("an in-memory journal");
    assert!(memory.state_root().is_none());
    memory
        .append(committed_record(
            "op_1",
            "crid-1",
            "repo_1",
            1,
            OperationStatus::Accepted,
        ))
        .expect("append");
    assert_eq!(memory.records().len(), 1);
    assert!(memory.on_disk_files().is_empty());
    assert!(!Path::new("state").exists());
}
