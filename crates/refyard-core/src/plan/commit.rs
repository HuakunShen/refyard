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

fn hooked(argv: Vec<String>) -> GitPlan {
    GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    }
}

/// `git reset --soft HEAD^` — the soft reset that opens a squash.
///
/// `HEAD^` is fixed text, never client input. The branch moves to the parent and the
/// combined change sits in the index, ready for the amend step.
pub fn plan_squash_soft_reset() -> GitPlan {
    hooked(vec![
        "reset".to_string(),
        "--soft".to_string(),
        "HEAD^".to_string(),
    ])
}

/// `git commit --amend` — rewrite the commit HEAD names.
///
/// After a squash's soft reset HEAD *is* the parent, so the amend is what folds the two
/// changes into one commit. `null` keeps the existing message via `--no-edit`; a message
/// travels on stdin under `--cleanup=verbatim` for exactly the reasons a plain commit's
/// does.
pub fn plan_amend_commit(message: Option<&[u8]>) -> Result<GitPlan, CoreError> {
    match message {
        None => Ok(hooked(vec![
            "commit".to_string(),
            "--amend".to_string(),
            "--no-edit".to_string(),
        ])),
        Some(message) => {
            if message.is_empty() {
                return Err(CoreError::invalid_input(
                    "an amend requires a non-empty message or none at all",
                ));
            }
            if message.contains(&0) {
                return Err(CoreError::invalid_input(
                    "a commit message cannot contain NUL",
                ));
            }
            if message.iter().all(u8::is_ascii_whitespace) {
                return Err(CoreError::invalid_input("a commit message cannot be blank"));
            }
            Ok(GitPlan {
                argv: vec![
                    "commit".to_string(),
                    "--amend".to_string(),
                    "--cleanup=verbatim".to_string(),
                    "--file=-".to_string(),
                ],
                stdin: message.to_vec(),
                deadline_class: DeadlineClass::Hook,
            })
        }
    }
}

/// `stash@{n}` is a moving label in a reflog, never a stable identifier. Only the
/// exact `stash@{digits}` form is accepted, so a crafted locator can neither name a
/// real ref nor be read as a switch.
fn validated_stash_locator(locator: &str) -> Result<(), CoreError> {
    let inner = locator
        .strip_prefix("stash@{")
        .and_then(|rest| rest.strip_suffix('}'))
        .ok_or_else(|| CoreError::invalid_input("a stash locator must look like stash@{0}"))?;
    if inner.is_empty() || !inner.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CoreError::invalid_input(
            "a stash locator must look like stash@{0}",
        ));
    }
    Ok(())
}

/// A stash message is caller text carried in argv; it is bounded to the same rules as a
/// commit message so a blank or NUL-carrying label cannot reach Git.
fn validated_stash_message(message: &str) -> Result<(), CoreError> {
    if message.is_empty() {
        return Err(CoreError::invalid_input(
            "a stash message cannot be empty; pass none for the default",
        ));
    }
    if message.contains('\0') {
        return Err(CoreError::invalid_input(
            "a stash message cannot contain NUL",
        ));
    }
    if message.trim().is_empty() {
        return Err(CoreError::invalid_input("a stash message cannot be blank"));
    }
    Ok(())
}

/// `git stash push [--message=<msg>] [--include-untracked] [--keep-index]`.
///
/// The message travels in argv (`--message=<value>`, the `=` spelling so a leading `-`
/// cannot be read as a switch) because `git stash` has no stdin form for it. Ignored
/// files are never swept in, and `--include-untracked` is only added when asked.
pub fn plan_stash_push(
    message: Option<&str>,
    include_untracked: bool,
    keep_index: bool,
) -> Result<GitPlan, CoreError> {
    let mut argv = vec!["stash".to_string(), "push".to_string()];
    if let Some(message) = message {
        validated_stash_message(message)?;
        argv.push(format!("--message={message}"));
    }
    if include_untracked {
        argv.push("--include-untracked".to_string());
    }
    if keep_index {
        argv.push("--keep-index".to_string());
    }
    Ok(hooked(argv))
}

/// `git stash apply [--index] <locator>` — apply and keep the entry.
pub fn plan_stash_apply(locator: &str, restore_index: bool) -> Result<GitPlan, CoreError> {
    validated_stash_locator(locator)?;
    let mut argv = vec!["stash".to_string(), "apply".to_string()];
    if restore_index {
        argv.push("--index".to_string());
    }
    // The locator is positional and pinned to `stash@{n}`, so it cannot be a switch.
    argv.push(locator.to_string());
    Ok(hooked(argv))
}

/// `git stash pop [--index] <locator>` — apply, and let Git drop only on success.
pub fn plan_stash_pop(locator: &str, restore_index: bool) -> Result<GitPlan, CoreError> {
    validated_stash_locator(locator)?;
    let mut argv = vec!["stash".to_string(), "pop".to_string()];
    if restore_index {
        argv.push("--index".to_string());
    }
    argv.push(locator.to_string());
    Ok(hooked(argv))
}

/// `git stash drop <locator>` — discard one entry. Destructive; the caller confirmed it.
pub fn plan_stash_drop(locator: &str) -> Result<GitPlan, CoreError> {
    validated_stash_locator(locator)?;
    Ok(hooked(vec![
        "stash".to_string(),
        "drop".to_string(),
        locator.to_string(),
    ]))
}

/// `git rev-parse --verify --quiet <locator>^{commit}` — does the locator still name
/// the object the request carried? This is the only way a pop cannot land on the wrong
/// entry after someone else's `git stash` shifted every position.
pub fn plan_stash_resolve(locator: &str) -> Result<GitPlan, CoreError> {
    validated_stash_locator(locator)?;
    Ok(GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{locator}^{{commit}}"),
    ]))
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

#[cfg(test)]
mod squash_tests {
    use super::*;

    #[test]
    fn the_squash_opens_with_a_soft_reset_to_the_fixed_head_parent() {
        let plan = plan_squash_soft_reset();
        assert_eq!(plan.argv, vec!["reset", "--soft", "HEAD^"]);
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        assert!(plan.stdin.is_empty());
    }

    #[test]
    fn the_amend_keeps_the_message_when_none_is_given_and_verbatim_when_one_is() {
        assert_eq!(
            plan_amend_commit(None).expect("a plan").argv,
            vec!["commit", "--amend", "--no-edit"]
        );
        let with_message = plan_amend_commit(Some(b"combined\n")).expect("a plan");
        assert_eq!(
            with_message.argv,
            vec!["commit", "--amend", "--cleanup=verbatim", "--file=-"]
        );
        assert_eq!(with_message.stdin, b"combined\n");
        assert!(plan_amend_commit(Some(b"")).is_err());
        assert!(plan_amend_commit(Some(b" \n")).is_err());
        assert!(plan_amend_commit(Some(b"a\0b")).is_err());
    }
}

#[cfg(test)]
mod stash_tests {
    use super::*;

    #[test]
    fn a_stash_locator_is_pinned_to_the_reflog_form() {
        assert!(plan_stash_resolve("stash@{0}").is_ok());
        assert!(plan_stash_resolve("stash@{12}").is_ok());
        // A crafted locator can name a real ref or begin as a switch; both are refused.
        assert!(plan_stash_resolve("HEAD").is_err());
        assert!(plan_stash_resolve("--help").is_err());
        assert!(plan_stash_resolve("stash@{}").is_err());
        assert!(plan_stash_resolve("stash@{1x}").is_err());
        assert!(plan_stash_resolve("stash@{1}extra").is_err());
        assert!(plan_stash_resolve("refs/stash").is_err());
    }

    #[test]
    fn the_resolve_probe_reads_the_locator_through_git() {
        assert_eq!(
            plan_stash_resolve("stash@{2}").expect("a plan").argv,
            vec!["rev-parse", "--verify", "--quiet", "stash@{2}^{commit}"]
        );
    }

    #[test]
    fn a_push_carries_the_message_in_argv_so_a_leading_dash_is_not_a_switch() {
        let plan = plan_stash_push(Some("wip"), true, true).expect("a plan");
        assert_eq!(
            plan.argv,
            vec![
                "stash",
                "push",
                "--message=wip",
                "--include-untracked",
                "--keep-index"
            ]
        );
        assert!(
            plan.stdin.is_empty(),
            "stash push has no stdin message form"
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
        // The `=` spelling keeps a leading `-` in the value.
        assert_eq!(
            plan_stash_push(Some("-not-a-switch"), false, false)
                .expect("a plan")
                .argv,
            vec!["stash", "push", "--message=-not-a-switch"]
        );
        // A blank or NUL message is not a label this host can make.
        assert!(plan_stash_push(Some(""), false, false).is_err());
        assert!(plan_stash_push(Some("   "), false, false).is_err());
        assert!(plan_stash_push(Some("a\0b"), false, false).is_err());
    }

    #[test]
    fn apply_pop_and_drop_pin_the_locator_last_and_never_force() {
        assert_eq!(
            plan_stash_apply("stash@{1}", true).expect("a plan").argv,
            vec!["stash", "apply", "--index", "stash@{1}"]
        );
        assert_eq!(
            plan_stash_pop("stash@{0}", false).expect("a plan").argv,
            vec!["stash", "pop", "stash@{0}"]
        );
        assert_eq!(
            plan_stash_drop("stash@{3}").expect("a plan").argv,
            vec!["stash", "drop", "stash@{3}"]
        );
    }
}
