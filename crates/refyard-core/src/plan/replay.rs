//! Planners for the writes that replay or move history: cherry-pick, revert, reset.
//!
//! Cherry-pick and revert share the merge's lifecycle — start, stop into a sequencer
//! state, continue or abort — so their planners are the merge family's with
//! `CHERRY_PICK_HEAD` / `REVERT_HEAD` deciding a stop. `--no-edit` everywhere: the
//! message is the original's or Git's own, no editor is ever started, and no `-m` is
//! ever guessed, which is also what makes Git refuse a merge commit whose parent choice
//! this build does not make.
//!
//! Reset plans only the two modes that cannot lose content: `--soft` moves the branch
//! with the index untouched, `--mixed` moves branch and index, and every byte stays in
//! the working tree or the object store. `--hard` is planned by nothing in this build.

use crate::problem::CoreError;

use super::{merge::validated_source_oid, DeadlineClass, GitPlan};

/// `git cherry-pick --no-edit <oid>` — applies the commit's change as a new commit.
pub fn plan_cherry_pick(oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    Ok(hooked(vec![
        "cherry-pick".to_string(),
        "--no-edit".to_string(),
        oid.to_string(),
    ]))
}

/// `git rev-parse --verify --quiet CHERRY_PICK_HEAD` — is a cherry-pick stopped?
pub fn plan_cherry_pick_in_progress() -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        "CHERRY_PICK_HEAD".to_string(),
    ])
}

/// `git cherry-pick --abort` — the only way back from a stopped pick.
pub fn plan_cherry_pick_abort() -> GitPlan {
    hooked(vec!["cherry-pick".to_string(), "--abort".to_string()])
}

/// `git revert --no-edit <oid>` — Git's own revert message, the user's hooks in force.
pub fn plan_revert_commit(oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    Ok(hooked(vec![
        "revert".to_string(),
        "--no-edit".to_string(),
        oid.to_string(),
    ]))
}

/// `git rev-parse --verify --quiet REVERT_HEAD` — is a revert stopped mid-way?
pub fn plan_revert_in_progress() -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        "REVERT_HEAD".to_string(),
    ])
}

/// `git revert --abort` — restore the state the revert started from.
pub fn plan_revert_abort() -> GitPlan {
    hooked(vec!["revert".to_string(), "--abort".to_string()])
}

/// `git reset --soft|--mixed <oid>` — the branch moves, the working tree does not.
///
/// The hook class is this build's longest write deadline: reset rewrites the index in
/// place, which on a huge checkout is not fast even though no hook ever runs.
pub fn plan_reset_branch(oid: &str, soft: bool) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    let flag = if soft { "--soft" } else { "--mixed" };
    Ok(hooked(vec![
        "reset".to_string(),
        flag.to_string(),
        oid.to_string(),
    ]))
}

fn hooked(argv: Vec<String>) -> GitPlan {
    GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn a_pick_and_a_revert_are_no_edit_with_the_object_name_last() {
        assert_eq!(
            plan_cherry_pick(OID).expect("a plan").argv,
            vec!["cherry-pick", "--no-edit", OID]
        );
        assert_eq!(
            plan_revert_commit(OID).expect("a plan").argv,
            vec!["revert", "--no-edit", OID]
        );
    }

    #[test]
    fn the_probes_read_the_sequencer_markers_through_git() {
        assert_eq!(
            plan_cherry_pick_in_progress().argv,
            vec!["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]
        );
        assert_eq!(
            plan_revert_in_progress().argv,
            vec!["rev-parse", "--verify", "--quiet", "REVERT_HEAD"]
        );
    }

    #[test]
    fn aborts_and_resets_run_at_the_hook_deadline() {
        for plan in [
            plan_cherry_pick_abort(),
            plan_revert_abort(),
            plan_reset_branch(OID, true).expect("a plan"),
            plan_reset_branch(OID, false).expect("a plan"),
        ] {
            assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        }
        assert_eq!(
            plan_reset_branch(OID, true).expect("a plan").argv,
            vec!["reset", "--soft", OID]
        );
        assert_eq!(
            plan_reset_branch(OID, false).expect("a plan").argv,
            vec!["reset", "--mixed", OID]
        );
    }

    #[test]
    fn an_option_shaped_object_name_is_refused_before_a_command_exists() {
        assert!(plan_cherry_pick("--abort").is_err());
        assert!(plan_revert_commit("-m").is_err());
        assert!(plan_reset_branch("main", false).is_err());
    }
}
