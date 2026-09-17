//! Turning repository state into the contract's read DTOs.
//!
//! Every read in this crate has the same shape: run the planned commands, let a
//! parser decide what the bytes mean, and only then decide how a value is *named* on
//! the wire and which ids the caller may hold. This module holds the parts shared by
//! more than one panel — the error vocabulary, the two ways a command's exit status can
//! be an answer, and the HEAD facts that refs and history both need.
//!
//! Two rules are visible in the error type:
//!
//! - a command that did not answer is never reported as an empty answer. `run_required`
//!   turns "exit 3 with a diagnostic" and "output cut at the host's bound" into
//!   different problems, because one is Git saying no and the other is us failing to
//!   read what Git said;
//! - an exit status the caller *expects* is an answer, not a failure. `symbolic-ref
//!   --quiet HEAD` exits 1 when HEAD is detached and `rev-parse --verify --quiet HEAD`
//!   exits 1 on an unborn branch; both are ordinary states, and `run_meaningful_exit` is
//!   the only way to read them without turning "no" into an error.

pub mod diff;
pub mod filesystem;
pub mod history;
pub mod refs;
pub mod status;

use std::path::Path;

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::{HeadKind, HeadState};
use refyard_core::outcome::{ExecutionState, RunOutcome, TerminationReason};
use refyard_core::plan::status::{plan_head_oid, plan_head_ref};
use refyard_core::plan::GitPlan;
use refyard_core::CoreError;

use crate::providers::local::LocalGit;
use crate::registry::{RepositoryRecord, RepositoryRegistry};

/// How a Git command stopped answering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitFailureKind {
    /// Git ran and exited non-zero.
    CommandFailed,
    /// The program could not be started at all.
    NotStarted,
    /// The read deadline passed and the process was stopped.
    TimedOut,
    /// The caller released the session while the command was running.
    Cancelled,
    /// Git produced more output than the host will hold.
    OutputLimit,
    /// Something other than this host ended the process.
    Signalled,
}

/// One failed command, with the evidence the caller may show.
#[derive(Debug)]
pub struct GitFailure {
    /// The command description, which is the planner's own name for it.
    pub command: &'static str,
    pub kind: GitFailureKind,
    pub exit_code: Option<i32>,
    /// Bounded diagnostic text. Never treated as the meaning of the failure.
    pub diagnostic: String,
}

impl GitFailure {
    /// The problem a client sees. The code is the same closed vocabulary the Node host
    /// publishes, so a UI does not branch on a new one per implementation.
    fn problem(&self) -> Problem {
        let (code, message) = match self.kind {
            GitFailureKind::CommandFailed => (
                ProblemCode::GitCommandFailed,
                format!(
                    "{} exited with status {}",
                    self.command,
                    exit_text(self.exit_code)
                ),
            ),
            GitFailureKind::NotStarted => (
                ProblemCode::Unavailable,
                format!("{} could not be started", self.command),
            ),
            GitFailureKind::TimedOut => (
                ProblemCode::Timeout,
                format!("{} did not finish within its deadline", self.command),
            ),
            GitFailureKind::Cancelled => (
                ProblemCode::Cancelled,
                format!("{} was cancelled before it finished", self.command),
            ),
            GitFailureKind::OutputLimit => (
                ProblemCode::LimitExceeded,
                format!(
                    "{} produced more output than the host will hold",
                    self.command
                ),
            ),
            GitFailureKind::Signalled => (
                ProblemCode::GitCommandFailed,
                format!("{} was terminated by a signal", self.command),
            ),
        };
        let mut problem =
            Problem::new(code, message).with_detail("command", text(self.command.to_string()));
        if let Some(exit_code) = self.exit_code {
            problem = problem.with_detail("exitCode", DetailValue::Integer(i64::from(exit_code)));
        }
        if !self.diagnostic.is_empty() {
            // Bounded again here, at the wire boundary: the value entered this type from
            // a command's stderr, and a problem envelope must not grow with Git's output
            // even if a future caller builds the failure a different way.
            problem = problem.with_detail(
                "diagnostic",
                text(self.diagnostic.chars().take(500).collect()),
            );
        }
        if code == ProblemCode::Timeout {
            // A read that timed out may be repeated; a failed mutation never is.
            problem = problem.retryable();
        }
        problem
    }
}

/// Why a read failed.
#[derive(Debug)]
pub enum ReadError {
    /// A command this read depends on did not answer.
    Git(GitFailure),
    /// The bytes are not the shape the format requires.
    Parse {
        command: &'static str,
        error: CoreError,
    },
    /// The request itself was refused, or the answer is a fact rather than a value.
    Problem(Problem),
}

impl ReadError {
    /// A refusal stated in contract terms.
    pub fn problem(problem: Problem) -> Self {
        ReadError::Problem(problem)
    }

    /// The problem a client sees.
    pub fn to_problem(&self) -> Problem {
        match self {
            ReadError::Problem(problem) => problem.clone(),
            ReadError::Git(failure) => failure.problem(),
            // The command name is part of the message: this failure means the bytes
            // were not what the command promised, and "could not be read" alone is
            // unactionable.
            ReadError::Parse { command, error } => {
                Problem::new(ProblemCode::InternalError, format!("{command}: {error}"))
                    .with_detail("command", text(command.to_string()))
            }
        }
    }
}

/// A parse failure attributed to the command that produced the bytes.
pub fn parse_error(command: &'static str, error: CoreError) -> ReadError {
    ReadError::Parse { command, error }
}

fn text(value: String) -> DetailValue {
    DetailValue::Text(value)
}

fn exit_text(exit_code: Option<i32>) -> String {
    exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "?".to_string())
}

/// Runs a command whose only acceptable answer is exit 0.
pub async fn run_required(
    git: &LocalGit,
    directory: &Path,
    plan: &GitPlan,
    command: &'static str,
) -> Result<Vec<u8>, ReadError> {
    let outcome = git.run(directory, plan, None).await;
    required_output(&outcome, command).map_err(ReadError::Git)
}

/// Runs a command where a specific non-zero exit code carries meaning.
///
/// Returns `None` when Git exited with one of `meaningful_exit_codes` — the caller
/// knows what that means for this command. Every other timeout, cancellation, signal or
/// spawn failure is still an error, and it is never reported as "the answer was no".
pub async fn run_meaningful_exit(
    git: &LocalGit,
    directory: &Path,
    plan: &GitPlan,
    command: &'static str,
    meaningful_exit_codes: &[i32],
) -> Result<Option<Vec<u8>>, ReadError> {
    let outcome = git.run(directory, plan, None).await;
    if outcome.state == ExecutionState::Completed {
        if let Some(exit_code) = outcome.exit_code {
            if meaningful_exit_codes.contains(&exit_code) {
                return Ok(None);
            }
        }
    }
    required_output(&outcome, command)
        .map(Some)
        .map_err(ReadError::Git)
}

/// The stdout of a command that must have succeeded.
fn required_output(outcome: &RunOutcome, command: &'static str) -> Result<Vec<u8>, GitFailure> {
    let failure = |kind: GitFailureKind| GitFailure {
        command,
        kind,
        exit_code: outcome.exit_code,
        diagnostic: bounded_diagnostic(&outcome.stderr),
    };
    match outcome.state {
        ExecutionState::NotStarted => Err(failure(GitFailureKind::NotStarted)),
        ExecutionState::Interrupted => Err(failure(match outcome.termination {
            Some(TerminationReason::Timeout) => GitFailureKind::TimedOut,
            Some(TerminationReason::Cancelled) => GitFailureKind::Cancelled,
            _ => GitFailureKind::CommandFailed,
        })),
        ExecutionState::Unknown => Err(failure(match outcome.termination {
            Some(TerminationReason::Signalled(_)) => GitFailureKind::Signalled,
            _ => GitFailureKind::CommandFailed,
        })),
        ExecutionState::Completed => {
            if !outcome.output_complete {
                // Exit 0 with a cut stream is not a success: a truncated protocol frame
                // read as complete is a wrong answer rather than a short one.
                return Err(failure(GitFailureKind::OutputLimit));
            }
            match outcome.exit_code {
                Some(0) => Ok(outcome.stdout.clone()),
                _ => Err(failure(GitFailureKind::CommandFailed)),
            }
        }
    }
}

/// Diagnostic text for a failure, bounded for the wire.
///
/// Decoded leniently and trimmed: these bytes are for a human reading a journal, and a
/// replacement character inside a Git message is better than an error raised while
/// reporting an error. The cap matches the reference host's, so one long Git message
/// cannot inflate a problem envelope.
fn bounded_diagnostic(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .trim_end()
        .chars()
        .take(500)
        .collect()
}

/// Decodes an ASCII line Git printed as a name or an object name.
pub fn ascii_line(bytes: &[u8], command: &'static str) -> Result<String, ReadError> {
    let decoded = refyard_core::bytes::decode_ascii(bytes, command)
        .map_err(|error| parse_error(command, error))?;
    Ok(decoded.trim().to_string())
}

/// The registered repository, or the same refusal the Node host gives.
pub fn require_repository(
    repositories: &RepositoryRegistry,
    repository_id: &str,
) -> Result<RepositoryRecord, ReadError> {
    repositories.get(repository_id).ok_or_else(|| {
        ReadError::problem(Problem::new(
            ProblemCode::NotFound,
            format!("unknown repository {repository_id}"),
        ))
    })
}

/// The worktree a read addresses.
///
/// This host has one worktree per registration, so a request naming another one is
/// refused rather than answered from the primary checkout: reporting one worktree's
/// files for a worktree the caller believes is somewhere else is the one lie a user
/// cannot see.
pub fn require_worktree(
    record: &RepositoryRecord,
    requested: Option<&str>,
) -> Result<String, ReadError> {
    match requested {
        None => Ok(record.worktree_id.clone()),
        Some(worktree_id) if worktree_id == record.worktree_id => Ok(record.worktree_id.clone()),
        Some(worktree_id) => Err(ReadError::problem(
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown worktree {worktree_id} in {}", record.repository_id),
            )
            .with_detail("worktreeId", text(worktree_id.to_string())),
        )),
    }
}

/// Where HEAD is, in the three states the contract distinguishes.
///
/// Read from `symbolic-ref` and `rev-parse` rather than from a status stream, because
/// the refs and history panels ask this question without reading status at all.
pub async fn read_head_state(
    git: &LocalGit,
    record: &RepositoryRecord,
) -> Result<HeadState, ReadError> {
    let directory = Path::new(record.location.canonical_worktree.as_str());
    let branch_ref =
        run_meaningful_exit(git, directory, &plan_head_ref(), "symbolic-ref HEAD", &[1]).await?;
    let head_oid =
        run_meaningful_exit(git, directory, &plan_head_oid(), "rev-parse HEAD", &[1]).await?;
    let oid = match head_oid {
        Some(bytes) => Some(ascii_line(&bytes, "rev-parse HEAD")?),
        None => None,
    };
    let kind = if oid.is_none() {
        HeadKind::Unborn
    } else {
        HeadKind::Born
    };
    match branch_ref {
        // A detached HEAD has no branch name; an unborn branch has one but no object.
        None => Ok(HeadState {
            kind,
            branch_name: None,
            oid,
            detached: true,
        }),
        Some(bytes) => {
            let branch_ref_name = ascii_line(&bytes, "symbolic-ref HEAD")?;
            Ok(HeadState {
                kind,
                branch_name: Some(
                    branch_ref_name
                        .strip_prefix("refs/heads/")
                        .unwrap_or(&branch_ref_name)
                        .to_string(),
                ),
                oid,
                detached: false,
            })
        }
    }
}

/// The Git directory of this worktree, where operation markers live.
pub fn git_dir_of(record: &RepositoryRecord) -> &Path {
    Path::new(record.layout.git_dir.as_str())
}

/// A path key for joining two listings: the raw bytes, hex-encoded.
///
/// Hex rather than the bytes themselves, so a path containing the key's own separator
/// cannot collide with a different path.
pub fn path_key(bytes: &[u8]) -> String {
    let mut key = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        key.push_str(&format!("{byte:02x}"));
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    fn completed(exit_code: i32, complete: bool) -> RunOutcome {
        RunOutcome {
            state: ExecutionState::Completed,
            exit_code: Some(exit_code),
            stdout: b"out".to_vec(),
            stderr: b"err\n".to_vec(),
            output_complete: complete,
            termination: None,
        }
    }

    #[test]
    fn an_exit_zero_with_a_complete_stream_is_the_answer() {
        let output = required_output(&completed(0, true), "status").expect("success");
        assert_eq!(output, b"out".to_vec());
    }

    #[test]
    fn an_exit_zero_with_a_cut_stream_is_a_limit_not_a_success() {
        // Reading a truncated protocol stream as complete would attach one object's
        // body to another's name.
        let failure = required_output(&completed(0, false), "cat-file --batch").expect_err("cut");
        assert_eq!(failure.kind, GitFailureKind::OutputLimit);
        assert_eq!(failure.problem().code, ProblemCode::LimitExceeded);
    }

    #[test]
    fn a_non_zero_exit_keeps_the_code_and_the_bounded_diagnostic() {
        let failure = required_output(&completed(128, true), "diff").expect_err("non-zero");
        assert_eq!(failure.kind, GitFailureKind::CommandFailed);
        assert_eq!(failure.exit_code, Some(128));
        let problem = failure.problem();
        assert_eq!(problem.code, ProblemCode::GitCommandFailed);
        assert_eq!(
            problem.details.as_ref().and_then(|map| map.get("command")),
            Some(&DetailValue::Text("diff".to_string()))
        );
    }

    #[test]
    fn a_deadline_is_reported_as_a_retryable_timeout() {
        let mut timed_out = completed(0, false);
        timed_out.state = ExecutionState::Interrupted;
        timed_out.exit_code = None;
        timed_out.termination = Some(TerminationReason::Timeout);
        let failure = required_output(&timed_out, "history").expect_err("timeout");
        assert_eq!(failure.kind, GitFailureKind::TimedOut);
        assert!(failure.problem().retryable);
    }

    #[test]
    fn a_program_that_never_started_is_unavailable_rather_than_failed() {
        // "Git is not installed" and "Git refused this command" need different fixes.
        let mut not_started = completed(0, true);
        not_started.state = ExecutionState::NotStarted;
        not_started.exit_code = None;
        let failure = required_output(&not_started, "status").expect_err("not started");
        assert_eq!(failure.problem().code, ProblemCode::Unavailable);
    }

    #[test]
    fn a_parse_failure_is_attributed_to_the_command_that_produced_the_bytes() {
        let error = parse_error(
            "for-each-ref",
            CoreError::output_unparsable("for-each-ref", "expected 8 fields"),
        );
        let problem = error.to_problem();
        assert_eq!(problem.code, ProblemCode::InternalError);
        assert!(problem.message.starts_with("for-each-ref: "));
    }

    #[test]
    fn a_long_diagnostic_is_bounded_so_one_message_cannot_inflate_a_problem() {
        let failure = GitFailure {
            command: "diff",
            kind: GitFailureKind::CommandFailed,
            exit_code: Some(1),
            diagnostic: "x".repeat(10_000),
        };
        match failure
            .problem()
            .details
            .and_then(|map| map.get("diagnostic").cloned())
        {
            Some(DetailValue::Text(text)) => assert_eq!(text.chars().count(), 500),
            other => panic!("expected bounded diagnostic text, got {other:?}"),
        }
    }

    #[test]
    fn a_path_key_is_hex_so_two_paths_cannot_collide_with_a_separator() {
        assert_eq!(path_key(b"a\nb"), "610a62");
        assert_ne!(path_key(b"a"), path_key(b"aa"));
    }
}
