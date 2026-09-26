//! Worktree inventory and host-only root projection.
//!
//! The public DTO follows Git's worktree listing, including paths that have not yet
//! been approved. Those rows are descriptive only. The separate root map is built from
//! live registry bindings and target-native path containment; it never derives access
//! from the display string returned to a UI.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{
    HeadKind, HeadState, WorkspaceRootId, WorktreeSummary, WorktreesResponse,
};
use refyard_core::plan::status::plan_worktree_list;

use crate::paths::to_display_path;
use crate::providers::GitExecutor;
use crate::reads::{parse_error, run_required, ReadError};
use crate::registry::{RepositoryRecord, RepositoryRegistry};
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const WORKTREE_LIST_COMMAND: &str = "worktree list --porcelain -z";
const WORKTREE_MAX_ENTRIES: usize = 1_024;

/// Host-only projection keyed by the exact worktree/root pair. Values are safe
/// root-relative display paths, not absolute paths and not authority inferred from a
/// display DTO.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreesWithRootBindings {
    pub response: WorktreesResponse,
    pub root_relative_paths: BTreeMap<(String, WorkspaceRootId), String>,
}

/// Reads the full source inventory and pairs it with only those root bindings that are
/// still present after the Git process returns. This final registry lookup means a root
/// retired while Git was running cannot leak a stale binding in the host-only result.
pub async fn read_worktrees_with_root_bindings(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    repositories: &RepositoryRegistry,
    snapshots: &SnapshotStore,
    read_at: &str,
) -> Result<WorktreesWithRootBindings, ReadError> {
    let output = run_required(
        runs,
        &record.location.canonical_worktree,
        &plan_worktree_list(),
        WORKTREE_LIST_COMMAND,
    )
    .await?;
    let worktrees = refyard_core::parse::worktree::parse_worktree_list(&output)
        .map_err(|error| parse_error(WORKTREE_LIST_COMMAND, error))?;
    if worktrees.len() > WORKTREE_MAX_ENTRIES {
        return Err(ReadError::problem(Problem::new(
            ProblemCode::LimitExceeded,
            format!(
                "the repository has more than {WORKTREE_MAX_ENTRIES} worktrees; no partial inventory was returned"
            ),
        )));
    }

    let mut worktree_rows = Vec::with_capacity(worktrees.len());
    let mut identities = Vec::with_capacity(worktrees.len());
    for (index, worktree) in worktrees.iter().enumerate() {
        let identity_path = identity_path(runs, &worktree.path_bytes).await;
        let canonical_key = || {
            identity_path
                .as_ref()
                .map(|path| native_path_bytes(path))
                .unwrap_or_else(|| worktree.path_bytes.clone())
        };
        // Registration stores Git's reported worktree path. On Windows, filesystem
        // canonicalization changes its spelling (for example to a \\?\ path), so the
        // canonical path remains for containment but cannot key the registry lookup.
        #[cfg(windows)]
        let path_key = if runs.is_remote() {
            canonical_key()
        } else {
            native_path_from_git_bytes(&worktree.path_bytes)
                .as_deref()
                .map(native_path_bytes)
                .unwrap_or_else(canonical_key)
        };
        #[cfg(not(windows))]
        let path_key = canonical_key();
        let worktree_id = repositories
            .worktree_id_for_path(&record.repository_id, &path_key)
            .ok_or_else(|| {
                ReadError::problem(Problem::new(
                    ProblemCode::NotFound,
                    format!(
                        "repository {} was retired during its worktree read",
                        record.repository_id
                    ),
                ))
            })?;
        let display_path = to_display_path(&worktree.path_bytes);
        let branch_name = worktree.branch_ref.as_deref().map(|branch_ref| {
            branch_ref
                .strip_prefix("refs/heads/")
                .unwrap_or(branch_ref)
                .to_string()
        });
        worktree_rows.push(WorktreeSummary {
            worktree_id: worktree_id.clone(),
            display_path: display_path.text,
            head: HeadState {
                kind: if worktree.head_oid.is_some() {
                    HeadKind::Born
                } else {
                    HeadKind::Unborn
                },
                branch_name,
                oid: worktree.head_oid.clone(),
                detached: worktree.detached,
            },
            is_main: index == 0,
            is_bare: worktree.bare,
            is_detached: worktree.detached,
            is_locked: worktree.locked,
            lock_reason: worktree
                .lock_reason
                .as_deref()
                .map(to_display_path)
                .map(|display| display.text),
            is_prunable: worktree.prunable,
        });
        identities.push((
            worktree_id,
            identity_path,
            display_path.representable,
            worktree.prunable,
        ));
    }

    // Re-read the aggregate after the async Git call. A root removed during the read is
    // absent here, so it can never be projected even though the source DTO is still an
    // accurate description of the Git listing that completed.
    let current = repositories.get(&record.repository_id).ok_or_else(|| {
        ReadError::problem(Problem::new(
            ProblemCode::NotFound,
            format!(
                "repository {} was retired during its worktree read",
                record.repository_id
            ),
        ))
    })?;
    let mut root_relative_paths = BTreeMap::new();
    for (worktree_id, identity_path, representable, prunable) in &identities {
        if !representable || *prunable {
            continue;
        }
        let Some(path) = identity_path.as_ref() else {
            continue;
        };
        let Some(registered) = current
            .worktrees
            .iter()
            .find(|registered| registered.worktree_id == *worktree_id)
        else {
            continue;
        };
        for binding in &registered.root_bindings {
            let relative = if runs.is_remote() {
                remote_relative_path(
                    &binding.root_path.to_string_lossy(),
                    &path.to_string_lossy(),
                )
            } else {
                local_relative_path(&binding.root_path, path)
            };
            let Some(relative) = relative else {
                continue;
            };
            let allowed_root_id = WorkspaceRootId::try_from(binding.allowed_root_id.clone())
                .map_err(|error| {
                    ReadError::problem(Problem::new(
                        ProblemCode::InternalError,
                        format!("registry contains an invalid workspace root id: {error}"),
                    ))
                })?;
            root_relative_paths.insert((worktree_id.clone(), allowed_root_id), relative);
        }
    }

    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Worktrees,
        repository_id: &current.repository_id,
        worktree_id: None,
        target_generation: &current.location.target_generation,
        tips: Vec::new(),
        head_oid: None,
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });
    Ok(WorktreesWithRootBindings {
        response: WorktreesResponse {
            snapshot_id: snapshot.snapshot_id,
            repository_id: current.repository_id,
            read_at: read_at.to_string(),
            worktrees: worktree_rows,
        },
        root_relative_paths,
    })
}

async fn identity_path(runs: &GitExecutor, path_bytes: &[u8]) -> Option<PathBuf> {
    if runs.is_remote() {
        let path = std::str::from_utf8(path_bytes).ok()?;
        return Some(PathBuf::from(path));
    }
    let native = native_path_from_git_bytes(path_bytes)?;
    tokio::fs::canonicalize(native).await.ok()
}

fn native_path_bytes(path: &Path) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect()
    }
    #[cfg(not(any(unix, windows)))]
    {
        path.to_string_lossy().as_bytes().to_vec()
    }
}

fn native_path_from_git_bytes(path_bytes: &[u8]) -> Option<PathBuf> {
    #[cfg(unix)]
    {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        Some(PathBuf::from(OsString::from_vec(path_bytes.to_vec())))
    }
    #[cfg(windows)]
    {
        Some(PathBuf::from(std::str::from_utf8(path_bytes).ok()?))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Some(PathBuf::from(std::str::from_utf8(path_bytes).ok()?))
    }
}

fn local_relative_path(root: &Path, worktree: &Path) -> Option<String> {
    let relative = worktree.strip_prefix(root).ok()?;
    let mut components = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => components.push(value.to_str()?.to_string()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(components.join("/"))
}

fn remote_relative_path(root: &str, worktree: &str) -> Option<String> {
    fn normalized(path: &str) -> Option<Vec<&str>> {
        if !path.starts_with('/') {
            return None;
        }
        let mut components: Vec<&str> = Vec::new();
        for component in path.split('/') {
            match component {
                "" | "." => {}
                ".." => {
                    components.pop()?;
                }
                _ => components.push(component),
            }
        }
        Some(components)
    }
    let root = normalized(root)?;
    let worktree = normalized(worktree)?;
    if worktree.len() < root.len() || worktree[..root.len()] != root {
        return None;
    }
    Some(worktree[root.len()..].join("/"))
}
