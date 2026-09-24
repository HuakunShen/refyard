//! Planners for merging, and for the three state probes a merge effect needs.
//!
//! The interesting part of a merge is not the argv but what Git leaves behind when it
//! stops, so the planners are deliberately thin and the effect does the judging:
//!
//! - **`merge` never picks a strategy or a message policy on the user's behalf.** The
//!   request's mode chooses between Git's default (fast-forward when it can) and an
//!   explicit merge commit (`--no-ff`); the message is either the one the request
//!   carried (`-m`) or Git's own default via `--no-edit`. No editor is ever started —
//!   the service has no terminal, and `--no-edit` is what makes that a property of the
//!   command rather than of the environment.
//! - **The source is one validated object name, never a branch name.** A branch that
//!   moves between the snapshot the user saw and the request they sent must not silently
//!   become a different merge. The object name is also checked for an option-shaped
//!   prefix here: a leading dash would reach `git merge`'s argv, where Git reads it as
//!   an option, and no separator makes that safe.
//! - **The probes read Git's markers through Git, not from the filesystem.** Core is
//!   host-free, and `rev-parse` resolves `MERGE_HEAD` through the same worktree and
//!   common-directory rules a merge or a continue will use.

use crate::problem::CoreError;

use super::{DeadlineClass, GitPlan};

/// A merge source: 40 (SHA-1) or 64 (SHA-256) hexadecimal characters, the object-name
/// shapes the contract's object id carries. Anything else is refused before a command
/// exists, which is what keeps a dash or a path out of Git's argv.
pub fn validated_source_oid(source: &str) -> Result<(), CoreError> {
    let valid = (source.len() == 40 || source.len() == 64)
        && source
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte.is_ascii_hexdigit());
    if valid {
        Ok(())
    } else {
        Err(CoreError::invalid_input(
            "a merge source must be a 40- or 64-character hexadecimal object name",
        ))
    }
}

fn validated_message(message: &[u8]) -> Result<(), CoreError> {
    if message.is_empty() {
        return Err(CoreError::invalid_input(
            "an explicit merge message cannot be empty; omit it for Git's own",
        ));
    }
    if message.contains(&0) {
        return Err(CoreError::invalid_input(
            "a merge message cannot contain NUL",
        ));
    }
    if message.iter().all(u8::is_ascii_whitespace) {
        return Err(CoreError::invalid_input("a merge message cannot be blank"));
    }
    Ok(())
}

/// `git merge [--no-ff] (--no-edit | -m <message>) <object>`.
///
/// The message travels as `-m` exactly as the Node reference's `planMerge` spells it, so
/// the two transports run the same command; an argument cannot carry NUL, and the
/// message is checked for one here rather than at the process boundary.
pub fn plan_merge(
    source_oid: &str,
    no_ff: bool,
    message: Option<&[u8]>,
) -> Result<GitPlan, CoreError> {
    validated_source_oid(source_oid)?;
    let mut argv = vec!["merge".to_string()];
    if no_ff {
        argv.push("--no-ff".to_string());
    }
    match message {
        None => argv.push("--no-edit".to_string()),
        Some(message) => {
            validated_message(message)?;
            let message = String::from_utf8(message.to_vec())
                .map_err(|_| CoreError::invalid_input("a merge message must be UTF-8 text"))?;
            argv.push("-m".to_string());
            argv.push(message);
        }
    }
    argv.push(source_oid.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        // A merge runs the user's merge hook and, with a message, the commit-msg and
        // commit hooks: it gets the hook deadline, never a read's.
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git commit [--no-edit | -m <message>]` — the continue step of a stopped merge.
///
/// After a conflict the resolved index already holds the merge; committing it is the
/// continue step. No `--no-verify`: the user's hooks run on a merge commit exactly as
/// they do on any other commit, and a hook that refuses is reported as a refusal.
pub fn plan_merge_continue(message: Option<&[u8]>) -> Result<GitPlan, CoreError> {
    let mut argv = vec!["commit".to_string()];
    match message {
        None => argv.push("--no-edit".to_string()),
        Some(message) => {
            validated_message(message)?;
            let message = String::from_utf8(message.to_vec())
                .map_err(|_| CoreError::invalid_input("a merge message must be UTF-8 text"))?;
            argv.push("-m".to_string());
            argv.push(message);
        }
    }
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git merge --abort` — restore the state the merge started from.
///
/// There is no `reset --hard` here and there must never be one: a reset is a
/// different, larger action that would also touch work Git deliberately refuses to
/// touch during an abort.
pub fn plan_merge_abort() -> GitPlan {
    GitPlan {
        argv: vec!["merge".to_string(), "--abort".to_string()],
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    }
}

/// `git rev-parse --verify --quiet <rev>^{commit}` — resolve a revision to a commit.
///
/// A source that is missing, or that names a blob or a tree, is refused with this probe's
/// answer instead of being handed to `git merge`.
pub fn plan_resolve_commit(revision: &str) -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{revision}^{{commit}}"),
    ])
}

/// `git rev-parse --verify --quiet MERGE_HEAD` — is a merge in progress?
pub fn plan_merge_in_progress() -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        "MERGE_HEAD".to_string(),
    ])
}

/// `git ls-files --unmerged --stage -z` — the unmerged index stages a conflict left.
pub fn plan_ls_files_unmerged() -> GitPlan {
    GitPlan::read(vec![
        "ls-files".to_string(),
        "--unmerged".to_string(),
        "--stage".to_string(),
        "-z".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA1: &str = "0123456789abcdef0123456789abcdef01234567";
    const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn a_merge_names_the_source_last_and_lets_git_choose_its_own_message_by_default() {
        // Prevents: a branch name (movable, resolved at run time) or an editor being
        // started in a host that has no terminal.
        let plan = plan_merge(SHA1, false, None).expect("a plan");
        assert_eq!(plan.argv, vec!["merge", "--no-edit", SHA1]);
        assert!(plan.stdin.is_empty());
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
    }

    #[test]
    fn no_ff_and_an_explicit_message_are_spelled_exactly_once() {
        let plan = plan_merge(SHA256, true, Some(b"merge it\n")).expect("a plan");
        assert_eq!(
            plan.argv,
            vec!["merge", "--no-ff", "-m", "merge it\n", SHA256]
        );
    }

    #[test]
    fn an_option_shaped_or_short_source_is_refused_before_a_command_exists() {
        // Prevents: `--abort` travelling as the source, where Git would read it as the
        // option it spells.
        assert!(plan_merge("--abort", false, None).is_err());
        assert!(plan_merge("main", false, None).is_err());
        assert!(plan_merge("", false, None).is_err());
        assert!(plan_merge(&SHA1[..39], false, None).is_err());
        let not_hex: String = SHA1[..39].to_owned() + "g";
        assert!(plan_merge(&not_hex, false, None).is_err());
    }

    #[test]
    fn an_empty_blank_or_nul_message_is_refused() {
        assert!(plan_merge(SHA1, false, Some(b"")).is_err());
        assert!(plan_merge(SHA1, false, Some(b" \n\t")).is_err());
        assert!(plan_merge(SHA1, false, Some(b"ok\0")).is_err());
    }

    #[test]
    fn the_abort_is_its_own_command_and_never_a_reset() {
        assert_eq!(plan_merge_abort().argv, vec!["merge", "--abort"]);
        assert_eq!(plan_merge_abort().deadline_class, DeadlineClass::Hook);
    }

    #[test]
    fn the_continue_step_is_a_commit_that_lets_hooks_run_and_never_edits() {
        assert_eq!(
            plan_merge_continue(None).expect("a plan").argv,
            vec!["commit", "--no-edit"]
        );
        let with_message = plan_merge_continue(Some(b"merged\n")).expect("a plan");
        assert_eq!(with_message.argv, vec!["commit", "-m", "merged\n"]);
        assert_eq!(with_message.deadline_class, DeadlineClass::Hook);
        assert!(plan_merge_continue(Some(b"")).is_err());
    }

    #[test]
    fn the_probes_read_gits_markers_without_creating_anything() {
        assert_eq!(
            plan_merge_in_progress().argv,
            vec!["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]
        );
        assert_eq!(
            plan_resolve_commit(SHA1).argv,
            vec![
                "rev-parse",
                "--verify",
                "--quiet",
                concat!("0123456789abcdef0123456789abcdef01234567", "^{commit}")
            ]
        );
        assert_eq!(
            plan_ls_files_unmerged().argv,
            vec!["ls-files", "--unmerged", "--stage", "-z"]
        );
        for plan in [
            plan_merge_in_progress(),
            plan_resolve_commit(SHA1),
            plan_ls_files_unmerged(),
        ] {
            assert_eq!(plan.deadline_class, DeadlineClass::Read);
            assert!(plan.stdin.is_empty());
        }
    }
}
