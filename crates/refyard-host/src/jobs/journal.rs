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

use std::collections::{BTreeMap, HashMap};
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

const JOURNAL_MAX_BYTES: usize = 16 * 1024 * 1024;
const TERMINAL_RETENTION_MS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Copy)]
struct JournalRetentionPolicy {
    max_bytes: usize,
    terminal_ttl_ms: i64,
}

const DEFAULT_RETENTION: JournalRetentionPolicy = JournalRetentionPolicy {
    max_bytes: JOURNAL_MAX_BYTES,
    terminal_ttl_ms: TERMINAL_RETENTION_MS,
};

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
    /// Monotonic operation-id suffix high-water mark; unlike records this is never pruned.
    #[serde(default)]
    operation_id_high_water: u64,
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
    /// Holds exclusive ownership of the state root for this Journal's full lifetime.
    _state_root_lock: Option<File>,
}

impl Drop for Journal {
    fn drop(&mut self) {
        if let Some(lock) = self._state_root_lock.take() {
            // Release before closing the descriptor so an immediate restart can
            // acquire the same state root on every supported filesystem.
            let _ = lock.unlock();
        }
    }
}

#[derive(Debug, Default, Clone)]
struct JournalState {
    /// Keyed by operation id; the index holds the order.
    records: BTreeMap<String, JournalRecord>,
    order: Vec<String>,
    next_sequence: u64,
    operation_id_high_water: u64,
    /// Rebuilt from validated durable records and updated in the same lock as admission.
    client_requests: HashMap<(String, String), String>,
}

/// The result of atomically checking an actor/request key and, if absent, accepting it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ClientRequestAdmission {
    Appended(JournalRecord),
    Existing(JournalRecord),
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
        let mut journal = Self {
            inner: Mutex::new(JournalState::default()),
            root,
            _state_root_lock: None,
        };
        journal.load(secure)?;
        Ok(journal)
    }

    /// The state directory this journal writes to, when it has one.
    pub fn state_root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    /// Highest operation-id suffix ever durably admitted, including records later pruned.
    pub fn operation_id_high_water(&self) -> u64 {
        self.inner
            .lock()
            .expect("journal lock")
            .operation_id_high_water
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
        match self.admit(record, now_millis())? {
            ClientRequestAdmission::Appended(_) => Ok(()),
            ClientRequestAdmission::Existing(existing) => Err(internal(format!(
                "client request {} for actor {} already exists as operation {}; use the existing record",
                existing.client_request_id, existing.actor, existing.operation_id
            ))),
        }
    }

    /// Atomically checks an actor/request key and durably accepts a new record.
    ///
    /// The request-id lookup and operation append share one lock. A concurrent retry can
    /// therefore observe either the old record or the new accepted record, never slip
    /// between a separate lookup and append.
    pub(crate) fn admit(
        &self,
        record: JournalRecord,
        now_ms: i64,
    ) -> Result<ClientRequestAdmission, Problem> {
        self.admit_with_policy(record, now_ms, DEFAULT_RETENTION)
    }

    fn admit_with_policy(
        &self,
        record: JournalRecord,
        now_ms: i64,
        policy: JournalRetentionPolicy,
    ) -> Result<ClientRequestAdmission, Problem> {
        let mut state = self.inner.lock().expect("journal lock");
        let request_key = (record.actor.clone(), record.client_request_id.clone());
        if let Some(operation_id) = state.client_requests.get(&request_key) {
            let existing = state.records.get(operation_id).cloned().ok_or_else(|| {
                internal("the client-request index points to a missing operation".to_string())
            })?;
            return Ok(ClientRequestAdmission::Existing(existing));
        }
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
        let mut next_state = state.clone();
        next_state.next_sequence = sequence + 1;
        next_state.operation_id_high_water = next_state
            .operation_id_high_water
            .max(operation_id_number(&record.operation_id).unwrap_or(0));
        next_state.order.push(record.operation_id.clone());
        next_state
            .client_requests
            .insert(request_key, record.operation_id.clone());
        next_state
            .records
            .insert(record.operation_id.clone(), record.clone());

        let mut pruned_records = Vec::new();
        if journal_bytes(&next_state)? > policy.max_bytes {
            let (compacted, pruned) = prune_expired(&next_state, now_ms, policy.terminal_ttl_ms);
            next_state = compacted;
            pruned_records = pruned;
            if pruned_records.is_empty() || journal_bytes(&next_state)? > policy.max_bytes {
                return Err(Problem::new(
                    ProblemCode::ResourceBusy,
                    "the operation journal is full; no expired terminal records could make enough room, so no new operation was accepted",
                ));
            }
        }

        self.write_record(&record)?;
        // The index is the journal's commit point. Do not publish the in-memory record or
        // request key until the durable index names the new record.
        self.write_index(&next_state)?;
        *state = next_state;
        // The index rename above is the durable commit point. If an old record file cannot
        // be removed, it is now an unindexed orphan and is never exposed as a journal record.
        self.remove_pruned_record_files(&pruned_records);
        Ok(ClientRequestAdmission::Appended(record))
    }

    fn remove_pruned_record_files(&self, records: &[JournalRecord]) {
        let Some(directory) = self.records_dir() else {
            return;
        };
        for record in records {
            let _ = std::fs::remove_file(directory.join(format!("{}.json", record.operation_id)));
        }
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
        let operation_id = state
            .client_requests
            .get(&(actor.to_string(), client_request_id.to_string()))?;
        state.records.get(operation_id).cloned()
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

    fn load(&mut self, secure: fn(&Path) -> Result<(), Problem>) -> Result<(), Problem> {
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
        self._state_root_lock = Some(acquire_state_root_lock(root)?);
        let index_path = directory.join("index.json");
        let index: JournalIndex = match std::fs::read(&index_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                internal(format!(
                    "the journal index {} is not readable as an index: {error}",
                    index_path.display()
                ))
            })?,
            // No index and no published records is a new journal. Once a record file has
            // been published, absence of the index is ambiguous and must fail closed.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if journal_record_files_exist(&records)? {
                    return Err(internal(format!(
                        "the journal index {} is missing while operation records remain; refusing to guess which requests were accepted",
                        index_path.display()
                    )));
                }
                JournalIndex::default()
            }
            Err(error) => {
                return Err(internal(format!(
                    "the journal index {} could not be read: {error}",
                    index_path.display()
                )))
            }
        };
        let mut state = self.inner.lock().expect("journal lock");
        let mut seen_operations = std::collections::HashSet::new();
        let mut repair_index = false;
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
            if record.operation_id != entry.operation_id {
                return Err(internal(format!(
                    "the journal index entry for {} names a different operation record",
                    entry.operation_id
                )));
            }
            if entry.sequence > record.sequence {
                return Err(internal(format!(
                    "the journal index sequence for {} is newer than its durable record",
                    entry.operation_id
                )));
            }
            if entry.sequence < record.sequence {
                // State transitions publish the record before the index. A crash in that
                // interval leaves a newer, durable record with an older index sequence.
                repair_index = true;
            }
            if !seen_operations.insert(record.operation_id.clone()) {
                return Err(internal(format!(
                    "the journal index lists operation {} more than once",
                    record.operation_id
                )));
            }
            let request_key = (record.actor.clone(), record.client_request_id.clone());
            if let Some(previous) = state
                .client_requests
                .insert(request_key, record.operation_id.clone())
            {
                return Err(internal(format!(
                    "the journal contains client request ids shared by operations {previous} and {} for one actor",
                    record.operation_id
                )));
            }
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
        state.operation_id_high_water = index.operation_id_high_water.max(
            state
                .records
                .keys()
                .filter_map(|operation_id| operation_id_number(operation_id))
                .max()
                .unwrap_or(0),
        );
        if index.operation_id_high_water < state.operation_id_high_water {
            repair_index = true;
        }
        self.remove_expired_unindexed_record_files(&state, now_millis())?;
        if repair_index {
            self.write_index(&state)?;
        }
        Ok(())
    }

    fn remove_expired_unindexed_record_files(
        &self,
        state: &JournalState,
        now_ms: i64,
    ) -> Result<(), Problem> {
        let Some(directory) = self.records_dir() else {
            return Ok(());
        };
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            internal(format!(
                "the journal record directory {} could not be scanned: {error}",
                directory.display()
            ))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                internal(format!(
                    "the journal record directory could not be read: {error}"
                ))
            })?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(operation_id) = name.strip_suffix(".json") else {
                continue;
            };
            if !is_operation_id(operation_id) {
                return Err(internal(format!(
                    "the journal contains a record file with an invalid operation id: {name}"
                )));
            }
            if state.records.contains_key(operation_id) {
                continue;
            }
            let bytes = std::fs::read(entry.path()).map_err(|error| {
                internal(format!(
                    "the unindexed journal record {} could not be read: {error}",
                    entry.path().display()
                ))
            })?;
            let record: JournalRecord = serde_json::from_slice(&bytes).map_err(|error| {
                internal(format!(
                    "the unindexed journal record {} is not readable: {error}",
                    entry.path().display()
                ))
            })?;
            let expired_terminal = record.is_terminal()
                && !record.blocks_writes()
                && now_ms.saturating_sub(record.finished_at_ms.unwrap_or(record.accepted_at_ms))
                    >= TERMINAL_RETENTION_MS;
            if record.operation_id != operation_id || !expired_terminal {
                return Err(internal(format!(
                    "the journal contains an unindexed record that cannot be safely discarded: {}",
                    entry.path().display()
                )));
            }
            std::fs::remove_file(entry.path()).map_err(|error| {
                internal(format!(
                    "an expired unindexed journal record {} could not be removed: {error}",
                    entry.path().display()
                ))
            })?;
        }
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
        let index = journal_index(state);
        let bytes = serde_json::to_vec(&index).map_err(|error| {
            internal(format!(
                "the journal index could not be serialized: {error}"
            ))
        })?;
        write_atomic(&path, &bytes)
    }
}

fn journal_index(state: &JournalState) -> JournalIndex {
    JournalIndex {
        next_sequence: state.next_sequence,
        operation_id_high_water: state.operation_id_high_water,
        operations: state
            .order
            .iter()
            .filter_map(|id| state.records.get(id))
            .map(|record| IndexEntry {
                operation_id: record.operation_id.clone(),
                sequence: record.sequence,
            })
            .collect(),
    }
}

fn journal_record_files_exist(directory: &Path) -> Result<bool, Problem> {
    let entries = std::fs::read_dir(directory).map_err(|error| {
        internal(format!(
            "the journal record directory {} could not be scanned: {error}",
            directory.display()
        ))
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            internal(format!(
                "the journal record directory could not be read: {error}"
            ))
        })?;
        if entry.file_name().to_string_lossy().ends_with(".json") {
            return Ok(true);
        }
    }
    Ok(false)
}

fn operation_id_number(operation_id: &str) -> Option<u64> {
    operation_id
        .strip_prefix("op_")
        .and_then(|suffix| u64::from_str_radix(suffix, 36).ok())
}

/// The Rust host stores one latest-state JSON record per operation plus the operation index.
/// Both are counted so its private state remains bounded despite using a different layout
/// from the TypeScript JSONL journal.
fn journal_bytes(state: &JournalState) -> Result<usize, Problem> {
    let mut total = 0usize;
    for record in state.records.values() {
        let bytes = serde_json::to_vec(record).map_err(|error| {
            internal(format!(
                "a journal record could not be serialized for size accounting: {error}"
            ))
        })?;
        total = total.saturating_add(bytes.len());
    }
    let index = serde_json::to_vec(&journal_index(state)).map_err(|error| {
        internal(format!(
            "the journal index could not be serialized for size accounting: {error}"
        ))
    })?;
    Ok(total.saturating_add(index.len()))
}

fn prune_expired(
    state: &JournalState,
    now_ms: i64,
    terminal_ttl_ms: i64,
) -> (JournalState, Vec<JournalRecord>) {
    let pruned: Vec<JournalRecord> = state
        .records
        .values()
        .filter(|record| {
            record.is_terminal()
                && !record.blocks_writes()
                && now_ms.saturating_sub(record.finished_at_ms.unwrap_or(record.accepted_at_ms))
                    >= terminal_ttl_ms
        })
        .cloned()
        .collect();
    if pruned.is_empty() {
        return (state.clone(), pruned);
    }

    let mut retained = state.clone();
    for record in &pruned {
        retained.records.remove(&record.operation_id);
        retained
            .client_requests
            .remove(&(record.actor.clone(), record.client_request_id.clone()));
    }
    retained
        .order
        .retain(|operation_id| retained.records.contains_key(operation_id));
    (retained, pruned)
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

/// Acquires exclusive ownership before either the journal or the workspace-root ledger
/// reads or writes state. The file stays open in `Journal`, so another process cannot
/// recover the journal or mint root identities concurrently.
fn acquire_state_root_lock(root: &Path) -> Result<File, Problem> {
    let path = root.join(".refyard-state.lock");
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
            return Err(Problem::new(
                ProblemCode::Unavailable,
                "the embedded state-root lock is not a regular file",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(Problem::new(
                ProblemCode::Unavailable,
                format!("cannot inspect embedded state-root lock: {error}"),
            ));
        }
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|error| {
        Problem::new(
            ProblemCode::Unavailable,
            format!("cannot open embedded state-root lock: {error}"),
        )
    })?;
    let metadata = file.metadata().map_err(|error| {
        Problem::new(
            ProblemCode::Unavailable,
            format!("cannot inspect embedded state-root lock: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(Problem::new(
            ProblemCode::Unavailable,
            "the embedded state-root lock is not a regular file",
        ));
    }
    #[cfg(unix)]
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
        Problem::new(
            ProblemCode::Unavailable,
            format!("cannot secure embedded state-root lock: {error}"),
        )
    })?;
    file.try_lock().map_err(|error| {
        Problem::new(
            ProblemCode::Unavailable,
            format!("embedded state root is already owned by another Refyard host: {error}"),
        )
    })?;
    Ok(file)
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
        drop(journal);
        let reopened = Journal::open(Some(temp.path().join("nested/state"))).expect("reopen");
        assert_eq!(reopened.records().len(), 1);
    }

    #[test]
    fn reopen_repairs_a_record_written_before_its_index_sequence() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal.append(record("op_1", 1)).expect("append");
        drop(journal);

        // Simulate the durable record rename succeeding while the process dies before the
        // matching index rename.
        let record_path = root.join("journal/records/op_1.json");
        let mut durable: JournalRecord =
            serde_json::from_slice(&std::fs::read(&record_path).expect("read record"))
                .expect("parse record");
        durable.sequence = 7;
        durable.status = OperationStatus::Unknown;
        durable.finished_at_ms = Some(7);
        std::fs::write(
            &record_path,
            serde_json::to_vec(&durable).expect("serialize updated record"),
        )
        .expect("write newer record");

        let reopened = Journal::open(Some(root.clone())).expect("repair record-first crash");
        assert_eq!(reopened.get("op_1").expect("record").sequence, 7);
        let index: JournalIndex = serde_json::from_slice(
            &std::fs::read(root.join("journal/index.json")).expect("read repaired index"),
        )
        .expect("parse repaired index");
        assert_eq!(index.operations[0].sequence, 7);
        assert!(index.next_sequence > 7);
    }

    #[test]
    fn missing_index_with_published_records_fails_closed_without_deleting_them() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal.append(record("op_1", 1)).expect("append");
        drop(journal);
        let record_path = root.join("journal/records/op_1.json");
        std::fs::remove_file(root.join("journal/index.json")).expect("remove index fixture");

        let error = Journal::open(Some(root)).expect_err("missing authority must fail closed");
        assert_eq!(error.code, ProblemCode::InternalError);
        assert!(
            record_path.is_file(),
            "recovery evidence must remain untouched"
        );
    }

    #[test]
    fn an_index_ahead_of_its_durable_record_fails_closed() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal.append(record("op_1", 1)).expect("append");
        drop(journal);

        let index_path = root.join("journal/index.json");
        let mut index: JournalIndex =
            serde_json::from_slice(&std::fs::read(&index_path).expect("read index"))
                .expect("parse index");
        index.operations[0].sequence += 1;
        std::fs::write(
            &index_path,
            serde_json::to_vec(&index).expect("serialize index"),
        )
        .expect("write ahead index");

        let error = Journal::open(Some(root)).expect_err("an index cannot lead its record");
        assert_eq!(error.code, ProblemCode::InternalError);
        assert!(error.message.contains("newer than its durable record"));
    }

    #[test]
    fn an_unindexed_nonexpired_record_is_not_silently_discarded() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal
            .append(record("op_1", 1))
            .expect("append indexed record");
        drop(journal);

        let orphan = record("op_2", 2);
        std::fs::write(
            root.join("journal/records/op_2.json"),
            serde_json::to_vec(&orphan).expect("serialize orphan"),
        )
        .expect("write unindexed record");

        let error = Journal::open(Some(root)).expect_err("live ambiguity must fail closed");
        assert_eq!(error.code, ProblemCode::InternalError);
        assert!(error.message.contains("cannot be safely discarded"));
    }

    #[test]
    fn operation_id_high_water_survives_terminal_pruning_and_restart() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal
            .append(JournalRecord {
                operation_id: "op_z".to_string(),
                client_request_id: "old-key".to_string(),
                status: OperationStatus::Unknown,
                finished_at_ms: Some(10),
                acknowledged_at_ms: Some(20),
                ..record("op_z", 1)
            })
            .expect("highest id");

        let incoming = record("op_1", 0);
        let mut projected = JournalState {
            next_sequence: 3,
            operation_id_high_water: 35,
            ..JournalState::default()
        };
        projected.order.push("op_1".to_string());
        projected
            .records
            .insert("op_1".to_string(), incoming.clone());
        projected.client_requests.insert(
            (incoming.actor.clone(), incoming.client_request_id.clone()),
            incoming.operation_id.clone(),
        );
        let policy = JournalRetentionPolicy {
            max_bytes: journal_bytes(&projected).expect("size"),
            terminal_ttl_ms: 50,
        };
        journal
            .admit_with_policy(incoming, 100, policy)
            .expect("prune old terminal and admit newer request");
        assert!(journal.get("op_z").is_none());
        drop(journal);

        let reopened = Journal::open(Some(root)).expect("reopen");
        assert_eq!(reopened.operation_id_high_water(), 35);
        assert_eq!(reopened.records().len(), 1);
        assert_eq!(reopened.records()[0].operation_id, "op_1");
    }

    #[test]
    fn request_lookup_is_actor_scoped_and_rebuilt_from_durable_records() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let journal = Journal::open(Some(root.clone())).expect("open");
        journal
            .append(JournalRecord {
                client_request_id: "shared-request".to_string(),
                ..record("op_1", 1)
            })
            .expect("owner record");
        journal
            .append(JournalRecord {
                operation_id: "op_2".to_string(),
                actor: "other".to_string(),
                client_request_id: "shared-request".to_string(),
                sequence: 2,
                ..record("op_2", 2)
            })
            .expect("other actor can use the same id");
        drop(journal);

        let reopened = Journal::open(Some(root)).expect("reopen");
        assert_eq!(
            reopened
                .find_client_request("owner", "shared-request")
                .expect("owner lookup")
                .operation_id,
            "op_1"
        );
        assert_eq!(
            reopened
                .find_client_request("other", "shared-request")
                .expect("other lookup")
                .operation_id,
            "op_2"
        );
        assert!(reopened
            .find_client_request("stranger", "shared-request")
            .is_none());
        assert!(reopened.find_client_request("owner", "missing").is_none());
    }

    #[test]
    fn expired_terminal_records_are_pruned_only_when_admission_needs_room() {
        let journal = Journal::open(None).expect("in-memory journal");
        journal
            .append(JournalRecord {
                status: OperationStatus::Unknown,
                finished_at_ms: Some(10),
                acknowledged_at_ms: Some(20),
                ..record("op_1", 1)
            })
            .expect("old terminal");

        let incoming = record("op_2", 0);
        let mut projected = JournalState {
            next_sequence: 3,
            ..JournalState::default()
        };
        projected.order.push("op_2".to_string());
        projected
            .records
            .insert("op_2".to_string(), incoming.clone());
        projected.client_requests.insert(
            (incoming.actor.clone(), incoming.client_request_id.clone()),
            incoming.operation_id.clone(),
        );
        let policy = JournalRetentionPolicy {
            max_bytes: journal_bytes(&projected).expect("size"),
            terminal_ttl_ms: 50,
        };

        let admitted = journal
            .admit_with_policy(incoming, 100, policy)
            .expect("prune and admit");
        assert!(matches!(admitted, ClientRequestAdmission::Appended(_)));
        assert!(journal.find_client_request("owner", "crid-op_1").is_none());
        assert!(journal.find_client_request("owner", "crid-op_2").is_some());
    }

    #[test]
    fn admission_refuses_when_live_or_unexpired_records_prevent_compaction() {
        for existing in [
            JournalRecord {
                status: OperationStatus::Running,
                started_at_ms: Some(20),
                ..record("op_1", 1)
            },
            JournalRecord {
                status: OperationStatus::Succeeded,
                finished_at_ms: Some(95),
                ..record("op_1", 1)
            },
            JournalRecord {
                status: OperationStatus::Unknown,
                finished_at_ms: Some(10),
                ..record("op_1", 1)
            },
            JournalRecord {
                status: OperationStatus::NeedsAttention,
                finished_at_ms: Some(10),
                ..record("op_1", 1)
            },
        ] {
            let journal = Journal::open(None).expect("in-memory journal");
            journal.append(existing.clone()).expect("existing record");
            let incoming = record("op_2", 0);
            let mut projected = JournalState {
                next_sequence: 3,
                ..JournalState::default()
            };
            projected.order.push("op_2".to_string());
            projected
                .records
                .insert("op_2".to_string(), incoming.clone());
            projected.client_requests.insert(
                (incoming.actor.clone(), incoming.client_request_id.clone()),
                incoming.operation_id.clone(),
            );
            let policy = JournalRetentionPolicy {
                max_bytes: journal_bytes(&projected).expect("size"),
                terminal_ttl_ms: 50,
            };

            let error = journal
                .admit_with_policy(incoming, 100, policy)
                .expect_err("the existing record is not eligible for pruning");
            assert_eq!(error.code, ProblemCode::ResourceBusy);
            assert!(journal.get(&existing.operation_id).is_some());
            assert!(journal.get("op_2").is_none());
        }
    }

    #[test]
    fn opening_a_journal_with_ambiguous_actor_request_ids_fails_closed() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("state");
        let records = root.join("journal/records");
        std::fs::create_dir_all(&records).expect("records dir");
        let first = JournalRecord {
            client_request_id: "duplicate".to_string(),
            ..record("op_1", 1)
        };
        let second = JournalRecord {
            operation_id: "op_2".to_string(),
            sequence: 2,
            client_request_id: "duplicate".to_string(),
            ..record("op_2", 2)
        };
        for record in [&first, &second] {
            std::fs::write(
                records.join(format!("{}.json", record.operation_id)),
                serde_json::to_vec(record).expect("serialize record"),
            )
            .expect("write record");
        }
        let index = JournalIndex {
            next_sequence: 3,
            operation_id_high_water: 2,
            operations: vec![
                IndexEntry {
                    operation_id: first.operation_id.clone(),
                    sequence: first.sequence,
                },
                IndexEntry {
                    operation_id: second.operation_id.clone(),
                    sequence: second.sequence,
                },
            ],
        };
        std::fs::write(
            root.join("journal/index.json"),
            serde_json::to_vec(&index).expect("serialize index"),
        )
        .expect("write index");

        let error = Journal::open(Some(root)).expect_err("ambiguous lookup must fail closed");
        assert_eq!(error.code, ProblemCode::InternalError);
        assert!(error.message.contains("client request ids"));
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
        drop(journal);
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
