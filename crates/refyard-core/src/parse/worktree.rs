//! Byte-oriented parser for `git worktree list --porcelain -z`.
//!
//! Git separates attributes with NUL and worktree blocks with an additional NUL.
//! Paths and lock/prune reasons stay as bytes because they can contain non-UTF-8
//! data, spaces, or newlines. ASCII metadata is decoded strictly.

use crate::bytes::{decode_ascii, is_object_name, split_nul_frames};
use crate::problem::CoreError;

const WORKTREE_LIST: &str = "worktree list --porcelain -z";

/// One linked worktree as reported by Git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRecord {
    /// Raw filesystem path bytes; not necessarily valid UTF-8.
    pub path_bytes: Vec<u8>,
    pub head_oid: Option<String>,
    /// Full ref name, for example `refs/heads/main`.
    pub branch_ref: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub lock_reason: Option<Vec<u8>>,
    pub prunable: bool,
    pub prune_reason: Option<Vec<u8>>,
}

#[derive(Default)]
struct WorktreeBuilder {
    path_bytes: Option<Vec<u8>>,
    head_oid: Option<String>,
    branch_ref: Option<String>,
    bare: bool,
    detached: bool,
    locked: bool,
    lock_reason: Option<Vec<u8>>,
    prunable: bool,
    prune_reason: Option<Vec<u8>>,
}

/// Parses `git worktree list --porcelain -z` output.
///
/// Unknown attributes are ignored so that a newer Git can add fields without
/// breaking reads. A malformed known field or block without a path is refused.
pub fn parse_worktree_list(bytes: &[u8]) -> Result<Vec<WorktreeRecord>, CoreError> {
    let frames = split_nul_frames(bytes, WORKTREE_LIST)?;
    let mut worktrees = Vec::new();
    let mut current: Option<WorktreeBuilder> = None;

    for frame in frames {
        if frame.is_empty() {
            flush_worktree(&mut current, &mut worktrees)?;
            continue;
        }

        let space_index = frame.iter().position(|byte| *byte == b' ');
        let keyword_end = space_index.unwrap_or(frame.len());
        let keyword = decode_ascii(&frame[..keyword_end], WORKTREE_LIST)?;
        let value = space_index.map(|index| &frame[index + 1..]);
        let worktree = current.get_or_insert_with(WorktreeBuilder::default);

        match keyword.as_str() {
            "worktree" => {
                let path = value.filter(|value| !value.is_empty()).ok_or_else(|| {
                    CoreError::output_unparsable(WORKTREE_LIST, "worktree attribute has no path")
                })?;
                worktree.path_bytes = Some(path.to_vec());
            }
            "HEAD" => {
                let oid = value.ok_or_else(|| {
                    CoreError::output_unparsable(WORKTREE_LIST, "HEAD attribute has no object name")
                })?;
                if !is_object_name(oid) {
                    return Err(CoreError::output_unparsable(
                        WORKTREE_LIST,
                        "expected a Git object name of 40 or 64 hex characters",
                    ));
                }
                worktree.head_oid = Some(decode_ascii(oid, WORKTREE_LIST)?);
            }
            "branch" => {
                let branch = value.ok_or_else(|| {
                    CoreError::output_unparsable(WORKTREE_LIST, "branch attribute has no ref")
                })?;
                worktree.branch_ref = Some(decode_ascii(branch, WORKTREE_LIST)?);
            }
            "bare" => worktree.bare = true,
            "detached" => worktree.detached = true,
            "locked" => {
                worktree.locked = true;
                worktree.lock_reason = value.map(<[u8]>::to_vec);
            }
            "prunable" => {
                worktree.prunable = true;
                worktree.prune_reason = value.map(<[u8]>::to_vec);
            }
            _ => {}
        }
    }

    flush_worktree(&mut current, &mut worktrees)?;
    Ok(worktrees)
}

fn flush_worktree(
    current: &mut Option<WorktreeBuilder>,
    worktrees: &mut Vec<WorktreeRecord>,
) -> Result<(), CoreError> {
    let Some(worktree) = current.take() else {
        return Ok(());
    };
    let path_bytes = worktree.path_bytes.ok_or_else(|| {
        CoreError::output_unparsable(WORKTREE_LIST, "worktree block has no `worktree` attribute")
    })?;
    worktrees.push(WorktreeRecord {
        path_bytes,
        head_oid: worktree.head_oid,
        branch_ref: worktree.branch_ref,
        bare: worktree.bare,
        detached: worktree.detached,
        locked: worktree.locked,
        lock_reason: worktree.lock_reason,
        prunable: worktree.prunable,
        prune_reason: worktree.prune_reason,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn parses_multiple_worktrees_and_preserves_path_and_reason_bytes() {
        let mut bytes = b"worktree /repo\0HEAD ".to_vec();
        bytes.extend_from_slice(OID.as_bytes());
        bytes.extend_from_slice(b"\0branch refs/heads/main\0\0worktree /tmp/odd\xff\npath\0HEAD ");
        bytes.extend_from_slice(OID.as_bytes());
        bytes.extend_from_slice(
            b"\0detached\0locked manually locked\nby user\0prunable stale\nmetadata\0\0",
        );
        let parsed = parse_worktree_list(&bytes).expect("valid worktree list");

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].path_bytes, b"/repo");
        assert_eq!(parsed[0].head_oid.as_deref(), Some(OID));
        assert_eq!(parsed[0].branch_ref.as_deref(), Some("refs/heads/main"));
        assert!(!parsed[0].bare);
        assert!(!parsed[0].detached);
        assert!(!parsed[0].locked);
        assert!(!parsed[0].prunable);

        assert_eq!(parsed[1].path_bytes, b"/tmp/odd\xff\npath");
        assert_eq!(parsed[1].head_oid.as_deref(), Some(OID));
        assert_eq!(parsed[1].branch_ref, None);
        assert!(parsed[1].detached);
        assert!(parsed[1].locked);
        assert_eq!(
            parsed[1].lock_reason.as_deref(),
            Some(&b"manually locked\nby user"[..])
        );
        assert!(parsed[1].prunable);
        assert_eq!(
            parsed[1].prune_reason.as_deref(),
            Some(&b"stale\nmetadata"[..])
        );
    }

    #[test]
    fn accepts_a_bare_worktree_without_head_or_branch() {
        let parsed = parse_worktree_list(b"worktree /bare\0bare\0\0").expect("bare list");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path_bytes, b"/bare");
        assert!(parsed[0].bare);
        assert_eq!(parsed[0].head_oid, None);
        assert_eq!(parsed[0].branch_ref, None);
    }

    #[test]
    fn rejects_incomplete_or_malformed_worktree_blocks() {
        assert!(parse_worktree_list(b"worktree /repo").is_err());
        assert!(parse_worktree_list(b"HEAD 0123\0").is_err());
        assert!(parse_worktree_list(b"worktree \0").is_err());
        assert!(parse_worktree_list(b"worktree /repo\0HEAD 0123\0").is_err());
    }

    #[test]
    fn ignores_unknown_attributes_and_accepts_an_empty_listing() {
        let mut bytes = b"worktree /repo\0future-attribute arbitrary value\0HEAD ".to_vec();
        bytes.extend_from_slice(OID.as_bytes());
        bytes.extend_from_slice(b"\0\0");

        let parsed = parse_worktree_list(&bytes).expect("unknown attribute is ignored");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path_bytes, b"/repo");
        assert!(parse_worktree_list(b"").expect("empty listing").is_empty());
    }
}
