//! Bounded stash reflog reads, preserving the moving locator with each object id.

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{StashEntry, StashesResponse};
use refyard_core::plan::status::plan_stash_list;

use crate::clock::format_iso8601_millis;
use crate::paths::decode_text;
use crate::providers::GitExecutor;
use crate::reads::{parse_error, run_meaningful_exit, ReadError};
use crate::registry::RepositoryRecord;
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const STASH_LIST_COMMAND: &str = "reflog show refs/stash";
const STASH_MAX_ENTRIES: usize = 1_000;
const STASH_MESSAGE_MAX_BYTES: usize = 4_096;
const STASH_BRANCH_MAX_BYTES: usize = 1_024;

/// Reads the selected worktree's stash reflog. Missing `refs/stash` is an empty list;
/// process failures, malformed output and over-limit inventories remain typed failures.
pub async fn read_stashes(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    snapshots: &SnapshotStore,
    read_at: &str,
) -> Result<StashesResponse, ReadError> {
    let output = run_meaningful_exit(
        runs,
        &record.location.canonical_worktree,
        &plan_stash_list(),
        STASH_LIST_COMMAND,
        &[1, 128],
    )
    .await?;
    let reflog = match output {
        Some(output) if !output.is_empty() => {
            refyard_core::parse::refs::parse_reflog(&output, STASH_MAX_ENTRIES)
                .map_err(|error| parse_error(STASH_LIST_COMMAND, error))?
        }
        _ => Vec::new(),
    };
    let mut stashes = Vec::with_capacity(reflog.len());
    for stash in reflog {
        let (branch, message) = split_stash_subject(&stash.subject);
        if message.len() > STASH_MESSAGE_MAX_BYTES
            || branch.is_some_and(|branch| branch.len() > STASH_BRANCH_MAX_BYTES)
        {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::LimitExceeded,
                "a stash subject exceeds the source contract's display limit; no partial list was returned",
            )));
        }
        if !valid_stash_locator(&stash.locator) || !valid_object_name(&stash.oid) {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::InternalError,
                "Git returned a malformed stash locator or object name",
            )));
        }
        let created_at_millis = stash.timestamp.checked_mul(1_000).ok_or_else(|| {
            ReadError::problem(Problem::new(
                ProblemCode::InternalError,
                "Git returned a stash timestamp outside the supported range",
            ))
        })?;
        stashes.push(StashEntry {
            oid: stash.oid,
            locator: stash.locator,
            message: decode_text(message),
            created_at: format_iso8601_millis(created_at_millis),
            branch_display: branch.map(decode_text),
        });
    }

    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Stashes,
        repository_id: &record.repository_id,
        worktree_id: Some(&record.worktree_id),
        target_generation: &record.location.target_generation,
        tips: Vec::new(),
        head_oid: None,
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });
    Ok(StashesResponse {
        snapshot_id: snapshot.snapshot_id,
        repository_id: record.repository_id.clone(),
        read_at: read_at.to_string(),
        stashes,
        truncated: false,
    })
}

fn split_stash_subject(subject: &[u8]) -> (Option<&[u8]>, &[u8]) {
    let prefix_len = if subject.starts_with(b"On ") {
        Some(3)
    } else if subject.starts_with(b"WIP on ") {
        Some(7)
    } else {
        None
    };
    let Some(prefix_len) = prefix_len else {
        return (None, subject);
    };
    let Some(separator) = subject[prefix_len..]
        .windows(2)
        .position(|window| window == b": ")
        .map(|offset| prefix_len + offset)
    else {
        return (None, subject);
    };
    (
        Some(&subject[prefix_len..separator]),
        &subject[separator + 2..],
    )
}

fn valid_stash_locator(locator: &str) -> bool {
    locator
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'))
        .is_some_and(|index| !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()))
}

fn valid_object_name(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}
