//! Running Git on a remote POSIX host through the machine's own OpenSSH.
//!
//! The provider mirrors `LocalGit` at the seams the reads use — a planned argument vector
//! runs in a directory, and the program's version can be asked for — and differs only in
//! what crosses the wire. The local argument vector stops at `ssh`; the remote login shell
//! receives one quoted command string built by `ssh::quote`, so this module is the only
//! place a `GitPlan` becomes that string and a caller can never supply one.
//!
//! **Nothing is installed on the remote host, and no artifact is uploaded.** The remote
//! side contributes `git`, a POSIX login shell, and the user's existing key material; the
//! codec, the parsers and the planners all stay here. The user's own OpenSSH configuration
//! — including its `ProxyCommand` and `Match exec` programs — is used verbatim and never
//! imported, rewritten or worked around.
//!
//! Output is framed exactly as the local provider frames it: bytes, concurrently drained,
//! bounded, with `output_complete` separate from the exit code. A read's parser therefore
//! cannot tell which transport it ran on, which is what lets the same bytes from either
//! transport be compared directly.

use std::path::{Path, PathBuf};

use refyard_contract::problem::Problem;
use refyard_core::outcome::ExecutionState;
use refyard_core::plan::{DeadlineClass, GitPlan};

use crate::process::{CancelSignal, RunOutcome};
use crate::providers::local::{STDERR_DIAGNOSTIC_MAX_BYTES, STRUCTURED_STDOUT_MAX_BYTES};
use crate::registry::RepositoryLayout;
use crate::ssh::connection::{attempt_deadline, SshConnection};
use crate::ssh::probe::{self, RemoteFacts};
use crate::ssh::quote::remote_git_command;
use crate::ssh::{openssh, HostError};

/// The directory the version probe runs in.
///
/// `git --version` needs no repository, and the template always names a directory, so the
/// probe runs in the login directory rather than in a repository the caller has not
/// chosen yet.
const PROBE_DIRECTORY: &str = ".";

/// Git on a remote host, reached through this machine's `ssh`.
#[derive(Debug, Clone)]
pub struct SshGit {
    connection: SshConnection,
}

impl SshGit {
    /// A provider for one alias, resolving `ssh` from `PATH` and using this process's
    /// allow-listed environment with the machine's own SSH configuration.
    pub fn discover(alias: &str) -> Result<Self, Problem> {
        Self::at_config(
            openssh::discover_program()?,
            openssh::ssh_environment(),
            alias,
            None,
        )
    }

    /// The same, reading the host's configuration from one explicitly chosen file.
    pub fn discover_with_config(alias: &str, config_file: PathBuf) -> Result<Self, Problem> {
        Self::at_config(
            openssh::discover_program()?,
            openssh::ssh_environment(),
            alias,
            Some(config_file),
        )
    }

    /// A provider for a specific executable and environment, using the machine's own
    /// configuration files.
    pub fn at(
        program: impl Into<PathBuf>,
        env: Vec<(String, String)>,
        alias: &str,
    ) -> Result<Self, Problem> {
        Self::at_config(program, env, alias, None)
    }

    /// A provider for a specific executable, environment and configuration source, used by
    /// tests and by `doctor`.
    ///
    /// The environment and the configuration source are parameters for one reason: OpenSSH
    /// resolves `~/.ssh/config`, `~/.ssh/known_hosts` and `~` in option values from the
    /// passwd entry for this uid, not from `HOME`, so a fixture cannot isolate a client by
    /// pointing `HOME` somewhere. It names its own configuration file instead, with
    /// absolute paths for its key and known_hosts inside it. The option list is identical
    /// either way.
    pub fn at_config(
        program: impl Into<PathBuf>,
        env: Vec<(String, String)>,
        alias: &str,
        config_file: Option<PathBuf>,
    ) -> Result<Self, Problem> {
        Ok(Self {
            connection: SshConnection::with_config_file(program, env, alias, config_file)?,
        })
    }

    pub fn program(&self) -> &Path {
        self.connection.program()
    }

    /// The environment every command from this provider runs with.
    pub fn environment(&self) -> &[(String, String)] {
        self.connection.environment()
    }

    pub fn alias(&self) -> &str {
        self.connection.alias()
    }

    /// The configuration source this provider reads, when the caller named one.
    pub fn config_file(&self) -> Option<&Path> {
        self.connection.config_file()
    }

    /// The command string one plan becomes. Exposed so a test can assert the exact text
    /// without running it, and so the workspace has one implementation of the template.
    pub fn command_for(&self, directory: &str, plan: &GitPlan) -> Result<String, HostError> {
        remote_git_command(directory, &plan.argv)
    }

    /// Runs one planned command against the remote repository at `directory`.
    ///
    /// Same shape as `LocalGit::run`: the outcome carries the state, the exit code, both
    /// byte streams and whether they are complete. A refused command string becomes
    /// `NotStarted` — nothing ran — since this signature cannot carry a typed problem.
    pub async fn run(
        &self,
        directory: &str,
        plan: GitPlan,
        cancel: Option<CancelSignal>,
    ) -> RunOutcome {
        match self.try_run(directory, &plan, cancel).await {
            Ok(outcome) => outcome,
            Err(problem) => RunOutcome::not_started(problem.message),
        }
    }

    /// The same run, with the refusal available as a typed problem.
    ///
    /// This is what a caller that can still answer a client should use: a path this host
    /// cannot encode is an `InvalidRequest`, not a remote Git failure.
    pub async fn try_run(
        &self,
        directory: &str,
        plan: &GitPlan,
        cancel: Option<CancelSignal>,
    ) -> Result<RunOutcome, Problem> {
        let command = self.command_for(directory, plan)?;
        Ok(self
            .connection
            .run(
                &command,
                plan.stdin.clone(),
                attempt_deadline(plan.deadline_class),
                STRUCTURED_STDOUT_MAX_BYTES,
                STDERR_DIAGNOSTIC_MAX_BYTES,
                cancel,
            )
            .await)
    }

    /// Runs one planned command with a caller-supplied stdout bound.
    pub async fn run_with_limits(
        &self,
        directory: &str,
        plan: &GitPlan,
        cancel: Option<CancelSignal>,
        stdout_limit: Option<usize>,
    ) -> RunOutcome {
        let command = match self.command_for(directory, plan) {
            Ok(command) => command,
            Err(problem) => return RunOutcome::not_started(problem.message),
        };
        self.connection
            .run(
                &command,
                plan.stdin.clone(),
                attempt_deadline(plan.deadline_class),
                stdout_limit.unwrap_or(STRUCTURED_STDOUT_MAX_BYTES),
                STDERR_DIAGNOSTIC_MAX_BYTES,
                cancel,
            )
            .await
    }

    /// Runs one fixed remote command string with a caller-supplied output bound.
    ///
    /// The Git provider only ever runs planned Git commands. This is the one seam the
    /// remote *file* reader needs, and it exists so that reader does not have to reach
    /// into the connection: the command has already been built from a fixed template with
    /// every value single-quote encoded, and nothing here accepts a command from a
    /// renderer. The stdout bound is a parameter because a file read and a Git read
    /// buffer different amounts, and a bound the caller states is the one it can enforce.
    pub async fn run_raw_command(
        &self,
        remote_command: &str,
        stdout_limit: usize,
        stderr_limit: usize,
    ) -> RunOutcome {
        self.connection
            .run(
                remote_command,
                Vec::new(),
                attempt_deadline(DeadlineClass::Read),
                stdout_limit,
                stderr_limit,
                None,
            )
            .await
    }

    /// The Git version the remote host reports.
    ///
    /// The signature matches `LocalGit::version` so a capability answer does not care
    /// which transport it is asking.
    pub async fn version(&self) -> Result<String, String> {
        probe::git_version(&self.connection, PROBE_DIRECTORY, None)
            .await
            .map_err(|problem| problem.message)
    }

    /// Opens one remote directory as a repository.
    ///
    /// The layout query is the same planner the local open uses, and the answer is parsed
    /// by the same parser, so the object format this host must not assume arrives over the
    /// wire as it does locally.
    pub async fn open(&self, directory: &str) -> Result<RepositoryLayout, Problem> {
        probe::layout(&self.connection, directory, None).await
    }

    /// Probes what the remote host can do: POSIX shell semantics, `git`, and the layout.
    pub async fn probe(&self, directory: &str) -> Result<RemoteFacts, Problem> {
        probe::probe(&self.connection, directory, None).await
    }

    /// Probes the host-level facts a target needs before any directory is named.
    ///
    /// Shell semantics first, because every later command depends on the login shell
    /// parsing the quoted template, then `git --version`. The repository layout is *not*
    /// part of this: it belongs to opening a repository, which happens later and names a
    /// different question (which object format, is this bare) than "can this host carry
    /// the reads at all".
    pub async fn probe_host(&self) -> Result<String, Problem> {
        probe::shell_semantics(&self.connection, None).await?;
        probe::git_version(&self.connection, PROBE_DIRECTORY, None).await
    }

    /// The exit status a non-answer carries when a remote command could not be run at all.
    ///
    /// `ssh` reports a connection-level failure as 255 and a remote command's own status
    /// otherwise; 255 is therefore ambiguous, and a write that saw it must be treated as
    /// unknown rather than retried. Reads only need to know that no answer arrived.
    pub fn is_connection_exit(outcome: &RunOutcome) -> bool {
        outcome.state == ExecutionState::Completed && outcome.exit_code == Some(255)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::problem::ProblemCode;
    use refyard_core::plan::status::plan_status;

    fn provider() -> SshGit {
        SshGit::at("/usr/bin/ssh", Vec::new(), "prod").expect("alias is a host token")
    }

    #[test]
    fn a_plan_becomes_the_quoted_template_and_not_a_local_argv() {
        let plan = plan_status(Default::default());
        let command = provider().command_for("/srv/a b", &plan).expect("quotable");
        assert!(command.starts_with("git -C '/srv/a b' '--no-optional-locks' 'status'"));
        // The plan's own argument vector never reaches a local process: the provider has
        // no path that spawns `git` here.
        assert!(!command.contains("/usr/bin/ssh"));
    }

    #[test]
    fn a_path_that_cannot_be_encoded_is_refused_before_anything_runs() {
        let plan = plan_status(Default::default());
        let problem = provider()
            .command_for("/srv/bad\0path", &plan)
            .expect_err("refused");
        assert_eq!(problem.code, ProblemCode::UnsupportedPathEncoding);
    }

    #[test]
    fn a_connection_level_exit_is_recognisable_without_being_retried() {
        let refused = RunOutcome {
            state: ExecutionState::Completed,
            exit_code: Some(255),
            stdout: Vec::new(),
            stderr: b"ssh: connect to host x port 22: Connection refused\n".to_vec(),
            output_complete: true,
            termination: None,
        };
        assert!(SshGit::is_connection_exit(&refused));
        assert!(!SshGit::is_connection_exit(&RunOutcome::not_started("x")));
    }
}
