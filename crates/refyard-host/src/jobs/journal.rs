//! The journal: what this service did, persisted before it did it.
//!
//! The ordering rule is the whole point of this module:
//!
//! 1. write `accepted` **before** the operation may run,
//! 2. write `running` **before** Git is started,
//! 3. write the terminal state when it is known.
//!
//! A crash between those points is therefore *visible*: the next process finds a record
//! that says `accepted` or `running`, and that record is reported as `unknown` — not as a
//! success, and never retried. Without the ordering, a crash mid-commit would leave no
//! trace and the UI would show a repository in a state nobody explained.
//!
//! What is stored is what the design allows: identity, target, status, timestamps, a
//! **payload digest**, a bounded result summary and a problem. Never a diff, a commit
//! message, a password, a ticket, an SSH key, a credential-bearing URL or source code —
//! nothing that would make the journal a second copy of the user's data.
//!
//! The layout is one directory of records and one index, all JSON, all published by an
//! atomic rename:
//!
//! ```text
//! <state root>/journal/index.json              which operations exist, and the next sequence
//! <state root>/journal/records/<op>.json       one operation's metadata
//! ```
//!
//! A write in progress is a temporary file, so a crash leaves either the previous record
//! or the new one — never half of either. A temporary file that was never renamed is not a
//! record: it is a write that did not happen. A *published* record that cannot be read is a
//! different thing — the directory was edited by something that is not this service — and
//! interpreting it anyway would mean guessing which records are real.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{
    MutationKind, MutationTarget, OperationRecord, OperationResult, OperationStatus,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::clock::{format_iso8601_millis, now_millis};

/// One operation's metadata, as it is stored and as it is read back.
///
/// This is not the wire record: it carries the write key an operation is serialised and
/// blocked under, which is the host's own business, and it is the shape the file holds so
/// that what a person reads on disk and what the API reports are the same vocabulary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalRecord {
    pub operation_id: String,
    pub client_request_id: String,
    pub actor: String,
    pub kind: MutationKind,
    pub target: MutationTarget,
    pub status: OperationStatus,
    pub sequence: u64,
    pub accepted_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub finished_at_ms: Option<i64>,
    /// SHA-256 of the canonical request, for idempotency comparison. The request itself is
    /// never stored.
    pub payload_digest: String,
    /// The resource this operation serialises under: one repository's common Git
    /// directory on one target, or `root:<allowedRootId>` for an operation that creates a
    /// repository. A client never sees this; a block and a queue are keyed by it.
    pub write_key: String,
    pub result: Option<OperationResult>,
    pub problem: Option<Problem>,
    /// Why a terminal state could not be determined; present only for `unknown`.
    pub unknown_reason: Option<String>,
    /// When a person confirmed the repository's state after this operation, if they have.
    ///
    /// The acknowledgement is stored on the record rather than kept in memory because the
    /// *block* is derived from the record: a block that lived only in the process that
    /// reconciled it would be forgotten by the next start, and a write would then be accepted
    /// on top of a change nobody confirmed. Storing it also keeps the promise that an
    /// acknowledgement lifts the block without rewriting what happened — the status stays
    /// `unknown`, and this says only that somebody looked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acknowledged_at_ms: Option<i64>,
}

impl JournalRecord {
    /// The record as a client sees it.
    pub fn to_operation_record(&self) -> OperationRecord {
        OperationRecord {
            operation_id: self.operation_id.clone(),
            client_request_id: self.client_request_id.clone(),
            kind: self.kind,
            target: self.target.clone(),
            status: self.status,
            sequence: self.sequence,
            accepted_at: format_iso8601_millis(self.accepted_at_ms),
            started_at: self.started_at_ms.map(format_iso8601_millis),
            finished_at: self.finished_at_ms.map(format_iso8601_millis),
            result: self.result.clone(),
            problem: self.problem.clone(),
        }
    }

    /// Whether this record keeps its repository blocked for further writes.
    ///
    /// One rule, read in both places that must agree: the process that watched the operation
    /// go uncertain, and the process that starts afterwards and reads the directory. A record
    /// whose outcome nobody could establish blocks until somebody confirms the state; a
    /// confirmation that is already recorded means it does not.
    pub fn blocks_writes(&self) -> bool {
        matches!(
            self.status,
            OperationStatus::Unknown | OperationStatus::NeedsAttention
        ) && self.acknowledged_at_ms.is_none()
    }

    /// Whether the process that wrote this record may still be working on it.
    pub fn is_unfinished(&self) -> bool {
        matches!(
            self.status,
            OperationStatus::Accepted | OperationStatus::Running
        )
    }

    pub fn is_terminal(&self) -> bool {
        !self.is_unfinished()
    }
}

/// The index: which records exist, in which order, and the next sequence to mint.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalIndex {
    next_sequence: u64,
    operations: Vec<IndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    operation_id: String,
    sequence: u64,
}

/// The journal of one host, backed by a private state directory or by memory.
#[derive(Debug)]
pub struct Journal {
    inner: Mutex<JournalState>,
    root: Option<PathBuf>,
}

#[derive(Debug, Default)]
struct JournalState {
    /// Keyed by operation id; the index holds the order.
    records: BTreeMap<String, JournalRecord>,
    order: Vec<String>,
    next_sequence: u64,
}

impl Journal {
    /// Opens a journal, loading whatever the previous process left.
    ///
    /// `None` is a host that named no state directory: the journal works and does not
    /// pretend to be durable. A directory that cannot be created or whose index cannot be
    /// read is refused here, at startup, rather than at the moment an operation needs to be
    /// recorded.
    pub fn open(root: Option<PathBuf>) -> Result<Self, Problem> {
        Self::open_with_security(root, set_private_directory)
    }

    fn open_with_security(
        root: Option<PathBuf>,
        secure: fn(&Path) -> Result<(), Problem>,
    ) -> Result<Self, Problem> {
        let journal = Self {
            inner: Mutex::new(JournalState::default()),
            root,
        };
        journal.load(secure)?;
        Ok(journal)
    }

    /// The state directory this journal writes to, when it has one.
    pub fn state_root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    /// The directory holding one file per operation, when there is one.
    pub fn records_dir(&self) -> Option<PathBuf> {
        self.root.as_ref().map(|root| root.join("journal/records"))
    }

    /// Every file this journal wrote: each record and the index.
    pub fn on_disk_files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        if let Some(index) = self.index_path() {
            if index.is_file() {
                files.push(index);
            }
        }
        if let Some(records) = self.records_dir() {
            if let Ok(entries) = std::fs::read_dir(&records) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if path.is_file() && name.ends_with(".json") {
                        files.push(path);
                    }
                }
            }
        }
        files.sort();
        files
    }

    pub fn index_path(&self) -> Option<PathBuf> {
        self.root
            .as_ref()
            .map(|root| root.join("journal/index.json"))
    }

    /// Writes a new record, durably, before returning.
    pub fn append(&self, record: JournalRecord) -> Result<(), Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        if state.records.contains_key(&record.operation_id) {
            // Appending is how a record *comes into being*; a transition has its own
            // methods that enforce the order. Overwriting here would let a caller skip
            // `running` and still look correct on disk.
            return Err(internal(format!(
                "operation {} already exists in the journal; use mark_started or finish to change it",
                record.operation_id
            )));
        }
        let sequence = state.next_sequence.max(record.sequence);
        let record = JournalRecord { sequence, ..record };
        let next = sequence + 1;
        self.write_record(&record)?;
        state.next_sequence = next;
        state.order.push(record.operation_id.clone());
        state.records.insert(record.operation_id.clone(), record);
        self.write_index(&state)?;
        Ok(())
    }

    /// Records that an operation has started. Only an accepted record may start.
    pub fn mark_started(
        &self,
        operation_id: &str,
        started_at_ms: i64,
    ) -> Result<JournalRecord, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let record = state.records.get(operation_id).cloned().ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.status != OperationStatus::Accepted {
            return Err(internal(format!(
                "operation {operation_id} is {} and cannot start; only an accepted operation starts",
                status_name(record.status)
            )));
        }
        let updated = JournalRecord {
            status: OperationStatus::Running,
            started_at_ms: Some(started_at_ms),
            ..record
        };
        self.write_record(&updated)?;
        state
            .records
            .insert(operation_id.to_string(), updated.clone());
        Ok(updated)
    }

    /// Records that an accepted operation was cancelled before it ran.
    ///
    /// Only an operation that has not started may be cancelled: a running mutation may
    /// already have changed the repository, and relabelling it `cancelled` would hide that.
    pub fn mark_cancelled(
        &self,
        operation_id: &str,
        finished_at_ms: i64,
    ) -> Result<JournalRecord, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let record = state.records.get(operation_id).cloned().ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.status != OperationStatus::Accepted {
            return Err(internal(format!(
                "operation {operation_id} is {} and cannot be cancelled; only an operation that has not started can",
                status_name(record.status)
            )));
        }
        let updated = JournalRecord {
            status: OperationStatus::Cancelled,
            finished_at_ms: Some(finished_at_ms),
            result: None,
            problem: None,
            ..record
        };
        self.write_record(&updated)?;
        state
            .records
            .insert(operation_id.to_string(), updated.clone());
        Ok(updated)
    }

    /// Records the terminal state of an operation that started.
    pub fn finish(
        &self,
        operation_id: &str,
        outcome: EffectOutcome,
        finished_at_ms: i64,
    ) -> Result<JournalRecord, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let record = state.records.get(operation_id).cloned().ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.status != OperationStatus::Running {
            return Err(internal(format!(
                "operation {operation_id} is {} and cannot finish; an operation finishes after it has started",
                status_name(record.status)
            )));
        }
        let updated = terminal_record(record, outcome, finished_at_ms);
        self.write_record(&updated)?;
        state
            .records
            .insert(operation_id.to_string(), updated.clone());
        Ok(updated)
    }

    /// Records a failure of an operation that never started.
    ///
    /// This is not a way around the ordering: the caller could not start the operation at
    /// all (the queue refused it, or the effect was not there), so there is no start to
    /// record and saying `finished` without one is the truth. It is a separate method so
    /// that the ordinary path cannot use it by accident.
    pub fn finish_without_start(
        &self,
        operation_id: &str,
        problem: Problem,
        finished_at_ms: i64,
    ) -> Result<JournalRecord, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let record = state.records.get(operation_id).cloned().ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if record.status != OperationStatus::Accepted {
            return Err(internal(format!(
                "operation {operation_id} is {} and cannot be finished as never-started",
                status_name(record.status)
            )));
        }
        let updated = JournalRecord {
            status: OperationStatus::Failed,
            finished_at_ms: Some(finished_at_ms),
            problem: Some(problem.for_operation(record.operation_id.clone())),
            result: None,
            ..record
        };
        self.write_record(&updated)?;
        state
            .records
            .insert(operation_id.to_string(), updated.clone());
        Ok(updated)
    }

    /// Reconciles every record the previous process left unfinished.
    ///
    /// Each becomes `unknown`, with the reason recorded and the sequence advanced so a
    /// reader can tell the record was rewritten. Nothing is retried: the caller that
    /// knows what to do with the block is [`crate::jobs::recovery`].
    pub fn reconcile_unfinished(
        &self,
        now_ms: i64,
        unknown_message: &str,
        unknown_reason: &str,
    ) -> Result<Vec<JournalRecord>, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let unfinished: Vec<JournalRecord> = state
            .records
            .values()
            .filter(|record| record.is_unfinished())
            .cloned()
            .collect();
        let mut reconciled = Vec::with_capacity(unfinished.len());
        for record in unfinished {
            let sequence = state.next_sequence.max(record.sequence + 1);
            state.next_sequence = sequence + 1;
            let updated = JournalRecord {
                status: OperationStatus::Unknown,
                sequence,
                finished_at_ms: Some(now_ms),
                result: None,
                problem: Some(
                    Problem::new(ProblemCode::UncertainOutcome, unknown_message)
                        .for_operation(record.operation_id.clone()),
                ),
                unknown_reason: Some(unknown_reason.to_string()),
                ..record
            };
            self.write_record(&updated)?;
            state
                .records
                .insert(updated.operation_id.clone(), updated.clone());
            reconciled.push(updated);
        }
        if !reconciled.is_empty() {
            self.write_index(&state)?;
        }
        Ok(reconciled)
    }

    /// Every record whose outcome nobody established and nobody has confirmed.
    ///
    /// This is what a starting process blocks on: reconciliation covers what *this* start
    /// found unfinished, and this covers what an earlier start already turned into `unknown`
    /// and left unresolved. Without it, the second restart would accept writes into a
    /// repository the first restart was still refusing.
    pub fn unacknowledged(&self) -> Vec<JournalRecord> {
        self.inner
            .lock()
            .expect("journal lock")
            .records
            .values()
            .filter(|record| record.blocks_writes())
            .cloned()
            .collect()
    }

    /// Records that a person confirmed the repository's state after an uncertain outcome.
    ///
    /// The status is deliberately left alone: an acknowledgement says somebody looked at the
    /// repository, not that the operation did something else. Only the confirmation and the
    /// sequence change, so a reader can tell the record was rewritten.
    pub fn acknowledge(&self, operation_id: &str, now_ms: i64) -> Result<JournalRecord, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let record = state.records.get(operation_id).cloned().ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown operation {operation_id}"),
            )
        })?;
        if !record.blocks_writes() {
            return Err(internal(format!(
                "operation {operation_id} has no unresolved outcome to acknowledge"
            )));
        }
        let sequence = state.next_sequence.max(record.sequence + 1);
        state.next_sequence = sequence + 1;
        let updated = JournalRecord {
            acknowledged_at_ms: Some(now_ms),
            sequence,
            ..record
        };
        self.write_record(&updated)?;
        state
            .records
            .insert(operation_id.to_string(), updated.clone());
        self.write_index(&state)?;
        Ok(updated)
    }

    pub fn get(&self, operation_id: &str) -> Option<JournalRecord> {
        self.inner
            .lock()
            .expect("journal lock")
            .records
            .get(operation_id)
            .cloned()
    }

    /// Records for one actor, newest first.
    pub fn list_for(&self, actor: &str, limit: usize) -> Vec<JournalRecord> {
        let state = self.inner.lock().expect("journal lock");
        let mut records: Vec<JournalRecord> = state
            .records
            .values()
            .filter(|record| record.actor == actor)
            .cloned()
            .collect();
        records.sort_by_key(|record| std::cmp::Reverse(record.sequence));
        records.truncate(limit);
        records
    }

    /// One actor's record for a client request id, newest first.
    pub fn find_client_request(
        &self,
        actor: &str,
        client_request_id: &str,
    ) -> Option<JournalRecord> {
        let state = self.inner.lock().expect("journal lock");
        state
            .records
            .values()
            .filter(|record| record.actor == actor && record.client_request_id == client_request_id)
            .max_by_key(|record| record.sequence)
            .cloned()
    }

    /// Every record, in creation order.
    pub fn records(&self) -> Vec<JournalRecord> {
        let state = self.inner.lock().expect("journal lock");
        state
            .order
            .iter()
            .filter_map(|id| state.records.get(id))
            .cloned()
            .collect()
    }

    pub fn unfinished(&self) -> Vec<JournalRecord> {
        self.inner
            .lock()
            .expect("journal lock")
            .records
            .values()
            .filter(|record| record.is_unfinished())
            .cloned()
            .collect()
    }

    /* ------------------------------------------------------------ the files */

    fn load(&self, secure: fn(&Path) -> Result<(), Problem>) -> Result<(), Problem> {
        let Some(root) = &self.root else {
            return Ok(());
        };
        let directory = root.join("journal");
        let records = directory.join("records");
        for path in [root, &directory, &records] {
            std::fs::create_dir_all(path).map_err(|error| {
                internal(format!(
                    "the journal directory {} could not be created: {error}",
                    path.display()
                ))
            })?;
            secure(path)?;
        }
        let index_path = directory.join("index.json");
        let index: JournalIndex = match std::fs::read(&index_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                internal(format!(
                    "the journal index {} is not readable as an index: {error}",
                    index_path.display()
                ))
            })?,
            // No index is a journal that has never been written to.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => JournalIndex::default(),
            Err(error) => {
                return Err(internal(format!(
                    "the journal index {} could not be read: {error}",
                    index_path.display()
                )))
            }
        };
        let mut state = self.inner.lock().expect("journal lock");
        for entry in &index.operations {
            if !is_operation_id(&entry.operation_id) {
                // A name this host would not mint cannot be safely turned into a file name.
                return Err(internal(format!(
                    "the journal names an operation this host would not mint: {:?}",
                    entry.operation_id
                )));
            }
            let path = records.join(format!("{}.json", entry.operation_id));
            let bytes = std::fs::read(&path).map_err(|error| {
                internal(format!(
                    "the journal index names {} but its record could not be read: {error}",
                    path.display()
                ))
            })?;
            let record: JournalRecord = serde_json::from_slice(&bytes).map_err(|error| {
                internal(format!(
                    "the journal record {} is not readable: {error}",
                    path.display()
                ))
            })?;
            state.order.push(record.operation_id.clone());
            state.records.insert(record.operation_id.clone(), record);
        }
        state.next_sequence = index.next_sequence.max(
            state
                .records
                .values()
                .map(|r| r.sequence + 1)
                .max()
                .unwrap_or(1),
        );
        Ok(())
    }

    fn write_record(&self, record: &JournalRecord) -> Result<(), Problem> {
        let Some(records) = self.records_dir() else {
            return Ok(());
        };
        if !is_operation_id(&record.operation_id) {
            return Err(internal(format!(
                "an operation id this host did not mint cannot name a journal file: {:?}",
                record.operation_id
            )));
        }
        let bytes = serde_json::to_vec(record).map_err(|error| {
            internal(format!(
                "the journal record could not be serialized: {error}"
            ))
        })?;
        write_atomic(
            &records.join(format!("{}.json", record.operation_id)),
            &bytes,
        )
    }

    fn write_index(&self, state: &JournalState) -> Result<(), Problem> {
        let Some(path) = self.index_path() else {
            return Ok(());
        };
        let index = JournalIndex {
            next_sequence: state.next_sequence,
            operations: state
                .order
                .iter()
                .filter_map(|id| state.records.get(id))
                .map(|record| IndexEntry {
                    operation_id: record.operation_id.clone(),
                    sequence: record.sequence,
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&index).map_err(|error| {
            internal(format!(
                "the journal index could not be serialized: {error}"
            ))
        })?;
        write_atomic(&path, &bytes)
    }
}

/// The terminal record an effect's outcome produces.
fn terminal_record(
    record: JournalRecord,
    outcome: EffectOutcome,
    finished_at_ms: i64,
) -> JournalRecord {
    let operation_id = record.operation_id.clone();
    match outcome {
        EffectOutcome::Succeeded { result } => JournalRecord {
            status: OperationStatus::Succeeded,
            result: Some(result),
            problem: None,
            finished_at_ms: Some(finished_at_ms),
            ..record
        },
        EffectOutcome::Failed { problem } => JournalRecord {
            status: OperationStatus::Failed,
            result: None,
            problem: Some(problem.for_operation(operation_id)),
            finished_at_ms: Some(finished_at_ms),
            ..record
        },
        // A result Git reported but that needs a person: it is *known*, so it is not
        // `unknown`, and it does not block the repository.
        EffectOutcome::NeedsAttention { problem } => JournalRecord {
            status: OperationStatus::NeedsAttention,
            result: None,
            problem: Some(problem.for_operation(operation_id)),
            finished_at_ms: Some(finished_at_ms),
            ..record
        },
        EffectOutcome::Unknown { reason, problem } => JournalRecord {
            status: OperationStatus::Unknown,
            result: None,
            problem: Some(problem.for_operation(operation_id)),
            finished_at_ms: Some(finished_at_ms),
            unknown_reason: Some(reason),
            ..record
        },
    }
}

fn status_name(status: OperationStatus) -> &'static str {
    match status {
        OperationStatus::Accepted => "accepted",
        OperationStatus::Running => "running",
        OperationStatus::Succeeded => "succeeded",
        OperationStatus::Failed => "failed",
        OperationStatus::NeedsAttention => "needsAttention",
        OperationStatus::Unknown => "unknown",
        OperationStatus::Cancelled => "cancelled",
    }
}

/// Whether a string is an operation id this host mints.
///
/// Checked before an id is used as part of a file name: a record read from disk or a
/// caller-supplied id must not be able to name `../../etc/passwd`.
pub fn is_operation_id(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("op_") else {
        return false;
    };
    !rest.is_empty()
        && rest.len() <= 96
        && rest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Writes a file so that a crash leaves either the previous content or the new content.
///
/// The temporary file, its `fsync`, the rename and the directory's own `fsync` are the
/// whole sequence: skipping any of them means a power loss can publish a file whose
/// contents are still in the page cache.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), Problem> {
    let directory = path
        .parent()
        .ok_or_else(|| internal(format!("{} has no parent directory", path.display())))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "record".to_string());
    let temporary = directory.join(format!(".{name}.tmp"));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| {
            internal(format!(
                "the journal file {} could not be written: {error}",
                temporary.display()
            ))
        })?;
    file.write_all(bytes).map_err(|error| {
        internal(format!(
            "the journal file {} could not be written: {error}",
            temporary.display()
        ))
    })?;
    file.sync_all().map_err(|error| {
        internal(format!(
            "the journal file {} could not be flushed: {error}",
            temporary.display()
        ))
    })?;
    drop(file);
    std::fs::rename(&temporary, path).map_err(|error| {
        internal(format!(
            "the journal record {} could not be published: {error}",
            path.display()
        ))
    })?;
    // The rename is durable only once the directory itself is synced. A platform that
    // cannot open a directory for reading is not one this build claims, and the failure is
    // not fatal: the record is still published, only not yet guaranteed to survive a power
    // loss.
    if let Ok(directory) = File::open(directory) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<(), Problem> {
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|error| {
        internal(format!(
            "the journal directory {} could not be made private: {error}",
            path.display()
        ))
    })
}

#[cfg(windows)]
#[path = "windows_acl.rs"]
mod windows_acl;

#[cfg(windows)]
fn set_private_directory(path: &Path) -> Result<(), Problem> {
    windows_acl::secure_private_directory(path)
}

#[cfg(not(any(unix, windows)))]
fn set_private_directory(path: &Path) -> Result<(), Problem> {
    Err(Problem::new(
        ProblemCode::Unavailable,
        format!(
            "cannot enforce private journal permissions on this platform: {}",
            path.display()
        ),
    ))
}

fn internal(message: String) -> Problem {
    Problem::new(ProblemCode::InternalError, message)
}

/// The canonical JSON of a value: object keys sorted, so two identical requests hash
/// identically however a client ordered its fields.
///
/// Key order in JSON is not meaningful, but it *is* observable, and an idempotency check
/// that depended on it would reject a retry of the same request because a client
/// serialised its fields differently.
pub fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => {
            serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
        }
        serde_json::Value::Array(items) => {
            let items: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut entries: Vec<(String, String)> = map
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            let entries: Vec<String> = entries
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{value}",
                        serde_json::to_string(&key).unwrap_or_else(|_| "\"\"".to_string())
                    )
                })
                .collect();
            format!("{{{}}}", entries.join(","))
        }
    }
}

/// SHA-256 of the canonical request, as lowercase hex.
pub fn canonical_payload_digest<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
    let text = canonical_json(&json);
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// What an effect did, in the four answers the journal can hold.
#[derive(Debug, Clone)]
pub enum EffectOutcome {
    Succeeded {
        result: OperationResult,
    },
    Failed {
        problem: Problem,
    },
    NeedsAttention {
        problem: Problem,
    },
    /// The write may have run and its result is not knowable. It is never retried.
    Unknown {
        reason: String,
        problem: Problem,
    },
}

impl EffectOutcome {
    pub fn is_unknown(&self) -> bool {
        matches!(self, Self::Unknown { .. })
    }
}

/// The current instant, so a caller does not have to reach for a clock.
pub fn now_ms() -> i64 {
    now_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, sequence: u64) -> JournalRecord {
        JournalRecord {
            operation_id: id.to_string(),
            client_request_id: format!("crid-{id}"),
            actor: "owner".to_string(),
            kind: MutationKind::Commit,
            target: MutationTarget::Worktree {
                repository_id: "repo_1".to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Accepted,
            sequence,
            accepted_at_ms: 1,
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: "digest".to_string(),
            write_key: "repo_1".to_string(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        }
    }

    #[test]
    fn canonical_json_sorts_keys_so_field_order_is_not_part_of_a_request() {
        let left = serde_json::json!({"b": 1, "a": {"d": 4, "c": [1, 2, {"z": 1, "y": 2}]}});
        let right = serde_json::json!({"a": {"c": [1, 2, {"y": 2, "z": 1}], "d": 4}, "b": 1});
        assert_eq!(canonical_json(&left), canonical_json(&right));
        assert_eq!(
            canonical_payload_digest(&left),
            canonical_payload_digest(&right)
        );
        assert_ne!(
            canonical_payload_digest(&serde_json::json!({"a": 1})),
            canonical_payload_digest(&serde_json::json!({"a": 2}))
        );
    }

    #[test]
    fn an_in_memory_journal_holds_records_without_writing_anything() {
        let journal = Journal::open(None).expect("in-memory");
        journal.append(record("op_1", 1)).expect("append");
        assert_eq!(journal.records().len(), 1);
        assert!(journal.on_disk_files().is_empty());
        // The same id twice is two records for one operation.
        assert_eq!(
            journal
                .append(record("op_1", 2))
                .expect_err("duplicate")
                .code,
            ProblemCode::InternalError
        );
    }

    #[test]
    fn an_operation_id_is_shaped_so_it_can_never_name_a_path_outside_the_directory() {
        assert!(is_operation_id("op_1"));
        assert!(is_operation_id("op_abc-DEF_9"));
        assert!(!is_operation_id("op_"));
        assert!(!is_operation_id("../../etc/passwd"));
        assert!(!is_operation_id("op_../../x"));
        assert!(!is_operation_id("op_1/2"));
    }

    #[test]
    fn a_journal_directory_is_created_before_it_is_written_to() {
        let temp = tempfile::tempdir().expect("temp dir");
        let journal = Journal::open(Some(temp.path().join("nested/state"))).expect("open");
        journal.append(record("op_1", 1)).expect("append");
        assert!(journal
            .records_dir()
            .expect("records dir")
            .join("op_1.json")
            .is_file());
        // And it reads back from the directory rather than from memory.
        let reopened = Journal::open(Some(temp.path().join("nested/state"))).expect("reopen");
        assert_eq!(reopened.records().len(), 1);
    }

    #[test]
    fn an_acknowledgement_is_durable_and_never_rewrites_the_outcome() {
        // Prevents: a confirmation that only the process taking it remembers, so the next
        // start blocks the repository again and the same person is asked a second time — or,
        // worse, a confirmation implemented as "this operation actually succeeded".
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal
            .append(JournalRecord {
                status: OperationStatus::Running,
                started_at_ms: Some(2),
                ..record("op_1", 1)
            })
            .expect("append");
        journal
            .reconcile_unfinished(3, "restarted", "the process restarted while it was working")
            .expect("reconcile");
        assert_eq!(journal.unacknowledged().len(), 1);

        let acknowledged = journal.acknowledge("op_1", 9).expect("acknowledge");
        assert_eq!(acknowledged.status, OperationStatus::Unknown);
        assert_eq!(acknowledged.acknowledged_at_ms, Some(9));
        assert!(!acknowledged.blocks_writes());

        // The next process reads the confirmation from the directory, not from memory.
        let reopened = Journal::open(Some(root)).expect("reopen");
        assert!(
            reopened.unacknowledged().is_empty(),
            "a confirmed repository is not blocked again by the next start"
        );
        let stored = reopened.get("op_1").expect("the record is on disk");
        assert_eq!(
            stored.status,
            OperationStatus::Unknown,
            "an acknowledgement records that somebody looked; it never rewrites what happened"
        );
        assert_eq!(stored.acknowledged_at_ms, Some(9));

        // A second acknowledgement has nothing to confirm, and a settled operation was never
        // uncertain in the first place.
        assert!(reopened.acknowledge("op_1", 10).is_err());
        reopened
            .append(JournalRecord {
                status: OperationStatus::Succeeded,
                finished_at_ms: Some(4),
                ..record("op_2", 4)
            })
            .expect("append");
        assert!(!reopened.get("op_2").expect("stored").blocks_writes());
        assert!(reopened.unacknowledged().is_empty());
    }
}

#[cfg(test)]
mod private_directory_tests {
    use super::*;

    fn fail_apply(_: &Path) -> Result<(), Problem> {
        Err(Problem::new(
            ProblemCode::Unavailable,
            "injected ACL apply failure",
        ))
    }

    fn fail_readback(_: &Path) -> Result<(), Problem> {
        Err(Problem::new(
            ProblemCode::Unavailable,
            "injected ACL readback failure",
        ))
    }

    #[test]
    fn security_failures_stop_before_journal_index_is_read() {
        for (phase, secure) in [
            ("apply", fail_apply as fn(&Path) -> Result<(), Problem>),
            (
                "readback",
                fail_readback as fn(&Path) -> Result<(), Problem>,
            ),
        ] {
            let temp = tempfile::tempdir().expect("isolated state");
            let root = temp.path().join(phase);
            let journal_dir = root.join("journal");
            std::fs::create_dir_all(&journal_dir).expect("journal dir");
            std::fs::write(journal_dir.join("index.json"), b"{invalid index")
                .expect("unreadable index fixture");
            let problem = Journal::open_with_security(Some(root), secure)
                .expect_err("ACL failure must stop journal startup");
            assert_eq!(problem.code, ProblemCode::Unavailable);
            assert!(problem.message.contains(phase));
        }
    }
}
