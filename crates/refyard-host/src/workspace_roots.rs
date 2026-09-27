//! Durable identity for explicitly registered workspace roots.
//!
//! Root ids are identifiers, not permissions. The Xross owner-policy layer decides who may
//! use one; this registry only keeps target-local identities stable and never reissues an id.

use std::collections::HashSet;
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::WorkspaceRootId;
use serde::{Deserialize, Serialize};

const LEDGER_FILE: &str = "workspace-roots.v1.json";
const INITIALIZED_FILE: &str = ".workspace-roots.initialized";
const INITIALIZED_CONTENT: &[u8] = b"refyard workspace root ledger v1\n";
const LEDGER_VERSION: u32 = 1;
const MAX_LEDGER_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ACTIVE_ROOTS: usize = 4096;
const MAX_PATH_UNITS: usize = 32 * 1024;
const MAX_TARGET_FIELD_BYTES: usize = 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum RootKey {
    Local {
        target_id: String,
        canonical_path: PathBuf,
    },
    Remote {
        target_id: String,
        path: String,
    },
}

impl RootKey {
    pub(crate) fn display_path(&self) -> String {
        match self {
            Self::Local { canonical_path, .. } => canonical_path.to_string_lossy().into_owned(),
            Self::Remote { path, .. } => path.clone(),
        }
    }

    fn stored(&self) -> Result<StoredRootKey, Problem> {
        match self {
            Self::Local {
                target_id,
                canonical_path,
            } => {
                validate_target_id(target_id)?;
                #[cfg(unix)]
                {
                    use std::os::unix::ffi::OsStrExt;
                    let path = canonical_path.as_os_str().as_bytes().to_vec();
                    validate_path_length(path.len())?;
                    Ok(StoredRootKey::LocalBytes {
                        target_id: target_id.clone(),
                        path,
                    })
                }
                #[cfg(windows)]
                {
                    use std::os::windows::ffi::OsStrExt;
                    let path: Vec<u16> = canonical_path.as_os_str().encode_wide().collect();
                    validate_path_length(path.len())?;
                    Ok(StoredRootKey::LocalWide {
                        target_id: target_id.clone(),
                        path,
                    })
                }
                #[cfg(not(any(unix, windows)))]
                {
                    let _ = canonical_path;
                    Err(unavailable("native local path encoding is unsupported"))
                }
            }
            Self::Remote { target_id, path } => {
                validate_target_id(target_id)?;
                validate_path_length(path.len())?;
                Ok(StoredRootKey::Remote {
                    target_id: target_id.clone(),
                    path: path.clone(),
                })
            }
        }
    }

    fn from_stored(stored: StoredRootKey) -> Result<Self, Problem> {
        let key = match stored {
            #[cfg(unix)]
            StoredRootKey::LocalBytes { target_id, path } => {
                use std::os::unix::ffi::OsStringExt;
                validate_target_id(&target_id)?;
                validate_path_length(path.len())?;
                Self::Local {
                    target_id,
                    canonical_path: PathBuf::from(std::ffi::OsString::from_vec(path)),
                }
            }
            #[cfg(windows)]
            StoredRootKey::LocalWide { target_id, path } => {
                use std::os::windows::ffi::OsStringExt;
                validate_target_id(&target_id)?;
                validate_path_length(path.len())?;
                Self::Local {
                    target_id,
                    canonical_path: PathBuf::from(std::ffi::OsString::from_wide(&path)),
                }
            }
            StoredRootKey::Remote { target_id, path } => {
                validate_target_id(&target_id)?;
                validate_path_length(path.len())?;
                Self::Remote { target_id, path }
            }
            #[allow(unreachable_patterns)]
            _ => {
                return Err(unavailable(
                    "workspace root path encoding belongs to another OS",
                ))
            }
        };
        if let Self::Local { canonical_path, .. } = &key {
            if !canonical_path.is_absolute() {
                return Err(unavailable("stored local workspace root is not absolute"));
            }
        }
        Ok(key)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct RootState {
    epoch: String,
    next_sequence: u64,
    roots: Vec<(WorkspaceRootId, RootKey)>,
    ledger_path: Option<PathBuf>,
    poisoned: bool,
}

impl RootState {
    pub(crate) fn open(state_root: &Path) -> Result<Self, Problem> {
        let ledger_path = state_root.join(LEDGER_FILE);
        let initialized_path = state_root.join(INITIALIZED_FILE);
        let ledger_bytes = match read_regular_file(&ledger_path, MAX_LEDGER_BYTES) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(unavailable(format!(
                    "cannot read workspace root ledger {}: {error}",
                    ledger_path.display()
                )))
            }
        };
        let initialized_bytes = match read_regular_file(&initialized_path, 128) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(unavailable(format!(
                    "cannot read workspace root ledger marker {}: {error}",
                    initialized_path.display()
                )))
            }
        };

        if let Some(bytes) = ledger_bytes {
            let ledger: RootLedgerFile = serde_json::from_slice(&bytes).map_err(|error| {
                unavailable(format!(
                    "workspace root ledger {} is invalid: {error}",
                    ledger_path.display()
                ))
            })?;
            let state = Self::from_ledger(ledger, ledger_path.clone())?;
            if let Some(marker) = initialized_bytes {
                if marker != INITIALIZED_CONTENT {
                    return Err(unavailable("workspace root ledger marker is corrupt"));
                }
            } else {
                write_atomic(&initialized_path, INITIALIZED_CONTENT).map_err(|error| {
                    unavailable(format!(
                        "cannot publish workspace root ledger marker: {error}"
                    ))
                })?;
            }
            return Ok(state);
        }

        if initialized_bytes.is_some() {
            return Err(unavailable(
                "workspace root ledger is missing after initialization; refusing to reset its id sequence",
            ));
        }

        // A state directory created by an older Refyard build had no durable root IDs. A
        // fresh random epoch prevents its old process-local `root_1` values from colliding
        // with the first durable identities minted by this version.
        let state = Self::with_new_epoch(ledger_path)?;
        state.persist().map_err(|error| {
            unavailable(format!("cannot initialize workspace root ledger: {error}"))
        })?;
        write_atomic(&initialized_path, INITIALIZED_CONTENT).map_err(|error| {
            unavailable(format!(
                "cannot publish workspace root ledger marker: {error}"
            ))
        })?;
        Ok(state)
    }

    pub(crate) fn roots(&self) -> &[(WorkspaceRootId, RootKey)] {
        if self.poisoned {
            &[]
        } else {
            &self.roots
        }
    }

    pub(crate) fn approve(&mut self, key: RootKey) -> Result<WorkspaceRootId, Problem> {
        self.ensure_healthy()?;
        if let Some((id, _)) = self.roots.iter().find(|(_, existing)| existing == &key) {
            return Ok(id.clone());
        }
        if self.roots.len() >= MAX_ACTIVE_ROOTS || self.next_sequence == u64::MAX {
            return Err(unavailable("workspace root identity capacity is exhausted"));
        }

        let sequence = self.next_sequence + 1;
        let id = self.make_id(sequence)?;
        let mut next = self.clone();
        next.next_sequence = sequence;
        next.roots.push((id.clone(), key));
        if let Err(error) = next.persist() {
            self.poisoned = true;
            return Err(error);
        }
        *self = next;
        Ok(id)
    }

    pub(crate) fn retire(&mut self, id: &WorkspaceRootId) -> Result<(), Problem> {
        self.ensure_healthy()?;
        let Some(index) = self.roots.iter().position(|(active, _)| active == id) else {
            return Err(Problem::new(
                ProblemCode::NotFound,
                format!("unknown workspace root {}", id.as_str()),
            ));
        };
        let mut next = self.clone();
        next.roots.remove(index);
        if let Err(error) = next.persist() {
            self.poisoned = true;
            return Err(error);
        }
        *self = next;
        Ok(())
    }

    pub(crate) fn contains(&self, id: &WorkspaceRootId) -> Result<bool, Problem> {
        self.ensure_healthy()?;
        Ok(self.roots.iter().any(|(active, _)| active == id))
    }

    fn with_new_epoch(ledger_path: PathBuf) -> Result<Self, Problem> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|error| unavailable(format!("cannot mint workspace root epoch: {error}")))?;
        let epoch = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(Self {
            epoch,
            next_sequence: 0,
            roots: Vec::new(),
            ledger_path: Some(ledger_path),
            poisoned: false,
        })
    }

    fn from_ledger(ledger: RootLedgerFile, ledger_path: PathBuf) -> Result<Self, Problem> {
        if ledger.version != LEDGER_VERSION || !valid_epoch(&ledger.epoch) {
            return Err(unavailable(
                "workspace root ledger version or epoch is invalid",
            ));
        }
        if ledger.roots.len() > MAX_ACTIVE_ROOTS {
            return Err(unavailable(
                "workspace root ledger exceeds its root-count limit",
            ));
        }
        let mut roots = Vec::with_capacity(ledger.roots.len());
        let mut ids = HashSet::with_capacity(ledger.roots.len());
        let mut keys = HashSet::with_capacity(ledger.roots.len());
        for stored in ledger.roots {
            let id = WorkspaceRootId::try_from(stored.id.clone()).map_err(|error| {
                unavailable(format!(
                    "workspace root ledger contains an invalid id: {error}"
                ))
            })?;
            let sequence = sequence_for_id(&id, &ledger.epoch)
                .ok_or_else(|| unavailable("workspace root ledger id does not match its epoch"))?;
            if sequence == 0 || sequence > ledger.next_sequence || !ids.insert(id.clone()) {
                return Err(unavailable(
                    "workspace root ledger sequence is inconsistent",
                ));
            }
            let key = RootKey::from_stored(stored.key)?;
            if !keys.insert(key.clone()) {
                return Err(unavailable(
                    "workspace root ledger contains duplicate identities",
                ));
            }
            roots.push((id, key));
        }
        Ok(Self {
            epoch: ledger.epoch,
            next_sequence: ledger.next_sequence,
            roots,
            ledger_path: Some(ledger_path),
            poisoned: false,
        })
    }

    fn make_id(&self, sequence: u64) -> Result<WorkspaceRootId, Problem> {
        let suffix = if self.epoch.is_empty() {
            base36(sequence)
        } else {
            format!("{}_{}", self.epoch, base36(sequence))
        };
        WorkspaceRootId::try_from(format!("root_{suffix}"))
            .map_err(|error| unavailable(format!("cannot mint workspace root id: {error}")))
    }

    fn ensure_healthy(&self) -> Result<(), Problem> {
        if self.poisoned {
            return Err(unavailable(
                "workspace root ledger is uncertain; restart Refyard after repairing its state",
            ));
        }
        Ok(())
    }

    fn persist(&self) -> Result<(), Problem> {
        let Some(path) = &self.ledger_path else {
            return Ok(());
        };
        self.ensure_healthy()?;
        let mut roots = Vec::with_capacity(self.roots.len());
        for (id, key) in &self.roots {
            roots.push(StoredRoot {
                id: id.as_str().to_string(),
                key: key.stored()?,
            });
        }
        roots.sort_by(|left, right| left.id.cmp(&right.id));
        let ledger = RootLedgerFile {
            version: LEDGER_VERSION,
            epoch: self.epoch.clone(),
            next_sequence: self.next_sequence,
            roots,
        };
        let bytes = serde_json::to_vec(&ledger).map_err(|error| {
            unavailable(format!("cannot encode workspace root ledger: {error}"))
        })?;
        if bytes.len() as u64 > MAX_LEDGER_BYTES {
            return Err(unavailable("workspace root ledger exceeds its byte limit"));
        }
        write_atomic(path, &bytes).map_err(|error| {
            unavailable(format!(
                "cannot durably publish workspace root ledger: {error}"
            ))
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RootLedgerFile {
    version: u32,
    epoch: String,
    next_sequence: u64,
    roots: Vec<StoredRoot>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredRoot {
    id: String,
    key: StoredRootKey,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum StoredRootKey {
    #[cfg(unix)]
    LocalBytes {
        target_id: String,
        path: Vec<u8>,
    },
    #[cfg(windows)]
    LocalWide {
        target_id: String,
        path: Vec<u16>,
    },
    Remote {
        target_id: String,
        path: String,
    },
}

fn valid_epoch(epoch: &str) -> bool {
    epoch.len() == 32
        && epoch
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn sequence_for_id(id: &WorkspaceRootId, epoch: &str) -> Option<u64> {
    let suffix = id.as_str().strip_prefix("root_")?;
    let sequence = if epoch.is_empty() {
        suffix
    } else {
        let (id_epoch, sequence) = suffix.split_once('_')?;
        if id_epoch != epoch {
            return None;
        }
        sequence
    };
    parse_base36(sequence)
}

fn parse_base36(value: &str) -> Option<u64> {
    if value.is_empty() {
        return None;
    }
    value.bytes().try_fold(0u64, |value, byte| {
        let digit = match byte {
            b'0'..=b'9' => (byte - b'0') as u64,
            b'a'..=b'z' => (byte - b'a' + 10) as u64,
            _ => return None,
        };
        value.checked_mul(36)?.checked_add(digit)
    })
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut output = Vec::new();
    loop {
        output.push(DIGITS[(value % 36) as usize]);
        value /= 36;
        if value == 0 {
            break;
        }
    }
    output.reverse();
    String::from_utf8(output).expect("base36 digits are ASCII")
}

fn validate_target_id(target_id: &str) -> Result<(), Problem> {
    if target_id.is_empty()
        || target_id.len() > MAX_TARGET_FIELD_BYTES
        || target_id.chars().any(char::is_control)
    {
        return Err(unavailable(
            "workspace root ledger contains an invalid target identity",
        ));
    }
    Ok(())
}

fn validate_path_length(length: usize) -> Result<(), Problem> {
    if length == 0 || length > MAX_PATH_UNITS {
        return Err(unavailable("workspace root path exceeds its ledger limit"));
    }
    Ok(())
}

fn read_regular_file(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > limit
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "not a bounded regular file",
        ));
    }
    let bytes = fs::read(path)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file grew beyond its read limit",
        ));
    }
    Ok(bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root ledger has no parent",
        )
    })?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "workspace root ledger destination is not a regular file",
            ));
        }
    }

    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let mut temporary = None;
    let mut file = None;
    for _ in 0..64 {
        let serial = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.tmp.{}.{}", std::process::id(), serial));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(opened) => {
                temporary = Some(candidate);
                file = Some(opened);
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let temporary = temporary.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "no unique ledger temp name available",
        )
    })?;
    let result = (|| {
        let mut file = file.expect("temporary file created with its path");
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temporary, path)?;
        sync_parent(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn atomic_replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn atomic_replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(unix, windows)))]
fn atomic_replace(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic workspace root ledger replacement is unavailable",
    ))
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(windows)]
fn sync_parent(_: &Path) -> io::Result<()> {
    // `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` in `atomic_replace` flushes the move.
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn sync_parent(_: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "workspace root ledger directory sync is unavailable",
    ))
}

fn unavailable(message: impl Into<String>) -> Problem {
    Problem::new(ProblemCode::Unavailable, message.into())
}

#[cfg(test)]
mod tests {
    use super::{RootKey, RootState, LEDGER_FILE};

    #[test]
    fn remote_root_identity_is_stable_across_restarts_and_scoped_to_target() {
        let state_root = tempfile::tempdir().expect("state root");
        let mut roots = RootState::open(state_root.path()).expect("open ledger");
        let approve = |roots: &mut RootState, target: &str| {
            roots
                .approve(RootKey::Remote {
                    target_id: target.to_string(),
                    path: "/srv/project".to_string(),
                })
                .expect("approve remote root")
        };

        let first = approve(&mut roots, "target-a");
        let other_target = approve(&mut roots, "target-b");
        assert_ne!(first, other_target);

        drop(roots);
        let mut reopened = RootState::open(state_root.path()).expect("reopen ledger");
        assert_eq!(approve(&mut reopened, "target-a"), first);
    }

    #[test]
    fn missing_or_corrupt_initialized_ledger_fails_closed() {
        let missing_root = tempfile::tempdir().expect("state root");
        drop(RootState::open(missing_root.path()).expect("initialize ledger"));
        std::fs::remove_file(missing_root.path().join(LEDGER_FILE)).expect("remove ledger");
        assert!(RootState::open(missing_root.path()).is_err());

        let corrupt_root = tempfile::tempdir().expect("state root");
        drop(RootState::open(corrupt_root.path()).expect("initialize ledger"));
        std::fs::write(corrupt_root.path().join(LEDGER_FILE), b"{not-json")
            .expect("corrupt ledger");
        assert!(RootState::open(corrupt_root.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn local_root_identity_round_trips_non_utf8_native_path_bytes() {
        use std::os::unix::ffi::{OsStrExt, OsStringExt};

        let state_root = tempfile::tempdir().expect("state root");
        let repository_parent = tempfile::tempdir().expect("repository parent");
        let mut path_bytes = repository_parent.path().as_os_str().as_bytes().to_vec();
        path_bytes.extend_from_slice(b"/repo-\xff");
        let canonical_path = std::path::PathBuf::from(std::ffi::OsString::from_vec(path_bytes));
        let key = RootKey::Local {
            target_id: "target-local".to_string(),
            canonical_path,
        };

        let mut roots = RootState::open(state_root.path()).expect("open ledger");
        let id = roots.approve(key.clone()).expect("approve root");
        drop(roots);
        let mut reopened = RootState::open(state_root.path()).expect("reopen ledger");
        assert_eq!(reopened.approve(key).expect("same root"), id);
    }
}
