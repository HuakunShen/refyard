//! Submodule facts from the selected worktree's config, index and checked-out child.

use std::collections::HashMap;
use std::path::Path;

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{SubmoduleState, SubmoduleSummary, SubmodulesResponse};
use refyard_core::parse::numstat::REF_LIST_MAX_ENTRIES;
use refyard_core::parse::submodules::{
    parse_config_entries, parse_ls_files_stage, parse_ls_tree, ConfigEntry, IndexEntry,
};
use refyard_core::plan::refs::{plan_ls_tree_entries, plan_submodule_config};
use refyard_core::plan::status::{plan_ls_files_stage, plan_repository_layout};

use crate::paths::{to_display_path, PathRegistry};
use crate::providers::GitExecutor;
use crate::reads::{parse_error, read_head_state, run_meaningful_exit, run_required, ReadError};
use crate::registry::{parse_repository_layout, RepositoryRecord};
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const CONFIG_COMMAND: &str = "config --file .gitmodules --get-regexp";
const INDEX_COMMAND: &str = "ls-files --stage -z";
const TREE_COMMAND: &str = "ls-tree -z";
const CONFIG_TREE_BATCH_SIZE: usize = 32;

#[derive(Default)]
struct ConfiguredSubmodule {
    name: String,
    path: Option<Vec<u8>>,
    url: Option<String>,
    branch: Option<String>,
}

/// Reads submodules from the selected worktree; the response is a bounded snapshot.
pub async fn read_submodules(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    paths: &PathRegistry,
    snapshots: &SnapshotStore,
    read_at: &str,
) -> Result<SubmodulesResponse, ReadError> {
    let config_plan = plan_submodule_config();
    let config_bytes = run_meaningful_exit(
        runs,
        &record.location.canonical_worktree,
        &config_plan,
        CONFIG_COMMAND,
        &[1],
    )
    .await?;
    let (config_entries, config_truncated) = match config_bytes {
        Some(bytes) => {
            let parsed = parse_config_entries(&bytes, REF_LIST_MAX_ENTRIES)
                .map_err(|error| parse_error(CONFIG_COMMAND, error))?;
            (parsed.entries, parsed.truncated)
        }
        None => (Vec::new(), false),
    };

    let index_bytes = run_required(
        runs,
        &record.location.canonical_worktree,
        &plan_ls_files_stage(),
        INDEX_COMMAND,
    )
    .await?;
    let index = parse_ls_files_stage(&index_bytes, REF_LIST_MAX_ENTRIES)
        .map_err(|error| parse_error(INDEX_COMMAND, error))?;
    let gitlinks = deduplicate_gitlinks(index.entries.into_iter().filter(|entry| entry.gitlink));
    let configured = configured_submodules(config_entries);
    validate_local_submodule_urls(runs, record, &configured, &gitlinks)?;
    let head = read_head_state(runs, record).await?;
    let recorded = match head.oid.as_deref() {
        Some(head_oid) => read_recorded_gitlinks(runs, record, head_oid, &configured).await?,
        None => RecordedGitlinks {
            oids: HashMap::new(),
            truncated: false,
        },
    };

    let mut truncated = config_truncated || index.truncated || recorded.truncated;
    let mut rows = Vec::with_capacity(configured.len().min(REF_LIST_MAX_ENTRIES));
    let mut used_paths = Vec::with_capacity(configured.len());
    for submodule in &configured {
        if rows.len() == REF_LIST_MAX_ENTRIES {
            truncated = true;
            break;
        }
        let path = submodule.path.clone().unwrap_or_default();
        if !safe_relative_path(&path) {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::Forbidden,
                "a configured submodule path is not a safe repository-relative path",
            )));
        }
        let display = to_display_path(&path);
        let path_text = std::str::from_utf8(&path).ok();
        let url = submodule.url.clone().unwrap_or_default();
        if !url.is_empty() {
            if let Some(reason) = unsafe_remote_url_reason(&url) {
                return Err(ReadError::problem(Problem::new(
                    ProblemCode::GitCommandFailed,
                    format!(
                        "submodule {} has an unsafe configured URL: {reason}",
                        submodule.name
                    ),
                )));
            }
        }
        let branch = submodule.branch.clone();
        validate_display_limits(&submodule.name, &url, branch.as_deref())?;
        let index_oid = gitlinks
            .iter()
            .find(|entry| entry.path == path)
            .map(|entry| entry.oid.clone());
        let recorded_oid = recorded.oids.get(&path).cloned();
        let actual_oid = if let Some(path_text) = path_text {
            read_actual_oid(runs, record, path_text).await?
        } else {
            None
        };
        let path_id = paths.bind(
            &record.worktree_id,
            &record.location.target_generation,
            &path,
        );
        rows.push(SubmoduleSummary {
            name: submodule.name.clone(),
            path_id,
            display_path: display.text,
            state: submodule_state(
                actual_oid.as_deref(),
                index_oid.as_deref(),
                recorded_oid.as_deref(),
            ),
            recorded_oid,
            index_oid,
            actual_oid,
            url_display: crate::reads::refs::redact_remote_url(&url),
            branch_name: branch,
            submodule_repository_id: None,
        });
        used_paths.push(path);
    }

    for gitlink in gitlinks {
        if used_paths.iter().any(|path| path == &gitlink.path) {
            continue;
        }
        if rows.len() == REF_LIST_MAX_ENTRIES {
            truncated = true;
            break;
        }
        let display = to_display_path(&gitlink.path);
        let path_id = paths.bind(
            &record.worktree_id,
            &record.location.target_generation,
            &gitlink.path,
        );
        rows.push(SubmoduleSummary {
            name: display.text.clone(),
            path_id,
            display_path: display.text,
            recorded_oid: None,
            index_oid: Some(gitlink.oid),
            actual_oid: None,
            state: SubmoduleState::Unknown,
            url_display: String::new(),
            branch_name: None,
            submodule_repository_id: None,
        });
    }

    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Submodules,
        repository_id: &record.repository_id,
        worktree_id: Some(&record.worktree_id),
        target_generation: &record.location.target_generation,
        tips: Vec::new(),
        head_oid: head.oid,
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });
    Ok(SubmodulesResponse {
        snapshot_id: snapshot.snapshot_id,
        repository_id: record.repository_id.clone(),
        worktree_id: record.worktree_id.clone(),
        read_at: read_at.to_string(),
        submodules: rows,
        truncated,
    })
}

struct RecordedGitlinks {
    oids: HashMap<Vec<u8>, String>,
    truncated: bool,
}

async fn read_recorded_gitlinks(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    head_oid: &str,
    configured: &[ConfiguredSubmodule],
) -> Result<RecordedGitlinks, ReadError> {
    let mut oids = HashMap::new();
    let mut truncated = false;
    let mut paths = Vec::new();
    for submodule in configured {
        let Some(path) = submodule.path.as_deref() else {
            continue;
        };
        if !safe_relative_path(path) {
            continue;
        }
        if let Ok(path) = std::str::from_utf8(path) {
            paths.push(path.to_string());
        }
    }
    for batch in paths.chunks(CONFIG_TREE_BATCH_SIZE) {
        let plan = plan_ls_tree_entries(head_oid, batch)
            .map_err(|error| parse_error(TREE_COMMAND, error))?;
        let bytes = run_required(
            runs,
            &record.location.canonical_worktree,
            &plan,
            TREE_COMMAND,
        )
        .await?;
        let parsed = parse_ls_tree(&bytes, batch.len().saturating_add(1))
            .map_err(|error| parse_error(TREE_COMMAND, error))?;
        truncated |= parsed.truncated;
        for entry in parsed.entries {
            if entry.mode == "160000" && entry.object_type == "commit" {
                oids.insert(entry.path, entry.oid);
            }
        }
    }
    Ok(RecordedGitlinks { oids, truncated })
}

async fn read_actual_oid(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    relative_path: &str,
) -> Result<Option<String>, ReadError> {
    let Some(directory) = safe_submodule_directory(runs, record, relative_path) else {
        return Ok(None);
    };
    let layout_bytes = match run_required(
        runs,
        &directory,
        &plan_repository_layout(false),
        "rev-parse submodule layout",
    )
    .await
    {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    let layout = match parse_repository_layout(&layout_bytes, true) {
        Ok(layout) => layout,
        Err(_) => return Ok(None),
    };
    if layout.top_level.as_deref() != Some(directory.as_str()) {
        // An uninitialized submodule directory discovers its parent repository. Do not
        // report the parent's HEAD as the child's actual object name.
        return Ok(None);
    }
    let mut child = record.clone();
    child.location.canonical_worktree = directory;
    child.location.canonical_common_dir = layout.common_dir.clone();
    child.layout = layout;
    match read_head_state(runs, &child).await {
        Ok(head) => Ok(head.oid),
        Err(_) => Ok(None),
    }
}

fn safe_submodule_directory(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    relative_path: &str,
) -> Option<String> {
    if !safe_relative_path(relative_path.as_bytes()) {
        return None;
    }
    match runs {
        GitExecutor::Local(_) => {
            let root = std::fs::canonicalize(&record.root_path).ok()?;
            let candidate = Path::new(&record.location.canonical_worktree).join(relative_path);
            let candidate = std::fs::canonicalize(candidate).ok()?;
            if !candidate.starts_with(root) {
                return None;
            }
            candidate.to_str().map(str::to_string)
        }
        GitExecutor::Ssh(_) => {
            let base = record.location.canonical_worktree.trim_end_matches('/');
            let candidate = format!("{base}/{relative_path}");
            let root = record.root_path.to_str()?;
            if posix_path_within(root, &candidate) {
                Some(candidate)
            } else {
                None
            }
        }
    }
}

fn configured_submodules(entries: Vec<ConfigEntry>) -> Vec<ConfiguredSubmodule> {
    let mut result: Vec<ConfiguredSubmodule> = Vec::new();
    let mut index_by_name = HashMap::new();
    for entry in entries {
        let Some(section) = entry.key.strip_prefix("submodule.") else {
            continue;
        };
        let Some((name, key)) = section.rsplit_once('.') else {
            continue;
        };
        if name.is_empty() || !matches!(key, "path" | "url" | "branch") {
            continue;
        }
        let index = match index_by_name.get(name).copied() {
            Some(index) => index,
            None => {
                let index = result.len();
                result.push(ConfiguredSubmodule {
                    name: name.to_string(),
                    ..ConfiguredSubmodule::default()
                });
                index_by_name.insert(name.to_string(), index);
                index
            }
        };
        let submodule = &mut result[index];
        match key {
            "path" => submodule.path = Some(entry.value),
            "url" => submodule.url = Some(decode_latin1(&entry.value)),
            "branch" => submodule.branch = Some(decode_latin1(&entry.value)),
            _ => unreachable!(),
        }
    }
    result
        .into_iter()
        .filter(|entry| {
            entry.path.as_ref().is_some_and(|path| !path.is_empty()) || entry.url.is_some()
        })
        .collect()
}

fn deduplicate_gitlinks(entries: impl Iterator<Item = IndexEntry>) -> Vec<IndexEntry> {
    let mut result: Vec<IndexEntry> = Vec::new();
    for entry in entries {
        if let Some(existing) = result.iter_mut().find(|known| known.path == entry.path) {
            *existing = entry;
        } else {
            result.push(entry);
        }
    }
    result
}

fn safe_relative_path(path: &[u8]) -> bool {
    !path.is_empty()
        && !path.starts_with(b"/")
        && !path.contains(&0)
        && !path.contains(&b'\\')
        && path
            .split(|byte| *byte == b'/')
            .all(|part| !part.is_empty() && part != b"." && part != b"..")
}

fn posix_path_within(root: &str, candidate: &str) -> bool {
    let Some(root) = normalize_posix_absolute_path(root) else {
        return false;
    };
    let Some(candidate) = normalize_posix_absolute_path(candidate) else {
        return false;
    };
    if root == "/" {
        return true;
    }
    let root = root.trim_end_matches('/');
    candidate == root || candidate.starts_with(&format!("{root}/"))
}

fn normalize_posix_absolute_path(value: &str) -> Option<String> {
    if !value.starts_with('/') || is_windows_absolute(value) {
        return None;
    }
    let mut components = Vec::new();
    for component in value.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                components.pop();
            }
            component => components.push(component),
        }
    }
    Some(format!("/{}", components.join("/")))
}

fn validate_local_submodule_urls(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    configured: &[ConfiguredSubmodule],
    gitlinks: &[IndexEntry],
) -> Result<(), ReadError> {
    for submodule in configured {
        let Some(url) = submodule.url.as_deref() else {
            continue;
        };
        if !is_absolute_local_path(url) {
            continue;
        }
        let Some(path) = submodule.path.as_deref() else {
            continue;
        };
        if gitlinks.iter().any(|gitlink| gitlink.path == path) {
            continue;
        }
        let inside_root = match runs {
            GitExecutor::Local(_) => local_absolute_path_within_root(record, url),
            // SSH targets do not expose a filesystem canonicalizer through the Git port.
            // Compare normalized POSIX paths and fail closed for paths we cannot prove.
            GitExecutor::Ssh(_) => record
                .root_path
                .to_str()
                .is_some_and(|root| posix_path_within(root, url)),
        };
        if !inside_root {
            return Err(ReadError::problem(Problem::new(
                ProblemCode::Forbidden,
                "a submodule URL points outside the approved root; approve its directory before using it",
            )));
        }
    }
    Ok(())
}

fn is_absolute_local_path(value: &str) -> bool {
    value.starts_with('/') || is_windows_absolute(value)
}

fn local_absolute_path_within_root(record: &RepositoryRecord, value: &str) -> bool {
    let path = Path::new(value);
    if !path.is_absolute() {
        // A Windows path on a non-Windows local target cannot be authorized against
        // this target's root, and is deliberately treated as external.
        return false;
    }
    let Ok(root) = std::fs::canonicalize(&record.root_path) else {
        return false;
    };
    let Some(candidate) = canonicalize_existing_ancestor(path) else {
        return false;
    };
    candidate.starts_with(root)
}

fn canonicalize_existing_ancestor(path: &Path) -> Option<std::path::PathBuf> {
    let mut unresolved = Vec::new();
    let mut ancestor = path;
    loop {
        match std::fs::canonicalize(ancestor) {
            Ok(canonical) => {
                let mut result = canonical;
                for component in unresolved.iter().rev() {
                    result.push(component);
                }
                return Some(result);
            }
            Err(_) => {
                unresolved.push(ancestor.file_name()?.to_os_string());
                ancestor = ancestor.parent()?;
            }
        }
    }
}

fn unsafe_remote_url_reason(value: &str) -> Option<&'static str> {
    if value.is_empty() {
        return Some("must not be empty");
    }
    if value.encode_utf16().count() > 2048 {
        return Some("must not exceed 2048 characters");
    }
    if value.starts_with('-') {
        return Some("must not start with '-' (it would be read as an option)");
    }
    if value.contains("::") {
        return Some("transport helper syntax is not accepted");
    }
    if value.chars().any(|ch| ch <= '\u{20}' || ch == '\u{7f}') {
        return Some("must not contain control characters or spaces");
    }
    if value.starts_with('/') || is_windows_absolute(value) || is_scp_like(value) {
        return None;
    }
    if value.starts_with("https://") || value.starts_with("ssh://") {
        return None;
    }
    Some("only https:// and ssh:// URLs, scp-like remotes, or absolute local paths are accepted")
}

fn is_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
        || (bytes.len() >= 3
            && matches!(bytes[0], b'\\' | b'/')
            && matches!(bytes[1], b'\\' | b'/')
            && bytes[2] > b' ')
}

fn is_scp_like(value: &str) -> bool {
    let Some((user, destination)) = value.split_once('@') else {
        return false;
    };
    let Some((host, path)) = destination.split_once(':') else {
        return false;
    };
    !user.is_empty()
        && user
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~%+-".contains(&byte))
        && !host.is_empty()
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        && !path.is_empty()
}

fn validate_display_limits(name: &str, url: &str, branch: Option<&str>) -> Result<(), ReadError> {
    if name.encode_utf16().count() > 1024
        || url.encode_utf16().count() > 2048
        || branch.is_some_and(|branch| branch.encode_utf16().count() > 255)
    {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::LimitExceeded,
            "a submodule config value exceeds the source contract's display limit",
        )));
    }
    Ok(())
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}

fn submodule_state(
    actual_oid: Option<&str>,
    index_oid: Option<&str>,
    recorded_oid: Option<&str>,
) -> SubmoduleState {
    if index_oid.is_none() && recorded_oid.is_none() {
        return SubmoduleState::Unknown;
    }
    let Some(actual_oid) = actual_oid else {
        return SubmoduleState::Uninitialized;
    };
    if index_oid.is_some_and(|index_oid| index_oid != actual_oid)
        || recorded_oid.is_some_and(|recorded_oid| recorded_oid != actual_oid)
    {
        return SubmoduleState::OutOfSync;
    }
    SubmoduleState::Initialized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_submodule_url_containment_normalizes_parent_segments() {
        assert!(posix_path_within(
            "/approved/root",
            "/approved/root/modules/../child"
        ));
        assert!(!posix_path_within(
            "/approved/root",
            "/approved/root-escape/child"
        ));
        assert!(!posix_path_within(
            "/approved/root",
            "/approved/root/../../outside"
        ));
        assert!(posix_path_within("/", "/outside"));
    }
}
