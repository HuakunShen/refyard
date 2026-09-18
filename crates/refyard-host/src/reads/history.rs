//! The history panel: a page of the commit graph, its decoration, and one commit's
//! detail.
//!
//! The paging model is the part worth reading twice. A page is served from a
//! **snapshot**: the set of tips it started with, captured once. Continuing with a
//! cursor re-runs `rev-list` against those same tips, so a page that took a while to
//! arrive cannot silently interleave commits from a branch that moved underneath it.
//! The client is told `tipsMoved` instead, and decides whether to offer a refresh.
//!
//! Two facts are computed rather than guessed:
//!
//! - **Boundary and missing parents.** A shallow clone and a partially fetched
//!   repository both produce rows whose parents are not present locally. Drawing those
//!   as roots would show a truncated history as a complete one, so every parent outside
//!   the page is checked with `cat-file --batch-check`; only the ones Git confirms
//!   absent are marked. The commit *object* is the authority on its own parents, not the
//!   `rev-list` row: a grafted commit is printed with no parents at all.
//! - **Decoration.** Ref names per commit come from this page's refs read, not from
//!   `git log --decorate`, so a ref that moved between the two reads cannot decorate an
//!   unrelated commit.
//!
//! The filters this build does not implement (`message`, `author`, `oidPrefix`,
//! `refFullName`, `committedAfter`, `committedBefore`, `pathId`) are **refused**, not
//! ignored: a page that silently dropped a filter would show the user a history they did
//! not ask for. `firstParentOnly`, `limit`, `cursor` and `detailOid` are the supported
//! surface of this slice, and they are the only reason `validate_new_query` exists.
//!
//! One deliberate divergence from the Node reference is recorded here. The reference
//! keys a page's commit bodies by the *index* of the row it asked for, so a body Git
//! failed to produce shifts every later body onto the wrong object name. This port keys
//! bodies by the object name the batch protocol reports, which is the same answer for
//! every well-formed page and refuses instead of mis-attributing when one body is
//! missing. No fixture can reach the difference (a row always comes from the walk that
//! produced it), so it is recorded rather than normalised away.

use std::collections::{HashMap, HashSet};

use refyard_contract::history::{CommitDetail, CommitSummary, HistoryPage, HistoryQuery, Topology};
use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::HeadState;
use refyard_core::parse::cat_file::{
    first_line_bytes, parse_commit_object, CatFileDecoder, CatFileEntry, CatFileObjectType,
    CommitObject,
};
use refyard_core::parse::meta::{parse_object_presence, parse_rev_list_topology, TopologyEntry};
use refyard_core::parse::numstat::REF_LIST_MAX_ENTRIES;
use refyard_core::parse::refs::RefRecord;
use refyard_core::plan::history::{plan_cat_file_batch, plan_rev_list, RevListOptions};
use refyard_core::plan::refs::plan_cat_file_exists;

use crate::clock::format_iso8601_millis;
use crate::paths::decode_text;
use crate::providers::GitExecutor;
use crate::reads::refs::{object_format_of, read_ref_facts};
use crate::reads::{parse_error, read_head_state, require_worktree, run_required, ReadError};
use crate::registry::RepositoryRecord;
use crate::snapshots::{
    CursorResult, HistoryIntent, SnapshotKind, SnapshotRecord, SnapshotRequest, SnapshotStore,
};

const REV_LIST_COMMAND: &str = "rev-list topology";
const CAT_FILE_COMMAND: &str = "cat-file --batch";
const CAT_FILE_CHECK_COMMAND: &str = "cat-file --batch-check";

/// `LIMITS.historyDefaultPageSize`, repeated here so a change to the published limit is
/// a visible edit on both sides.
const HISTORY_DEFAULT_PAGE_SIZE: usize = 200;
/// `LIMITS.historyMaxPageSize`.
const HISTORY_MAX_PAGE_SIZE: usize = 500;
/// `LIMITS.historyTipsMax`: how many walk tips one page may be pinned to.
const HISTORY_TIPS_MAX: usize = 16;

/// The filters a cursor continuation may not redefine.
const HISTORY_FILTERS: [&str; 7] = [
    "message",
    "author",
    "oidPrefix",
    "refFullName",
    "committedAfter",
    "committedBefore",
    "pathId",
];

/// Reads one page of history.
pub async fn read_history(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    snapshots: &SnapshotStore,
    query: &HistoryQuery,
    // The build of the target this call runs against. A cursor minted for another build
    // is refused rather than continued.
    target_generation: &str,
    read_at: &str,
) -> Result<HistoryPage, ReadError> {
    let worktree_id = require_worktree(record, query.worktree_id.as_deref())?;
    let (limit, snapshot, skip) = match &query.cursor {
        Some(cursor) => resolve_continuation(
            snapshots,
            query,
            record,
            &worktree_id,
            cursor,
            target_generation,
        )?,
        None => {
            validate_new_query(query)?;
            let facts = read_ref_facts(runs, record).await?;
            let head = read_head_state(runs, record).await?;
            let tips = collect_tips(&head, &facts.refs);
            let snapshot = snapshots.mint(SnapshotRequest {
                kind: SnapshotKind::History,
                repository_id: &record.repository_id,
                worktree_id: Some(&worktree_id),
                target_generation,
                tips,
                head_oid: head.oid.clone(),
                observed_refs_fingerprint: Some(observed_refs_fingerprint(&head, &facts.refs)),
                index_key: None,
                history_intent: Some(HistoryIntent {
                    first_parent_only: query.first_parent_only == Some(true),
                    // Every filter this slice supports narrows the walk itself, so a page
                    // this service serves is always a continuous walk.
                    topology: Topology::Continuous,
                }),
            });
            let limit = query
                .limit
                .map(|value| value as usize)
                .unwrap_or(HISTORY_DEFAULT_PAGE_SIZE);
            (limit, snapshot, 0usize)
        }
    };
    let intent = snapshot.history_intent.clone().ok_or_else(|| {
        ReadError::problem(Problem::new(
            ProblemCode::InternalError,
            "history snapshot has no normalized intent",
        ))
    })?;

    // The refs are read again for decoration and for the moved-tip check, exactly as the
    // reference does: decoration must come from the state this page was served from.
    let facts = read_ref_facts(runs, record).await?;
    let head = read_head_state(runs, record).await?;
    let observed = observed_refs_fingerprint(&head, &facts.refs);
    let tips_moved = snapshot.observed_refs_fingerprint.as_deref() != Some(observed.as_str());

    let detail = match &query.detail_oid {
        Some(oid) => Some(read_commit_detail(runs, record, oid).await?),
        None => None,
    };

    let decoration = decoration_map(&facts.refs);
    let (commits, missing_objects, row_count) = if snapshot.tips.is_empty() {
        // An unborn repository, or one with no branch and no remote-tracking ref. That is
        // an empty page, not a failure to read one.
        (Vec::new(), Vec::new(), 0usize)
    } else {
        read_page(
            runs,
            record,
            &snapshot.tips,
            limit + 1,
            skip,
            intent.first_parent_only,
            &decoration,
        )
        .await?
    };

    let has_more = row_count > limit;
    let commits: Vec<CommitSummary> = commits.into_iter().take(limit).collect();
    let next_cursor = if has_more {
        Some(snapshots.mint_cursor(&snapshot, skip + commits.len(), limit))
    } else {
        None
    };
    Ok(HistoryPage {
        snapshot_id: snapshot.snapshot_id.clone(),
        repository_id: record.repository_id.clone(),
        read_at: read_at.to_string(),
        object_format: object_format_of(record),
        shallow: record.layout.is_shallow,
        topology: intent.topology,
        commits,
        next_cursor,
        tips_moved,
        // `hasMore` means a cursor continues the page; a missing object means the page
        // itself is short of what it named.
        truncated: has_more || !missing_objects.is_empty(),
        detail,
    })
}

/// Validates a request that starts a page rather than continuing one.
fn validate_new_query(query: &HistoryQuery) -> Result<(), ReadError> {
    if let Some(limit) = query.limit {
        if limit == 0 || limit > HISTORY_MAX_PAGE_SIZE as u64 {
            return Err(ReadError::problem(
                Problem::new(
                    ProblemCode::InvalidRequest,
                    format!("a history page is between 1 and {HISTORY_MAX_PAGE_SIZE} commits"),
                )
                .with_detail("limit", DetailValue::Integer(limit as i64)),
            ));
        }
    }
    let requested: Vec<&str> = HISTORY_FILTERS
        .iter()
        .copied()
        .filter(|filter| filter_requested(query, filter))
        .collect();
    if !requested.is_empty() {
        return Err(ReadError::problem(
            Problem::new(
                ProblemCode::UnsupportedOperation,
                format!(
                    "this build does not implement the {} history filter(s) yet; remove them rather than receiving an unfiltered page",
                    requested.join(", ")
                ),
            )
            .with_detail("filters", DetailValue::Text(requested.join(","))),
        ));
    }
    Ok(())
}

/// Whether one named filter is present in the request.
fn filter_requested(query: &HistoryQuery, filter: &str) -> bool {
    match filter {
        "message" => query.message.is_some(),
        "author" => query.author.is_some(),
        "oidPrefix" => query.oid_prefix.is_some(),
        "refFullName" => query.ref_full_name.is_some(),
        "committedAfter" => query.committed_after.is_some(),
        "committedBefore" => query.committed_before.is_some(),
        "pathId" => query.path_id.is_some(),
        _ => false,
    }
}

/// Resolves a cursor into the snapshot, page size and offset it continues.
///
/// The cursor is the only thing a client holds, so every question about the page it
/// continues is answered here: whose page it is, whether it is still alive, whether it
/// was minted for the same build of the target, and whether this request is trying to
/// redefine the walk.
fn resolve_continuation(
    snapshots: &SnapshotStore,
    query: &HistoryQuery,
    record: &RepositoryRecord,
    worktree_id: &str,
    cursor: &str,
    target_generation: &str,
) -> Result<(usize, SnapshotRecord, usize), ReadError> {
    let (snapshot_id, skip, limit) = match snapshots.resolve_cursor(cursor) {
        CursorResult::Resolved {
            snapshot_id,
            skip,
            limit,
            ..
        } => (snapshot_id, skip, limit),
        CursorResult::Malformed => {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::InvalidRequest,
                "that cursor is unavailable; reload history",
            )))
        }
        // An unknown or evicted cursor is stale, not invalid: the request was well formed
        // and the state behind it is gone.
        CursorResult::Unknown | CursorResult::Expired => {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::StaleSnapshot,
                "that cursor is unavailable; reload history",
            )))
        }
    };
    // A filter on a continuation is the one mistake a client makes by accident when it
    // re-sends its first request with a cursor attached.
    for filter in HISTORY_FILTERS {
        if filter_requested(query, filter) {
            return Err(ReadError::problem(
                Problem::new(
                    ProblemCode::InvalidRequest,
                    "a cursor continuation cannot redefine history filters",
                )
                .with_detail("filter", DetailValue::Text(filter.to_string())),
            ));
        }
    }
    let Some((cursor_repository, cursor_worktree)) = snapshots.cursor_repository(cursor) else {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::StaleSnapshot,
            "that cursor is unavailable; reload history",
        )));
    };
    if cursor_repository != record.repository_id || cursor_worktree.as_deref() != Some(worktree_id)
    {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::Forbidden,
            "that cursor belongs to a different repository or worktree",
        )));
    }
    let Some(snapshot) = snapshots.get(&snapshot_id) else {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::StaleSnapshot,
            "that page's snapshot has expired; reload history",
        )));
    };
    let Some(intent) = snapshot.history_intent.as_ref() else {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::StaleSnapshot,
            "that page's snapshot has expired; reload history",
        )));
    };
    if snapshot.kind != SnapshotKind::History {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::StaleSnapshot,
            "that page's snapshot has expired; reload history",
        )));
    }
    // A rebuilt target is a different place: the same remote path may now be a different
    // machine's repository, so a continuation minted for the old build is refused rather
    // than walked.
    if snapshot.target_generation != target_generation {
        return Err(ReadError::problem(
            Problem::new(
                ProblemCode::StaleSnapshot,
                "that cursor was minted for an earlier build of this execution target; reload history",
            )
            .with_detail("targetGeneration", DetailValue::Text(target_generation.to_string())),
        ));
    }
    let limit_mismatch = query
        .limit
        .is_some_and(|requested| requested as usize != limit);
    let first_parent_mismatch = query
        .first_parent_only
        .is_some_and(|requested| requested != intent.first_parent_only);
    if limit_mismatch || first_parent_mismatch {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::InvalidRequest,
            "page size and first-parent mode are owned by the cursor",
        )));
    }
    Ok((limit, snapshot, skip))
}

/// The tips this page is pinned to.
///
/// Object names, never ref names: a snapshot that pinned `HEAD` would follow the branch
/// when it moved, which is exactly the interleaving the snapshot exists to prevent.
/// Heads and remote-tracking refs only, sorted by ref name and de-duplicated, because two
/// refs pointing at one commit are one tip for `rev-list`.
pub fn collect_tips(head: &HeadState, refs: &[RefRecord]) -> Vec<String> {
    let mut candidates: Vec<(&str, String)> = refs
        .iter()
        .filter(|item| {
            item.ref_name.starts_with("refs/heads/") || item.ref_name.starts_with("refs/remotes/")
        })
        .map(|item| {
            (
                item.ref_name.as_str(),
                item.peeled_oid.clone().unwrap_or_else(|| item.oid.clone()),
            )
        })
        .collect();
    candidates.sort_by(|left, right| left.0.cmp(right.0));
    let mut tips: Vec<String> = Vec::new();
    for (_, oid) in candidates {
        if tips.contains(&oid) {
            continue;
        }
        if tips.len() >= HISTORY_TIPS_MAX {
            break;
        }
        tips.push(oid);
    }
    if let Some(head_oid) = &head.oid {
        if !tips.contains(head_oid) {
            tips.insert(0, head_oid.clone());
            tips.truncate(HISTORY_TIPS_MAX);
        }
    }
    tips
}

/// A complete-ref fingerprint, independent of the bounded walk.
///
/// This is server-local state: it decides `tipsMoved`, and is never sent to a client nor
/// compared with another implementation's. Sorted by ref name so the same refs give the
/// same string whatever order Git listed them in.
pub fn observed_refs_fingerprint(head: &HeadState, refs: &[RefRecord]) -> String {
    let mut rows: Vec<String> = refs
        .iter()
        .map(|item| {
            format!(
                "{} {} {}",
                item.ref_name,
                item.oid,
                item.peeled_oid.clone().unwrap_or_default()
            )
        })
        .collect();
    rows.sort();
    format!(
        "{}\n{}",
        head.oid.clone().unwrap_or_default(),
        rows.join("\n")
    )
}

/// Object name to the ref names pointing at it.
///
/// An annotated tag decorates the commit it points at, not the tag object, which is why
/// the peeled name is preferred.
pub fn decoration_map(refs: &[RefRecord]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for item in refs {
        let target = item.peeled_oid.clone().unwrap_or_else(|| item.oid.clone());
        map.entry(target).or_default().push(item.ref_name.clone());
    }
    map
}

/// Reads the topology walk, its bodies, its decoration and its boundary facts.
async fn read_page(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    tips: &[String],
    max_count: usize,
    skip: usize,
    first_parent_only: bool,
    decoration: &HashMap<String, Vec<String>>,
) -> Result<(Vec<CommitSummary>, Vec<String>, usize), ReadError> {
    let directory = record.location.canonical_worktree.as_str();
    let tip_refs: Vec<&str> = tips.iter().map(String::as_str).collect();
    let options = RevListOptions {
        first_parent_only,
        ..RevListOptions::new(&tip_refs, max_count as i64, skip as i64)
    };
    let plan = plan_rev_list(options).map_err(|error| parse_error(REV_LIST_COMMAND, error))?;
    let topology_bytes = run_required(runs, directory, &plan, REV_LIST_COMMAND).await?;
    let rows = parse_rev_list_topology(&topology_bytes)
        .map_err(|error| parse_error(REV_LIST_COMMAND, error))?;
    if rows.is_empty() {
        return Ok((Vec::new(), Vec::new(), 0));
    }

    let row_oids: Vec<&str> = rows.iter().map(|row| row.oid.as_str()).collect();
    let batch =
        plan_cat_file_batch(&row_oids).map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
    let batch_bytes = run_required(runs, directory, &batch, CAT_FILE_COMMAND).await?;
    let mut decoder = CatFileDecoder::new();
    let entries = decoder
        .push(&batch_bytes)
        .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
    decoder
        .finish()
        .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;

    let mut bodies: HashMap<String, CommitObject> = HashMap::new();
    let mut missing_objects: Vec<String> = Vec::new();
    for entry in entries {
        match entry {
            CatFileEntry::Missing { input } => missing_objects.push(input),
            CatFileEntry::Object {
                oid,
                object_type,
                body,
            } => {
                if object_type != CatFileObjectType::Commit {
                    // A walk that produced a non-commit is not a page this service can
                    // describe; saying "no commits" would be a wrong answer.
                    return Err(ReadError::problem(Problem::new(
                        ProblemCode::InternalError,
                        format!("{oid} is a {}, not a commit", object_type.as_str()),
                    )));
                }
                let parsed = parse_commit_object(&body)
                    .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
                bodies.insert(oid, parsed);
            }
        }
    }

    let page_oids: HashSet<&str> = rows.iter().map(|row| row.oid.as_str()).collect();
    let parents_of = |row: &TopologyEntry| -> Vec<String> {
        match bodies.get(&row.oid) {
            Some(body) => body.parent_oids.clone(),
            None => row.parent_oids.clone(),
        }
    };
    let mut outside: Vec<String> = Vec::new();
    for row in &rows {
        for parent in parents_of(row) {
            if !page_oids.contains(parent.as_str()) && !outside.contains(&parent) {
                outside.push(parent);
            }
        }
    }
    let absent = find_missing_objects(runs, record, &outside).await?;

    let mut commits = Vec::with_capacity(rows.len());
    for row in &rows {
        let Some(body) = bodies.get(&row.oid) else {
            // A row the walk produced but the object protocol did not answer for is a
            // missing object, and this page cannot claim to be complete.
            return Err(ReadError::problem(Problem::new(
                ProblemCode::InternalError,
                format!("the page named {} but no body came back for it", row.oid),
            )));
        };
        let parents = parents_of(row);
        let missing_parents: Vec<String> = parents
            .iter()
            .filter(|parent| absent.contains(*parent))
            .cloned()
            .collect();
        commits.push(CommitSummary {
            oid: row.oid.clone(),
            parents,
            subject: decode_text(first_line_bytes(&body.message_bytes)),
            author_name: decode_text(&body.author.name_bytes),
            author_email: decode_text(&body.author.email_bytes),
            authored_at: iso_seconds(body.author.timestamp),
            committed_at: iso_seconds(body.committer.timestamp),
            ref_names: decoration.get(&row.oid).cloned().unwrap_or_default(),
            signed: body.signed,
            // `boundary` means "this row's history is cut here": Git marked it, or a
            // parent the object names is not in this repository.
            boundary: row.boundary || !missing_parents.is_empty(),
            missing_parents,
        });
    }
    Ok((commits, missing_objects, rows.len()))
}

/// Which of these object names Git cannot produce.
///
/// A name Git did not answer for at all counts as missing: reporting it as present would
/// hide a boundary, and this read exists precisely to avoid that.
async fn find_missing_objects(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    oids: &[String],
) -> Result<HashSet<String>, ReadError> {
    if oids.is_empty() {
        return Ok(HashSet::new());
    }
    let bounded: Vec<&str> = oids
        .iter()
        .map(String::as_str)
        .take(REF_LIST_MAX_ENTRIES)
        .collect();
    let directory = record.location.canonical_worktree.as_str();
    let plan = plan_cat_file_exists(&bounded)
        .map_err(|error| parse_error(CAT_FILE_CHECK_COMMAND, error))?;
    let bytes = run_required(runs, directory, &plan, CAT_FILE_CHECK_COMMAND).await?;
    let presence = parse_object_presence(&bytes, &bounded)
        .map_err(|error| parse_error(CAT_FILE_CHECK_COMMAND, error))?;
    let answered: HashSet<&str> = presence
        .present
        .iter()
        .chain(presence.missing.iter())
        .map(String::as_str)
        .collect();
    let reported_missing: HashSet<&str> = presence.missing.iter().map(String::as_str).collect();
    Ok(bounded
        .iter()
        .filter(|oid| !answered.contains(*oid) || reported_missing.contains(*oid))
        .map(|oid| (*oid).to_string())
        .collect())
}

/// One commit's full metadata and message.
async fn read_commit_detail(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    oid: &str,
) -> Result<CommitDetail, ReadError> {
    let directory = record.location.canonical_worktree.as_str();
    let plan = plan_cat_file_batch(&[oid]).map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
    let bytes = run_required(runs, directory, &plan, CAT_FILE_COMMAND).await?;
    let mut decoder = CatFileDecoder::new();
    let entries = decoder
        .push(&bytes)
        .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
    decoder
        .finish()
        .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
    let mut missing: Vec<String> = Vec::new();
    let mut found = None;
    for entry in entries {
        match entry {
            CatFileEntry::Missing { input } => missing.push(input),
            CatFileEntry::Object {
                oid,
                object_type,
                body,
            } => {
                if object_type != CatFileObjectType::Commit {
                    return Err(ReadError::problem(Problem::new(
                        ProblemCode::InternalError,
                        format!("{oid} is a {}, not a commit", object_type.as_str()),
                    )));
                }
                let parsed = parse_commit_object(&body)
                    .map_err(|error| parse_error(CAT_FILE_COMMAND, error))?;
                found = Some((oid, parsed));
            }
        }
    }
    let Some((resolved_oid, body)) = found else {
        let mut problem = Problem::new(
            ProblemCode::NotFound,
            format!("commit {oid} is not present in this repository"),
        )
        .with_detail("oid", DetailValue::Text(oid.to_string()));
        if !missing.is_empty() {
            problem = problem.with_detail("missing", DetailValue::Text(missing.join(",")));
        }
        return Err(ReadError::problem(problem));
    };
    Ok(CommitDetail {
        oid: resolved_oid,
        parents: body.parent_oids.clone(),
        tree_oid: body.tree_oid.clone(),
        author_name: decode_text(&body.author.name_bytes),
        author_email: decode_text(&body.author.email_bytes),
        authored_at: iso_seconds(body.author.timestamp),
        committer_name: decode_text(&body.committer.name_bytes),
        committer_email: decode_text(&body.committer.email_bytes),
        committed_at: iso_seconds(body.committer.timestamp),
        subject: decode_text(first_line_bytes(&body.message_bytes)),
        body: decode_text(&body.message_bytes),
        encoding: body.encoding.clone(),
        signed: body.signed,
    })
}

/// Git epoch seconds as the contract's timestamp form.
fn iso_seconds(seconds: i64) -> String {
    format_iso8601_millis(seconds.saturating_mul(1000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::HeadKind;

    fn ref_record(ref_name: &str, oid: &str) -> RefRecord {
        RefRecord {
            ref_name: ref_name.to_string(),
            oid: oid.to_string(),
            object_type: "commit".to_string(),
            symref: None,
            upstream: None,
            upstream_track: None,
            is_head: false,
            peeled_oid: None,
        }
    }

    fn head_on(oid: Option<&str>) -> HeadState {
        HeadState {
            kind: if oid.is_some() {
                HeadKind::Born
            } else {
                HeadKind::Unborn
            },
            branch_name: Some("main".to_string()),
            oid: oid.map(str::to_string),
            detached: false,
        }
    }

    fn query() -> HistoryQuery {
        HistoryQuery {
            repository_id: "repo_1".to_string(),
            worktree_id: None,
            cursor: None,
            limit: None,
            detail_oid: None,
            first_parent_only: None,
            message: None,
            author: None,
            oid_prefix: None,
            ref_full_name: None,
            committed_after: None,
            committed_before: None,
            path_id: None,
        }
    }

    /// The smallest record the continuation rules need: an identity and a worktree.
    fn record() -> RepositoryRecord {
        RepositoryRecord {
            repository_id: "repo_1".to_string(),
            allowed_root_id: "root_1".to_string(),
            worktree_id: "wt_1".to_string(),
            display_name: "repo".to_string(),
            display_path: "/repo".to_string(),
            root_path: std::path::PathBuf::from("/"),
            relative_path: "repo".to_string(),
            layout: crate::registry::RepositoryLayout {
                git_dir: "/repo/.git".to_string(),
                top_level: Some("/repo".to_string()),
                common_dir: "/repo/.git".to_string(),
                is_bare: false,
                object_format: "sha1".to_string(),
                is_shallow: false,
            },
            location: crate::registry::RepositoryLocation {
                target_id: "tgt_local".to_string(),
                target_generation: "gen_1".to_string(),
                canonical_worktree: "/repo".to_string(),
                canonical_common_dir: "/repo/.git".to_string(),
            },
        }
    }

    fn history_snapshot(
        store: &SnapshotStore,
        repository_id: &str,
        first_parent_only: bool,
    ) -> SnapshotRecord {
        store.mint(SnapshotRequest {
            kind: SnapshotKind::History,
            repository_id,
            worktree_id: Some("wt_1"),
            target_generation: "gen_1",
            tips: vec!["tip1".to_string()],
            head_oid: Some("tip1".to_string()),
            observed_refs_fingerprint: None,
            index_key: None,
            history_intent: Some(HistoryIntent {
                first_parent_only,
                topology: Topology::Continuous,
            }),
        })
    }

    #[test]
    fn tips_come_from_head_and_from_every_branch_and_tracking_ref() {
        // A page must include work that only a remote-tracking ref points at, or a
        // fetched-but-unmerged branch would show as no history at all.
        let refs = vec![
            ref_record("refs/heads/main", "head1"),
            ref_record("refs/heads/topic", "topic1"),
            ref_record("refs/remotes/origin/main", "head1"),
            ref_record("refs/tags/v1", "tagobject"),
        ];
        assert_eq!(
            collect_tips(&head_on(Some("head1")), &refs),
            vec!["head1".to_string(), "topic1".to_string()]
        );
    }

    #[test]
    fn a_tag_never_becomes_a_walk_tip() {
        // A tag object is not a commit; walking from it would fail or, worse, resolve to
        // something the user never asked about. HEAD still contributes its own commit.
        let refs = vec![ref_record("refs/tags/v1", "tagobject")];
        let tips = collect_tips(&head_on(Some("head1")), &refs);
        assert_eq!(tips, vec!["head1".to_string()]);
        assert!(!tips.contains(&"tagobject".to_string()));
    }

    #[test]
    fn an_unborn_head_contributes_no_tip() {
        assert!(collect_tips(&head_on(None), &[]).is_empty());
    }

    #[test]
    fn tips_are_bounded_and_deduplicated() {
        let refs: Vec<RefRecord> = (0..40)
            .map(|index| ref_record(&format!("refs/heads/b{index:02}"), &format!("oid{index}")))
            .collect();
        let tips = collect_tips(&head_on(None), &refs);
        assert_eq!(tips.len(), HISTORY_TIPS_MAX);
        assert_eq!(tips[0], "oid0");
    }

    #[test]
    fn a_moved_branch_or_a_moved_head_changes_the_fingerprint() {
        // This is the whole point of the fingerprint: it decides `tipsMoved`.
        let refs = vec![ref_record("refs/heads/main", "head1")];
        let before = observed_refs_fingerprint(&head_on(Some("head1")), &refs);
        let moved_ref = observed_refs_fingerprint(
            &head_on(Some("head1")),
            &[ref_record("refs/heads/main", "head2")],
        );
        let moved_head = observed_refs_fingerprint(&head_on(Some("head2")), &refs);
        assert_ne!(before, moved_ref);
        assert_ne!(before, moved_head);
        assert_eq!(
            before,
            observed_refs_fingerprint(
                &head_on(Some("head1")),
                &[ref_record("refs/heads/main", "head1")]
            )
        );
    }

    #[test]
    fn a_tag_decorates_the_commit_it_points_at() {
        let mut tag = ref_record("refs/tags/v1", "tagobject");
        tag.object_type = "tag".to_string();
        tag.peeled_oid = Some("commit1".to_string());
        let decoration = decoration_map(&[ref_record("refs/heads/main", "commit1"), tag]);
        assert_eq!(
            decoration.get("commit1"),
            Some(&vec![
                "refs/heads/main".to_string(),
                "refs/tags/v1".to_string()
            ])
        );
        assert_eq!(decoration.get("tagobject"), None);
    }

    #[test]
    fn an_unsupported_filter_is_refused_rather_than_silently_ignored() {
        // Accepting `message` and returning the whole graph would show a history the
        // caller asked to be narrowed.
        let mut request = query();
        request.message = Some("fix".to_string());
        let error = validate_new_query(&request).expect_err("refused");
        let problem = error.to_problem();
        assert_eq!(problem.code, ProblemCode::UnsupportedOperation);
        assert!(problem.message.contains("message"));
    }

    #[test]
    fn a_page_size_outside_the_published_range_is_refused() {
        let mut request = query();
        request.limit = Some(HISTORY_MAX_PAGE_SIZE as u64 + 1);
        assert_eq!(
            validate_new_query(&request)
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::InvalidRequest
        );
        request.limit = Some(0);
        assert_eq!(
            validate_new_query(&request)
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::InvalidRequest
        );
        request.limit = Some(HISTORY_MAX_PAGE_SIZE as u64);
        assert!(validate_new_query(&request).is_ok());
    }

    #[test]
    fn a_continuation_cannot_redefine_a_filter() {
        let store = SnapshotStore::default();
        let snapshot = history_snapshot(&store, "repo_1", false);
        let cursor = store.mint_cursor(&snapshot, 50, 25);
        let mut request = query();
        request.cursor = Some(cursor.clone());
        request.author = Some("Someone".to_string());
        let error = resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1")
            .expect_err("refused");
        assert_eq!(error.to_problem().code, ProblemCode::InvalidRequest);
    }

    #[test]
    fn a_continuation_may_not_change_the_page_size_or_the_first_parent_mode() {
        let store = SnapshotStore::default();
        let snapshot = history_snapshot(&store, "repo_1", true);
        let cursor = store.mint_cursor(&snapshot, 50, 25);
        let mut request = query();
        request.cursor = Some(cursor.clone());
        request.limit = Some(50);
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::InvalidRequest
        );
        request.limit = None;
        request.first_parent_only = Some(false);
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::InvalidRequest
        );
        // The values the cursor owns are accepted and returned.
        let mut matching = query();
        matching.cursor = Some(cursor.clone());
        matching.limit = Some(25);
        matching.first_parent_only = Some(true);
        let (limit, _, skip) =
            resolve_continuation(&store, &matching, &record(), "wt_1", &cursor, "gen_1")
                .expect("resolved");
        assert_eq!(limit, 25);
        assert_eq!(skip, 50);
    }

    #[test]
    fn a_cursor_from_another_repository_is_forbidden_not_stale() {
        // Answering with another repository's history would be the worst possible read:
        // plausible and wrong.
        let store = SnapshotStore::default();
        let snapshot = history_snapshot(&store, "repo_other", false);
        let cursor = store.mint_cursor(&snapshot, 0, 25);
        let mut request = query();
        request.cursor = Some(cursor.clone());
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::Forbidden
        );
    }

    #[test]
    fn a_cursor_this_service_never_minted_is_stale() {
        let store = SnapshotStore::default();
        let mut request = query();
        request.cursor = Some("cur_unknown".to_string());
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", "cur_unknown", "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::StaleSnapshot
        );
    }

    #[test]
    fn a_malformed_cursor_is_invalid_rather_than_stale() {
        // A malformed value never was a cursor; telling the user to reload would hide a
        // client bug.
        let store = SnapshotStore::default();
        let mut request = query();
        request.cursor = Some("not-a-cursor".to_string());
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", "not-a-cursor", "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::InvalidRequest
        );
    }

    #[test]
    fn a_cursor_from_an_earlier_build_of_the_target_is_refused() {
        // A rebuilt target is a different place: continuing a walk pinned to the old
        // build's tips would mix two machines' histories into one page.
        let store = SnapshotStore::default();
        let snapshot = history_snapshot(&store, "repo_1", false);
        let cursor = store.mint_cursor(&snapshot, 0, 25);
        let mut request = query();
        request.cursor = Some(cursor.clone());
        // The cursor was minted on gen_1 and the target now reports gen_2.
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_2")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::StaleSnapshot
        );
        // On the build it was minted for, the same cursor still resolves.
        assert!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1").is_ok()
        );
    }

    #[test]
    fn a_cursor_whose_snapshot_was_evicted_is_stale() {
        let store = SnapshotStore::new(30 * 60 * 1000, 1);
        let first = history_snapshot(&store, "repo_1", false);
        let cursor = store.mint_cursor(&first, 0, 25);
        history_snapshot(&store, "repo_1", false);
        let mut request = query();
        request.cursor = Some(cursor.clone());
        assert_eq!(
            resolve_continuation(&store, &request, &record(), "wt_1", &cursor, "gen_1")
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::StaleSnapshot
        );
    }
}
