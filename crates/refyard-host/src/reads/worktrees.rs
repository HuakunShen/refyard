//! The worktrees panel: every worktree of a repository, primary and linked.
//!
//! Identity is the rule the write side already resolves by: the primary keeps the id
//! the registry minted at registration (the same id every status read addresses), and a
//! linked worktree's id is `worktree_id_for_path` of the path Git lists — the function
//! lock/unlock/remove match against, so a row read here and a write resolved there can
//! never name the same worktree differently. No registry sits between them, so there is
//! nothing to go stale.
//!
//! A bare repository lists itself with `bare` and no checkout; its row is reported with
//! `isMain: false`, because a bare repository has no main worktree to name.

use refyard_contract::reads::{HeadKind, HeadState, WorktreeSummary, WorktreesResponse};
use refyard_core::plan::worktrees::{parse_worktree_list, plan_worktree_list, worktree_id_for_path};

use crate::paths::to_display_path;
use crate::providers::GitExecutor;
use crate::reads::{run_required, ReadError};
use crate::registry::RepositoryRecord;
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const WORKTREE_LIST_COMMAND: &str = "worktree list --porcelain -z";

/// Reads every worktree and records a snapshot for them.
pub async fn read_worktrees(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    snapshots: &SnapshotStore,
    read_at: &str,
) -> Result<WorktreesResponse, ReadError> {
    let directory = record.location.canonical_worktree.as_str();
    let bytes = run_required(runs, directory, &plan_worktree_list(), WORKTREE_LIST_COMMAND).await?;
    let entries = parse_worktree_list(&bytes);

    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Worktrees,
        repository_id: &record.repository_id,
        worktree_id: None,
        target_generation: &record.location.target_generation,
        tips: Vec::new(),
        head_oid: None,
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });

    Ok(WorktreesResponse {
        snapshot_id: snapshot.snapshot_id,
        repository_id: record.repository_id.clone(),
        read_at: read_at.to_string(),
        worktrees: entries
            .iter()
            .map(|entry| {
                // The primary is the row every other read of this repository addresses,
                // so it keeps the registry's id; linked rows take the path-derived id.
                let worktree_id = if entry.is_primary && !entry.bare {
                    record.worktree_id.clone()
                } else {
                    worktree_id_for_path(&entry.path)
                };
                WorktreeSummary {
                    worktree_id,
                    display_path: to_display_path(&entry.path).text,
                    head: HeadState {
                        kind: if entry.head_oid.is_none() {
                            HeadKind::Unborn
                        } else {
                            HeadKind::Born
                        },
                        branch_name: entry
                            .branch
                            .as_deref()
                            .map(|full| full.strip_prefix("refs/heads/").unwrap_or(full))
                            .map(str::to_string),
                        oid: entry.head_oid.clone(),
                        detached: entry.detached,
                    },
                    is_main: entry.is_primary && !entry.bare,
                    is_bare: entry.bare,
                    is_detached: entry.detached,
                    is_locked: entry.locked,
                    lock_reason: entry
                        .lock_reason
                        .as_deref()
                        .map(|reason| to_display_path(reason).text),
                    is_prunable: entry.prunable,
                }
            })
            .collect(),
    })
}
