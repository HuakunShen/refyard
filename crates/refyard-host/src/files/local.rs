//! Reading one file on this machine.
//!
//! The reader is deliberately literal about what it finds. A `lstat` decides the kind
//! before anything is opened, so a symbolic link is reported as a link rather than
//! followed — the bytes behind a link belong to a name the caller was never shown. A
//! directory that holds another repository is reported as a submodule rather than as a
//! directory, because a "discard" on one of those means something different from a
//! discard on a file.
//!
//! Nothing here decides *whether* a path may be read: the caller resolved an authorised
//! path id into bytes before calling, and this module only turns those bytes into a
//! result. The read is bounded, because a fingerprint taken over a prefix of a file is a
//! fingerprint of something nobody asked about.

use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;

use crate::files::{sniff_content_kind, FileRead, PREVIEW_MAX_BYTES, TEXT_SNIFF_BYTES};

/// Reads one path below `worktree`, named by the raw bytes Git reported.
///
/// Blocking on purpose: the read is bounded (8 MiB at most) and the alternative — an
/// async read per path in a batch of a thousand — would add a state machine to a decision
/// that is a `lstat` and one `read`. The size is checked before the content is read, so a
/// path over the bound costs the metadata call and nothing else.
pub fn read(worktree: &Path, path_bytes: &[u8]) -> FileRead {
    if path_bytes.contains(&0) {
        // A NUL cannot travel through a POSIX path at all, so there is no file this could
        // name. Refusing here is what keeps the same check from being forgotten by every
        // caller.
        return FileRead::Unrepresentable;
    }
    let Some(relative) = os_str(path_bytes) else {
        return FileRead::Unrepresentable;
    };
    let absolute = worktree.join(relative);
    let metadata = match std::fs::symlink_metadata(&absolute) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return FileRead::Missing,
        Err(error) => {
            return FileRead::Failed {
                diagnostic: format!("{}: {error}", absolute.display()),
            }
        }
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return FileRead::Symlink;
    }
    if file_type.is_dir() {
        // A worktree directory holding `.git` is another repository's checkout: it is a
        // gitlink in the index, not a directory of this one.
        if absolute.join(".git").exists() {
            return FileRead::Submodule;
        }
        return FileRead::Directory;
    }
    if !file_type.is_file() {
        return FileRead::Other;
    }
    if metadata.len() > PREVIEW_MAX_BYTES {
        return FileRead::Oversize {
            size_bytes: Some(metadata.len()),
        };
    }
    let mut file = match std::fs::File::open(&absolute) {
        Ok(file) => file,
        Err(_) => return FileRead::Missing,
    };
    // One byte past the bound, so a file that grew between the metadata call and the read
    // is seen as oversized instead of being silently truncated to the bound.
    let mut bytes = Vec::with_capacity(metadata.len() as usize + 1);
    let mut limited = (&mut file).take(PREVIEW_MAX_BYTES + 1);
    if let Err(error) = limited.read_to_end(&mut bytes) {
        return FileRead::Failed {
            diagnostic: format!("{}: {error}", absolute.display()),
        };
    }
    if bytes.len() as u64 > PREVIEW_MAX_BYTES {
        return FileRead::Oversize { size_bytes: None };
    }
    let sniff = &bytes[..bytes.len().min(TEXT_SNIFF_BYTES)];
    FileRead::Bytes {
        content_kind: sniff_content_kind(sniff),
        bytes,
    }
}

/// Turns path bytes into an `OsStr`, when this platform can name a file with them.
///
/// A POSIX path is bytes, so on Unix this is the identity and a name that is not UTF-8 is
/// still a name. A platform whose filenames are UTF-16 cannot express those bytes, and
/// guessing a replacement character would address a different file — so it refuses.
#[cfg(unix)]
fn os_str(bytes: &[u8]) -> Option<&OsStr> {
    use std::os::unix::ffi::OsStrExt;
    Some(OsStr::from_bytes(bytes))
}

#[cfg(not(unix))]
fn os_str(bytes: &[u8]) -> Option<&OsStr> {
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(OsStr::new(text)),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worktree() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    #[test]
    fn reads_a_regular_file_whole() {
        let root = worktree();
        std::fs::write(root.path().join("a.txt"), b"alpha\n").expect("write");
        match read(root.path(), b"a.txt") {
            FileRead::Bytes {
                bytes,
                content_kind,
            } => {
                assert_eq!(bytes, b"alpha\n");
                assert_eq!(content_kind, crate::files::ContentKind::Text);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn refuses_a_path_it_cannot_name_before_touching_the_filesystem() {
        let root = worktree();
        assert_eq!(read(root.path(), b"bad\0name"), FileRead::Unrepresentable);
    }

    #[test]
    fn an_oversized_file_is_refused_by_its_size_and_not_truncated() {
        let root = worktree();
        let path = root.path().join("big.bin");
        let file = std::fs::File::create(&path).expect("create");
        file.set_len(PREVIEW_MAX_BYTES + 10).expect("size");
        drop(file);
        assert_eq!(
            read(root.path(), b"big.bin"),
            FileRead::Oversize {
                size_bytes: Some(PREVIEW_MAX_BYTES + 10)
            }
        );
    }
}
