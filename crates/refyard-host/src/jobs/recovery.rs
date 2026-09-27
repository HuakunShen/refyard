//! Restart recovery: what is known about work that was in flight when the process stopped.
//!
//! A journal record that says `accepted` or `running` when this process starts means the
//! previous process died with work in flight. The design is unambiguous about what happens
//! next:
//!
//! - the record becomes **`unknown`**, with a reason — never `failed` (Git may have changed
//!   things), never `succeeded` (nothing confirmed it), never retried;
//! - the **repository is blocked for writes** until a person resolves it, because
//!   continuing to write on top of an unresolved operation is how a repository ends up in a
//!   state nobody can explain;
//! - reads keep working, so the UI can show what happened.
//!
//! The block is by write key, not global: another repository is unaffected. It is cleared
//! explicitly, by a caller confirming it has looked at a fresh snapshot — and clearing it is
//! recorded by the caller that does it, never silent.

use std::collections::BTreeMap;
use std::sync::Mutex;

use refyard_contract::problem::Problem;

use crate::clock::now_millis;
use crate::jobs::journal::{Journal, JournalRecord};

/// The message a reconciled record carries. The same words the reference uses, because a
/// person reading a diagnostic on either host should read the same sentence.
pub const RESTART_UNKNOWN_MESSAGE: &str = "this service restarted while this operation was in flight; Git may have changed something, so the result is unknown and the operation will not be retried";
/// The short reason stored beside it.
pub const RESTART_UNKNOWN_REASON: &str = "process restarted with the operation in flight";

/// One repository's write block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteBlock {
    /// The key the block is held under: the resource the operation serialises by.
    pub write_key: String,
    pub operation_ids: Vec<String>,
    pub reason: String,
    pub since_ms: i64,
}

/// The blocks this process holds.
///
/// In memory on purpose: a block is about *this* process refusing to write until a person
/// looks, and the uncertainty that created it is already durable in the journal. A restart
/// that re-reads an unknown record re-blocks it, which is why the record is the thing that
/// is persisted and the block is the thing that is derived.
#[derive(Debug, Default)]
pub struct Recovery {
    blocks: Mutex<BTreeMap<String, WriteBlock>>,
}

impl Recovery {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reconciles what a previous process left unfinished, and blocks each repository it
    /// touched — together with every repository a *previous* start already marked uncertain
    /// and nobody has confirmed since.
    ///
    /// Both halves are needed. Reconciliation only sees records that were still
    /// `accepted`/`running` on disk; a record an earlier start turned into `unknown` is
    /// terminal, so without the second half the block would be forgotten by the third start
    /// and a write would be accepted on top of an outcome nobody established. The rule for
    /// "still blocks" is one method on the record, so the process that watched it happen and
    /// the process that reads the directory afterwards cannot disagree.
    pub fn reconcile(&self, journal: &Journal, now_ms: i64) -> Result<Vec<JournalRecord>, Problem> {
        let reconciled = journal.reconcile_unfinished(
            now_ms,
            RESTART_UNKNOWN_MESSAGE,
            RESTART_UNKNOWN_REASON,
        )?;
        for record in &reconciled {
            self.block(record, now_ms);
        }
        for record in journal.unacknowledged() {
            self.block(&record, now_ms);
        }
        Ok(reconciled)
    }

    /// Adds a record to its repository's block.
    ///
    /// Called both by reconciliation and by an effect that reported an unknown outcome
    /// while this process was running: the reason to refuse the next write is the same in
    /// both cases.
    pub fn block(&self, record: &JournalRecord, now_ms: i64) {
        let mut blocks = self.blocks.lock().expect("recovery lock");
        let block = blocks
            .entry(record.write_key.clone())
            .or_insert_with(|| WriteBlock {
                write_key: record.write_key.clone(),
                operation_ids: Vec::new(),
                reason: record
                    .unknown_reason
                    .clone()
                    .unwrap_or_else(|| RESTART_UNKNOWN_REASON.to_string()),
                since_ms: record.finished_at_ms.unwrap_or(now_ms),
            });
        if !block.operation_ids.contains(&record.operation_id) {
            block.operation_ids.push(record.operation_id.clone());
        }
    }

    /// The block held for one key, when there is one.
    pub fn block_for(&self, write_key: &str) -> Option<WriteBlock> {
        self.blocks
            .lock()
            .expect("recovery lock")
            .get(write_key)
            .cloned()
    }

    /// Clears a block after a person resolved it. Returns false when there was none.
    pub fn resolve_block(&self, write_key: &str) -> bool {
        self.blocks
            .lock()
            .expect("recovery lock")
            .remove(write_key)
            .is_some()
    }

    pub fn resolve_operation(&self, operation_id: &str) -> bool {
        let mut blocks = self.blocks.lock().expect("recovery lock");
        let key = blocks.iter().find_map(|(key, block)| {
            block
                .operation_ids
                .iter()
                .any(|id| id == operation_id)
                .then(|| key.clone())
        });
        key.and_then(|key| blocks.remove(&key)).is_some()
    }

    pub fn blocks(&self) -> Vec<WriteBlock> {
        self.blocks
            .lock()
            .expect("recovery lock")
            .values()
            .cloned()
            .collect()
    }

    pub fn blocked_keys(&self) -> Vec<String> {
        self.blocks
            .lock()
            .expect("recovery lock")
            .keys()
            .cloned()
            .collect()
    }

    /// Whether any repository is blocked, for a capability answer or a diagnostic.
    pub fn is_blocked(&self) -> bool {
        !self.blocks.lock().expect("recovery lock").is_empty()
    }
}

/// The instant recovery ran, so a caller does not have to reach for a clock.
pub fn now_ms() -> i64 {
    now_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::{MutationKind, MutationTarget, OperationStatus};

    fn record(id: &str, write_key: &str, status: OperationStatus) -> JournalRecord {
        JournalRecord {
            operation_id: id.to_string(),
            client_request_id: format!("crid-{id}"),
            actor: "owner".to_string(),
            kind: MutationKind::StagePaths,
            target: MutationTarget::Worktree {
                repository_id: write_key.to_string(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status,
            sequence: 1,
            accepted_at_ms: 1_000,
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: "digest".to_string(),
            write_key: write_key.to_string(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        }
    }

    #[test]
    fn only_unfinished_records_are_reconciled_and_they_block_their_own_repository() {
        let journal = Journal::open(None).expect("in-memory");
        journal
            .append(record("op_1", "repo/one", OperationStatus::Running))
            .expect("append");
        journal
            .append(record("op_2", "repo/two", OperationStatus::Accepted))
            .expect("append");
        let finished = record("op_3", "repo/two", OperationStatus::Succeeded);
        journal
            .append(JournalRecord {
                finished_at_ms: Some(2_000),
                ..finished
            })
            .expect("append");

        let recovery = Recovery::new();
        let reconciled = recovery.reconcile(&journal, 5_000).expect("reconciled");
        assert_eq!(reconciled.len(), 2);
        assert!(!recovery
            .block_for("repo/one")
            .expect("blocked")
            .operation_ids
            .is_empty());
        assert_eq!(
            recovery
                .block_for("repo/two")
                .expect("blocked")
                .operation_ids,
            vec!["op_2".to_string()],
            "a repository with one finished and one unfinished operation is blocked by the \
             unfinished one"
        );
        assert_eq!(
            journal.get("op_1").expect("record").status,
            OperationStatus::Unknown
        );
        assert_eq!(
            journal.get("op_3").expect("record").status,
            OperationStatus::Succeeded,
            "a terminal record is never rewritten"
        );

        assert!(recovery.resolve_block("repo/one"));
        assert!(!recovery.resolve_block("repo/one"), "already lifted");
        assert_eq!(recovery.blocked_keys(), vec!["repo/two".to_string()]);
        assert!(recovery.is_blocked());
    }

    #[test]
    fn a_second_reconciliation_does_not_double_block() {
        let journal = Journal::open(None).expect("in-memory");
        journal
            .append(record("op_1", "repo/one", OperationStatus::Running))
            .expect("append");
        let recovery = Recovery::new();
        assert_eq!(recovery.reconcile(&journal, 1).expect("first").len(), 1);
        assert!(recovery.reconcile(&journal, 2).expect("second").is_empty());
        assert_eq!(
            recovery
                .block_for("repo/one")
                .expect("blocked")
                .operation_ids,
            vec!["op_1".to_string()],
            "one operation is one entry in the block"
        );
    }

    #[test]
    fn a_record_an_earlier_start_made_unknown_still_blocks_the_next_one() {
        // Prevents: the third start accepting a write into a repository whose outcome nobody
        // established, because only the start that *converted* the record remembered the
        // block. The record is the durable fact; the block is what each start derives from it.
        let journal = Journal::open(None).expect("in-memory");
        journal
            .append(record("op_1", "repo/one", OperationStatus::Running))
            .expect("append");

        // The start that finds it in flight: it reconciles the record and blocks the key.
        let first = Recovery::new();
        assert_eq!(first.reconcile(&journal, 1).expect("first").len(), 1);
        assert!(first.block_for("repo/one").is_some());
        assert_eq!(
            journal.get("op_1").expect("record").status,
            OperationStatus::Unknown
        );

        // The start after that: nothing is unfinished any more, and the repository is *still*
        // blocked.
        let second = Recovery::new();
        assert!(second.reconcile(&journal, 2).expect("second").is_empty());
        assert_eq!(
            second.blocked_keys(),
            vec!["repo/one".to_string()],
            "an unresolved outcome keeps blocking until somebody confirms the state"
        );

        // A confirmation is what changes that — and it is durable, so the next start agrees.
        journal.acknowledge("op_1", 3).expect("acknowledge");
        let third = Recovery::new();
        third.reconcile(&journal, 4).expect("third");
        assert!(third.blocked_keys().is_empty());
    }
}
