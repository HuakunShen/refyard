//! One SSH connect-and-exec attempt: the deadline, the bounds, and cancellation.
//!
//! An SSH attempt is a local process, so it runs through the same bounded runner as every
//! other command in this crate: stdout and stderr are drained concurrently as bytes, the
//! output is capped, and a deadline or a cancellation kills **and reaps** the child.
//! Nothing here frames output differently from the local provider, which is what lets a
//! read's parser run unchanged on either transport.
//!
//! Two things are specific to SSH. The first is the deadline: connecting may include an
//! external key approval that legitimately takes longer than the TCP connect timeout, so
//! an attempt gets a floor of [`ATTEMPT_DEADLINE_SECS`] regardless of the plan's own
//! class, while a plan with a longer budget (a network operation) keeps it. The second is
//! the command string: the local argument vector stops at `ssh`, and only the remote login
//! shell ever parses what follows — see `quote`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use refyard_contract::problem::Problem;
use refyard_core::plan::{DeadlineClass, ProcessSpec};

use crate::process::{run, CancelSignal, RunOutcome};

use super::openssh;

/// The floor for one connect-and-exec attempt.
///
/// Longer than `ConnectTimeout=15` on purpose: a hardware key or an agent approval can
/// wait on a person, and a deadline that expired while the person was deciding would fail
/// a connection that was about to succeed. It is per attempt and cancellable, so a user
/// who changes their mind does not wait it out.
pub const ATTEMPT_DEADLINE_SECS: u64 = 90;

/// The deadline for one attempt under a plan's own class.
///
/// The floor never *shortens* a class: a network plan that is allowed ten minutes locally
/// is allowed ten minutes over SSH, plus the connect floor.
pub fn attempt_deadline(class: DeadlineClass) -> Duration {
    Duration::from_secs(class.seconds().max(ATTEMPT_DEADLINE_SECS))
}

/// A validated way to reach one host: which `ssh`, in which environment, as whom.
///
/// The alias is validated on construction, so no value that reached `Command` could have
/// skipped the host-token rule. The environment is held as data for the same reason the
/// local provider holds it: a fixture can give the command a controlled environment, and
/// the option list stays fixed either way.
///
/// `config_file` is an explicitly chosen per-user configuration source. It matters because
/// OpenSSH resolves `~/.ssh/config`, `~/.ssh/known_hosts` and `~` inside option values from
/// the passwd database entry for this uid, **not** from `HOME`: a process cannot isolate a
/// client by pointing `HOME` at a scratch directory, and a test that tried would silently
/// read the developer's own configuration. Passing `-F` is how a caller names the file it
/// actually means; a fixture then puts absolute paths for its key and known_hosts inside
/// that file. `None` leaves the machine's own rules in force.
#[derive(Debug, Clone)]
pub struct SshConnection {
    program: PathBuf,
    env: Vec<(String, String)>,
    alias: String,
    config_file: Option<PathBuf>,
}

impl SshConnection {
    /// A connection to `alias` through `program`, using the machine's own configuration.
    pub fn new(
        program: impl Into<PathBuf>,
        env: Vec<(String, String)>,
        alias: &str,
    ) -> Result<Self, Problem> {
        Self::with_config_file(program, env, alias, None)
    }

    /// A connection that reads its configuration from `config_file` instead of the
    /// machine's default files. See the type's note on why `HOME` cannot do this.
    pub fn with_config_file(
        program: impl Into<PathBuf>,
        env: Vec<(String, String)>,
        alias: &str,
        config_file: Option<PathBuf>,
    ) -> Result<Self, Problem> {
        openssh::validate_alias(alias)?;
        Ok(Self {
            program: program.into(),
            env,
            alias: alias.to_string(),
            config_file,
        })
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    /// The environment every command through this connection runs with.
    pub fn environment(&self) -> &[(String, String)] {
        &self.env
    }

    pub fn alias(&self) -> &str {
        &self.alias
    }

    /// The configuration source this connection reads, when the caller named one.
    pub fn config_file(&self) -> Option<&Path> {
        self.config_file.as_deref()
    }

    /// The local argument vector for one remote command string.
    pub fn argv(&self, remote_command: &str) -> Result<Vec<String>, Problem> {
        openssh::exec_argv(&self.alias, remote_command, self.config_file.as_deref())
    }

    /// Runs one remote command string under `deadline`, kill-and-reap on expiry.
    ///
    /// `stdin` is passed through as planned bytes: the runner writes them to `ssh`'s pipe
    /// and closes it. No `-n`, no `StdinNull=yes`, no redirection from the null device —
    /// a swallowed stdin would turn `cat-file --batch` and `--pathspec-from-file=-` into
    /// silent empty answers.
    ///
    /// A command string this layer refuses (a NUL anywhere, or a token that is not a host)
    /// becomes `NotStarted` with the refusal as its diagnostic: no process ran, and saying
    /// so is the truth. Callers that can carry a typed problem validate first.
    pub async fn run(
        &self,
        remote_command: &str,
        stdin: Vec<u8>,
        deadline: Duration,
        stdout_limit: usize,
        stderr_limit: usize,
        cancel: Option<CancelSignal>,
    ) -> RunOutcome {
        let argv = match self.argv(remote_command) {
            Ok(argv) => argv,
            Err(problem) => return RunOutcome::not_started(problem.message),
        };
        let spec = ProcessSpec {
            program: self.program.clone(),
            argv,
            stdin,
            // The local `ssh` runs where this process is; the repository directory is a
            // remote path and belongs in the command string, not in a local `chdir`.
            cwd: None,
            env: self.env.clone(),
            deadline,
            stdout_limit,
            stderr_limit,
        };
        run(spec, cancel).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_attempt_never_gets_less_than_the_connect_floor() {
        // A read's local budget is 15 seconds; over SSH it would have expired while the
        // person was approving a key, so the floor replaces it.
        assert_eq!(
            attempt_deadline(DeadlineClass::Read),
            Duration::from_secs(ATTEMPT_DEADLINE_SECS)
        );
        assert!(DeadlineClass::Read.seconds() < ATTEMPT_DEADLINE_SECS);
    }

    #[test]
    fn a_longer_class_budget_is_not_shortened_to_the_floor() {
        // A hook class is allowed two minutes locally; going through SSH must not cut it
        // to ninety seconds, and a network operation allowed ten minutes keeps all of it.
        assert_eq!(
            attempt_deadline(DeadlineClass::Hook),
            Duration::from_secs(DeadlineClass::Hook.seconds())
        );
        assert_eq!(
            attempt_deadline(DeadlineClass::Network),
            Duration::from_secs(DeadlineClass::Network.seconds())
        );
    }

    #[test]
    fn the_construction_refuses_a_token_that_is_not_a_host() {
        let problem = SshConnection::new("/usr/bin/ssh", Vec::new(), "-oProxyCommand=x")
            .expect_err("refused");
        assert_eq!(
            problem.code,
            refyard_contract::problem::ProblemCode::InvalidRequest
        );
    }
}
