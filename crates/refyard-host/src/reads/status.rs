//! Turning a repository's state into the status DTO.
//!
//! The mapping is deliberately thin: the parser decides what the bytes mean, and this
//! module only decides how a value is *named* on the wire and which ids the caller
//! gets to hold. Two things live here rather than in the parser because they need the
//! host: the operation-in-progress markers (files in the Git directory) and the path
//! id registry (which binds raw bytes to an opaque id).

use std::path::Path;

use refyard_contract::reads::{
    HeadKind, HeadState, OperationInProgress, PathEncoding, StageNumber, StatusEntry,
    StatusEntryKind, StatusEntryModes, StatusSnapshot, StatusUpstream, SubmoduleStatus,
    UnmergedStage,
};
use refyard_core::parse::status::{
    parse_status, StatusParseResult, StatusRecord, STATUS_MAX_ENTRIES,
};

use crate::paths::{to_display_path, PathRegistry};
use crate::providers::local::LocalGit;
use crate::registry::RepositoryRecord;
use crate::snapshots::{
    index_fingerprint, IndexFingerprintEntry, SnapshotKind, SnapshotRequest, SnapshotStore,
};

/// Which operation Git is in the middle of, read from the Git directory.
///
/// `unknown` is reported for a marker this build does not recognise, because "there is
/// something in progress and we cannot say what" is more useful than "nothing".
pub fn operation_in_progress(git_dir: &Path) -> Option<OperationInProgress> {
    let markers: [(&str, OperationInProgress); 6] = [
        ("MERGE_HEAD", OperationInProgress::Merge),
        ("CHERRY_PICK_HEAD", OperationInProgress::CherryPick),
        ("REVERT_HEAD", OperationInProgress::Revert),
        ("rebase-merge", OperationInProgress::Rebase),
        ("rebase-apply", OperationInProgress::Rebase),
        ("BISECT_LOG", OperationInProgress::Bisect),
    ];
    for (marker, operation) in markers {
        if git_dir.join(marker).exists() {
            return Some(operation);
        }
    }
    // A sequencer directory means a merge/cherry-pick sequence is queued; the kind is
    // not knowable from the marker alone.
    if git_dir.join("sequencer").exists() {
        return Some(OperationInProgress::Unknown);
    }
    None
}

/// Reads status and records a snapshot for it.
pub async fn read_status(
    git: &LocalGit,
    record: &RepositoryRecord,
    paths: &PathRegistry,
    snapshots: &SnapshotStore,
    include_ignored: bool,
    read_at: &str,
) -> Result<(StatusSnapshot, String), StatusReadError> {
    let plan = refyard_core::plan::status::plan_status(refyard_core::plan::status::StatusOptions {
        include_ignored,
        show_stash: false,
    });
    let outcome = git
        .run(
            Path::new(record.location.canonical_worktree.as_str()),
            &plan,
            None,
        )
        .await;
    if !outcome.succeeded() {
        return Err(StatusReadError::Git(
            outcome.exit_code,
            String::from_utf8_lossy(&outcome.stderr).into_owned(),
        ));
    }
    if !outcome.output_complete {
        return Err(StatusReadError::Incomplete);
    }

    let parsed = parse_status(&outcome.stdout, STATUS_MAX_ENTRIES)?;
    let head = head_state(&parsed);
    let worktree_id = record.worktree_id.clone();

    let mut entries: Vec<StatusEntry> = Vec::with_capacity(parsed.records.len());
    let mut fingerprint_rows: Vec<IndexFingerprintEntry> = Vec::with_capacity(parsed.records.len());
    for item in &parsed.records {
        entries.push(status_entry(item, &worktree_id, paths));
        fingerprint_rows.push(fingerprint_entry(item));
    }

    let index_key = index_fingerprint(head.oid.as_deref(), &fingerprint_rows);
    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Status,
        repository_id: &record.repository_id,
        worktree_id: Some(&worktree_id),
        tips: Vec::new(),
        head_oid: head.oid.clone(),
        observed_refs_fingerprint: None,
        index_key: Some(index_key),
    });

    let upstream = match (&parsed.upstream, parsed.ahead, parsed.behind) {
        (Some(name), Some(ahead), Some(behind)) => Some(StatusUpstream {
            name: name.clone(),
            ahead,
            behind,
        }),
        // An upstream with no `branch.ab` header means the branch has no
        // remote-tracking ref to compare against, so there is nothing to report.
        _ => None,
    };

    let snapshot_dto = StatusSnapshot {
        snapshot_id: snapshot.snapshot_id.clone(),
        repository_id: record.repository_id.clone(),
        worktree_id,
        read_at: read_at.to_string(),
        head,
        upstream,
        operation_in_progress: operation_in_progress(Path::new(&record.layout.git_dir)),
        entry_count: entries.len() as u64,
        entries,
        truncated: false,
    };
    Ok((snapshot_dto, snapshot.snapshot_id))
}

/// Where HEAD is, in the three states the contract distinguishes.
pub fn head_state(parsed: &StatusParseResult) -> HeadState {
    if parsed.branch.initial {
        return HeadState {
            kind: HeadKind::Unborn,
            branch_name: parsed.branch.head.clone(),
            oid: None,
            detached: false,
        };
    }
    if parsed.branch.detached {
        return HeadState {
            kind: HeadKind::Born,
            branch_name: None,
            oid: parsed.branch.oid.clone(),
            detached: true,
        };
    }
    HeadState {
        kind: HeadKind::Born,
        branch_name: parsed.branch.head.clone(),
        oid: parsed.branch.oid.clone(),
        detached: false,
    }
}

fn status_entry(record: &StatusRecord, worktree_id: &str, paths: &PathRegistry) -> StatusEntry {
    let display = to_display_path(&record.path);
    let path_id = paths.bind(worktree_id, &record.path);
    let original = record.original_path.as_ref().map(|bytes| {
        let original_display = to_display_path(bytes);
        (
            paths.bind(worktree_id, bytes),
            original_display.text,
            original_display.representable,
        )
    });
    // A rename's original path is only offered as an id when it round-trips; an
    // unrepresentable name is displayable but must never be named by a write.
    let original_path_id = original
        .as_ref()
        .filter(|(_, _, representable)| *representable)
        .map(|(id, _, _)| id.clone());
    let original_display_path = original.as_ref().map(|(_, text, _)| text.clone());

    StatusEntry {
        path_id,
        display_path: display.text.clone(),
        path_encoding: if display.representable {
            PathEncoding::Utf8
        } else {
            PathEncoding::Unrepresentable
        },
        kind: match record.kind {
            refyard_core::parse::status::StatusRecordKind::Ordinary => StatusEntryKind::Ordinary,
            refyard_core::parse::status::StatusRecordKind::Renamed => StatusEntryKind::Renamed,
            refyard_core::parse::status::StatusRecordKind::Copied => StatusEntryKind::Copied,
            refyard_core::parse::status::StatusRecordKind::Unmerged => StatusEntryKind::Unmerged,
            refyard_core::parse::status::StatusRecordKind::Untracked => StatusEntryKind::Untracked,
            refyard_core::parse::status::StatusRecordKind::Ignored => StatusEntryKind::Ignored,
        },
        index_status: record.index_status.clone(),
        worktree_status: record.worktree_status.clone(),
        original_path_id,
        original_display_path,
        head_oid: record.oid_head.clone(),
        index_oid: record.oid_index.clone(),
        modes: Some(StatusEntryModes {
            head: record.mode_head.clone(),
            index: record.mode_index.clone(),
            worktree: record.mode_worktree.clone(),
        }),
        submodule: submodule_status(record),
        stages: if record.stages.is_empty() {
            None
        } else {
            Some(
                record
                    .stages
                    .iter()
                    .filter_map(|stage| {
                        let number = match stage.stage {
                            1 => StageNumber::Base,
                            2 => StageNumber::Ours,
                            3 => StageNumber::Theirs,
                            _ => return None,
                        };
                        Some(UnmergedStage {
                            stage: number,
                            mode: stage.mode.clone(),
                            oid: stage.oid.clone(),
                        })
                    })
                    .collect(),
            )
        },
    }
}

fn submodule_status(record: &StatusRecord) -> Option<SubmoduleStatus> {
    if !record.submodule_field.starts_with('S') {
        return None;
    }
    Some(SubmoduleStatus {
        commit_changed: record.submodule_commit_changed,
        modified: record.submodule_modified,
        untracked: record.submodule_untracked,
    })
}

fn fingerprint_entry(record: &StatusRecord) -> IndexFingerprintEntry {
    IndexFingerprintEntry {
        path_key: hex(&record.path),
        original_path_key: record.original_path.as_deref().map(hex),
        mode: record
            .mode_index
            .clone()
            .or_else(|| record.mode_worktree.clone())
            .unwrap_or_else(|| "-".to_string()),
        oid: record.oid_index.clone().unwrap_or_else(|| "-".to_string()),
        stage: record.stages.len(),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Why a status read failed.
#[derive(Debug)]
pub enum StatusReadError {
    Git(Option<i32>, String),
    Incomplete,
    Parse(refyard_core::CoreError),
}

impl From<refyard_core::CoreError> for StatusReadError {
    fn from(error: refyard_core::CoreError) -> Self {
        StatusReadError::Parse(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_an_in_progress_merge_from_the_marker_file() {
        let directory = tempfile::tempdir().expect("temp dir");
        assert_eq!(operation_in_progress(directory.path()), None);
        std::fs::write(directory.path().join("MERGE_HEAD"), b"abc\n").expect("write marker");
        assert_eq!(
            operation_in_progress(directory.path()),
            Some(OperationInProgress::Merge)
        );
    }

    #[test]
    fn reports_an_unrecognised_sequencer_state_as_unknown_rather_than_as_nothing() {
        // "Something is in progress and we cannot say what" is the honest answer;
        // reporting `null` would invite a write that Git will refuse anyway.
        let directory = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir(directory.path().join("sequencer")).expect("mkdir");
        assert_eq!(
            operation_in_progress(directory.path()),
            Some(OperationInProgress::Unknown)
        );
    }
}
