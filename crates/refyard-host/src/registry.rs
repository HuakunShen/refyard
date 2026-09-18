//! Registration: which repositories this host may address, and what they are.
//!
//! A repository is identified by its **common Git directory**, not by the path the
//! user typed: two worktrees of one repository are one repository with two
//! worktrees, and a second clone of the same project is a different one. The path is
//! canonicalised once at registration, because every later command runs against the
//! canonical location and a symlinked path would otherwise mean two identities for
//! one repository.
//!
//! This module deliberately holds no policy about *whether* a path may be
//! registered — that belongs to whoever approves roots. It records what was
//! approved and hands out opaque ids.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use refyard_contract::problem::Problem;
use refyard_core::CoreError;

use crate::paths::{base36, to_display_path};
use crate::process::{run, ExecutionState, RunOutcome};
use crate::providers::ssh::SshGit;

/// Where a repository lives, in the terms the contract uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryLocation {
    pub target_id: String,
    pub target_generation: String,
    pub canonical_worktree: String,
    pub canonical_common_dir: String,
}

/// What `git rev-parse` reported about the layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryLayout {
    pub git_dir: String,
    /// Present only when the query asked for the top level.
    pub top_level: Option<String>,
    pub common_dir: String,
    pub is_bare: bool,
    pub object_format: String,
    pub is_shallow: bool,
}

/// One registered repository.
#[derive(Debug, Clone)]
pub struct RepositoryRecord {
    pub repository_id: String,
    pub allowed_root_id: String,
    pub worktree_id: String,
    pub display_name: String,
    pub display_path: String,
    /// The approved root the repository was registered under.
    pub root_path: PathBuf,
    /// Path relative to that root, as Git would spell it.
    pub relative_path: String,
    pub layout: RepositoryLayout,
    pub location: RepositoryLocation,
}

/// Parses the output of `plan_repository_layout`.
///
/// The line count is part of the format: `--show-toplevel` is refused outside a work
/// tree, so a bare-safe query answers five lines and a full query six. Accepting
/// either count for either query would read a half-printed answer as a complete one.
pub fn parse_repository_layout(
    bytes: &[u8],
    expect_top_level: bool,
) -> Result<RepositoryLayout, CoreError> {
    const FORMAT: &str = "rev-parse layout";
    let text = std::str::from_utf8(bytes)
        .map_err(|_| CoreError::output_unparsable(FORMAT, "layout output is not UTF-8"))?;
    let lines: Vec<&str> = text.lines().collect();
    let expected = if expect_top_level { 6 } else { 5 };
    if lines.len() != expected {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("expected {expected} layout lines but found {}", lines.len()),
        ));
    }
    let (top_level, rest) = if expect_top_level {
        (Some(lines[2].to_string()), &lines[3..])
    } else {
        (None, &lines[2..])
    };
    Ok(RepositoryLayout {
        git_dir: lines[0].to_string(),
        common_dir: lines[1].to_string(),
        top_level,
        is_bare: rest[0] == "true",
        object_format: if rest[1] == "sha256" {
            "sha256"
        } else {
            "sha1"
        }
        .to_string(),
        is_shallow: rest[2] == "true",
    })
}

/// How a repository finished being opened locally.
#[derive(Debug)]
pub enum OpenOutcome {
    Opened(Box<RepositoryRecord>),
    Failed(RunOutcome),
}

/// Builds the record for one repository from the layout that was read for it.
///
/// One builder for both transports: the layout query and the parser are the same on
/// either side of the wire, so the only thing a caller supplies is where it came from.
#[allow(clippy::too_many_arguments)]
pub fn build_record(
    layout: RepositoryLayout,
    directory: &str,
    repository_id: String,
    allowed_root_id: &str,
    root_path: &Path,
    relative_path: &str,
    target_id: &str,
    target_generation: &str,
) -> RepositoryRecord {
    let canonical_worktree = layout
        .top_level
        .clone()
        .unwrap_or_else(|| directory.to_string());
    let display = to_display_path(canonical_worktree.as_bytes());
    let display_name = Path::new(&canonical_worktree)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| canonical_worktree.clone());
    RepositoryRecord {
        repository_id,
        allowed_root_id: allowed_root_id.to_string(),
        worktree_id: "wt_1".to_string(),
        display_name,
        display_path: display.text,
        root_path: root_path.to_path_buf(),
        relative_path: relative_path.to_string(),
        layout,
        location: RepositoryLocation {
            target_id: target_id.to_string(),
            target_generation: target_generation.to_string(),
            canonical_worktree,
            canonical_common_dir: String::new(),
        },
    }
}

/// Opens one directory as a repository on a remote host.
///
/// The layout query is the same planner the local open runs, and the answer is parsed by
/// the same parser, so a remote repository becomes the same record a local one does. The
/// difference is that nothing here touches this machine's filesystem: the directory is a
/// remote path and the probe is a remote command, and a path this host cannot encode is
/// refused as the typed problem it is rather than as a failed local open.
pub async fn open_remote_repository(
    ssh: &SshGit,
    directory: &str,
    allowed_root_id: &str,
    root_path: &Path,
    target_id: &str,
    target_generation: &str,
    next_repository_id: &mut (dyn FnMut() -> String + Send),
) -> Result<Box<RepositoryRecord>, Problem> {
    let layout = ssh.open(directory).await?;
    Ok(Box::new(build_record(
        layout,
        directory,
        next_repository_id(),
        allowed_root_id,
        root_path,
        "",
        target_id,
        target_generation,
    )))
}

/// Runs the layout query for one directory and builds the record.
///
/// The bare-safe form is tried when the full query fails, because Git refuses
/// `--show-toplevel` in a bare repository *after* printing the paths it could
/// resolve — reading that partial output would give a repository with a missing top
/// level rather than an error.
/// Everything needed to open one directory as a repository.
pub struct OpenRequest<'a> {
    pub program: &'a Path,
    pub env: &'a [(String, String)],
    pub directory: &'a Path,
    pub allowed_root_id: &'a str,
    pub root_path: &'a Path,
    pub relative_path: &'a str,
    pub target_id: &'a str,
    /// The generation of the target this repository was approved on. Bound at open time,
    /// because a snapshot or cursor from an older generation must not be honoured after
    /// the target was re-established.
    pub target_generation: &'a str,
}

pub async fn open_repository(
    request: OpenRequest<'_>,
    // `Send` is part of the contract, not a convenience: the id is minted after the layout
    // query has answered, so this borrow lives across an await, and an async host that
    // requires `Send` futures — Tauri's IPC dispatcher, an axum handler — could not await
    // this function otherwise. A test's counter and the registry both satisfy it.
    next_repository_id: &mut (dyn FnMut() -> String + Send),
) -> OpenOutcome {
    let OpenRequest {
        program,
        env,
        directory,
        allowed_root_id,
        root_path,
        relative_path,
        target_id,
        target_generation,
    } = request;
    let spec = |omit_top_level: bool| crate::process::ProcessSpec {
        program: program.to_path_buf(),
        argv: refyard_core::plan::status::plan_repository_layout(omit_top_level).argv,
        stdin: Vec::new(),
        cwd: Some(directory.to_path_buf()),
        env: env.to_vec(),
        deadline: std::time::Duration::from_secs(15),
        stdout_limit: 1 << 20,
        stderr_limit: 1 << 16,
    };

    let mut build = |layout: RepositoryLayout| -> RepositoryRecord {
        build_record(
            layout,
            &directory.to_string_lossy(),
            next_repository_id(),
            allowed_root_id,
            root_path,
            relative_path,
            target_id,
            target_generation,
        )
    };

    let full = run(spec(false), None).await;
    if full.succeeded() {
        if let Ok(layout) = parse_repository_layout(&full.stdout, true) {
            return OpenOutcome::Opened(Box::new(build(layout)));
        }
    }

    // A bare repository refuses `--show-toplevel` after printing the paths it could
    // resolve, so the bare-safe question is asked before reporting a failure.
    let bare_safe = run(spec(true), None).await;
    if bare_safe.succeeded() {
        if let Ok(layout) = parse_repository_layout(&bare_safe.stdout, false) {
            return OpenOutcome::Opened(Box::new(build(layout)));
        }
    }

    // Report the reason the *requested* query failed, unless it never started.
    let failure = if full.state == ExecutionState::NotStarted {
        bare_safe
    } else {
        full
    };
    OpenOutcome::Failed(failure)
}

/// The set of registered repositories, keyed by their common Git directory.
#[derive(Debug, Default)]
pub struct RepositoryRegistry {
    inner: Mutex<RegistryState>,
}

#[derive(Debug, Default)]
struct RegistryState {
    next: u64,
    order: Vec<String>,
    by_id: HashMap<String, RepositoryRecord>,
    id_by_location: HashMap<String, String>,
}

/// The identity key of a repository: one common directory **on one target**.
///
/// The target is part of the key because `/srv/app` on a remote host and `/srv/app` on
/// this machine are two repositories, and one of them must never be answered with the
/// other's state.
fn location_key(target_id: &str, common_dir: &str) -> String {
    let mut key = String::with_capacity(target_id.len() + common_dir.len() + 1);
    key.push_str(target_id);
    // A separator neither input can contain: target ids come from a closed alphabet.
    key.push('\u{0}');
    key.push_str(common_dir);
    key
}

impl RepositoryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next repository id, spelled as the reference implementation spells it.
    pub fn next_id(&self) -> String {
        let mut state = self.inner.lock().expect("registry lock");
        state.next += 1;
        format!("repo_{}", base36(state.next))
    }

    /// Registers a record, returning the existing id when this repository on this build of
    /// the target is already known — re-registering it is not an error and must not mint a
    /// second identity.
    ///
    /// A record for the same location on a *different* target, or for a previous build of
    /// the same target, is a different repository: it is replaced, so reads and the path
    /// ids minted for the old build cannot be answered from the new one.
    pub fn register(&self, mut record: RepositoryRecord) -> RepositoryRecord {
        let mut state = self.inner.lock().expect("registry lock");
        let common = record.layout.common_dir.clone();
        let key = location_key(&record.location.target_id, &common);
        if let Some(existing) = state.id_by_location.get(&key).cloned() {
            if let Some(known) = state.by_id.get(&existing) {
                if known.location.target_generation == record.location.target_generation {
                    return known.clone();
                }
            }
            revoke_locked(&mut state, &existing);
        }
        record.location.canonical_common_dir = common;
        state
            .id_by_location
            .insert(key, record.repository_id.clone());
        state.order.push(record.repository_id.clone());
        state
            .by_id
            .insert(record.repository_id.clone(), record.clone());
        record
    }

    pub fn get(&self, repository_id: &str) -> Option<RepositoryRecord> {
        let state = self.inner.lock().expect("registry lock");
        state.by_id.get(repository_id).cloned()
    }

    pub fn list(&self) -> Vec<RepositoryRecord> {
        let state = self.inner.lock().expect("registry lock");
        state
            .order
            .iter()
            .filter_map(|id| state.by_id.get(id).cloned())
            .collect()
    }

    /// Removes one repository, or removes every repository on one target and returns how
    /// many were removed.
    pub fn revoke(&self, repository_id: &str) -> bool {
        let mut state = self.inner.lock().expect("registry lock");
        if !state.by_id.contains_key(repository_id) {
            return false;
        }
        revoke_locked(&mut state, repository_id);
        true
    }

    /// Removes every repository registered on `target_id`, returning their ids.
    ///
    /// Used when a target is disconnected: a repository on a closed target is not a
    /// repository this session can address any more, and keeping the record would let a
    /// later read answer from an executor that no longer exists.
    pub fn revoke_target(&self, target_id: &str) -> Vec<String> {
        let mut state = self.inner.lock().expect("registry lock");
        let doomed: Vec<String> = state
            .order
            .iter()
            .filter(|id| {
                state
                    .by_id
                    .get(*id)
                    .is_some_and(|record| record.location.target_id == target_id)
            })
            .cloned()
            .collect();
        for repository_id in &doomed {
            revoke_locked(&mut state, repository_id);
        }
        doomed
    }
}

/// Removes one repository and its location binding. The caller holds the lock.
fn revoke_locked(state: &mut RegistryState, repository_id: &str) {
    let Some(record) = state.by_id.remove(repository_id) else {
        return;
    };
    state.id_by_location.remove(&location_key(
        &record.location.target_id,
        &record.layout.common_dir,
    ));
    state.order.retain(|id| id != repository_id);
}

/// True when a run produced no usable answer at all.
pub fn is_not_started(outcome: &RunOutcome) -> bool {
    outcome.state == ExecutionState::NotStarted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_layout_with_a_top_level() {
        let bytes = b"/repo/.git\n/repo/.git\n/repo\nfalse\nsha1\nfalse\n";
        let layout = parse_repository_layout(bytes, true).expect("parses");
        assert_eq!(layout.top_level.as_deref(), Some("/repo"));
        assert!(!layout.is_bare);
        assert_eq!(layout.object_format, "sha1");
        assert!(!layout.is_shallow);
    }

    #[test]
    fn reads_a_bare_safe_layout_without_a_top_level() {
        let bytes = b"/repo.git\n/repo.git\ntrue\nsha1\nfalse\n";
        let layout = parse_repository_layout(bytes, false).expect("parses");
        assert_eq!(layout.top_level, None);
        assert!(layout.is_bare);
    }

    #[test]
    fn refuses_a_layout_with_the_wrong_line_count() {
        // A half-printed answer from a refused `--show-toplevel` must not be read as
        // a complete one.
        let bytes = b"/repo/.git\n/repo/.git\n/repo\n";
        assert!(parse_repository_layout(bytes, true).is_err());
        assert!(parse_repository_layout(bytes, false).is_err());
    }

    #[test]
    fn reports_a_sha256_repository_as_such() {
        let bytes = b"/repo/.git\n/repo/.git\n/repo\nfalse\nsha256\nfalse\n";
        let layout = parse_repository_layout(bytes, true).expect("parses");
        assert_eq!(layout.object_format, "sha256");
    }

    #[test]
    fn registering_the_same_common_dir_twice_keeps_one_identity() {
        let registry = RepositoryRegistry::new();
        let first = registry.register(fixture_record("repo_1", "/repo/.git"));
        let second = registry.register(fixture_record("repo_2", "/repo/.git"));
        assert_eq!(second.repository_id, first.repository_id);
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn the_same_path_on_two_targets_is_two_repositories() {
        // "/srv/app" on a remote host and "/srv/app" here are different repositories;
        // one must never be answered with the other's state.
        let registry = RepositoryRegistry::new();
        let local = registry.register(fixture_record("repo_1", "/srv/app/.git"));
        let mut remote = fixture_record("repo_2", "/srv/app/.git");
        remote.location.target_id = "tgt_ssh_1".to_string();
        let remote = registry.register(remote);
        assert_ne!(remote.repository_id, local.repository_id);
        assert_eq!(registry.list().len(), 2);
        assert_eq!(
            registry
                .get(&local.repository_id)
                .expect("local")
                .location
                .target_id,
            "tgt_local"
        );
        assert_eq!(
            registry
                .get(&remote.repository_id)
                .expect("remote")
                .location
                .target_id,
            "tgt_ssh_1"
        );
    }

    #[test]
    fn a_rebuilt_target_replaces_its_repository_identity() {
        // The rebuilt target is a different build: the old record must not stay
        // addressable, or a cursor minted for the old build would be answered by it.
        let registry = RepositoryRegistry::new();
        let before = registry.register(fixture_record("repo_1", "/repo/.git"));
        let mut rebuilt = fixture_record("repo_2", "/repo/.git");
        rebuilt.location.target_generation = "gen_2".to_string();
        let after = registry.register(rebuilt);
        assert_ne!(after.repository_id, before.repository_id);
        assert!(registry.get(&before.repository_id).is_none());
        assert_eq!(registry.list().len(), 1);
        assert_eq!(
            registry.list()[0].location.target_generation,
            "gen_2",
            "the surviving record is bound to the new build"
        );
    }

    #[test]
    fn disconnecting_a_target_revokes_its_repositories_and_no_others() {
        let registry = RepositoryRegistry::new();
        let local = registry.register(fixture_record("repo_1", "/a/.git"));
        let mut remote = fixture_record("repo_2", "/srv/b/.git");
        remote.location.target_id = "tgt_ssh_1".to_string();
        let remote = registry.register(remote);
        let removed = registry.revoke_target("tgt_ssh_1");
        assert_eq!(removed, vec![remote.repository_id.clone()]);
        assert!(registry.get(&remote.repository_id).is_none());
        assert!(registry.get(&local.repository_id).is_some());
    }

    #[test]
    fn revoking_removes_the_repository_and_its_common_dir_binding() {
        let registry = RepositoryRegistry::new();
        let registered = registry.register(fixture_record("repo_1", "/repo/.git"));
        assert!(registry.revoke(&registered.repository_id));
        assert!(registry.list().is_empty());
        // The common dir is free again, so the same repository can be registered
        // after the root is re-approved.
        let again = registry.register(fixture_record("repo_2", "/repo/.git"));
        assert_eq!(again.repository_id, "repo_2");
    }

    #[test]
    fn builds_the_same_record_from_the_same_layout_for_either_transport() {
        let layout =
            parse_repository_layout(b"/repo/.git\n/repo/.git\n/repo\nfalse\nsha1\nfalse\n", true)
                .expect("parses");
        let record = build_record(
            layout,
            "/repo",
            "repo_1".to_string(),
            "root_1",
            Path::new("/repo"),
            "",
            "tgt_local",
            "gen_1",
        );
        assert_eq!(record.display_name, "repo");
        assert_eq!(record.location.canonical_worktree, "/repo");
        assert_eq!(record.worktree_id, "wt_1");
    }

    #[test]
    fn a_bare_layout_keeps_the_directory_it_was_opened_at() {
        let layout = parse_repository_layout(b"/repo.git\n/repo.git\ntrue\nsha1\nfalse\n", false)
            .expect("parses");
        let record = build_record(
            layout,
            "/repo.git",
            "repo_1".to_string(),
            "root_1",
            Path::new("/repo.git"),
            "",
            "tgt_ssh_1",
            "gen_1",
        );
        assert_eq!(record.location.canonical_worktree, "/repo.git");
        assert_eq!(record.display_name, "repo.git");
    }

    fn fixture_record(id: &str, common_dir: &str) -> RepositoryRecord {
        RepositoryRecord {
            repository_id: id.to_string(),
            allowed_root_id: "root_1".to_string(),
            worktree_id: "wt_1".to_string(),
            display_name: "repo".to_string(),
            display_path: "/repo".to_string(),
            root_path: PathBuf::from("/"),
            relative_path: "repo".to_string(),
            layout: RepositoryLayout {
                git_dir: common_dir.to_string(),
                top_level: Some("/repo".to_string()),
                common_dir: common_dir.to_string(),
                is_bare: false,
                object_format: "sha1".to_string(),
                is_shallow: false,
            },
            location: RepositoryLocation {
                target_id: "tgt_local".to_string(),
                target_generation: "gen_1".to_string(),
                canonical_worktree: "/repo".to_string(),
                canonical_common_dir: String::new(),
            },
        }
    }
}
