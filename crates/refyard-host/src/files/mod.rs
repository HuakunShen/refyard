//! Reading one file's bytes, locally or over SSH, as one typed result.
//!
//! A preview is only as good as the read behind it, and the read has exactly one job:
//! answer with the bytes that are at the path *right now*, or with the typed reason it
//! cannot. "It was a directory", "it was a symlink", "there is no such file" and "it is
//! larger than this host will read" are four different facts, and a single generic
//! failure would let a caller act as if it had seen a file it never read.
//!
//! Two rules are shared by both readers and are not negotiable:
//!
//! - **the bytes come from the target that owns the repository.** A local read opens a
//!   path below the worktree with this process's filesystem; a remote read sends one
//!   fixed POSIX command through the SSH provider and never touches a local path for a
//!   remote repository.
//! - **the fingerprint is computed here.** SHA-256 runs over the bytes that arrived, in
//!   this process. Asking the far side for a hash would be trusting a second
//!   implementation of "these are the bytes" — and a remote host with no `sha256sum` or
//!   Python would answer a different question than the one the token binds.

pub mod local;
pub mod preview;
pub mod remote;

use sha2::{Digest, Sha256};

use crate::providers::GitExecutor;

/// Reads one path through the provider that owns the repository.
///
/// The two arms are the two readers, and neither consults the other machine: a local
/// repository is read from this filesystem below the worktree it was opened at, and a
/// remote one is read by the SSH provider's fixed command on the far side. Every caller
/// that reads a path a write acts on goes through here, so a preview, a redemption and a
/// stage all have the same idea of what "the bytes at this path" means.
pub async fn read_through(executor: &GitExecutor, worktree: &str, path_bytes: &[u8]) -> FileRead {
    match executor {
        GitExecutor::Local(_) => local::read(std::path::Path::new(worktree), path_bytes),
        GitExecutor::Ssh(ssh) => remote::read(ssh, worktree, path_bytes).await,
    }
}

/// The most this host will read for one preview: `LIMITS.previewMaxBytes`-class bound,
/// stated here because a read that silently truncated would fingerprint a prefix.
pub const PREVIEW_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// How many bytes of a file are sniffed to decide whether it is text.
///
/// The same 8000 the reference reads, so the classification a UI shows cannot change
/// with the transport.
pub const TEXT_SNIFF_BYTES: usize = 8_000;

/// What kind of content a read found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    Text,
    Binary,
    /// Bytes that are not text *and* not a clean binary: not valid UTF-8, or a path that
    /// could not be addressed at all.
    Unrepresentable,
}

/// The result of reading one path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileRead {
    /// A regular file, within the bound, read whole.
    Bytes {
        bytes: Vec<u8>,
        content_kind: ContentKind,
    },
    /// There is no such file at that path, as the target sees it.
    Missing,
    /// The path is a directory.
    Directory,
    /// The path is a symbolic link. It is never followed: the bytes it points at belong
    /// to a name this caller was not shown.
    Symlink,
    /// The path is a directory that holds another repository — a Git submodule.
    Submodule,
    /// A device, socket, FIFO or anything else that is not a regular file.
    Other,
    /// The path's bytes cannot address a file on this reader: they contain NUL, or they
    /// are not a text the transport can carry.
    Unrepresentable,
    /// A regular file larger than [`PREVIEW_MAX_BYTES`]. `size_bytes` is absent when the
    /// size could not be read before the bound was hit.
    Oversize { size_bytes: Option<u64> },
    /// The reader could not answer at all — a connection that failed, or a far side that
    /// does not speak the command. It is not a statement about the file.
    Failed { diagnostic: String },
}

impl FileRead {
    /// The bytes, when this read produced content.
    pub fn bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Bytes { bytes, .. } => Some(bytes),
            _ => None,
        }
    }

    /// The bytes, taking ownership, when this read produced content.
    pub fn into_bytes(self) -> Option<Vec<u8>> {
        match self {
            Self::Bytes { bytes, .. } => Some(bytes),
            _ => None,
        }
    }

    /// What kind of content this is, in the contract's vocabulary.
    pub fn content_kind(&self) -> ContentKind {
        match self {
            Self::Bytes { content_kind, .. } => *content_kind,
            _ => ContentKind::Unrepresentable,
        }
    }

    /// How many bytes the path holds, when that is knowable.
    ///
    /// A file with no readable content has no size to report: `None` is the honest
    /// answer, and it is deliberately not `Some(0)` — a missing file is not empty.
    pub fn size_bytes(&self) -> Option<u64> {
        match self {
            Self::Bytes { bytes, .. } => Some(bytes.len() as u64),
            Self::Oversize { size_bytes } => *size_bytes,
            _ => None,
        }
    }

    /// Whether this read produced content a preview can bind.
    pub fn is_content(&self) -> bool {
        matches!(self, Self::Bytes { .. })
    }

    /// The SHA-256 of the bytes, or `None` when there are none.
    pub fn fingerprint_hex(&self) -> Option<String> {
        self.bytes().map(fingerprint_sha256)
    }

    /// The typed reason, as a short noun phrase.
    pub fn describe(&self) -> &'static str {
        match self {
            Self::Bytes { .. } => "a regular file",
            Self::Missing => "missing",
            Self::Directory => "a directory",
            Self::Symlink => "a symbolic link",
            Self::Submodule => "a submodule",
            Self::Other => "not a regular file",
            Self::Unrepresentable => "a path this host cannot address",
            Self::Oversize { .. } => "larger than this host will read",
            Self::Failed { .. } => "unreadable by the target",
        }
    }
}

/// SHA-256 of an in-memory buffer, as lowercase hex.
///
/// This is the only fingerprint implementation the host has: a preview token binds the
/// value this function produced from the bytes that arrived here.
pub fn fingerprint_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Classifies a prefix of content the way the reference does: a NUL byte means binary,
/// invalid UTF-8 means unrepresentable, and both are decided on the prefix so a large
/// read does not decode everything to answer a question about its first 8000 bytes.
///
/// The decode is strict, exactly as the reference's fatal decoder is: a prefix that ends
/// in the middle of a multi-byte sequence is reported as unrepresentable rather than
/// quietly rounded to text. Rounding would classify a file by a boundary this host chose
/// instead of by its bytes.
pub fn sniff_content_kind(prefix: &[u8]) -> ContentKind {
    if prefix.contains(&0) {
        return ContentKind::Binary;
    }
    match std::str::from_utf8(prefix) {
        Ok(_) => ContentKind::Text,
        Err(_) => ContentKind::Unrepresentable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fingerprint_is_sha256_of_the_bytes_and_not_of_the_path() {
        assert_eq!(
            fingerprint_sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(fingerprint_sha256(b"abc").len(), 64);
        assert_ne!(fingerprint_sha256(b"abc"), fingerprint_sha256(b"abd"));
    }

    #[test]
    fn content_kind_follows_the_prefix_rule() {
        assert_eq!(sniff_content_kind(b"plain text"), ContentKind::Text);
        assert_eq!(sniff_content_kind(b"with\0nul"), ContentKind::Binary);
        assert_eq!(sniff_content_kind("名".as_bytes()), ContentKind::Text);
        // A lone continuation byte is not text.
        assert_eq!(
            sniff_content_kind(b"\xff\xfe"),
            ContentKind::Unrepresentable
        );
        // A sequence cut by the sniff boundary is unrepresentable, which is what the
        // reference's fatal decoder answers too: the classification follows the bytes and
        // not a boundary this host chose.
        let mut truncated = vec![b'a'; TEXT_SNIFF_BYTES - 1];
        truncated.extend_from_slice(&"名".as_bytes()[..1]);
        assert_eq!(sniff_content_kind(&truncated), ContentKind::Unrepresentable);
    }

    #[test]
    fn a_missing_file_has_no_size_rather_than_a_zero() {
        // A missing file and an empty file are different facts; reporting 0 bytes for the
        // first would make a preview token bind content nobody read.
        assert_eq!(FileRead::Missing.size_bytes(), None);
        assert_eq!(FileRead::Unrepresentable.size_bytes(), None);
        assert!(!FileRead::Missing.is_content());
        assert_eq!(
            FileRead::Bytes {
                bytes: Vec::new(),
                content_kind: ContentKind::Text,
            }
            .size_bytes(),
            Some(0)
        );
    }
}
