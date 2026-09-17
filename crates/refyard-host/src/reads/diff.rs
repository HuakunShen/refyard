//! The diff panel: what changed, how much, and — when asked — the patch for one path.
//!
//! Three Git commands answer different questions, which is why they are joined here
//! rather than merged into one call:
//!
//! - `diff --name-status` says *what happened* to each path (including renames and type
//!   changes),
//! - `diff --numstat` says *how much* changed, and reports `-`/`-` for a binary file
//!   rather than pretending it has lines,
//! - `diff --patch` says *which* lines, and is read one path at a time so a single huge
//!   file cannot consume the whole response budget.
//!
//! Without a named path the change set is described first; a patch for every changed
//! file in one response is unbounded work in a large repository, so the response says so
//! through `truncated` and the client asks for one path.
//!
//! Untracked files have no diff at all: Git has no diff for a path that is not in the
//! index. Their content is read from the working tree instead, bounded and marked
//! `synthesized` so a client knows the patch did not come from Git.
//!
//! One divergence from the Node reference is deliberate and recorded here. The reference
//! looks the fetched patch up by decoding the changed path's bytes to one character per
//! byte, so a path that is not ASCII never matches the patch it just fetched and is
//! reported as "no patch was requested for this path" — a false statement about the
//! caller's own request. This port joins the patch by the path's **raw bytes**, which is
//! the same answer for every ASCII path (every differential fixture uses one) and the
//! correct one for the rest. `a_non_ascii_path_still_finds_its_patch` pins it.

use refyard_contract::diff::{
    ChangeKind, DiffFile, DiffFileModes, DiffKind, DiffQuery, DiffRequest, DiffResponse, DiffStats,
    FilePatch, PatchHunk, PatchLine, PatchLineKind,
};
use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_core::parse::numstat::{parse_name_status, parse_numstat, NumstatEntry};
use refyard_core::parse::patch::{
    parse_patch, FilePatchBody, ParsePatchOptions, PATCH_MAX_BYTES_PER_FILE,
    PATCH_MAX_LINES_PER_FILE,
};
use refyard_core::parse::status::{parse_status, StatusRecordKind, STATUS_MAX_ENTRIES};
use refyard_core::plan::diff::{
    plan_diff_name_status, plan_diff_numstat, plan_diff_patch_for_path, DiffOptions,
};
use refyard_core::plan::status::{plan_status, StatusOptions};

use crate::paths::{to_display_path, PathRegistry};
use crate::providers::local::LocalGit;
use crate::reads::{parse_error, path_key, require_worktree, run_required, ReadError};
use crate::registry::RepositoryRecord;
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const NAME_STATUS_COMMAND: &str = "diff --name-status -z";
const NUMSTAT_COMMAND: &str = "diff --numstat -z";
const PATCH_COMMAND: &str = "diff patch for one path";
const STATUS_COMMAND: &str = "status --porcelain=v2 --branch -z";

/// Bound on how many files a single diff response may describe.
pub const DIFF_MAX_FILES: usize = 200;

/// Reads one diff.
pub async fn read_diff(
    git: &LocalGit,
    record: &RepositoryRecord,
    paths: &PathRegistry,
    snapshots: &SnapshotStore,
    query: &DiffQuery,
    read_at: &str,
) -> Result<DiffResponse, ReadError> {
    let worktree_id = require_worktree(record, query.worktree_id.as_deref())?;
    if let Some(max_bytes) = query.max_bytes {
        if max_bytes == 0 || max_bytes > PATCH_MAX_BYTES_PER_FILE as u64 {
            return Err(ReadError::problem(
                Problem::new(
                    ProblemCode::InvalidRequest,
                    format!("a patch bound is between 1 and {PATCH_MAX_BYTES_PER_FILE} bytes"),
                )
                .with_detail("maxBytes", DetailValue::Integer(max_bytes as i64)),
            ));
        }
    }
    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Diff,
        repository_id: &record.repository_id,
        worktree_id: Some(&worktree_id),
        tips: Vec::new(),
        head_oid: None,
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });
    // An id this registry never minted is refused rather than resolved by text: an id is
    // the only thing a caller may name, and it was bound to exact bytes.
    let requested: Option<Vec<u8>> = match &query.path_id {
        None => None,
        Some(path_id) => {
            let bytes = paths.resolve(path_id).ok_or_else(|| {
                ReadError::problem(
                    Problem::new(
                        ProblemCode::NotFound,
                        "that path id is unknown, or it belongs to a different worktree",
                    )
                    .with_detail("pathId", DetailValue::Text(path_id.clone())),
                )
            })?;
            if String::from_utf8(bytes.clone()).is_err() {
                return Err(ReadError::problem(
                    Problem::new(
                        ProblemCode::UnsupportedPathEncoding,
                        "this path's bytes cannot be represented exactly on this host, so it cannot be used as an input",
                    )
                    .with_detail("pathId", DetailValue::Text(path_id.clone())),
                ));
            }
            Some(bytes)
        }
    };
    let request = DiffRequest {
        kind: query.kind,
        oid: query.oid.clone(),
        from: query.from.clone(),
        to: query.to.clone(),
        path_id: query.path_id.clone(),
    };

    if query.kind == DiffKind::Untracked {
        return untracked_diff(
            git,
            record,
            paths,
            query,
            &worktree_id,
            &snapshot.snapshot_id,
            request,
            requested.as_deref(),
            read_at,
        )
        .await;
    }

    let args = diff_arguments(query)?;
    let directory = std::path::Path::new(record.location.canonical_worktree.as_str());
    let name_status_bytes = run_required(
        git,
        directory,
        &plan_diff_name_status(args.options()),
        NAME_STATUS_COMMAND,
    )
    .await?;
    let changes = parse_name_status(&name_status_bytes, Default::default())
        .map_err(|error| parse_error(NAME_STATUS_COMMAND, error))?;
    let numstat_bytes = run_required(
        git,
        directory,
        &plan_diff_numstat(args.options()),
        NUMSTAT_COMMAND,
    )
    .await?;
    let stats = parse_numstat(&numstat_bytes, Default::default())
        .map_err(|error| parse_error(NUMSTAT_COMMAND, error))?;
    // Join on the new path, which is the only stable identity a rename shares with its
    // numstat row.
    let stats_by_path: std::collections::HashMap<String, &NumstatEntry> = stats
        .iter()
        .map(|entry| (path_key(&entry.path), entry))
        .collect();

    let requested_text = requested
        .as_deref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
    let mut limitations: Vec<String> = Vec::new();
    let patch = match requested_text.as_deref() {
        None => None,
        Some(path_text) => {
            let bytes = run_required(
                git,
                directory,
                &plan_diff_patch_for_path(path_text, args.options()),
                PATCH_COMMAND,
            )
            .await?;
            let max_bytes = query
                .max_bytes
                .map(|value| value as usize)
                .unwrap_or(PATCH_MAX_BYTES_PER_FILE);
            let parsed = parse_patch(
                &bytes,
                ParsePatchOptions {
                    max_bytes: Some(max_bytes),
                    max_lines: Some(PATCH_MAX_LINES_PER_FILE),
                },
            )
            .map_err(|error| parse_error(PATCH_COMMAND, error))?;
            if parsed.truncated {
                limitations.push(format!(
                    "the patch for {path_text} was truncated by the size bound"
                ));
            }
            parsed.files.into_iter().next()
        }
    };

    let total = changes.len();
    let mut files: Vec<DiffFile> = Vec::with_capacity(total.min(DIFF_MAX_FILES));
    for change in changes.iter().take(DIFF_MAX_FILES) {
        let stat = stats_by_path.get(&path_key(&change.path)).copied();
        // Keyed by the requested path's bytes: the identity of the file the patch was
        // asked for, never a re-decode of it.
        let matched = match (&patch, &requested) {
            (Some(file), Some(bytes)) if bytes == &change.path => Some(file),
            _ => None,
        };
        let patch_dto = match matched {
            None => FilePatch::Unavailable {
                reason: "no patch was requested for this path".to_string(),
            },
            Some(file) => file_patch_dto(&file.body),
        };
        let is_binary = stat.map(|entry| entry.binary).unwrap_or(false);
        let is_submodule = matched
            .map(|file| matches!(file.body, FilePatchBody::Submodule { .. }))
            .unwrap_or(false);
        let modes = matched.map(|file| DiffFileModes {
            old: file.old_mode.clone(),
            new: file.new_mode.clone(),
        });
        files.push(DiffFile {
            path_id: paths.bind(&worktree_id, &change.path),
            display_path: to_display_path(&change.path).text,
            old_path_id: change
                .original_path
                .as_ref()
                .map(|bytes| paths.bind(&worktree_id, bytes)),
            old_display_path: change
                .original_path
                .as_ref()
                .map(|bytes| to_display_path(bytes).text),
            change_kind: change_kind_of(change.change_kind),
            is_binary,
            is_submodule,
            insertions: stat.and_then(|entry| entry.insertions),
            deletions: stat.and_then(|entry| entry.deletions),
            modes,
            patch: patch_dto,
        });
    }
    if total > files.len() {
        limitations.push(format!(
            "the change set has {total} files; the first {DIFF_MAX_FILES} are listed"
        ));
    }
    if requested.is_none() && !files.is_empty() {
        limitations.push(
            "patches are fetched per path; request one with pathId to see its patch".to_string(),
        );
    }
    Ok(complete(
        record,
        &worktree_id,
        read_at,
        &snapshot.snapshot_id,
        request,
        files,
        limitations,
    ))
}

/// Untracked files: no Git diff exists, so the content comes from the working tree.
#[allow(clippy::too_many_arguments)]
async fn untracked_diff(
    git: &LocalGit,
    record: &RepositoryRecord,
    paths: &PathRegistry,
    query: &DiffQuery,
    worktree_id: &str,
    snapshot_id: &str,
    request: DiffRequest,
    requested: Option<&[u8]>,
    read_at: &str,
) -> Result<DiffResponse, ReadError> {
    let directory = std::path::Path::new(record.location.canonical_worktree.as_str());
    let status_bytes = run_required(
        git,
        directory,
        &plan_status(StatusOptions {
            include_ignored: false,
            show_stash: false,
        }),
        STATUS_COMMAND,
    )
    .await?;
    let parsed = parse_status(&status_bytes, STATUS_MAX_ENTRIES)
        .map_err(|error| parse_error(STATUS_COMMAND, error))?;
    let untracked: Vec<&_> = parsed
        .records
        .iter()
        .filter(|entry| entry.kind == StatusRecordKind::Untracked)
        .collect();
    let targeted: Vec<&_> = match requested {
        None => untracked,
        Some(bytes) => untracked
            .into_iter()
            .filter(|entry| entry.path == bytes)
            .collect(),
    };

    let max_bytes = query
        .max_bytes
        .map(|value| value as usize)
        .unwrap_or(PATCH_MAX_BYTES_PER_FILE);
    let mut files: Vec<DiffFile> = Vec::with_capacity(targeted.len().min(DIFF_MAX_FILES));
    for entry in targeted.iter().take(DIFF_MAX_FILES) {
        let display = to_display_path(&entry.path);
        let patch = if !display.representable {
            SynthesizedPatch::Unavailable {
                reason: "the path cannot be represented exactly".to_string(),
            }
        } else {
            synthesize_untracked_patch(
                &record.location.canonical_worktree,
                &display.text,
                max_bytes,
            )
            .await
        };
        let hunks = match &patch {
            SynthesizedPatch::Text { hunks } => hunks.clone(),
            _ => Vec::new(),
        };
        files.push(DiffFile {
            path_id: paths.bind(worktree_id, &entry.path),
            display_path: display.text,
            old_path_id: None,
            old_display_path: None,
            change_kind: ChangeKind::Added,
            is_binary: matches!(patch, SynthesizedPatch::Binary),
            is_submodule: false,
            // An untracked file is entirely additions, and the hunk says how many lines
            // actually arrived.
            insertions: hunks.first().map(|hunk| hunk.new_lines.max(0) as u64),
            deletions: Some(0),
            modes: None,
            patch: synthesized_patch_dto(patch),
        });
    }
    let truncated = targeted.len() > files.len();
    Ok(complete(
        record,
        worktree_id,
        read_at,
        snapshot_id,
        request,
        files,
        if truncated {
            vec![format!(
                "the change set has {} untracked files; the first {DIFF_MAX_FILES} are listed",
                targeted.len()
            )]
        } else {
            Vec::new()
        },
    ))
}

/// Assembles a response from its files and the reasons a bound was reached.
fn complete(
    record: &RepositoryRecord,
    worktree_id: &str,
    read_at: &str,
    snapshot_id: &str,
    request: DiffRequest,
    files: Vec<DiffFile>,
    limitations: Vec<String>,
) -> DiffResponse {
    let insertions = files.iter().filter_map(|file| file.insertions).sum();
    let deletions = files.iter().filter_map(|file| file.deletions).sum();
    let binary_files = files.iter().filter(|file| file.is_binary).count() as u64;
    DiffResponse {
        snapshot_id: snapshot_id.to_string(),
        repository_id: record.repository_id.clone(),
        worktree_id: Some(worktree_id.to_string()),
        read_at: read_at.to_string(),
        request,
        stats: DiffStats {
            files_changed: files.len() as u64,
            insertions,
            deletions,
            binary_files,
        },
        truncated: !limitations.is_empty(),
        files,
    }
}

/// The `diff` arguments a request maps onto, owned so a borrowed planner input can be
/// derived at each call site.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffArguments {
    cached: bool,
    from: Option<String>,
    to: Option<String>,
}

impl DiffArguments {
    fn options(&self) -> DiffOptions<'_> {
        DiffOptions {
            cached: self.cached,
            from: self.from.as_deref(),
            to: self.to.as_deref(),
        }
    }
}

/// The `diff` arguments a request maps onto.
fn diff_arguments(query: &DiffQuery) -> Result<DiffArguments, ReadError> {
    match query.kind {
        DiffKind::Staged => Ok(DiffArguments {
            cached: true,
            from: None,
            to: None,
        }),
        DiffKind::Commit => {
            let Some(oid) = query.oid.as_deref() else {
                return Err(ReadError::problem(
                    Problem::new(
                        ProblemCode::GitCommandFailed,
                        "a commit diff requires an object name",
                    )
                    .with_detail("command", DetailValue::Text("diff".to_string())),
                ));
            };
            Ok(DiffArguments {
                cached: false,
                // `<oid>^!` is the commit against its first parent — Git's own shorthand,
                // so a root commit diffs against the empty tree rather than failing.
                from: Some(format!("{oid}^!")),
                to: None,
            })
        }
        DiffKind::Range => match (query.from.as_deref(), query.to.as_deref()) {
            (Some(from), Some(to)) => Ok(DiffArguments {
                cached: false,
                from: Some(from.to_string()),
                to: Some(to.to_string()),
            }),
            _ => Err(ReadError::problem(
                Problem::new(
                    ProblemCode::GitCommandFailed,
                    "a range diff requires both endpoints",
                )
                .with_detail("command", DetailValue::Text("diff".to_string())),
            )),
        },
        DiffKind::Unstaged | DiffKind::Untracked => Ok(DiffArguments {
            cached: false,
            from: None,
            to: None,
        }),
    }
}

/// Maps a parsed patch body onto the contract's `FilePatch`.
fn file_patch_dto(body: &FilePatchBody) -> FilePatch {
    match body {
        FilePatchBody::Text { hunks } => FilePatch::Text {
            hunks: hunks.iter().map(patch_hunk_dto).collect(),
            synthesized: false,
        },
        FilePatchBody::Binary => FilePatch::Binary,
        FilePatchBody::Submodule { old_oid, new_oid } => FilePatch::Submodule {
            old_oid: old_oid.clone(),
            new_oid: new_oid.clone(),
        },
        // A mode-only change has no lines; the file's `modes` carry the fact.
        FilePatchBody::ModeOnly { .. } => FilePatch::Text {
            hunks: Vec::new(),
            synthesized: false,
        },
        FilePatchBody::Unavailable { reason } => FilePatch::Unavailable {
            reason: reason.clone(),
        },
    }
}

fn patch_hunk_dto(hunk: &refyard_core::parse::patch::PatchHunk) -> PatchHunk {
    PatchHunk {
        header: hunk.header.clone(),
        old_start: hunk.old_start as i64,
        old_lines: hunk.old_lines as i64,
        new_start: hunk.new_start as i64,
        new_lines: hunk.new_lines as i64,
        lines: hunk
            .lines
            .iter()
            .map(|line| PatchLine {
                kind: match line.kind {
                    refyard_core::parse::patch::PatchLineKind::Context => PatchLineKind::Context,
                    refyard_core::parse::patch::PatchLineKind::Add => PatchLineKind::Add,
                    refyard_core::parse::patch::PatchLineKind::Remove => PatchLineKind::Remove,
                },
                text: line.text.clone(),
                no_newline: line.no_newline,
            })
            .collect(),
    }
}

fn synthesized_patch_dto(patch: SynthesizedPatch) -> FilePatch {
    match patch {
        SynthesizedPatch::Text { hunks } => FilePatch::Text {
            hunks,
            synthesized: true,
        },
        SynthesizedPatch::Binary => FilePatch::Binary,
        SynthesizedPatch::Oversize { reason } => FilePatch::Oversize { reason },
        SynthesizedPatch::Unavailable { reason } => FilePatch::Unavailable { reason },
    }
}

fn change_kind_of(kind: refyard_core::parse::numstat::ChangeKind) -> ChangeKind {
    match kind {
        refyard_core::parse::numstat::ChangeKind::Added => ChangeKind::Added,
        refyard_core::parse::numstat::ChangeKind::Modified => ChangeKind::Modified,
        refyard_core::parse::numstat::ChangeKind::Deleted => ChangeKind::Deleted,
        refyard_core::parse::numstat::ChangeKind::Renamed => ChangeKind::Renamed,
        refyard_core::parse::numstat::ChangeKind::Copied => ChangeKind::Copied,
        refyard_core::parse::numstat::ChangeKind::TypeChanged => ChangeKind::TypeChanged,
        refyard_core::parse::numstat::ChangeKind::Unmerged => ChangeKind::Unmerged,
    }
}

/// A patch built from a file's bytes, because Git has no diff for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SynthesizedPatch {
    Text { hunks: Vec<PatchHunk> },
    Binary,
    Oversize { reason: String },
    Unavailable { reason: String },
}

/// Builds a patch for an untracked file from its bytes.
///
/// The file is read only up to the bound; a larger file is reported as `oversize` instead
/// of being read in full, and content that is not valid UTF-8 is reported as `binary`,
/// because showing replacement characters in a diff would misrepresent the file.
pub async fn synthesize_untracked_patch(
    worktree_path: &str,
    relative_path: &str,
    max_bytes: usize,
) -> SynthesizedPatch {
    let Some(absolute) = join_relative(worktree_path, relative_path) else {
        return SynthesizedPatch::Unavailable {
            reason: "the path is outside the worktree".to_string(),
        };
    };
    let Ok(info) = tokio::fs::metadata(&absolute).await else {
        return SynthesizedPatch::Unavailable {
            reason: "the file could not be read".to_string(),
        };
    };
    if !info.is_file() {
        return SynthesizedPatch::Unavailable {
            reason: "not a regular file".to_string(),
        };
    }
    if info.len() > max_bytes as u64 {
        return SynthesizedPatch::Oversize {
            reason: format!("the file is {} bytes", info.len()),
        };
    }
    let Ok(bytes) = tokio::fs::read(&absolute).await else {
        return SynthesizedPatch::Unavailable {
            reason: "the file could not be read".to_string(),
        };
    };
    if bytes.contains(&0) {
        return SynthesizedPatch::Binary;
    }
    let display = to_display_path(&bytes);
    if !display.representable {
        return SynthesizedPatch::Binary;
    }
    SynthesizedPatch::Text {
        hunks: text_hunks(&display.text),
    }
}

/// The hunk an untracked file's text becomes.
///
/// The interesting cases are the ones a naive implementation gets wrong: an empty file is
/// a real state with no lines at all, and a file without a trailing newline must say so on
/// its last line or a diff would claim a newline the file does not have.
pub fn text_hunks(text: &str) -> Vec<PatchHunk> {
    let ends_with_newline = text.ends_with('\n');
    let body = if ends_with_newline {
        &text[..text.len() - 1]
    } else {
        text
    };
    let raw_lines: Vec<&str> = if body.is_empty() {
        Vec::new()
    } else {
        body.split('\n').collect()
    };
    let last = raw_lines.len().saturating_sub(1);
    let lines: Vec<PatchLine> = raw_lines
        .iter()
        .enumerate()
        .map(|(index, line)| PatchLine {
            kind: PatchLineKind::Add,
            text: (*line).to_string(),
            no_newline: !ends_with_newline && index == last,
        })
        .collect();
    if lines.is_empty() {
        return vec![PatchHunk {
            header: "@@ -0,0 +1,0 @@".to_string(),
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 0,
            lines: Vec::new(),
        }];
    }
    vec![PatchHunk {
        header: format!("@@ -0,0 +1,{} @@", lines.len()),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: lines.len() as i64,
        lines,
    }]
}

/// Joins a repository-relative path onto a worktree, refusing anything that is not
/// contained in it.
///
/// Git never reports an absolute path or a `..` component in a status record, so a path
/// that has one is not a path this read should read a file at — the check is what keeps a
/// crafted status record from turning a diff into a read of an arbitrary file.
pub fn join_relative(worktree_path: &str, relative_path: &str) -> Option<std::path::PathBuf> {
    let relative = std::path::Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }
    let joined = std::path::Path::new(worktree_path).join(relative);
    if !joined.starts_with(worktree_path) {
        return None;
    }
    Some(joined)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(kind: DiffKind) -> DiffQuery {
        DiffQuery {
            repository_id: "repo_1".to_string(),
            worktree_id: None,
            kind,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        }
    }

    #[test]
    fn an_empty_untracked_file_is_a_hunk_with_no_lines() {
        // An empty file is a real state; reporting it as "no change" would hide a file the
        // user just created.
        let hunks = text_hunks("");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].header, "@@ -0,0 +1,0 @@");
        assert!(hunks[0].lines.is_empty());
        assert_eq!(hunks[0].new_lines, 0);
    }

    #[test]
    fn a_file_without_a_trailing_newline_says_so_on_its_last_line() {
        // A diff that claimed a newline the file does not have is a wrong statement about
        // the content the user is about to stage.
        let hunks = text_hunks("one\ntwo");
        assert_eq!(hunks[0].header, "@@ -0,0 +1,2 @@");
        assert_eq!(hunks[0].lines.len(), 2);
        assert!(!hunks[0].lines[0].no_newline);
        assert!(hunks[0].lines[1].no_newline);
    }

    #[test]
    fn a_trailing_newline_does_not_add_a_line() {
        let hunks = text_hunks("one\ntwo\n");
        assert_eq!(hunks[0].new_lines, 2);
        assert!(!hunks[0].lines[1].no_newline);
    }

    #[test]
    fn a_carriage_return_stays_in_the_line() {
        // A CRLF file is a file whose lines end with `\r`; trimming it would show content
        // the file does not have.
        let hunks = text_hunks("one\r\ntwo\r\n");
        assert_eq!(hunks[0].lines[0].text, "one\r");
        assert_eq!(hunks[0].lines[1].text, "two\r");
    }

    #[test]
    fn a_single_line_is_one_addition() {
        let hunks = text_hunks("only");
        assert_eq!(hunks[0].new_lines, 1);
        assert_eq!(hunks[0].lines[0].text, "only");
        assert!(hunks[0].lines[0].no_newline);
    }

    #[test]
    fn a_relative_join_refuses_a_path_that_leaves_the_worktree() {
        // A `..` component in a status record must not become a read of a file outside
        // the repository the user approved.
        assert!(join_relative("/repo", "../secret").is_none());
        assert!(join_relative("/repo", "/etc/passwd").is_none());
        assert_eq!(
            join_relative("/repo", "src/a.txt"),
            Some(std::path::PathBuf::from("/repo/src/a.txt"))
        );
    }

    #[test]
    fn a_commit_diff_needs_an_object_name() {
        let error = diff_arguments(&query(DiffKind::Commit)).expect_err("refused");
        assert_eq!(error.to_problem().code, ProblemCode::GitCommandFailed);
    }

    #[test]
    fn a_commit_diff_uses_gits_own_first_parent_shorthand() {
        // `<oid>^!` is what makes a root commit diff against the empty tree instead of
        // failing on a missing parent.
        let mut request = query(DiffKind::Commit);
        request.oid = Some("abcdef".to_string());
        let options = diff_arguments(&request).expect("options");
        assert_eq!(options.from.as_deref(), Some("abcdef^!"));
        assert!(!options.cached);
    }

    #[test]
    fn a_range_diff_needs_both_endpoints() {
        let mut request = query(DiffKind::Range);
        request.from = Some("a".to_string());
        assert_eq!(
            diff_arguments(&request)
                .expect_err("refused")
                .to_problem()
                .code,
            ProblemCode::GitCommandFailed
        );
        request.to = Some("b".to_string());
        let options = diff_arguments(&request).expect("options");
        assert_eq!(options.from.as_deref(), Some("a"));
        assert_eq!(options.to.as_deref(), Some("b"));
    }

    #[test]
    fn a_staged_diff_compares_the_index_against_head() {
        let options = diff_arguments(&query(DiffKind::Staged)).expect("options");
        assert!(options.cached);
        assert_eq!(options.from, None);
    }

    #[test]
    fn an_unstaged_diff_compares_the_worktree_against_the_index() {
        let options = diff_arguments(&query(DiffKind::Unstaged)).expect("options");
        assert!(!options.cached);
        assert_eq!(options.from, None);
        assert_eq!(options.to, None);
    }
}
