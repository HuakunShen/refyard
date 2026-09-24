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
