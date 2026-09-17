//! The local directory picker's read: one directory's subdirectories, and which of them
//! are repositories.
//!
//! This is the read behind the Browse control, so it answers the question a person is
//! asking — "what can I descend into from here, and what can I open" — rather than
//! listing a filesystem. Files are never listed, `.git` is never an entry, and a
//! directory is marked `repository` when it carries a `.git` marker, tested with `lstat`
//! because a linked worktree and a submodule have a `.git` *file* rather than a directory.
//!
//! Two properties are deliberate:
//!
//! - **the paths are paths, not display text.** A path returned here is offered back to
//!   `registerRepository`, so it has to be the path the filesystem has. A name whose bytes
//!   are not valid UTF-8 is reported with replacement characters, exactly as the Node host
//!   reports it, and such a directory is therefore not navigable from the picker — the same
//!   limitation the reference has, and a better one than handing back a path that looks
//!   right and cannot be opened.
//! - **the listing is bounded and says so.** At most 200 entries come back; a directory
//!   with more reports `truncated` instead of quietly dropping the rest. Which entries
//!   survive the cut is whatever the filesystem returned first, matching the reference: a
//!   truncated listing is a navigation aid that says it is incomplete, not a contract.

use std::path::{Path, PathBuf};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{FilesystemEntriesResponse, FilesystemEntry, FilesystemEntryKind};
use tokio::fs;

/// How many directory entries are inspected before the cut.
const SCAN_LIMIT: usize = 201;
/// How many entries may be returned. A picker is for choosing, not for listing a volume.
const ENTRY_LIMIT: usize = 200;

/// Expands the shorthand a person typed: `~` and `~/…` against the host's home directory.
///
/// Only those two forms, and only a leading one: `~user` and a `~` in the middle are left
/// alone so the result is refused as a non-absolute path rather than silently pointing at
/// something the person did not ask for.
pub fn expand_user_path(input: &str, home: &Path) -> String {
    let trimmed = input.trim();
    if trimmed == "~" {
        return home.to_string_lossy().into_owned();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home.join(rest).to_string_lossy().into_owned();
    }
    trimmed.to_string()
}

/// Reads one directory for the picker.
///
/// `requested` absent means the host's home directory, which is where a picker with no
/// history should start rather than at the filesystem root.
pub async fn read_filesystem_entries(
    requested: Option<&str>,
    home: &Path,
) -> Result<FilesystemEntriesResponse, Problem> {
    let asked = match requested {
        Some(path) => expand_user_path(path, home),
        None => home.to_string_lossy().into_owned(),
    };
    if !Path::new(&asked).is_absolute() {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "the path selector requires an absolute path or ~/ shorthand",
        ));
    }

    let canonical = fs::canonicalize(&asked).await.map_err(|_| {
        Problem::new(
            ProblemCode::NotFound,
            format!("the path selector directory does not exist: {asked}"),
        )
    })?;
    let metadata = fs::symlink_metadata(&canonical).await.map_err(|_| {
        Problem::new(
            ProblemCode::NotFound,
            format!("the path selector directory does not exist: {asked}"),
        )
    })?;
    if !metadata.is_dir() {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            format!("the path selector target is not a directory: {asked}"),
        ));
    }

    let mut listing = fs::read_dir(&canonical).await.map_err(|_| {
        Problem::new(
            ProblemCode::Forbidden,
            format!(
                "the path selector cannot read directory: {}",
                canonical.to_string_lossy()
            ),
        )
    })?;

    let mut inspected = 0usize;
    let mut entries: Vec<FilesystemEntry> = Vec::new();
    while let Ok(Some(child)) = listing.next_entry().await {
        if inspected == SCAN_LIMIT {
            break;
        }
        inspected += 1;
        if let Some(entry) = describe_entry(&child).await {
            entries.push(entry);
        }
    }

    entries.sort_by(|left, right| {
        let rank = |entry: &FilesystemEntry| match entry.kind {
            FilesystemEntryKind::Repository => 0,
            FilesystemEntryKind::Directory => 1,
        };
        rank(left)
            .cmp(&rank(right))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let truncated = inspected == SCAN_LIMIT || entries.len() > ENTRY_LIMIT;
    entries.truncate(ENTRY_LIMIT);

    Ok(FilesystemEntriesResponse {
        path: canonical.to_string_lossy().into_owned(),
        parent_path: canonical
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned()),
        entries,
        truncated,
    })
}

/// One directory entry, or `None` when a picker should not offer it.
///
/// Skipped: files, `.git`, a symlink that does not resolve to a directory, and a
/// directory that disappeared between the listing and this call. Each of those is a thing
/// a user cannot open as a repository, so offering it would be offering a failure.
async fn describe_entry(child: &fs::DirEntry) -> Option<FilesystemEntry> {
    let name = child.file_name().to_string_lossy().into_owned();
    if name == ".git" {
        return None;
    }
    let file_type = child.file_type().await.ok()?;
    if !file_type.is_dir() && !file_type.is_symlink() {
        return None;
    }

    let joined = child.path();
    let resolved = if file_type.is_symlink() {
        let target = fs::canonicalize(&joined).await.ok()?;
        if !fs::symlink_metadata(&target).await.ok()?.is_dir() {
            return None;
        }
        target
    } else {
        joined
    };

    // `symlink_metadata` rather than `metadata`: a linked worktree and a submodule keep a
    // `.git` file that points elsewhere, and both are repositories to open.
    let kind = match fs::symlink_metadata(resolved.join(".git")).await {
        Ok(_) => FilesystemEntryKind::Repository,
        Err(_) => FilesystemEntryKind::Directory,
    };

    Some(FilesystemEntry {
        name,
        path: resolved.to_string_lossy().into_owned(),
        kind,
    })
}

/// The home directory this host expands `~` against, taken from the environment it runs
/// Git with so a test fixture and the product agree on which home is meant.
pub fn home_from(environment: &[(String, String)]) -> Option<PathBuf> {
    environment
        .iter()
        .find(|(name, _)| name == "HOME")
        .map(|(_, value)| PathBuf::from(value))
}
