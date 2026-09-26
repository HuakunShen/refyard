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

/// `git cherry-pick --continue` — commit the resolved index with the original message.
pub fn plan_cherry_pick_continue() -> GitPlan {
    hooked(vec!["cherry-pick".to_string(), "--continue".to_string()])
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

/// `git rebase <upstreamOid>` — replay this branch's own commits onto upstream.
///
/// No `--onto`, no interactive todo list, no force: those are history-rewrite powers
/// this build does not hand out beyond the drop's own `--onto` below, which replays
/// onto a parent the repository itself resolved.
pub fn plan_rebase(upstream_oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(upstream_oid)?;
    Ok(hooked(vec!["rebase".to_string(), upstream_oid.to_string()]))
}

/// `git rev-parse --verify REBASE_HEAD` — is a rebase stopped mid-way?
///
/// Deliberately without `--quiet`: this is the one probe whose stderr the host keeps,
/// and the spelling is the Node reference's, byte for byte.
pub fn plan_rebase_in_progress() -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "REBASE_HEAD".to_string(),
    ])
}

/// `git -c core.editor=true rebase --continue` — resume with the editor suppressed.
///
/// Measured on this machine's Git: a bare `rebase --continue` opens the message editor
/// for the replayed commit. The `-c` override is process-scoped, so no config file is
/// read or written and the commit keeps its original message.
pub fn plan_rebase_continue() -> GitPlan {
    hooked(vec![
        "-c".to_string(),
        "core.editor=true".to_string(),
        "rebase".to_string(),
        "--continue".to_string(),
    ])
}

/// `git rebase --abort` — restore the branch to where the rebase started.
pub fn plan_rebase_abort() -> GitPlan {
    hooked(vec!["rebase".to_string(), "--abort".to_string()])
}

/// `git merge-base --is-ancestor <oid> HEAD` — is the commit on this branch?
pub fn plan_drop_commit_ancestry(oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    Ok(GitPlan::read(vec![
        "merge-base".to_string(),
        "--is-ancestor".to_string(),
        oid.to_string(),
        "HEAD".to_string(),
    ]))
}

/// `git rev-parse --verify --quiet <oid>^2` — does the commit have a second parent?
/// Exit 0 means it is a merge, which a linear replay cannot represent.
pub fn plan_drop_commit_second_parent(oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    Ok(GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{oid}^2"),
    ]))
}

/// `git rev-parse --verify <oid>^` — the parent the descendants replay onto. Its
/// stdout is the parent's object name, which the effect carries into the rebase plan.
pub fn plan_drop_commit_parent(oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    Ok(GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        format!("{oid}^"),
    ]))
}

/// `git rebase --onto <parent> <oid>` — replay descendants without the commit.
pub fn plan_drop_commit_rebase(oid: &str, parent_oid: &str) -> Result<GitPlan, CoreError> {
    validated_source_oid(oid)?;
    validated_source_oid(parent_oid)?;
    Ok(hooked(vec![
        "rebase".to_string(),
        "--onto".to_string(),
        parent_oid.to_string(),
        oid.to_string(),
    ]))
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

#[cfg(test)]
mod drop_tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn the_drop_probes_and_the_replay_are_spelled_exactly_once() {
        assert_eq!(
            plan_drop_commit_ancestry(OID).expect("a plan").argv,
            vec!["merge-base", "--is-ancestor", OID, "HEAD"]
        );
        assert_eq!(
            plan_drop_commit_second_parent(OID).expect("a plan").argv,
            vec!["rev-parse", "--verify", "--quiet", &format!("{OID}^2")]
        );
        assert_eq!(
            plan_drop_commit_parent(OID).expect("a plan").argv,
            vec!["rev-parse", "--verify", &format!("{OID}^")]
        );
        let parent = "aa11000000000000000000000000000000000000";
        let replay = plan_drop_commit_rebase(OID, parent).expect("a plan");
        assert_eq!(
            replay.argv,
            vec!["rebase", "--onto", parent, OID],
            "descendants replay onto the parent without the commit"
        );
        assert_eq!(replay.deadline_class, DeadlineClass::Hook);
    }

    #[test]
    fn a_rebase_names_upstream_and_runs_at_the_hook_deadline() {
        let plan = plan_rebase(OID).expect("a plan");
        assert_eq!(plan.argv, vec!["rebase", OID]);
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        assert!(plan_rebase(OID[..39].to_owned().as_str()).is_err());
    }

    #[test]
    fn the_rebase_resume_suppresses_the_editor_process_scoped() {
        assert_eq!(
            plan_rebase_continue().argv,
            vec!["-c", "core.editor=true", "rebase", "--continue"]
        );
        assert_eq!(plan_rebase_abort().argv, vec!["rebase", "--abort"]);
        assert_eq!(
            plan_rebase_in_progress().argv,
            vec!["rev-parse", "--verify", "REBASE_HEAD"]
        );
    }
}
