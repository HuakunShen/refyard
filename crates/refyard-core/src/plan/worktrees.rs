//! Planners for linked worktrees: `git worktree add` in its three checkout forms.
//!
//! `add` never forces and never re-checks-out a branch that is already checked out
//! elsewhere — Git's own refusal is reported as-is. Each destination is an absolute
//! path built from an approved root plus a confined relative path; `--` before it keeps
//! a path from being read as a switch.

use super::branches::validated_ref_name;
use super::{DeadlineClass, GitPlan};
use crate::problem::CoreError;

/// An object id: 40 hex (SHA-1) or 64 hex (SHA-256). Never a fixed width assumed.
pub fn validated_oid(oid: &str) -> Result<(), CoreError> {
    if (oid.len() == 40 || oid.len() == 64) && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(CoreError::invalid_input(
            "an object id must be 40 or 64 hex characters",
        ))
    }
}

fn argv_tail(destination: &str) -> Result<Vec<String>, CoreError> {
    if destination.is_empty() || destination.as_bytes().contains(&0) {
        return Err(CoreError::invalid_input(
            "a worktree destination must be a non-empty path",
        ));
    }
    Ok(vec!["--".to_string(), destination.to_string()])
}

/// `git worktree add -- <destination> <branch>` — check out a branch that exists.
pub fn plan_worktree_add_existing(
    destination: &str,
    branch_name: &str,
) -> Result<GitPlan, CoreError> {
    validated_ref_name(branch_name)?;
    let mut argv = vec!["worktree".to_string(), "add".to_string()];
    argv.extend(argv_tail(destination)?);
    argv.push(branch_name.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git worktree add -b <branch> -- <destination> <startOid>` — create a branch at a
/// known commit and check it out.
pub fn plan_worktree_add_new_branch(
    destination: &str,
    branch_name: &str,
    start_oid: &str,
) -> Result<GitPlan, CoreError> {
    validated_ref_name(branch_name)?;
    validated_oid(start_oid)?;
    let mut argv = vec![
        "worktree".to_string(),
        "add".to_string(),
        "-b".to_string(),
        branch_name.to_string(),
    ];
    argv.extend(argv_tail(destination)?);
    argv.push(start_oid.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git worktree add --detach -- <destination> <oid>` — a detached worktree at a commit.
pub fn plan_worktree_add_detached(destination: &str, oid: &str) -> Result<GitPlan, CoreError> {
    validated_oid(oid)?;
    let mut argv = vec![
        "worktree".to_string(),
        "add".to_string(),
        "--detach".to_string(),
    ];
    argv.extend(argv_tail(destination)?);
    argv.push(oid.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// One worktree from `git worktree list --porcelain -z`: its raw path bytes and whether
/// it is locked. The path is bytes — a worktree path can be a POSIX byte path that is not
/// valid UTF-8, and it is the field a write addresses, so it is never decoded here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeEntry {
    pub path: Vec<u8>,
    pub locked: bool,
    /// The commit and branch the worktree holds — the recreation info a destructive remove
    /// reads as its backup before anything is destroyed.
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    /// The primary worktree (Git lists it first); never a remove's target.
    pub is_primary: bool,
}

/// A stable, host-derived worktree id: `wt_<fnv1a-64 of the canonical path bytes>`.
///
/// Deterministic from the path alone, so a read can mint it and a later write can resolve
/// it without a registry — the same worktree always maps to the same id. FNV-1a is not a
/// cryptographic hash; it only has to keep a handful of one repository's worktree paths
/// distinct, never to be one-way.
pub fn worktree_id_for_path(path: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("wt_{hash:016x}")
}

/// Parse `git worktree list --porcelain -z`. Attributes are NUL-terminated within a block
/// and an extra NUL separates blocks; `<key> <value>` splits on the first space (the value
/// may itself hold spaces, e.g. a lock reason). The first block is the primary worktree. A
/// frame that is not `<key>[ <value>]` is skipped rather than guessed at.
pub fn parse_worktree_list(bytes: &[u8]) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut path: Option<Vec<u8>> = None;
    let mut locked = false;
    let mut head_oid: Option<String> = None;
    let mut branch: Option<String> = None;
    for frame in bytes.split(|b| *b == 0) {
        if frame.is_empty() {
            if let Some(p) = path.take() {
                let is_primary = entries.is_empty();
                entries.push(WorktreeEntry {
                    path: p,
                    locked,
                    head_oid: head_oid.take(),
                    branch: branch.take(),
                    is_primary,
                });
            }
            locked = false;
            continue;
        }
        let (key, value) = match frame.iter().position(|b| *b == b' ') {
            Some(pos) => (&frame[..pos], Some(&frame[pos + 1..])),
            None => (frame, None),
        };
        if key == b"worktree" {
            path = value.map(|v| v.to_vec());
        } else if key == b"locked" {
            locked = true;
        } else if key == b"HEAD" {
            head_oid = value.map(|v| String::from_utf8_lossy(v).to_string());
        } else if key == b"branch" {
            branch = value.map(|v| String::from_utf8_lossy(v).to_string());
        }
    }
    if let Some(p) = path.take() {
        let is_primary = entries.is_empty();
        entries.push(WorktreeEntry {
            path: p,
            locked,
            head_oid,
            branch,
            is_primary,
        });
    }
    entries
}

/// `git worktree list --porcelain -z` — every worktree of this repository.
pub fn plan_worktree_list() -> GitPlan {
    GitPlan::read(vec![
        "worktree".to_string(),
        "list".to_string(),
        "--porcelain".to_string(),
        "-z".to_string(),
    ])
}

/// `git worktree lock [--reason=<r>] <path>`. The `=` spelling keeps a reason that
/// begins with `-` from being read as a switch. Never a `--force`.
pub fn plan_worktree_lock(path: &[u8], reason: Option<&str>) -> Result<GitPlan, CoreError> {
    if let Some(reason) = reason {
        if reason.bytes().any(|b| b < 0x20 || b == 0x7f) {
            return Err(CoreError::invalid_input(
                "a worktree lock reason must not contain control characters",
            ));
        }
    }
    let path = validated_worktree_path(path)?;
    let mut argv = vec!["worktree".to_string(), "lock".to_string()];
    if let Some(reason) = reason {
        argv.push(format!("--reason={reason}"));
    }
    argv.push(path);
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git worktree unlock <path>`.
pub fn plan_worktree_unlock(path: &[u8]) -> Result<GitPlan, CoreError> {
    let path = validated_worktree_path(path)?;
    Ok(GitPlan {
        argv: vec!["worktree".to_string(), "unlock".to_string(), path],
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git worktree remove <path>` — never forced. Git's own refusal (a dirty worktree, the
/// main worktree, a locked one) is reported as-is; this build never falls back to a
/// recursive delete and never passes `--force`.
pub fn plan_worktree_remove(path: &[u8]) -> Result<GitPlan, CoreError> {
    let path = validated_worktree_path(path)?;
    Ok(GitPlan {
        argv: vec!["worktree".to_string(), "remove".to_string(), path],
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// A worktree path as one argv field: non-empty and NUL-free (a NUL cannot be in argv).
fn validated_worktree_path(path: &[u8]) -> Result<String, CoreError> {
    if path.is_empty() || path.contains(&0) {
        return Err(CoreError::invalid_input(
            "a worktree path must be non-empty and NUL-free",
        ));
    }
    String::from_utf8(path.to_vec()).map_err(|_| {
        CoreError::invalid_input("a worktree path's bytes cannot be represented on this host")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "1111111111111111111111111111111111111111";

    #[test]
    fn an_object_id_is_40_or_64_hex_and_nothing_else() {
        assert!(validated_oid(OID).is_ok());
        assert!(validated_oid(&"a".repeat(64)).is_ok());
        assert!(validated_oid("abc").is_err());
        assert!(validated_oid(&"a".repeat(39)).is_err());
        assert!(validated_oid(&"z".repeat(40)).is_err());
    }

    #[test]
    fn the_three_add_forms_separate_their_operands_and_never_force() {
        assert_eq!(
            plan_worktree_add_existing("/root/wt", "feature")
                .expect("a plan")
                .argv,
            vec!["worktree", "add", "--", "/root/wt", "feature"]
        );
        assert_eq!(
            plan_worktree_add_new_branch("/root/wt", "feature", OID)
                .expect("a plan")
                .argv,
            vec!["worktree", "add", "-b", "feature", "--", "/root/wt", OID]
        );
        let plan = plan_worktree_add_detached("/root/wt", OID).expect("a plan");
        assert_eq!(
            plan.argv,
            vec!["worktree", "add", "--detach", "--", "/root/wt", OID]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        // A bad ref or object is refused before it becomes argv.
        assert!(plan_worktree_add_existing("/root/wt", "-bad").is_err());
        assert!(plan_worktree_add_detached("/root/wt", "nope").is_err());
    }
}

#[cfg(test)]
mod lock_tests {
    use super::*;

    #[test]
    fn a_worktree_id_is_deterministic_from_the_path() {
        let a = worktree_id_for_path(b"/repo/wt-one");
        assert!(a.starts_with("wt_"));
        assert_eq!(
            a,
            worktree_id_for_path(b"/repo/wt-one"),
            "stable for one path"
        );
        assert_ne!(
            a,
            worktree_id_for_path(b"/repo/wt-two"),
            "distinct paths differ"
        );
    }

    #[test]
    fn the_worktree_list_parses_paths_and_lock_state() {
        // Two blocks: the primary (unlocked) and a locked linked worktree whose reason
        // itself holds spaces. Blocks are separated by an extra NUL.
        let list = b"worktree /repo\0HEAD 1111\0branch refs/heads/main\0\0worktree /repo-wt\0HEAD 2222\0detached\0locked away for now\0\0";
        let entries = parse_worktree_list(list);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, b"/repo");
        assert!(!entries[0].locked);
        assert_eq!(entries[1].path, b"/repo-wt");
        assert!(entries[1].locked, "the locked flag is read");
    }

    #[test]
    fn the_worktree_list_carries_the_recreation_info() {
        let list = b"worktree /repo\0HEAD 1111\0branch refs/heads/main\0\0worktree /repo-wt\0HEAD 2222\0detached\0\0";
        let entries = parse_worktree_list(list);
        assert!(entries[0].is_primary, "the first block is the primary");
        assert_eq!(entries[0].head_oid.as_deref(), Some("1111"));
        assert_eq!(entries[0].branch.as_deref(), Some("refs/heads/main"));
        assert!(!entries[1].is_primary);
        assert_eq!(entries[1].head_oid.as_deref(), Some("2222"));
    }

    #[test]
    fn a_remove_names_one_path_and_is_never_forced() {
        assert_eq!(
            plan_worktree_remove(b"/repo-wt").expect("a plan").argv,
            vec!["worktree", "remove", "/repo-wt"]
        );
        assert!(plan_worktree_remove(b"").is_err());
    }

    #[test]
    fn a_lock_names_one_path_and_never_a_force() {
        assert_eq!(
            plan_worktree_lock(b"/repo-wt", Some("on ice"))
                .expect("a plan")
                .argv,
            vec!["worktree", "lock", "--reason=on ice", "/repo-wt"]
        );
        assert_eq!(
            plan_worktree_lock(b"/repo-wt", None).expect("a plan").argv,
            vec!["worktree", "lock", "/repo-wt"]
        );
        assert_eq!(
            plan_worktree_unlock(b"/repo-wt").expect("a plan").argv,
            vec!["worktree", "unlock", "/repo-wt"]
        );
        // A control character in the reason, or a path that cannot be argv, is refused.
        assert!(plan_worktree_lock(b"/repo-wt", Some("bad\nreason")).is_err());
        assert!(plan_worktree_unlock(b"").is_err());
    }
}
