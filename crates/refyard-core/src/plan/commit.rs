//! The planner for one commit.
//!
//! A commit message is bytes and it goes in on stdin (`--file=-`), not in an argument: an
//! argument is length-limited, is visible in the process list on some systems, and would
//! need quoting rules that differ per platform. `--cleanup=verbatim` keeps the message
//! exactly as it was written — Git's default cleanup strips trailing whitespace and
//! comment lines, which silently changes what the user typed.
//!
//! Nothing here adds `--no-verify`, `--no-gpg-sign`, `--all` or `--include`: the message
//! is handed to the user's own Git configuration with the user's hooks and signer in
//! force, and the index is committed exactly as it stands. This is the strategy the Node
//! reference's `planCommit` promises.

use crate::problem::CoreError;

use super::{DeadlineClass, GitPlan};

/// The most bytes one commit message may carry, from `LIMITS.commitMessageMaxBytes`.
pub const COMMIT_MESSAGE_MAX_BYTES: usize = 1_048_576;

/// `git commit --cleanup=verbatim --file=-` with the message on stdin.
///
/// An empty or NUL-carrying message is refused here, before any command exists: Git would
/// open an editor for an empty message (interactive, and this host has none), and NUL
/// cannot travel through the message stream as text. Whitespace-only messages are refused
/// by the same rule the contract's semantic validation applies, because a message of one
/// newline is not a message a person wrote.
pub fn plan_commit(message: &[u8]) -> Result<GitPlan, CoreError> {
    if message.is_empty() {
        return Err(CoreError::invalid_input(
            "planCommit requires a non-empty message",
        ));
    }
    if message.contains(&0) {
        return Err(CoreError::invalid_input(
            "a commit message cannot contain NUL",
        ));
    }
    if message.len() > COMMIT_MESSAGE_MAX_BYTES {
        return Err(CoreError::invalid_input(format!(
            "the commit message is {} bytes; the limit is {COMMIT_MESSAGE_MAX_BYTES}",
            message.len()
        )));
    }
    if message.iter().all(u8::is_ascii_whitespace) {
        return Err(CoreError::invalid_input("a commit message cannot be blank"));
    }
    Ok(GitPlan {
        argv: vec![
            "commit".to_string(),
            "--cleanup=verbatim".to_string(),
            "--file=-".to_string(),
        ],
        stdin: message.to_vec(),
        // A commit runs the user's pre-commit, commit-msg and post-commit hooks, and a
        // signer: it gets the hook deadline, never a read's.
        deadline_class: DeadlineClass::Hook,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_travels_on_stdin_verbatim_and_nothing_is_implicitly_staged() {
        // Prevents: a message mangled by Git's default cleanup, and `-a` sweeping in an
        // unselected working-tree change.
        let plan = plan_commit(b"subject\n\nbody with trailing space \n").expect("a message");
        assert_eq!(
            plan.argv,
            vec!["commit", "--cleanup=verbatim", "--file=-"],
            "no --all, no --include, no --no-verify, no signing override"
        );
        assert_eq!(plan.stdin, b"subject\n\nbody with trailing space \n");
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        assert!(!plan
            .argv
            .iter()
            .any(|argument| argument.contains("subject")));
    }

    #[test]
    fn an_empty_blank_or_nul_message_is_refused_before_a_command_exists() {
        assert!(plan_commit(b"").is_err());
        assert!(
            plan_commit(b"\n  \n").is_err(),
            "a blank message is not a message"
        );
        assert!(plan_commit(b"sub\0ject").is_err());
        assert!(plan_commit(&vec![b'x'; COMMIT_MESSAGE_MAX_BYTES + 1]).is_err());
    }
}
