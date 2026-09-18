//! Asking the far side what it can do, before a read depends on it.
//!
//! The reads are written for a POSIX environment: their plans use `-z` framing, their
//! parsers expect Git's machine formats, and every command is delivered as a
//! single-quoted command string that the *remote login shell* parses. Two of those are
//! assumptions about the far side rather than about this process, so they are probed
//! explicitly instead of discovered by a mangled read:
//!
//! - the login shell must accept POSIX single-quote syntax. The shell probe sends a value
//!   containing an apostrophe, a space, `$`, a backtick, a backslash and a quote through
//!   the same encoder the real commands use and requires it back byte for byte. A shell
//!   that is not POSIX-shaped fails this instead of quietly corrupting a later path, and
//!   the answer is a typed `Unavailable` — a non-POSIX login shell needs its own adapter
//!   and its own tests, not a workaround bolted onto this one;
//! - `git` must exist there, and the repository must answer the layout query, which is
//!   also the only place the object format is learned rather than assumed.
//!
//! Nothing here is installed on the far side and nothing is uploaded. The probes are the
//! same kind of command every read is: `git` and a shell builtin.

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_core::outcome::{ExecutionState, RunOutcome};
use refyard_core::plan::status::plan_repository_layout;
use refyard_core::plan::{DeadlineClass, GitPlan};

use crate::process::CancelSignal;
use crate::registry::{parse_repository_layout, RepositoryLayout};

use super::connection::{attempt_deadline, SshConnection};
use super::quote::{quote_posix, remote_git_command};

/// The value the login shell must echo back unchanged.
///
/// It carries exactly the characters the encoding exists for: an apostrophe (which the
/// encoding rewrites), a space (which would split a word), `$` and a backtick (which a
/// shell would expand), a backslash, a glob character and a double quote. If any of them
/// is interpreted rather than passed through, the bytes that come back differ from these.
pub const SHELL_PROBE_VALUE: &str = "refyard shell probe: a'b c$d `e` \\f *g? \"h\"";

/// The probe output is a few bytes; a bound this small keeps a broken shell from being
/// able to make the probe itself expensive.
const PROBE_STDOUT_LIMIT: usize = 64 * 1024;
const PROBE_STDERR_LIMIT: usize = 64 * 1024;

/// The layout query's own bound. The answer is six lines, and the first line can be a long
/// path.
const LAYOUT_STDOUT_LIMIT: usize = 1 << 20;

/// What a remote host answered when asked whether it can carry the reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFacts {
    /// `git --version` there, without the `git version ` prefix.
    pub git_version: String,
    /// The repository layout, including the object format this host must not assume.
    pub layout: RepositoryLayout,
}

/// The command that proves the login shell parses POSIX quoting the way the encoder writes it.
///
/// `printf` is the only tool used: it is a POSIX utility and a shell builtin on every shell
/// this product is willing to talk to, and its `%s` argument is emitted verbatim.
pub fn shell_probe_command() -> Result<String, Problem> {
    Ok(format!("printf %s {}", quote_posix(SHELL_PROBE_VALUE)?))
}

/// True when the shell probe's answer is the byte-for-byte value that was sent.
pub fn shell_probe_answered(outcome: &RunOutcome) -> bool {
    outcome.succeeded() && outcome.stdout == SHELL_PROBE_VALUE.as_bytes()
}

/// Runs the shell probe through `connection`.
///
/// A failure is `Unavailable` with what came back: the remote environment cannot carry a
/// command string, and no read may be sent to it.
pub async fn shell_semantics(
    connection: &SshConnection,
    cancel: Option<CancelSignal>,
) -> Result<(), Problem> {
    let command = shell_probe_command()?;
    let outcome = connection
        .run(
            &command,
            Vec::new(),
            attempt_deadline(DeadlineClass::Read),
            PROBE_STDOUT_LIMIT,
            PROBE_STDERR_LIMIT,
            cancel,
        )
        .await;
    if shell_probe_answered(&outcome) {
        return Ok(());
    }
    Err(unavailable(
        "the remote login shell did not pass the POSIX quoting probe unchanged; a login shell that is not POSIX-shaped needs its own adapter and its own tests",
        "shell",
        &outcome,
    ))
}

/// The Git version on the far side, via the same quoted template every read uses.
pub async fn git_version(
    connection: &SshConnection,
    directory: &str,
    cancel: Option<CancelSignal>,
) -> Result<String, Problem> {
    let plan = GitPlan::read(vec!["--version".to_string()]);
    let outcome = connection
        .run(
            &remote_git_command(directory, &plan.argv)?,
            plan.stdin,
            attempt_deadline(plan.deadline_class),
            PROBE_STDOUT_LIMIT,
            PROBE_STDERR_LIMIT,
            cancel,
        )
        .await;
    if !outcome.succeeded() {
        return Err(unavailable(
            "git could not be run on the remote host",
            "git",
            &outcome,
        ));
    }
    let text = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
    Ok(text
        .strip_prefix("git version ")
        .unwrap_or(&text)
        .to_string())
}

/// The repository layout on the far side.
///
/// The bare-safe form is asked when the full query fails, exactly as the local open does:
/// Git refuses `--show-toplevel` in a bare repository *after* printing the paths it could
/// resolve, and reading that partial output would give a repository with a missing top
/// level rather than an error.
pub async fn layout(
    connection: &SshConnection,
    directory: &str,
    cancel: Option<CancelSignal>,
) -> Result<RepositoryLayout, Problem> {
    let full = run_layout(connection, directory, false, cancel.clone()).await?;
    if full.succeeded() {
        if let Ok(layout) = parse_repository_layout(&full.stdout, true) {
            return Ok(layout);
        }
    }
    let bare_safe = run_layout(connection, directory, true, cancel).await?;
    if bare_safe.succeeded() {
        if let Ok(layout) = parse_repository_layout(&bare_safe.stdout, false) {
            return Ok(layout);
        }
    }
    // Report the reason the requested query failed, unless it never started: a client that
    // lost the connection needs the connection's diagnostic, not the fallback's.
    let failure = if full.state == ExecutionState::NotStarted {
        bare_safe
    } else {
        full
    };
    Err(unavailable(
        "the remote repository could not be opened",
        "layout",
        &failure,
    ))
}

/// Probes everything a read depends on: shell semantics, Git, and the repository layout.
pub async fn probe(
    connection: &SshConnection,
    directory: &str,
    cancel: Option<CancelSignal>,
) -> Result<RemoteFacts, Problem> {
    shell_semantics(connection, cancel.clone()).await?;
    let git_version = git_version(connection, directory, cancel.clone()).await?;
    let layout = layout(connection, directory, cancel).await?;
    Ok(RemoteFacts {
        git_version,
        layout,
    })
}

async fn run_layout(
    connection: &SshConnection,
    directory: &str,
    omit_top_level: bool,
    cancel: Option<CancelSignal>,
) -> Result<RunOutcome, Problem> {
    let plan = plan_repository_layout(omit_top_level);
    let command = remote_git_command(directory, &plan.argv)?;
    Ok(connection
        .run(
            &command,
            plan.stdin,
            attempt_deadline(plan.deadline_class),
            LAYOUT_STDOUT_LIMIT,
            PROBE_STDERR_LIMIT,
            cancel,
        )
        .await)
}

/// One typed answer for everything the far side failed to do.
///
/// The state and exit status are carried as details rather than folded into the message,
/// because "Git said no", "the deadline passed" and "the peer ended the command" need
/// different responses from the person reading them.
fn unavailable(message: &str, stage: &str, outcome: &RunOutcome) -> Problem {
    let mut problem = Problem::new(ProblemCode::Unavailable, message)
        .with_detail("stage", DetailValue::Text(stage.to_string()));
    if let Some(exit_code) = outcome.exit_code {
        problem = problem.with_detail("exitCode", DetailValue::Integer(i64::from(exit_code)));
    }
    let diagnostic = String::from_utf8_lossy(&outcome.stderr);
    let diagnostic = diagnostic.trim_end();
    if !diagnostic.is_empty() {
        problem = problem.with_detail(
            "diagnostic",
            DetailValue::Text(diagnostic.chars().take(500).collect()),
        );
    }
    problem
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_core::outcome::TerminationReason;

    fn completed(stdout: &[u8]) -> RunOutcome {
        RunOutcome {
            state: ExecutionState::Completed,
            exit_code: Some(0),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
            output_complete: true,
            termination: None,
        }
    }

    #[test]
    fn the_probe_value_carries_every_character_the_encoding_exists_for() {
        for expected in ['\'', ' ', '$', '`', '\\', '*', '?', '"'] {
            assert!(
                SHELL_PROBE_VALUE.contains(expected),
                "the probe must exercise {expected:?}"
            );
        }
    }

    #[test]
    fn the_probe_command_is_the_value_in_quotes_and_nothing_else() {
        let command = shell_probe_command().expect("quotable");
        assert!(command.starts_with("printf %s '"));
        assert!(
            command.contains("'\"'\"'"),
            "the apostrophe is the escape under test"
        );
        // The encoding is the only thing between the shell and the value: no expansion,
        // no substitution, no second command.
        assert!(!command.contains("$("));
    }

    #[test]
    fn the_answer_is_only_an_answer_when_it_is_byte_for_byte_the_value() {
        assert!(shell_probe_answered(&completed(
            SHELL_PROBE_VALUE.as_bytes()
        )));
        // A shell that expanded `$` or split on the space is not a shell this host can
        // send commands to, and a merely non-empty answer must not satisfy the probe.
        assert!(!shell_probe_answered(&completed(
            b"refyard shell probe: a'b c d `e` \\f *g? \"h\""
        )));
        assert!(!shell_probe_answered(&completed(b"")));
    }

    #[test]
    fn a_failure_keeps_its_state_so_the_caller_does_not_have_to_guess() {
        let outcome = RunOutcome {
            state: ExecutionState::Interrupted,
            exit_code: None,
            stdout: Vec::new(),
            stderr: b"ssh: connect to host 127.0.0.1 port 1: Connection refused\n".to_vec(),
            output_complete: true,
            termination: Some(TerminationReason::Timeout),
        };
        let problem = unavailable("git could not be run on the remote host", "git", &outcome);
        assert_eq!(problem.code, ProblemCode::Unavailable);
        let details = problem.details.expect("details");
        assert_eq!(
            details.get("stage"),
            Some(&DetailValue::Text("git".to_string()))
        );
        assert!(matches!(
            details.get("diagnostic"),
            Some(DetailValue::Text(text)) if text.contains("Connection refused")
        ));
    }
}
