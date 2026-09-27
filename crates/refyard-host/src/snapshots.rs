//! Snapshots: what a read saw, so a later write can prove nothing moved.
//!
//! A snapshot is not a cache. It is the record a mutation is planned against: the
//! object names history was read from, HEAD, and a fingerprint of the index. A write
//! that carries an `expectedSnapshotId` is refused when the repository no longer
//! matches that record, which is what stops a UI from staging a file that changed
//! between the preview and the click.
//!
//! The fingerprint is a *string of facts*, not a hash: when a write is refused, the
//! interesting question is which row differs, and a hash cannot answer it.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use refyard_contract::history::Topology;

use crate::paths::base36;

/// What a snapshot was taken for. A cursor minted for one kind must not be honoured
/// for another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotKind {
    Status,
    History,
    Refs,
    Diff,
    Worktrees,
    Submodules,
    Stashes,
    Previews,
}

impl SnapshotKind {
    pub fn as_wire(self) -> &'static str {
        match self {
            SnapshotKind::Status => "status",
            SnapshotKind::History => "history",
            SnapshotKind::Refs => "refs",
            SnapshotKind::Diff => "diff",
            SnapshotKind::Worktrees => "worktrees",
            SnapshotKind::Submodules => "submodules",
            SnapshotKind::Stashes => "stashes",
            SnapshotKind::Previews => "previews",
        }
    }
}

/// The walk semantics a history page was started with.
///
/// A cursor continues the page it was minted for, so these values are owned by the
/// snapshot: a client that asks for a different page size or first-parent mode on a
/// continuation would otherwise silently receive a different walk than the one it is
/// paging through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryIntent {
    pub first_parent_only: bool,
    pub topology: Topology,
}

/// One recorded read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotRecord {
    pub snapshot_id: String,
    pub kind: SnapshotKind,
    pub repository_id: String,
    pub worktree_id: Option<String>,
    /// The build of the execution target this read ran against. A target that was rebuilt
    /// (its configuration re-read, a connection replaced) invalidates every snapshot,
    /// cursor and path id minted under the previous generation.
    pub target_generation: String,
    pub created_at_ms: u64,
    /// The object names a history page was walked from. Continuing a walk from a
    /// moved tip would mix two histories into one page.
    pub tips: Vec<String>,
    pub head_oid: Option<String>,
    /// A complete-ref fingerprint, independent of the bounded walk.
    pub observed_refs_fingerprint: Option<String>,
    /// The index fingerprint a write must still match.
    pub index_key: Option<String>,
    /// Present on history snapshots, absent on every other kind.
    pub history_intent: Option<HistoryIntent>,
}

/// One row of the index fingerprint.
///
/// The path key is the hex of the raw bytes, so a path containing a NUL cannot be
/// confused with the fingerprint's own separators, and a rename keeps both names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexFingerprintEntry {
    pub path_key: String,
    pub original_path_key: Option<String>,
    /// The index mode, or the worktree mode, or `-`.
    pub mode: String,
    /// The index object name, or `-`.
    pub oid: String,
    /// How many stage entries the path has (0 for a resolved path).
    pub stage: usize,
}

/// The index fingerprint exactly as the reference implementation computes it.
///
/// Rows are sorted, so the same index gives the same string regardless of the order
/// Git listed the entries in. An unborn HEAD is spelled `(unborn)` rather than being
/// left out: an initial commit must still be refused when the index moved underneath
/// it.
pub fn index_fingerprint(head_oid: Option<&str>, entries: &[IndexFingerprintEntry]) -> String {
    let mut rows: Vec<String> = entries
        .iter()
        .map(|entry| {
            format!(
                "{}:{}\u{0}{}\u{0}{}\u{0}{}",
                entry.path_key,
                entry.original_path_key.clone().unwrap_or_default(),
                entry.mode,
                entry.oid,
                entry.stage
            )
        })
        .collect();
    rows.sort();
    format!("{}\n{}", head_oid.unwrap_or("(unborn)"), rows.join("\n"))
}

/// What a read wants recorded. Grouped rather than passed positionally, because six
/// of these are `Option`s that mean different things and a swapped pair would compile.
pub struct SnapshotRequest<'a> {
    pub kind: SnapshotKind,
    pub repository_id: &'a str,
    pub worktree_id: Option<&'a str>,
    /// The build of the target this read runs against, recorded so a later continuation
    /// cannot be honoured for a different one.
    pub target_generation: &'a str,
    /// The object names a paged read was walked from.
    pub tips: Vec<String>,
    pub head_oid: Option<String>,
    pub observed_refs_fingerprint: Option<String>,
    pub index_key: Option<String>,
    pub history_intent: Option<HistoryIntent>,
}

/// The result of resolving a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorResult {
    Resolved {
        snapshot_id: String,
        skip: usize,
        limit: usize,
        kind: SnapshotKind,
    },
    /// The cursor is not the shape this service mints.
    Malformed,
    /// A well-formed cursor this service never issued.
    Unknown,
    /// The snapshot it named has been evicted or aged out.
    Expired,
}

#[derive(Debug, Clone)]
struct CursorRecord {
    snapshot_id: String,
    skip: usize,
    limit: usize,
    kind: SnapshotKind,
    repository_id: String,
    worktree_id: Option<String>,
}

/// Bounded, in-memory snapshots and cursors.
///
/// In memory is deliberate for this slice: a snapshot describes process-local state
/// (the tips this process read), and persisting it would invite a later process to
/// trust a fingerprint it never observed.
#[derive(Debug)]
pub struct SnapshotStore {
    inner: Mutex<SnapshotState>,
    ttl_ms: u64,
    max_entries: usize,
}

#[derive(Debug, Default)]
struct SnapshotState {
    next_snapshot: u64,
    next_cursor: u64,
    order: Vec<String>,
    by_id: HashMap<String, SnapshotRecord>,
    cursors: HashMap<String, CursorRecord>,
}

impl Default for SnapshotStore {
    fn default() -> Self {
        Self::new(30 * 60 * 1000, 4096)
    }
}

impl SnapshotStore {
    pub fn new(ttl_ms: u64, max_entries: usize) -> Self {
        Self {
            inner: Mutex::new(SnapshotState::default()),
            ttl_ms,
            max_entries,
        }
    }

    /// Records a read and returns its snapshot.
    pub fn mint(&self, request: SnapshotRequest<'_>) -> SnapshotRecord {
        let created_at_ms = now_ms();
        let mut state = self.inner.lock().expect("snapshot lock");
        state.next_snapshot += 1;
        let snapshot = SnapshotRecord {
            snapshot_id: format!("snap_{}", base36(state.next_snapshot)),
            kind: request.kind,
            repository_id: request.repository_id.to_string(),
            worktree_id: request.worktree_id.map(str::to_string),
            target_generation: request.target_generation.to_string(),
            created_at_ms,
            tips: request.tips,
            head_oid: request.head_oid,
            observed_refs_fingerprint: request.observed_refs_fingerprint,
            index_key: request.index_key,
            history_intent: request.history_intent,
        };
        state.order.push(snapshot.snapshot_id.clone());
        state
            .by_id
            .insert(snapshot.snapshot_id.clone(), snapshot.clone());
        self.evict(&mut state, created_at_ms);
        snapshot
    }

    pub fn get(&self, snapshot_id: &str) -> Option<SnapshotRecord> {
        let state = self.inner.lock().expect("snapshot lock");
        state.by_id.get(snapshot_id).cloned()
    }

    /// Invalidates every snapshot and cursor scoped to one retired worktree.
    pub fn invalidate_worktree(&self, repository_id: &str, worktree_id: &str) -> usize {
        self.invalidate_matching(|snapshot| {
            snapshot.repository_id == repository_id
                && snapshot.worktree_id.as_deref() == Some(worktree_id)
        })
    }

    /// Invalidates the inventory snapshot whose host-only root sidecar changed.
    pub fn invalidate_worktree_inventory(&self, repository_id: &str) -> usize {
        self.invalidate_matching(|snapshot| {
            snapshot.repository_id == repository_id && snapshot.kind == SnapshotKind::Worktrees
        })
    }

    fn invalidate_matching(&self, matches: impl Fn(&SnapshotRecord) -> bool) -> usize {
        let mut state = self.inner.lock().expect("snapshot lock");
        let invalidated: HashSet<String> = state
            .by_id
            .iter()
            .filter(|(_, snapshot)| matches(snapshot))
            .map(|(snapshot_id, _)| snapshot_id.clone())
            .collect();
        if invalidated.is_empty() {
            return 0;
        }
        for snapshot_id in &invalidated {
            state.by_id.remove(snapshot_id);
        }
        state
            .order
            .retain(|snapshot_id| !invalidated.contains(snapshot_id));
        invalidated.len()
    }

    /// Mints a continuation for a paged read.
    pub fn mint_cursor(&self, snapshot: &SnapshotRecord, skip: usize, limit: usize) -> String {
        let mut state = self.inner.lock().expect("snapshot lock");
        state.next_cursor += 1;
        let cursor = format!("cur_{}", base36(state.next_cursor));
        state.cursors.insert(
            cursor.clone(),
            CursorRecord {
                snapshot_id: snapshot.snapshot_id.clone(),
                skip,
                limit,
                kind: snapshot.kind,
                repository_id: snapshot.repository_id.clone(),
                worktree_id: snapshot.worktree_id.clone(),
            },
        );
        cursor
    }

    pub fn resolve_cursor(&self, cursor: &str) -> CursorResult {
        if !is_cursor_shape(cursor) {
            return CursorResult::Malformed;
        }
        let state = self.inner.lock().expect("snapshot lock");
        let Some(record) = state.cursors.get(cursor) else {
            return CursorResult::Unknown;
        };
        if !state.by_id.contains_key(&record.snapshot_id) {
            return CursorResult::Expired;
        }
        CursorResult::Resolved {
            snapshot_id: record.snapshot_id.clone(),
            skip: record.skip,
            limit: record.limit,
            kind: record.kind,
        }
    }

    /// The repository a cursor belongs to, so a continuation cannot be replayed
    /// against another repository.
    pub fn cursor_repository(&self, cursor: &str) -> Option<(String, Option<String>)> {
        let state = self.inner.lock().expect("snapshot lock");
        state
            .cursors
            .get(cursor)
            .map(|record| (record.repository_id.clone(), record.worktree_id.clone()))
    }

    fn evict(&self, state: &mut SnapshotState, now_ms: u64) {
        let ttl = self.ttl_ms;
        let expired: Vec<String> = state
            .order
            .iter()
            .filter(|id| {
                state
                    .by_id
                    .get(*id)
                    .is_none_or(|record| now_ms.saturating_sub(record.created_at_ms) >= ttl)
            })
            .cloned()
            .collect();
        for id in expired {
            state.by_id.remove(&id);
        }
        state.order.retain(|id| state.by_id.contains_key(id));

        while state.order.len() > self.max_entries {
            if let Some(oldest) = state.order.first().cloned() {
                state.order.remove(0);
                state.by_id.remove(&oldest);
            }
        }
    }
}

fn is_cursor_shape(cursor: &str) -> bool {
    let Some(rest) = cursor.strip_prefix("cur_") else {
        return false;
    };
    !rest.is_empty()
        && rest.len() <= 96
        && rest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, mode: &str, oid: &str) -> IndexFingerprintEntry {
        IndexFingerprintEntry {
            path_key: hex(path.as_bytes()),
            original_path_key: None,
            mode: mode.to_string(),
            oid: oid.to_string(),
            stage: 0,
        }
    }

    fn request<'a>(
        kind: SnapshotKind,
        repository_id: &'a str,
        worktree_id: Option<&'a str>,
    ) -> SnapshotRequest<'a> {
        SnapshotRequest {
            kind,
            repository_id,
            worktree_id,
            target_generation: "gen_1",
            tips: Vec::new(),
            head_oid: None,
            observed_refs_fingerprint: None,
            index_key: None,
            history_intent: None,
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn the_same_index_produces_the_same_fingerprint_regardless_of_row_order() {
        let first = index_fingerprint(
            Some("head1"),
            &[row("a", "100644", "1"), row("b", "100644", "2")],
        );
        let second = index_fingerprint(
            Some("head1"),
            &[row("b", "100644", "2"), row("a", "100644", "1")],
        );
        assert_eq!(first, second);
    }

    #[test]
    fn a_different_index_produces_a_different_fingerprint() {
        // This is the whole point: a write bound to the first must be refused after
        // the second.
        let before = index_fingerprint(Some("head1"), &[row("a", "100644", "1")]);
        let after = index_fingerprint(Some("head1"), &[row("a", "100644", "2")]);
        assert_ne!(before, after);
    }

    #[test]
    fn an_unborn_repository_has_a_fingerprint_too() {
        // "(unborn)" is a real state, not a missing fingerprint: an initial commit
        // must still be refused when the index changed underneath it.
        let fingerprint = index_fingerprint(None, &[row("a", "100644", "1")]);
        assert!(fingerprint.starts_with("(unborn)"));
    }

    #[test]
    fn a_path_that_contains_a_nul_cannot_shift_the_fingerprint_rows() {
        let with_nul = index_fingerprint(Some("h"), &[row("a\u{0}b", "100644", "1")]);
        let without = index_fingerprint(Some("h"), &[row("a", "100644", "1")]);
        assert_ne!(with_nul, without);
    }

    #[test]
    fn mints_snapshots_with_distinct_ids() {
        let store = SnapshotStore::default();
        let first = store.mint(request(SnapshotKind::Status, "repo_1", Some("wt_1")));
        let second = store.mint(request(SnapshotKind::Status, "repo_1", Some("wt_1")));
        assert_ne!(first.snapshot_id, second.snapshot_id);
        assert!(store.get(&first.snapshot_id).is_some());
    }

    #[test]
    fn a_snapshot_remembers_the_target_generation_it_was_taken_on() {
        // Without the recorded generation a cursor minted before a target rebuild could
        // not be told apart from one minted after it.
        let store = SnapshotStore::default();
        let snapshot = store.mint(SnapshotRequest {
            target_generation: "gen_7",
            ..request(SnapshotKind::History, "repo_1", None)
        });
        assert_eq!(snapshot.target_generation, "gen_7");
        let read_back = store.get(&snapshot.snapshot_id).expect("stored");
        assert_eq!(read_back.target_generation, "gen_7");
    }

    #[test]
    fn a_cursor_continues_the_snapshot_it_was_minted_from() {
        let store = SnapshotStore::default();
        let snapshot = store.mint(SnapshotRequest {
            tips: vec!["tip1".to_string()],
            head_oid: Some("head1".to_string()),
            ..request(SnapshotKind::History, "repo_1", None)
        });
        let cursor = store.mint_cursor(&snapshot, 50, 25);
        match store.resolve_cursor(&cursor) {
            CursorResult::Resolved {
                snapshot_id,
                skip,
                limit,
                kind,
            } => {
                assert_eq!(snapshot_id, snapshot.snapshot_id);
                assert_eq!(skip, 50);
                assert_eq!(limit, 25);
                assert_eq!(kind, SnapshotKind::History);
            }
            other => panic!("expected a resolved cursor, got {other:?}"),
        }
    }

    #[test]
    fn refuses_a_cursor_this_service_never_minted() {
        let store = SnapshotStore::default();
        assert_eq!(store.resolve_cursor("cur_999"), CursorResult::Unknown);
        assert_eq!(
            store.resolve_cursor("not-a-cursor"),
            CursorResult::Malformed
        );
        assert_eq!(store.resolve_cursor("cur_"), CursorResult::Malformed);
    }

    #[test]
    fn reports_a_cursor_whose_snapshot_was_evicted_as_expired() {
        let store = SnapshotStore::new(30 * 60 * 1000, 1);
        let first = store.mint(request(SnapshotKind::History, "repo_1", None));
        let cursor = store.mint_cursor(&first, 0, 10);
        // A second snapshot evicts the first, because the store holds one entry.
        store.mint(request(SnapshotKind::History, "repo_1", None));
        assert_eq!(store.resolve_cursor(&cursor), CursorResult::Expired);
    }

    #[test]
    fn root_retirement_invalidates_only_affected_worktree_and_inventory_snapshots() {
        let store = SnapshotStore::default();
        let retired = store.mint(request(SnapshotKind::Status, "repo_1", Some("wt_1")));
        let retained = store.mint(request(SnapshotKind::Status, "repo_1", Some("wt_2")));
        let inventory = store.mint(request(SnapshotKind::Worktrees, "repo_1", None));
        let cursor = store.mint_cursor(&retired, 0, 10);

        assert_eq!(store.invalidate_worktree("repo_1", "wt_1"), 1);
        assert!(store.get(&retired.snapshot_id).is_none());
        assert_eq!(store.resolve_cursor(&cursor), CursorResult::Expired);
        assert!(store.get(&retained.snapshot_id).is_some());
        assert_eq!(store.invalidate_worktree_inventory("repo_1"), 1);
        assert!(store.get(&inventory.snapshot_id).is_none());
        assert!(store.get(&retained.snapshot_id).is_some());
    }

    #[test]
    fn remembers_which_repository_a_cursor_belongs_to() {
        // A continuation replayed against another repository must be refused, not
        // answered from the wrong history.
        let store = SnapshotStore::default();
        let snapshot = store.mint(request(SnapshotKind::History, "repo_1", Some("wt_1")));
        let cursor = store.mint_cursor(&snapshot, 0, 10);
        assert_eq!(
            store.cursor_repository(&cursor),
            Some(("repo_1".to_string(), Some("wt_1".to_string())))
        );
    }
}
