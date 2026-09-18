//! Reading one file on the far side of an SSH connection, without a helper on that side.
//!
//! The remote host runs no Refyard artifact and no runtime, so the whole reader is one
//! fixed POSIX command: `sh -c <script> refyard-read <path> <worktree>`. The script — not
//! a caller — decides what is true there, and every value travels as a single-quoted
//! argument, so a path with a space, an apostrophe or a newline is one word rather than
//! syntax. There is no `eval`, no uploaded script, and nothing is read from a shell
//! profile.
//!
//! What the script checks is what the local reader checks, one `lstat` at a time: the
//! worktree is a directory and not a symlink, the file's parent directory is a directory
//! and not a symlink, the file itself is a symbolic link, a directory, missing, or not a
//! regular file — each answered with its own exit status so this side can report the
//! typed fact instead of "the command failed". The size bound is applied *there* as well,
//! with one byte of headroom: a file that grew after its size was read is caught by the
//! local output bound rather than being silently truncated.
//!
//! The SHA-256 of the content is computed here, over the bytes that arrived. Asking the
//! remote side for `sha256sum` (or Python) would make the fingerprint a statement by the
//! machine the repository is on, and a server without those programs would answer a
//! different question than the one the token binds.

use refyard_contract::problem::Problem;

use crate::files::{sniff_content_kind, FileRead, PREVIEW_MAX_BYTES, TEXT_SNIFF_BYTES};
use crate::process::{ExecutionState, RunOutcome};
use crate::providers::SshGit;
use crate::ssh::quote::quote_posix;

/// The exit statuses the script uses, so the mapping from an answer to a typed result
/// lives in one place instead of in a chain of string comparisons.
const EXIT_SYMLINK: i32 = 3;
const EXIT_DIRECTORY: i32 = 4;
const EXIT_MISSING: i32 = 5;
const EXIT_NOT_REGULAR: i32 = 6;
const EXIT_SIZE_UNKNOWN: i32 = 7;
const EXIT_OVERSIZE: i32 = 8;
const EXIT_WORKTREE_UNUSABLE: i32 = 10;
const EXIT_PARENT_UNUSABLE: i32 = 11;

/// The fixed reader script.
///
/// The whole script is one POSIX single-quoted word, which is why it contains no `'` of
/// its own: `$1` is the file's absolute remote path and `$2` the worktree root, both
/// supplied by this process after `quote_posix`. `set -f` disables pathname expansion, so
/// even an unquoted expansion could not turn a file name into a list.
const READER_SCRIPT: &str = "\
set -f\n\
p=$1\n\
r=$2\n\
[ -d \"$r\" ] || { printf \"worktree\\n\" >&2; exit 10; }\n\
[ -L \"$r\" ] && { printf \"worktree-link\\n\" >&2; exit 10; }\n\
d=${p%/*}\n\
[ -n \"$d\" ] || d=/\n\
[ -d \"$d\" ] || { printf \"parent\\n\" >&2; exit 11; }\n\
[ -L \"$d\" ] && { printf \"parent-link\\n\" >&2; exit 11; }\n\
[ -L \"$p\" ] && { printf \"symlink\\n\" >&2; exit 3; }\n\
[ -e \"$p\" ] || { printf \"missing\\n\" >&2; exit 5; }\n\
[ -d \"$p\" ] && { printf \"directory\\n\" >&2; exit 4; }\n\
[ -f \"$p\" ] || { printf \"special\\n\" >&2; exit 6; }\n\
s=$(wc -c < \"$p\") || { printf \"size\\n\" >&2; exit 7; }\n\
case $s in *[!0-9]*|\"\") printf \"size\\n\" >&2; exit 7 ;; esac\n\
[ \"$s\" -le 8388608 ] || { printf \"oversize:%s\\n\" \"$s\" >&2; exit 8; }\n\
head -c 8388609 \"$p\"\n";

/// The command string one remote read sends.
///
/// Built here and nowhere else, so every remote file read in this host goes through the
/// same template and the same quoting.
pub fn read_command(worktree: &str, relative: &str) -> Result<String, Problem> {
    let mut path = String::with_capacity(worktree.len() + relative.len() + 2);
    path.push_str(worktree.trim_end_matches('/'));
    path.push('/');
    path.push_str(relative);
    Ok(format!(
        "sh -c {} refyard-read {} {}",
        quote_posix(READER_SCRIPT)?,
        quote_posix(&path)?,
        quote_posix(worktree)?
    ))
}

/// Encodes the relative path bytes for the command string, or names why it cannot.
///
/// The SSH provider's command is one `String`, so a byte sequence that is not UTF-8 has
/// no encoding on the wire. Reporting that as `Unrepresentable` keeps it a fact about the
/// path instead of a mangled file name on the far side.
pub fn encode_relative(path_bytes: &[u8]) -> Result<String, FileRead> {
    if path_bytes.contains(&0) {
        return Err(FileRead::Unrepresentable);
    }
    match std::str::from_utf8(path_bytes) {
        Ok(text) => Ok(text.to_string()),
        Err(_) => Err(FileRead::Unrepresentable),
    }
}

/// Reads one file on the remote host, below its own worktree root.
///
/// `path_bytes` are the raw bytes a Git read reported; the worktree is the path the
/// repository was opened at, exactly as the far side spells it.
pub async fn read(ssh: &SshGit, worktree: &str, path_bytes: &[u8]) -> FileRead {
    let relative = match encode_relative(path_bytes) {
        Ok(relative) => relative,
        Err(unrepresentable) => return unrepresentable,
    };
    let command = match read_command(worktree, &relative) {
        Ok(command) => command,
        Err(problem) => {
            return FileRead::Failed {
                diagnostic: problem.message,
            }
        }
    };
    // One byte past the bound: a regular file whose size the script accepted but which
    // grew before it was read comes back cut, and a cut stream is *not* content.
    let outcome = ssh
        .run_raw_command(
            &command,
            PREVIEW_MAX_BYTES as usize + 1,
            crate::providers::local::STDERR_DIAGNOSTIC_MAX_BYTES,
        )
        .await;
    classify(&outcome)
}

/// Turns the script's exit status and streams into the typed result.
fn classify(outcome: &RunOutcome) -> FileRead {
    if outcome.state != ExecutionState::Completed {
        return FileRead::Failed {
            diagnostic: bounded(&outcome.stderr, "the remote read did not answer"),
        };
    }
    match outcome.exit_code {
        Some(0) => {
            if !outcome.output_complete {
                // The far side's bound and this one agree, so this is a file that grew
                // between the size check and the read: it is over the bound, not a short
                // read.
                return FileRead::Oversize { size_bytes: None };
            }
            let sniff = &outcome.stdout[..outcome.stdout.len().min(TEXT_SNIFF_BYTES)];
            FileRead::Bytes {
                content_kind: sniff_content_kind(sniff),
                bytes: outcome.stdout.clone(),
            }
        }
        Some(EXIT_SYMLINK) => FileRead::Symlink,
        Some(EXIT_DIRECTORY) => FileRead::Directory,
        Some(EXIT_MISSING) => FileRead::Missing,
        Some(EXIT_NOT_REGULAR) => FileRead::Other,
        Some(EXIT_OVERSIZE) => FileRead::Oversize {
            size_bytes: oversized_size(&outcome.stderr),
        },
        Some(EXIT_SIZE_UNKNOWN) => FileRead::Failed {
            diagnostic: "the remote read could not size the file".to_string(),
        },
        Some(EXIT_WORKTREE_UNUSABLE) => FileRead::Failed {
            diagnostic: "the remote worktree root is not a directory, or is a symbolic link"
                .to_string(),
        },
        Some(EXIT_PARENT_UNUSABLE) => FileRead::Failed {
            diagnostic: "the file's parent directory is not a directory, or is a symbolic link"
                .to_string(),
        },
        _ => FileRead::Failed {
            diagnostic: bounded(&outcome.stderr, "the remote read failed"),
        },
    }
}

/// The size the script printed with its `oversize` verdict, when it printed one.
fn oversized_size(stderr: &[u8]) -> Option<u64> {
    let text = String::from_utf8_lossy(stderr);
    text.lines()
        .find_map(|line| line.strip_prefix("oversize:"))
        .and_then(|value| value.trim().parse::<u64>().ok())
}

/// A bounded diagnostic for the wire, decoded leniently for a human to read.
fn bounded(stderr: &[u8], fallback: &str) -> String {
    let text = String::from_utf8_lossy(stderr).trim().to_string();
    if text.is_empty() {
        fallback.to_string()
    } else {
        text.chars().take(500).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::RunOutcome;
    use refyard_contract::problem::ProblemCode;

    fn completed(exit_code: i32, stdout: Vec<u8>, stderr: &str) -> RunOutcome {
        RunOutcome {
            state: ExecutionState::Completed,
            exit_code: Some(exit_code),
            stdout,
            stderr: stderr.as_bytes().to_vec(),
            output_complete: true,
            termination: None,
        }
    }

    #[test]
    fn the_command_is_one_fixed_script_with_every_value_quoted() {
        let command = read_command("/srv/a b", "x'y.txt").expect("encodable");
        assert!(command.starts_with("sh -c '"));
        assert!(command.contains("'\"'\"'"), "{command}");
        assert!(command.contains("refyard-read"));
        assert!(command.contains("8388608") && command.contains("8388609"));
        assert!(!command.contains("sha256sum") && !command.contains("python"));
    }

    #[test]
    fn a_path_that_cannot_travel_as_a_command_string_is_refused() {
        assert_eq!(
            encode_relative(b"bad\0name"),
            Err(FileRead::Unrepresentable)
        );
        assert_eq!(encode_relative(b"\xff\xfe"), Err(FileRead::Unrepresentable));
        assert_eq!(encode_relative(b"a.txt"), Ok("a.txt".to_string()));
        assert_eq!(
            read_command("/srv/repo", "bad\0name")
                .expect_err("NUL cannot be quoted")
                .code,
            ProblemCode::UnsupportedPathEncoding
        );
    }

    #[test]
    fn every_exit_status_maps_to_its_own_typed_result() {
        assert_eq!(
            classify(&completed(3, Vec::new(), "symlink\n")),
            FileRead::Symlink
        );
        assert_eq!(
            classify(&completed(4, Vec::new(), "directory\n")),
            FileRead::Directory
        );
        assert_eq!(
            classify(&completed(5, Vec::new(), "missing\n")),
            FileRead::Missing
        );
        assert_eq!(
            classify(&completed(6, Vec::new(), "special\n")),
            FileRead::Other
        );
        assert_eq!(
            classify(&completed(8, Vec::new(), "oversize:12345\n")),
            FileRead::Oversize {
                size_bytes: Some(12345)
            }
        );
        assert!(matches!(
            classify(&completed(10, Vec::new(), "worktree\n")),
            FileRead::Failed { .. }
        ));
        assert!(matches!(
            classify(&completed(255, Vec::new(), "ssh: connect failed\n")),
            FileRead::Failed { .. }
        ));
        match classify(&completed(0, b"alpha\n".to_vec(), "")) {
            FileRead::Bytes {
                bytes,
                content_kind,
            } => {
                assert_eq!(bytes, b"alpha\n");
                assert_eq!(content_kind, crate::files::ContentKind::Text);
            }
            other => panic!("{other:?}"),
        }
        // Exit 0 with a cut stream is a file over the bound, not short content.
        let mut cut = completed(0, vec![b'x'; 16], "");
        cut.output_complete = false;
        assert_eq!(classify(&cut), FileRead::Oversize { size_bytes: None });
    }
}
